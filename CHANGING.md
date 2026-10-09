# Changing things later

Plain JavaScript modules, no build step: edit a file, commit, refresh. Run `npm test` after changes.

## Map
- `index.html`, `css/style.css` (original look), `css/lock.css` (sign-in, account tab)
- `js/app.js` — the original screens. They call `window.ninjaApi(method, "/api/...")` exactly like the old fetch calls.
- `js/api/*.js` — the old Flask routes with the same URLs and JSON (`leads`, `belts`, `active`, `rewards`, `settings`); `router.js` has `route(method, pattern, handler)`. They run against a local SQLite copy.
- `js/lib/*` — helpers ported from Python (CSV, schedule import, reward rules)
- `js/pdf/*` — certificates and totem tags (pdf-lib). `data/certificate_layout.json` + `assets/certificate_template.pdf`
- `js/core/db.js` — local tables (`SCHEMA`), `DEFAULT_SETTINGS`, `MIGRATIONS`, SQL helpers, `SYNC_TABLES`
- `js/sync/` — `config.js` (your Supabase URL/key), `supabase.js` (login + table access), `sync.js` (send/receive changes), `login.js`, `account_panel.js`
- `supabase/schema.sql` — the shared tables and who may use them
- `tests/` — `test_routes.mjs` (API behaviour vs recorded output of the original Python app), `test_sync.mjs` (two people, conflicts, offline), `mock_supabase.mjs`, `e2e/` (browser, optional)

## Recipes
**Add a field to a table** (needs changes in 3 places, keep them identical):
1. `js/core/db.js`: add the column to `SCHEMA` **and** a function in `MIGRATIONS` (`ALTER TABLE ... ADD COLUMN ...`) — the local copy is rebuilt on every sign-in, so SCHEMA is what matters, but keep both.
2. Supabase SQL Editor: `alter table public.leads add column source text;` (same name and type family).
3. Use it in the route (`js/api/…`) and the screen (`js/app.js`). Sync picks up new columns automatically.
Do the Supabase step *before* publishing the new website files, or saves will fail.
**Add a route:** in the right `js/api/*.js` add `route("GET", "/api/thing/:id", ({params, query, body}) => ...)`; any route that changes data is synced automatically.
**Add a whole new table:** add it to `SCHEMA` and `SYNC_TABLES` (db.js) and create it in Supabase using the same pattern as `supabase/schema.sql` (identity id, `updated_at`, `deleted`, trigger, RLS policy, grants) — and add its name to the table list in that file's `do $$` loop.
**New setting:** add to `DEFAULT_SETTINGS` in `db.js` (applies when the shared database has none).
**Add / remove a team member:** Supabase → Authentication → Users.
**Change the certificate:** replace `assets/certificate_template.pdf`, then `pip install pdfplumber` and `python3 tools/extract_layout.py`; adjust `js/pdf/certificates.js` if positions change.
**Totem tag look:** `js/pdf/totem_tags.js`.
**How often it syncs:** `intervalMs` in `js/main.js` (default 15 s). **Auto sign-out choices:** `js/core/autolock.js`.
**Update SQLite:** `python3 tools/fetch_sqljs_from_npm.py <version>` (checks npm's integrity hash).
**Roles (e.g. read-only members):** not built. It would be done with a `profiles` table + stricter policies in `schema.sql`.
