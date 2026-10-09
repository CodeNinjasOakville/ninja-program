// The "Account" tab: who is signed in, sync status, password, auto sign-out, moving data in/out.

import { h, downloadBlob, readFileBytes, fileDate, formatWhen } from "../core/dom.js";
import { askDialog, noticeDialog } from "../core/dialog.js";
import { exportDatabase, describeImportable, replaceFromLegacy } from "../core/db.js";
import { AUTOLOCK_CHOICES, getAutolockMinutes, setAutolockMinutes } from "../core/autolock.js";
import { MIN_PASSWORD_LENGTH } from "./login.js";

export function initAccountPanel({ client, sync, signOut, refreshApp }) {
  const root = document.getElementById("securityRoot");
  const flash = h("div", { class: "banner", role: "status" });
  const say = (message, type = "success") => {
    flash.textContent = message;
    flash.className = `banner show ${type === "error" ? "error" : "success"}`;
    flash.scrollIntoView({ block: "nearest" });
  };
  async function run(button, fn) {
    button.disabled = true;
    try { await fn(); } catch (error) { say(error && error.message ? error.message : "Something went wrong.", "error"); }
    finally { button.disabled = false; refresh(); }
  }
  const action = (label, cls, fn) => {
    const button = h("button", { type: "button", class: cls }, label);
    button.addEventListener("click", () => run(button, fn));
    return button;
  };
  const card = (title, ...children) => h("div", { class: "settings-card sec-card" }, [h("h2", {}, title), ...children]);

  const who = h("p", { class: "sec-status" });
  const syncLine = h("p", { class: "backup-line" });

  const syncBtn = action("Sync now", "btn-secondary", async () => {
    await sync.syncNow();
    if (sync.state === "error") throw sync.lastError;
    say("Everything is up to date.");
  });

  const changePw = action("Change my password...", "btn-secondary", async () => {
    const v = await askDialog({
      title: "Change password", confirmText: "Change password",
      message: "This changes the password for your own login only.",
      fields: [
        { id: "next", label: `New password (at least ${MIN_PASSWORD_LENGTH} characters)`, type: "password", autocomplete: "new-password", required: true, hint: "Tip: four or more random words joined together." },
        { id: "again", label: "New password again", type: "password", autocomplete: "new-password", required: true },
      ],
    });
    if (!v) return;
    if (v.next !== v.again) throw new Error("The two new passwords don't match.");
    if (v.next.length < MIN_PASSWORD_LENGTH) throw new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
    await client.changePassword(v.next);
    say("Password changed.");
  });

  const select = h("select", { id: "autolockSelect" }, AUTOLOCK_CHOICES.map((c) => h("option", { value: String(c.minutes) }, c.label)));
  select.value = String(getAutolockMinutes());
  if (select.value !== String(getAutolockMinutes())) select.value = "60";
  select.addEventListener("change", () => {
    setAutolockMinutes(select.value);
    say(Number(select.value) === 0 ? "Auto sign-out is off. Anyone using this device can see the data until you sign out." : "Auto sign-out updated.");
  });

  const exportDb = action("Download a copy of all data (.db)...", "btn-secondary", async () => {
    const ok = await askDialog({
      title: "Download a copy", confirmText: "Download", danger: true, fields: [],
      message: "The file is NOT encrypted - anyone who opens it can read every name and phone number. Store it carefully and delete it when done.",
    });
    if (!ok) return;
    await sync.syncNow();
    downloadBlob(new Blob([exportDatabase()], { type: "application/vnd.sqlite3" }), `ninja_system_export_${fileDate()}.db`);
    say("Copy downloaded. This is a snapshot of what the team has right now.");
  });

  const importDb = action("Replace ALL team data with an old ninja_system.db...", "btn-danger-outline", async () => {
    const v = await askDialog({
      title: "Replace all data with an old file", confirmText: "Replace everything", danger: true,
      note: "This affects EVERYONE on the team.",
      message: "Every lead, belt, active ninja, reward and setting is replaced by the contents of the file. Download a copy first if you may want to undo it.",
      fields: [
        { id: "file", label: "ninja_system.db", type: "file", accept: ".db,.sqlite,.sqlite3", required: true },
        { id: "word", label: "Type REPLACE to confirm", type: "text", required: true },
      ],
    });
    if (!v) return;
    if (v.word.trim() !== "REPLACE") throw new Error("Type the word REPLACE (in capitals) to confirm.");
    const bytes = await readFileBytes(v.file);
    const check = describeImportable(bytes);
    if (!check.ok) throw new Error(check.reason);
    replaceFromLegacy(bytes);
    await sync.syncNow();
    if (sync.state === "error") throw new Error("Imported here, but sending it to the team failed: " + sync.lastError.message + " It will retry automatically.");
    await refreshApp();
    say("Done. The team's data now matches that file. Delete the old .db file from your computer when you're finished with it.");
  });

  const out = action("Sign out", "btn-secondary", async () => { await signOut(); });

  root.replaceChildren(
    flash,
    card("You", who, h("div", { class: "button-row" }, [changePw, out])),
    card("Sync", h("p", { class: "muted" }, "Changes are saved to the shared database a moment after you make them, and teammates' changes appear automatically."), syncLine, h("div", { class: "button-row" }, [syncBtn])),
    card("Auto sign-out", h("p", { class: "muted" }, "Signs you out and clears the screen when this device hasn't been used for a while."), h("div", { class: "button-row" }, [select])),
    card("Moving data", h("p", { class: "muted" }, "Take a copy out, or bring in the database from the old Python version."), h("div", { class: "button-row" }, [exportDb, importDb]))
  );

  function refresh() {
    who.textContent = `Signed in as ${client.email || "(unknown)"}`;
    const s = sync.state;
    syncLine.textContent = s === "error"
      ? `Not synced: ${sync.lastError ? sync.lastError.message : "unknown problem"} Your changes are kept on this screen and will be retried.`
      : s === "syncing" ? "Syncing..." : sync.lastSyncedAt ? `Last synced: ${formatWhen(sync.lastSyncedAt)}` : "Not synced yet.";
    syncLine.className = "backup-line" + (s === "error" ? " due" : "");
  }
  sync.onStatus(refresh);
  refresh();
  return { refresh };
}
