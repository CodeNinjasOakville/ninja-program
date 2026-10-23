// How the Belts tab and the Active Ninjas tab share belts.
//  - A Ninja's belt on the Active Ninjas tab always wins. The Belts tab never changes it.
//  - An Active Ninja with no belt gets the "new belt" of their latest Belts-tab entry.
//  - Names match ignoring case and spacing, or on first + last name ("Alex J. Chen" = "Alex Chen").
//  - When a Belts-tab name could be more than one Active Ninja, nothing is filled until someone
//    picks which one. The answer is kept in the "belt_name_links" setting so it is asked only once.

import { getSetting } from "../core/db.js";
import { formatBeltName, normalizeBelt } from "./rewards.js";

export const LINKS_SETTING = "belt_name_links";

const words = (name) => String(name || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
export const nameKey = (name) => words(name).join(" ");
// One-word names have no last name to compare, so they only ever match exactly.
function firstLastKey(name) {
  const w = words(name).map((x) => x.replace(/\.$/, ""));
  return w.length >= 2 ? `${w[0]} ${w[w.length - 1]}` : "";
}

/** nameKey -> {name, belt} for everyone on the Active Ninjas tab (belt "" when not set). */
export function activePeople(conn) {
  const people = new Map();
  for (const row of conn.all("SELECT name, belt FROM active_ninjas ORDER BY id")) {
    const key = nameKey(row.name);
    if (!key) continue;
    if (!people.has(key)) people.set(key, { name: String(row.name).trim(), belt: "" });
    const person = people.get(key);
    if (!person.belt && String(row.belt || "").trim()) person.belt = String(row.belt).trim();
  }
  return people;
}

/** Puts `belt` on every session row of that Ninja (a belt belongs to the person, not a class). */
export function setPersonBelt(conn, name, belt) {
  const key = nameKey(name);
  for (const row of conn.all("SELECT id, name FROM active_ninjas")) {
    if (nameKey(row.name) === key) conn.run("UPDATE active_ninjas SET belt = ? WHERE id = ?", [belt, row.id]);
  }
}

/** nameKey -> {name, belt} from each name's latest Belts-tab entry that has a new belt. */
function beltTabPeople(conn) {
  const people = new Map();
  for (const row of conn.all("SELECT name, new_belt FROM belt_entries ORDER BY id")) {
    const key = nameKey(row.name);
    const belt = normalizeBelt(row.new_belt);
    if (key && belt) people.set(key, { name: String(row.name).trim(), belt: formatBeltName(belt) });
  }
  return people;
}

/**
 * Works out which Active Ninja each Belts-tab name belongs to.
 * Returns {links: Map(beltKey -> activeKey), questions: [...], active, beltTab}.
 * A question is a Belts-tab name with several possible Ninjas and no saved answer yet.
 */
export function matchBelts(conn) {
  const active = activePeople(conn);
  const beltTab = beltTabPeople(conn);
  const saved = getSetting(LINKS_SETTING, {}) || {};

  const byFirstLast = new Map();
  for (const key of active.keys()) {
    const fl = firstLastKey(key);
    if (fl) byFirstLast.set(fl, [...(byFirstLast.get(fl) || []), key]);
  }

  const links = new Map();
  const open = new Map(); // beltKey -> candidate active keys
  const loose = [];       // beltKeys matched only on first + last name
  for (const [beltKey] of beltTab) {
    const answer = saved[beltKey];
    if (answer === "") continue; // "none of these"
    if (answer && active.has(answer)) { links.set(beltKey, answer); continue; }

    if (active.has(beltKey)) { links.set(beltKey, beltKey); continue; }
    const candidates = byFirstLast.get(firstLastKey(beltKey)) || [];
    if (candidates.length === 1) { links.set(beltKey, candidates[0]); loose.push(beltKey); }
    else if (candidates.length > 1) open.set(beltKey, candidates);
  }

  // Two Belts-tab names landing on the same Ninja through a loose match ("Alex Chen" and
  // "Alex J Chen" -> Alex Chen): the loose one may be a different child, so ask about it.
  const claims = {};
  for (const target of links.values()) claims[target] = (claims[target] || 0) + 1;
  for (const beltKey of loose) {
    const target = links.get(beltKey);
    if (claims[target] > 1 && saved[beltKey] !== target) { links.delete(beltKey); open.set(beltKey, [target]); }
  }

  // Only ask when the answer could fill in a belt.
  const questions = [];
  for (const [beltKey, candidates] of open) {
    if (!candidates.some((key) => !active.get(key).belt)) continue;
    const from = beltTab.get(beltKey);
    questions.push({
      belt_name: from.name,
      belt: from.belt,
      candidates: candidates.map((key) => ({ name: active.get(key).name, belt: active.get(key).belt })),
    });
  }
  questions.sort((a, b) => a.belt_name.localeCompare(b.belt_name));
  return { links, questions, active, beltTab };
}

/** Fills in blank Active Ninja belts from the Belts tab. Returns [{name, belt, from}] that changed. */
export function fillMissingBelts(conn) {
  const { links, active, beltTab } = matchBelts(conn);
  const filled = [];
  for (const [beltKey, activeKey] of links) {
    const person = active.get(activeKey);
    if (person.belt) continue; // never overwrite a belt set on the Active Ninjas tab
    const from = beltTab.get(beltKey);
    setPersonBelt(conn, person.name, from.belt);
    person.belt = from.belt;
    filled.push({ name: person.name, belt: from.belt, from: from.name });
  }
  return filled;
}

/** The belt a name is on now: their Active Ninjas belt if they have one, else the Belts tab. */
export function currentBeltLookup(conn) {
  const { links, active, beltTab } = matchBelts(conn);
  return (name) => {
    const key = nameKey(name);
    const own = active.get(key);
    if (own && own.belt) return own.belt;
    const linked = links.has(key) ? active.get(links.get(key)) : null;
    if (linked && linked.belt) return linked.belt;
    return beltTab.has(key) ? beltTab.get(key).belt : "";
  };
}
