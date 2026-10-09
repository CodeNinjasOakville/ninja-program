// A very small Supabase client (login + table access) written with plain fetch(), so there is no
// library to download or keep up to date. It only does what this app needs.

export class SupabaseError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

/** Where the login is remembered: { get(): obj|null, set(obj), clear() }. */
export function webStore(storage, key) {
  return {
    get() { try { return JSON.parse(storage.getItem(key)); } catch (_) { return null; } },
    set(v) { try { storage.setItem(key, JSON.stringify(v)); } catch (_) { /* ignore */ } },
    clear() { try { storage.removeItem(key); } catch (_) { /* ignore */ } },
  };
}
export function memoryStore() {
  let v = null;
  return { get: () => v, set: (x) => { v = x; }, clear: () => { v = null; } };
}

export class SupabaseClient {
  constructor({ url, anonKey, fetchFn, store, now = () => Date.now() }) {
    // Accept the address however it was pasted (with /rest/v1/ or a trailing slash): only the site part matters.
    try { this.url = new URL(String(url).trim()).origin; } catch (_) { this.url = String(url || "").trim().replace(/\/+$/, ""); }
    this.anonKey = anonKey;
    this.fetchFn = fetchFn || ((...a) => globalThis.fetch(...a));
    this.store = store || memoryStore();
    this.now = now;
    this.session = this.store.get();      // { access_token, refresh_token, expires_at(ms), email }
    this._refreshing = null;
  }

  get email() { return this.session ? this.session.email : null; }
  get signedIn() { return !!(this.session && this.session.refresh_token); }

  async _call(path, { method = "GET", headers = {}, body, token } = {}) {
    let res;
    try {
      res = await this.fetchFn(this.url + path, {
        method,
        headers: {
          apikey: this.anonKey,
          ...(token ? { Authorization: "Bearer " + token } : {}),   // the project key goes in "apikey" only (new-style keys aren't JWTs)
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      throw new SupabaseError("Can't reach the server. Check your internet connection.", 0, "NETWORK");
    }
    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch (_) { data = text; } }
    if (!res.ok) {
      const message = data && (data.msg || data.message || data.error_description || data.error) || `Server error (${res.status}).`;
      throw new SupabaseError(String(message), res.status, data && (data.error_code || data.code));
    }
    return data;
  }

  _keep(tokens, email) {
    this.session = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || (this.session && this.session.refresh_token),
      expires_at: this.now() + (Number(tokens.expires_in) || 3600) * 1000,
      email: email || (tokens.user && tokens.user.email) || (this.session && this.session.email) || "",
    };
    this.store.set(this.session);
  }

  async signIn(email, password) {
    try {
      const data = await this._call("/auth/v1/token?grant_type=password", { method: "POST", body: { email: String(email).trim(), password } });
      this._keep(data, String(email).trim());
    } catch (error) {
      if (error.status === 400 || error.status === 401) throw new SupabaseError("That email or password isn't right.", error.status, "BAD_LOGIN");
      throw error;
    }
  }

  /** Use the one-time token from an invite / password-reset link (the page address after #). */
  async adoptLinkTokens({ access_token, refresh_token, expires_in }) {
    const user = await this._call("/auth/v1/user", { token: access_token });
    this._keep({ access_token, refresh_token, expires_in }, user.email);
  }

  async _refresh() {
    if (!this.signedIn) throw new SupabaseError("Please sign in again.", 401, "NO_SESSION");
    if (!this._refreshing) {
      this._refreshing = this._call("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: this.session.refresh_token } })
        .then((data) => this._keep(data))
        .catch((error) => {
          if (error.status === 400 || error.status === 401) { this.store.clear(); this.session = null; throw new SupabaseError("Your session ended. Please sign in again.", 401, "NO_SESSION"); }
          throw error;
        })
        .finally(() => { this._refreshing = null; });
    }
    return this._refreshing;
  }

  async _token() {
    if (!this.signedIn) throw new SupabaseError("Please sign in again.", 401, "NO_SESSION");
    if (this.now() > this.session.expires_at - 60000) await this._refresh();
    return this.session.access_token;
  }

  /** Call the database API ("/rest/v1/...") as the signed-in person; retries once if the login just expired. */
  async rest(path, opts = {}) {
    try {
      return await this._call("/rest/v1/" + path, { ...opts, token: await this._token() });
    } catch (error) {
      if (error.status !== 401 || !this.signedIn) throw error;
      await this._refresh();
      return this._call("/rest/v1/" + path, { ...opts, token: this.session.access_token });
    }
  }

  async changePassword(newPassword) {
    await this._call("/auth/v1/user", { method: "PUT", body: { password: newPassword }, token: await this._token() });
  }

  /** Email a reset link. Always looks like success so it can't be used to discover who has an account. */
  async sendReset(email, redirectTo) {
    try {
      await this._call("/auth/v1/recover" + (redirectTo ? "?redirect_to=" + encodeURIComponent(redirectTo) : ""), { method: "POST", body: { email: String(email).trim() } });
    } catch (error) {
      if (error.code === "NETWORK" || error.status >= 500 || error.status === 429) throw error;
    }
  }

  async signOut() {
    const token = this.session && this.session.access_token;
    this.store.clear();
    this.session = null;
    if (token) { try { await this._call("/auth/v1/logout", { method: "POST", token }); } catch (_) { /* already signed out locally */ } }
  }
}

/** Remembers the login in this browser (localStorage) or only for this tab (sessionStorage). */
export function switchableStore(key) {
  const local = webStore(globalThis.localStorage, key), tab = webStore(globalThis.sessionStorage, key);
  let remember = !!local.get();
  return {
    get remember() { return remember; },
    set remember(v) { remember = !!v; },
    get() { return local.get() || tab.get(); },
    set(v) { if (remember) { tab.clear(); local.set(v); } else { local.clear(); tab.set(v); } },
    clear() { local.clear(); tab.clear(); },
  };
}
