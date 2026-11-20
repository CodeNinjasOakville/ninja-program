// Replays tests/scenario.json through the browser-side API and compares every response
// with tests/expected.json, which was recorded from the ORIGINAL Python/Flask app.
import fs from "node:fs";
import path from "node:path";
import { ROOT, check, finish } from "./helpers.mjs";
import { openDatabase, closeDatabase } from "../js/core/db.js";
import { handleRequest } from "../js/api/index.js";

// expected.json was recorded on 2026-10-09; pin "today" to that date so dated fields
// (lead dates, receipt dates, PDF filenames) match on any day the tests run.
const RealDate = Date;
const FROZEN = new RealDate(2026, 9, 9, 12).getTime();
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [FROZEN])); }
  static now() { return FROZEN; }
};

const scenario = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/scenario.json"), "utf8"));
const expected = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/expected.json"), "utf8"));

// The Ninja/family link fields were added after the recording; tests/test_ninjas.mjs covers them.
// So was the jr_skills setting (tests/test_jr_skills.mjs).
// Large / small coins were dropped on purpose (Ninja Bucks are one number now), and
// certificates_printed was added; tests/test_certificates.mjs covers both.
const DROP = new Set(["created_at", "downloadUrl", "bytes", "ninja_uid", "family_uid", "family_name", "family_email", "family_phone", "enrolled", "beltsUpdated", "jr_skills",
  "large_coins", "small_coins", "large_coins_remaining", "small_coins_remaining", "certificates_printed", "printed",
  "inquiry_status", "inquiry_email", "inquiry_message_id"]); // inquiry columns: tests/test_inquiry_email.mjs

// Changes made on purpose since the recording:
//  - giving coins: coins are not a reward any more, so that step now has nothing to give;
//  - saving certificates records them as "Certificate Printed", which is not "given".
function intended(step, want) {
  if (step.body && ("small_coins" in step.body || "large_coins" in step.body)) {
    return { status: 400, data: { error: "No reward amounts were entered." } };
  }
  const data = structuredClone(want.data);
  if (Array.isArray(data)) {
    for (const r of data) if (r && r.entry_type === "Certificate Printed") r.reward_type = "Certificate Printed";
  }
  // Every certificate receipt in the recording was a printed one, so none count as given now.
  // (No belts are handed out in the scenario, so certificates owed = belts owed.)
  if (data && data.overall && data.overall.certificates && data.overall.certificates.given) {
    data.overall.certificates.given = 0;
    data.overall.certificates.remaining = data.overall.certificates.earned;
    for (const row of data.rows) row.certificates_remaining = row.belts_remaining;
  }
  return { ...want, data };
}
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
  const want = intended(s, expected[i]);
  const label = `#${i} ${s.method} ${s.url} ${s.note || ""}`;
  check(label + " status", status === want.status, { got: status, want: want.status, data });
  check(label + " body", JSON.stringify(norm(data)) === JSON.stringify(norm(want.data)), { got: norm(data), want: norm(want.data) });
}
closeDatabase();
finish("route parity with the original Flask app");
