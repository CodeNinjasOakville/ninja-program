// Totem tags show the first name and only the initial of the last name.
import { check, finish } from "./helpers.mjs";
import { tagName } from "../js/pdf/totem_tags.js";

check("first + last", tagName("Mia Lee") === "Mia L.", tagName("Mia Lee"));
check("middle name kept", tagName("Jo Anne Rivera") === "Jo Anne R.", tagName("Jo Anne Rivera"));
check("extra spaces", tagName("  sam   park ") === "sam P.", tagName("  sam   park "));
check("already an initial", tagName("Kai S.") === "Kai S.", tagName("Kai S."));
check("hyphenated last name", tagName("Ava Smith-Jones") === "Ava S.", tagName("Ava Smith-Jones"));
check("single name", tagName("Zoe") === "Zoe", tagName("Zoe"));
check("blank", tagName("   ") === "", tagName("   "));

finish("totem tags");
