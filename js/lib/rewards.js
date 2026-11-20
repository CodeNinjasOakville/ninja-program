// Rewards calculation - port of rewards.py (same maths, same results).
//
//  belt_entries (old belt -> new belt) = what each Ninja EARNED
//  receipts                            = what was GIVEN
//  earned - given (never below zero)   = what is still REMAINING
//
// Belt order comes from the "belt_options" setting, not from code.
//
// Ninja Bucks are one number: how they are paid out (large / small coins) is not tracked any more.
// Old "Large Coin" / "Small Coin" receipts stay in Rewards given but count towards nothing
// (they never reduced the Ninja Bucks owed).
//
// Certificates have two steps: saving the PDF records a "Certificate Printed" receipt (printed,
// not handed out yet), and only "Certificate" receipts count as given. Certificates printed
// before this split were saved as "Certificate" and so still count as given.

import { getSetting, REWARDS_PER_LEVEL } from "../core/db.js";
import { lowerCompare } from "./util.js";

export const FIELDS = ["ninja_bucks", "prints", "certificates", "belts"];

/** reward_type of a certificate that was printed but not handed out yet. */
export const CERT_PRINTED = "Certificate Printed";

export const REWARD_TYPE_TO_FIELD = {
  "Ninja Bucks": "ninja_bucks",
  "3D Print": "prints",
  "Certificate": "certificates",
  "New Belt": "belts",
};

export const FIELD_TO_REWARD_TYPE = Object.fromEntries(
  Object.entries(REWARD_TYPE_TO_FIELD).map(([type, field]) => [field, type])
);

export const emptyTotals = () => Object.fromEntries(FIELDS.map((f) => [f, 0]));

export function normalizeBelt(belt) {
  // "Green Belt" / "green belts" -> "green"
  return String(belt || "").trim().toLowerCase().replace(/\s+belts?$/, "").trim();
}

/**
 * The belt named in a rank as MyStudio (or anyone) writes it: "Yellow Belt", "CREATE - Orange belt",
 * "orange" -> "orange". Only belts listed in Settings count; "" when none is named.
 */
export function beltFromRank(text, beltOrder) {
  const t = ` ${String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  const longestFirst = [...beltOrder].filter(Boolean).sort((a, b) => b.length - a.length);
  return longestFirst.find((belt) => t.includes(` ${belt.replace(/[^a-z0-9]+/g, " ").trim()} `)) || "";
}

export function getBeltOrder(conn) {
  return getSetting("belt_options", [])
    .filter((b) => String(b).trim())
    .map(normalizeBelt);
}

export function formatBeltName(belt) {
  if (!belt) return "";
  return belt[0].toUpperCase() + belt.slice(1);
}

export function calculateLevels(oldBelt, newBelt, beltOrder) {
  const oldIndex = beltOrder.indexOf(oldBelt);
  const newIndex = beltOrder.indexOf(newBelt);
  if (oldIndex < 0 || newIndex < 0) return 0;
  return newIndex <= oldIndex ? 0 : newIndex - oldIndex;
}

export function buildProgressionString(progressions) {
  if (!progressions.length) return "";
  const result = [progressions[0].old_belt];
  for (const p of progressions) {
    if (result[result.length - 1] !== p.new_belt) result.push(p.new_belt);
  }
  return result.join(" → ");
}

/** { name: { level_ups, progressions: [...] } } from every belt entry. */
export function buildEarned(conn) {
  const beltOrder = getBeltOrder(conn);
  const earned = {};
  const rows = conn.all("SELECT name, old_belt, new_belt FROM belt_entries ORDER BY id");

  for (const row of rows) {
    const name = String(row.name || "").trim();
    if (!name) continue;
    const oldBelt = normalizeBelt(row.old_belt);
    const newBelt = normalizeBelt(row.new_belt);
    if (!oldBelt || !newBelt) continue;
    const levels = calculateLevels(oldBelt, newBelt, beltOrder);
    if (levels <= 0) continue;

    if (!earned[name]) earned[name] = { level_ups: 0, progressions: [] };
    earned[name].level_ups += levels;
    earned[name].progressions.push({
      old_belt: formatBeltName(oldBelt),
      new_belt: formatBeltName(newBelt),
      levels,
    });
  }
  return earned;
}

export function earnedAmountsForLevelUps(levelUps) {
  return {
    ninja_bucks: levelUps * REWARDS_PER_LEVEL.ninja_bucks,
    prints: levelUps * REWARDS_PER_LEVEL.prints,
    certificates: levelUps * REWARDS_PER_LEVEL.certificates,
    belts: levelUps * REWARDS_PER_LEVEL.belts,
  };
}

/** Map of name -> totals given, from every receipt. */
export function getGivenTotals(conn) {
  const totals = new Map();
  for (const row of conn.all("SELECT name, reward_type, amount FROM receipts")) {
    const name = String(row.name || "").trim();
    const type = String(row.reward_type || "").trim();
    const amount = row.amount || 0;
    if (!name || amount <= 0) continue;
    const field = REWARD_TYPE_TO_FIELD[type];
    if (!field) continue;
    if (!totals.has(name)) totals.set(name, emptyTotals());
    totals.get(name)[field] += amount;
  }
  return totals;
}

const certKey = (name, belt) => String(name || "").trim().toLowerCase() + "\u0000" + normalizeBelt(belt);
// "Yellow Belt Certificate" -> "yellow"; "" when the details name no belt.
export function certBelt(details) {
  const d = String(details || "").trim();
  return d.toLowerCase().endsWith(" belt certificate") ? normalizeBelt(d.slice(0, -" Belt Certificate".length)) : "";
}

/**
 * Certificates printed but not handed out yet, oldest first: [{id, name, belt, date}].
 * A printed one stops waiting once a "Certificate" receipt for the same Ninja and belt exists.
 */
export function getPrintedCertificates(conn) {
  const given = new Set();
  for (const r of conn.all("SELECT name, details FROM receipts WHERE reward_type = 'Certificate'")) {
    const belt = certBelt(r.details);
    if (belt) given.add(certKey(r.name, belt));
  }
  const waiting = [];
  const seen = new Set();
  for (const r of conn.all("SELECT id, date, name, details FROM receipts WHERE reward_type = ? ORDER BY id", [CERT_PRINTED])) {
    const belt = certBelt(r.details);
    const key = certKey(r.name, belt);
    if (!belt || given.has(key) || seen.has(key)) continue;
    seen.add(key);
    waiting.push({ id: r.id, name: String(r.name || "").trim(), belt: formatBeltName(belt), date: r.date || "" });
  }
  return waiting;
}

export function getSummary(conn) {
  const earned = buildEarned(conn);
  const given = getGivenTotals(conn);
  const printedBy = new Map();
  for (const p of getPrintedCertificates(conn)) {
    const key = p.name.toLowerCase();
    printedBy.set(key, (printedBy.get(key) || 0) + 1);
  }

  const rows = [];
  const totals = Object.fromEntries(FIELDS.map((f) => [f, { earned: 0, given: 0 }]));
  let totalLevelUps = 0;

  for (const name of Object.keys(earned).sort(lowerCompare)) {
    const person = earned[name];
    totalLevelUps += person.level_ups;

    const earnedAmounts = earnedAmountsForLevelUps(person.level_ups);
    const personGiven = given.get(name) || emptyTotals();

    const remaining = {};
    for (const [field, amount] of Object.entries(earnedAmounts)) {
      totals[field].earned += amount;
      totals[field].given += personGiven[field];
      remaining[field] = Math.max(0, amount - personGiven[field]);
    }
    if (Object.values(remaining).every((v) => v === 0)) continue;

    rows.push({
      name,
      progression: buildProgressionString(person.progressions),
      ninja_bucks_remaining: remaining.ninja_bucks,
      prints_remaining: remaining.prints,
      certificates_remaining: remaining.certificates,
      // Of the certificates owed, how many are printed already and just need handing out.
      certificates_printed: Math.min(remaining.certificates, printedBy.get(name.toLowerCase()) || 0),
      belts_remaining: remaining.belts,
    });
  }

  const overall = { levels_progressed: totalLevelUps };
  for (const field of FIELDS) {
    overall[field] = {
      earned: totals[field].earned,
      given: totals[field].given,
      remaining: Math.max(0, totals[field].earned - totals[field].given),
    };
  }
  overall.certificates.printed = rows.reduce((n, r) => n + r.certificates_printed, 0);
  return { rows, overall };
}

/** Earned amounts for one Ninja (case-insensitive exact name match). */
export function getEarnedForNinja(conn, name) {
  const beltOrder = getBeltOrder(conn);
  let levelUps = 0;
  const rows = conn.all(
    "SELECT old_belt, new_belt FROM belt_entries WHERE lower(trim(name)) = ?",
    [String(name).trim().toLowerCase()]
  );
  for (const row of rows) {
    const oldBelt = normalizeBelt(row.old_belt);
    const newBelt = normalizeBelt(row.new_belt);
    if (!oldBelt || !newBelt) continue;
    levelUps += calculateLevels(oldBelt, newBelt, beltOrder);
  }
  const amounts = earnedAmountsForLevelUps(levelUps);
  amounts.level_ups = levelUps;
  return amounts;
}

/**
 * Certificates still to print: owed, and neither printed nor handed out yet. A certificate marks completing a belt,
 * so moving Yellow -> Green earns Yellow and Orange certificates (the belts left behind), not Green.
 */
export function getOutstandingCertificates(conn) {
  const beltOrder = getBeltOrder(conn);

  const alreadyGiven = new Set();
  for (const row of conn.all("SELECT name, details FROM receipts WHERE reward_type IN ('Certificate', ?)", [CERT_PRINTED])) {
    const belt = certBelt(row.details);
    if (belt) alreadyGiven.add(certKey(row.name, belt));
  }

  const outstanding = [];
  const seen = new Set();

  for (const row of conn.all("SELECT name, old_belt, new_belt FROM belt_entries ORDER BY id")) {
    const name = String(row.name || "").trim();
    if (!name) continue;
    const oldBelt = normalizeBelt(row.old_belt);
    const newBelt = normalizeBelt(row.new_belt);
    if (!oldBelt || !newBelt) continue;
    const oldIndex = beltOrder.indexOf(oldBelt);
    const newIndex = beltOrder.indexOf(newBelt);
    if (oldIndex < 0 || newIndex < 0 || newIndex <= oldIndex) continue;

    for (let i = oldIndex; i < newIndex; i++) {
      const belt = beltOrder[i];
      const key = name.toLowerCase() + "\u0000" + belt;
      if (alreadyGiven.has(key) || seen.has(key)) continue;
      seen.add(key);
      outstanding.push({ name, belt: formatBeltName(belt) });
    }
  }
  return outstanding;
}

/**
 * The belt each Ninja is on right now: the "new belt" of their most recent belt entry.
 * Returned as a Map of lower-cased name -> belt ("Green"). Ninjas with no belt entry are absent.
 */
export function getCurrentBelts(conn) {
  const current = new Map();
  for (const row of conn.all("SELECT name, new_belt FROM belt_entries ORDER BY id")) {
    const name = String(row.name || "").trim().toLowerCase();
    const belt = normalizeBelt(row.new_belt);
    if (name && belt) current.set(name, formatBeltName(belt));
  }
  return current;
}
