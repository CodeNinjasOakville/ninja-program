import { conn } from "../core/db.js";
import { route } from "./router.js";
import { bulkDelete, insertAll, readUpload } from "./common.js";
import { ApiError, nonBlankLines, pyStr, splitBulkLine } from "../lib/util.js";
import { parseActiveNinjasCsv } from "../lib/schedule_import.js";

function insertActiveNinja(data) {
  const name = pyStr(data.name).trim();
  if (!name) throw new ApiError("Name is required.");
  conn.run("INSERT INTO active_ninjas (name, day, time_slot, is_ai, notes) VALUES (?, ?, ?, ?, ?)", [
    name, pyStr(data.day).trim(), pyStr(data.time_slot).trim(), data.is_ai ? 1 : 0, pyStr(data.notes).trim(),
  ]);
}

route("GET", "/api/active-ninjas", ({ query }) => {
  const search = (query.q || "").trim().toLowerCase();
  if (search) {
    const like = `%${search}%`;
    return conn.all(
      "SELECT * FROM active_ninjas WHERE lower(name) LIKE ? OR lower(day) LIKE ? OR lower(time_slot) LIKE ? ORDER BY day, time_slot, name",
      [like, like, like]
    );
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
//  - renaming changes the name on every session.
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
        conn.run("UPDATE active_ninjas SET name = ?, day = ?, time_slot = ?, is_ai = ? WHERE id = ?",
          [name, c.day, c.time_slot, c.is_ai, c.id]);
      } else {
        conn.run("INSERT INTO active_ninjas (name, day, time_slot, is_ai, notes) VALUES (?, ?, ?, ?, '')",
          [name, c.day, c.time_slot, c.is_ai]);
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

// Weekly "Session Schedule" export or a flat Name/Day/Time Slot/AI CSV (auto-detected).
route("POST", "/api/active-ninjas/import", async ({ file }) => {
  const raw = await readUpload(file);
  let parsed;
  try {
    parsed = parseActiveNinjasCsv(raw);
  } catch (error) {
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

route("DELETE", "/api/active-ninjas/:id", ({ params }) => {
  conn.run("DELETE FROM active_ninjas WHERE id = ?", [params.id]);
  return { ok: true };
});

route("POST", "/api/active-ninjas/bulk-delete", ({ body }) => bulkDelete("active_ninjas", body));
