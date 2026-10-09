Optional browser test (needs Playwright + Chromium, not bundled). It uses an in-memory fake Supabase, so no account is needed.
1. Copy the project to a temp folder and put `https://mock.supabase.co` / any key into that copy's `js/sync/config.js`.
2. Serve that copy: `python3 -m http.server 8766` (inside it).
3. `LEGACY_DB=/path/to/a/COPY/of/ninja_system.db node tests/e2e/e2e_team.mjs`
