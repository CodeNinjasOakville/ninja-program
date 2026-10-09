// A small in-memory imitation of Supabase (login + the table API) for tests.
// It enforces the same things the real one does that the app relies on: you must be signed in,
// ids are handed out by the server, updated_at is set by the server, filters/paging work.
export function createMockSupabase({ users = { "a@example.com": "passw0rd-long-1", "b@example.com": "passw0rd-long-2" }, tokenSeconds = 3600 } = {}) {
  const URL_ = "https://mock.supabase.co";
  const tables = { leads: [], belt_entries: [], receipts: [], active_ninjas: [], settings: [] };
  const identity = { leads: 0, belt_entries: 0, receipts: 0, active_ninjas: 0 };
  const defaults = {
    leads: { entry_number: null, parent_name: null, phone_number: null, email: null, age: null, gbs_type: null, staff_name: null, coding_experience: null, comments: null, gbs_date: null, gbs_time: null, post_gbs_follow_up: null, gbs_completed: null, lead_date: null },
    belt_entries: { old_belt: null, new_belt: null }, receipts: { details: null, entry_type: null }, active_ninjas: { day: null, time_slot: null, is_ai: 0, notes: null }, settings: {},
  };
  const notNull = { leads: ["ninja_name"], belt_entries: ["name"], receipts: ["date", "name", "reward_type", "amount"], active_ninjas: ["name"], settings: ["key", "value"] };
  const tokens = new Map();     // access token -> { email, expires }
  const refresh = new Map();    // refresh token -> email
  const stats = { requests: 0, restCalls: 0, failNext: 0, log: [] };
  let clock = Date.parse("2026-10-09T12:00:00Z"), n = 0;
  const tick = () => new Date((clock += 1000)).toISOString();
  const api = { tables, stats, users, url: URL_, advance(ms) { clock += ms; }, expireAllAccessTokens() { tokens.clear(); } };

  const respond = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => (body === undefined ? "" : JSON.stringify(body)) });
  const issue = (email) => {
    const access = "acc" + ++n, ref = "ref" + n;
    tokens.set(access, { email }); refresh.set(ref, email);
    return { access_token: access, refresh_token: ref, expires_in: tokenSeconds, user: { email } };
  };

  function parseFilters(params) {
    const out = [];
    for (const [k, v] of params) {
      if (["select", "order", "limit", "offset", "on_conflict"].includes(k)) continue;
      const dot = v.indexOf("."); const op = v.slice(0, dot), val = v.slice(dot + 1);
      out.push({ k, op, val });
    }
    return out;
  }
  const matches = (row, f) => {
    const x = row[f.k];
    if (f.op === "eq") return String(x) === f.val || (f.val === "false" && x === false) || (f.val === "true" && x === true);
    if (f.op === "gte") return String(x) >= f.val;
    if (f.op === "in") return f.val.replace(/^\(|\)$/g, "").split(",").includes(String(x));
    throw new Error("mock: unsupported filter " + f.op);
  };

  api.invite = (email) => { users[email] ??= null; const t = issue(email); return `#access_token=${t.access_token}&refresh_token=${t.refresh_token}&expires_in=3600&type=invite`; };
  api.fetch = async (url, init = {}) => {
    stats.requests++;
    if (stats.failNext > 0) { stats.failNext--; throw new TypeError("network down"); }
    const u = new URL(url);
    const method = init.method || "GET";
    const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    const body = init.body ? JSON.parse(init.body) : undefined;
    const p = u.pathname;
    stats.log.push(`${method} ${p}${u.search}`.slice(0, 160));

    if (p === "/auth/v1/token") {
      const grant = u.searchParams.get("grant_type");
      if (grant === "password") {
        if (users[body.email] && users[body.email] === body.password) return respond(200, issue(body.email));
        return respond(400, { error_code: "invalid_credentials", msg: "Invalid login credentials" });
      }
      const email = refresh.get(body.refresh_token);
      if (!email) return respond(400, { error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
      return respond(200, { ...issue(email), refresh_token: body.refresh_token });
    }
    const bearer = (headers.authorization || "").replace(/^Bearer /, "");
    const who = tokens.get(bearer);
    if (p === "/auth/v1/user") {
      if (!who) return respond(401, { msg: "invalid JWT" });
      if (method === "PUT") { users[who.email] = body.password; return respond(200, { email: who.email }); }
      return respond(200, { email: who.email });
    }
    if (p === "/auth/v1/logout") return respond(204);
    if (p === "/auth/v1/recover") { (api.recoverRequests ||= []).push(body.email); return respond(200, {}); }

    const m = p.match(/^\/rest\/v1\/(\w+)$/);
    if (!m || !tables[m[1]]) return respond(404, { message: "not found" });
    if (!who) return respond(401, { code: "PGRST301", message: "JWT expired" });
    stats.restCalls++;
    const t = m[1], rows = tables[t], pk = t === "settings" ? "key" : "id";
    const prefer = headers.prefer || "";

    if (method === "GET") {
      let res = rows.filter((r) => parseFilters(u.searchParams).every((f) => matches(r, f)));
      const order = (u.searchParams.get("order") || "").split(",").filter(Boolean);
      res.sort((a, b) => { for (const o of order) { const [c] = o.split("."); if (a[c] < b[c]) return -1; if (a[c] > b[c]) return 1; } return 0; });
      const off = Number(u.searchParams.get("offset") || 0), lim = Math.min(Number(u.searchParams.get("limit") || 1000), 1000);
      return respond(200, res.slice(off, off + lim).map((r) => ({ ...r })));
    }
    if (method === "POST") {
      const list = Array.isArray(body) ? body : [body];
      const out = [];
      for (const item of list) {
        for (const c of notNull[t]) if (item[c] === undefined || item[c] === null) return respond(400, { code: "23502", message: `null value in column "${c}"` });
        if (t === "settings") {
          const ex = rows.find((r) => r.key === item.key);
          if (ex) { if (!prefer.includes("merge-duplicates")) return respond(409, { code: "23505", message: "duplicate key" }); Object.assign(ex, item, { updated_at: tick() }); out.push(ex); continue; }
          const row = { ...item, updated_at: tick() }; rows.push(row); out.push(row);
        } else {
          const row = { ...defaults[t], ...item, id: ++identity[t], created_at: item.created_at ?? "2026-10-09 12:00:00", updated_at: tick(), deleted: false };
          delete row.id_; rows.push(row); out.push(row);
        }
      }
      return respond(prefer.includes("return=representation") ? 201 : 201, prefer.includes("return=representation") ? out.map((r) => ({ id: r.id })) : undefined);
    }
    if (method === "PATCH") {
      const filters = parseFilters(u.searchParams);
      if (!filters.length) return respond(400, { message: "PATCH needs a filter" });
      for (const r of rows.filter((r) => filters.every((f) => matches(r, f)))) Object.assign(r, body, { updated_at: tick() });
      return respond(204);
    }
    return respond(405, { message: "method not allowed (this mock has no DELETE, like the real grants)" });
  };
  return api;
}
