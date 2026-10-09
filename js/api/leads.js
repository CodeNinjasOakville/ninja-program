import { conn } from "../core/db.js";
import { route } from "./router.js";
import { bulkDelete, insertAll, readUpload, searchClause } from "./common.js";
import { ApiError, nonBlankLines, pyStr, splitBulkLine, todayISO } from "../lib/util.js";
import { readDicts } from "../lib/csv.js";

export const LEAD_FIELDS = [
  "ninja_name", "parent_name", "phone_number", "email", "age",
  "gbs_type", "staff_name", "coding_experience", "comments",
  "gbs_date", "gbs_time", "post_gbs_follow_up", "gbs_completed",
];

// CSV header (lower-case) -> field. Lets a straight export of the old Google Sheet import as-is.
const LEAD_HEADER_ALIASES = {
  "ninja name": "ninja_name", "child name": "ninja_name", "name": "ninja_name",
  "parent name": "parent_name",
  "phone number": "phone_number", "phone": "phone_number",
  "email": "email", "email address": "email",
  "age": "age",
  "gbs type": "gbs_type",
  "staff name": "staff_name",
  "coding experience": "coding_experience",
  "comments": "comments",
  "gbs date": "gbs_date", "date of gbs": "gbs_date",
  "gbs time": "gbs_time", "time of gbs": "gbs_time",
  "post gbs follow-up?": "post_gbs_follow_up", "post gbs follow up": "post_gbs_follow_up",
  "post-gbs follow-up": "post_gbs_follow_up",
  "gbs completed?": "gbs_completed", "gbs completed": "gbs_completed",
};

// ---- Duplicate detection (same phone number or email; names are allowed to repeat) ----

// "(905) 555-1234", "905.555.1234" and "+1 905 555 1234" all become "9055551234".
export function phoneKey(value) {
  let digits = pyStr(value).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.length >= 7 ? digits : "";
}

export function emailKey(value) {
  const email = pyStr(value).trim().toLowerCase();
  return email.includes("@") ? email : "";
}

// Remembers phone/email of every lead (existing plus anything added during this request)
// so one import can catch repeats both against the table and within the file itself.
function duplicateChecker() {
  const phones = new Map();
  const emails = new Map();
  const remember = (data, label) => {
    const p = phoneKey(data.phone_number), e = emailKey(data.email);
    if (p && !phones.has(p)) phones.set(p, label);
    if (e && !emails.has(e)) emails.set(e, label);
  };
  for (const row of conn.all("SELECT entry_number, ninja_name, phone_number, email FROM leads ORDER BY entry_number")) {
    remember(row, `existing entry #${row.entry_number} (${row.ninja_name})`);
  }
  return {
    remember,
    /** Returns e.g. "same phone number as existing entry #4 (Kim Lee)", or "" if no clash. */
    find(data) {
      const reasons = [];
      const p = phoneKey(data.phone_number), e = emailKey(data.email);
      if (p && phones.has(p)) reasons.push(`same phone number as ${phones.get(p)}`);
      if (e && emails.has(e)) reasons.push(`same email as ${emails.get(e)}`);
      return reasons.join("; ");
    },
  };
}

// Bulk add / CSV import: duplicates are skipped and reported, everything else is added.
function insertLeadsSkippingDuplicates(entries, label) {
  const checker = duplicateChecker();
  const duplicates = [];
  const fresh = [];
  const freshLabels = [];
  entries.forEach((entry, i) => {
    const name = pyStr(entry.ninja_name).trim();
    const clash = name ? checker.find(entry) : "";
    if (clash) {
      duplicates.push(`${label(i)}: skipped "${name}" - ${clash}.`);
      return;
    }
    if (name) checker.remember(entry, `${label(i)} of this file (${name})`);
    fresh.push(entry);
    freshLabels.push(label(i));
  });
  const result = insertAll(fresh, insertLead, (i) => freshLabels[i]);
  if (duplicates.length) result.duplicates = duplicates;
  return result;
}

export function insertLead(data) {
  const ninjaName = pyStr(data.ninja_name).trim();
  if (!ninjaName) throw new ApiError("Ninja Name is required.");

  const entryNumber = (conn.get("SELECT MAX(entry_number) AS m FROM leads").m || 0) + 1;
  const values = LEAD_FIELDS.map((f) => pyStr(data[f]).trim());
  values[0] = ninjaName;

  conn.run(
    `INSERT INTO leads (entry_number, ${LEAD_FIELDS.join(", ")}, lead_date) VALUES (?, ${LEAD_FIELDS.map(() => "?").join(", ")}, ?)`,
    [entryNumber, ...values, todayISO()]
  );
  return entryNumber;
}

route("GET", "/api/leads", ({ query }) => {
  const search = (query.q || "").trim();
  if (search) {
    // Any column: name, parent, phone, email, comments, dates, entry #...
    const { where, params } = searchClause(["entry_number", ...LEAD_FIELDS, "lead_date"], search, "phone_number");
    return conn.all(`SELECT * FROM leads WHERE ${where} ORDER BY entry_number`, params);
  }
  return conn.all("SELECT * FROM leads ORDER BY entry_number");
});

// A single add warns (409) about a duplicate; the form resends with allow_duplicate to add it anyway.
route("POST", "/api/leads", ({ body }) => {
  if (!body.allow_duplicate && pyStr(body.ninja_name).trim()) {
    const clash = duplicateChecker().find(body);
    if (clash) throw new ApiError(`This looks like a duplicate: ${clash}.`, 409);
  }
  return { ok: true, entry_number: insertLead(body) };
});

route("POST", "/api/leads/bulk", ({ body }) => {
  const lines = nonBlankLines(body.text);
  if (!lines.length) throw new ApiError("No entries were provided.");
  const entries = lines.map((line) => {
    const parts = splitBulkLine(line);
    return Object.fromEntries(LEAD_FIELDS.map((f, i) => [f, i < parts.length ? parts[i].trim() : ""]));
  });
  return insertLeadsSkippingDuplicates(entries, (i) => `Line ${i + 1}`);
});

route("POST", "/api/leads/import", async ({ file }) => {
  const raw = await readUpload(file);
  const { fieldnames, records } = readDicts(raw);
  if (!fieldnames) throw new ApiError("CSV has no header row.");

  const headerMap = {};
  for (const header of fieldnames) {
    const field = LEAD_HEADER_ALIASES[String(header || "").trim().toLowerCase()];
    if (field) headerMap[header] = field;
  }
  if (!Object.values(headerMap).includes("ninja_name")) {
    throw new ApiError('Could not find a "Ninja Name" (or "Child Name") column in the CSV header.');
  }

  const entries = records.map((rec) =>
    Object.fromEntries(Object.entries(headerMap).map(([header, field]) => [field, pyStr(rec[header]).trim()]))
  );
  return insertLeadsSkippingDuplicates(entries, (i) => `Row ${i + 2}`); // row 1 is the header
});

route("PUT", "/api/leads/:id", ({ params, body }) => {
  const existing = conn.get("SELECT * FROM leads WHERE id = ?", [params.id]);
  if (!existing) throw new ApiError("That entry no longer exists.", 404);

  const values = {};
  for (const f of LEAD_FIELDS) values[f] = pyStr(f in body ? body[f] : existing[f]).trim();
  if (!values.ninja_name) throw new ApiError("Ninja Name is required.");

  conn.run(
    `UPDATE leads SET ${LEAD_FIELDS.map((f) => `${f} = ?`).join(", ")} WHERE id = ?`,
    [...LEAD_FIELDS.map((f) => values[f]), params.id]
  );
  return { ok: true };
});

route("DELETE", "/api/leads/:id", ({ params }) => {
  conn.run("DELETE FROM leads WHERE id = ?", [params.id]);
  return { ok: true };
});

route("POST", "/api/leads/bulk-delete", ({ body }) => bulkDelete("leads", body));
