import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { setEngine } from "../js/core/db.js";
import { setAssetLoader } from "../js/lib/assets.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
globalThis.PDFLib = require(path.join(ROOT, "vendor/pdf-lib.min.js"));

// Default: the real sql.js (SQLite compiled to WebAssembly) - the same engine the browser runs.
// ENGINE=node uses Node's built-in SQLite instead (needs Node 22+ and --experimental-sqlite).
if (process.env.ENGINE === "node") {
  setEngine((await import("./shim_sqljs.mjs")).default);
} else {
  const initSqlJs = require(path.join(ROOT, "vendor/sql-wasm.js"));
  setEngine(await initSqlJs({ wasmBinary: fs.readFileSync(path.join(ROOT, "vendor/sql-wasm.wasm")) }));
}
setAssetLoader(async (p) => new Uint8Array(fs.readFileSync(path.join(ROOT, p))));

let passed = 0, failed = 0;
export function check(name, ok, detail) {
  if (ok) { passed++; } else { failed++; console.log("FAIL:", name, detail !== undefined ? "\n   " + JSON.stringify(detail).slice(0, 600) : ""); }
}
export function finish(label) {
  console.log(`${label}: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}
