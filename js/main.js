// Start-up: checks the browser, loads the SQLite engine, shows setup/unlock, and once the vault is
// open starts the app. Read this file first to understand how the pieces fit together:
//
//   engine.js   SQLite (WebAssembly)            db.js       tables + SQL helpers
//   vault.js    encryption                      session.js  keeps the open data saved (encrypted)
//   lock.js     setup / unlock / recovery UI    api/*       the old Flask routes, now in the browser
//   app.js      the screens (original UI)       security_panel.js  the Security tab

import { Session } from "./core/session.js";
import { idbStorage, setStorageScope } from "./core/storage.js";
import { loadEngine } from "./core/engine.js";
import { runLock } from "./core/lock.js";
import { startAutoLock } from "./core/autolock.js";
import { initSecurityPanel, backupState } from "./core/security_panel.js";
import { noticeDialog } from "./core/dialog.js";
import { handleRequest, onDataChanged } from "./api/index.js";

// Don't run inside someone else's page (click-jacking). GitHub Pages can't send the header for this.
if (window.top !== window.self) {
  document.documentElement.replaceChildren();
  throw new Error("This page cannot be shown inside a frame.");
}

const lockRoot = document.getElementById("lock-root");

function fatal(message) {
  const card = document.createElement("div");
  card.className = "lock-card";
  const brand = document.createElement("div");
  brand.className = "lock-brand";
  brand.textContent = "Ninja Program";
  const text = document.createElement("p");
  text.className = "lock-error show";
  text.textContent = message;
  card.append(brand, text);
  const wrap = document.createElement("div");
  wrap.className = "lock-wrap";
  wrap.appendChild(card);
  lockRoot.replaceChildren(wrap);
}

// Keep this copy's data separate from any other copy hosted under the same github.io address.
const scope = "ninja" + location.pathname.replace(/index\.html$/, "").replace(/\/*$/, "/");
setStorageScope(scope);

// Only one tab may have the app open at a time (two tabs would overwrite each other's saves).
async function claimThisTab() {
  if (!navigator.locks) return true;
  for (let attempt = 0; attempt < 12; attempt++) {
    const got = await new Promise((resolve) => {
      navigator.locks.request(scope + "session", { ifAvailable: true }, (lock) => {
        resolve(!!lock);
        return lock ? new Promise(() => {}) : undefined; // held until this page closes
      });
    });
    if (got) return true;
    await new Promise((r) => setTimeout(r, 250)); // the previous page may still be shutting down
  }
  return false;
}

async function main() {
  if (!window.isSecureContext || !globalThis.crypto || !crypto.subtle || !window.indexedDB || typeof WebAssembly !== "object") {
    return fatal("This browser can't run the app securely. Open it over https:// (or http://localhost) in an up-to-date Chrome, Edge, Firefox or Safari.");
  }
  if (!(await claimThisTab())) {
    return fatal("Ninja Program is already open in another tab or window. Close that one, then reload this page.");
  }

  try {
    await loadEngine();
  } catch (error) {
    return fatal("Could not start the database engine: " + error.message);
  }

  const session = new Session(idbStorage(scope));
  await runLock(session);          // returns once the vault is unlocked

  // ---- the vault is open: connect the screens to it ----
  onDataChanged(() => session.scheduleSave());
  window.ninjaApi = (method, path, body, file) => handleRequest(method, path, body, file);

  let locking = false;
  async function lockNow({ force = true } = {}) {
    if (locking) return;
    if (!force && session.state === "error") {
      await noticeDialog("Your latest changes aren't saved",
        "The browser couldn't save your newest changes, and locking now would lose them. Open the Security tab and download a backup first.");
      return;
    }
    locking = true;
    try { await session.close(); } finally { location.reload(); }
  }

  // Save-status indicator + backup reminder in the top bar.
  const statusEl = document.getElementById("saveStatus");
  const nudge = document.getElementById("backupNudge");
  function updateBar() {
    const s = session.state;
    statusEl.dataset.state = s;
    statusEl.textContent = s === "pending" || s === "saving" ? "Saving..."
      : s === "error" ? "NOT SAVED - download a backup"
      : s === "saved" ? "Saved" : "";
    statusEl.title = s === "error" && session.lastError ? String(session.lastError.message || session.lastError) : "";
    nudge.style.display = backupState().due ? "inline-block" : "none";
  }
  session.onStatus(updateBar);
  setInterval(updateBar, 60000);
  nudge.addEventListener("click", () => document.querySelector('.tab-btn[data-tab="security"]').click());
  document.getElementById("lockNowBtn").addEventListener("click", () => lockNow({ force: false }));
  updateBar();

  // Don't lose work: warn if the tab is closed mid-save, and save when the tab is hidden.
  window.addEventListener("beforeunload", (e) => {
    if (!locking && (session.state === "pending" || session.state === "saving")) { e.preventDefault(); e.returnValue = ""; }
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden && session.state === "pending") session.saveNow(); });
  window.addEventListener("pagehide", () => { if (session.state === "pending") session.saveNow(); });

  // The original screens (js/app.js) start themselves when loaded.
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "js/app.js";
    script.onload = resolve;
    script.onerror = () => reject(new Error("Could not load the app screens (js/app.js)."));
    document.body.appendChild(script);
  });

  initSecurityPanel({ session, lockNow, refreshApp: () => window.ninjaReload() });
  startAutoLock(() => lockNow({ force: true }));
  updateBar();
}

main().catch((error) => fatal("Something went wrong while starting: " + (error && error.message ? error.message : error)));
