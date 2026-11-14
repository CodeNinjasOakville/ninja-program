// The 3D print queue: prints promised to Ninjas, first come first printed.
// Rules only (no database here) so they are easy to test; routes are in js/api/prints.js.
//
// Where a print's model lives: a link (Tinkercad, Thingiverse, Google Drive...) and/or a small
// file kept inside the print's own row, shared through the same team sync as JR notes and
// every other sheet. Big files would make every sync slow, so files over MAX_FILE_BYTES are
// refused with a hint to use a link instead.

export const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Queue order: oldest promised date first; same day = whoever was added first. */
export function queueOrder(a, b) {
  return String(a.promised_date || "").localeCompare(String(b.promised_date || "")) || a.id - b.id;
}

/** Printed list order: most recently printed first. */
export function printedOrder(a, b) {
  return String(b.printed_date || "").localeCompare(String(a.printed_date || "")) || b.id - a.id;
}

/** "2026-11-14" -> same; anything that isn't a real calendar date -> null. */
export function cleanDate(value) {
  const text = String(value || "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? text : null;
}

/**
 * A model link as typed: "" stays "", "tinkercad.com/things/abc" gets https:// in front.
 * Only web links are allowed (so a link can never run code when clicked); returns null otherwise.
 */
export function cleanLink(value) {
  let text = String(value || "").trim();
  if (!text) return "";
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = "https://" + text.replace(/^\/+/, "");
  let url;
  try { url = new URL(text); } catch (_) { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!url.hostname.includes(".") && url.hostname !== "localhost") return null;
  return url.href;
}

/** How many bytes a base64 string holds. */
export function base64Size(b64) {
  const text = String(b64 || "").replace(/\s+/g, "");
  if (!text) return 0;
  const pad = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  return Math.floor((text.length * 3) / 4) - pad;
}

/** A file name safe to save under: no folders, no odd characters, never empty. */
export function cleanFileName(name) {
  const base = String(name || "").split(/[\\/]/).pop().replace(/[^\w.\- ()]+/g, "_").trim().slice(0, 120);
  return base && !/^\.+$/.test(base) ? base : "model";
}

/** "1.4 MB", "820 KB", "512 bytes" */
export function sizeText(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

/** Whole days from one ISO date to another (never negative). */
export function daysBetween(fromISO, toISO) {
  const a = Date.parse(fromISO + "T00:00:00Z"), b = Date.parse(toISO + "T00:00:00Z");
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}
