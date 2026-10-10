// Parsing for Active Ninjas CSV imports - port of schedule_import.py.
//
// Two formats are auto-detected:
//  1. The wide weekly "Session Schedule" export (day columns across the top,
//     time rows alternating with blocks of names).
//  2. A flat CSV with Name / Day / Time Slot / AI columns.
// Either way the result is a list of { name, day, time_slot, is_ai }.

import { parseCSV } from "./csv.js";

const DAY_NAMES = new Set(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);
const AI_MARKER_RE = /\s*\(\s*ai\s*\)\s*$/i;
const TIME_CELL_RE = /\d{1,2}(:\d{2})?\s*(am|pm)/i;

const FLAT_HEADER_ALIASES = {
  "name": "name",
  "ninja name": "name",
  "day": "day",
  "time slot": "time_slot",
  "time": "time_slot",
  "ai": "is_ai",
  "artificial intelligence": "is_ai",
};

const cell = (v) => String(v == null ? "" : v);

function splitName(raw) {
  let name = cell(raw).trim();
  const isAi = AI_MARKER_RE.test(name);
  if (isAi) name = name.replace(AI_MARKER_RE, "").trim();
  return [name, isAi];
}

// Needs a row with at least two distinct day names - a flat CSV row only ever has one.
export function looksLikeScheduleGrid(rows) {
  for (const row of rows.slice(0, 3)) {
    const lowered = new Set(row.map((c) => cell(c).trim().toLowerCase()));
    let hits = 0;
    for (const d of DAY_NAMES) if (lowered.has(d)) hits++;
    if (hits >= 2) return true;
  }
  return false;
}

export function parseScheduleGrid(rows) {
  let headerRow = null;
  let headerIndex = -1;
  for (let idx = 0; idx < rows.length; idx++) {
    const lowered = rows[idx].map((c) => cell(c).trim().toLowerCase());
    if ([...DAY_NAMES].some((d) => lowered.includes(d))) {
      headerRow = rows[idx];
      headerIndex = idx;
      break;
    }
  }
  if (!headerRow) return [];

  const dayColumns = {};
  headerRow.forEach((c, i) => {
    const value = cell(c).trim();
    if (DAY_NAMES.has(value.toLowerCase())) dayColumns[i] = value;
  });
  const columns = Object.keys(dayColumns).map(Number);

  const entries = [];
  const currentTime = {};

  for (const row of rows.slice(headerIndex + 1)) {
    // Rows are classified (time row vs names row) rather than assumed to alternate,
    // so a blank spacer row can't shift later pairs out of alignment.
    const isTimeRow = columns.some(
      (col) => col < row.length && cell(row[col]).trim() && TIME_CELL_RE.test(cell(row[col]))
    );

    if (isTimeRow) {
      for (const col of columns) {
        const value = col < row.length ? cell(row[col]).trim() : "";
        if (value && TIME_CELL_RE.test(value)) currentTime[col] = value;
      }
      continue;
    }

    for (const col of columns) {
      const namesCell = col < row.length ? cell(row[col]).trim() : "";
      if (!namesCell) continue;
      const timeSlot = currentTime[col];
      if (!timeSlot) continue;

      for (const line of namesCell.split(/\r\n|\r|\n/)) {
        const [name, isAi] = splitName(line);
        if (!name) continue;
        entries.push({ name, day: dayColumns[col], time_slot: timeSlot, is_ai: isAi });
      }
    }
  }
  return entries;
}

export function parseFlatCsv(rows) {
  if (!rows.length) return [];
  const headerMap = {};
  rows[0].forEach((c, i) => {
    const field = FLAT_HEADER_ALIASES[cell(c).trim().toLowerCase()];
    if (field) headerMap[i] = field;
  });
  if (!Object.values(headerMap).includes("name")) return [];

  const entries = [];
  for (const row of rows.slice(1)) {
    const entry = { name: "", day: "", time_slot: "", is_ai: false };
    for (const [i, field] of Object.entries(headerMap)) {
      const value = Number(i) < row.length ? cell(row[i]).trim() : "";
      if (field === "is_ai") entry.is_ai = ["yes", "true", "1", "ai"].includes(value.toLowerCase());
      else entry[field] = value;
    }
    const [name, aiFromName] = splitName(entry.name);
    entry.name = name;
    entry.is_ai = entry.is_ai || aiFromName;
    if (entry.name) entries.push(entry);
  }
  return entries;
}

// ---- MyStudio "All classes schedule" export (Attendance > Class schedule > Export) ----
// One row per Ninja per class per date, covering the next 14 days:
//   Date, Time, Class name, Participant name, Customer name, Email address, Phone number
// The same weekly class therefore shows up two or three times; those repeats are merged.

// "AI Academies" is the Artificial Intelligence class, so those sessions get the AI badge.
const AI_CLASS_RE = /^ai\b/i;

/** Minutes since midnight for the start of "04:00 PM" / "4 PM - 5 PM"; null if there is no time. */
export function slotStartMinutes(slot) {
  const m = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(slot || "");
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  let meridiem = (m[3] || "").toLowerCase();
  if (!meridiem) {
    const later = /(am|pm)/i.exec(slot);
    meridiem = later ? later[1].toLowerCase() : "";
  }
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return hour * 60 + (m[2] ? parseInt(m[2], 10) : 0);
}

/** 960 -> "4:00 PM" */
export function formatStartTime(minutes) {
  const hour = Math.floor(minutes / 60);
  return `${hour % 12 || 12}:${String(minutes % 60).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

// "JAKE RUAN" -> "Jake Ruan". Names that already have lower-case letters are left as typed.
export function tidyName(raw) {
  const name = cell(raw).trim().replace(/\s+/g, " ");
  if (!/[A-Z]/.test(name) || name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/(^|[\s\-'])([a-z])/g, (_, lead, ch) => lead + ch.toUpperCase());
}

function classScheduleColumns(rows) {
  if (!rows.length) return null;
  const columns = {};
  rows[0].forEach((c, i) => { columns[cell(c).trim().toLowerCase()] = i; });
  const need = ["date", "time", "class name", "participant name"];
  return need.every((h) => h in columns) ? columns : null;
}

export function looksLikeClassSchedule(rows) {
  return !!classScheduleColumns(rows);
}

/** One entry per Ninja per weekly session: { name, day, start, is_ai, classes: [...] } */
export function parseClassSchedule(rows) {
  const columns = classScheduleColumns(rows);
  if (!columns) return [];
  const at = (row, header) => (columns[header] < row.length ? cell(row[columns[header]]).trim() : "");

  const merged = new Map();
  for (const row of rows.slice(1)) {
    const name = tidyName(at(row, "participant name"));
    if (!name) continue;
    const weekday = at(row, "date").split(",")[0].trim();
    const day = DAY_NAMES.has(weekday.toLowerCase()) ? weekday[0].toUpperCase() + weekday.slice(1).toLowerCase() : "";
    const start = slotStartMinutes(at(row, "time"));
    const className = at(row, "class name");

    const key = `${name.toLowerCase()}|${day}|${start}`;
    if (!merged.has(key)) merged.set(key, { name, day, start, is_ai: false, classes: [] });
    const entry = merged.get(key);
    if (AI_CLASS_RE.test(className)) entry.is_ai = true;
    if (className && !entry.classes.includes(className)) entry.classes.push(className);
  }
  return [...merged.values()];
}

export function parseActiveNinjasCsv(rawText) {
  const allRows = parseCSV(rawText);
  if (!allRows.length) return [];
  // Blank rows are meaningful spacing in the grid format, so they are only dropped for flat files.
  if (looksLikeScheduleGrid(allRows)) return parseScheduleGrid(allRows);
  return parseFlatCsv(allRows.filter((row) => row.some((c) => cell(c).trim())));
}
