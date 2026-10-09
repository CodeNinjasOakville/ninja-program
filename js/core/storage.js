// Small non-secret preferences kept in this browser (auto-sign-out time, etc.).
// Everything that matters lives in the shared Supabase database, not here.

let scope = "ninja";
export function setStorageScope(value) { scope = value; }
export function storageScope() { return scope; }

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
