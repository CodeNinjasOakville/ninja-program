// JR skills checklist: suggested from the JR notes, set by hand by a sensei (which wins).
import { check, finish } from "./helpers.mjs";
import { openDatabase, closeDatabase, conn } from "../js/core/db.js";
import { handleRequest } from "../js/api/index.js";
import {
  DEFAULT_JR_SKILLS, buildChecklist, noteStatus, notePhrases, parseSkill, parseSkills, skillsFromNotes, summarize,
} from "../js/lib/jr_skills.js";

const call = (method, url, body) => handleRequest(method, url, body);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const skills = parseSkills(DEFAULT_JR_SKILLS);
const notes = (...texts) => texts.map((note, i) => ({ id: i + 1, note, created_at: `2026-11-${String(20 - i).padStart(2, "0")} 18:00:00` }));
const summaryOf = (...texts) => summarize(buildChecklist(skills, notes(...texts), []));

// ---- reading the Settings lines
const s = parseSkill("Math: Telling time | clock*, o'clock, -alarm");
check("a Settings line gives area, skill, words and not-words", s.area === "Math" && s.skill === "Telling time" && s.match.length === 2 && s.skip.length === 1);
check("word* matches longer words, plain words only whole words",
  s.match[0].test("used the clocks") && !parseSkill("X: Read | read").match[0].test("ready for impact"));
check("a line with no words looks for the skill's name", parseSkill("Typing").match[0].test("practised typing") && parseSkill("Typing").area === "Other");
check("blank lines are skipped", parseSkills(["", "  ", "Coding: Loops | loop*"]).length === 1);

// ---- splitting a note
check("run-together sentences are split", same(notePhrases("Great job!Next time read more."), ["Great job!", "Next time read more."]));
check("'but' and 'so' split a sentence", notePhrases("Can read well so doesn't need reading").length === 2 && notePhrases("Fast but struggles with loops").length === 2);
check("'such as' stays with what it explains", notePhrases("struggles with new ideas, such as conditionals").length === 1);
check("'and' before a new action splits", same(notePhrases("worked on codespark and completed a mission"), ["worked on codespark", "completed a mission"]));

// ---- the word rules
check("needs work", ["Needs some help reading", "struggles with conditionals", "I would recommend more reading out loud",
  "make sure to test reading comprehension", "doesn't feel comfortable reading out loud"].every((p) => noteStatus(p) === "needs_work"));
check("got it", ["finished all the CodeSpark puzzles", "can do addition", "knows what odd numbers are", "was able to read it well",
  "doesn't really need to do reading", "think about moving her to impact"].every((p) => noteStatus(p) === "done"));
check("working on", ["We worked on codespark", "almost finished all the puzzles", "worked on finishing world 3",
  "keep having a positive mindset", "ended with plugo"].every((p) => noteStatus(p) === "working"));

// ---- whole notes, like the senseis write them
let sum = summaryOf("Had a great session today! We worked on CodeSpark and did MakeCode Arcade. After that, as usual we ended with reading and plugo. " +
  "Only thing I would recommend is to become more confident while reading, since currently doesn't feel comfortable reading out loud. Otherwise, doing an amazing job!");
check("worked-on things and a recommendation", same(sum.needs_work, ["Reading out loud with confidence"]) &&
  ["CodeSpark", "MakeCode Arcade", "Reading", "Plugo"].every((x) => sum.working.includes(x)), sum);

sum = summaryOf("make code arcade, likes to do plugo counting, can do addition and subtraction and knows what odd numbers are. " +
  "can read very well so doesn't really need to do reading. think about moving her to impact");
check("a list of what they can do", ["Addition & subtraction", "Odd & even numbers", "Reading", "Ready for IMPACT"].every((x) => sum.done.includes(x)) &&
  sum.working.includes("Counting") && !sum.needs_work.length, sum);

sum = summaryOf("General split between CodeSpark and MakeCode. Moving quickly through the curriculum but struggles a bit with newer concepts, such as conditionals.",
  "Tested reading comprehension. Next session, make sure to ask them to explain the work they did.");
check("struggles + 'such as' marks that skill", sum.needs_work.includes("Conditionals (if / else)"), sum);
check("older notes count for skills the newer ones don't mention", sum.needs_work.includes("Explaining their work"), sum);
check("reading comprehension is its own skill, not plain Reading", !sum.working.includes("Reading") && !sum.done.includes("Reading") && !sum.needs_work.includes("Reading"), sum);

const found = skillsFromNotes(notes("Finished all the Code Spark puzzles today.", "Almost finished the CodeSpark puzzles. Needs some help reading."), skills);
check("the newest note that mentions a skill decides", found.get("CodeSpark").status === "done" && found.get("CodeSpark").note_id === 1);
check("the phrase and note date are kept as the reason", found.get("Reading").phrase === "Needs some help reading." && found.get("Reading").date.startsWith("2026-11-19"));

// ---- through the app
openDatabase(null);
await call("POST", "/api/active-ninjas/person", { name: "Kai Moss", sessions: [{ day: "Saturday", time_slot: "10 AM", is_jr: true }] });
await call("POST", "/api/jr-notes", { name: "Kai Moss", note: "Worked on CodeSpark. Needs some help reading.", author: "Sensei A" });
const kai = () => call("GET", "/api/jr-ninjas").then((list) => list.find((p) => p.name === "Kai Moss"));
let person = await kai();
const item = (p, skill) => p.skills.find((x) => x.skill === skill);
check("JR list has each Ninja's checklist in Settings order", person.skills.length === skills.length && person.skills[0].skill === "CodeSpark");
check("suggested from the notes", item(person, "Reading").status === "needs_work" && item(person, "Reading").source === "notes" &&
  same(person.summary.needs_work, ["Reading"]) && same(person.summary.working, ["CodeSpark"]), person.summary);

await call("PUT", "/api/jr-skills", { name: "Kai Moss", skill: "Reading", status: "done", author: "Sensei B" });
person = await kai();
check("a sensei's choice wins over the notes", item(person, "Reading").status === "done" && item(person, "Reading").source === "sensei" &&
  item(person, "Reading").set_by === "Sensei B" && item(person, "Reading").from_notes.status === "needs_work");
await call("PUT", "/api/jr-skills", { name: "kai moss", skill: "reading", status: "working" });
check("setting it again replaces, never duplicates", conn.all("SELECT * FROM jr_skills").length === 1 && (await kai()).summary.working.includes("Reading"));
await call("PUT", "/api/jr-skills", { name: "Kai Moss", skill: "Loops", status: "needs_work" });
check("skills no note mentions can be set by hand", (await kai()).summary.needs_work.includes("Loops"));
await call("PUT", "/api/jr-skills", { name: "Kai Moss", skill: "Reading", status: "" });
person = await kai();
check("clearing goes back to the notes", item(person, "Reading").status === "needs_work" && item(person, "Reading").source === "notes");
let err = null; try { await call("PUT", "/api/jr-skills", { name: "Kai Moss", skill: "Reading", status: "great" }); } catch (e) { err = e.message; }
check("unknown statuses are refused", /Unknown status/.test(err || ""));

await call("PUT", "/api/settings/jr_skills", { values: ["Coding: Loops | loop*", "Life: Tidying up | tidy*"] });
await call("POST", "/api/jr-notes", { name: "Kai Moss", note: "Needs to tidy up after class.", author: "Sensei A" });
person = await kai();
check("the skills come from Settings", same(person.skills.map((x) => x.skill), ["Loops", "Tidying up"]) &&
  item(person, "Tidying up").status === "needs_work" && item(person, "Loops").source === "sensei", person.skills);

const uid = conn.get("SELECT uid FROM ninjas WHERE name = 'Kai Moss'").uid;
const profile = await call("GET", "/api/ninjas/" + uid);
check("the Ninja profile has the JR skills summary", same(profile.jr.summary.needs_work, ["Loops", "Tidying up"]), profile.jr.summary);

closeDatabase();
finish("JR skills checklist");
