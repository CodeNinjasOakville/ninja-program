// Rewards calculation - port of rewards.py (same maths, same results).
//
//  belt_entries (old belt -> new belt) = what each Ninja EARNED
//  receipts                            = what was GIVEN
//  earned - given (never below zero)   = what is still REMAINING
//
// Belt order comes from the "belt_options" setting, not from code.

import { getSetting, REWARDS_PER_LEVEL } from "../core/db.js";
import { lowerCompare } from "./util.js";

export const FIELDS = ["ninja_bucks", "large_coins", "small_coins", "prints", "certificates", "belts"];

export const REWARD_TYPE_TO_FIELD = {
  "Ninja Bucks": "ninja_bucks",
  "Large Coin": "large_coins",
  "Small Coin": "small_coins",
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
  const ninjaBucks = levelUps * REWARDS_PER_LEVEL.ninja_bucks;
  return {
    ninja_bucks: ninjaBucks,
    large_coins: Math.floor(ninjaBucks / 10),
    small_coins: ninjaBucks % 10,
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

export function getSummary(conn) {
  const earned = buildEarned(conn);
  const given = getGivenTotals(conn);

  const rows = [];
  const totals = Object.fromEntries(FIELDS.map((f) => [f, { earned: 0, given: 0 }]));
  let totalLevelUps = 0;
  const coinsRemaining = { large_coins: 0, small_coins: 0 };

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
    // Coins are how the remaining Ninja Bucks get paid out ($10 large, $1 small), so they
    // follow the bucks still owed rather than being tracked as a separate reward.
    remaining.large_coins = Math.floor(remaining.ninja_bucks / 10);
    remaining.small_coins = remaining.ninja_bucks % 10;
    coinsRemaining.large_coins += remaining.large_coins;
    coinsRemaining.small_coins += remaining.small_coins;

    if (Object.values(remaining).every((v) => v === 0)) continue;

    rows.push({
      name,
      progression: buildProgressionString(person.progressions),
      ninja_bucks_remaining: remaining.ninja_bucks,
      large_coins_remaining: remaining.large_coins,
      small_coins_remaining: remaining.small_coins,
      prints_remaining: remaining.prints,
      certificates_remaining: remaining.certificates,
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
  for (const [field, left] of Object.entries(coinsRemaining)) overall[field].remaining = left;
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
 * Certificates still owed, minus those already printed. A certificate marks completing a belt,
 * so moving Yellow -> Green earns Yellow and Orange certificates (the belts left behind), not Green.
 */
export function getOutstandingCertificates(conn) {
  const beltOrder = getBeltOrder(conn);

  const alreadyGiven = new Set();
  for (const row of conn.all("SELECT name, details FROM receipts WHERE reward_type = 'Certificate'")) {
    const name = String(row.name || "").trim().toLowerCase();
    const details = String(row.details || "");
    if (details.toLowerCase().endsWith(" belt certificate")) {
      const belt = normalizeBelt(details.slice(0, -" Belt Certificate".length));
      alreadyGiven.add(name + "\u0000" + belt);
    }
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
