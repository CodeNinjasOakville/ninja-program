// JR Ninjas (anyone with a JR class) and the notes senseis keep on what each one is working on.
// Notes are matched to a Ninja by name, ignoring case and spacing, like belts are.

import { conn } from "../core/db.js";
import { route } from "./router.js";
import { ApiError, pyStr } from "../lib/util.js";
import { nameKey } from "../lib/belt_match.js";

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
    if (!people.has(key)) people.set(key, { name: pyStr(row.name).trim(), belt: "", is_jr: false, sessions: [], notes: [] });
    const person = people.get(key);
    person.sessions.push(row);
    if (row.is_jr) person.is_jr = true;
    if (!person.belt && row.belt) person.belt = row.belt;
  }
  for (const note of conn.all("SELECT * FROM jr_notes")) {
    const person = people.get(nameKey(note.name));
    if (person) person.notes.push(note);
  }
  return [...people.values()]
    .filter((p) => p.is_jr)
    .map(({ is_jr, ...p }) => ({ ...p, notes: p.notes.sort(newestFirst) }))
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
