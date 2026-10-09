// Minimal RFC 4180 CSV reader that behaves like Python's csv.reader / csv.DictReader
// (quoted cells may contain commas, quotes ("") and newlines).

export function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  let sawAnything = false;
  const s = String(text || "").replace(/^﻿/, "");

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    sawAnything = true;
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell); cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      // A completely empty line becomes [] like Python's csv.reader
      rows.push(row.length === 0 && cell === "" ? [] : (row.push(cell), row));
      row = []; cell = "";
      sawAnything = false;
    } else {
      cell += ch;
    }
  }
  if (sawAnything || row.length || cell !== "") {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// Python csv.DictReader: first non-blank row = headers, blank rows skipped,
// short rows give missing values (undefined).
export function readDicts(text) {
  const rows = parseCSV(text).filter((r) => r.length > 0);
  if (!rows.length) return { fieldnames: null, records: [] };
  const fieldnames = rows[0];
  const records = rows.slice(1).map((r) => {
    const rec = {};
    fieldnames.forEach((name, i) => { if (!(name in rec)) rec[name] = r[i]; });
    return rec;
  });
  return { fieldnames, records };
}
