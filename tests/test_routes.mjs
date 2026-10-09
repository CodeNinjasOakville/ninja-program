// Replays tests/scenario.json through the browser-side API and compares every response
// with tests/expected.json, which was recorded from the ORIGINAL Python/Flask app.
import fs from "node:fs";
import path from "node:path";
import { ROOT, check, finish } from "./helpers.mjs";
import { openDatabase, closeDatabase } from "../js/core/db.js";
import { handleRequest } from "../js/api/index.js";

const scenario = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/scenario.json"), "utf8"));
const expected = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/expected.json"), "utf8"));

const DROP = new Set(["created_at", "downloadUrl", "bytes"]);
function norm(v) {
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === "object" && !(v instanceof Uint8Array)) {
    return Object.fromEntries(Object.keys(v).filter((k) => !DROP.has(k)).sort().map((k) => [k, norm(v[k])]));
  }
  return v;
}

openDatabase(null);
for (let i = 0; i < scenario.length; i++) {
  const s = scenario[i];
  const file = s.file ? { text: async () => s.file.text.replace(/^﻿/, "") } : undefined;
  let status = 200, data;
  try {
    data = await handleRequest(s.method, s.url, s.body, file);
    if (data && data.bytes) {
      const doc = await globalThis.PDFLib.PDFDocument.load(data.bytes);
      data.pages = doc.getPageCount();
    }
  } catch (e) {
    status = e.status || 500;
    data = { error: e.message };
  }
  const want = expected[i];
  const label = `#${i} ${s.method} ${s.url} ${s.note || ""}`;
  check(label + " status", status === want.status, { got: status, want: want.status, data });
  check(label + " body", JSON.stringify(norm(data)) === JSON.stringify(norm(want.data)), { got: norm(data), want: norm(want.data) });
}
closeDatabase();
finish("route parity with the original Flask app");
