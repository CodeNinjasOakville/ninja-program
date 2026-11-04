import { conn, getSetting } from "../core/db.js";
import { route } from "./router.js";
import { bulkDelete, insertAll, readUpload, searchClause } from "./common.js";
import { ApiError, nonBlankLines, pyStr, splitBulkLine } from "../lib/util.js";
import {
  formatStartTime, looksLikeClassSchedule, looksLikeRankList, parseActiveNinjasCsv, parseClassSchedule, parseRankList,
  slotStartMinutes,
} from "../lib/schedule_import.js";
import { beltFromRank, formatBeltName, getBeltOrder, normalizeBelt } from "../lib/rewards.js";
import { parseCSV } from "../lib/csv.js";
import { LINKS_SETTING, fillMissingBelts, matchBelts, nameKey } from "../lib/belt_match.js";
import {
  emailKey, ensureNinja, findFamily, findOrCreateFamily, firstName, getFamily, getNinja, leadMatch,
  ninjasNamed, phoneKey, renameNinja, setNinjaBelt, updateFamily,
} from "../lib/ninjas.js";
import { renameJrNotes } from "./jr.js";

// Each row of active_ninjas is one weekly class. The child it belongs to is a row in ninjas
// (name, belt, family) - see js/lib/ninjas.js. Rows are returned with the family's details.
const CLASS_SELECT = `
  SELECT a.*, n.family_uid AS family_uid, f.name AS family_name, f.email AS family_email, f.phone AS family_phone
  FROM active_ninjas a
  LEFT JOIN ninjas n ON n.uid = a.ninja_uid
  LEFT JOIN families f ON f.uid = n.family_uid`;

function insertActiveNinja(data) {
  const name = pyStr(data.name).trim();
  if (!name) throw new ApiError("Name is required.");
  const uid = ensureNinja(conn, name, { family_uid: data.family_uid || null });
  const belt = pyStr(data.belt).trim();
  if (belt) setNinjaBelt(conn, uid, belt);
  const ninja = getNinja(conn, uid);
  conn.run("INSERT INTO active_ninjas (name, day, time_slot, is_ai, is_jr, notes, belt, ninja_uid) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
    ninja.name, pyStr(data.day).trim(), pyStr(data.time_slot).trim(), data.is_ai ? 1 : 0, data.is_jr ? 1 : 0,
    pyStr(data.notes).trim(), pyStr(ninja.belt), uid,
  ]);
}

route("GET", "/api/active-ninjas", ({ query }) => {
  const search = (query.q || "").trim();
  if (search) {
    // "ai" also finds every Artificial Intelligence session, "jr" every JR session.
    // Searching a parent's name, email or phone finds their children.
    const { where, params } = searchClause(
      ["a.name", "a.day", "a.time_slot", "a.notes", "f.name", "f.email"], search, "f.phone"
    );
    const flag = { ai: " OR a.is_ai = 1", jr: " OR a.is_jr = 1" }[search.toLowerCase()] || "";
    return conn.all(`${CLASS_SELECT} WHERE ${where}${flag} ORDER BY a.day, a.time_slot, a.name`, params);
  }
  return conn.all(`${CLASS_SELECT} ORDER BY a.day, a.time_slot, a.name`);
});

route("POST", "/api/active-ninjas", ({ body }) => {
  insertActiveNinja(body);
  return { ok: true };
});

// Edit any field on one class (change time, day, name or AI status). Only fields present change.
// A different name moves the class to the Ninja with that name.
route("PUT", "/api/active-ninjas/:id", ({ params, body }) => {
  const existing = conn.get("SELECT * FROM active_ninjas WHERE id = ?", [params.id]);
  if (!existing) throw new ApiError("That entry no longer exists.", 404);

  const name = pyStr("name" in body ? body.name : existing.name).trim();
  if (!name) throw new ApiError("Name is required.");
  const day = pyStr("day" in body ? body.day : existing.day).trim();
  const timeSlot = pyStr("time_slot" in body ? body.time_slot : existing.time_slot).trim();
  const notes = pyStr("notes" in body ? body.notes : existing.notes).trim();
  const isAi = ("is_ai" in body ? body.is_ai : !!existing.is_ai) ? 1 : 0;
  const isJr = ("is_jr" in body ? body.is_jr : !!existing.is_jr) ? 1 : 0;

  const owner = getNinja(conn, existing.ninja_uid);
  const uid = owner && nameKey(owner.name) === nameKey(name) ? owner.uid : ensureNinja(conn, name);
  if ("belt" in body) setNinjaBelt(conn, uid, pyStr(body.belt).trim());
  const ninja = getNinja(conn, uid);
  conn.run("UPDATE active_ninjas SET name = ?, day = ?, time_slot = ?, is_ai = ?, is_jr = ?, notes = ?, belt = ?, ninja_uid = ? WHERE id = ?",
    [ninja.name, day, timeSlot, isAi, isJr, notes, pyStr(ninja.belt), uid, params.id]);
  return { ok: true };
});

// Every class for one Ninja: ?uid=<ninja uid>, or ?name= (matched ignoring case/spacing).
route("GET", "/api/active-ninjas/person", ({ query }) => {
  if (query.uid) return conn.all(`${CLASS_SELECT} WHERE a.ninja_uid = ? ORDER BY a.id`, [query.uid]);
  const name = (query.name || "").trim().toLowerCase();
  return conn.all(`${CLASS_SELECT} WHERE lower(trim(a.name)) = ? ORDER BY a.id`, [name]);
});

// One Ninja with what the other tabs know about them: family, brothers/sisters, classes, belts, leads.
route("GET", "/api/ninjas/:key", ({ params }) => {
  const ninja = getNinja(conn, params.key);
  if (!ninja) throw new ApiError("That Ninja no longer exists.", 404);
  const family = getFamily(conn, ninja.family_uid);
  return {
    ...ninja,
    family,
    siblings: family
      ? conn.all("SELECT uid, name FROM ninjas WHERE family_uid = ? AND uid <> ? ORDER BY name", [family.uid, ninja.uid])
      : [],
    classes: conn.all("SELECT * FROM active_ninjas WHERE ninja_uid = ? ORDER BY id", [ninja.uid]),
    belts: conn.all("SELECT * FROM belt_entries WHERE ninja_uid = ? ORDER BY id", [ninja.uid]),
    leads: conn.all("SELECT id, entry_number, ninja_name, gbs_date, lead_date FROM leads WHERE ninja_uid = ? ORDER BY entry_number", [ninja.uid]),
  };
});

// Save one Ninja with any number of sessions in a single step.
//  - sessions with an id are updated, without one are added,
//  - existing sessions of the Ninja that are no longer listed are removed,
//  - renaming renames the Ninja everywhere (classes, Belts tab, rewards, JR notes),
//  - "belt" (when sent) is the Ninja's belt; without it the Ninja keeps the belt they had,
//  - "family" {name, email, phone} (when sent) is the parent / paying customer. It is shared with
//    brothers and sisters, so changing it here changes it for them too.
route("POST", "/api/active-ninjas/person", ({ body }) => {
  const name = pyStr(body.name).trim();
  const original = pyStr(body.original_name).trim();
  const sessions = body.sessions || [];

  if (!name) throw new ApiError("Name is required.");
  if (!sessions.length) throw new ApiError("Add at least one session.");

  const cleaned = [];
  const seen = new Set();
  sessions.forEach((sess, i) => {
    const day = pyStr(sess.day).trim();
    const timeSlot = pyStr(sess.time_slot).trim();
    const isAi = sess.is_ai ? 1 : 0;
    const isJr = sess.is_jr ? 1 : 0;
    const key = `${day.toLowerCase()}|${timeSlot.toLowerCase()}|${isAi}|${isJr}`;
    if (seen.has(key)) {
      throw new ApiError(
        `Session ${i + 1} is an exact repeat of another session (${day || "no day"}, ${timeSlot || "no time"}${isAi ? ", AI" : ""}${isJr ? ", JR" : ""}).`
      );
    }
    seen.add(key);
    cleaned.push({
      id: /^\d+$/.test(pyStr(sess.id)) ? parseInt(sess.id, 10) : null,
      day, time_slot: timeSlot, is_ai: isAi, is_jr: isJr,
    });
  });

  // The Ninja being edited (none when adding).
  const editing = getNinja(conn, body.uid) || (original ? ninjasNamed(conn, original)[0] : null) || null;
  const existingIds = new Set(
    editing ? conn.all("SELECT id FROM active_ninjas WHERE ninja_uid = ?", [editing.uid]).map((r) => r.id) : []
  );
  const keepIds = cleaned.filter((c) => c.id !== null).map((c) => c.id);
  if (!keepIds.every((id) => existingIds.has(id))) {
    throw new ApiError("One of those sessions no longer exists. Close this window and reopen it.", 409);
  }
  if (editing && nameKey(editing.name) !== nameKey(name)) {
    const other = ninjasNamed(conn, name).find((n) => n.uid !== editing.uid);
    if (other) {
      throw new ApiError(`There is already a Ninja called "${other.name}". Use a different name (a last initial helps).`);
    }
  }

  conn.transaction(() => {
    const uid = editing ? editing.uid : ensureNinja(conn, name);
    if (editing) {
      renameNinja(conn, uid, name);
      // Notes written before Ninja records existed follow by name.
      if (original && nameKey(original) !== nameKey(name)) renameJrNotes(original, name);
    }
    if ("belt" in body) setNinjaBelt(conn, uid, pyStr(body.belt).trim());
    if (body.family && typeof body.family === "object") saveFamilyFor(uid, body.family);

    const ninja = getNinja(conn, uid);
    for (const oldId of existingIds) {
      if (!keepIds.includes(oldId)) conn.run("DELETE FROM active_ninjas WHERE id = ?", [oldId]);
    }
    for (const c of cleaned) {
      if (c.id !== null) {
        conn.run("UPDATE active_ninjas SET name = ?, day = ?, time_slot = ?, is_ai = ?, is_jr = ?, belt = ?, ninja_uid = ? WHERE id = ?",
          [ninja.name, c.day, c.time_slot, c.is_ai, c.is_jr, pyStr(ninja.belt), uid, c.id]);
      } else {
        conn.run("INSERT INTO active_ninjas (name, day, time_slot, is_ai, is_jr, notes, belt, ninja_uid) VALUES (?, ?, ?, ?, ?, '', ?, ?)",
          [ninja.name, c.day, c.time_slot, c.is_ai, c.is_jr, pyStr(ninja.belt), uid]);
      }
    }
  });
  return { ok: true, sessionCount: cleaned.length };
});

// The family details typed in the edit window. Blank everywhere = this Ninja has no family on file.
function saveFamilyFor(uid, details) {
  const clean = { name: pyStr(details.name).trim(), email: pyStr(details.email).trim(), phone: pyStr(details.phone).trim() };
  const ninja = getNinja(conn, uid);
  if (!clean.name && !clean.email && !clean.phone) {
    if (ninja.family_uid) conn.run("UPDATE ninjas SET family_uid = NULL WHERE uid = ?", [uid]);
    return;
  }
  // Typing the email/phone of a family already on file joins that family (brothers and sisters).
  const other = findFamily(conn, clean);
  if (other && other.uid !== ninja.family_uid) {
    conn.run("UPDATE ninjas SET family_uid = ? WHERE uid = ?", [other.uid, uid]);
    updateFamily(conn, other.uid, clean);
  } else if (ninja.family_uid && getFamily(conn, ninja.family_uid)) {
    updateFamily(conn, ninja.family_uid, clean);
  } else {
    conn.run("UPDATE ninjas SET family_uid = ? WHERE uid = ?", [findOrCreateFamily(conn, clean), uid]);
  }
}

// Paste-many-rows: Name | Day | Time Slot | AI (yes/no) | JR (yes/no), tab or "|" separated.
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
      is_jr: p.length > 4 ? ["yes", "true", "1", "jr"].includes(p[4].toLowerCase()) : false,
    };
  });
  return insertAll(entries, insertActiveNinja, (i) => `Line ${i + 1}`);
});

// ---- MyStudio class-schedule import: review first, then apply only what was ticked ----

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

const sameDay = (a, b) => pyStr(a).trim().toLowerCase() === pyStr(b).trim().toLowerCase();
const classView = (r) => ({ id: r.id, day: pyStr(r.day).trim(), time_slot: pyStr(r.time_slot).trim(), is_ai: !!r.is_ai, is_jr: !!r.is_jr });

/** Is the family on file the same as the one in the export? true / false / null = can't tell. */
function sameFamily(onFile, fromFile) {
  if (!onFile) return null;
  const e1 = emailKey(onFile.email), e2 = emailKey(fromFile.email);
  const p1 = phoneKey(onFile.phone), p2 = phoneKey(fromFile.phone);
  if ((e1 && e1 === e2) || (p1 && p1 === p2)) return true;
  if ((e1 && e2) || (p1 && p2)) return false;
  return null;
}

/** The Ninja on file that a child in the export is: {ninja, how}, or null for a new Ninja. */
function matchNinja(person, ninjas, families) {
  const familyOf = (n) => families.get(n.family_uid) || null;
  const named = ninjas.filter((n) => nameKey(n.name) === nameKey(person.name));
  // Same name: the same child, unless their family on file is clearly a different family.
  const sameName = named.find((n) => sameFamily(familyOf(n), person.family) === true)
    || named.find((n) => sameFamily(familyOf(n), person.family) === null);
  if (sameName) return { ninja: sameName, how: "name" };
  // Spelled differently or shortened, but the same family and the same first name.
  const first = firstName(person.name);
  const hits = ninjas.filter((n) => firstName(n.name) === first && sameFamily(familyOf(n), person.family) === true);
  if (hits.length === 1) return { ninja: hits[0], how: "family" };
  return null;
}

/** What would change in the family on file if the export's details were used (null = nothing). */
function familyChange(onFile, fromFile) {
  const wanted = { name: pyStr(fromFile.name).trim(), email: pyStr(fromFile.email).trim(), phone: pyStr(fromFile.phone).trim() };
  if (!wanted.name && !wanted.email && !wanted.phone) return null;
  if (!onFile) return { ...wanted, note: "add " + [wanted.name, wanted.email, wanted.phone].filter(Boolean).join(" · ") };
  const changes = [];
  if (wanted.name && wanted.name.toLowerCase() !== pyStr(onFile.name).trim().toLowerCase()) {
    changes.push(`name ${onFile.name || "(none)"} → ${wanted.name}`);
  }
  if (emailKey(wanted.email) && emailKey(wanted.email) !== emailKey(onFile.email)) {
    changes.push(`email ${onFile.email || "(none)"} → ${wanted.email}`);
  }
  if (phoneKey(wanted.phone) && phoneKey(wanted.phone) !== phoneKey(onFile.phone)) {
    changes.push(`phone ${onFile.phone || "(none)"} → ${wanted.phone}`);
  }
  return changes.length ? { ...wanted, note: changes.join(", ") } : null;
}

// ---- Belts from MyStudio (a rank / belt column in an export) ----

/**
 * How the belt in the file compares with the Ninja's belt here (null = same, or the file has none):
 *   up      a higher belt: recorded on the Belts tab as old -> new, so the rewards follow
 *   start   no belt here yet: recorded as their starting belt (no rewards)
 *   set     the belt here isn't one of the Settings belts: replaced
 *   lower   the file has a lower belt: offered, not ticked
 *   unknown the file's rank isn't one of the Settings belts: shown only
 */
function beltChange(currentBelt, rankText, order) {
  const rank = pyStr(rankText).trim();
  if (!rank) return null;
  const to = beltFromRank(rank, order);
  if (!to) return { kind: "unknown", rank, from: pyStr(currentBelt).trim(), to: "" };
  const now = normalizeBelt(currentBelt);
  if (now === to) return null;
  const view = { rank, from: now ? formatBeltName(now) : "", to: formatBeltName(to) };
  if (!now) return { ...view, kind: "start" };
  if (!order.includes(now)) return { ...view, kind: "set" };
  if (order.indexOf(to) > order.indexOf(now)) return { ...view, kind: "up", levels: order.indexOf(to) - order.indexOf(now) };
  return { ...view, kind: "lower" };
}

/** Puts the belt on the Ninja and records the belt-up (or starting belt) on the Belts tab. */
function applyBelt(ninja, rankOrBelt, result) {
  const order = getBeltOrder(conn);
  const change = beltChange(ninja.belt, rankOrBelt, order);
  if (!change || change.kind === "unknown") return false;
  if (change.kind === "up" || change.kind === "start") {
    conn.run("INSERT INTO belt_entries (name, old_belt, new_belt, ninja_uid) VALUES (?, ?, ?, ?)",
      [ninja.name, change.kind === "up" ? change.from : "", change.to, ninja.uid]);
  }
  setNinjaBelt(conn, ninja.uid, change.to);
  ninja.belt = change.to;
  if (change.kind === "up") result.beltUps.push(`${ninja.name}: ${change.from} \u2192 ${change.to}`);
  else if (change.kind === "start") result.startingBelts += 1;
  else result.beltsCorrected += 1;
  return true;
}

// A list of Ninjas and their belts (no classes): only belts change. Children who aren't Ninjas
// here are listed, not added - a rank list doesn't say which classes they come to.
export function previewRankList(list) {
  const ninjas = conn.all("SELECT * FROM ninjas ORDER BY created_at, uid");
  const families = new Map(conn.all("SELECT * FROM families").map((f) => [f.uid, f]));
  const order = getBeltOrder(conn);
  const updates = [], unchanged = [], notFound = [];
  for (const person of list) {
    const found = matchNinja(person, ninjas, families);
    if (!found) { notFound.push(person.name); continue; }
    const belt = beltChange(found.ninja.belt, person.rank, order);
    if (!belt) { unchanged.push(found.ninja.name); continue; }
    updates.push({
      uid: found.ninja.uid, name: found.ninja.name,
      file_name: nameKey(person.name) !== nameKey(found.ninja.name) ? person.name : "",
      family: null, add: [], remove: [], marks: [], belt,
    });
  }
  const byName = (a, b) => a.name.localeCompare(b.name);
  return {
    preview: true, kind: "ranks", people: [], missing: [], days: [],
    updates: updates.sort(byName),
    alreadyThere: unchanged.sort((a, b) => a.localeCompare(b)),
    notFound: notFound.sort((a, b) => a.localeCompare(b)),
  };
}

function previewClassSchedule(entries) {
  const classes = conn.all("SELECT * FROM active_ninjas ORDER BY id");
  const ninjas = conn.all("SELECT * FROM ninjas ORDER BY created_at, uid");
  const families = new Map(conn.all("SELECT * FROM families").map((f) => [f.uid, f]));
  const label = slotLabeller(classes);
  const days = getSetting("schedule_days", []);
  const dayIndex = (day) => (days.indexOf(day) === -1 ? 99 : days.indexOf(day));
  const bySchedule = (a, b) => dayIndex(a.day) - dayIndex(b.day) ||
    (slotStartMinutes(a.time_slot) ?? 9999) - (slotStartMinutes(b.time_slot) ?? 9999);
  const fileDays = new Set(entries.map((e) => e.day.toLowerCase()).filter(Boolean));
  const order = getBeltOrder(conn);

  // One person per child in the file (the same name in two families = two children).
  const people = new Map();
  for (const entry of entries) {
    const key = `${nameKey(entry.name)}|${emailKey(entry.family.email) || phoneKey(entry.family.phone)}`;
    if (!people.has(key)) people.set(key, { name: entry.name, family: { ...entry.family }, sessions: [], rank: "" });
    const person = people.get(key);
    person.sessions.push(entry);
    if (!person.rank && entry.rank) person.rank = entry.rank;
  }

  const rosterNames = new Map(); // nameKey -> name as on the roster, for the "already here as...?" hint
  for (const c of classes) if (!rosterNames.has(nameKey(c.name))) rosterNames.set(nameKey(c.name), pyStr(c.name).trim());
  const openLeads = conn.all("SELECT id, entry_number, ninja_name, email, phone_number FROM leads WHERE ninja_uid IS NULL OR ninja_uid = ''");

  // How a child in the file differs from a Ninja on file: classes to add / remove, marks, parent.
  const diffAgainst = (ninja, person) => {
    const mine = classes.filter((c) => c.ninja_uid === ninja.uid);
    const used = new Set();
    const add = [], marks = [];
    for (const s of person.sessions) {
      const row = mine.find((c) => !used.has(c.id) && sameDay(c.day, s.day) && slotStartMinutes(c.time_slot) === s.start);
      if (!row) {
        add.push({ day: s.day, time_slot: label(s.day, s.start), is_ai: s.is_ai, is_jr: s.is_jr, notes: s.classes.join(" + ") });
        continue;
      }
      used.add(row.id);
      // The file can turn the AI / JR mark on; it never turns one off.
      if ((s.is_jr && !row.is_jr) || (s.is_ai && !row.is_ai)) {
        marks.push({ ...classView(row), set_jr: s.is_jr && !row.is_jr, set_ai: s.is_ai && !row.is_ai });
      }
    }
    // A class the file doesn't have. "suggested" (ticked) only when the file covers that weekday,
    // so an export of just some days doesn't suggest removing all the others.
    const remove = mine.filter((c) => !used.has(c.id))
      .map((c) => ({ ...classView(c), suggested: fileDays.has(pyStr(c.day).trim().toLowerCase()) }));
    return {
      uid: ninja.uid,
      name: ninja.name,
      file_name: nameKey(person.name) !== nameKey(ninja.name) ? person.name : "",
      family: familyChange(families.get(ninja.family_uid) || null, person.family),
      belt: beltChange(ninja.belt, person.rank, order),
      add: add.sort(bySchedule),
      remove: remove.sort(bySchedule),
      marks: marks.sort(bySchedule),
    };
  };

  const fresh = [], updates = [], unchanged = [];
  const matched = new Set();
  for (const person of people.values()) {
    const found = matchNinja(person, ninjas, families);
    if (!found) {
      const similarKey = [...rosterNames.keys()].find((k) => looksLikeSamePerson(nameKey(person.name), k));
      const similar = similarKey ? ninjas.find((n) => nameKey(n.name) === similarKey) : null;
      // The lead this child came from, if any (same name, or same parent contact + first name).
      const pseudo = { uid: "", name: person.name, family_uid: "*" };
      const lead = openLeads.find((l) =>
        leadMatch(l, [pseudo], new Map([[nameKey(person.name), pseudo]]), new Map([["*", person.family]])));
      fresh.push({
        name: person.name,
        similar_to: similarKey ? rosterNames.get(similarKey) : "",
        // If they turn out to be that Ninja: what would change for them (parent details always,
        // so the next import recognises them by family).
        same_as: similar ? diffAgainst(similar, person) : null,
        family: person.family,
        belt: formatBeltName(beltFromRank(person.rank, order)),
        rank: person.rank,
        lead: lead ? { id: lead.id, entry_number: lead.entry_number, ninja_name: lead.ninja_name } : null,
        sessions: person.sessions.map((s) => ({
          day: s.day, time_slot: label(s.day, s.start), is_ai: s.is_ai, is_jr: s.is_jr, notes: s.classes.join(" + "),
        })).sort(bySchedule),
      });
      continue;
    }

    matched.add(found.ninja.uid);
    const update = diffAgainst(found.ninja, person);
    if (!update.add.length && !update.marks.length && !update.remove.length && !update.family && !update.belt) {
      unchanged.push(found.ninja.name);
      continue;
    }
    updates.push(update);
  }

  // On the roster, but not in this export at all.
  const missing = [];
  const seenMissing = new Set();
  for (const c of classes) {
    if (!c.ninja_uid || matched.has(c.ninja_uid) || seenMissing.has(c.ninja_uid)) continue;
    seenMissing.add(c.ninja_uid);
    missing.push({
      uid: c.ninja_uid,
      name: pyStr(c.name).trim(),
      sessions: classes.filter((x) => x.ninja_uid === c.ninja_uid).map(classView).sort(bySchedule),
    });
  }

  const byName = (a, b) => a.name.localeCompare(b.name);
  return {
    preview: true,
    people: fresh.sort(byName),
    updates: updates.sort(byName),
    missing: missing.sort(byName),
    alreadyThere: unchanged.sort((a, b) => a.localeCompare(b)),
    days: [...fileDays].map((d) => d[0].toUpperCase() + d.slice(1)).sort((a, b) => dayIndex(a) - dayIndex(b)),
  };
}

// Weekly "Session Schedule" export or a flat Name/Day/Time Slot/AI CSV (auto-detected) are added
// straight away. A MyStudio "All classes schedule" export is NOT applied here: it comes back as
// {preview: true, people, updates, missing, alreadyThere} for the review window, which then calls
// .../import/confirm with the parts that were ticked.
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
    if (looksLikeRankList(rows)) {
      const list = parseRankList(rows);
      if (!list.length) throw new ApiError("That belt / rank list has no Ninjas in it.");
      return previewRankList(list);
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

// Body (every part optional; only what was ticked in the review window):
//   people:  [{name, family: {name, email, phone}, lead: {id}, belt, sessions: [{day, time_slot, is_ai, is_jr, notes}]}]
//            new Ninjas. Anyone whose name has classes by now is skipped, never doubled up.
//   updates: [{uid, family: {name, email, phone} | null, add: [sessions], remove: [{id}], marks: [{id, set_jr, set_ai}],
//             rename: "name from the file" (optional), belt: {to} (optional)}]
//            A belt higher than theirs is recorded on the Belts tab as a belt-up (old -> new), so the
//            rewards follow; a first belt is recorded as their starting belt.
//            changes to Ninjas already on file.
//   missing: [uid, ...] Ninjas no longer in the export: their classes are removed. The Ninja record,
//            family, belts, rewards and notes stay, so they are recognised if they come back.
route("POST", "/api/active-ninjas/import/confirm", ({ body }) => {
  const people = body.people || [];
  const updates = body.updates || [];
  const missing = body.missing || [];
  if (!people.length && !updates.length && !missing.length) throw new ApiError("Nothing was selected.");

  const onRoster = new Set(conn.all("SELECT name FROM active_ninjas").map((r) => nameKey(r.name)));
  const result = {
    addedNinjas: 0, addedSessions: 0, skipped: [], updatedNinjas: 0, addedClasses: 0, removedClasses: 0,
    markedJr: 0, markedAi: 0, familiesUpdated: 0, removedNinjas: 0, linkedLeads: 0, renamed: 0,
    beltUps: [], startingBelts: 0, beltsCorrected: 0,
  };

  conn.transaction(() => {
    for (const person of people) {
      const name = pyStr(person.name).trim();
      const sessions = person.sessions || [];
      if (!name || !sessions.length) continue;
      if (onRoster.has(nameKey(name))) {
        result.skipped.push(name);
        continue;
      }
      onRoster.add(nameKey(name));
      const familyUid = person.family ? findOrCreateFamily(conn, person.family) : null;
      const uid = ensureNinja(conn, name, { family_uid: familyUid });
      if (pyStr(person.belt).trim()) applyBelt(getNinja(conn, uid), person.belt, result);
      for (const session of sessions) insertActiveNinja({ ...session, name: getNinja(conn, uid).name });
      const leadId = person.lead && Number(person.lead.id);
      if (leadId && conn.get("SELECT 1 AS x FROM leads WHERE id = ? AND (ninja_uid IS NULL OR ninja_uid = '')", [leadId])) {
        conn.run("UPDATE leads SET ninja_uid = ? WHERE id = ?", [uid, leadId]);
        result.linkedLeads += 1;
      }
      result.addedNinjas += 1;
      result.addedSessions += sessions.length;
    }

    for (const change of updates) {
      const ninja = getNinja(conn, pyStr(change.uid));
      if (!ninja) continue;
      let touched = false;
      const rename = pyStr(change.rename).trim();
      if (rename && nameKey(rename) !== nameKey(ninja.name)) {
        if (ninjasNamed(conn, rename).some((n) => n.uid !== ninja.uid)) {
          result.skipped.push(`${rename} (there is already a Ninja with that name, so ${ninja.name} kept their name)`);
        } else {
          renameNinja(conn, ninja.uid, rename);
          ninja.name = getNinja(conn, ninja.uid).name;
          result.renamed += 1;
          touched = true;
        }
      }
      const own = (id) => conn.get("SELECT * FROM active_ninjas WHERE id = ? AND ninja_uid = ?", [Number(id), ninja.uid]);
      for (const r of change.remove || []) {
        if (!own(r.id)) continue;
        conn.run("DELETE FROM active_ninjas WHERE id = ?", [Number(r.id)]);
        result.removedClasses += 1; touched = true;
      }
      for (const m of change.marks || []) {
        const row = own(m.id);
        if (!row) continue;
        if (m.set_jr && !row.is_jr) { conn.run("UPDATE active_ninjas SET is_jr = 1 WHERE id = ?", [row.id]); result.markedJr += 1; touched = true; }
        if (m.set_ai && !row.is_ai) { conn.run("UPDATE active_ninjas SET is_ai = 1 WHERE id = ?", [row.id]); result.markedAi += 1; touched = true; }
      }
      for (const s of change.add || []) {
        insertActiveNinja({ ...s, name: ninja.name });
        result.addedClasses += 1; touched = true;
      }
      if (change.family) {
        const details = {};
        for (const k of ["name", "email", "phone"]) if (pyStr(change.family[k]).trim()) details[k] = pyStr(change.family[k]).trim();
        const fam = getFamily(conn, ninja.family_uid);
        if (fam) updateFamily(conn, fam.uid, details);
        else conn.run("UPDATE ninjas SET family_uid = ? WHERE uid = ?", [findOrCreateFamily(conn, details), ninja.uid]);
        result.familiesUpdated += 1; touched = true;
      }
      if (change.belt && pyStr(change.belt.to).trim() && applyBelt(ninja, change.belt.to, result)) touched = true;
      if (touched) result.updatedNinjas += 1;
    }

    for (const uid of missing) {
      const count = conn.get("SELECT COUNT(*) AS c FROM active_ninjas WHERE ninja_uid = ?", [pyStr(uid)]).c;
      if (!count) continue;
      conn.run("DELETE FROM active_ninjas WHERE ninja_uid = ?", [pyStr(uid)]);
      result.removedNinjas += 1;
      result.removedClasses += count;
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
