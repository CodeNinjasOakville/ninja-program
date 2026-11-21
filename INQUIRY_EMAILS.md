# Leads from CRM inquiry emails (automatic)

When the CRM emails you about a new inquiry, a lead appears on the **Leads** tab under
**New inquiries to follow up**, with whatever details the email had. Staff check it against the
original email (kept on the card), fill in what's missing and press **✓ Mark complete**. It then
becomes a normal lead (and shows in Upcoming GBS once it has a GBS date).

**Our CRM is ChildcareCRM.** Its "new family" email ("Congratulations! A new family has submitted
their information for your CORE programs...") only gives **Parent Name, Email and Phone number**,
plus the program (CORE). So every inquiry arrives without the child's name, age or GBS date:
look the family up in ChildcareCRM (or call them) and fill those in before marking it complete.

**The morning of the GBS, LineLeader sends a "Lineleader Daily Tour Email"** listing every tour that
day ("Jamie Fox tour at 12:00pm with Robin", then the parent's phone / email and a Name / Current Age
block per child). The function tells it apart from a new-family email and, for each child on each
tour, finds the family's existing lead (same email, phone or parent name) and fills in the child's
name and age, the GBS date and time and the staff member. A family with no lead yet gets a new one.
A tour that lists no children (just "Casey Moon tour at 12:00pm with Robin") is matched by the parent's
name. **Tours are never inquiries**: these families already have a GBS booked, so their leads go
straight to Upcoming GBS, and an inquiry the tour fills in leaves **New inquiries to follow up**.
That tour's part of the email is added to the lead's original-email box.

**When a family texts, the CRM sends a "new inbound text in CRM" email** (Text Information / From /
Received / Message Body). That is a message, not an inquiry: it goes to the `lead_messages` table and
shows at the top of the Leads tab under **New messages**, with the text, who sent it, the lead(s)
with that parent's name (tap one to open it), **Reply in CRM** (the email's own reply link) and
**✓ Done**, which takes it off the list.

The function decides which kind each email is, in this order: daily tour email, text message, and
anything else is read as a new-family inquiry.

```
CRM ──email──> Outlook ──rule: redirect──> Postmark (inbound address)
                                              │  sends the email as JSON
                                              ▼
                       Supabase function "lead-inquiry"  (reads the details)
                                              │
                                              ▼
                              leads table, inquiry_status = 'new'  ──sync──> the app
```

Why the middle step: the app is a website with no server of its own, and Outlook can't post an
email to a web address by itself. Postmark gives you an email address that turns each email it
receives into a web request. Emails pass through Postmark, so they are kept there for a while
(see its retention settings).

Do the steps **in this order**. Allow about 30 minutes.

## 1. Upgrade the shared database (before publishing the new website files)
Supabase → **SQL Editor** → New query → paste **all** of `supabase/schema.sql` → **Run**.
It adds three columns to `leads`, the `lead_messages` table, and the `add_lead_inquiry`, `add_tour_lead`
and `add_lead_message` functions (only the email function can use them). Safe to run again. If the new
website goes live first, the app asks for this upgrade at sign-in until it is done.

## 2. Make up a secret
Any long random text, e.g. from a password manager (letters and numbers only, 30+ characters).
It goes in the web address Postmark uses, so nobody else can add leads. Keep it private.

## 3. Create the Supabase function
Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**:
1. Name it `lead-inquiry`.
2. Replace the starter code with `supabase/functions/lead-inquiry/index.ts`.
3. Add a second file named `parse.js` with `supabase/functions/lead-inquiry/parse.js`.
4. Deploy. Then in the function's **Details / Settings**, turn **off** "Verify JWT" / "Enforce JWT
   verification" (Postmark can't sign in; the secret protects it instead).

Then Edge Functions → **Secrets** → add `INQUIRY_SECRET` = your secret from step 2.

(With the Supabase CLI instead: `npx supabase functions deploy lead-inquiry --no-verify-jwt` and
`npx supabase secrets set INQUIRY_SECRET=...`.)

The function's address is shown on its page, like
`https://YOUR-PROJECT.supabase.co/functions/v1/lead-inquiry`. Add your secret to the end:
`https://YOUR-PROJECT.supabase.co/functions/v1/lead-inquiry?key=YOUR-SECRET`

## 4. Postmark (receives the forwarded emails)
1. Sign up at postmarkapp.com (check their pricing page; low volumes fit the free/developer tier).
2. Create a **Server** (e.g. "Ninja leads") → open its **Default Inbound Stream** → **Settings**.
3. **Webhook URL**: the address with `?key=...` from step 3. Save.
4. Copy the **inbound email address** shown there (something like `abc123@inbound.postmarkapp.com`).

## 5. Outlook rule (sends the CRM emails to Postmark)
Outlook on the web → **Settings** → **Mail** → **Rules** → **Add new rule**:
- Condition: **Subject or body includes** `A new family has submitted their information`
  (the opening line of ChildcareCRM's new-family email), **or Subject includes** `Daily Tour Email`
  (LineLeader's list of the day's tours). Or **From** = the address those emails come from.
- Action: **Redirect to** = the Postmark inbound address. (Redirect keeps the email exactly as the
  CRM sent it; "Forward to" also works.)
- Keep "Stop processing more rules" off, so the email still lands in your inbox as well.

**Microsoft 365 business accounts block automatic forwarding to outside addresses by default.**
If the rule doesn't fire, your Microsoft 365 admin needs to allow it for this mailbox:
Microsoft Defender portal → Email & collaboration → Policies → Anti-spam → **Outbound policy** →
Automatic forwarding rules → **On** (ideally a policy for just this mailbox).
If that isn't allowed, Power Automate can do the same job: flow "When a new email arrives (V3)"
(From = the CRM) → **HTTP** POST to the step-3 address with body
`{"subject": Subject, "html": Body, "from": From, "message_id": Message Id}` (the HTTP step needs a
Power Automate premium licence).

## 6. Test it
Redirect one real CRM inquiry email to the Postmark address (or wait for the next one). Within a
minute it should be under **New inquiries to follow up** on the Leads tab. Postmark → the server →
**Activity** shows each email and what the function answered; a failure there is retried later by
Postmark, so nothing is lost while something is being fixed. The same email is never added twice.

## When a detail isn't picked up
The function reads "Label: value" lines, tables and labels with the value underneath. Labels are
matched in `FIELD_LABELS` at the top of `supabase/functions/lead-inquiry/parse.js` (e.g. "Child's Name",
"Student name", "Participant" → the Ninja; "Name" alone → the parent). If your CRM uses a different
label, add it there, add an example to `tests/test_inquiry_email.mjs`, run `npm test`, and paste the
new `parse.js` into the function again (step 3) and deploy. Nothing is ever lost: the whole original
email is on the card.
