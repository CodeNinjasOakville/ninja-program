// Orders leads by their GBS date: upcoming ones (today or later) first, soonest at the top;
// then past ones, most recent first; then leads with no GBS date (or one that can't be read),
// newest lead first.
//
// GBS Date is a free-text field (typed by hand or imported from a spreadsheet), so it is read
// leniently: 2026-01-02, 1/2/2026, 1/2/26, Jan 2 2026, 2 Jan 2026, Fri, Jan 2, Jan 2 (no year),
// and Excel day numbers. Slash dates are month/day, unless the first number is over 12.

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const pad = (n) => String(n).padStart(2, "0");
const isoOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

function validDate(y, m, d) {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2200)) return false;
  const date = new Date(y, m - 1, d);
  return date.getMonth() === m - 1 && date.getDate() === d;
}

function fullYear(y) {
  y = Number(y);
  return y < 100 ? 2000 + y : y;
}

// A date typed without a year belongs to whichever year puts it closest to today.
function guessYear(m, d, today) {
  const [ty] = today.split("-").map(Number);
  let best = null;
  for (const y of [ty - 1, ty, ty + 1]) {
    if (!validDate(y, m, d)) continue;
    const gap = Math.abs(new Date(y, m - 1, d) - new Date(today + "T00:00:00"));
    if (!best || gap < best.gap) best = { y, gap };
  }
  return best ? best.y : null;
}

function monthIndex(word) {
  const i = MONTHS.indexOf(String(word).slice(0, 3).toLowerCase());
  return i < 0 ? 0 : i + 1;
}

/** "YYYY-MM-DD" for a GBS date as typed, or "" if it can't be read. today is "YYYY-MM-DD". */
export function parseGbsDate(value, today) {
  let text = String(value == null ? "" : value).trim().toLowerCase();
  if (!text) return "";
  // Drop a weekday ("Fri, Jan 2") and any time after the date ("2026-01-02 16:00", "...T16:00").
  text = text.replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s*/, "").replace(/[t\s]\d{1,2}:\d{2}.*$/, "").trim();

  let m;
  const accept = (y, mo, d) => (y && validDate(y, mo, d) ? isoOf(y, mo, d) : "");

  // 2026-01-02, 2026/1/2
  if ((m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) return accept(+m[1], +m[2], +m[3]);

  // 1/2/2026, 1-2-26, 13/1/2026 (day first when the first number can't be a month)
  if ((m = text.match(/^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?$/))) {
    let [a, b] = [+m[1], +m[2]];
    if (a > 12 && b <= 12) [a, b] = [b, a];
    const y = m[3] ? fullYear(m[3]) : guessYear(a, b, today);
    return accept(y, a, b);
  }

  // Jan 2, 2026 / January 2nd 2026 / Jan 2
  if ((m = text.match(/^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?(?:\s+(\d{2,4}))?$/))) {
    const mo = monthIndex(m[1]);
    if (!mo) return "";
    const y = m[3] ? fullYear(m[3]) : guessYear(mo, +m[2], today);
    return accept(y, mo, +m[2]);
  }

  // 2 Jan 2026 / 02-Jan-2026 / 2 Jan
  if ((m = text.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]+)\.?,?(?:[\s-]+(\d{2,4}))?$/))) {
    const mo = monthIndex(m[2]);
    if (!mo) return "";
    const y = m[3] ? fullYear(m[3]) : guessYear(mo, +m[1], today);
    return accept(y, mo, +m[1]);
  }

  // Excel day number (a date column that lost its formatting): 46024 = 2026-01-02
  if ((m = text.match(/^(\d{5})$/)) && +m[1] > 30000 && +m[1] < 80000) {
    const date = new Date(Date.UTC(1899, 11, 30) + +m[1] * 86400000);
    return isoOf(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  return "";
}

/** Minutes since midnight for a GBS time like "4 PM", "4:30pm", "16:30" or "4 PM - 5 PM"; else 9999. */
export function gbsTimeMinutes(value) {
  const m = String(value || "").trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/);
  if (!m) return 9999;
  let hours = +m[1];
  const minutes = m[2] ? +m[2] : 0;
  if (m[3] && m[3].startsWith("p") && hours < 12) hours += 12;
  if (m[3] && m[3].startsWith("a") && hours === 12) hours = 0;
  return hours > 23 || minutes > 59 ? 9999 : hours * 60 + minutes;
}

/**
 * Leads in GBS order, each given gbs_group: "upcoming" | "past" | "none".
 * today is "YYYY-MM-DD"; a GBS today counts as upcoming.
 */
export function sortLeadsByGbs(rows, today) {
  const keyed = rows.map((row) => {
    const date = parseGbsDate(row.gbs_date, today);
    const group = !date ? "none" : date >= today ? "upcoming" : "past";
    return { row: { ...row, gbs_group: group }, date, time: gbsTimeMinutes(row.gbs_time), group };
  });
  const rank = { upcoming: 0, past: 1, none: 2 };
  keyed.sort((a, b) => {
    if (a.group !== b.group) return rank[a.group] - rank[b.group];
    if (a.group === "upcoming") {
      return a.date.localeCompare(b.date) || a.time - b.time || a.row.entry_number - b.row.entry_number;
    }
    if (a.group === "past") {
      return b.date.localeCompare(a.date) || b.time - a.time || b.row.entry_number - a.row.entry_number;
    }
    return b.row.entry_number - a.row.entry_number;
  });
  return keyed.map((k) => k.row);
}
