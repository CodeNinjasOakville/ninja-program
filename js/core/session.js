// An unlocked session: holds the data key in memory, owns the open database, and
// encrypts + saves it to storage whenever something changes.
//
// Everything that writes to storage goes through one queue (_enqueue), so a background
// autosave can never overwrite a change made a moment earlier (e.g. a new password).

import * as vaultLib from "./vault.js";
import { exportDatabase, openDatabase, closeDatabase, isOpen } from "./db.js";
import { prefs } from "./storage.js";

const SAVE_DELAY_MS = 600;

export class Session {
  constructor(storage) {
    this.storage = storage;
    this.vault = null;
    this.dk = null;
    this.timer = null;
    this.queue = Promise.resolve();
    this.listeners = new Set();
    this.state = "idle"; // idle | pending | saving | saved | error
    this.lastError = null;
    this.lastSavedAt = null;
  }

  onStatus(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit(state, error) {
    this.state = state; this.lastError = error || null;
    this.listeners.forEach((fn) => fn(state, error));
  }

  _enqueue(task) {
    const run = this.queue.then(task);
    this.queue = run.catch(() => {}); // a failed task must not block the next one
    return run;
  }

  /** Read the stored vault; falls back to the previous copy if the latest is damaged. */
  async loadStoredVault() {
    for (const [key, recovered] of [["vault", false], ["vault_prev", true]]) {
      try {
        const v = await this.storage.get(key);
        if (v) return { vault: vaultLib.validateVault(v), recoveredFromPrevious: recovered };
      } catch (_) { /* try the next copy */ }
    }
    return null;
  }

  /** Begin a session from an already-open key and database image (nothing is written yet). */
  async begin(vault, dk, dbBytes) {
    this.vault = vault;
    this.dk = dk;
    openDatabase(dbBytes);
  }

  /** Begin a brand-new / restored session and store its vault right away. */
  async startNew(vault, dk, dbBytes) {
    const previous = await this.storage.get("vault").catch(() => undefined);
    await this.begin(vault, dk, dbBytes);
    await this._enqueue(async () => {
      const next = await vaultLib.withData(this.vault, this.dk, exportDatabase());
      const entries = previous ? [["vault_prev", previous], ["vault", next]] : [["vault", next]];
      await this.storage.setMany(entries);
      this.vault = next;
      this.lastSavedAt = new Date();
      prefs.set("changes", 0);
      this._emit("saved");
    });
  }

  scheduleSave() {
    if (!this.dk) return;
    this._emit("pending");
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.saveNow().catch(() => {}); }, SAVE_DELAY_MS);
  }

  /** Encrypt the current database and write it (keeping the previous copy as a safety net). */
  saveNow() {
    clearTimeout(this.timer);
    return this._enqueue(async () => {
      if (!this.dk || !isOpen()) return;
      this._emit("saving");
      try {
        const next = await vaultLib.withData(this.vault, this.dk, exportDatabase());
        await this.storage.setMany([["vault_prev", this.vault], ["vault", next]]);
        this.vault = next;
        this.lastSavedAt = new Date();
        prefs.set("changes", Number(prefs.get("changes", 0)) + 1);
        this._emit("saved");
      } catch (error) {
        this._emit("error", error);
      }
    });
  }

  /** Persist a vault whose wraps changed (new password / recovery key) together with the current data. */
  replaceVault(newVault) {
    clearTimeout(this.timer);
    return this._enqueue(async () => {
      const next = await vaultLib.withData(newVault, this.dk, exportDatabase());
      await this.storage.setMany([["vault_prev", this.vault], ["vault", next]]);
      this.vault = next;
      this.lastSavedAt = new Date();
      this._emit("saved");
    });
  }

  /**
   * Swap the open database for another image (e.g. an old ninja_system.db), keeping the
   * current key and password. If the new image can't be opened, the old data is put back.
   */
  async replaceDatabase(bytes) {
    await this.queue;
    const before = exportDatabase();
    try {
      openDatabase(bytes);
    } catch (error) {
      openDatabase(before);
      throw error;
    }
    await this.saveNow();
    if (this.state === "error") throw this.lastError;
  }

  /**
   * Switch to a different vault entirely (restoring an encrypted backup). The backup's own
   * password and recovery key become the ones that apply afterwards.
   */
  async adopt(vault, dk, dbBytes) {
    await this.queue;
    const before = exportDatabase();
    try {
      openDatabase(dbBytes);
    } catch (error) {
      openDatabase(before);
      throw error;
    }
    const oldVault = this.vault;
    this.vault = vault;
    this.dk = dk;
    await this._enqueue(async () => {
      const next = await vaultLib.withData(vault, dk, exportDatabase());
      await this.storage.setMany([["vault_prev", oldVault], ["vault", next]]);
      this.vault = next;
      this.lastSavedAt = new Date();
      prefs.set("changes", 0);
      this._emit("saved");
    });
  }

  /** The current encrypted backup as downloadable text (always freshly saved first). */
  async backupText() {
    await this.saveNow();
    if (this.state === "error") throw this.lastError;
    prefs.set("lastBackup", new Date().toISOString());
    prefs.set("changes", 0);
    return vaultLib.serializeVault(this.vault);
  }

  /** Delete every stored copy of the data from this browser. */
  async wipe() {
    clearTimeout(this.timer);
    await this.queue;
    this.dk = null; this.vault = null;
    closeDatabase();
    await this.storage.remove(["vault", "vault_prev"]);
    ["changes", "lastBackup", "autolockMinutes", "throttle"].forEach((k) => prefs.remove(k));
  }

  /** Flush, then forget keys and data. The page reloads afterwards to wipe everything from memory. */
  async close() {
    await this.saveNow();
    this.dk = null; this.vault = null;
    closeDatabase();
  }
}
