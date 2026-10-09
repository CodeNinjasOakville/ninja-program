# Setup (one time, about 30 minutes, free)

You need: a GitHub account, a Supabase account (sign up with GitHub or email), and your old `ninja_system.db` if you want to bring in existing data.

## 1. Create the shared database (Supabase)
1. Go to supabase.com → **New project**. Pick any name and the region nearest you. Choose a database password and keep it in a password manager (you will rarely need it). Wait ~2 minutes while it is created.
2. Left menu **SQL Editor → New query**. Open `supabase/schema.sql` from this folder, copy everything in, paste, click **Run**. It should say "Success".
3. **Authentication → Sign In / Providers → Email**: turn **OFF "Allow new users to sign up"** (so only people you add can ever get in). Leave email sign-in on.
4. **Project Settings → API** (or "API Keys"): copy the **Project URL** and the **anon / public** key.
   *Never* use the `service_role` / secret key anywhere in this app.

## 2. Connect the website to it
Open `js/sync/config.js` and paste the two values between the quotes. Save.

## 3. Put the website on GitHub Pages
1. GitHub → **New repository**, name it (e.g. `ninja-program`), **Public**, create. (Free Pages needs a public repo; the repo contains only code and the certificate template — **never any ninja data**.)
2. **Add file → Upload files**, drag in everything inside this folder (include the hidden `.nojekyll` file if your computer shows it), commit.
3. **Settings → Pages → Deploy from a branch → main / (root) → Save**. After a minute you get `https://YOUR-NAME.github.io/ninja-program/`.
4. Back in Supabase: **Authentication → URL Configuration**: set **Site URL** to that address and add it under **Redirect URLs** (this makes invite and password-reset emails land on your site).

## 4. Add your team (and yourself)
Supabase → **Authentication → Users**:
- **Add user → Create new user**: type their email and a first password, tick *Auto confirm*; tell them the password (they can change it on the Account tab). Most reliable.
- or **Invite user**: they get an email with a link where they choose their own password. (Supabase's built-in email sending is limited to a few emails per hour on the free plan.)
Remove someone's access later by deleting the user here.

## 5. First sign-in and bringing in the old data
1. Open your site address, sign in. The app loads (empty, with the usual dropdown lists).
2. **Account → "Replace ALL team data with an old ninja_system.db…"**, choose the file, type REPLACE. Wait for the green message. Done — everyone now sees it. Delete the loose `.db` file from your computer afterwards.

## Every day
Open the address, sign in (tick "Keep me signed in" on your own device only). The top bar shows **Synced**. If it says **NOT SAVED**, you're offline: keep the tab open, and it saves by itself when the connection returns.
Auto sign-out after 1 hour idle (change in Account).

## Backups (do this!)
Supabase's free plan does **not** include automatic backups. Regularly use **Account → Download a copy of all data (.db)** and keep it somewhere safe (it is *not* encrypted). Also: free projects are **paused after about a week with no use** — open the Supabase dashboard and click Restore if that happens; data is kept. (Check Supabase's current free-plan rules.)

## Forgot password
Sign-in screen → **Forgot password?** → email arrives → set a new one. (Or an admin sets a new one in Supabase → Authentication → Users.)

## Updating the app
Replace/edit files in the repo; refresh the site (Ctrl/Cmd+Shift+R). Data is in Supabase, so it is unaffected. For database changes see CHANGING.md.

## Test on your own computer
`python3 -m http.server 8000` then http://localhost:8000 (works with the same Supabase). `npm test` runs the automated checks.
