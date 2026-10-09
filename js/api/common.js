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

export async function readUpload(file) {
  if (!file) throw new ApiError("No file was uploaded.");
  return await file.text(); // UTF-8, byte-order mark removed
}
