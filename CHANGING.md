# Changing things later

Plain JavaScript modules, no build step: edit a file, commit, refresh. Run `npm test` after changes.

## Map
- `index.html`, `css/style.css` (original look), `css/lock.css` (new parts)
- `js/app.js` — the original screens. It calls `window.ninjaApi(method, "/api/...")` exactly like the old fetch calls.
- `js/api/*.js` — the old Flask routes, same URLs and JSON: `leads`, `belts`, `active`, `rewards`, `settings`. `router.js` has `route(method, pattern, handler)`.
- `js/lib/*` — helpers ported from Python (CSV, schedule import, reward rules)
- `js/pdf/*` — certificates and totem tags (pdf-lib). `data/certificate_layout.json` + `assets/certificate_template.pdf`
- `js/core/db.js` — tables (`SCHEMA`), `DEFAULT_SETTINGS`, `MIGRATIONS`, SQL helpers
- `js/core/vault.js`, `session.js`, `lock.js`, `security_panel.js` — encryption, saving, lock screen, Security tab
- `tests/` — `test_routes.mjs` (API behaviour, compared with recorded output from the original Python app), `test_vault.mjs`, `e2e/` (browser, optional)

## Recipes
**Add a field to a table:** add the column in `SCHEMA` (new installs) *and* append a function to `MIGRATIONS` in `db.js`
(`ALTER TABLE ... ADD COLUMN`) so existing data upgrades automatically on unlock. Then use it in the route (`js/api/…`) and the screen (`js/app.js`).
**Add a route:** in the right `js/api/*.js` add `route("GET", "/api/thing/<id>", ({params, query, body}) => ...)`; mutating routes automatically trigger a save.
**New setting:** add to `DEFAULT_SETTINGS` in `db.js`.
**Change the certificate:** replace `assets/certificate_template.pdf`, then `pip install pdfplumber` and `python3 tools/extract_layout.py` to regenerate `data/certificate_layout.json`; adjust `js/pdf/certificates.js` if text positions change.
**Totem tag look:** `js/pdf/totem_tags.js`.
**Stronger/other password hashing:** change `DEFAULT_ITERATIONS` in `vault.js`; users upgrade silently at next login. A new KDF would be added next to `KDF_NAME` (the vault records which one it used, so old data keeps working).
**Auto-lock choices / backup reminder:** `js/core/autolock.js`, `backupState()` in `security_panel.js`.
**Update SQLite:** `python3 tools/fetch_sqljs_from_npm.py <version>` (checks npm's integrity hash). Current files came from the sql.js project's own published build.
**Different storage** (e.g. a file or cloud): implement the small `get/set` interface in `js/core/storage.js` (`memoryStorage` is the simplest example).
Never change the vault format without keeping the ability to open old ones (see `validateVault` / `version`).
