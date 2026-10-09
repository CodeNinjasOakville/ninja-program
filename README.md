# Ninja Program (GitHub Pages edition)

The same Ninja Program screens as before (Leads, Belts, Active Ninjas, Rewards, Reward History, Settings,
certificates, totem tags) but running **entirely in your browser**. There is no server. The database is SQLite
(compiled to WebAssembly) kept in your browser and **encrypted with a key protected by your password**.

| Read this | When |
|---|---|
| [SETUP.md](SETUP.md) | Putting it on GitHub Pages and first use — start here |
| [SECURITY.md](SECURITY.md) | What is and isn't protected, honestly |
| [CHANGING.md](CHANGING.md) | How to add a field, a page, a route, change the certificate, etc. |

Key facts: data lives in **one browser on one device**; move it with the encrypted backup file
(Security tab). The repository must be **public** on the free GitHub plan, so the code is public — the password
and recovery key are what protect the data. Keep backups.

Run the tests: `npm test` (needs Node 20+). Run locally: `python3 -m http.server 8000`, open http://localhost:8000.
