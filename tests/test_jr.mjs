// JR Ninjas: the MyStudio import marks JR classes (new and existing Ninjas), and senseis keep notes.
import { check, finish } from "./helpers.mjs";
import { openDatabase, closeDatabase, conn } from "../js/core/db.js";
import { handleRequest } from "../js/api/index.js";
import { parseActiveNinjasCsv } from "../js/lib/schedule_import.js";

const call = (method, url, body, file) => handleRequest(method, url, body, file);
const upload = (text) => ({ text: async () => text });

openDatabase(null);

// Already on the roster: Mia (her Monday 4 PM class is JR in the file) and Sam (CREATE only).
await call("POST", "/api/active-ninjas/person", { name: "Mia Lee", sessions: [{ day: "Monday", time_slot: "4 PM - 5 PM" }] });
await call("POST", "/api/active-ninjas/person", { name: "Sam Park", sessions: [{ day: "Monday", time_slot: "5 PM - 6 PM" }] });

const csv = [
  "Date, Time, Class name, Participant name, Customer name, Email address, Phone number ",
  "\"Monday, Oct 27\",04:00 PM,JR,MIA LEE,Parent,p@example.com,555",
  "\"Monday, Oct 27\",05:00 PM,CREATE,SAM PARK,Parent,p@example.com,555",
  "\"Tuesday, Oct 28\",04:00 PM,JR,ZOE CHAN,Parent,p@example.com,555",
  "\"Tuesday, Nov 4\",04:00 PM,JR,ZOE CHAN,Parent,p@example.com,555",
  "\"Saturday, Nov 1\",10:00 AM,Junior Coders,LEO KIM,Parent,p@example.com,555",
  "\"Saturday, Nov 1\",11:00 AM,CREATE,AVA DIAZ,Parent,p@example.com,555",
].join("\n");

const preview = await call("POST", "/api/active-ninjas/import", undefined, upload(csv));
const zoe = preview.people.find((p) => p.name === "Zoe Chan");
check("JR class is flagged for a new Ninja (repeats merged)", zoe && zoe.sessions.length === 1 && zoe.sessions[0].is_jr === true, zoe);
check("'Junior ...' class counts as JR", preview.people.find((p) => p.name === "Leo Kim").sessions[0].is_jr === true);
check("CREATE class is not JR", preview.people.find((p) => p.name === "Ava Diaz").sessions[0].is_jr === false);
check("existing Ninja's JR class is offered for marking",
  JSON.stringify(preview.jrMarks) === JSON.stringify([{ name: "Mia Lee", day: "Monday", time_slot: "4 PM - 5 PM" }]), preview.jrMarks);

const confirmed = await call("POST", "/api/active-ninjas/import/confirm", { people: preview.people, jrMarks: preview.jrMarks });
check("confirm adds new Ninjas and marks the existing JR class",
  confirmed.addedNinjas === 3 && confirmed.markedJr === 1, confirmed);
const isJr = (name) => conn.all("SELECT is_jr FROM active_ninjas WHERE name = ?", [name]).map((r) => r.is_jr);
check("Mia's class is now JR", JSON.stringify(isJr("Mia Lee")) === "[1]", isJr("Mia Lee"));
check("Sam's class stays not JR", JSON.stringify(isJr("Sam Park")) === "[0]", isJr("Sam Park"));
check("Zoe was added as JR", JSON.stringify(isJr("Zoe Chan")) === "[1]", isJr("Zoe Chan"));

// Marking only: no new Ninjas picked is fine, and a second run marks nothing more.
const again = await call("POST", "/api/active-ninjas/import/confirm", { people: [], jrMarks: preview.jrMarks });
check("marking again changes nothing", again.markedJr === 0 && again.addedNinjas === 0, again);

// Search "jr" finds every JR class.
const jrRows = await call("GET", "/api/active-ninjas?q=jr");
check("search 'jr' finds JR classes", jrRows.map((r) => r.name).sort().join() === "Leo Kim,Mia Lee,Zoe Chan", jrRows.map((r) => r.name));

// Notes
await call("POST", "/api/jr-notes", { name: "Zoe Chan", note: "Finished the maze game", author: "Sensei A" });
await call("POST", "/api/jr-notes", { name: "  zoe   chan ", note: "Starting animations", author: "Sensei B" });
let jr = await call("GET", "/api/jr-ninjas");
check("JR list has only JR Ninjas", jr.map((p) => p.name).join() === "Leo Kim,Mia Lee,Zoe Chan", jr.map((p) => p.name));
const zoeCard = jr.find((p) => p.name === "Zoe Chan");
check("notes match the Ninja ignoring case/spacing", zoeCard.notes.length === 2, zoeCard.notes);
check("newest note first", zoeCard.notes[0].note === "Starting animations", zoeCard.notes.map((n) => n.note));

let error = null;
try { await call("POST", "/api/jr-notes", { name: "Zoe Chan", note: "   " }); } catch (e) { error = e; }
check("empty note is refused", error && error.status === 400, error && error.message);

await call("PUT", `/api/jr-notes/${zoeCard.notes[0].id}`, { note: "Starting sprite animations" });
await call("DELETE", `/api/jr-notes/${zoeCard.notes[1].id}`);
let notes = await call("GET", "/api/jr-notes?name=Zoe%20Chan");
check("edit and delete a note", notes.length === 1 && notes[0].note === "Starting sprite animations" && notes[0].author === "Sensei B", notes);

// Renaming the Ninja keeps their notes.
const zoeRow = conn.get("SELECT id FROM active_ninjas WHERE name = 'Zoe Chan'");
await call("POST", "/api/active-ninjas/person", {
  name: "Zoe Chan-Wu", original_name: "Zoe Chan", sessions: [{ id: zoeRow.id, day: "Tuesday", time_slot: "4:00 PM", is_jr: true }],
});
notes = await call("GET", "/api/jr-notes?name=Zoe%20Chan-Wu");
check("renamed Ninja keeps notes", notes.length === 1, notes);

// The edit window can turn JR off again.
await call("POST", "/api/active-ninjas/person", {
  name: "Leo Kim", original_name: "Leo Kim",
  sessions: [{ id: conn.get("SELECT id FROM active_ninjas WHERE name = 'Leo Kim'").id, day: "Saturday", time_slot: "10:00 AM", is_jr: false }],
});
jr = await call("GET", "/api/jr-ninjas");
check("unticking JR removes them from the JR list", !jr.some((p) => p.name === "Leo Kim"), jr.map((p) => p.name));

// Other CSV formats: "(JR)" after a name, or a JR column.
const flat = parseActiveNinjasCsv("Name,Day,Time Slot,AI,JR\nAmy (JR),Monday,4 PM,,\nBo,Monday,5 PM,yes,yes\nCy,Monday,6 PM,,no");
check("flat CSV reads JR from the name or the JR column",
  JSON.stringify(flat.map((e) => [e.name, e.is_ai, e.is_jr])) === JSON.stringify([["Amy", false, true], ["Bo", true, true], ["Cy", false, false]]), flat);

closeDatabase();
finish("JR Ninjas");
