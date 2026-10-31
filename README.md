# Ninja Program — team version (GitHub Pages + Supabase)

https://codeninjasoakville.github.io/ninja-program/

The same Ninja Program screens as before (Leads, Belts, Active Ninjas, Rewards, Reward History, Settings,
certificates, totem tags), now usable by your whole team from anywhere.

- **The website** is static files on **GitHub Pages** (free).
- **The shared data** lives in a **Supabase** database (free plan) behind **per-person email + password logins**.
- Everyone sees the same data; changes appear on teammates' screens within about 15 seconds.

| Read this | When |
|---|---|
| [START_HERE.md](START_HERE.md) | **Step-by-step setup for beginners — start here** |
| [SETUP.md](SETUP.md) | Short technical version of the same steps |
| [SECURITY.md](SECURITY.md) | What is and isn't protected, honestly |
| [CHANGING.md](CHANGING.md) | How to add a field, a route, a team member, change the certificate… |

How it works inside: the original screens and routes (`js/app.js`, `js/api/*`) still run in the browser against a
local SQLite copy; `js/sync/` sends each change to Supabase and pulls teammates' changes. Tests: `npm test`.
