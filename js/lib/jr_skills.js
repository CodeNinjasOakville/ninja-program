// JR skills checklist: what each JR Ninja is working on, has got, and needs to work on.
//
// The skills are a Settings list ("JR skills checklist"), one per line:
//     Area: Skill | words to look for in notes
// e.g. "Reading: Reading comprehension | comprehension". A word ending in * also matches longer
// words (count* -> counting); a word starting with - means "not when the note says this"
// (so "reading comprehension" counts for Reading comprehension, not plain Reading).
//
// Each skill's status comes from a sensei (set by hand on the checklist, always wins) or, if no
// one has set it, is suggested from the JR notes: the newest note that mentions the skill decides,
// read with the simple word rules in noteStatus() below. Nothing leaves the browser.

export const STATUSES = ["working", "needs_work", "done"];
export const STATUS_LABELS = { working: "Working on", needs_work: "Needs work", done: "Got it" };

export const DEFAULT_JR_SKILLS = [
  "Coding: CodeSpark | codespark, code spark",
  "Coding: MakeCode Arcade | makecode, make code",
  "Coding: MakeCode missions & skill maps | mission*, skill map*",
  "Coding: Circuits | circuit*",
  "Coding: Conditionals (if / else) | conditional*, if statement*, if/else",
  "Coding: Loops | loop*",
  "Coding: Explaining their work | explain*",
  "Reading: Reading | read, reads, reading, reader, book*, -comprehension, -out loud, -aloud, -confiden*",
  "Reading: Reading out loud with confidence | out loud, aloud, confiden*",
  "Reading: Reading comprehension | comprehension",
  "Math: Counting | count*",
  "Math: Addition & subtraction | addition, adding, subtract*, arithmetic",
  "Math: Odd & even numbers | odd number*, even number*, odd and even",
  "Other: Plugo | plugo",
  "Other: Working independently | independen*",
  "Other: Positive mindset | mindset",
  "Other: Ready for IMPACT | impact",
];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function wordRegex(word) {
  const prefix = word.endsWith("*");
  const core = escape(word.replace(/\*$/, "")).replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])${core}${prefix ? "" : "(?![a-z0-9])"}`, "i");
}

/** One Settings line -> {label, area, skill, match: [RegExp], skip: [RegExp]}, or null for a blank line. */
export function parseSkill(line) {
  const [left, words = ""] = String(line || "").split("|");
  const text = left.trim();
  if (!text) return null;
  const colon = text.indexOf(":");
  const area = colon > 0 ? text.slice(0, colon).trim() : "Other";
  const skill = colon > 0 ? text.slice(colon + 1).trim() : text;
  if (!skill) return null;
  const list = words.split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);
  const match = list.filter((w) => !w.startsWith("-")).map(wordRegex);
  if (!match.length) match.push(wordRegex(skill.toLowerCase())); // no words given: look for the skill's own name
  return { label: skill, area, skill, match, skip: list.filter((w) => w.startsWith("-")).map((w) => wordRegex(w.slice(1))) };
}

export const parseSkills = (lines) => (lines || []).map(parseSkill).filter(Boolean);

/**
 * A note in short pieces: sentences (also when the full stop has no space after it, as in
 * "amazing job!Next"), then split where the meaning can turn: "but", ";", "so", "since", commas
 * (except before "such as" / "like" / "especially" / "including"), and "and" before a new action
 * ("worked on X and completed Y").
 */
const ACTION = "(?:also\\s+)?(?:completed|finished|did|does|worked|read|reads|knows|can|is|was|ended|struggles|needs|likes|spent)";
const SPLIT = new RegExp(
  ";|,?\\s+but\\s+|,?\\s+since\\s+|,?\\s+so\\s+(?=\\w)|,(?!\\s*(?:such as|like\\b|especially|including))\\s*|\\s+and\\s+(?=" + ACTION + "\\b)", "i");
export function notePhrases(text) {
  return String(text || "")
    .replace(/([.!?])(?=[A-Z])/g, "$1 ")
    .split(/(?<=[.!?])\s+|\n+/)
    .flatMap((s) => s.split(SPLIT))
    .filter((s) => typeof s === "string")
    .map((s) => s.trim())
    .filter((s) => s && !/^(also|and)$/i.test(s));
}

// The word rules, checked in this order.
const NO_NEED = /\b(doesn'?t|does not|don'?t|do not|no)\s+(really\s+)?need\b/i;
const KEEP_GOING = /\bkeep\s+(up|having|going|working)\b|\b(almost|nearly|halfway|started|starting|worked on finishing)\b/i;
const NEEDS = /\b(needs?|struggl\w*|recommend\w*|encourage\w*|make sure|push for|more confiden\w*|not (yet|comfortable|confident)|doesn'?t feel|trouble|difficult\w*|hard time|help with|some help|work on|practi[cs]e more)\b/i;
const GOT_IT = /\b(finished|completed?|knows?|mastered|able to|can (do|read|count|add|subtract|explain|code)|reads? (it |them )?(very |really )?well|really good|very good|good at|understands?|ready for|moving (him|her|them) to|move (him|her|them) (up|to))\b/i;

/** What one phrase says about a skill it mentions: "done", "needs_work" or "working". */
export function noteStatus(phrase) {
  if (NO_NEED.test(phrase)) return "done";
  if (KEEP_GOING.test(phrase)) return "working";
  if (NEEDS.test(phrase)) return "needs_work";
  if (GOT_IT.test(phrase) || /\bthink about moving\b/i.test(phrase)) return "done";
  return "working";
}

const mentions = (skill, phrase) => skill.match.some((r) => r.test(phrase)) && !skill.skip.some((r) => r.test(phrase));
// Within one note a skill can come up more than once; the most telling word wins.
const WEIGHT = { needs_work: 3, done: 2, working: 1 };

/**
 * What the notes say about each skill: Map(label -> {status, phrase, note_id, date}).
 * notes: newest first (as the JR notes list is). The newest note that mentions a skill decides.
 */
export function skillsFromNotes(notes, skills) {
  const found = new Map();
  for (const note of notes || []) {
    for (const skill of skills) {
      if (found.has(skill.label)) continue;
      let best = null;
      for (const phrase of notePhrases(note.note)) {
        if (!mentions(skill, phrase)) continue;
        const status = noteStatus(phrase);
        if (!best || WEIGHT[status] > WEIGHT[best.status]) best = { status, phrase };
      }
      if (best) found.set(skill.label, { ...best, note_id: note.id, date: String(note.created_at || "") });
    }
  }
  return found;
}

/**
 * The checklist for one Ninja: every skill, in Settings order, with
 * {area, skill, status ("" = nothing yet), source ("sensei" | "notes" | ""), from_notes, set_by, set_on}.
 * set: rows a sensei saved (jr_skills table) for this Ninja; they win over the notes.
 */
export function buildChecklist(skills, notes, set) {
  const fromNotes = skillsFromNotes(notes, skills);
  const bySkill = new Map((set || []).map((r) => [String(r.skill).toLowerCase(), r]));
  return skills.map((s) => {
    const mine = bySkill.get(s.label.toLowerCase());
    const auto = fromNotes.get(s.label) || null;
    const manual = mine && STATUSES.includes(mine.status) ? mine : null;
    return {
      area: s.area, skill: s.label,
      status: manual ? manual.status : auto ? auto.status : "",
      source: manual ? "sensei" : auto ? "notes" : "",
      from_notes: auto,
      set_by: manual ? manual.author || "" : "", set_on: manual ? String(manual.created_at || "") : "",
    };
  });
}

/** {working: [skill names], needs_work: [...], done: [...]} for the one-line summary. */
export function summarize(checklist) {
  const out = { working: [], needs_work: [], done: [] };
  for (const item of checklist) if (out[item.status]) out[item.status].push(item.skill);
  return out;
}
