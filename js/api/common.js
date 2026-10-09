// Pieces shared by the Leads / Belts / Active Ninjas routes.

import { conn } from "../core/db.js";
import { ApiError, cleanIds, placeholders } from "../lib/util.js";

/** Body: {"all": true} wipes the table, or {"ids": [1,2,3]} deletes those rows. */
export function bulkDelete(table, body) {
  if (body.all) {
    const count = conn.get(`SELECT COUNT(*) AS c FROM ${table}`).c;
    conn.run(`DELETE FROM ${table}`);
    return { ok: true, deletedCount: count };
  }
  const ids = cleanIds(body.ids);
  if (!ids.length) throw new ApiError("No ids were provided.");
  conn.run(`DELETE FROM ${table} WHERE id IN (${placeholders(ids.length)})`, ids);
  return { ok: true, deletedCount: ids.length };
}

/** Runs insertFn(entry) for each entry, collecting validation errors instead of stopping. */
export function insertAll(entries, insertFn, label) {
  let successCount = 0;
  const errors = [];
  conn.transaction(() => {
    entries.forEach((entry, i) => {
      try {
        insertFn(entry);
        successCount += 1;
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        errors.push(`${label(i)}: ${error.message}`);
      }
    });
  });
  return { successCount, errors };
}

/**
 * WHERE clause matching `search` anywhere in any of `columns` (case-insensitive).
 * With phoneColumn, a search made of digits/punctuation also matches phone numbers
 * ignoring formatting, so "9055551234" finds "(905) 555-1234".
 */
export function searchClause(columns, search, phoneColumn) {
  const like = `%${search.trim().toLowerCase()}%`;
  const parts = columns.map((c) => `lower(coalesce(${c}, '')) LIKE ?`);
  const params = columns.map(() => like);

  let digits = search.replace(/\D/g, "");
  if (phoneColumn && digits.length >= 3 && !/[a-z@]/i.test(search)) {
    // Drop a leading country code: "+1 905...", "1-905..." or "19055551234".
    if ((digits.length === 11 && digits.startsWith("1")) || /^\s*\+?1[\s.\-(]/.test(search)) digits = digits.slice(1);
    let stripped = `coalesce(${phoneColumn}, '')`;
    for (const ch of [" ", "-", "(", ")", ".", "+", "/"]) stripped = `replace(${stripped}, '${ch}', '')`;
    parts.push(`${stripped} LIKE ?`);
    params.push(`%${digits}%`);
  }
  return { where: `(${parts.join(" OR ")})`, params };
}

export async function readUpload(file) {
  if (!file) throw new ApiError("No file was uploaded.");
  return await file.text(); // UTF-8, byte-order mark removed
}
