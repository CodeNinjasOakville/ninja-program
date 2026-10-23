import { conn, getSetting } from "../core/db.js";
import { route } from "./router.js";
import { bulkDelete, insertAll, readUpload, searchClause } from "./common.js";
import { ApiError, nonBlankLines, pyStr, splitBulkLine } from "../lib/util.js";
import {
  formatStartTime, looksLikeClassSchedule, parseActiveNinjasCsv, parseClassSchedule, slotStartMinutes,
} from "../lib/schedule_import.js";
import { parseCSV } from "../lib/csv.js";
import { LINKS_SETTING, activePeople, fillMissingBelts, matchBelts, nameKey, setPersonBelt } from "../lib/belt_match.js";

// A new class for a Ninja who is already on the roster keeps the belt they have.
function existingBelt(name) {
  const person = activePeople(conn).get(nameKey(name));
  return person ? person.belt : "";
}

function insertActiveNinja(data) {
  const name = pyStr(data.name).trim();
  if (!name) throw new ApiError("Name is required.");
  const belt = pyStr(data.belt).trim() || existingBelt(name);
  conn.run("INSERT INTO active_ninjas (name, day, time_slot, is_ai, notes, belt) VALUES (?, ?, ?, ?, ?, ?)", [
    name, pyStr(data.day).trim(), pyStr(data.time_slot).trim(), data.is_ai ? 1 : 0, pyStr(data.notes).trim(), belt,
  ]);
}

route("GET", "/api/active-ninjas", ({ query }) => {
  const search = (query.q || "").trim();
  if (search) {
    // "ai" also finds every Artificial Intelligence session.
    const { where, params } = searchClause(["name", "day", "time_slot", "notes"], search);
    const aiOnly = search.toLowerCase() === "ai" ? " OR is_ai = 1" : "";
    return conn.all(`SELECT * FROM active_ninjas WHERE ${where}${aiOnly} ORDER BY day, time_slot, name`, params);
  }
  return conn.all("SELECT * FROM active_ninjas ORDER BY day, time_slot, name");
});

route("POST", "/api/active-ninjas", ({ body }) => {
  insertActiveNinja(body);
  return { ok: true };
});

// Edit any field on an existing row (change time, day, name or AI status). Only fields present change.
route("PUT", "/api/active-ninjas/:id", ({ params, body }) => {
  const existing = conn.get("SELECT * FROM active_ninjas WHERE id = ?", [params.id]);
  if (!existing) throw new ApiError("That entry no longer exists.", 404);

  const name = pyStr("name" in body ? body.name : existing.name).trim();
  if (!name) throw new ApiError("Name is required.");
  const day = pyStr("day" in body ? body.day : existing.day).trim();
  const timeSlot = pyStr("time_slot" in body ? body.time_slot : existing.time_slot).trim();
  const notes = pyStr("notes" in body ? body.notes : existing.notes).trim();
  const isAi = ("is_ai" in body ? body.is_ai : !!existing.is_ai) ? 1 : 0;

  conn.run("UPDATE active_ninjas SET name = ?, day = ?, time_slot = ?, is_ai = ?, notes = ? WHERE id = ?",
    [name, day, timeSlot, isAi, notes, params.id]);
  if ("belt" in body) setPersonBelt(conn, name, pyStr(body.belt).trim());
  return { ok: true };
});

// Every session (row) for one Ninja, matched by name ignoring case/spacing.
route("GET", "/api/active-ninjas/person", ({ query }) => {
  const name = (query.name || "").trim().toLowerCase();
  return conn.all("SELECT * FROM active_ninjas WHERE lower(trim(name)) = ? ORDER BY id", [name]);
});

// Save one Ninja with any number of sessions in a single step.
//  - sessions with an id are updated, without one are added,
//  - existing sessions of original_name that are no longer listed are removed,
//  - renaming changes the name on every session,
//  - "belt" (when sent) is put on every session; without it the Ninja keeps the belt they had.
route("POST", "/api/active-ninjas/person", ({ body }) => {
  const name = pyStr(body.name).trim();
  const original = pyStr(body.original_name).trim();
  const sessions = body.sessions || [];
  const belt = "belt" in body ? pyStr(body.belt).trim() : existingBelt(original || name);

  if (!name) throw new ApiError("Name is required.");
  if (!sessions.length) throw new ApiError("Add at least one session.");

  const cleaned = [];
  const seen = new Set();
  sessions.forEach((sess, i) => {
    const day = pyStr(sess.day).trim();
    const timeSlot = pyStr(sess.time_slot).trim();
    const isAi = sess.is_ai ? 1 : 0;
    const key = `${day.toLowerCase()}|${timeSlot.toLowerCase()}|${isAi}`;
    if (seen.has(key)) {
      throw new ApiError(
        `Session ${i + 1} is an exact repeat of another session (${day || "no day"}, ${timeSlot || "no time"}${isAi ? ", AI" : ""}).`
      );
    }
    seen.add(key);
    cleaned.push({
      id: /^\d+$/.test(pyStr(sess.id)) ? parseInt(sess.id, 10) : null,
      day, time_slot: timeSlot, is_ai: isAi,
    });
  });

  const existingIds = new Set(
    original
      ? conn.all("SELECT id FROM active_ninjas WHERE lower(trim(name)) = ?", [original.toLowerCase()]).map((r) => r.id)
      : []
  );
  const keepIds = cleaned.filter((c) => c.id !== null).map((c) => c.id);
  if (!keepIds.every((id) => existingIds.has(id))) {
    throw new ApiError("One of those sessions no longer exists. Close this window and reopen it.", 409);
  }

  conn.transaction(() => {
    for (const oldId of existingIds) {
      if (!keepIds.includes(oldId)) conn.run("DELETE FROM active_ninjas WHERE id = ?", [oldId]);
    }
    for (const c of cleaned) {
      if (c.id !== null) {
        conn.run("UPDATE active_ninjas SET name = ?, day = ?, time_slot = ?, is_ai = ?, belt = ? WHERE id = ?",
          [name, c.day, c.time_slot, c.is_ai, belt, c.id]);
      } else {
        conn.run("INSERT INTO active_ninjas (name, day, time_slot, is_ai, notes, belt) VALUES (?, ?, ?, ?, '', ?)",
          [name, c.day, c.time_slot, c.is_ai, belt]);
      }
    }
  });
  return { ok: true, sessionCount: cleaned.length };
});

// Paste-many-rows: Name | Day | Time Slot | AI (yes/no), tab or "|" separated.
route("POST", "/api/active-ninjas/bulk", ({ body }) => {
  const lines = nonBlankLines(body.text);
  if (!lines.length) throw new ApiError("No entries were provided.");
  const entries = lines.map((line) => {
    const p = splitBulkLine(line).map((x) => x.trim());
    return {
      name: p[0] || "",
      day: p[1] || "",
      time_slot: p[2] || "",
      is_ai: p.length > 3 ? ["yes", "true", "1", "ai"].includes(p[3].toLowerCase()) : false,
    };
  });
  return insertAll(entries, insertActiveNinja, (i) => `Line ${i + 1}`);
});

// ---- MyStudio class-schedule import: review first, then add only the Ninjas who are new ----

const personKey = (name) => pyStr(name).trim().toLowerCase();

// "Daniel" or "Daniel K" already on the roster vs "Daniel Kinoshi" in the file: probably the
// same Ninja under a shorter name, so it is offered for review instead of being added blindly.
function looksLikeSamePerson(importedKey, existingKey) {
  const a = importedKey.split(/\s+/);
  const b = existingKey.split(/\s+/);
  if (a[0] !== b[0]) return false;
  if (a.length === 1 || b.length === 1) return true;
  const lastA = a[a.length - 1];
  const lastB = b[b.length - 1].replace(/\.$/, "");
  return lastA.startsWith(lastB) || lastB.startsWith(lastA);
}

// Reuse the wording the roster already has for a start time ("4 PM - 5 PM") so imported Ninjas
// land in the existing time blocks instead of creating a second block for the same hour.
function slotLabeller(existingRows) {
  const counts = {}; // "day|minutes" and "*|minutes" -> { label: timesUsed }
  for (const row of existingRows) {
    const label = pyStr(row.time_slot).trim();
    const start = slotStartMinutes(label);
    if (!label || start === null) continue;
    for (const key of [`${pyStr(row.day).trim().toLowerCase()}|${start}`, `*|${start}`]) {
      counts[key] = counts[key] || {};
      counts[key][label] = (counts[key][label] || 0) + 1;
    }
  }
  const mostUsed = (key) => Object.entries(counts[key] || {}).sort((x, y) => y[1] - x[1])[0]?.[0];
  return (day, start) => {
    if (start === null) return "";
    return mostUsed(`${day.toLowerCase()}|${start}`) || mostUsed(`*|${start}`) || formatStartTime(start);
  };
}

function previewClassSchedule(entries) {
  const existingRows = conn.all("SELECT name, day, time_slot FROM active_ninjas");
  const existingNames = new Map(); // key -> name as it is written on the roster
  for (const row of existingRows) {
    if (!existingNames.has(personKey(row.name))) existingNames.set(personKey(row.name), pyStr(row.name).trim());
  }
  const label = slotLabeller(existingRows);
  const days = getSetting("schedule_days", []);
  const dayIndex = (day) => (days.indexOf(day) === -1 ? 99 : days.indexOf(day));

  const people = new Map();
  for (const entry of entries) {
    const key = personKey(entry.name);
    if (!people.has(key)) people.set(key, { name: entry.name, sessions: [] });
    people.get(key).sessions.push(entry);
  }

  const fresh = [];
  const alreadyThere = [];
  for (const [key, person] of people) {
    if (existingNames.has(key)) {
      alreadyThere.push(existingNames.get(key));
      continue;
    }
    const similar = [...existingNames.keys()].find((existing) => looksLikeSamePerson(key, existing));
    fresh.push({
      name: person.name,
      similar_to: similar ? existingNames.get(similar) : "",
      sessions: person.sessions
        .sort((a, b) => dayIndex(a.day) - dayIndex(b.day) || a.start - b.start)
        .map((s) => ({ day: s.day, time_slot: label(s.day, s.start), is_ai: s.is_ai, notes: s.classes.join(" + ") })),
    });
  }

  const byName = (a, b) => a.localeCompare(b);
  return {
    preview: true,
    people: fresh.sort((a, b) => byName(a.name, b.name)),
    alreadyThere: alreadyThere.sort(byName),
  };
}

// Weekly "Session Schedule" export or a flat Name/Day/Time Slot/AI CSV (auto-detected) are added
// straight away. A MyStudio "All classes schedule" export is NOT added here: it comes back as
// {preview: true, people, alreadyThere} for the review window, which then calls .../import/confirm.
route("POST", "/api/active-ninjas/import", async ({ file }) => {
  const raw = await readUpload(file);
  let parsed;
  try {
    const rows = parseCSV(raw);
    if (looksLikeClassSchedule(rows)) {
      const entries = parseClassSchedule(rows);
      if (!entries.length) throw new ApiError("That class schedule export has no Ninjas in it.");
      return previewClassSchedule(entries);
    }
    parsed = parseActiveNinjasCsv(raw);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(`Could not read CSV: ${error.message}`);
  }
  if (!parsed.length) {
    throw new ApiError(
      "Could not find any recognizable Ninjas in that file. Expected either a weekly schedule export " +
      "(with day columns) or a flat CSV with Name/Day/Time Slot columns."
    );
  }
  return insertAll(parsed, insertActiveNinja, (i) => `Entry ${i + 1}`);
});

// Body: {people: [{name, sessions: [{day, time_slot, is_ai, notes}]}]} - the Ninjas ticked in the
// review window. Anyone whose name is on the roster by now is skipped, never changed or doubled up.
route("POST", "/api/active-ninjas/import/confirm", ({ body }) => {
  const people = body.people || [];
  if (!people.length) throw new ApiError("No Ninjas were selected.");

  const onRoster = new Set(conn.all("SELECT name FROM active_ninjas").map((r) => personKey(r.name)));
  const result = { addedNinjas: 0, addedSessions: 0, skipped: [] };

  conn.transaction(() => {
    for (const person of people) {
      const name = pyStr(person.name).trim();
      const sessions = person.sessions || [];
      if (!name || !sessions.length) continue;
      if (onRoster.has(personKey(name))) {
        result.skipped.push(name);
        continue;
      }
      onRoster.add(personKey(name));
      for (const session of sessions) insertActiveNinja({ ...session, name });
      result.addedNinjas += 1;
      result.addedSessions += sessions.length;
    }
  });
  return result;
});

// ---- Belts shared with the Belts tab (rules in js/lib/belt_match.js) ----

// Body: {choices: {"<Belts-tab name>": "<Active Ninja name>" or "" for none of them}} (optional).
// Saves those answers, fills every blank Active Ninja belt it can, and returns
// {filled: [{name, belt, from}], questions: [{belt_name, belt, candidates: [{name, belt}]}]}.
route("POST", "/api/active-ninjas/belt-matches", ({ body }) => {
  const choices = body.choices || {};
  if (Object.keys(choices).length) {
    const saved = { ...(getSetting(LINKS_SETTING, {}) || {}) };
    for (const [beltName, activeName] of Object.entries(choices)) {
      if (nameKey(beltName)) saved[nameKey(beltName)] = nameKey(activeName);
    }
    conn.run(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [LINKS_SETTING, JSON.stringify(saved)]
    );
  }
  // Nothing is written (and nothing synced) when every belt is already filled in.
  const filled = fillMissingBelts(conn);
  return { filled, questions: matchBelts(conn).questions };
});

route("DELETE", "/api/active-ninjas/:id", ({ params }) => {
  conn.run("DELETE FROM active_ninjas WHERE id = ?", [params.id]);
  return { ok: true };
});

route("POST", "/api/active-ninjas/bulk-delete", ({ body }) => bulkDelete("active_ninjas", body));
