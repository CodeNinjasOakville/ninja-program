# Setup

## 1. Put it on GitHub Pages (about 10 minutes, free)
1. Make a GitHub account and click **New repository**. Name it (e.g. `ninja-program`), choose **Public**, create it.
   *(Free GitHub Pages requires a public repository. Never put real data in the repo — data is only ever in your browser.)*
2. Click **uploading an existing file**, drag in **everything inside this folder** (including the hidden `.nojekyll`
   and `.github` if your computer shows them; the site works without `.github`). Commit.
   Easier alternative: `git init`, `git add .`, `git commit`, then push to the repo.
3. Repo **Settings → Pages**. Under *Build and deployment* choose **Deploy from a branch**, branch **main**, folder **/ (root)**, Save.
4. After a minute the page shows your address: `https://YOUR-NAME.github.io/ninja-program/`. Open it.
   **Do not rename the repository later** — the data is tied to the address; a rename makes it look empty
   (restore from a backup file to fix).

## 2. First run
1. Choose a password (12+ characters; four random words joined together is great).
2. Optional: choose **Start from my existing ninja_system.db** to bring in your old data. Otherwise start empty.
3. A **recovery key** appears (8 groups of letters/numbers). Save it somewhere that is *not* this browser
   (print it, password manager). You must retype it to continue — this proves you saved it.
4. Use the app as before. The top bar shows **Saved**.

## 3. Every day
- Open the address, enter the password. The app auto-locks after 15 minutes idle (change in the **Security** tab).
- Only one tab can have it open at a time.

## 4. Backups (important)
Browsers can lose site data (cleared history, "free up space", Safari after ~7 days unused).
**Security → Download encrypted backup** regularly; store the file in a cloud drive/USB. It is encrypted, so that's safe.
The top bar nags you when changes aren't backed up for a week.

## 5. Moving to another device / browser
Old device: Security → Download encrypted backup. New device: open the address → **Restore from a backup file** →
choose the file and enter its password (or its recovery key). A restored backup keeps the password it was made with.

## 6. Forgot the password
On the unlock screen choose **Forgot password** and enter the recovery key. You'll set a new password and get a new recovery key.
Lost **both** password and recovery key = data cannot be opened (that's the point of encryption). Backups don't help without one of them.

## 7. Updating the app
Edit/replace files in the repo (web upload or git). Your data is untouched, since it lives in your browser.
Hard-refresh (Ctrl/Cmd+Shift+R) after an update. Database changes are applied automatically (see CHANGING.md).

## Run locally / test
`python3 -m http.server 8000` then http://localhost:8000 (data there is separate from the GitHub address). `npm test` runs the checks.
