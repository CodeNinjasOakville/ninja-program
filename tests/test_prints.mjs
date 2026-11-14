// 3D print queue: prints promised to Ninjas, first come first printed, with a link and/or a small file.
import { check, finish } from "./helpers.mjs";
import { openDatabase, closeDatabase, conn } from "../js/core/db.js";
import { handleRequest } from "../js/api/index.js";
import { todayISO } from "../js/lib/util.js";
import {
  MAX_FILE_BYTES, base64Size, cleanDate, cleanFileName, cleanLink, daysBetween, queueOrder,
} from "../js/lib/print_queue.js";

const call = (method, url, body) => handleRequest(method, url, body);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function fails(promise) { try { await promise; return null; } catch (e) { return e.message; } }

// ---- the rules on their own
check("links get https:// when typed without it", cleanLink("tinkercad.com/things/abc") === "https://tinkercad.com/things/abc");
check("http(s) links are kept", cleanLink(" https://www.thingiverse.com/thing:1 ") === "https://www.thingiverse.com/thing:1");
check("blank link stays blank", cleanLink("  ") === "");
check("links that could run code are refused", cleanLink("javascript:alert(1)") === null && cleanLink("data:text/html,x") === null);
check("words are not a link", cleanLink("a dragon") === null);
check("real dates only", cleanDate("2026-02-28") === "2026-02-28" && cleanDate("2026-02-30") === null && cleanDate("Nov 3") === null);
check("base64 size", base64Size("aGVsbG8=") === 5 && base64Size("") === 0);
check("file names lose folders and odd characters", cleanFileName("C:\\x\\my <dragon>.stl") === "my _dragon_.stl" && cleanFileName("..") === "model");
check("days waited", daysBetween("2026-11-01", "2026-11-14") === 13 && daysBetween("2026-11-20", "2026-11-14") === 0);
check("queue order: oldest promised first, then first added",
  same([{ id: 3, promised_date: "2026-11-02" }, { id: 1, promised_date: "2026-11-05" }, { id: 2, promised_date: "2026-11-02" }]
    .sort(queueOrder).map((r) => r.id), [2, 3, 1]));

// ---- through the app
openDatabase(null);
await call("POST", "/api/active-ninjas/person", { name: "Mia Lee", sessions: [{ day: "Monday", time_slot: "4 PM" }] });
await call("POST", "/api/active-ninjas/person", { name: "Sam Park", sessions: [{ day: "Tuesday", time_slot: "4 PM" }] });
// Mia earned 2 levels (2 prints owed); Sam earned 1.
await call("POST", "/api/belts", { name: "Mia Lee", old_belt: "White", new_belt: "Orange" });
await call("POST", "/api/belts", { name: "Sam Park", old_belt: "White", new_belt: "Yellow" });
const printsOwed = async (name) => {
  const row = (await call("GET", "/api/rewards/summary")).rows.find((r) => r.name === name);
  return row ? row.prints_remaining : 0;
};
check("starting prints owed", (await printsOwed("Mia Lee")) === 2 && (await printsOwed("Sam Park")) === 1);

const stl = Buffer.from("solid dragon\nendsolid dragon\n").toString("base64");
const a = await call("POST", "/api/prints", { name: "mia lee", description: "Dragon keychain", model_link: "tinkercad.com/things/dragon",
  promised_date: "2026-11-05", file: { name: "dragon.stl", type: "model/stl", data: stl } });
const b = await call("POST", "/api/prints", { name: "Sam Park", description: "Rocket", promised_date: "2026-11-02" });
const c = await call("POST", "/api/prints", { name: "Mia Lee", model_link: "https://www.thingiverse.com/thing:42" }); // date = today
check("adding returns the new id", a.ok && b.id > a.id && c.id > b.id, [a, b, c]);
const row = conn.get("SELECT * FROM print_queue WHERE id = ?", [a.id]);
check("a print is linked to its Ninja and uses the Ninja's name", row.ninja_uid && row.name === "Mia Lee", row);
check("promised date defaults to today", conn.get("SELECT promised_date FROM print_queue WHERE id = ?", [c.id]).promised_date === todayISO());

check("a Ninja is required", /Ninja/.test(await fails(call("POST", "/api/prints", { description: "x" }))));
check("something to print is required", /what to print/.test(await fails(call("POST", "/api/prints", { name: "Mia Lee" }))));
check("bad links are refused", /web address/.test(await fails(call("POST", "/api/prints", { name: "Mia Lee", model_link: "javascript:alert(1)" }))));
check("bad dates are refused", /real date/.test(await fails(call("POST", "/api/prints", { name: "Mia Lee", description: "x", promised_date: "2026-13-01" }))));
const big = Buffer.alloc(MAX_FILE_BYTES + 1).toString("base64");
check("files that are too big are refused, pointing at links",
  /paste the link/.test(await fails(call("POST", "/api/prints", { name: "Mia Lee", description: "x", file: { name: "big.stl", data: big } }))));

let list = await call("GET", "/api/prints");
check("queue is oldest promised first", same(list.queued.map((p) => p.id), [b.id, a.id, c.id]), list.queued);
check("positions count from 1 (up next)", same(list.queued.map((p) => p.position), [1, 2, 3]));
check("lists say a file is there without loading it",
  list.queued[1].has_file === true && list.queued[1].file_data === undefined && list.queued[1].file_size === 29 && list.queued[0].has_file === false, list.queued[1]);
check("lists show the prints owed on Rewards owed", list.queued[1].prints_owed === 2 && list.queued[0].prints_owed === 1);
check("days waited are counted", list.queued[0].waiting_days === daysBetween("2026-11-02", todayISO()));

const file = await call("GET", `/api/prints/${a.id}/file`);
check("the file comes back as saved", file.file_name === "dragon.stl" && Buffer.from(file.file_data, "base64").toString() === "solid dragon\nendsolid dragon\n");
check("no file -> clear error", /no file/.test(await fails(call("GET", `/api/prints/${b.id}/file`))));

// Editing: change the date and the description; the file stays unless replaced or removed.
await call("PUT", `/api/prints/${a.id}`, { name: "Mia Lee", description: "Dragon keychain (red)", model_link: "tinkercad.com/things/dragon", promised_date: "2026-11-01" });
list = await call("GET", "/api/prints");
check("an earlier promised date moves a print up the queue", same(list.queued.map((p) => p.id), [a.id, b.id, c.id]));
check("editing keeps the file", list.queued[0].has_file && list.queued[0].description === "Dragon keychain (red)");
await call("PUT", `/api/prints/${c.id}`, { model_link: "https://www.thingiverse.com/thing:43" });
check("editing without a date keeps the promised date",
  conn.get("SELECT promised_date, model_link FROM print_queue WHERE id = ?", [c.id]).model_link.endsWith("thing:43") &&
  conn.get("SELECT promised_date FROM print_queue WHERE id = ?", [c.id]).promised_date === todayISO());
check("removing the only thing to print is refused",
  /what to print/.test(await fails(call("PUT", `/api/prints/${c.id}`, { model_link: "" }))));

// Printing the top one: it leaves the queue, the next is up, and Rewards owed is untouched.
const done = await call("POST", `/api/prints/${a.id}/printed`, { printed_date: "2026-11-10" });
list = await call("GET", "/api/prints");
check("printed leaves the queue and the next one is up", list.queued[0].id === b.id && list.queued[0].position === 1, list.queued);
check("printed list keeps the printed date", list.printed.length === 1 && list.printed[0].printed_date === "2026-11-10");
check("just marking printed does not change prints owed", !done.recorded_given && (await printsOwed("Mia Lee")) === 2);
check("can't be printed twice", /already marked printed/.test(await fails(call("POST", `/api/prints/${a.id}/printed`, {}))));

// Ticking "record as given" adds one 3D Print to Rewards given.
const given = await call("POST", `/api/prints/${b.id}/printed`, { record_given: true });
check("record_given takes one print off what is owed", given.recorded_given && (await printsOwed("Sam Park")) === 0);
const receipt = conn.get("SELECT * FROM receipts WHERE reward_type = '3D Print' AND name = 'Sam Park'");
check("it is an ordinary Rewards given row", receipt && receipt.amount === 1 && receipt.entry_type === "Reward Given" && /Rocket/.test(receipt.details), receipt);
const sam2 = await call("POST", "/api/prints", { name: "Sam Park", description: "Another rocket", promised_date: "2026-11-03" });
check("record_given is refused when nothing is owed, and nothing changes",
  /no 3D prints owed/.test(await fails(call("POST", `/api/prints/${sam2.id}/printed`, { record_given: true }))) &&
  !conn.get("SELECT printed_date FROM print_queue WHERE id = ?", [sam2.id]).printed_date);

// Undo and delete.
await call("POST", `/api/prints/${a.id}/unprinted`);
list = await call("GET", "/api/prints");
check("unprinted goes back into the queue in date order", list.queued[0].id === a.id && !list.queued[0].printed_date);
await call("DELETE", `/api/prints/${sam2.id}`);
check("delete removes it", !conn.get("SELECT id FROM print_queue WHERE id = ?", [sam2.id]));

// The Ninja profile shows their prints, with their place in the whole queue.
const mia = await call("GET", "/api/ninjas/" + conn.get("SELECT uid FROM ninjas WHERE name = 'Mia Lee'").uid);
check("profile lists the Ninja's queued prints in queue order with positions",
  same(mia.prints.queued.map((p) => [p.id, p.position]), [[a.id, 1], [c.id, 2]]), mia.prints);
const sam = await call("GET", "/api/ninjas/" + conn.get("SELECT uid FROM ninjas WHERE name = 'Sam Park'").uid);
check("profile lists printed ones too", sam.prints.queued.length === 0 && sam.prints.printed.length === 1 && sam.prints.printed[0].id === b.id);

// Renaming the Ninja renames their prints.
const uid = conn.get("SELECT uid FROM ninjas WHERE name = 'Mia Lee'").uid;
const classes = conn.all("SELECT id, day, time_slot FROM active_ninjas WHERE ninja_uid = ?", [uid]);
await call("POST", "/api/active-ninjas/person", { uid, name: "Mia Lee-Wong", original_name: "Mia Lee", sessions: classes });
check("prints follow a renamed Ninja",
  conn.all("SELECT DISTINCT name FROM print_queue WHERE ninja_uid = ?", [uid]).map((r) => r.name).join() === "Mia Lee-Wong");

closeDatabase();
finish("print queue");
