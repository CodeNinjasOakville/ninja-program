// The 3D print queue (Belts & Rewards -> 3D prints, and each Ninja's profile).
// One row per print promised to a Ninja: what it is, where the model is (link and/or a small file
// kept in the row, like every other shared sheet), the date it was promised, and the date it was
// printed (blank while it is waiting). Rules are in js/lib/print_queue.js.
//
// The queue does NOT change "3D prints owed" on Rewards owed by itself. Marking a print as printed
// only records it as given when staff tick that box (record_given), which adds a normal
// "3D Print" row to Rewards given (and can be undone there like any other).

import { conn } from "../core/db.js";
import { route } from "./router.js";
import { ApiError, pyStr, todayISO } from "../lib/util.js";
import { nameKey } from "../lib/belt_match.js";
import { ninjasNamed } from "../lib/ninjas.js";
import { getSummary } from "../lib/rewards.js";
import {
  MAX_FILE_BYTES, base64Size, cleanDate, cleanFileName, cleanLink, daysBetween, printedOrder, queueOrder, sizeText,
} from "../lib/print_queue.js";

// Everything but the file itself (which can be large): lists never load it.
const LIST_COLUMNS = "id, name, ninja_uid, description, model_link, file_name, file_type, file_size, promised_date, printed_date, created_at";

/** 3D prints still owed on Rewards owed, by Ninja name (case/spacing ignored). */
function printsOwedByName() {
  const owed = new Map();
  for (const row of getSummary(conn).rows) owed.set(nameKey(row.name), { name: row.name, prints: row.prints_remaining });
  return owed;
}

/** Every print, each with has_file, its place in the queue (1 = up next) and, if queued, days waited. */
export function listPrints() {
  const rows = conn.all(`SELECT ${LIST_COLUMNS}, (file_data IS NOT NULL AND file_data <> '') AS has_file FROM print_queue`);
  const today = todayISO();
  const queued = rows.filter((r) => !r.printed_date).sort(queueOrder);
  const printed = rows.filter((r) => r.printed_date).sort(printedOrder);
  const owed = printsOwedByName();
  queued.forEach((r, i) => {
    r.position = i + 1;
    r.waiting_days = daysBetween(r.promised_date, today);
  });
  for (const r of rows) {
    r.has_file = !!r.has_file;
    r.prints_owed = (owed.get(nameKey(r.name)) || { prints: 0 }).prints;
  }
  return { queued, printed };
}

/** One Ninja's prints (for the profile): queued ones keep their place in the whole queue. */
export function printsForNinja(ninja) {
  const mine = (r) => r.ninja_uid === ninja.uid || (!r.ninja_uid && nameKey(r.name) === nameKey(ninja.name));
  const { queued, printed } = listPrints();
  return { queued: queued.filter(mine), printed: printed.filter(mine) };
}

/** Checks and tidies what was typed. Returns the columns to save (file only when one was sent). */
function cleanEntry(body, existing) {
  const name = pyStr(body.name).trim().replace(/\s+/g, " ") || (existing && existing.name) || "";
  if (!name) throw new ApiError("Pick the Ninja the print is for.");
  const description = pyStr(body.description).trim();
  const link = cleanLink(body.model_link);
  if (link === null) throw new ApiError("That model link doesn't look like a web address (it should start with https://).");
  const promised = cleanDate(body.promised_date || (existing && existing.promised_date) || todayISO());
  if (!promised) throw new ApiError("The promised date isn't a real date.");

  const entry = { name, description, model_link: link, promised_date: promised };
  if (body.file && body.file.data) {
    const data = String(body.file.data).replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new ApiError("That file could not be read. Try choosing it again.");
    const size = base64Size(data);
    if (size > MAX_FILE_BYTES) {
      throw new ApiError(`That file is ${sizeText(size)}. Files up to ${sizeText(MAX_FILE_BYTES)} can be kept here; ` +
        "for a bigger one, put it in Google Drive (or Tinkercad / Thingiverse) and paste the link instead.");
    }
    Object.assign(entry, {
      file_name: cleanFileName(body.file.name), file_type: pyStr(body.file.type).slice(0, 100),
      file_size: size, file_data: data,
    });
  } else if (body.remove_file) {
    Object.assign(entry, { file_name: "", file_type: "", file_size: 0, file_data: "" });
  }
  const hasFile = entry.file_data !== undefined ? !!entry.file_data : !!(existing && existing.has_file);
  if (!description && !link && !hasFile) throw new ApiError("Say what to print: a short description, a link to the model or a file.");
  return entry;
}

const getPrint = (id) => {
  const row = conn.get(`SELECT ${LIST_COLUMNS}, (file_data IS NOT NULL AND file_data <> '') AS has_file FROM print_queue WHERE id = ?`, [id]);
  if (!row) throw new ApiError("That print is no longer in the list.", 404);
  return row;
};

// {queued: [in printing order], printed: [newest first]}
route("GET", "/api/prints", () => listPrints());

// Names to pick from when adding a print: every Ninja, with the 3D prints they are owed and have queued.
route("GET", "/api/prints/ninjas", () => {
  const owed = printsOwedByName();
  const queued = new Map();
  for (const r of conn.all("SELECT name FROM print_queue WHERE printed_date IS NULL OR printed_date = ''")) {
    queued.set(nameKey(r.name), (queued.get(nameKey(r.name)) || 0) + 1);
  }
  return conn.all("SELECT uid, name FROM ninjas ORDER BY name COLLATE NOCASE").map((n) => ({
    uid: n.uid, name: n.name,
    prints_owed: (owed.get(nameKey(n.name)) || { prints: 0 }).prints,
    queued: queued.get(nameKey(n.name)) || 0,
  }));
});

// One print's file:{file_name, file_type, file_data (base64)}
route("GET", "/api/prints/:id/file", ({ params }) => {
  const row = conn.get("SELECT file_name, file_type, file_data FROM print_queue WHERE id = ?", [params.id]);
  if (!row || !row.file_data) throw new ApiError("That print has no file.", 404);
  return { file_name: cleanFileName(row.file_name), file_type: row.file_type || "", file_data: row.file_data };
});

// Body: {name, description, model_link, promised_date (default today), file: {name, type, data (base64)}}
route("POST", "/api/prints", ({ body }) => {
  const entry = cleanEntry(body, null);
  const ninja = ninjasNamed(conn, entry.name)[0];
  if (ninja) entry.name = ninja.name;
  const cols = ["name", "ninja_uid", ...Object.keys(entry).filter((k) => k !== "name")];
  const values = [entry.name, ninja ? ninja.uid : null, ...cols.slice(2).map((k) => entry[k])];
  conn.run(`INSERT INTO print_queue (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, values);
  const { id } = conn.get("SELECT max(id) AS id FROM print_queue");
  return { ok: true, id };
});

// Body: same as adding; a file is only replaced when a new one is sent, removed with remove_file.
route("PUT", "/api/prints/:id", ({ params, body }) => {
  const existing = getPrint(params.id);
  const entry = cleanEntry(body, existing);
  if (nameKey(entry.name) !== nameKey(existing.name)) {
    const ninja = ninjasNamed(conn, entry.name)[0];
    entry.ninja_uid = ninja ? ninja.uid : null;
    if (ninja) entry.name = ninja.name;
  }
  if (existing.printed_date && body.printed_date !== undefined) {
    const printed = cleanDate(body.printed_date);
    if (!printed) throw new ApiError("The printed date isn't a real date.");
    entry.printed_date = printed;
  }
  const cols = Object.keys(entry);
  conn.run(`UPDATE print_queue SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`, [...cols.map((c) => entry[c]), params.id]);
  return { ok: true };
});

// Body: {printed_date (default today), record_given: true to also add 1 x 3D Print to Rewards given}
route("POST", "/api/prints/:id/printed", ({ params, body }) => {
  const print = getPrint(params.id);
  if (print.printed_date) throw new ApiError(`That print was already marked printed on ${print.printed_date}.`);
  const printed = cleanDate(body.printed_date || todayISO());
  if (!printed) throw new ApiError("The printed date isn't a real date.");
  let recorded = false;
  conn.transaction(() => {
    conn.run("UPDATE print_queue SET printed_date = ? WHERE id = ?", [printed, params.id]);
    if (body.record_given) {
      const owed = printsOwedByName().get(nameKey(print.name));
      if (!owed || owed.prints < 1) {
        throw new ApiError(`${print.name} has no 3D prints owed on Rewards owed, so it can't be recorded as given. ` +
          "Untick that box to just mark it printed.");
      }
      conn.run("INSERT INTO receipts (date, name, reward_type, amount, details, entry_type) VALUES (?, ?, ?, ?, ?, ?)",
        [printed, owed.name, "3D Print", 1, ("Print queue: " + (print.description || print.file_name || "3D print")).slice(0, 200), "Reward Given"]);
      recorded = true;
    }
  });
  return { ok: true, recorded_given: recorded };
});

// Back into the queue (marked printed by mistake). Anything recorded under Rewards given stays there.
route("POST", "/api/prints/:id/unprinted", ({ params }) => {
  getPrint(params.id);
  conn.run("UPDATE print_queue SET printed_date = NULL WHERE id = ?", [params.id]);
  return { ok: true };
});

route("DELETE", "/api/prints/:id", ({ params }) => {
  conn.run("DELETE FROM print_queue WHERE id = ?", [params.id]);
  return { ok: true };
});
