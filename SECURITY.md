# Security: what you get, and the honest limits

**What protects the data.** Everything is stored in Supabase. Every table has Row Level Security that only allows
*signed-in team members* (`supabase/schema.sql`); someone who is not signed in gets nothing, even with the site's public key.
Sign-ups are switched off, so only people you add can get an account. Connections use HTTPS. Hard deletes are not
allowed from the app (rows are marked deleted), so a mistake or a rogue login can't erase the history of changes at the database level
(you can still lose data through edits; keep downloaded copies).

**Things to know**
- **Not end-to-end encrypted.** Supabase (the company) and anyone with access to your Supabase account can read the data. Use a strong password and 2-step login on your Supabase and GitHub accounts.
- **All team members are equal.** Anyone with a login can read, edit, delete and replace everything (including the "replace all data" button). Give logins only to people you trust with all of it.
- **The code and the public key are public.** That's normal for this design: the `anon` key only identifies the project; the logins protect the data. Never put the `service_role` key anywhere in the repo.
- **Passwords:** Supabase enforces its own rules; the app asks for 12+ characters. Supabase rate-limits sign-in attempts.
- **Shared/public computers:** don't tick "Keep me signed in". The app signs out after inactivity (default 1 hour). Anyone at an unlocked, signed-in device sees everything. Malware or malicious browser extensions can read the screen.
- **Local copy:** while signed in, the working copy of the data is in the browser's memory only (not saved to disk by the app); signing out clears it.
- **Conflicts:** if two people edit the very same row at the same moment, the last save wins for that row.
- **Availability/backups:** free-plan projects pause after inactivity and have no automatic backups. Download copies regularly. The downloaded `.db` is unencrypted: protect or delete it.
- **Certificate template and logo are in the public repo.**
- GitHub Pages can't send security headers, so protections are a `<meta>` Content-Security-Policy (the page may only talk to itself and `*.supabase.co`) and a frame-buster.
- Tested with automated tests and a headless browser against a **simulated** Supabase; not an outside audit, and not yet run against your real project when this was written — do the smoke test in SETUP step 5.
