// Rewards by day: pick a weekday on the Rewards owed page to see everyone who comes in that day
// and what they are still owed (totals per reward type, and per Ninja).
import { check, finish } from "./helpers.mjs";
import { attendanceDays, rewardsForDay } from "../js/lib/rewards_by_day.js";
import { openDatabase, closeDatabase, conn } from "../js/core/db.js";
import { handleRequest } from "../js/api/index.js";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const owedRow = (name, bucks, prints = 0) => ({
  name, progression: "", ninja_bucks_remaining: bucks, large_coins_remaining: Math.floor(bucks / 10),
  small_coins_remaining: bucks % 10, prints_remaining: prints, certificates_remaining: prints, belts_remaining: prints,
});

// ---- the logic on its own
const classes = [
  { name: "Ann Bo", day: "Monday", time_slot: "4 PM - 5 PM", ninja_uid: "n-ann" },
  { name: "Ann Bo", day: "monday ", time_slot: "5 PM - 6 PM", ninja_uid: "n-ann" }, // two classes, one day
  { name: "Ann Bo", day: "Wednesday", time_slot: "4 PM - 5 PM", ninja_uid: "n-ann" },
  { name: "Cy Do", day: "Monday", time_slot: "4 PM - 5 PM", ninja_uid: "" },        // no Ninja record yet
  { name: "Eve Fu", day: "Monday", time_slot: "6 PM", ninja_uid: "n-eve" },         // nothing owed
  { name: "Gus Ho", day: "Tuesday", time_slot: "4 PM", ninja_uid: "n-gus" },
  { name: "Ivy Jo", day: "Holiday Camp", time_slot: "9 AM", ninja_uid: "n-ivy" },
  { name: "Nobody", day: "", time_slot: "", ninja_uid: "n-x" },
];
const rows = [owedRow("Ann Bo", 15, 3), owedRow("Cy Do", 5, 1), owedRow("Gus Ho", 10, 2), owedRow("Not Enrolled", 25, 5)];
const byName = (row, person) => row.name.toLowerCase() === person.name.toLowerCase();

const days = attendanceDays(classes, ["Monday", "Tuesday", "Wednesday", "Sunday"]);
check("days follow Settings order, then other day text; every Settings day is listed",
  same(days.map((d) => d.day), ["Monday", "Tuesday", "Wednesday", "Sunday", "Holiday Camp"]), days);
check("days count people, not classes (and ignore case/spaces in the day)",
  same(days.map((d) => d.ninjas), [3, 1, 1, 0, 1]), days);

const monday = rewardsForDay(classes, rows, "monday", byName);
check("everyone who comes in that day is listed, by name",
  same(monday.ninjas.map((n) => n.name), ["Ann Bo", "Cy Do", "Eve Fu"]), monday.ninjas);
check("each Ninja's class times that day are kept",
  same(monday.ninjas[0].time_slots, ["4 PM - 5 PM", "5 PM - 6 PM"]), monday.ninjas[0]);
check("a Ninja with nothing owed is listed with owed = null", monday.ninjas[2].owed === null, monday.ninjas[2]);
check("rows are just that day's Ninjas who are owed", same(monday.rows.map((r) => r.name), ["Ann Bo", "Cy Do"]), monday.rows);
check("attending and owed counts", monday.attending === 3 && monday.owed_count === 2, monday);
check("totals add up what that day's Ninjas are owed",
  same(monday.totals, { ninja_bucks: 20, large_coins: 1, small_coins: 10, prints: 4, certificates: 4, belts: 4 }), monday.totals);
check("the day's rows carry their class times", same(monday.rows[0].time_slots, ["4 PM - 5 PM", "5 PM - 6 PM"]));
check("the rows passed in are not changed", rows[0].time_slots === undefined);

const sunday = rewardsForDay(classes, rows, "Sunday", byName);
check("a day with no classes is empty", sunday.attending === 0 && sunday.rows.length === 0 && sunday.totals.ninja_bucks === 0, sunday);

// ---- the route, against a real database (names matched the way belts are)
openDatabase(null);
const call = (method, url, body) => handleRequest(method, url, body);
conn.run("INSERT INTO active_ninjas (name, day, time_slot) VALUES ('Mia Lee', 'Monday', '4 PM - 5 PM')");
conn.run("INSERT INTO active_ninjas (name, day, time_slot) VALUES ('Mia Lee', 'Wednesday', '5 PM - 6 PM')");
conn.run("INSERT INTO active_ninjas (name, day, time_slot) VALUES ('Leo Kim', 'Monday', '5 PM - 6 PM')");
conn.run("INSERT INTO active_ninjas (name, day, time_slot) VALUES ('Sam Park', 'Tuesday', '4 PM - 5 PM')");
conn.run("INSERT INTO active_ninjas (name, day, time_slot) VALUES ('Zoe Ray', 'Monday', '4 PM - 5 PM')");
conn.run("INSERT INTO active_ninjas (name, day, time_slot) VALUES ('Alex Chen', 'Monday', '6 PM - 7 PM')");
conn.run("INSERT INTO belt_entries (name, old_belt, new_belt) VALUES ('Mia Lee', 'White', 'Yellow')");     // 1 level
conn.run("INSERT INTO belt_entries (name, old_belt, new_belt) VALUES ('leo  KIM', 'White', 'Green')");    // 3 levels
conn.run("INSERT INTO belt_entries (name, old_belt, new_belt) VALUES ('Sam Park', 'White', 'Orange')");   // 2 levels
conn.run("INSERT INTO belt_entries (name, old_belt, new_belt) VALUES ('Alex J. Chen', 'White', 'Yellow')"); // first + last
conn.run("INSERT INTO belt_entries (name, old_belt, new_belt) VALUES ('Old Student', 'White', 'Orange')"); // no classes
conn.run("INSERT INTO receipts (date, name, reward_type, amount) VALUES ('2026-10-01', 'Mia Lee', 'Ninja Bucks', 5)");

const plain = await call("GET", "/api/rewards/by-day");
check("no day: just the day list", same(Object.keys(plain), ["days"]) && plain.days[0].day === "Monday" && plain.days[0].ninjas === 4, plain);

const mon = await call("GET", "/api/rewards/by-day?day=Monday");
check("Monday lists everyone who comes in on Monday",
  same(mon.ninjas.map((n) => n.name), ["Alex Chen", "Leo Kim", "Mia Lee", "Zoe Ray"]), mon.ninjas);
check("Zoe (no belt-ups) is listed with nothing owed", mon.ninjas.find((n) => n.name === "Zoe Ray").owed === null);
check("Leo matches his Belt-ups entry despite case/spacing", !!mon.ninjas.find((n) => n.name === "Leo Kim").owed);
check("Alex matches 'Alex J. Chen' on first + last name", !!mon.ninjas.find((n) => n.name === "Alex Chen").owed);
check("Monday owed: Alex, Leo and Mia (Mia still owed her print/certificate/belt)", mon.owed_count === 3 && mon.rows.length === 3, mon.rows);
check("Monday totals match the Rewards owed rows",
  same(mon.totals, { ninja_bucks: 20, large_coins: 1, small_coins: 10, prints: 5, certificates: 5, belts: 5 }), mon.totals);

const summary = await call("GET", "/api/rewards/summary");
const fields = ["ninja_bucks", "large_coins", "small_coins", "prints", "certificates", "belts"];
const all = (await Promise.all(["Monday", "Tuesday", "Wednesday"].map((d) => call("GET", `/api/rewards/by-day?day=${d}`))));
const mondayNames = new Set(mon.rows.map((r) => r.name));
const sameAsSummary = mon.rows.every((r) => {
  const s = summary.rows.find((x) => x.name === r.name);
  return s && fields.every((f) => s[`${f}_remaining`] === r[`${f}_remaining`]);
});
check("each Ninja's owed amounts are exactly their Rewards owed row", sameAsSummary, { mon: mon.rows, summary: summary.rows });
check("someone with no classes is on no day", all.every((d) => !d.rows.some((r) => r.name === "Old Student")) && !mondayNames.has("Old Student"));
check("Tuesday is just Sam", same(all[1].rows.map((r) => r.name), ["Sam Park"]) && all[1].totals.ninja_bucks === 10, all[1]);
check("Wednesday is just Mia, with her Wednesday time", same(all[2].rows.map((r) => r.time_slots), [["5 PM - 6 PM"]]), all[2]);
check("the plain Rewards owed list is unchanged", summary.rows.length === 5 && !("time_slots" in summary.rows[0]), summary.rows);
closeDatabase();

finish("Rewards by day");
