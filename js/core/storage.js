// Where the encrypted vault lives in the browser (IndexedDB), plus a few small
// non-secret preferences in localStorage. Only ciphertext is ever stored.
// Swapping the storage (tests use memoryStorage) doesn't change any other code.

export function memoryStorage() {
  const map = new Map();
  return {
    async get(key) { return map.has(key) ? structuredClone(map.get(key)) : undefined; },
    async setMany(entries) { for (const [k, v] of entries) map.set(k, structuredClone(v)); },
    async remove(keys) { keys.forEach((k) => map.delete(k)); },
  };
}

export function idbStorage(dbName = "ninja-program") {
  let opened = null;
  const open = () => opened || (opened = new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Could not open browser storage."));
  }));
  const done = (tx) => new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Saving was cancelled."));
  });
  return {
    async get(key) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const req = db.transaction("kv").objectStore("kv").get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    // One transaction: either every entry is written or none is.
    async setMany(entries) {
      const db = await open();
      const tx = db.transaction("kv", "readwrite");
      for (const [k, v] of entries) tx.objectStore("kv").put(v, k);
      await done(tx);
    },
    async remove(keys) {
      const db = await open();
      const tx = db.transaction("kv", "readwrite");
      keys.forEach((k) => tx.objectStore("kv").delete(k));
      await done(tx);
    },
  };
}

// Which copy of the app this is. GitHub Pages gives every repo of one account the SAME browser
// storage area, so names are prefixed with the page's folder to keep two copies (say a test
// site and the real one) from ever touching each other's data. main.js sets this once at start.
let scope = "ninja";
export function setStorageScope(value) { scope = value; }
export function storageScope() { return scope; }

// Small non-secret preferences (auto-lock minutes, last backup time...).
export const prefs = {
  get(key, fallback) {
    try { const v = localStorage.getItem(scope + "." + key); return v === null ? fallback : v; } catch (_) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(scope + "." + key, String(value)); } catch (_) { /* private mode: ignore */ }
  },
  remove(key) {
    try { localStorage.removeItem(scope + "." + key); } catch (_) { /* ignore */ }
  },
};

/** Ask the browser not to evict our data when disk space is short. Returns true if granted. */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch (_) { /* not supported */ }
  return false;
}

/** { persisted: bool|null, usage: bytes|null, quota: bytes|null } for the Security tab. */
export async function storageInfo() {
  const info = { persisted: null, usage: null, quota: null };
  try {
    if (navigator.storage && navigator.storage.persisted) info.persisted = await navigator.storage.persisted();
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      info.usage = e.usage ?? null; info.quota = e.quota ?? null;
    }
  } catch (_) { /* leave nulls */ }
  return info;
}
