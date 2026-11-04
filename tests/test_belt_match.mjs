// Active Ninjas <-> Belts tab: the Belts tab is the belt-up log - a higher belt there moves the Ninja
// up, never down; blanks are filled; a name that could be more than one Ninja waits for someone to choose.
import { check, finish } from "./helpers.mjs";
import { openDatabase, closeDatabase, conn } from "../js/core/db.js";
import { handleRequest } from "../js/api/index.js";

const call = (method, url, body) => handleRequest(method, url, body);
const beltOf = (name) => {
  const rows = conn.all("SELECT belt FROM active_ninjas WHERE name = ?", [name]);
  return rows.length ? rows.map((r) => r.belt) : null;
};

openDatabase(null);

// Roster: Mia has a belt already, the rest do not. Two different "Alex ... Chen"s.
await call("POST", "/api/active-ninjas/person", { name: "Mia Lee", belt: "Blue", sessions: [{ day: "Monday", time_slot: "4 PM" }] });
await call("POST", "/api/active-ninjas/person", { name: "Sam Park", sessions: [{ day: "Monday", time_slot: "4 PM" }, { day: "Friday", time_slot: "5 PM" }] });
await call("POST", "/api/active-ninjas/person", { name: "Jo Rivera", sessions: [{ day: "Tuesday", time_slot: "4 PM" }] });
await call("POST", "/api/active-ninjas/person", { name: "Alex J Chen", sessions: [{ day: "Tuesday", time_slot: "5 PM" }] });
await call("POST", "/api/active-ninjas/person", { name: "Alex M Chen", sessions: [{ day: "Wednesday", time_slot: "5 PM" }] });

await call("POST", "/api/belts/bulk", { text: [
  "Mia Lee|White|Yellow",          // lower than Mia's Active belt (Blue): she keeps Blue
  "sam  park|White|Yellow",
  "Sam Park|Yellow|Orange",        // latest entry -> Orange, on both of Sam's classes
  "Jo Anne Rivera||Green",         // first + last name match -> Jo Rivera
  "Alex Chen||Purple",             // could be either Alex -> ask
].join("\n") });

let result = await call("POST", "/api/active-ninjas/belt-matches", {});
check("a lower Belts entry never moves a belt down", JSON.stringify(beltOf("Mia Lee")) === '["Blue"]', beltOf("Mia Lee"));
check("blank belt filled from latest Belts entry, on every class", JSON.stringify(beltOf("Sam Park")) === '["Orange","Orange"]', beltOf("Sam Park"));
check("first + last name match fills", JSON.stringify(beltOf("Jo Rivera")) === '["Green"]', beltOf("Jo Rivera"));
check("ambiguous name fills nobody", beltOf("Alex J Chen")[0] === "" && beltOf("Alex M Chen")[0] === "");
check("ambiguous name becomes one question", result.questions.length === 1 && result.questions[0].belt_name === "Alex Chen" &&
  result.questions[0].candidates.map((c) => c.name).sort().join(",") === "Alex J Chen,Alex M Chen", result.questions);
check("filled list reports changes", result.filled.map((f) => f.name).sort().join(",") === "Jo Rivera,Sam Park", result.filled);

// A belt-up logged on the Belts tab later moves the Ninja up straight away.
const added = await call("POST", "/api/belts", { name: "Sam Park", old_belt: "Orange", new_belt: "Green" });
check("later belt-up on the Belts tab moves the Ninja up", JSON.stringify(beltOf("Sam Park")) === '["Green","Green"]', beltOf("Sam Park"));
check("the Belts tab says whose belt changed", added.beltsUpdated.length === 1 && added.beltsUpdated[0].was === "Orange", added);
result = await call("POST", "/api/active-ninjas/belt-matches", {});
check("nothing new to fill", result.filled.length === 0);
await call("POST", "/api/belts", { name: "Sam Park", old_belt: "Green", new_belt: "Yellow" });
check("a lower later entry doesn't move them down", beltOf("Sam Park")[0] === "Green");

// Totem tags / current belt: Active belt first, Belts tab for anyone else.
const current = await call("POST", "/api/belts/current", { names: ["Mia Lee", "Jo Anne Rivera", "Alex Chen", "Nobody"] });
check("current belt prefers Active Ninjas", current.map((c) => c.belt).join(",") === "Blue,Green,Purple,", current);

// The user picks which Alex.
result = await call("POST", "/api/active-ninjas/belt-matches", { choices: { "Alex Chen": "Alex M Chen" } });
check("choice fills that Ninja", beltOf("Alex M Chen")[0] === "Purple" && beltOf("Alex J Chen")[0] === "");
check("choice is remembered", result.questions.length === 0, result.questions);

// "None of these" is remembered too.
await call("POST", "/api/active-ninjas/person", { name: "Kai B Ito", sessions: [{ day: "Monday", time_slot: "6 PM" }] });
await call("POST", "/api/active-ninjas/person", { name: "Kai T Ito", sessions: [{ day: "Monday", time_slot: "6 PM" }] });
await call("POST", "/api/belts", { name: "Kai Ito", old_belt: "", new_belt: "Red" });
result = await call("POST", "/api/active-ninjas/belt-matches", {});
check("second ambiguous name asked", result.questions.length === 1 && result.questions[0].belt_name === "Kai Ito");
result = await call("POST", "/api/active-ninjas/belt-matches", { choices: { "Kai Ito": "" } });
check("none of these: not asked again", result.questions.length === 0 && beltOf("Kai B Ito")[0] === "" && beltOf("Kai T Ito")[0] === "");

// Editing a Ninja keeps their belt unless a new one is sent; new classes inherit it.
await call("POST", "/api/active-ninjas/bulk", { text: "Jo Rivera|Thursday|4 PM" });
check("new class inherits belt", JSON.stringify(beltOf("Jo Rivera")) === '["Green","Green"]', beltOf("Jo Rivera"));
const jo = await call("GET", "/api/active-ninjas/person?name=Jo%20Rivera");
await call("POST", "/api/active-ninjas/person", { name: "Jo Rivera", original_name: "Jo Rivera", sessions: jo.map((r) => ({ id: r.id, day: r.day, time_slot: r.time_slot })) });
check("save without belt keeps it", JSON.stringify(beltOf("Jo Rivera")) === '["Green","Green"]', beltOf("Jo Rivera"));
await call("POST", "/api/active-ninjas/person", { name: "Jo Rivera", original_name: "Jo Rivera", belt: "Blue", sessions: jo.map((r) => ({ id: r.id, day: r.day, time_slot: r.time_slot })) });
check("belt edited on Active Ninjas", JSON.stringify(beltOf("Jo Rivera")) === '["Blue","Blue"]', beltOf("Jo Rivera"));
const joUps = () => conn.all("SELECT old_belt, new_belt FROM belt_entries WHERE name = 'Jo Rivera'");
check("raising a belt in the edit window records the belt-up", joUps().some((e) => e.old_belt === "Green" && e.new_belt === "Blue"), joUps());
await call("POST", "/api/active-ninjas/person", { name: "Jo Rivera", original_name: "Jo Rivera", belt: "Purple", belt_up: false, sessions: jo.map((r) => ({ id: r.id, day: r.day, time_slot: r.time_slot })) });
check("a correction (belt_up: false) records nothing", beltOf("Jo Rivera")[0] === "Purple" && !joUps().some((e) => e.new_belt === "Purple"), joUps());
await call("POST", "/api/active-ninjas/person", { name: "Jo Rivera", original_name: "Jo Rivera", belt: "Yellow", sessions: jo.map((r) => ({ id: r.id, day: r.day, time_slot: r.time_slot })) });
check("lowering a belt records nothing", beltOf("Jo Rivera")[0] === "Yellow" && !joUps().some((e) => e.new_belt === "Yellow"), joUps());

// A Ninja whose belt is cleared on the Active Ninjas tab gets it back from the Belts tab.
await call("POST", "/api/active-ninjas/person", { name: "Jo Rivera", original_name: "Jo Rivera", belt: "", sessions: jo.map((r) => ({ id: r.id, day: r.day, time_slot: r.time_slot })) });
await call("POST", "/api/active-ninjas/belt-matches", {});
check("cleared belt refilled from the latest belt-up", beltOf("Jo Rivera")[0] === "Blue", beltOf("Jo Rivera"));

// The "Fill in belts" window: a first belt is a starting belt (no rewards).
const kai = conn.get("SELECT ninja_uid FROM active_ninjas WHERE name = 'Kai B Ito'").ninja_uid;
const fillResult = await call("POST", "/api/ninjas/belts", { belts: [{ uid: kai, belt: "Orange" }] });
check("fill in a missing belt", beltOf("Kai B Ito")[0] === "Orange" && fillResult.startingBelts === 1, fillResult);
check("recorded as a starting belt", JSON.stringify(conn.all("SELECT old_belt, new_belt FROM belt_entries WHERE ninja_uid = ?", [kai])) === JSON.stringify([{ old_belt: "", new_belt: "Orange" }]));

closeDatabase();
finish("belt matching");
