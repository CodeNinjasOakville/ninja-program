import { conn } from "../core/db.js";
import { route } from "./router.js";
import { bulkDelete, insertAll, readUpload } from "./common.js";
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
  const search = (query.q || "").trim().toLowerCase();
  if (search) {
    const like = `%${search}%`;
    return conn.all(
      "SELECT * FROM leads WHERE lower(ninja_name) LIKE ? OR lower(parent_name) LIKE ? ORDER BY entry_number",
      [like, like]
    );
  }
  return conn.all("SELECT * FROM leads ORDER BY entry_number");
});

route("POST", "/api/leads", ({ body }) => ({ ok: true, entry_number: insertLead(body) }));

route("POST", "/api/leads/bulk", ({ body }) => {
  const lines = nonBlankLines(body.text);
  if (!lines.length) throw new ApiError("No entries were provided.");
  const entries = lines.map((line) => {
    const parts = splitBulkLine(line);
    return Object.fromEntries(LEAD_FIELDS.map((f, i) => [f, i < parts.length ? parts[i].trim() : ""]));
  });
  return insertAll(entries, insertLead, (i) => `Line ${i + 1}`);
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
  return insertAll(entries, insertLead, (i) => `Row ${i + 2}`); // row 1 is the header
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
