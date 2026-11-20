// SQLite (via sql.js / WebAssembly) - the only file that talks to the SQL engine.
// Port of database.py: same tables, same starter settings, same helper behaviour.
//
// To change the database layout later, edit SCHEMA (new tables/columns) and add a
// numbered step to MIGRATIONS below so existing saved data is upgraded automatically.

export const SCHEMA = `
-- One row per family / paying customer (the "Customer" in a MyStudio export).
-- uid is made in the browser (see js/lib/ninjas.js) so every sheet can point at it right away.
CREATE TABLE IF NOT EXISTS families (
    uid TEXT PRIMARY KEY,
    name TEXT,
    email TEXT,
    phone TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- One row per child (the "Participant" in a MyStudio export). This is where a Ninja's name,
-- belt and family live. Every other sheet links here through its ninja_uid column:
--   active_ninjas (their classes), belt_entries, receipts, jr_notes, leads.
-- A Ninja with no classes in active_ninjas is not currently enrolled, but keeps their history.
CREATE TABLE IF NOT EXISTS ninjas (
    uid TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    belt TEXT DEFAULT '',
    family_uid TEXT,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_number INTEGER,
    ninja_name TEXT NOT NULL,
    parent_name TEXT,
    phone_number TEXT,
    email TEXT,
    age TEXT,
    gbs_type TEXT,
    staff_name TEXT,
    coding_experience TEXT,
    comments TEXT,
    gbs_date TEXT,
    gbs_time TEXT,
    post_gbs_follow_up TEXT,
    gbs_completed TEXT,
    lead_date TEXT,
    ninja_uid TEXT,
    -- Leads added automatically from a CRM inquiry email (supabase/functions/lead-inquiry):
    -- inquiry_status 'new' until someone checks it and marks it complete ('' after that).
    inquiry_status TEXT DEFAULT '',
    inquiry_email TEXT,
    inquiry_message_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS belt_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    old_belt TEXT,
    new_belt TEXT,
    ninja_uid TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Every reward actually given (ninja bucks, coins, 3D prints, certificates,
-- new physical belts) is recorded here, one row per reward type per transaction.
-- belt_entries = what was EARNED; receipts = what was GIVEN (see js/lib/rewards.js).
CREATE TABLE IF NOT EXISTS receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    name TEXT NOT NULL,
    reward_type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    details TEXT,
    entry_type TEXT,
    ninja_uid TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- One row per weekly class a Ninja attends (the table keeps its old name). ninja_uid says whose
-- class it is; name and belt are copies of the Ninja's, kept up to date by js/lib/ninjas.js.
-- is_ai marks a session that is an Artificial Intelligence class; is_jr a JR (ScratchJr) class.
-- belt is the Ninja's belt, the same on every one of their rows (see js/lib/belt_match.js).
CREATE TABLE IF NOT EXISTS active_ninjas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    day TEXT,
    time_slot TEXT,
    is_ai INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    belt TEXT DEFAULT '',
    is_jr INTEGER NOT NULL DEFAULT 0,
    ninja_uid TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- What each JR Ninja is working on, written by the senseis. One row per note, matched to the
-- Ninja by name (ignoring case/spacing), newest shown first.
CREATE TABLE IF NOT EXISTS jr_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    note TEXT NOT NULL,
    author TEXT,
    ninja_uid TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- JR skills checklist: a status a sensei set by hand for one skill of one JR Ninja
-- ("working", "needs_work" or "done"). Skills nobody set are suggested from the JR notes instead
-- (js/lib/jr_skills.js), so they need no row. One row per Ninja + skill.
CREATE TABLE IF NOT EXISTS jr_skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    ninja_uid TEXT,
    skill TEXT NOT NULL,
    status TEXT NOT NULL,
    author TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- The 3D print queue: one row per print promised to a Ninja (see js/api/prints.js). The model is
-- a link and/or a small file kept right here (file_data = base64), shared like every other sheet.
-- printed_date is blank while it waits; the queue is oldest promised_date first.
CREATE TABLE IF NOT EXISTS print_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    ninja_uid TEXT,
    description TEXT,
    model_link TEXT,
    file_name TEXT,
    file_type TEXT,
    file_size INTEGER,
    file_data TEXT,
    promised_date TEXT NOT NULL,
    printed_date TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`;

// Starter dropdown values (editable from the Settings tab).
// belt_options is ORDER-SENSITIVE: lowest to highest belt.
import { DEFAULT_JR_SKILLS } from "../lib/jr_skills.js";

export const DEFAULT_SETTINGS = {
  gbs_types: ["Intro GBS", "Follow-up GBS", "Trial Class"],
  coding_experience_options: ["None", "Some", "Experienced"],
  follow_up_options: ["Not yet", "Called", "Emailed", "No response"],
  gbs_completed_options: ["Yes", "No"],
  belt_options: [
    "White", "Yellow", "Orange", "Green", "Blue", "Purple",
    "Brown", "Red", "Black", "Bronze", "Silver", "Platinum", "Gold",
  ],
  // "Area: Skill | words to look for in JR notes" (see js/lib/jr_skills.js)
  jr_skills: DEFAULT_JR_SKILLS,
  schedule_days: [
    "Monday", "Tuesday", "Wednesday", "Thursday",
    "Friday", "Saturday", "Sunday",
  ],
};

// Ninja Bucks / prints / certificates / new-belts earned per level progressed.
export const REWARDS_PER_LEVEL = { ninja_bucks: 5, prints: 1, certificates: 1, belts: 1 };

// Future schema upgrades go here, in order. Each runs once; the position in the
// list is stored in SQLite's built-in user_version. Example:
//   (conn) => conn.run("ALTER TABLE leads ADD COLUMN source TEXT"),
export const MIGRATIONS = [
  // 1: Active Ninjas get their own belt. (Fresh databases already have it from SCHEMA.)
  (conn) => {
    if (!conn.all("PRAGMA table_info(active_ninjas)").some((c) => c.name === "belt")) {
      conn.run("ALTER TABLE active_ninjas ADD COLUMN belt TEXT DEFAULT ''");
    }
  },
  // 2: JR classes. (The jr_notes table comes from SCHEMA.)
  (conn) => {
    if (!conn.all("PRAGMA table_info(active_ninjas)").some((c) => c.name === "is_jr")) {
      conn.run("ALTER TABLE active_ninjas ADD COLUMN is_jr INTEGER NOT NULL DEFAULT 0");
    }
  },
  // 3: Ninja + family records; every sheet links to its Ninja. (The new tables come from SCHEMA.)
  (conn) => {
    for (const table of ["leads", "belt_entries", "receipts", "active_ninjas", "jr_notes"]) {
      if (!conn.all(`PRAGMA table_info(${table})`).some((c) => c.name === "ninja_uid")) {
        conn.run(`ALTER TABLE ${table} ADD COLUMN ninja_uid TEXT`);
      }
    }
  },
  // 4: Leads from CRM inquiry emails.
  (conn) => {
    const cols = conn.all("PRAGMA table_info(leads)").map((c) => c.name);
    if (!cols.includes("inquiry_status")) conn.run("ALTER TABLE leads ADD COLUMN inquiry_status TEXT DEFAULT ''");
    if (!cols.includes("inquiry_email")) conn.run("ALTER TABLE leads ADD COLUMN inquiry_email TEXT");
    if (!cols.includes("inquiry_message_id")) conn.run("ALTER TABLE leads ADD COLUMN inquiry_message_id TEXT");
  },
];

const SQLITE_MAGIC = "SQLite format 3\u0000";

let SQL = null;
let database = null;
let dirty = false;
let version = 0; // goes up on every write; lets the router know when links need checking

/** A number that changes whenever anything in the database has been written. */
export function dataVersion() { return version; }

/** Browser: pass the result of initSqlJs(). Tests pass a compatible shim. */
export function setEngine(engine) {
  SQL = engine;
}

export function looksLikeSqlite(bytes) {
  if (!bytes || bytes.length < 16) return false;
  for (let i = 0; i < SQLITE_MAGIC.length; i++) {
    if (bytes[i] !== SQLITE_MAGIC.charCodeAt(i)) return false;
  }
  return true;
}

function clean(params) {
  return (params || []).map((p) => (p === undefined ? null : typeof p === "boolean" ? (p ? 1 : 0) : p));
}

export const conn = {
  /** All rows as plain objects. */
  all(sql, params) {
    const stmt = database.prepare(sql);
    try {
      stmt.bind(clean(params));
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  },
  /** First row or undefined. */
  get(sql, params) {
    return this.all(sql, params)[0];
  },
  /** INSERT / UPDATE / DELETE. */
  run(sql, params) {
    database.run(sql, clean(params));
    dirty = true;
    version++;
  },
  runMany(sql, rows) {
    rows.forEach((r) => this.run(sql, r));
  },
  /** Runs fn inside a transaction; rolls back if it throws. */
  transaction(fn) {
    const before = version;
    database.run("BEGIN");
    try {
      const result = fn();
      database.run("COMMIT");
      if (version !== before) dirty = true;
      return result;
    } catch (error) {
      try { database.run("ROLLBACK"); } catch (_) { /* nothing to roll back */ }
      throw error;
    }
  },
};

function prepareSchema() {
  database.exec(SCHEMA);
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    database.run("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", [key, JSON.stringify(value)]);
  }
  const row = database.exec("PRAGMA user_version");
  let version = row.length ? row[0].values[0][0] : 0;
  while (version < MIGRATIONS.length) {
    MIGRATIONS[version](conn);
    version += 1;
    database.run(`PRAGMA user_version = ${version}`);
  }
}

/** Open an existing database image (Uint8Array) or start a fresh empty one. */
export function openDatabase(bytes) {
  if (!SQL) throw new Error("Database engine is not loaded yet.");
  closeDatabase();
  if (bytes && bytes.length && !looksLikeSqlite(bytes)) {
    throw new Error("That file is not a SQLite database.");
  }
  database = bytes && bytes.length ? new SQL.Database(bytes) : new SQL.Database();
  prepareSchema();
  dirty = false;
  version++;
  return conn;
}

export function exportDatabase() {
  return database.export();
}

export function closeDatabase() {
  if (database) {
    try { database.close(); } catch (_) { /* already closed */ }
  }
  database = null;
}

export function isOpen() {
  return !!database;
}

/** True if anything changed since the last call (the router uses this to trigger a save). */
export function takeDirty() {
  const was = dirty;
  dirty = false;
  return was;
}

export function getSetting(key, fallback) {
  const row = conn.get("SELECT value FROM settings WHERE key = ?", [key]);
  if (!row) return fallback !== undefined ? fallback : [];
  return JSON.parse(row.value);
}

/** Quick sanity check used before importing a legacy ninja_system.db. */
export function describeImportable(bytes) {
  if (!looksLikeSqlite(bytes)) return { ok: false, reason: "That file is not a SQLite database." };
  const probe = new SQL.Database(bytes);
  try {
    const res = probe.exec("SELECT name FROM sqlite_master WHERE type='table'");
    const tables = res.length ? res[0].values.map((v) => v[0]) : [];
    const known = ["leads", "belt_entries", "active_ninjas", "jr_notes", "jr_skills", "print_queue", "receipts", "settings", "ninjas", "families"].filter((t) => tables.includes(t));
    if (!known.length) return { ok: false, reason: "That database doesn't look like a Ninja Program database." };
    return { ok: true, tables: known };
  } catch (error) {
    return { ok: false, reason: "Could not read that database: " + error.message };
  } finally {
    probe.close();
  }
}

// ---------------------------------------------------------------------------------------------
// Team-sync helpers (used by js/sync/sync.js). The local SQLite copy is a working copy of the
// shared Supabase tables; "pk" is the column that identifies a row. Tables keyed by "uid" get
// their key from the browser (so links never change); the others get their id from the server.
export const SYNC_TABLES = {
  families: { pk: "uid" },
  ninjas: { pk: "uid" },
  leads: { pk: "id" },
  belt_entries: { pk: "id" },
  receipts: { pk: "id" },
  active_ninjas: { pk: "id" },
  jr_notes: { pk: "id" },
  jr_skills: { pk: "id" },
  print_queue: { pk: "id" },
  settings: { pk: "key" },
};

export function tableColumns(table) {
  return conn.all(`PRAGMA table_info(${table})`).map((c) => c.name);
}

/** Start from an empty local copy with NO starter settings (the server's settings are loaded instead). */
export function openEmptyForSync() {
  openDatabase();
  database.run("DELETE FROM settings");
  dirty = false;
}

/** Add any missing starter settings (only used when the shared database has none yet). */
export function seedDefaultSettings() {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    database.run("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", [key, JSON.stringify(value)]);
  }
}

/**
 * Replace everything in the working copy with the contents of an old ninja_system.db.
 * The sync engine then pushes the difference to the shared database.
 */
export function replaceFromLegacy(bytes) {
  const check = describeImportable(bytes);
  if (!check.ok) throw new Error(check.reason);
  const src = new SQL.Database(bytes);
  try {
    const have = new Set((src.exec("SELECT name FROM sqlite_master WHERE type='table'")[0]?.values || []).map((v) => v[0]));
    database.run("BEGIN");
    try {
      for (const table of Object.keys(SYNC_TABLES)) {
        if (!have.has(table)) continue;
        const cols = tableColumns(table);
        const srcCols = (src.exec(`PRAGMA table_info(${table})`)[0]?.values || []).map((v) => v[1]);
        const use = cols.filter((c) => srcCols.includes(c));
        database.run(`DELETE FROM ${table}`);
        const res = src.exec(`SELECT ${use.join(",")} FROM ${table}`);
        const stmt = `INSERT OR REPLACE INTO ${table} (${use.join(",")}) VALUES (${use.map(() => "?").join(",")})`;
        for (const row of res.length ? res[0].values : []) database.run(stmt, clean(row));
      }
      if (!have.has("settings")) seedDefaultSettings();
      database.run("COMMIT");
    } catch (error) {
      try { database.run("ROLLBACK"); } catch (_) { /* nothing to roll back */ }
      throw error;
    }
    dirty = true;
    version++;
  } finally {
    src.close();
  }
}

/** Change a row's id (sync uses this to swap a temporary local id for the server's id). */
export function renameRowIds(table, pairs) {
  database.run("BEGIN");
  try {
    for (const [from] of pairs) database.run(`UPDATE ${table} SET id = -id WHERE id = ?`, [from]);
    for (const [from, to] of pairs) database.run(`UPDATE ${table} SET id = ? WHERE id = ?`, [to, -from]);
    database.run("COMMIT");
  } catch (error) {
    try { database.run("ROLLBACK"); } catch (_) { /* nothing to roll back */ }
    throw error;
  }
}

/** For tests that simulate two people: take the open working copy out / put one back. */
export function detachDatabase() { const d = database; database = null; return d; }
export function attachDatabase(handle) { database = handle; version++; }
