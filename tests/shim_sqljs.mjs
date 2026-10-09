// Test-only stand-in for sql.js, backed by Node's built-in SQLite (node:sqlite).
// It implements just the slice of the sql.js API that js/core/db.js uses, so the real
// SQL in the app runs against a real SQLite engine in tests. The browser uses real sql.js.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

class Statement {
  constructor(db, sql) { this.stmt = db.prepare(sql); this.rows = []; this.i = -1; }
  bind(params) { this.rows = this.stmt.all(...(params || [])); this.i = -1; return true; }
  step() { this.i += 1; return this.i < this.rows.length; }
  getAsObject() { return { ...this.rows[this.i] }; }
  free() {}
}

class Database {
  constructor(bytes) {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-"));
    this.file = path.join(this.dir, "db.sqlite");
    if (bytes && bytes.length) fs.writeFileSync(this.file, bytes);
    this.db = new DatabaseSync(this.file);
  }
  exec(sql) {
    if (/^\s*(select|pragma)\b[^;]*;?\s*$/i.test(sql)) {
      const rows = this.db.prepare(sql).all();
      if (!rows.length) return [];
      const columns = Object.keys(rows[0]);
      return [{ columns, values: rows.map((r) => columns.map((c) => r[c])) }];
    }
    this.db.exec(sql);
    return [];
  }
  run(sql, params) { this.db.prepare(sql).run(...(params || [])); }
  prepare(sql) { return new Statement(this.db, sql); }
  export() {
    const out = path.join(this.dir, "export.sqlite");
    fs.rmSync(out, { force: true });
    this.db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
    return new Uint8Array(fs.readFileSync(out));
  }
  close() { try { this.db.close(); } catch (_) {} fs.rmSync(this.dir, { recursive: true, force: true }); }
}

export default { Database };
