// Loads the SQLite engine (sql.js: SQLite compiled to WebAssembly) and hands it to db.js.
// The two files it needs are vendor/sql-wasm.js (loaded by index.html) and vendor/sql-wasm.wasm.

import { setEngine } from "./db.js";

export async function loadEngine() {
  if (typeof globalThis.initSqlJs !== "function") {
    throw new Error("The database engine did not load (vendor/sql-wasm.js is missing or blocked).");
  }
  const SQL = await globalThis.initSqlJs({ locateFile: (file) => "vendor/" + file });
  setEngine(SQL);
  return SQL;
}
