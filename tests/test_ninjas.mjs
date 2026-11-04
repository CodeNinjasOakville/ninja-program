// Ninja + family records: every sheet links to its Ninja, the MyStudio import matches children by
// name AND parent, and renames / belts travel to every tab.
import { check, finish } from "./helpers.mjs";
import { openDatabase, closeDatabase, conn } from "../js/core/db.js";
import { handleRequest } from "../js/api/index.js";

const call = (method, url, body, file) => handleRequest(method, url, body, file);
const upload = (text) => ({ text: async () => text });
const ninjaOf = (name) => conn.get("SELECT * FROM ninjas WHERE name = ?", [name]);
const csv = (...rows) => ["Date, Time, Class name, Participant name, Customer name, Email address, Phone number ", ...rows].join("\n");

openDatabase(null);

// ---- Data from before Ninja records existed: plain names on every sheet.
conn.run("INSERT INTO active_ninjas (name, day, time_slot, belt) VALUES ('Mia Lee', 'Monday', '4 PM - 5 PM', 'Yellow')");
conn.run("INSERT INTO active_ninjas (name, day, time_slot, belt) VALUES ('mia  lee', 'Wednesday', '5 PM - 6 PM', '')");
conn.run("INSERT INTO active_ninjas (name, day, time_slot) VALUES ('Sam Park', 'Tuesday', '4 PM - 5 PM')");
conn.run("INSERT INTO active_ninjas (name, day, time_slot) VALUES ('Leo Kim', 'Saturday', '10 AM')");
conn.run("INSERT INTO belt_entries (name, old_belt, new_belt) VALUES ('Mia Lee', 'White', 'Yellow')");
conn.run("INSERT INTO receipts (date, name, reward_type, amount) VALUES ('2026-10-01', 'MIA LEE', 'Ninja Bucks', 5)");
conn.run("INSERT INTO jr_notes (name, note) VALUES ('Sam Park', 'Loves mazes')");
conn.run("INSERT INTO leads (entry_number, ninja_name, email) VALUES (1, 'Sam Park', 'park@x.com')");
conn.run("INSERT INTO leads (entry_number, ninja_name, email) VALUES (2, 'Ava Diaz', 'diaz@x.com')");

let rows = await call("GET", "/api/active-ninjas");
check("every class is linked to a Ninja", rows.every((r) => r.ninja_uid), rows);
check("one Ninja per child (case/spacing ignored)", conn.all("SELECT * FROM ninjas").length === 3, conn.all("SELECT name FROM ninjas"));
check("both of Mia's classes carry her name and belt",
  JSON.stringify(rows.filter((r) => r.ninja_uid === ninjaOf("Mia Lee").uid).map((r) => [r.name, r.belt])) === JSON.stringify([["Mia Lee", "Yellow"], ["Mia Lee", "Yellow"]]), rows);
check("belt entry, reward and JR note are linked",
  conn.get("SELECT ninja_uid FROM belt_entries").ninja_uid === ninjaOf("Mia Lee").uid &&
  conn.get("SELECT ninja_uid FROM receipts").ninja_uid === ninjaOf("Mia Lee").uid &&
  conn.get("SELECT ninja_uid FROM jr_notes").ninja_uid === ninjaOf("Sam Park").uid);
check("a linked reward takes the Ninja's spelling", conn.get("SELECT name FROM receipts").name === "Mia Lee");
let leads = await call("GET", "/api/leads");
check("lead with the same name is linked and shows as enrolled", leads.find((l) => l.ninja_name === "Sam Park").enrolled === true, leads);
check("lead nobody matches is not enrolled", leads.find((l) => l.ninja_name === "Ava Diaz").enrolled === false);

// ---- Renaming travels to every tab; the belt lives on the Ninja.
const mia = ninjaOf("Mia Lee");
const miaClasses = conn.all("SELECT id, day, time_slot FROM active_ninjas WHERE ninja_uid = ?", [mia.uid]);
await call("POST", "/api/active-ninjas/person", {
  uid: mia.uid, original_name: "Mia Lee", name: "Mia Lee-Wong", belt: "Orange",
  family: { name: "Grace Lee", email: "lee@x.com", phone: "905-555-0101" },
  sessions: miaClasses.map((c) => ({ id: c.id, day: c.day, time_slot: c.time_slot })),
});
check("rename reaches the Belts tab and Reward History",
  conn.get("SELECT name FROM belt_entries").name === "Mia Lee-Wong" && conn.get("SELECT name FROM receipts").name === "Mia Lee-Wong");
check("belt is on the Ninja and every class",
  ninjaOf("Mia Lee-Wong").belt === "Orange" && conn.all("SELECT belt FROM active_ninjas WHERE ninja_uid = ?", [mia.uid]).every((r) => r.belt === "Orange"));
check("parent details are saved as a family", (() => {
  const f = conn.get("SELECT * FROM families WHERE uid = ?", [ninjaOf("Mia Lee-Wong").family_uid]);
  return f && f.name === "Grace Lee" && f.email === "lee@x.com";
})());
let error = null;
try {
  await call("POST", "/api/active-ninjas/person", { original_name: "Sam Park", name: "leo kim", sessions: [{ day: "Tuesday" }] });
} catch (e) { error = e; }
check("renaming onto another Ninja's name is refused", error && /already a Ninja called "Leo Kim"/.test(error.message), error && error.message);

const byParent = await call("GET", "/api/active-ninjas?q=lee%40x.com");
check("searching a parent's email finds the child", byParent.length === 2 && byParent.every((r) => r.name === "Mia Lee-Wong" && r.family_name === "Grace Lee"), byParent);
const phone = await call("GET", "/api/active-ninjas?q=9055550101");
check("searching a parent's phone (any format) finds the child", phone.length === 2, phone);

// ---- MyStudio import
const file = csv(
  // Mia, listed by her short name; same family email -> she is matched, not added again.
  "\"Monday, Nov 3\",04:00 PM,CREATE,MIA LEE,Grace Lee,lee@x.com,905-555-0101",
  // Mia's Wednesday class is gone; she now also comes on Friday.
  "\"Friday, Nov 7\",05:00 PM,CREATE,MIA LEE,Grace Lee,lee@x.com,905-555-0101",
  // Sam: same classes, parent details are new to us.
  "\"Tuesday, Nov 4\",04:00 PM,CREATE,SAM PARK,Jin Park,park@x.com,416-555-0199",
  "\"Tuesday, Nov 11\",04:00 PM,CREATE,SAM PARK,Jin Park,park@x.com,416-555-0199",
  // Sam's sister: new, same family.
  "\"Tuesday, Nov 4\",04:00 PM,CREATE,EMMA PARK,Jin Park,park@x.com,416-555-0199",
  // A new child who came from a lead (same parent email).
  "\"Monday, Nov 3\",05:00 PM,JR,AVA DIAZ,Rosa Diaz,diaz@x.com,",
  // Same name as Mia's old name but a different family: a different child.
  "\"Friday, Nov 7\",04:00 PM,CREATE,MIA LEE-WONG,Other Parent,other@x.com,",
);
// (Leo Kim is not in the file at all.)
const preview = await call("POST", "/api/active-ninjas/import", undefined, upload(file));
const upd = (name) => preview.updates.find((u) => u.name === name);
check("Mia is matched through her family, not added", !preview.people.some((p) => p.name === "Mia Lee") && upd("Mia Lee-Wong") && upd("Mia Lee-Wong").file_name === "Mia Lee", preview);
check("Mia's new Friday class is offered", upd("Mia Lee-Wong").add.length === 1 && upd("Mia Lee-Wong").add[0].day === "Friday", upd("Mia Lee-Wong"));
check("Mia's Wednesday class is offered for removal, not ticked (the file has no Wednesdays)",
  upd("Mia Lee-Wong").remove.length === 1 && upd("Mia Lee-Wong").remove[0].day === "Wednesday" && upd("Mia Lee-Wong").remove[0].suggested === false, upd("Mia Lee-Wong").remove);
check("Sam: parent details offered, classes unchanged",
  upd("Sam Park") && upd("Sam Park").family && upd("Sam Park").family.email === "park@x.com" && !upd("Sam Park").add.length && !upd("Sam Park").remove.length, upd("Sam Park"));
const fresh = (name) => preview.people.find((p) => p.name === name);
check("Emma is new, with her family", fresh("Emma Park") && fresh("Emma Park").family.name === "Jin Park");
check("Ava is new and her lead is found", fresh("Ava Diaz") && fresh("Ava Diaz").lead && fresh("Ava Diaz").lead.entry_number === 2, fresh("Ava Diaz"));
check("same name, different family = a different child", !!fresh("Mia Lee-Wong"), preview.people.map((p) => p.name));
check("Leo is listed as not in this export", preview.missing.length === 1 && preview.missing[0].name === "Leo Kim", preview.missing);
check("the file's weekdays are reported", preview.days.join() === "Monday,Tuesday,Friday", preview.days);

const result = await call("POST", "/api/active-ninjas/import/confirm", {
  people: preview.people.filter((p) => p.name !== "Mia Lee-Wong"),
  // As the review window sends it: removals only where ticked (suggested).
  updates: preview.updates.map((u) => ({ ...u, remove: u.remove.filter((r) => r.suggested) })),
  missing: preview.missing.map((m) => m.uid),
});
check("confirm result adds up",
  result.addedNinjas === 2 && result.addedClasses === 1 && result.removedClasses === 1 && result.familiesUpdated === 1 &&
  result.removedNinjas === 1 && result.linkedLeads === 1, result);
const famOf = (name) => ninjaOf(name).family_uid;
check("brother and sister share one family", famOf("Sam Park") && famOf("Sam Park") === famOf("Emma Park"));
check("family details came from the file", conn.get("SELECT phone FROM families WHERE uid = ?", [famOf("Sam Park")]).phone === "416-555-0199");
check("Leo's classes are gone but his record stays", !conn.get("SELECT 1 AS x FROM active_ninjas WHERE name = 'Leo Kim'") && !!ninjaOf("Leo Kim"));
leads = await call("GET", "/api/leads");
check("Ava's lead now shows enrolled", leads.find((l) => l.ninja_name === "Ava Diaz").enrolled === true);
const ninja = await call("GET", `/api/ninjas/${ninjaOf("Sam Park").uid}`);
check("one Ninja view: family, sister, classes, lead",
  ninja.family.name === "Jin Park" && ninja.siblings.map((s) => s.name).join() === "Emma Park" && ninja.classes.length === 1 && ninja.leads.length === 1, ninja);

// ---- Importing the same file again changes nothing for the people already done.
const again = await call("POST", "/api/active-ninjas/import", undefined, upload(file));
check("second import: no new Ninjas except the one left out", again.people.map((p) => p.name).join() === "Mia Lee-Wong", again.people.map((p) => p.name));
check("second import: only Mia's unticked Wednesday removal is left",
  again.updates.length === 1 && again.updates[0].name === "Mia Lee-Wong" && again.updates[0].remove.length === 1 && !again.updates[0].add.length, again.updates);

// ---- A Ninja who comes back keeps their belt and history.
await call("POST", "/api/leads", { ninja_name: "zzz" }); // unrelated write
await call("POST", "/api/active-ninjas/person", { name: "Leo Kim", sessions: [{ day: "Sunday", time_slot: "1 PM" }] });
check("returning Ninja reuses their record", conn.all("SELECT * FROM ninjas WHERE name = 'Leo Kim'").length === 1 &&
  conn.get("SELECT ninja_uid FROM active_ninjas WHERE name = 'Leo Kim'").ninja_uid === ninjaOf("Leo Kim").uid);

// ---- Belts tab entries for a Ninja on the roster are linked as they are added.
await call("POST", "/api/belts", { name: "emma park", old_belt: "White", new_belt: "Yellow" });
await call("GET", "/api/belts");
check("a new belt entry links to the Ninja", conn.get("SELECT ninja_uid, name FROM belt_entries WHERE lower(name) = 'emma park'").ninja_uid === ninjaOf("Emma Park").uid);

// ---- If linking ever fails, the lists still load.
const leadCount = conn.get("SELECT COUNT(*) AS c FROM leads").c;
conn.run("DROP TABLE ninjas");
const realError = console.error; console.error = () => {};
let stillThere = null;
try { stillThere = await call("GET", "/api/leads"); } catch (e) { stillThere = e; }
console.error = realError;
check("a linking failure doesn't hide the leads", Array.isArray(stillThere) && stillThere.length === leadCount, stillThere && stillThere.message);

closeDatabase();
finish("Ninja + family records");
