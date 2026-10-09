// End-to-end test of the GitHub Pages build in a real (headless) Chromium.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE || "http://127.0.0.1:8765/index.html";
const LEGACY_DB = process.env.LEGACY_DB;
const OUT = process.env.OUT_DIR;
fs.mkdirSync(OUT, { recursive: true });

const PW1 = "correct horse battery staple";
const PW2 = "second passphrase for testing";
const PW3 = "third passphrase after backup";
const EXPECT = { leads: 1639, belts: 64, active: 85, receipts: 139 };

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (detail !== undefined ? "   -> " + JSON.stringify(detail).slice(0, 400) : "")); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

const consoleProblems = [];
const foreign = [];
page.on("console", (m) => {
  const t = m.text();
  if (["error", "warning"].includes(m.type()) && !/favicon|Password forms should have/.test(t)) consoleProblems.push(`[${m.type()}] ${t}`);
});
page.on("pageerror", (e) => consoleProblems.push("[pageerror] " + e.message));
ctx.on("request", (r) => {
  const u = new URL(r.url());
  if (/^https?:$/.test(u.protocol) && u.host !== new URL(BASE).host) foreign.push(r.url());
});

// ---------- helpers
async function waitSaved(p = page) {
  await p.waitForFunction(() => document.getElementById("saveStatus")?.dataset.state === "saved", null, { timeout: 15000 });
}
async function readKey(p = page) {
  const text = await p.locator(".lock-card .recovery-key").first().innerText();
  return text.split(/\s+/).filter(Boolean).join("-");
}
async function confirmKey(key, p = page) {
  await p.fill("#rkConfirm", key);
  await p.click("button:has-text(\"I've saved it\")");
}
async function unlockWith(pw, p = page) {
  await p.fill("#unlockPassword", pw);
  await p.click("button:has-text('Unlock')");
}
const leadRows = (p = page) => p.locator("#leadsTable tbody tr").count();
async function openSecurity(p = page) { await p.click('.tab-btn[data-tab="security"]'); await p.waitForSelector("#securityRoot .sec-card"); }
async function dialogFill(values, submitText, p = page) {
  const inputs = p.locator(".modal-overlay.open form input, .modal-overlay.open form select");
  for (const [i, v] of Object.entries(values)) {
    const el = inputs.nth(Number(i));
    if (typeof v === "object" && v.file) await el.setInputFiles(v.file);
    else if (typeof v === "object" && v.select) await el.selectOption(v.select);
    else await el.fill(v);
  }
  await p.click(`.modal-overlay.open button[type=submit]:has-text("${submitText}")`);
}
async function idbDump(p = page) {
  return p.evaluate(async () => {
    const dbs = await indexedDB.databases();
    const db = await new Promise((res, rej) => { const r = indexedDB.open(dbs[0].name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const out = await new Promise((res) => {
      const tx = db.transaction("kv"); const store = tx.objectStore("kv");
      const items = {}; const req = store.openCursor();
      req.onsuccess = () => { const c = req.result; if (c) { items[c.key] = c.value; c.continue(); } else res(items); };
    });
    db.close();
    return { name: dbs[0].name, names: dbs.map((d) => d.name), items: out, local: JSON.stringify(Object.assign({}, localStorage)) };
  });
}
const apiCount = (p, path_) => p.evaluate(async (u) => (await window.ninjaApi("GET", u)).length, path_);

// =====================================================================
console.log("\n=== 1. First-run setup");
await page.goto(BASE);
await page.waitForSelector("#setupPassword");
check("setup screen shown on first visit", true);

await page.fill("#setupPassword", "short"); await page.fill("#setupPassword2", "short");
await page.click("button:has-text('Create my encrypted vault')");
check("weak password refused", /at least 12/i.test(await page.locator(".lock-error").innerText()));
await page.fill("#setupPassword", PW1); await page.fill("#setupPassword2", PW1 + "x");
await page.click("button:has-text('Create my encrypted vault')");
check("mismatched passwords refused", /don't match/i.test(await page.locator(".lock-error").innerText()));

await page.fill("#setupPassword2", PW1);
await page.check("#startImport");
await page.click("button:has-text('Create my encrypted vault')");
check("import without a file refused", /Choose your ninja_system\.db/.test(await page.locator(".lock-error").innerText()));
await page.setInputFiles("#setupDbFile", LEGACY_DB);
await page.click("button:has-text('Create my encrypted vault')");

await page.waitForSelector(".recovery-key", { timeout: 30000 });
const key1 = await readKey();
check("recovery key has 8 groups of 4", /^([A-Z2-9]{4}-){7}[A-Z2-9]{4}$/.test(key1), key1);
check("continue is disabled until the key is retyped", await page.locator("button:has-text(\"I've saved it\")").isDisabled());
await page.fill("#rkConfirm", "AAAA-BBBB");
check("wrong key keeps continue disabled", await page.locator("button:has-text(\"I've saved it\")").isDisabled());
const beforeConfirm = await page.evaluate(async () => {
  const dbs = await indexedDB.databases(); let n = 0;
  for (const d of dbs) { const db = await new Promise((res, rej) => { const r = indexedDB.open(d.name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    if (db.objectStoreNames.contains("kv")) n += await new Promise((res) => { const q = db.transaction("kv").objectStore("kv").count(); q.onsuccess = () => res(q.result); });
    db.close(); }
  return n; });
check("nothing is stored before the key is confirmed", beforeConfirm === 0, beforeConfirm);
await page.screenshot({ path: path.join(OUT, "02_recovery_key.png") });
await confirmKey(key1);
await page.waitForSelector("#leadsTable tbody tr", { timeout: 30000 });
check("app opens after setup", true);
check(`legacy import: all ${EXPECT.leads} leads present`, (await leadRows()) === EXPECT.leads, await leadRows());
check("legacy import: belt entries", (await apiCount(page, "/api/belts")) === EXPECT.belts);
check("legacy import: active ninjas", (await apiCount(page, "/api/active-ninjas")) === EXPECT.active);
check("legacy import: receipts", (await apiCount(page, "/api/rewards/history")) === EXPECT.receipts);
await page.screenshot({ path: path.join(OUT, "03_app_leads.png") });

console.log("\n=== 2. Saving and what is stored");
await page.click("#addLeadBtn");
await page.fill("#lf_ninja_name", "E2E Zebra Ninja");
await page.fill("#lf_parent_name", "Parent Quokka");
await page.click("#leadModalSubmit");
await page.waitForFunction(() => [...document.querySelectorAll("#leadsTable tbody tr")].some((r) => r.textContent.includes("E2E Zebra Ninja")));
await waitSaved();
check("added lead appears and save completes", true);
const dump = await idbDump();
const dumpText = JSON.stringify(dump.items);
check("IndexedDB holds a vault", dump.items.vault && dump.items.vault.format === "ninja-vault");
check("previous copy kept as a safety net", !!dump.items.vault_prev);
check("no plaintext of new data in storage", !dumpText.includes("E2E Zebra") && !dumpText.includes("Quokka"));
check("no plaintext of imported names in storage", !dumpText.includes("Ayden") && !dumpText.includes("SQLite format"));
check("no names in localStorage", !dump.local.includes("Zebra") && !dump.local.includes("Ayden"), dump.local);
check("storage area is namespaced by site path", dump.name === "ninja/", dump.name);
check("kdf is PBKDF2-SHA256 with >= 1,000,000 rounds", dump.items.vault.kdf.name === "PBKDF2-SHA256" && dump.items.vault.kdf.iterations >= 1000000, dump.items.vault.kdf);
await openSecurity();
await page.screenshot({ path: path.join(OUT, "04_security_tab.png"), fullPage: true });

console.log("\n=== 3. Unlock, wrong passwords, throttle");
await page.reload();
await page.waitForSelector("#unlockPassword");
check("unlock screen after reload (data is not readable without the password)", (await page.locator("#leadsTable").isVisible().catch(() => false)) === false);
await unlockWith("totally wrong password");
await page.waitForFunction(() => /Incorrect password/.test(document.querySelector(".lock-error")?.textContent || ""));
check("wrong password rejected", true);
await unlockWith("wrong again wrong again");
await page.waitForFunction(() => /Incorrect password/.test(document.querySelector(".lock-error")?.textContent || ""));
await unlockWith("wrong a third time!!");
await page.waitForFunction(() => /wait/i.test(document.querySelector(".lock-error")?.textContent || ""));
check("third wrong try triggers a wait", true);
check("unlock button disabled during the wait", await page.locator("button:has-text('Unlock')").isDisabled());
await page.screenshot({ path: path.join(OUT, "05_throttle.png") });
await page.reload(); await page.waitForSelector("#unlockPassword");
check("wait survives a page reload", await page.locator("button:has-text('Unlock')").isDisabled());
await page.evaluate(() => localStorage.removeItem("ninja/.throttle"));
await page.reload(); await page.waitForSelector("#unlockPassword");
await unlockWith(PW1);
await page.waitForSelector("#leadsTable tbody tr", { timeout: 30000 });
check("correct password opens the app", true);
await page.fill("#leadsSearch", "Zebra");
await page.waitForFunction(() => document.querySelectorAll("#leadsTable tbody tr").length === 1);
check("data saved earlier survived the lock/unlock", true);
await page.fill("#leadsSearch", "");

console.log("\n=== 4. Forgot password -> recovery key");
await page.click("#lockNowBtn");
await page.waitForSelector("#unlockPassword");
await page.click("button:has-text('Forgot password')");
await page.fill("#forgotKey", "AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA");
await page.click("button:has-text('Continue')");
await page.waitForFunction(() => /not correct|doesn't look right/.test(document.querySelector(".lock-error")?.textContent || ""));
check("wrong recovery key rejected", true);
await page.fill("#forgotKey", key1.toLowerCase());
await page.click("button:has-text('Continue')");
await page.waitForSelector("#newPassword");
check("right recovery key accepted (case-insensitive)", true);
await page.fill("#newPassword", PW2); await page.fill("#newPassword2", PW2);
await page.click("button:has-text('Set new password')");
await page.waitForSelector(".recovery-key");
const key2 = await readKey();
check("a NEW recovery key is issued", key2 !== key1 && /^([A-Z2-9]{4}-){7}[A-Z2-9]{4}$/.test(key2));
await confirmKey(key2);
await page.waitForSelector("#leadsTable tbody tr", { timeout: 30000 });
check("app opens after recovery", (await leadRows()) === EXPECT.leads + 1, await leadRows());
await page.click("#lockNowBtn"); await page.waitForSelector("#unlockPassword");
await unlockWith(PW1);
await page.waitForFunction(() => /Incorrect password/.test(document.querySelector(".lock-error")?.textContent || ""));
check("old password no longer works", true);
await page.evaluate(() => localStorage.removeItem("ninja/.throttle"));
await unlockWith(PW2);
await page.waitForSelector("#leadsTable tbody tr", { timeout: 30000 });
check("new password works", true);
await page.click("#lockNowBtn"); await page.waitForSelector("#unlockPassword");
await page.click("button:has-text('Forgot password')");
await page.fill("#forgotKey", key1);
await page.click("button:has-text('Continue')");
await page.waitForFunction(() => /not correct/.test(document.querySelector(".lock-error")?.textContent || ""));
check("old recovery key is retired", true);
await page.click("button:has-text('Back')");
await unlockWith(PW2);
await page.waitForSelector("#leadsTable tbody tr", { timeout: 30000 });

console.log("\n=== 5. Backup, change password, erase, restore");
await openSecurity();
const [dl] = await Promise.all([page.waitForEvent("download"), page.click("button:has-text('Download encrypted backup')")]);
const backupPath = path.join(OUT, "test.ninjabackup");
await dl.saveAs(backupPath);
const backupText = fs.readFileSync(backupPath, "utf8");
check("backup file downloaded with .ninjabackup name", /^ninja-backup-\d{4}-\d{2}-\d{2}\.ninjabackup$/.test(dl.suggestedFilename()), dl.suggestedFilename());
check("backup file is encrypted (no readable data)", !backupText.includes("Zebra") && !backupText.includes("Ayden") && !backupText.includes("SQLite format") && JSON.parse(backupText).format === "ninja-vault");
await page.waitForFunction(() => /Everything is in your latest backup/.test(document.querySelector(".backup-line")?.textContent || ""));
check("Security tab shows the backup is current", true);

await page.click("button:has-text('Change password')");
await dialogFill({ 0: "not my password", 1: PW3, 2: PW3 }, "Change password");
await page.waitForSelector(".dialog-note");
check("change password asks again when current password is wrong", /incorrect/i.test(await page.locator(".dialog-note").innerText()));
await dialogFill({ 0: PW2, 1: "short", 2: "short" }, "Change password");
await page.waitForSelector("#securityRoot .banner.error");
check("change password refuses a weak new password", /at least 12/i.test(await page.locator("#securityRoot .banner").innerText()));
await page.click("button:has-text('Change password')");
await dialogFill({ 0: PW2, 1: PW3, 2: PW3 }, "Change password");
await page.waitForFunction(() => /Password changed/.test(document.querySelector("#securityRoot .banner")?.textContent || ""));
check("password changed from the Security tab", true);

await page.click("button:has-text('Make a new recovery key')");
await dialogFill({ 0: PW3 }, "Continue");
await page.waitForSelector(".recovery-key");
const key3 = await readKey();
await confirmKey(key3);
await page.waitForSelector("#securityRoot .sec-card");
check("new recovery key issued from the Security tab", key3 !== key2);

// Erase everything
await page.click("button:has-text('Erase everything in this browser')");
await dialogFill({ 0: PW3, 1: "nope" }, "Erase everything");
await page.waitForFunction(() => document.querySelector("#securityRoot .banner.error"));
check("erase needs the word ERASE", true);
await page.click("button:has-text('Erase everything in this browser')");
await dialogFill({ 0: PW3, 1: "ERASE" }, "Erase everything");
await page.waitForSelector("#setupPassword", { timeout: 15000 });
const afterWipe = await idbDump().catch(() => ({ items: {} }));
check("after erase the browser holds no vault", !afterWipe.items || !afterWipe.items.vault, Object.keys(afterWipe.items || {}));

// Restore from the backup made BEFORE the password change -> it must open with PW2 (its own password)
await page.click("button:has-text('I already have an encrypted backup')");
await page.setInputFiles("#restoreFile", backupPath);
await page.fill("#restoreSecret", PW3);
await page.click("button:has-text('Restore')");
await page.waitForFunction(() => /Incorrect password/.test(document.querySelector(".lock-error")?.textContent || ""));
check("backup keeps the password it was made with (new password is rejected)", true);
await page.evaluate(() => localStorage.removeItem("ninja/.throttle"));
await page.fill("#restoreSecret", PW2);
await page.click("button:has-text('Restore')");
await page.waitForSelector("#leadsTable tbody tr", { timeout: 30000 });
check("restore from backup brings back every lead", (await leadRows()) === EXPECT.leads + 1, await leadRows());
await page.fill("#leadsSearch", "Zebra");
await page.waitForFunction(() => document.querySelectorAll("#leadsTable tbody tr").length === 1);
await page.fill("#leadsSearch", "");
await waitSaved().catch(() => {});

console.log("\n=== 6. Replace data from an old ninja_system.db");
await openSecurity();
await page.click("button:has-text('Replace data with an old ninja_system.db')");
await dialogFill({ 0: { file: LEGACY_DB } }, "Replace my data");
await page.waitForFunction(() => /Your data was replaced/.test(document.querySelector("#securityRoot .banner")?.textContent || ""), null, { timeout: 30000 });
check("legacy replace reports success", true);
await page.click('.tab-btn[data-tab="leads"]');
await page.waitForFunction((n) => document.querySelectorAll("#leadsTable tbody tr").length === n, EXPECT.leads);
check("legacy replace: screens reload with the replaced data (Zebra gone)", true);
await waitSaved();
await openSecurity();
await page.click("button:has-text('Replace data with an old ninja_system.db')");
fs.writeFileSync(path.join(OUT, "not_a_db.db"), "this is not sqlite");
await dialogFill({ 0: { file: path.join(OUT, "not_a_db.db") } }, "Replace my data");
await page.waitForFunction(() => document.querySelector("#securityRoot .banner.error"));
check("a non-database file is refused", /not a SQLite/i.test(await page.locator("#securityRoot .banner").innerText()));
check("data intact after the refused import", (await apiCount(page, "/api/belts")) === EXPECT.belts);

console.log("\n=== 7. PDFs (totem tags + certificates)");
await page.click('.tab-btn[data-tab="leads"]');
await page.waitForSelector("#leadsTable tbody tr");
const cbs = page.locator("#leadsTable tbody tr input[type=checkbox]");
for (let i = 0; i < 5; i++) await cbs.nth(i).check();
const [tagDl] = await Promise.all([page.waitForEvent("download"), page.click("#printTotemTagsBtn")]);
const tagPath = path.join(OUT, "browser_totem_tags.pdf");
await tagDl.saveAs(tagPath);
check("totem tag PDF downloaded", tagDl.suggestedFilename() === "Ninja Totem Tags.pdf" && fs.statSync(tagPath).size > 1000, tagDl.suggestedFilename());

await page.click('.tab-btn[data-tab="rewards"]');
await page.waitForSelector("#rewardsTable tbody tr");
const [certDl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.click("#generateAllCertsBtn")]);
const certPath = path.join(OUT, "browser_certificates.pdf");
await certDl.saveAs(certPath);
check("certificate PDF downloaded", /^Ninja Certificates - \d{2}-[A-Z][a-z]{2}-\d{4}\.pdf$/.test(certDl.suggestedFilename()), certDl.suggestedFilename());
await page.waitForFunction(() => /Generated \d+ certificate/.test(document.getElementById("rewardsBanner")?.textContent || ""));
await waitSaved();
await page.click("#refreshRewardsBtn");
await page.waitForTimeout(500);
const outstandingAfter = await page.evaluate(async () => (await window.ninjaApi("GET", "/api/certificates/outstanding")).length);
check("generated certificates are recorded (none outstanding afterwards)", outstandingAfter === 0, outstandingAfter);
await page.screenshot({ path: path.join(OUT, "06_rewards.png") });

console.log("\n=== 8. Auto-lock");
await page.evaluate(() => localStorage.setItem("ninja/.autolockMinutes", "0.05"));
const t0 = Date.now();
await page.waitForSelector("#unlockPassword", { timeout: 20000 });
check("app locks itself after being idle", Date.now() - t0 < 15000, Date.now() - t0);
await page.evaluate(() => localStorage.setItem("ninja/.autolockMinutes", "15"));
await unlockWith(PW2);
await page.waitForSelector("#leadsTable tbody tr", { timeout: 30000 });

console.log("\n=== 9. Second tab");
const page2 = await ctx.newPage();
await page2.goto(BASE);
await page2.waitForSelector(".lock-error.show", { timeout: 15000 });
check("a second tab is refused while the first is open", /already open/i.test(await page2.locator(".lock-error").innerText()));
await page2.close();

console.log("\n=== 10. Damaged latest save");
await page.click("#addLeadBtn"); await page.fill("#lf_ninja_name", "Second Save Ninja"); await page.click("#leadModalSubmit");
await page.waitForFunction(() => [...document.querySelectorAll("#leadsTable tbody tr")].some((r) => r.textContent.includes("Second Save Ninja")));
await waitSaved();
await page.evaluate(async () => {
  const dbs = await indexedDB.databases();
  const db = await new Promise((res) => { const r = indexedDB.open(dbs[0].name); r.onsuccess = () => res(r.result); });
  await new Promise((res) => {
    const tx = db.transaction("kv", "readwrite"); const st = tx.objectStore("kv");
    const g = st.get("vault");
    g.onsuccess = () => { const v = g.result; const c = v.data.ct; v.data.ct = c.slice(0, 40) + (c[40] === "A" ? "B" : "A") + c.slice(41); st.put(v, "vault"); };
    tx.oncomplete = res;
  });
  db.close();
});
await page.goto(BASE + "?x=1");   // fresh load; the first page's own tab lock is released as it navigates
await page.waitForSelector("#unlockPassword", { timeout: 15000 });
await unlockWith(PW2);
await page.waitForSelector(".lock-card button:has-text('Continue')", { timeout: 30000 });
check("damaged newest save: previous copy opened with a clear notice", /previous saved copy/i.test(await page.locator(".lock-card").innerText()));
await page.screenshot({ path: path.join(OUT, "07_recovered_notice.png") });
await page.click(".lock-card button:has-text('Continue')");
await page.waitForSelector("#leadsTable tbody tr", { timeout: 30000 });
check("data from the previous copy is present", (await leadRows()) >= EXPECT.leads);

console.log("\n=== 11. Network + console hygiene");
check("no request ever left this site", foreign.length === 0, foreign);
check("no console errors / CSP violations", consoleProblems.length === 0, consoleProblems);

await browser.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
