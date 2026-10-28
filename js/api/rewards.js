// Rewards, reward history, certificates and totem tags.

import { conn } from "../core/db.js";
import { route } from "./router.js";
import { ApiError, cleanIds, placeholders, pyInt, todayCertificateDate, todayISO } from "../lib/util.js";
import * as rewards from "../lib/rewards.js";
import { currentBeltLookup } from "../lib/belt_match.js";
import { generateCertificatesPdf } from "../pdf/certificates.js";
import { generateTotemTagsPdf } from "../pdf/totem_tags.js";
import { generateBeltSheetPdf } from "../pdf/belt_sheet.js";

const titleCase = (field) => field.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

route("GET", "/api/rewards/summary", () => rewards.getSummary(conn));

// Records what was handed out, refusing to give a Ninja more than they have remaining.
route("POST", "/api/rewards/give", ({ body }) => {
  const names = (body.names || []).map((n) => String(n).trim()).filter(Boolean);
  if (!names.length) throw new ApiError("No Ninja names were provided.");

  const amounts = {};
  for (const field of rewards.FIELDS) {
    let amount;
    try { amount = pyInt(body[field]); } catch (_) { throw new ApiError(`${field} must be a whole number.`); }
    if (amount < 0) throw new ApiError(`${field} cannot be negative.`);
    amounts[field] = amount;
  }
  if (Object.values(amounts).every((v) => v === 0)) throw new ApiError("No reward amounts were entered.");

  const givenTotals = rewards.getGivenTotals(conn);
  const errors = [];
  for (const name of names) {
    const earned = rewards.getEarnedForNinja(conn, name);
    const already = givenTotals.get(name) || rewards.emptyTotals();
    for (const field of Object.keys(amounts)) {
      // Only check what is being given now: a field left at 0 must never block the rest,
      // even if that field was over-given before (e.g. a reprinted certificate).
      if (amounts[field] === 0) continue;
      const remaining = earned[field] - already[field];
      if (amounts[field] > remaining) {
        errors.push(`${name}: trying to give ${amounts[field]} ${titleCase(field)}, but only ${Math.max(0, remaining)} remain.`);
      }
    }
  }
  if (errors.length) throw new ApiError("Rewards could not be given.\n" + errors.join("\n"));

  const now = todayISO();
  const rows = [];
  for (const name of names) {
    for (const [field, amount] of Object.entries(amounts)) {
      if (amount > 0) rows.push([now, name, rewards.FIELD_TO_REWARD_TYPE[field], amount, "", "Reward Given"]);
    }
  }
  conn.transaction(() => conn.runMany(
    "INSERT INTO receipts (date, name, reward_type, amount, details, entry_type) VALUES (?, ?, ?, ?, ?, ?)", rows));
  return { ok: true, recorded: rows.length };
});

route("GET", "/api/rewards/history", () => conn.all("SELECT * FROM receipts ORDER BY id DESC"));

// Undo a single reward transaction (recorded by mistake).
route("DELETE", "/api/rewards/history/:id", ({ params }) => {
  conn.run("DELETE FROM receipts WHERE id = ?", [params.id]);
  return { ok: true };
});

// Undo every certificate transaction at once, so all certificates become owed again.
route("POST", "/api/rewards/history/clear-certificates", () => {
  const { count } = conn.get("SELECT COUNT(*) AS count FROM receipts WHERE reward_type = 'Certificate'");
  conn.run("DELETE FROM receipts WHERE reward_type = 'Certificate'");
  return { ok: true, deleted: count };
});

// ---------------- certificates ----------------

route("GET", "/api/certificates/outstanding", () => rewards.getOutstandingCertificates(conn));

// Body: {generate_all: true} | {items: [{name, belt}]} | {name, belts: [...]}
// Generates the PDF, then records each as a "Certificate" receipt so it isn't generated twice.
route("POST", "/api/certificates/generate", async ({ body }) => {
  let items;
  if (body.generate_all) {
    items = rewards.getOutstandingCertificates(conn);
  } else if (body.items && body.items.length) {
    items = body.items.map((i) => ({
      name: String(i.name || "").trim(),
      belt: rewards.formatBeltName(String(i.belt || "").trim()),
    }));
  } else if (body.name && body.belts && body.belts.length) {
    const name = String(body.name).trim();
    items = body.belts.map((b) => ({ name, belt: rewards.formatBeltName(String(b).trim()) }));
  } else {
    throw new ApiError("No certificates were specified.");
  }

  items = items.filter((i) => i.name && i.belt);
  if (!items.length) throw new ApiError("There are no outstanding certificates to generate.");

  let pdf;
  try {
    pdf = await generateCertificatesPdf(items);
  } catch (error) {
    throw new ApiError(`Could not generate certificates: ${error.message}`, 500);
  }

  const now = todayISO();
  conn.transaction(() => conn.runMany(
    "INSERT INTO receipts (date, name, reward_type, amount, details, entry_type) VALUES (?, ?, ?, ?, ?, ?)",
    items.map((i) => [now, i.name, "Certificate", 1, `${i.belt} Belt Certificate`, "Certificate Printed"])));

  return { ok: true, count: items.length, filename: pdf.filename, bytes: pdf.bytes };
});

// ---------------- totem tags ----------------
// Body: {ids: [...]} (leads) | {all: true} (every lead) | {names: [...]} (typed list)

async function totemTags({ body }) {
  let names;
  if (body.names && body.names.length) {
    names = body.names;
  } else if (body.all) {
    names = conn.all("SELECT ninja_name FROM leads ORDER BY entry_number").map((r) => r.ninja_name);
  } else if (body.ids && body.ids.length) {
    const ids = cleanIds(body.ids);
    if (!ids.length) throw new ApiError("No valid ids were provided.");
    names = conn.all(
      `SELECT ninja_name FROM leads WHERE id IN (${placeholders(ids.length)}) ORDER BY entry_number`, ids
    ).map((r) => r.ninja_name);
  } else {
    throw new ApiError("No Ninjas were specified.");
  }

  let pdf;
  try {
    pdf = await generateTotemTagsPdf(names);
  } catch (error) {
    const isInput = error.message === "No names to print.";
    throw new ApiError(isInput ? error.message : `Could not generate totem tags: ${error.message}`, isInput ? 400 : 500);
  }
  return { ok: true, count: pdf.count, filename: pdf.filename, bytes: pdf.bytes };
}

route("POST", "/api/totem-tags", totemTags);
route("POST", "/api/leads/totem-tags", totemTags);

// Body: {names: [...]} in tag order -> a PDF listing each Ninja (as named on the tag) with their
// current belt (Active Ninjas belt, else latest Belts-tab entry).
// {standalone: true} (the Active Ninjas button) sorts by name and leaves out the tag-sheet headings.
route("POST", "/api/totem-tags/belt-sheet", async ({ body }) => {
  const beltOf = currentBeltLookup(conn);
  const seen = new Set();
  let rows = (body.names || []).map((n) => String(n == null ? "" : n).trim()).filter(Boolean)
    .map((name) => ({ name, belt: beltOf(name) }));
  if (body.standalone) {
    rows = rows
      .filter((r) => !seen.has(r.name.toLowerCase()) && seen.add(r.name.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  if (!rows.length) throw new ApiError("No names to print.");
  const pdf = await generateBeltSheetPdf(rows, {
    date: todayCertificateDate(),
    tagSheets: !body.standalone,
    title: body.standalone ? "Ninja Belts" : "Totem Tag Belts",
  });
  return { ok: true, count: pdf.count, filename: pdf.filename, bytes: pdf.bytes };
});
