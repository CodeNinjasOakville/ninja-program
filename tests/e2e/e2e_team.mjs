// Browser test of the team version against the in-memory mock Supabase (no real account needed).
// Usage: see tests/e2e/README.md
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { createMockSupabase } from "../mock_supabase.mjs";

const BASE = process.env.BASE || "http://127.0.0.1:8766/index.html";
const LEGACY_DB = process.env.LEGACY_DB;
const mock = createMockSupabase();
const PW_A = "passw0rd-long-1", PW_B = "passw0rd-long-2";
let passed = 0, failed = 0;
const check = (name, ok, detail) => { if (ok) { passed++; console.log("PASS ", name); } else { failed++; console.log("FAIL ", name, detail !== undefined ? "-> " + JSON.stringify(detail).slice(0, 300) : ""); } };

const browser = await chromium.launch();
const foreign = [], problems = [];
async function newPerson() {
  const context = await browser.newContext({ acceptDownloads: true });
  await context.route("https://mock.supabase.co/**", async (route) => {
    const req = route.request();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PUT,PATCH,OPTIONS", "content-type": "application/json" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    let res;
    try { res = await mock.fetch(req.url(), { method: req.method(), headers: req.headers(), body: req.postData() || undefined }); }
    catch (_) { return route.abort("internetdisconnected"); }
    await route.fulfill({ status: res.status, headers: cors, body: await res.text() });
  });
  context.on("request", (r) => { const u = new URL(r.url()); if (!["127.0.0.1", "mock.supabase.co"].includes(u.hostname) && u.protocol.startsWith("http")) foreign.push(r.url()); });
  const page = await context.newPage();
  page.on("console", (m) => { if (["error", "warning"].includes(m.type()) && !/Failed to load resource/.test(m.text())) problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(String(e)));
  return { context, page };
}
const count = (page, url) => page.evaluate(async (u) => (await window.ninjaApi("GET", u)).length, url);
async function signIn(page, email, pw, { stay = false } = {}) {
  await page.goto(BASE);
  await page.waitForSelector("#loginEmail");
  await page.fill("#loginEmail", email); await page.fill("#loginPassword", pw);
  if (stay) await page.check("#loginRemember");
  await page.click("button:has-text('Sign in')");
}
async function dialog(page, values, submit) {
  const box = page.locator(".modal-overlay.open");
  await box.waitFor();
  const inputs = box.locator("input:not([hidden]), select");
  for (const [i, v] of Object.entries(values)) {
    if (v && v.file) await inputs.nth(Number(i)).setInputFiles(v.file); else await inputs.nth(Number(i)).fill(v);
  }
  await box.locator(`button[type=submit]:has-text("${submit}")`).click();
}

// ------------------------------------------------------------------ 1. sign-in
console.log("\n=== 1. Sign-in");
const A = await newPerson();
await A.page.goto(BASE);
await A.page.waitForSelector("#loginEmail");
check("the app is hidden until signed in", await A.page.locator("#app").isHidden());
await A.page.fill("#loginEmail", "a@example.com"); await A.page.fill("#loginPassword", "wrong-password-xyz");
await A.page.click("button:has-text('Sign in')");
await A.page.waitForSelector(".lock-error.show");
check("wrong password shows a friendly message", /isn't right/.test(await A.page.locator(".lock-error.show").innerText()));
check("still no app after a wrong password", await A.page.locator("#app").isHidden());
await A.page.fill("#loginPassword", PW_A);
await A.page.click("button:has-text('Sign in')");
await A.page.waitForSelector("#app", { state: "visible", timeout: 30000 });
check("correct password opens the app", true);
await A.page.waitForFunction(() => document.getElementById("saveStatus").textContent === "Synced", null, { timeout: 15000 });
check("status shows Synced", true);
check("starter settings were created on the server", mock.tables.settings.length >= 6, mock.tables.settings.length);
check("nothing readable by an anonymous visitor", await (async () => { const r = await mock.fetch(mock.url + "/rest/v1/leads", { headers: { apikey: "anon", authorization: "Bearer anon" } }); return r.status === 401; })());

// ------------------------------------------------------------------ 2. import old data (admin)
console.log("\n=== 2. Import the old database");
await A.page.click('.tab-btn[data-tab="security"]');
await A.page.click("button:has-text('Replace ALL team data')");
await dialog(A.page, { 0: { file: LEGACY_DB }, 1: "REPLACE" }, "Replace everything");
await A.page.waitForSelector(".banner.success.show", { timeout: 120000 });
check("import finished", /team's data now matches/.test(await A.page.locator("#securityRoot .banner.show").innerText()));
check("server holds all 1639 leads", mock.tables.leads.filter((r) => !r.deleted).length === 1639, mock.tables.leads.length);
check("server holds belts, active ninjas, receipts", mock.tables.belt_entries.length === 64 && mock.tables.active_ninjas.filter((r) => !r.deleted).length === 85 && mock.tables.receipts.length === 139, [mock.tables.belt_entries.length, mock.tables.active_ninjas.length, mock.tables.receipts.length]);
check("rows have server-issued ids", mock.tables.leads.every((r) => Number.isInteger(r.id)));

// ------------------------------------------------------------------ 3. teammate
console.log("\n=== 3. A teammate signs in on another computer");
const B = await newPerson();
await B.page.addInitScript(() => localStorage.setItem("ninja/.pollMs", "1500"));
await A.page.evaluate(() => localStorage.setItem("ninja/.pollMs", "1500"));
await signIn(B.page, "b@example.com", PW_B);
await B.page.waitForSelector("#app", { state: "visible", timeout: 60000 });
check("teammate sees every lead without creating a vault", await count(B.page, "/api/leads") === 1639);
check("teammate sees active ninjas", await count(B.page, "/api/active-ninjas") === 85);
await B.page.waitForFunction(() => document.getElementById("saveStatus").textContent === "Synced");

console.log("\n=== 4. Live changes between the two");
await A.page.click('.tab-btn[data-tab="leads"]');
await A.page.evaluate(() => window.ninjaApi("POST", "/api/leads", { ninja_name: "Zelda From A", parent_name: "Pat" }));
await B.page.waitForFunction(async () => (await window.ninjaApi("GET", "/api/leads?q=zelda")).length === 1, null, { timeout: 30000 });
check("a lead added by A reaches B automatically", true);
await B.page.click('.tab-btn[data-tab="leads"]');
await B.page.waitForFunction(() => document.body.innerText.includes("Zelda From A"), null, { timeout: 15000 });
check("B's screen shows it without reloading", true);
await B.page.evaluate(() => window.ninjaApi("POST", "/api/leads", { ninja_name: "Yuri From B" }));
await A.page.waitForFunction(async () => (await window.ninjaApi("GET", "/api/leads?q=yuri")).length === 1, null, { timeout: 30000 });
check("a lead added by B reaches A", true);
const idA = await A.page.evaluate(async () => (await window.ninjaApi("GET", "/api/leads?q=zelda"))[0].id);
const idB = await B.page.evaluate(async () => (await window.ninjaApi("GET", "/api/leads?q=zelda"))[0].id);
check("both computers use the same id for the same lead", idA === idB && Number.isInteger(idA), [idA, idB]);
await B.page.evaluate((id) => window.ninjaApi("DELETE", "/api/leads/" + id), idB);
await A.page.waitForFunction(async () => (await window.ninjaApi("GET", "/api/leads?q=zelda")).length === 0, null, { timeout: 30000 });
check("a delete by B disappears on A", true);

console.log("\n=== 5. Offline then back online");
mock.stats.failNext = 100000;
await B.page.evaluate(() => window.ninjaApi("POST", "/api/leads", { ninja_name: "Offline Olivia" }));
await B.page.waitForFunction(() => document.getElementById("saveStatus").textContent.startsWith("NOT SAVED"), null, { timeout: 15000 });
check("offline shows a clear 'NOT SAVED' warning", true);
{ const n = await count(B.page, "/api/leads?q=offline%20olivia"); check("the change is still on B's screen", n === 1, n); }
mock.stats.failNext = 0;
await B.page.waitForFunction(() => document.getElementById("saveStatus").textContent === "Synced", null, { timeout: 30000 });
check("back online: it saves by itself", mock.tables.leads.some((r) => r.ninja_name === "Offline Olivia"));

// ------------------------------------------------------------------ 6. sessions
console.log("\n=== 6. Staying signed in and signing out");
const tokenInLocal = await A.page.evaluate(() => Object.keys(localStorage).filter((k) => k.endsWith(".login")).length);
check("not ticking 'keep me signed in' keeps the login out of long-term storage", tokenInLocal === 0, tokenInLocal);
await A.page.reload();
await A.page.waitForSelector("#app", { state: "visible", timeout: 60000 });
check("a reload in the same tab stays signed in", true);
await B.page.click('.tab-btn[data-tab="security"]');
await B.page.click("#lockNowBtn");
await B.page.waitForSelector("#loginEmail");
check("sign out returns to the sign-in screen", true);
check("sign out leaves no login or data behind", await B.page.evaluate(async () => localStorage.length === 1 || !Object.keys(localStorage).some((k) => k.endsWith(".login"))) && (await B.page.evaluate(() => sessionStorage.length)) === 0);
const C = await newPerson();
await signIn(C.page, "b@example.com", PW_B, { stay: true });
await C.page.waitForSelector("#app", { state: "visible", timeout: 60000 });
await C.page.close();
const C2 = await C.context.newPage();
await C2.goto(BASE);
await C2.waitForSelector("#app", { state: "visible", timeout: 60000 });
check("'keep me signed in' survives closing the tab", true);
await C.context.close();

// ------------------------------------------------------------------ 7. invite link / reset link
console.log("\n=== 7. Invite link");
const D = await newPerson();
const hash = mock.invite("new@example.com");
await D.page.goto(BASE + hash);
await D.page.waitForSelector("#newPw");
check("invite link asks for a password", true);
check("link tokens are removed from the address bar", !D.page.url().includes("access_token"));
await D.page.fill("#newPw", "short"); await D.page.fill("#newPw2", "short");
await D.page.click("button:has-text('Save password')");
check("short password refused", /at least 12/.test(await D.page.locator(".lock-error.show").innerText()));
await D.page.fill("#newPw", "four random words here"); await D.page.fill("#newPw2", "four random words here");
await D.page.click("button:has-text('Save password')");
await D.page.waitForSelector("#app", { state: "visible", timeout: 60000 });
check("new teammate lands in the app after choosing a password", true);
check("their password was saved", mock.users["new@example.com"] === "four random words here");

// ------------------------------------------------------------------ 8. hygiene
console.log("\n=== 8. Hygiene");
check("pages only talked to this site and Supabase", foreign.length === 0, foreign);
check("no console errors or CSP violations", problems.length === 0, problems);
await browser.close();
console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
