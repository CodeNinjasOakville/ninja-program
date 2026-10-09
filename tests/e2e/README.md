Optional browser test (needs Playwright + Chromium, which are not bundled):
1. `python3 -m http.server 8765` in the project root
2. `LEGACY_DB=/path/to/a/test/ninja_system.db OUT_DIR=/tmp/e2e node tests/e2e/e2e_full.mjs`
Use a *copy* of a database; the test imports and replaces data inside a throwaway browser profile only.
