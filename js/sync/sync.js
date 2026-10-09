// Keeps the in-browser working copy (SQLite) and the shared Supabase tables in step.
//
// How it works, in plain words:
//  * The screens and js/api/* routes still talk to the local SQLite copy exactly as before.
//  * After any change, the difference between the local copy and what the server last told us
//    is sent to the server (new rows, edited rows, deleted rows).
//  * Every ~15 seconds (and whenever the tab comes back into view) we ask the server for rows
//    changed by other people and fold them into the local copy.
//  * If two people edit the SAME row at the same moment, the last one saved wins for that row.
//    Different rows never conflict.

import { conn, takeDirty, SYNC_TABLES, tableColumns, renameRowIds, seedDefaultSettings } from "../core/db.js";

const OVERLAP_MS = 120000;   // re-ask for the last 2 minutes each time, in case a change committed late
const PAGE = 1000;
const CHUNK = 400;

const jsonOf = (cols, row) => JSON.stringify(cols.map((c) => (row[c] === undefined ? null : row[c])));

export class Sync {
  constructor(client, { intervalMs = 15000, debounceMs = 400, now = () => Date.now() } = {}) {
    this.client = client;
    this.intervalMs = intervalMs;
    this.debounceMs = debounceMs;
    this.now = now;
    this.known = {};            // table -> Map(key -> json as last agreed with the server)
    for (const t of Object.keys(SYNC_TABLES)) this.known[t] = new Map();
    this.since = null;          // ISO time of the newest change we have seen
    this.state = "idle";        // idle | syncing | synced | error
    this.lastError = null;
    this.lastSyncedAt = null;
    this.remoteChanges = 0;     // rows brought in from other people during the last cycle
    this._chain = Promise.resolve();
    this._timer = null;
    this._poll = null;
    this._listeners = [];
    this._remoteListeners = [];
    this._stopped = false;
  }

  onStatus(fn) { this._listeners.push(fn); }
  onRemoteChange(fn) { this._remoteListeners.push(fn); }
  _set(state, error = null) {
    this.state = state;
    this.lastError = error;
    if (state === "synced") this.lastSyncedAt = new Date(this.now());
    this._listeners.forEach((fn) => fn(state, error));
  }

  /** True while there may be changes that the server doesn't have yet. */
  get unsynced() { return this.state === "syncing" || this.state === "error" || !!this._timer; }

  /** First load: fetch everything (throws if the server can't be reached). */
  async start() {
    await this._run(true);
    seedDefaultSettings();      // brand-new shared database: add the starter dropdown lists (no-op otherwise)
    takeDirty();
    await this.syncNow();
    this._poll = setInterval(() => this.syncNow(), this.intervalMs);
  }

  stop() {
    this._stopped = true;
    clearTimeout(this._timer); this._timer = null;
    clearInterval(this._poll); this._poll = null;
  }

  /** Something changed locally: send it soon. */
  request() {
    if (this._stopped) return;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => { this._timer = null; this.syncNow(); }, this.debounceMs);
  }

  /** Send and receive now. Resolves when this round is finished (never throws; see .state). */
  syncNow() {
    clearTimeout(this._timer); this._timer = null;
    this._chain = this._chain.then(() => this._run(false)).catch(() => {});
    return this._chain;
  }

  async _run(initial) {
    if (this._stopped) return;
    this._set("syncing");
    try {
      if (!initial) await this._push();
      await this._pull();
      await this._push();
      this._set("synced");
    } catch (error) {
      this._set("error", error);
      if (initial) throw error;
    }
  }

  // ------------------------------------------------------------------ local view
  _snapshot(table) {
    const { pk } = SYNC_TABLES[table];
    const cols = tableColumns(table);
    const map = new Map();
    for (const row of conn.all(`SELECT ${cols.join(",")} FROM ${table}`)) map.set(row[pk], { row, json: jsonOf(cols, row) });
    return { cols, map };
  }

  // ------------------------------------------------------------------ sending
  async _push() {
    for (const table of Object.keys(SYNC_TABLES)) {
      if (table === "settings") await this._pushSettings();
      else await this._pushTable(table);
    }
  }

  async _pushSettings() {
    const { cols, map } = this._snapshot("settings");
    const known = this.known.settings;
    const changed = [...map.values()].filter((e) => known.get(e.row.key) !== e.json);
    for (let i = 0; i < changed.length; i += CHUNK) {
      const part = changed.slice(i, i + CHUNK);
      await this.client.rest("settings?on_conflict=key", {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: part.map((e) => ({ key: e.row.key, value: e.row.value })),
      });
      part.forEach((e) => known.set(e.row.key, e.json));
    }
    void cols;
  }

  async _pushTable(table) {
    const { cols, map } = this._snapshot(table);
    const known = this.known[table];
    const inserts = [], updates = [], deletes = [];
    for (const [id, e] of map) {
      if (!known.has(id)) inserts.push(e);
      else if (known.get(id) !== e.json) updates.push(e);
    }
    for (const id of known.keys()) if (!map.has(id)) deletes.push(id);

    for (let i = 0; i < inserts.length; i += CHUNK) {
      const part = inserts.slice(i, i + CHUNK);
      const sent = await this.client.rest(`${table}?select=id`, {
        method: "POST", headers: { Prefer: "return=representation" },
        body: part.map((e) => { const { id, ...rest } = e.row; return rest; }),
      });
      if (!Array.isArray(sent) || sent.length !== part.length) throw new Error("The server's reply to a save didn't make sense.");
      const pairs = part.map((e, n) => [e.row.id, sent[n].id]);
      renameRowIds(table, pairs);
      part.forEach((e, n) => {
        const row = { ...e.row, id: sent[n].id };
        known.set(sent[n].id, jsonOf(cols, row));
      });
      takeDirty();
    }
    for (const e of updates) {
      const { id, ...rest } = e.row;
      await this.client.rest(`${table}?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: rest });
      known.set(id, e.json);
    }
    for (let i = 0; i < deletes.length; i += CHUNK) {
      const part = deletes.slice(i, i + CHUNK);
      await this.client.rest(`${table}?id=in.(${part.join(",")})`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { deleted: true } });
      part.forEach((id) => known.delete(id));
    }
  }

  // ------------------------------------------------------------------ receiving
  async _fetchAll(table) {
    const { pk } = SYNC_TABLES[table];
    const filter = this.since
      ? `&updated_at=gte.${encodeURIComponent(this.since)}`
      : (table === "settings" ? "" : "&deleted=eq.false");
    const rows = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await this.client.rest(`${table}?select=*&order=updated_at.asc,${pk}.asc&limit=${PAGE}&offset=${offset}${filter}`);
      rows.push(...page);
      if (page.length < PAGE) break;
    }
    return rows;
  }

  async _pull() {
    const fetched = {};
    for (const table of Object.keys(SYNC_TABLES)) fetched[table] = await this._fetchAll(table);
    // From here on there are no awaits: nothing can change underneath us while we merge.
    let newest = 0, changes = 0;
    for (const table of Object.keys(SYNC_TABLES)) {
      changes += this._merge(table, fetched[table]);
      for (const r of fetched[table]) newest = Math.max(newest, Date.parse(r.updated_at) || 0);
    }
    if (newest) this.since = new Date(Math.max(newest - OVERLAP_MS, 0)).toISOString();
    else if (!this.since) this.since = new Date(this.now() - OVERLAP_MS).toISOString();
    takeDirty();
    this.remoteChanges = changes;
    if (changes) this._remoteListeners.forEach((fn) => fn(changes));
  }

  _merge(table, rows) {
    if (!rows.length) return 0;
    const { pk } = SYNC_TABLES[table];
    const known = this.known[table];
    let { cols, map } = this._snapshot(table);

    // A row made here but not yet saved may be using an id the server has since handed to someone else.
    if (pk === "id") {
      const taken = new Set(rows.filter((r) => !r.deleted).map((r) => r.id));
      const clash = [...map.keys()].filter((id) => !known.has(id) && taken.has(id));
      if (clash.length) {
        let next = Math.max(0, ...map.keys(), ...rows.map((r) => r.id)) + 1;
        renameRowIds(table, clash.map((id) => [id, next++]));
        ({ cols, map } = this._snapshot(table));
      }
    }

    let changes = 0;
    const put = conn;
    for (const r of rows) {
      const key = r[pk];
      const local = map.get(key);
      if (r.deleted) {
        known.delete(key);
        if (local) { put.run(`DELETE FROM ${table} WHERE ${pk} = ?`, [key]); changes++; }
        continue;
      }
      const incoming = jsonOf(cols, r);
      if (!local && known.has(key)) continue;                                    // deleted here, not yet sent: stays deleted
      if (local && local.json === incoming) { known.set(key, incoming); continue; }
      if (local && known.has(key) && known.get(key) !== local.json) continue;   // edited here, not yet sent: ours wins
      put.run(`INSERT OR REPLACE INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`, cols.map((c) => (r[c] === undefined ? null : r[c])));
      known.set(key, incoming);
      changes++;
    }
    return changes;
  }
}
