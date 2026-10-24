// Start-up: checks the browser, loads the SQLite engine, signs the person in, loads the shared data
// and starts the screens. Read this first to see how the pieces fit:
//
//   sync/supabase.js  login + table access     sync/sync.js   keeps the local copy and the server in step
//   sync/login.js     sign-in screens          core/db.js     tables + SQL helpers (local working copy)
//   api/*             the old Flask routes     app.js         the screens (original UI)
//   sync/account_panel.js  the Account tab     sync/config.js  your Supabase address + key

import { setStorageScope, prefs } from "./core/storage.js";
import { loadEngine } from "./core/engine.js";
import { openEmptyForSync } from "./core/db.js";
import { startAutoLock } from "./core/autolock.js";
import { handleRequest, onDataChanged } from "./api/index.js";
import { SupabaseClient, switchableStore } from "./sync/supabase.js";
import { Sync } from "./sync/sync.js";
import { showLogin, showChoosePassword, showMessage, hideLogin } from "./sync/login.js";
import { initAccountPanel } from "./sync/account_panel.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./sync/config.js";

// Don't run inside someone else's page (click-jacking). GitHub Pages can't send the header for this.
if (window.top !== window.self) {
  document.documentElement.replaceChildren();
  throw new Error("This page cannot be shown inside a frame.");
}

const scope = "ninja" + location.pathname.replace(/index\.html$/, "").replace(/\/*$/, "/");
setStorageScope(scope);

/** An invite or password-reset link puts the one-time login in the address after "#". */
function takeLinkTokens() {
  const hash = location.hash.replace(/^#/, "");
  if (!hash) return null;
  const q = new URLSearchParams(hash);
  if (!q.get("access_token") && !q.get("error_description")) return null;
  history.replaceState(null, "", location.pathname + location.search);   // don't leave tokens in the address bar
  if (q.get("error_description")) return { error: q.get("error_description").replace(/\+/g, " ") };
  return { access_token: q.get("access_token"), refresh_token: q.get("refresh_token"), expires_in: q.get("expires_in"), invite: q.get("type") === "invite" };
}

async function main() {
  if (!window.isSecureContext || !window.crypto || typeof WebAssembly !== "object") {
    return showMessage("This browser can't run the app securely. Open it over https:// in an up-to-date Chrome, Edge, Firefox or Safari.");
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return showMessage("The team database isn't connected yet. Open js/sync/config.js and fill in your Supabase URL and key (see SETUP.md).");
  }
  try { await loadEngine(); } catch (error) { return showMessage("Could not start the database engine: " + error.message); }

  const store = switchableStore(scope + ".login");
  const client = new SupabaseClient({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY, store });

  const link = takeLinkTokens();
  let notice = "";
  if (link && link.error) notice = "That link didn't work: " + link.error + " Ask for a new one.";
  else if (link) { await showChoosePassword(client, link, { invite: link.invite }); }

  for (;;) {
    if (!client.signedIn) await showLogin(client, store, { notice });
    notice = "";
    showMessage("Loading the team's data...");
    openEmptyForSync();
    const sync = new Sync(client, { intervalMs: Math.max(1000, Number(prefs.get("pollMs", 15000)) || 15000) });
    try {
      await sync.start();
      return begin(client, sync, store);
    } catch (error) {
      sync.stop();
      if (error.code === "NO_SESSION" || error.status === 401) { notice = "Please sign in again."; continue; }
      if (error.status === 404 || /relation|schema cache/i.test(error.message || "")) {
        return showMessage("Signed in, but the database tables aren't set up. Run supabase/schema.sql in Supabase (see SETUP.md). Details: " + error.message);
      }
      return showMessage("Could not load the team's data: " + error.message, { retry: () => location.reload() });
    }
  }
}

async function begin(client, sync, store) {
  onDataChanged(() => sync.request());
  window.ninjaApi = (method, path, body, file) => handleRequest(method, path, body, file);
  window.ninjaUserEmail = client.email || ""; // default author name on JR notes

  let leaving = false;
  async function signOut() {
    if (leaving) return;
    leaving = true;
    sync.stop();
    try { await Promise.race([sync.syncNow(), new Promise((r) => setTimeout(r, 4000))]); } catch (_) { /* best effort */ }
    await client.signOut();
    location.reload();
  }

  // Status pill in the top bar.
  const statusEl = document.getElementById("saveStatus");
  function updateBar() {
    const s = sync.state;
    statusEl.dataset.state = s === "error" ? "error" : s === "synced" ? "saved" : "pending";
    statusEl.textContent = s === "synced" ? "Synced" : s === "syncing" ? "Syncing..." : s === "error" ? "NOT SAVED - offline?" : "";
    statusEl.title = s === "error" && sync.lastError ? String(sync.lastError.message) : "";
  }
  sync.onStatus(updateBar);
  updateBar();
  document.getElementById("lockNowBtn").textContent = "Sign out";
  document.getElementById("lockNowBtn").title = "Send any changes and sign out";
  document.getElementById("lockNowBtn").addEventListener("click", signOut);
  const nudge = document.getElementById("backupNudge");
  if (nudge) nudge.remove();

  // Don't lose work: warn if the tab is closed while changes haven't reached the server.
  window.addEventListener("beforeunload", (e) => {
    if (!leaving && sync.unsynced) { e.preventDefault(); e.returnValue = ""; }
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) sync.syncNow(); });
  window.addEventListener("online", () => sync.syncNow());

  // The original screens (js/app.js) start themselves when loaded.
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "js/app.js";
    script.onload = resolve;
    script.onerror = () => reject(new Error("Could not load the app screens (js/app.js)."));
    document.body.appendChild(script);
  });
  hideLogin();

  // A teammate changed something: refresh the screens, but never while you're typing, in a dialog,
  // or have a JR note written but not saved yet.
  let waiting = false;
  function busy() {
    const a = document.activeElement;
    const unsentNote = [...document.querySelectorAll("[data-draft]")].some((t) => t.value.trim());
    return unsentNote || !!document.querySelector(".modal-overlay.open") ||
      (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.closest("#app"));
  }
  function refreshWhenIdle() {
    if (busy()) { waiting = true; return; }
    waiting = false;
    window.ninjaReload();
  }
  sync.onRemoteChange(refreshWhenIdle);
  setInterval(() => { if (waiting) refreshWhenIdle(); }, 3000);

  initAccountPanel({ client, sync, signOut, refreshApp: () => window.ninjaReload() });
  startAutoLock(signOut);
}

main().catch((error) => showMessage("Something went wrong while starting: " + (error && error.message ? error.message : error)));
