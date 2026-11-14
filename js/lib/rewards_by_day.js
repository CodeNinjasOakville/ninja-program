// Rewards owed, by the day of the week a Ninja comes in.
//
//  Which day(s) a Ninja attends comes from their classes on the Ninjas page (active_ninjas.day).
//  What they are owed comes from the Rewards owed list (getSummary in ./rewards.js), which is
//  keyed by the name on the Belt-ups list. The two are matched the same way belts are:
//  the same Ninja record (ninja_uid), the same name ignoring case/spacing, or a saved / first+last
//  name link from ./belt_match.js.

import { getSetting } from "../core/db.js";
import { getSummary } from "./rewards.js";
import { matchBelts, nameKey } from "./belt_match.js";
import { lowerCompare } from "./util.js";

// Per-Ninja columns of the Rewards owed list, and the reward type each one totals into.
export const OWED_COLUMNS = {
  ninja_bucks_remaining: "ninja_bucks",
  large_coins_remaining: "large_coins",
  small_coins_remaining: "small_coins",
  prints_remaining: "prints",
  certificates_remaining: "certificates",
  belts_remaining: "belts",
};

const dayKey = (day) => String(day || "").trim().toLowerCase();

/**
 * The days that have classes, as [{day, ninjas}]: the Settings days in order (every one, even
 * with no classes), then any other day text found on a class. `ninjas` counts people, not classes.
 */
export function attendanceDays(classes, scheduleDays) {
  const people = new Map(); // dayKey -> Set of person keys
  const spelling = new Map(); // dayKey -> day as first written
  for (const c of classes) {
    const key = dayKey(c.day);
    if (!key) continue;
    if (!people.has(key)) { people.set(key, new Set()); spelling.set(key, String(c.day).trim()); }
    people.get(key).add(c.ninja_uid || nameKey(c.name));
  }
  const days = (scheduleDays || []).map((d) => String(d).trim()).filter(Boolean);
  const known = new Set(days.map(dayKey));
  const extra = [...spelling.keys()].filter((k) => !known.has(k)).map((k) => spelling.get(k)).sort(lowerCompare);
  return [...days, ...extra].map((day) => ({ day, ninjas: people.has(dayKey(day)) ? people.get(dayKey(day)).size : 0 }));
}

/**
 * Everyone who comes in on `day` and what they are still owed.
 *   classes:   [{name, day, time_slot, ninja_uid}] (the Ninjas page)
 *   rows:      Rewards owed rows (getSummary().rows)
 *   rowMatches(row, person) -> true when that Rewards owed row is about that Ninja
 * Returns {day, ninjas: [{name, time_slots, owed}], rows, totals, attending, owed_count}.
 *   ninjas: every Ninja that day (owed = their Rewards owed row, or null when nothing is owed)
 *   rows:   just the Rewards owed rows for that day, each with time_slots added
 *   totals: per reward type, the sum of what those Ninjas are owed
 */
export function rewardsForDay(classes, rows, day, rowMatches) {
  const want = dayKey(day);
  const people = new Map(); // person key -> {name, ninja_uid, time_slots}
  for (const c of classes) {
    if (dayKey(c.day) !== want || !nameKey(c.name)) continue;
    const key = c.ninja_uid || nameKey(c.name);
    if (!people.has(key)) people.set(key, { name: String(c.name).trim(), ninja_uid: c.ninja_uid || "", time_slots: [] });
    const slot = String(c.time_slot || "").trim();
    const person = people.get(key);
    if (slot && !person.time_slots.includes(slot)) person.time_slots.push(slot);
  }

  const totals = Object.fromEntries(Object.values(OWED_COLUMNS).map((f) => [f, 0]));
  const dayRows = [];
  const used = new Set();
  const ninjas = [...people.values()].sort((a, b) => lowerCompare(a.name, b.name)).map((person) => {
    // A Rewards owed row belongs to one Ninja: if two people somehow match it, the first keeps it.
    const row = rows.find((r) => !used.has(r) && rowMatches(r, person)) || null;
    if (row) {
      used.add(row);
      dayRows.push({ ...row, time_slots: person.time_slots });
      for (const [column, field] of Object.entries(OWED_COLUMNS)) totals[field] += row[column] || 0;
    }
    return { name: person.name, time_slots: person.time_slots, owed: row };
  });

  return { day: String(day || "").trim(), ninjas, rows: dayRows, totals, attending: ninjas.length, owed_count: dayRows.length };
}

/** rowMatches for rewardsForDay, from the database: same Ninja record, same name, or a belt link. */
export function rewardRowMatcher(conn) {
  const uidsByName = new Map(); // nameKey on the Belt-ups list -> Set of ninja_uids
  for (const r of conn.all("SELECT name, ninja_uid FROM belt_entries WHERE ninja_uid IS NOT NULL AND ninja_uid != ''")) {
    const key = nameKey(r.name);
    if (!uidsByName.has(key)) uidsByName.set(key, new Set());
    uidsByName.get(key).add(r.ninja_uid);
  }
  let links = new Map();
  try { links = matchBelts(conn).links; } catch (_) { /* name matching still works without links */ }
  return (row, person) => {
    const key = nameKey(row.name);
    if (person.ninja_uid && uidsByName.has(key) && uidsByName.get(key).has(person.ninja_uid)) return true;
    const personKey = nameKey(person.name);
    return key === personKey || links.get(key) === personKey;
  };
}

/** Days for the Rewards day picker, plus that day's Ninjas and rewards owed when `day` is given. */
export function getRewardsByDay(conn, day) {
  const classes = conn.all("SELECT name, day, time_slot, ninja_uid FROM active_ninjas ORDER BY id");
  const result = { days: attendanceDays(classes, getSetting("schedule_days", [])) };
  if (dayKey(day)) Object.assign(result, rewardsForDay(classes, getSummary(conn).rows, day, rewardRowMatcher(conn)));
  return result;
}
