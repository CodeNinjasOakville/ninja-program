// JR Ninjas (anyone with a JR class) and the notes senseis keep on what each one is working on.
// Notes are matched to a Ninja by name, ignoring case and spacing, like belts are.

import { conn, getSetting } from "../core/db.js";
import { route } from "./router.js";
import { ApiError, pyStr } from "../lib/util.js";
import { nameKey } from "../lib/belt_match.js";
import { DEFAULT_JR_SKILLS, STATUSES, buildChecklist, parseSkills, summarize } from "../lib/jr_skills.js";

/** The skills from Settings (the starter list if Settings has none). */
export function jrSkillList() {
  const lines = getSetting("jr_skills", null);
  return parseSkills(Array.isArray(lines) && lines.length ? lines : DEFAULT_JR_SKILLS);
}

/** One Ninja's checklist + summary. notes: their JR notes, newest first. */
export function jrChecklist(ninja, notes, skills = jrSkillList()) {
  const key = nameKey(ninja.name);
  const set = conn.all("SELECT * FROM jr_skills ORDER BY id")
    .filter((r) => (ninja.uid && r.ninja_uid === ninja.uid) || (!r.ninja_uid && nameKey(r.name) === key));
  const skillsList = buildChecklist(skills, notes, set);
  return { skills: skillsList, summary: summarize(skillsList) };
}

const newestFirst = (a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id;

/** Called when a Ninja is renamed on the Active Ninjas tab, so their notes follow them. */
export function renameJrNotes(oldName, newName) {
  const key = nameKey(oldName);
  for (const n of conn.all("SELECT id, name FROM jr_notes")) {
    if (nameKey(n.name) === key) conn.run("UPDATE jr_notes SET name = ? WHERE id = ?", [newName, n.id]);
  }
}

// Every Ninja with at least one JR class: [{name, belt, sessions: [all their classes], notes: [newest first]}]
route("GET", "/api/jr-ninjas", () => {
  const people = new Map();
  for (const row of conn.all("SELECT * FROM active_ninjas ORDER BY id")) {
    const key = nameKey(row.name);
    if (!people.has(key)) people.set(key, { name: pyStr(row.name).trim(), uid: row.ninja_uid || "", belt: "", is_jr: false, sessions: [], notes: [] });
    const person = people.get(key);
    person.sessions.push(row);
    if (row.is_jr) person.is_jr = true;
    if (!person.belt && row.belt) person.belt = row.belt;
  }
  for (const note of conn.all("SELECT * FROM jr_notes")) {
    const person = people.get(nameKey(note.name));
    if (person) person.notes.push(note);
  }
  const skills = jrSkillList();
  return [...people.values()]
    .filter((p) => p.is_jr)
    .map(({ is_jr, ...p }) => {
      const notes = p.notes.sort(newestFirst);
      return { ...p, notes, ...jrChecklist(p, notes, skills) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
});

// One Ninja's notes, newest first.
route("GET", "/api/jr-notes", ({ query }) => {
  const key = nameKey(query.name);
  return conn.all("SELECT * FROM jr_notes").filter((n) => nameKey(n.name) === key).sort(newestFirst);
});

// Body: {name, note, author}
route("POST", "/api/jr-notes", ({ body }) => {
  const name = pyStr(body.name).trim();
  const note = pyStr(body.note).trim();
  if (!name) throw new ApiError("Name is required.");
  if (!note) throw new ApiError("Write something first.");
  conn.run("INSERT INTO jr_notes (name, note, author) VALUES (?, ?, ?)", [name, note, pyStr(body.author).trim()]);
  return { ok: true };
});

// Body: {note} - fix a typo; who wrote it and when stay the same.
route("PUT", "/api/jr-notes/:id", ({ params, body }) => {
  const note = pyStr(body.note).trim();
  if (!note) throw new ApiError("A note can't be empty. Delete it instead.");
  if (!conn.get("SELECT id FROM jr_notes WHERE id = ?", [params.id])) throw new ApiError("That note no longer exists.", 404);
  conn.run("UPDATE jr_notes SET note = ? WHERE id = ?", [note, params.id]);
  return { ok: true };
});

route("DELETE", "/api/jr-notes/:id", ({ params }) => {
  conn.run("DELETE FROM jr_notes WHERE id = ?", [params.id]);
  return { ok: true };
});

// Body: {name, skill, status, author}. status "working" | "needs_work" | "done" sets it by hand;
// "" clears it, so the skill goes back to what the notes say.
route("PUT", "/api/jr-skills", ({ body }) => {
  const name = pyStr(body.name).trim();
  const skill = pyStr(body.skill).trim();
  const status = pyStr(body.status).trim();
  if (!name) throw new ApiError("Name is required.");
  if (!skill) throw new ApiError("Which skill?");
  if (status && !STATUSES.includes(status)) throw new ApiError("Unknown status.");
  const key = nameKey(name);
  const ninja = conn.get("SELECT uid FROM ninjas WHERE uid = ?", [pyStr(body.uid)]) ||
    conn.all("SELECT uid, name FROM ninjas").find((n) => nameKey(n.name) === key) || null;
  const existing = conn.all("SELECT * FROM jr_skills")
    .filter((r) => lower(r.skill) === lower(skill) && ((ninja && r.ninja_uid === ninja.uid) || (!r.ninja_uid && nameKey(r.name) === key)));
  conn.transaction(() => {
    existing.forEach((r) => conn.run("DELETE FROM jr_skills WHERE id = ?", [r.id]));
    if (status) {
      conn.run("INSERT INTO jr_skills (name, ninja_uid, skill, status, author) VALUES (?, ?, ?, ?, ?)",
        [name, ninja ? ninja.uid : null, skill, status, pyStr(body.author).trim()]);
    }
  });
  return { ok: true };
});

const lower = (s) => String(s || "").trim().toLowerCase();
