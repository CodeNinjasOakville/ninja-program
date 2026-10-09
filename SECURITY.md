# Security: what you get, and the honest limits

**Protected:** your data is stored only in your browser, as an AES-256-GCM encrypted SQLite file. A random
256-bit data key encrypts it; that key is itself locked by (a) your password via PBKDF2-SHA256 (1,000,000 rounds,
upgraded automatically if raised in `js/core/vault.js`) and (b) a 160-bit random recovery key. Changing the password
doesn't re-encrypt the data. Nothing is sent over the network (a strict Content-Security-Policy enforces this and
the tests check it). Auto-lock wipes the key from memory and reloads the page. Backup files are the same encrypted format.

**Limits you should know**
- **The code is public.** Anyone can read it, so the *only* secret is your password. Attackers who obtain your
  encrypted data (a backup file, or your device's browser storage) can try passwords offline; only a long, unique
  password stops that. PBKDF2 is slower to brute-force than nothing but weaker than Argon2 (couldn't be obtained here).
- **The "wait after 3 wrong tries" is a courtesy**, not protection: it is enforced in your browser only.
- **Someone with your logged-in, unlocked device** can see everything. Lock when leaving; keep the auto-lock on.
- Malware / malicious browser extensions on your device can read the screen or keystrokes. Encryption can't help.
- **Shared address:** all `*.github.io/<repo>/` copies under one account share an origin; the app scopes its storage by
  path, but don't host other untrusted pages under the same repo/user site.
- **Data loss:** clearing site data, browser reinstall, or Safari's 7-day rule deletes it. Keep backups.
  Lose password *and* recovery key = unrecoverable.
- **Certificate template and logo are in the public repo.** Don't put anything private in assets/.
- GitHub Pages can't send security headers, so protections are set via `<meta>` CSP and a frame-buster.
- The unencrypted `.db` export, and any unencrypted old `ninja_system.db`, are readable by anyone: delete after use.
- This was tested with automated tests and a headless browser, not an outside security audit.
