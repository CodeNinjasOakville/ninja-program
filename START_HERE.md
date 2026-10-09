# START HERE — step by step, no experience needed

**What you are building:** a website (your team opens it like any website) plus an online database where all your ninja data lives. You do this setup **once** (about 45 minutes). After that, your team just opens a link and signs in.

You will use **three things**, all free:
1. **GitHub** – holds the website's files and shows them as a website.
2. **Supabase** – holds the data and the team logins.
3. **This folder** – the files you upload to GitHub.

Have ready: your email address, the **ninja-program-team-version.zip** file, and your old **ninja_system.db** file.
Screens change a little over time, so button names may differ slightly — look for the closest match.

---

## PART A — Get the files ready
1. **Unzip** `ninja-program-team-version.zip` (right-click → Extract All / double-click on Mac). You get a folder called `ninja-program`.
2. Open it. You should see `index.html`, folders named `js`, `css`, `assets`, `vendor`, `supabase`… If you see another single folder inside, open that one — you want the folder that *directly* contains `index.html`.

## PART B — Put the website on GitHub
1. Go to **github.com** → **Sign up** (or sign in).
2. Top right **+** → **New repository**.
   - Repository name: `ninja-program` (no spaces).
   - Choose **Public**. (Free websites require this. Your ninja data will NOT be in here — only the program.)
   - Click **Create repository**.
3. On the next page click the link **"uploading an existing file"**.
4. Open your unzipped folder, press **Ctrl+A** (Cmd+A on Mac) to select **everything inside it** (not the folder itself), and **drag it onto the GitHub page**. Wait until every file and folder finishes uploading (a minute or two).
   - Tip: if the folders don't upload, use Chrome or Edge.
5. Scroll down, click the green **Commit changes**.
6. Check: the repository page should list `index.html`, `js`, `css`, and so on **at the top level**. If everything is inside one extra folder, delete the repo (Settings → bottom → Delete) and redo steps 2–5.

## PART C — Turn the website on
1. In your repository click **Settings** (top tab) → **Pages** (left menu).
2. Under **Build and deployment → Source** choose **Deploy from a branch**.
3. Under **Branch** choose **main** and **/ (root)**, then **Save**.
4. Wait 1–2 minutes and refresh the page. A box appears: **"Your site is live at https://YOURNAME.github.io/ninja-program/"**.
   **Copy that address and keep it** — it's your team's link. (If you open it now it will say the database isn't connected yet — that's expected.)

## PART D — Create the online database (Supabase)
1. Go to **supabase.com** → **Start your project** → sign up (you can use your GitHub login).
2. **New project**. Fill in: name `ninja-program`; a **database password** (make one up and save it in a password manager — you'll rarely need it); region = closest to you; plan = **Free**. Click **Create new project** and wait ~2 minutes.
3. **Create the tables.** In the left menu click **SQL Editor** → **New query**.
   - In another tab, open your GitHub repo → click the folder `supabase` → click `schema.sql` → click the **copy** icon (top right of the file view).
   - Paste into the Supabase query box and click **Run** (bottom right).
   - You should see **"Success. No rows returned"**. If you see a red error, copy it and tell me.
4. **Stop strangers signing up.** Left menu **Authentication** → **Sign In / Providers** (or "Providers") → **Email** → turn **OFF "Allow new users to sign up"** → Save.
5. **Tell it your website's address.** Authentication → **URL Configuration** → set **Site URL** to your address from Part C (`https://YOURNAME.github.io/ninja-program/`) → under **Redirect URLs** click Add URL and paste the same address → Save.
6. **Get the two connection values.** Left menu **Project Settings** (gear) → **API** (or "API Keys"). Copy:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - the **anon / public** key (a very long text). **NOT** the `service_role` / secret key — never use that one.
   Paste both into a notepad for the next part.

## PART E — Connect the website to the database
1. In your GitHub repo click folder `js` → folder `sync` → file `config.js`.
2. Click the **pencil icon** (Edit).
3. Paste your Project URL between the first pair of quotes and the anon key between the second pair, so it looks like:
   ```
   export const SUPABASE_URL = "https://abcdefgh.supabase.co";
   export const SUPABASE_ANON_KEY = "eyJhbGciOi....very long....";
   ```
4. Click **Commit changes** (green) → **Commit changes**. Wait ~1 minute for the site to update.

## PART F — Add yourself and your team
In Supabase: **Authentication → Users → Add user → Create new user**.
- Type their email and a first password (at least 12 characters). Tick **Auto Confirm User**. Click Create.
- Do this for yourself first, then each teammate. Tell each person their email + password; they can change it themselves later (Account tab).
- To remove someone later: same page, delete the user.

## PART G — First sign-in and moving in your old data (you, once)
1. Open your website address. You should see a **Sign in** box. Enter your email and password.
2. After a few seconds you see the normal Ninja Program (empty). The top bar shows **Synced**.
3. Click the **Account** tab (top row) → **"Replace ALL team data with an old ninja_system.db…"**.
4. Choose your `ninja_system.db` file, type the word `REPLACE`, click **Replace everything**. Wait for the green message (about a minute).
5. Click **Leads** — your old data should be there. Delete the loose `.db` file from your computer afterwards (it isn't protected).

## PART H — Your team uses it
Send each teammate **the website address + their email + their password**. They open the link, sign in, and use it exactly like the old program. Everything one person changes shows up for the others within ~15 seconds.

---

## Every day
- Open the link, sign in. Top bar says **Synced** = saved. **NOT SAVED** = no internet; keep the tab open and it saves itself when the connection returns.
- On a shared computer don't tick "Keep me signed in". It signs out automatically after an hour of no use.
- **Sign out** button is top right.

## Do this regularly: back up
Account tab → **Download a copy of all data (.db)**. Save it somewhere safe (it is not encrypted, so don't email it around). The free Supabase plan does **not** make backups for you. Also, a free Supabase project **pauses after about a week of no use** — if the site says it can't load data, open supabase.com, open your project and click **Restore**; nothing is lost.

## If something goes wrong
| You see | Do this |
|---|---|
| "The team database isn't connected yet" | Part E wasn't saved, or wait 1–2 min after committing, then refresh with Ctrl+Shift+R. |
| "That email or password isn't right" | Check the user exists in Supabase → Authentication → Users; or use *Forgot password?* |
| "the database tables aren't set up" | Redo Part D step 3 (run `schema.sql`). |
| Page not found (404) | Part C not finished, or files are inside an extra folder (Part B step 6). |
| "Could not load the team's data" | Project may be paused — open Supabase and click Restore. |
| Anything else | Copy the exact message and send it to me. |

Want to change how the program looks or works later? See `CHANGING.md` — or just ask me.
