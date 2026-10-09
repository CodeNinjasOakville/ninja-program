// Small helpers that mirror the Python behaviours the original code relied on,
// so the ported routes behave the same way.

export class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Python: str(value or "")  -> falsy values (None, 0, "") become ""
export function pyStr(value) {
  return value ? String(value) : "";
}

// Python: int(value or 0) - truncates numbers, accepts whole-number strings, otherwise throws
export function pyInt(value) {
  const v = value || 0;
  if (typeof v === "number") return Math.trunc(v);
  if (typeof v === "string" && /^\s*[+-]?\d+\s*$/.test(v)) return parseInt(v, 10);
  throw new Error("not an integer");
}

// Python: [int(i) for i in ids if str(i).lstrip("-").isdigit()]
export function cleanIds(list) {
  return (list || [])
    .filter((i) => /^-?\d+$/.test(String(i)))
    .map((i) => parseInt(String(i), 10));
}

export function placeholders(count) {
  return Array(count).fill("?").join(", ");
}

// Python date.today().isoformat()  ->  2026-10-09 (local date)
export function todayISO(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

// Python strftime("%d-%b-%Y")  ->  09-Oct-2026
export function todayCertificateDate(now = new Date()) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(now.getDate()).padStart(2, "0")}-${months[now.getMonth()]}-${now.getFullYear()}`;
}

// Python str.splitlines() then drop blank lines
export function nonBlankLines(text) {
  return String(text || "").split(/\r\n|\r|\n/).filter((line) => line.trim());
}

// Tab-separated (pasted from a sheet) or "|" separated (typed by hand)
export function splitBulkLine(line) {
  return line.includes("\t") ? line.split("\t") : line.split("|");
}

export function lowerCompare(a, b) {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}
