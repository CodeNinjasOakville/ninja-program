// The screens you see before the app opens: first-time setup, unlock, forgot-password
// (recovery key) and restore-from-backup. All drawn into <div id="lock-root">.
//
// Safety rules baked in here:
//  * A new vault is only SAVED after the person has typed their recovery key back - so nobody
//    can end up locked out because they skipped past it.
//  * Wrong passwords / recovery keys are slowed down (throttle.js).
//  * Nothing secret is kept in the page after use: password boxes are cleared.

import { h, nextPaint, downloadText, readFileBytes, readFileText, fileDate } from "./dom.js";
import * as V from "./vault.js";
import { openDatabase, exportDatabase, describeImportable } from "./db.js";
import { passwordAdvice } from "./strength.js";
import * as throttle from "./throttle.js";
import { requestPersistence } from "./storage.js";

const root = () => document.getElementById("lock-root");

/** Remove the lock screen and show the app again. */
export function hideLockScreen() {
  root().replaceChildren();
  document.body.classList.remove("locked");
}

function show(...nodes) {
  document.body.classList.add("locked");
  root().replaceChildren(h("div", { class: "lock-wrap" }, [h("div", { class: "lock-card" }, nodes)]));
}

// Password managers look for a username next to a password box; this invisible one lets them save the entry.
const usernameStub = () => h("input", { type: "text", autocomplete: "username", value: "Ninja Program", tabindex: "-1", "aria-hidden": "true", style: "display:none" });

const brand = (subtitle) => [
  h("div", { class: "lock-brand" }, "Ninja Program"),
  subtitle ? h("div", { class: "lock-sub" }, subtitle) : null,
];

function field(label, input, hint) {
  return h("div", { class: "lock-field" }, [h("label", { for: input.id }, label), input, hint ? h("div", { class: "hint" }, hint) : null]);
}

function passwordInput(id, autocomplete) {
  const input = h("input", { type: "password", id, autocomplete, spellcheck: "false", autocapitalize: "off" });
  const toggle = h("button", { type: "button", class: "link-btn show-toggle", "aria-label": "Show or hide the password" }, "Show");
  toggle.addEventListener("click", () => {
    const hidden = input.type === "password";
    input.type = hidden ? "text" : "password";
    toggle.textContent = hidden ? "Hide" : "Show";
  });
  return { input, row: h("div", { class: "pw-row" }, [input, toggle]) };
}

function strengthMeter(input) {
  const meter = h("div", { class: "strength", "aria-live": "polite" });
  input.addEventListener("input", () => {
    const a = passwordAdvice(input.value);
    meter.textContent = a.label ? `${a.label}. ${a.message}` : "";
    meter.dataset.level = String(a.level);
  });
  return meter;
}

function errorBox() {
  const box = h("div", { class: "lock-error", role: "alert" });
  return {
    node: box,
    set(message) { box.textContent = message; box.classList.toggle("show", !!message); },
  };
}

const friendly = (e) => (e && e.message ? e.message : "Something went wrong.");
const sameKey = (a, b) => String(a).toUpperCase().replace(/[^A-Z0-9]/g, "") === String(b).toUpperCase().replace(/[^A-Z0-9]/g, "");
const fmtWait = (s) => (s >= 60 ? `${Math.ceil(s / 60)} minute${s > 90 ? "s" : ""}` : `${s} seconds`);

async function busy(button, label, fn) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;
  await nextPaint();
  try { return await fn(); } finally { button.disabled = false; button.textContent = original; }
}

// ---------------------------------------------------------------- recovery key screen

/**
 * Shows a recovery key and waits until the person types it back correctly.
 * Resolves when they continue. (There is deliberately no way to skip this.)
 */
export function showRecoveryKey(keyText, { heading = "Save your recovery key", intro } = {}) {
  return new Promise((resolve) => {
    const today = fileDate();
    const groups = keyText.split("-");
    const keyBox = h("div", { class: "recovery-key", "aria-label": "Your recovery key" }, groups.map((g) => h("span", {}, g)));

    const copy = h("button", { type: "button", class: "btn-secondary" }, "Copy");
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(keyText); copy.textContent = "Copied"; } catch (_) { copy.textContent = "Select and copy it manually"; }
      setTimeout(() => { copy.textContent = "Copy"; }, 2500);
    });
    const save = h("button", { type: "button", class: "btn-secondary" }, "Download as text file");
    save.addEventListener("click", () => downloadText(
      `Ninja Program - recovery key\nCreated: ${today}\n\nRecovery key:\n${keyText}\n\n` +
      "This key opens your encrypted Ninja Program data if you forget your password.\n" +
      "Keep it somewhere safe that is NOT only on this computer (a password manager, or printed in a safe place).\n" +
      "Anyone who has this key and a copy of your data can read it - do not share it.\n",
      "ninja-program-recovery-key.txt"
    ));
    const print = h("button", { type: "button", class: "btn-secondary" }, "Print");
    print.addEventListener("click", () => {
      document.body.classList.add("printing-key");
      window.print();
      setTimeout(() => document.body.classList.remove("printing-key"), 500);
    });

    const confirm = h("input", { type: "text", id: "rkConfirm", autocomplete: "off", spellcheck: "false", placeholder: "Type or paste the key here" });
    const go = h("button", { type: "submit", class: "btn-primary", disabled: true }, "I've saved it - continue");
    confirm.addEventListener("input", () => { go.disabled = !sameKey(confirm.value, keyText); });

    const form = h("form", { class: "lock-form" }, [
      field("To make sure you copied it correctly, enter it again", confirm),
      go,
    ]);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!sameKey(confirm.value, keyText)) return;
      resolve();
    });

    show(
      ...brand(heading),
      h("p", {}, intro || "If you forget your password, this key is the ONLY way back into your data. There is no \"reset by email\" because nothing is stored online."),
      keyBox,
      h("div", { class: "button-row" }, [copy, save, print]),
      h("ul", { class: "lock-tips" }, [
        h("li", {}, "Keep it somewhere safe that is not only on this computer - a password manager, or printed and stored securely."),
        h("li", {}, "Anyone holding this key plus a copy of your data can open it, so don't share it."),
      ]),
      form,
      h("div", { class: "recovery-print" }, [
        h("h1", {}, "Ninja Program - recovery key"),
        h("p", {}, `Created ${today}`),
        h("div", { class: "recovery-key print-key" }, keyText),
        h("p", {}, "Keep this page somewhere safe. It opens the encrypted Ninja Program data if the password is forgotten."),
      ])
    );
    confirm.focus();
  });
}

// ---------------------------------------------------------------- first-time setup

function showSetup(ctx, firstError) {
  const pw = passwordInput("setupPassword", "new-password");
  const pw2 = passwordInput("setupPassword2", "new-password");
  const meter = strengthMeter(pw.input);
  const err = errorBox();

  const radioEmpty = h("input", { type: "radio", name: "start", id: "startEmpty", value: "empty", checked: true });
  const radioImport = h("input", { type: "radio", name: "start", id: "startImport", value: "import" });
  const file = h("input", { type: "file", id: "setupDbFile", accept: ".db,.sqlite,.sqlite3,application/octet-stream" });
  const fileRow = h("div", { class: "lock-field indent", style: "display:none" }, [
    h("label", { for: "setupDbFile" }, "Your existing ninja_system.db file"),
    file,
    h("div", { class: "hint" }, "It is read on this device only. Delete the unencrypted copy afterwards."),
  ]);
  const toggleFile = () => { fileRow.style.display = radioImport.checked ? "block" : "none"; };
  radioEmpty.addEventListener("change", toggleFile);
  radioImport.addEventListener("change", toggleFile);

  const submit = h("button", { type: "submit", class: "btn-primary wide-btn" }, "Create my encrypted vault");
  const restore = h("button", { type: "button", class: "link-btn" }, "I already have an encrypted backup file - restore it");
  restore.addEventListener("click", () => showRestore(ctx, { hasExisting: false }));

  const form = h("form", { class: "lock-form" }, [
    usernameStub(),
    field("Choose a password", pw.row, "At least 12 characters. A few random words joined together works well and is easy to remember."),
    meter,
    field("Type it again", pw2.row),
    h("fieldset", { class: "start-choice" }, [
      h("legend", {}, "Where should your data start?"),
      h("label", { class: "radio" }, [radioEmpty, " Start empty"]),
      h("label", { class: "radio" }, [radioImport, " Bring in my existing ninja_system.db"]),
      fileRow,
    ]),
    err.node,
    submit,
  ]);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.set("");
    try {
      if (pw.input.value !== pw2.input.value) throw new Error("The two passwords don't match.");
      V.checkPasswordStrength(pw.input.value);

      let bytes = null;
      if (radioImport.checked) {
        if (!file.files[0]) throw new Error("Choose your ninja_system.db file, or pick \"Start empty\".");
        bytes = await readFileBytes(file.files[0]);
        const check = describeImportable(bytes);
        if (!check.ok) throw new Error(check.reason);
      }

      const made = await busy(submit, "Securing... (a few seconds)", async () => {
        openDatabase(bytes);                 // checks the file and fills in anything missing
        const image = exportDatabase();
        return { image, ...(await V.createVault(pw.input.value, image)) };
      });

      // Only now (after the key has been confirmed) is anything written to this browser.
      await showRecoveryKey(made.recoveryKey, { heading: "Your vault is ready - save your recovery key" });
      await ctx.session.startNew(made.vault, made.dk, made.image);
      requestPersistence();
      pw.input.value = ""; pw2.input.value = "";
      ctx.done();
    } catch (error) {
      // If the recovery-key screen has replaced this form, rebuild it so the message is visible.
      if (!document.getElementById("setupPassword")) showSetup(ctx, friendly(error));
      else err.set(friendly(error));
    }
  });

  show(
    ...brand("Set up your private vault"),
    h("p", {}, "Your data stays on this device. It is encrypted with your password before it is saved, and it is never sent to a server."),
    h("p", { class: "muted" }, "Next you'll get a recovery key - the only way back in if you forget the password."),
    form,
    h("div", { class: "lock-foot" }, [restore])
  );
  if (firstError) err.set(firstError);
  pw.input.focus();
}

// ---------------------------------------------------------------- unlock

async function finishUnlock(ctx, vault, dk, dbBytes, password, notice) {
  await ctx.session.begin(vault, dk, dbBytes);
  if (password && V.needsUpgrade(vault)) {
    try {
      const upgraded = await V.changePassword(vault, { password }, password); // re-wrap with current strength
      await ctx.session.replaceVault(upgraded.vault);
    } catch (_) { /* the old settings still work; try again next time */ }
  }
  if (notice) {
    show(...brand("Opened"), h("p", {}, notice), h("div", { class: "button-row" }, [
      h("button", { class: "btn-primary", onclick: () => ctx.done() }, "Continue"),
    ]));
    return;
  }
  ctx.done();
}

function showUnlock(ctx, stored) {
  const pw = passwordInput("unlockPassword", "current-password");
  const err = errorBox();
  const submit = h("button", { type: "submit", class: "btn-primary wide-btn" }, "Unlock");
  const forgot = h("button", { type: "button", class: "link-btn" }, "Forgot password? Use my recovery key");
  const restore = h("button", { type: "button", class: "link-btn" }, "Restore from a backup file");
  forgot.addEventListener("click", () => showForgot(ctx, stored));
  restore.addEventListener("click", () => showRestore(ctx, { hasExisting: true }));

  let timer = null;
  function refreshWait() {
    clearTimeout(timer);
    const s = throttle.waitSeconds();
    if (s > 0) {
      submit.disabled = true;
      err.set(`Too many wrong tries. Please wait ${fmtWait(s)} before trying again.`);
      timer = setTimeout(refreshWait, 500);
    } else if (submit.disabled && submit.textContent === "Unlock") {
      submit.disabled = false;
      err.set("");
    }
  }

  const form = h("form", { class: "lock-form" }, [usernameStub(), field("Password", pw.row), err.node, submit]);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (throttle.waitSeconds() > 0) return refreshWait();
    err.set("");
    const password = pw.input.value;
    try {
      let opened, vault = stored.vault, notice = stored.recoveredFromPrevious
        ? "Your most recent save could not be read, so the previous saved copy was opened. Recent changes may be missing - check your latest entries." : "";
      await busy(submit, "Unlocking...", async () => {
        try {
          opened = await V.unlock(vault, { password });
        } catch (error) {
          // The newest copy is unreadable but the password was right: try the previous copy.
          if (error.code !== "CORRUPT" || stored.recoveredFromPrevious) throw error;
          const prev = await ctx.session.storage.get("vault_prev");
          if (!prev) throw error;
          vault = V.validateVault(prev);
          opened = await V.unlock(vault, { password });
          notice = "Your most recent save was damaged, so the previous saved copy was opened. Recent changes may be missing - check your latest entries and make a backup.";
        }
      });
      throttle.reset();
      pw.input.value = "";
      await finishUnlock(ctx, vault, opened.dk, opened.dbBytes, password, notice);
    } catch (error) {
      if (error.code === "BAD_CREDENTIAL") {
        const r = throttle.recordFailure();
        err.set(r.wait > 0
          ? `Incorrect password. Please wait ${fmtWait(r.wait)} before trying again.`
          : `Incorrect password. ${throttle.triesBeforeWait()} more ${throttle.triesBeforeWait() === 1 ? "try" : "tries"} before a short wait.`);
        refreshWait();
      } else {
        err.set(friendly(error) + (error.code === "CORRUPT" ? " You can restore from a backup file instead." : ""));
      }
      pw.input.select();
    }
  });

  show(
    ...brand("Enter your password to open your data"),
    form,
    h("div", { class: "lock-foot" }, [forgot, restore])
  );
  refreshWait();
  pw.input.focus();
}

// ---------------------------------------------------------------- forgot password

function showForgot(ctx, stored) {
  const key = h("input", { type: "text", id: "forgotKey", autocomplete: "off", spellcheck: "false", placeholder: "XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" });
  const err = errorBox();
  const go = h("button", { type: "submit", class: "btn-primary wide-btn" }, "Continue");
  const back = h("button", { type: "button", class: "link-btn" }, "Back");
  back.addEventListener("click", () => showUnlock(ctx, stored));

  const form = h("form", { class: "lock-form" }, [field("Your recovery key", key, "The 8 groups of letters and numbers you saved when you set up."), err.node, go]);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (throttle.waitSeconds() > 0) { err.set(`Too many wrong tries. Please wait ${fmtWait(throttle.waitSeconds())}.`); return; }
    err.set("");
    try {
      const recoveryKey = key.value;
      const opened = await busy(go, "Checking...", () => V.unlock(stored.vault, { recoveryKey }));
      throttle.reset();
      showNewPassword(ctx, stored.vault, recoveryKey, opened);
    } catch (error) {
      if (error.code === "BAD_CREDENTIAL") {
        const r = throttle.recordFailure();
        err.set(friendly(error) + (r.wait > 0 ? ` Please wait ${fmtWait(r.wait)} before trying again.` : ""));
      } else err.set(friendly(error));
    }
  });

  show(...brand("Forgot your password?"), h("p", {}, "Enter the recovery key you saved during setup. You'll then choose a new password and get a new recovery key."), form, h("div", { class: "lock-foot" }, [back]));
  key.focus();
}

function showNewPassword(ctx, vault, recoveryKey, opened, firstError) {
  const pw = passwordInput("newPassword", "new-password");
  const pw2 = passwordInput("newPassword2", "new-password");
  const meter = strengthMeter(pw.input);
  const err = errorBox();
  const go = h("button", { type: "submit", class: "btn-primary wide-btn" }, "Set new password");

  const form = h("form", { class: "lock-form" }, [
    usernameStub(),
    field("New password", pw.row, "At least 12 characters."), meter, field("Type it again", pw2.row), err.node, go,
  ]);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.set("");
    try {
      if (pw.input.value !== pw2.input.value) throw new Error("The two passwords don't match.");
      V.checkPasswordStrength(pw.input.value);
      const changed = await busy(go, "Securing... (a few seconds)", () =>
        V.changePassword(vault, { recoveryKey }, pw.input.value, { rotateRecovery: true }));
      // Show (and have them confirm) the NEW key before anything is saved.
      await showRecoveryKey(changed.recoveryKey, { heading: "Save your new recovery key", intro: "Your old recovery key no longer works. This new one replaces it." });
      await ctx.session.begin(vault, opened.dk, opened.dbBytes);
      await ctx.session.replaceVault(changed.vault);
      pw.input.value = ""; pw2.input.value = "";
      ctx.done();
    } catch (error) {
      if (!document.getElementById("newPassword")) showNewPassword(ctx, vault, recoveryKey, opened, friendly(error));
      else err.set(friendly(error));
    }
  });

  show(...brand("Choose a new password"), h("p", {}, "Recovery key accepted."), form);
  if (firstError) err.set(firstError);
  pw.input.focus();
}

// ---------------------------------------------------------------- restore from backup

export function showRestore(ctx, { hasExisting }) {
  const file = h("input", { type: "file", id: "restoreFile", accept: ".ninjabackup,.json,application/json,text/plain" });
  const kind = h("select", { id: "restoreKind" }, [
    h("option", { value: "password" }, "The backup's password"),
    h("option", { value: "recovery" }, "The backup's recovery key"),
  ]);
  const secret = h("input", { type: "password", id: "restoreSecret", autocomplete: "off", spellcheck: "false" });
  kind.addEventListener("change", () => { secret.type = kind.value === "password" ? "password" : "text"; });
  const err = errorBox();
  const go = h("button", { type: "submit", class: "btn-primary wide-btn" }, hasExisting ? "Replace my data with this backup" : "Restore");
  const back = h("button", { type: "button", class: "link-btn" }, "Back");
  back.addEventListener("click", () => ctx.restart());

  const form = h("form", { class: "lock-form" }, [
    field("Backup file", file, "The .ninjabackup file you downloaded from the Security tab."),
    field("I'll unlock it with", kind),
    field("Password or key", secret),
    hasExisting ? h("p", { class: "warn" }, "This replaces the data currently stored in this browser. (The previous copy is kept for one step in case of a mistake.)") : null,
    err.node, go,
  ]);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.set("");
    if (throttle.waitSeconds() > 0) { err.set(`Too many wrong tries. Please wait ${fmtWait(throttle.waitSeconds())}.`); return; }
    try {
      if (!file.files[0]) throw new Error("Choose the backup file first.");
      const vault = V.parseVaultFile(await readFileText(file.files[0]));
      const credential = kind.value === "password" ? { password: secret.value } : { recoveryKey: secret.value };
      const opened = await busy(go, "Unlocking...", () => V.unlock(vault, credential));
      throttle.reset();
      await ctx.session.startNew(vault, opened.dk, opened.dbBytes);
      if (credential.password) {
        await finishUnlock(ctx, ctx.session.vault, opened.dk, opened.dbBytes, credential.password, "");
      } else {
        ctx.done();
      }
      secret.value = "";
    } catch (error) {
      if (error.code === "BAD_CREDENTIAL") {
        const r = throttle.recordFailure();
        err.set(friendly(error) + (r.wait > 0 ? ` Please wait ${fmtWait(r.wait)}.` : ""));
      } else err.set(friendly(error));
    }
  });

  show(...brand("Restore from a backup"), form, h("div", { class: "lock-foot" }, [back]));
}

// ---------------------------------------------------------------- entry point

/** Shows setup or unlock; resolves once the session is open and the app can start. */
export async function runLock(session) {
  return new Promise((resolve) => {
    const ctx = {
      session,
      done: () => { hideLockScreen(); resolve(); },
      async restart() {
        const stored = await session.loadStoredVault();
        stored ? showUnlock(ctx, stored) : showSetup(ctx);
      },
    };
    ctx.restart();
  });
}
