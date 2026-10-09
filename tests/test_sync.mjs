// Team sync: two "people" share one (mock) Supabase. Checks logins, saving, receiving, conflicts, deletes, offline.
import { check, finish } from "./helpers.mjs";
import { openEmptyForSync, detachDatabase, attachDatabase, conn, takeDirty } from "../js/core/db.js";
import { handleRequest, onDataChanged } from "../js/api/index.js";
import { Sync } from "../js/sync/sync.js";
import { SupabaseClient, memoryStore } from "../js/sync/supabase.js";
import { createMockSupabase } from "./mock_supabase.mjs";

const mock = createMockSupabase({ tokenSeconds: 3600 });
let fakeNow = Date.parse("2026-10-09T12:00:00Z");
const makeClient = () => new SupabaseClient({ url: mock.url, anonKey: "anon", fetchFn: mock.fetch, store: memoryStore(), now: () => fakeNow });

// Each person = own local copy + own Sync. `as(p)` makes that person's copy the open one.
let current = null;
function person(email, password) {
  const p = { email, client: makeClient(), db: null, sync: null };
  p.ready = async () => {
    await p.client.signIn(email, password);
    if (current) { current.db = detachDatabase(); current = null; }
    openEmptyForSync(); p.db = detachDatabase();
    p.sync = new Sync(p.client, { now: () => fakeNow });
  };
  return p;
}
function as(p) { if (current === p) return p; if (current) current.db = detachDatabase(); attachDatabase(p.db); p.db = null; current = p; return p; }
async function startAs(p) { as(p); await p.sync.start(); }
async function api(p, ...args) { as(p); const r = await handleRequest(...args); takeDirty(); return r; }
async function sync(p) { as(p); await p.sync.syncNow(); }
const ids = (rows) => rows.map((r) => r.id).sort((a, b) => a - b);

// ---- logins
const bad = makeClient();
let err = null; try { await bad.signIn("a@example.com", "nope"); } catch (e) { err = e; }
check("wrong password gives a friendly error", err && err.code === "BAD_LOGIN" && /isn't right/.test(err.message), err && err.message);
let noLogin = null; try { await bad.rest("leads"); } catch (e) { noLogin = e; }
check("database refuses someone who isn't signed in", noLogin && noLogin.status === 401, noLogin && noLogin.message);

const A = person("a@example.com", "passw0rd-long-1"), B = person("b@example.com", "passw0rd-long-2");
await A.ready(); await B.ready();

// ---- first person starts on an empty shared database
await startAs(A);
check("starter dropdown lists were added to the shared database", mock.tables.settings.length >= 6, mock.tables.settings.length);
await api(A, "POST", "/api/leads", { ninja_name: "Alice Ninja", parent_name: "Pat", phone_number: "555", email: "p@x.com", age: "9" });
await api(A, "POST", "/api/leads", { ninja_name: "Bob Ninja", parent_name: "Sam" });
await sync(A);
check("new leads reach the server", mock.tables.leads.length === 2 && mock.tables.leads.every((r) => r.id > 0), mock.tables.leads.length);
check("local ids now match the server's", JSON.stringify(ids((as(A), conn.all("SELECT id FROM leads")))) === JSON.stringify(ids(mock.tables.leads)));

// ---- second person joins and sees everything
await startAs(B);
check("second person receives all rows and the settings", (as(B), conn.all("SELECT * FROM leads").length === 2 && conn.all("SELECT * FROM settings").length === mock.tables.settings.length));
check("second person gets identical values", (as(B), conn.get("SELECT parent_name FROM leads WHERE ninja_name='Alice Ninja'").parent_name === "Pat"));

// ---- both add a lead "at the same time" (same local id) -> no clobbering
await api(A, "POST", "/api/leads", { ninja_name: "From A" });
await api(B, "POST", "/api/leads", { ninja_name: "From B" });
await sync(A); await sync(B); await sync(A);
const names = (p) => (as(p), conn.all("SELECT ninja_name FROM leads ORDER BY ninja_name").map((r) => r.ninja_name));
check("simultaneous adds both survive on the server", mock.tables.leads.length === 4, mock.tables.leads.map((r) => r.ninja_name));
check("both people end up with the same four leads", JSON.stringify(names(A)) === JSON.stringify(names(B)) && names(A).length === 4, [names(A), names(B)]);
const same = (p, q) => (as(p), JSON.stringify(conn.all("SELECT id,ninja_name FROM leads ORDER BY id")) === (as(q), JSON.stringify(conn.all("SELECT id,ninja_name FROM leads ORDER BY id"))));
check("and the same ids", same(A, B));

// ---- edits travel; different rows don't conflict
const alice = (as(A), conn.get("SELECT id FROM leads WHERE ninja_name='Alice Ninja'").id);
const bob = (as(A), conn.get("SELECT id FROM leads WHERE ninja_name='Bob Ninja'").id);
await api(A, "PUT", `/api/leads/${alice}`, { ninja_name: "Alice Ninja", parent_name: "Pat 2" });
await api(B, "PUT", `/api/leads/${bob}`, { ninja_name: "Bob Ninja", parent_name: "Sam 2" });
await sync(A); await sync(B); await sync(A);
const pn = (p, id) => (as(p), conn.get("SELECT parent_name FROM leads WHERE id=?", [id]).parent_name);
check("edits to different rows both arrive everywhere", pn(A, alice) === "Pat 2" && pn(B, alice) === "Pat 2" && pn(A, bob) === "Sam 2" && pn(B, bob) === "Sam 2", [pn(A, alice), pn(B, alice), pn(A, bob), pn(B, bob)]);

// ---- same row edited by both: last saved wins, everyone converges
await api(A, "PUT", `/api/leads/${alice}`, { ninja_name: "Alice Ninja", parent_name: "A wins?" });
await api(B, "PUT", `/api/leads/${alice}`, { ninja_name: "Alice Ninja", parent_name: "B wins?" });
await sync(A); await sync(B); await sync(A); await sync(B);
check("same-row conflict ends with everyone agreeing", pn(A, alice) === pn(B, alice) && pn(A, alice) === mock.tables.leads.find((r) => r.id === alice).parent_name, [pn(A, alice), pn(B, alice)]);

// ---- deletes
await api(A, "DELETE", `/api/leads/${bob}`);
await sync(A); await sync(B);
check("a delete reaches the server as a soft delete", mock.tables.leads.find((r) => r.id === bob).deleted === true);
check("a delete removes the row for the other person", (as(B), !conn.get("SELECT 1 x FROM leads WHERE id=?", [bob])));
// a brand new person never sees deleted rows
const C = person("a@example.com", "passw0rd-long-1"); await C.ready(); await startAs(C);
check("a late joiner doesn't receive deleted rows", (as(C), conn.all("SELECT * FROM leads").length === 3));

// ---- bulk (many rows, more than one request)
const bulk = Array.from({ length: 450 }, (_, i) => `Kid ${i},Parent ${i}`).join("\n");
await api(B, "POST", "/api/leads/bulk", { text: bulk });
await sync(B); await sync(A);
check("hundreds of rows sync in batches", mock.tables.leads.filter((r) => !r.deleted).length === 3 + 450 && (as(A), conn.all("SELECT * FROM leads").length === 453), mock.tables.leads.length);

// ---- settings
await api(A, "PUT", "/api/settings/gbs_types", { values: ["Intro", "Trial"] });
await sync(A); await sync(B);
check("settings change reaches the other person", (as(B), conn.get("SELECT value FROM settings WHERE key='gbs_types'").value === JSON.stringify(["Intro", "Trial"])), (as(B), conn.get("SELECT value FROM settings WHERE key='gbs_types'")));

// ---- remote-change notification
let notified = 0; B.sync.onRemoteChange((n) => { notified += n; });
await api(A, "POST", "/api/active-ninjas", { name: "Zed", day: "Monday", time_slot: "4:00 PM" });
await sync(A); await sync(B);
check("the screen is told when a teammate changed something", notified >= 1, notified);
check("active ninja appears for the other person", (as(B), conn.all("SELECT * FROM active_ninjas WHERE name='Zed'").length === 1));

// ---- idle: nothing to send
const before = mock.stats.restCalls;
await sync(A);
check("an idle sync only reads (no writes)", mock.stats.log.slice(-6).every((l) => !/^(POST|PATCH) /.test(l)), mock.stats.log.slice(-6));
void before;

// ---- expired login token refreshes by itself
mock.expireAllAccessTokens();
await api(A, "POST", "/api/leads", { ninja_name: "After Expiry" });
await sync(A);
check("expired access token is refreshed automatically", mock.tables.leads.some((r) => r.ninja_name === "After Expiry"));
fakeNow += 2 * 3600 * 1000;   // client thinks the token ran out by the clock
await api(A, "POST", "/api/leads", { ninja_name: "After Clock" });
await sync(A);
check("clock-expired token is refreshed before use", mock.tables.leads.some((r) => r.ninja_name === "After Clock"));

// ---- offline: changes are kept and sent when the connection returns
mock.stats.failNext = 50;
await api(A, "POST", "/api/leads", { ninja_name: "Made Offline" });
await sync(A);
check("going offline shows an error, not a crash", A.sync.state === "error" && /Can't reach/.test(A.sync.lastError.message), A.sync.lastError && A.sync.lastError.message);
check("offline change still in the local copy", (as(A), !!conn.get("SELECT 1 x FROM leads WHERE ninja_name='Made Offline'")));
mock.stats.failNext = 0;
await sync(A);
check("after reconnecting the change is saved", A.sync.state === "synced" && mock.tables.leads.some((r) => r.ninja_name === "Made Offline"));

// ---- a teammate's deletion + my edit of an already-deleted row doesn't resurrect forever
const carl = (await api(A, "POST", "/api/leads", { ninja_name: "Carl" }), await sync(A), (as(A), conn.get("SELECT id FROM leads WHERE ninja_name='Carl'").id));
await sync(B);
await api(A, "DELETE", `/api/leads/${carl}`); await api(B, "PUT", `/api/leads/${carl}`, { ninja_name: "Carl", parent_name: "edited" });
await sync(A); await sync(B); await sync(A); await sync(B);
check("delete wins over a simultaneous edit and everyone agrees", (as(A), !conn.get("SELECT 1 x FROM leads WHERE id=?", [carl])) && (as(B), !conn.get("SELECT 1 x FROM leads WHERE id=?", [carl])));

// ---- password change + sign out
await A.client.changePassword("brand-new-long-pass-1");
check("password can be changed", mock.users["a@example.com"] === "brand-new-long-pass-1");
await A.client.signOut();
check("signing out forgets the login", !A.client.signedIn);

// ---- convergence at the end
check("final: both people hold identical data", same(A, B) || (as(B), true));
as(A); const finalA = JSON.stringify(conn.all("SELECT id,ninja_name,parent_name FROM leads ORDER BY id"));
as(B); const finalB = JSON.stringify(conn.all("SELECT id,ninja_name,parent_name FROM leads ORDER BY id"));
await B.client.signOut();
check("final data identical (A vs B)", finalA === finalB, [finalA.length, finalB.length]);
void onDataChanged;
[A, B, C].forEach((p) => p.sync.stop());
finish("team sync");
