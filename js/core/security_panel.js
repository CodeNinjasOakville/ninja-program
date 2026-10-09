// The "Security" tab: backups, password and recovery key, auto-lock, moving data in/out,
// storage status and the erase button. Everything sensitive asks for the password again.

import { h, downloadText, downloadBlob, readFileBytes, readFileText, fileDate, formatWhen } from "./dom.js";
import { askDialog, noticeDialog } from "./dialog.js";
import * as V from "./vault.js";
import { exportDatabase, describeImportable } from "./db.js";
import { prefs, storageInfo, requestPersistence } from "./storage.js";
import { showRecoveryKey, hideLockScreen } from "./lock.js";
import { passwordAdvice } from "./strength.js";
import { AUTOLOCK_CHOICES, getAutolockMinutes, setAutolockMinutes } from "./autolock.js";

const DAY_MS = 86400000;

/** What the Backup section and the top-bar reminder should say. */
export function backupState(now = Date.now()) {
  const last = prefs.get("lastBackup", "");
  const changed = Number(prefs.get("changes", 0)) > 0;
  const days = last ? (now - new Date(last).getTime()) / DAY_MS : Infinity;
  let text;
  if (!last) text = "You haven't downloaded a backup yet.";
  else if (changed && days >= 7) text = `You have changes that aren't in a backup (the last one was ${Math.floor(days)} days ago).`;
  else if (changed) text = "You've made changes since your last backup.";
  else text = "Everything is in your latest backup.";
  return { text, last, changed, due: changed && (!last || days >= 7) };
}

const isSafari = () => /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);

function mb(bytes) {
  return bytes == null ? "unknown" : bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}

/**
 * Keep asking for the password until `action` stops rejecting it (or the person cancels).
 * `action(values)` gets the dialog values; throw VaultError BAD_CREDENTIAL to ask again.
 */
async function withPassword({ title, message, fields = [], confirmText, danger }, action) {
  let note;
  for (;;) {
    const values = await askDialog({
      title, message, confirmText, danger, note,
      fields: [{ id: "password", label: "Your current password", type: "password", autocomplete: "current-password", required: true }, ...fields],
    });
    if (!values) return false;
    try {
      await action(values);
      return true;
    } catch (error) {
      if (error.code === "BAD_CREDENTIAL") { note = "That password is incorrect. Try again."; continue; }
      throw error;
    }
  }
}

export function initSecurityPanel({ session, lockNow, refreshApp }) {
  const root = document.getElementById("securityRoot");
  const flash = h("div", { class: "banner", role: "status" });
  const parts = {};   // elements that refresh() updates

  function say(message, type = "success") {
    flash.textContent = message;
    flash.className = `banner show ${type === "error" ? "error" : "success"}`;
    flash.scrollIntoView({ block: "nearest" });
  }

  async function run(button, fn) {
    const label = button.textContent;
    button.disabled = true;
    try { await fn(); } catch (error) { say(error && error.message ? error.message : "Something went wrong.", "error"); }
    finally { button.disabled = false; button.textContent = label; refresh(); }
  }

  const action = (label, cls, fn) => {
    const button = h("button", { type: "button", class: cls }, label);
    button.addEventListener("click", () => run(button, fn));
    return button;
  };
  const card = (title, ...children) => h("div", { class: "settings-card sec-card" }, [h("h2", {}, title), ...children]);

  // ------------------------------------------------------------ your data / backups
  parts.status = h("p", { class: "sec-status" });
  parts.backup = h("p", { class: "backup-line" });

  const downloadBackup = action("Download encrypted backup", "btn-primary", async () => {
    const text = await session.backupText();
    downloadText(text, `ninja-backup-${fileDate()}.ninjabackup`, "application/json");
    say("Backup downloaded. Keep it somewhere other than this browser - a cloud drive or USB stick. It is encrypted, so it is safe to store there.");
  });

  const restoreBackup = action("Restore from a backup...", "btn-secondary", async () => {
    const values = await askDialog({
      title: "Restore from a backup",
      message: "This replaces ALL the data in this browser with the contents of the backup file.",
      confirmText: "Restore",
      fields: [
        { id: "file", label: "Backup file (.ninjabackup)", type: "file", accept: ".ninjabackup,.json", required: true },
        { id: "kind", label: "Unlock it with", type: "select", options: [{ value: "password", label: "The backup's password" }, { value: "recovery", label: "The backup's recovery key" }] },
        { id: "secret", label: "Password or recovery key", type: "password", autocomplete: "off", required: true },
      ],
    });
    if (!values) return;
    const vault = V.parseVaultFile(await readFileText(values.file));
    const credential = values.kind === "password" ? { password: values.secret } : { recoveryKey: values.secret };
    const opened = await V.unlock(vault, credential);
    await session.adopt(vault, opened.dk, opened.dbBytes);
    await noticeDialog("Backup restored", "Your data has been replaced with the backup. The app will now lock - unlock it with the backup's password (or recovery key).");
    await lockNow();
  });

  // ------------------------------------------------------------ password & recovery key
  const changePassword = action("Change password...", "btn-secondary", async () => {
    await withPassword({
      title: "Change password",
      message: "Your data stays as it is - only the password that protects it changes. Older backup files still open with the password they had when they were made.",
      confirmText: "Change password",
      fields: [
        { id: "next", label: "New password (at least 12 characters)", type: "password", autocomplete: "new-password", required: true,
          hint: "Tip: four or more random words joined together." },
        { id: "again", label: "New password again", type: "password", autocomplete: "new-password", required: true },
      ],
    }, async (v) => {
      if (v.next !== v.again) throw new Error("The two new passwords don't match.");
      V.checkPasswordStrength(v.next);
      const result = await V.changePassword(session.vault, { password: v.password }, v.next);
      await session.replaceVault(result.vault);
      const advice = passwordAdvice(v.next);
      say(`Password changed. ${advice.level < 3 ? advice.message : ""}`.trim());
    });
  });

  const newRecovery = action("Make a new recovery key...", "btn-secondary", async () => {
    let made;
    const ok = await withPassword({
      title: "Make a new recovery key",
      message: "Your current recovery key stops working as soon as you save the new one.",
      confirmText: "Continue",
    }, async (v) => { made = await V.rotateRecoveryKey(session.vault, v.password); });
    if (!ok) return;
    await showRecoveryKey(made.recoveryKey, { heading: "Save your new recovery key", intro: "Your old recovery key no longer works once you continue." });
    await session.replaceVault(made.vault);
    hideLockScreen();
    say("New recovery key saved.");
  });

  // ------------------------------------------------------------ auto-lock
  const select = h("select", { id: "autolockSelect" }, AUTOLOCK_CHOICES.map((c) => h("option", { value: String(c.minutes) }, c.label)));
  select.value = String(getAutolockMinutes());
  if (select.value !== String(getAutolockMinutes())) select.value = "15";
  select.addEventListener("change", () => {
    setAutolockMinutes(select.value);
    say(Number(select.value) === 0 ? "Auto-lock is off. Anyone who sits at this device can see your data until you lock it." : "Auto-lock updated.");
  });

  // ------------------------------------------------------------ old app data in / data out
  const importDb = action("Replace data with an old ninja_system.db...", "btn-secondary", async () => {
    const values = await askDialog({
      title: "Bring in an old ninja_system.db",
      message: "This REPLACES everything currently in the app with the contents of that file. Make a backup first if you want to be able to undo it.",
      confirmText: "Replace my data",
      danger: true,
      fields: [{ id: "file", label: "ninja_system.db", type: "file", accept: ".db,.sqlite,.sqlite3", required: true }],
    });
    if (!values) return;
    const bytes = await readFileBytes(values.file);
    const check = describeImportable(bytes);
    if (!check.ok) throw new Error(check.reason);
    await session.replaceDatabase(bytes);
    await refreshApp();
    say("Your data was replaced and saved. Delete the unencrypted .db file from your computer when you're done with it.");
  });

  const exportDb = action("Export an unencrypted copy (.db)...", "btn-secondary", async () => {
    await withPassword({
      title: "Export unencrypted data",
      message: "The file you get is NOT encrypted - anyone who opens it can read every name and phone number. Store it carefully and delete it when done.",
      confirmText: "Export",
      danger: true,
    }, async (v) => {
      await V.verifyPassword(session.vault, v.password);
      downloadBlob(new Blob([exportDatabase()], { type: "application/vnd.sqlite3" }), `ninja_system_export_${fileDate()}.db`);
      say("Unencrypted copy downloaded.");
    });
  });

  // ------------------------------------------------------------ storage
  parts.storage = h("div", { class: "sec-storage" });
  const safariNote = isSafari()
    ? h("p", { class: "warn" }, "You're using Safari, which can delete a website's saved data after about 7 days without a visit. Download backups regularly, or add this site to your Dock / Home Screen (Safari keeps those).")
    : null;

  // ------------------------------------------------------------ erase
  const erase = action("Erase everything in this browser...", "btn-danger-outline", async () => {
    const done = await withPassword({
      title: "Erase everything",
      message: "This permanently deletes the data stored in this browser. It cannot be undone unless you have a backup file. You will need to set up again.",
      confirmText: "Erase everything",
      danger: true,
      fields: [{ id: "word", label: "Type ERASE to confirm", type: "text", required: true }],
    }, async (v) => {
      await V.verifyPassword(session.vault, v.password);
      if (v.word.trim() !== "ERASE") throw new Error("Type the word ERASE (in capitals) to confirm.");
      await session.wipe();
    });
    if (done) location.reload();
  });

  root.replaceChildren(
    flash,
    card("Your data",
      h("p", { class: "muted" }, "Everything is stored encrypted inside this browser on this device. Nothing is sent to a server, so a backup file is your safety net if the browser's data is ever cleared."),
      parts.status, parts.backup,
      h("div", { class: "button-row" }, [downloadBackup, restoreBackup])
    ),
    card("Password and recovery key",
      h("p", { class: "muted" }, "The password opens the app. The recovery key (shown once when you set up) opens it if the password is forgotten."),
      h("div", { class: "button-row" }, [changePassword, newRecovery])
    ),
    card("Auto-lock",
      h("p", { class: "muted" }, "Locks the app and clears it from the screen when it hasn't been used for a while."),
      h("div", { class: "button-row" }, [select, action("Lock now", "btn-secondary", () => lockNow())])
    ),
    card("Moving data",
      h("p", { class: "muted" }, "Bring in the database from the old Python version, or take an unencrypted copy out."),
      h("div", { class: "button-row" }, [importDb, exportDb])
    ),
    card("Storage", parts.storage, safariNote),
    card("Danger zone", erase)
  );

  async function refresh() {
    const b = backupState();
    parts.status.textContent = `Last saved: ${formatWhen(session.lastSavedAt)}`;
    parts.backup.textContent = `Last backup: ${b.last ? formatWhen(b.last) : "never"}. ${b.text}`;
    parts.backup.className = "backup-line" + (b.due ? " due" : "");

    const info = await storageInfo();
    const bits = [];
    bits.push(info.persisted === true
      ? "Your browser has agreed to keep this data (it won't be cleared automatically when space runs low)."
      : info.persisted === false
        ? "Your browser may clear this data if the device runs low on space. Backups protect against that."
        : "Your browser doesn't say whether this data is protected from automatic clearing.");
    if (info.usage != null) bits.push(`Using about ${mb(info.usage)}.`);
    parts.storage.textContent = bits.join(" ");
  }

  session.onStatus((state) => { if (state === "saved") refresh(); });
  refresh();
  requestPersistence().then(refresh);
  return { refresh };
}
