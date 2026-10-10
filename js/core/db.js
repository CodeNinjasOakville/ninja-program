// SQLite (via sql.js / WebAssembly) - the only file that talks to the SQL engine.
// Port of database.py: same tables, same starter settings, same helper behaviour.
//
// To change the database layout later, edit SCHEMA (new tables/columns) and add a
// numbered step to MIGRATIONS below so existing saved data is upgraded automatically.

export const SCHEMA = `
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
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS belt_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    old_belt TEXT,
    new_belt TEXT,
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
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Currently-enrolled Ninjas and which weekly session they attend.
-- is_ai marks a session that is an Artificial Intelligence class.
CREATE TABLE IF NOT EXISTS active_ninjas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    day TEXT,
    time_slot TEXT,
    is_ai INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`;

// Starter dropdown values (editable from the Settings tab).
// belt_options is ORDER-SENSITIVE: lowest to highest belt.
export const DEFAULT_SETTINGS = {
  gbs_types: ["Intro GBS", "Follow-up GBS", "Trial Class"],
  coding_experience_options: ["None", "Some", "Experienced"],
  follow_up_options: ["Not yet", "Called", "Emailed", "No response"],
  gbs_completed_options: ["Yes", "No"],
  belt_options: [
    "White", "Yellow", "Orange", "Green", "Blue", "Purple",
    "Brown", "Red", "Black", "Bronze", "Silver", "Platinum", "Gold",
  ],
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
export const MIGRATIONS = [];

const SQLITE_MAGIC = "SQLite format 3\u0000";

let SQL = null;
let database = null;
let dirty = false;

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
  },
  runMany(sql, rows) {
    rows.forEach((r) => this.run(sql, r));
  },
  /** Runs fn inside a transaction; rolls back if it throws. */
  transaction(fn) {
    database.run("BEGIN");
    try {
      const result = fn();
      database.run("COMMIT");
      dirty = true;
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
    const known = ["leads", "belt_entries", "active_ninjas", "receipts", "settings"].filter((t) => tables.includes(t));
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
// shared Supabase tables; "pk" is the column that identifies a row.
export const SYNC_TABLES = {
  leads: { pk: "id" },
  belt_entries: { pk: "id" },
  receipts: { pk: "id" },
  active_ninjas: { pk: "id" },
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
export function attachDatabase(handle) { database = handle; }
