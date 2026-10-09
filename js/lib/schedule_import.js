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
  "assistant instructor": "is_ai",
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

export function parseActiveNinjasCsv(rawText) {
  const allRows = parseCSV(rawText);
  if (!allRows.length) return [];
  // Blank rows are meaningful spacing in the grid format, so they are only dropped for flat files.
  if (looksLikeScheduleGrid(allRows)) return parseScheduleGrid(allRows);
  return parseFlatCsv(allRows.filter((row) => row.some((c) => cell(c).trim())));
}
