// Totem tags show the first name and only the initial of the last name.
import { check, finish } from "./helpers.mjs";
import { tagName } from "../js/pdf/totem_tags.js";

check("first + last", tagName("Mia Lee") === "Mia L.", tagName("Mia Lee"));
check("two last names", tagName("Ethan Smith Doe") === "Ethan S. D.", tagName("Ethan Smith Doe"));
check("middle name becomes an initial too", tagName("Alex J Chen") === "Alex J. C.", tagName("Alex J Chen"));
check("extra spaces", tagName("  sam   park ") === "sam P.", tagName("  sam   park "));
check("already an initial", tagName("Kai S.") === "Kai S.", tagName("Kai S."));
check("hyphenated last name", tagName("Ava Smith-Jones") === "Ava S.-J.", tagName("Ava Smith-Jones"));
check("single name", tagName("Zoe") === "Zoe", tagName("Zoe"));
check("blank", tagName("   ") === "", tagName("   "));

// Belt list for printed tags: one row per Ninja with their current belt, paged when long.
const { openDatabase, closeDatabase } = await import("../js/core/db.js");
const { handleRequest } = await import("../js/api/index.js");
openDatabase(null);
await handleRequest("POST", "/api/active-ninjas/person", { name: "Ethan Smith Doe", belt: "Blue", sessions: [{ day: "Monday", time_slot: "4 PM" }] });
await handleRequest("POST", "/api/belts", { name: "Mia Lee", old_belt: "White", new_belt: "Yellow" });
const sheet = await handleRequest("POST", "/api/totem-tags/belt-sheet", { names: ["Ethan Smith Doe", "Mia Lee", "Nobody Here"] });
const doc = await globalThis.PDFLib.PDFDocument.load(sheet.bytes);
check("belt list PDF is made", sheet.count === 3 && doc.getPageCount() === 1 && sheet.filename === "Totem Tag Belts.pdf", sheet.count);
const many = await handleRequest("POST", "/api/totem-tags/belt-sheet", { names: Array.from({ length: 60 }, (_, i) => `Ninja ${i}`) });
check("a long belt list runs onto more pages", (await globalThis.PDFLib.PDFDocument.load(many.bytes)).getPageCount() > 1);
let refused = null;
try { await handleRequest("POST", "/api/totem-tags/belt-sheet", { names: [] }); } catch (e) { refused = e; }
check("empty belt list is refused", refused && refused.status === 400, refused && refused.message);
closeDatabase();

finish("totem tags");
