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

finish("totem tags");
