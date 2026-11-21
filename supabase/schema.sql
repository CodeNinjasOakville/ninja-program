-- Run this in Supabase: SQL Editor -> New query -> paste ALL of it -> Run.
-- It is safe to run again: it only adds what is missing. Run it again whenever the app is updated
-- with new tables/columns (e.g. the Ninja + family records added in November 2026), BEFORE
-- publishing the new website files.
-- Same tables as the original app. Every row also has updated_at (set automatically) so each browser
-- can ask "what changed since I last looked?". Deleted rows are only marked deleted so that other
-- browsers find out about the deletion.
--
-- Changing the app later? If you add a column in js/core/db.js (SCHEMA + MIGRATIONS), add the same
-- column here with ALTER TABLE ... ADD COLUMN (see CHANGING.md).

create table if not exists public.leads (
  id bigint generated always as identity primary key,
  entry_number integer, ninja_name text not null, parent_name text, phone_number text, email text,
  age text, gbs_type text, staff_name text, coding_experience text, comments text, gbs_date text,
  gbs_time text, post_gbs_follow_up text, gbs_completed text, lead_date text,
  created_at text default to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at timestamptz not null default now(), deleted boolean not null default false
);
create table if not exists public.belt_entries (
  id bigint generated always as identity primary key,
  name text not null, old_belt text, new_belt text,
  created_at text default to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at timestamptz not null default now(), deleted boolean not null default false
);
create table if not exists public.receipts (
  id bigint generated always as identity primary key,
  date text not null, name text not null, reward_type text not null, amount integer not null,
  details text, entry_type text,
  created_at text default to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at timestamptz not null default now(), deleted boolean not null default false
);
create table if not exists public.active_ninjas (
  id bigint generated always as identity primary key,
  name text not null, day text, time_slot text, is_ai integer not null default 0, notes text,
  belt text default '',
  created_at text default to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at timestamptz not null default now(), deleted boolean not null default false
);
-- Added later (Active Ninjas belt). Safe to run again on an existing database.
alter table public.active_ninjas add column if not exists belt text default '';
-- Added later (JR classes + notes on what each JR Ninja is working on). Safe to run again.
alter table public.active_ninjas add column if not exists is_jr integer not null default 0;
create table if not exists public.jr_notes (
  id bigint generated always as identity primary key,
  name text not null, note text not null, author text,
  created_at text default to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at timestamptz not null default now(), deleted boolean not null default false
);

-- Added later (Ninja + family records). One row per child and one per paying customer (parent),
-- keyed by a uid the browser makes; every other table points at its child through ninja_uid.
create table if not exists public.families (
  uid text primary key, name text, email text, phone text,
  created_at text default to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at timestamptz not null default now(), deleted boolean not null default false
);
create table if not exists public.ninjas (
  uid text primary key, name text not null, belt text default '', family_uid text, notes text,
  created_at text default to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at timestamptz not null default now(), deleted boolean not null default false
);
alter table public.leads add column if not exists ninja_uid text;
alter table public.belt_entries add column if not exists ninja_uid text;
alter table public.receipts add column if not exists ninja_uid text;
alter table public.active_ninjas add column if not exists ninja_uid text;
alter table public.jr_notes add column if not exists ninja_uid text;

-- Added later (JR skills checklist). Only statuses a sensei set by hand; the rest come from the notes.
create table if not exists public.jr_skills (
  id bigint generated always as identity primary key,
  name text not null, ninja_uid text, skill text not null, status text not null, author text,
  created_at text default to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at timestamptz not null default now(), deleted boolean not null default false
);

-- Added later (3D print queue). The model file, when there is one, is kept in file_data (base64).
create table if not exists public.print_queue (
  id bigint generated always as identity primary key,
  name text not null, ninja_uid text, description text, model_link text,
  file_name text, file_type text, file_size integer, file_data text,
  promised_date text not null, printed_date text,
  created_at text default to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at timestamptz not null default now(), deleted boolean not null default false
);

-- Added later: text messages from families, from the CRM's "new inbound text" emails
-- (supabase/functions/lead-inquiry). status is 'new' until someone presses Done ('' after that).
create table if not exists public.lead_messages (
  id bigint generated always as identity primary key,
  from_name text not null, received text, body text, reply_link text,
  status text default 'new', original text, email_message_id text,
  created_at text default to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at timestamptz not null default now(), deleted boolean not null default false
);

create table if not exists public.settings (
  key text primary key, value text not null,
  updated_at timestamptz not null default now()
);

create index if not exists leads_updated on public.leads (updated_at);
create index if not exists belt_entries_updated on public.belt_entries (updated_at);
create index if not exists receipts_updated on public.receipts (updated_at);
create index if not exists active_ninjas_updated on public.active_ninjas (updated_at);
create index if not exists jr_notes_updated on public.jr_notes (updated_at);
create index if not exists jr_skills_updated on public.jr_skills (updated_at);
create index if not exists print_queue_updated on public.print_queue (updated_at);
create index if not exists lead_messages_updated on public.lead_messages (updated_at);
create index if not exists settings_updated on public.settings (updated_at);
create index if not exists families_updated on public.families (updated_at);
create index if not exists ninjas_updated on public.ninjas (updated_at);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['leads','belt_entries','receipts','active_ninjas','jr_notes','jr_skills','print_queue','lead_messages','settings','families','ninjas'] loop
    execute format('drop trigger if exists touch on public.%I', t);
    execute format('create trigger touch before insert or update on public.%I for each row execute function public.touch_updated_at()', t);
    -- Only signed-in team members can read or change anything. Visitors who are not signed in get nothing.
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists team_all on public.%I', t);
    execute format('create policy team_all on public.%I for all to authenticated using (true) with check (true)', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end $$;
grant usage, select on all sequences in schema public to authenticated;

-- Added later (leads from CRM inquiry emails, see supabase/functions/lead-inquiry and INQUIRY_EMAILS.md).
-- inquiry_status is 'new' until someone checks the lead and marks it complete ('' after that).
alter table public.leads add column if not exists inquiry_status text default '';
alter table public.leads add column if not exists inquiry_email text;
alter table public.leads add column if not exists inquiry_message_id text;

-- Adds one lead from an inquiry email and returns its entry number. Only the email function
-- (which runs on Supabase with the service_role key) may call it; signed-in members and visitors cannot.
-- The same email delivered twice (same message id) is only added once.
create or replace function public.add_lead_inquiry(p jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if coalesce(p->>'inquiry_message_id', '') <> '' then
    select entry_number into n from public.leads
      where inquiry_message_id = p->>'inquiry_message_id' and not deleted limit 1;
    if found then return n; end if;
  end if;
  perform pg_advisory_xact_lock(732001);   -- two emails at once still get different entry numbers
  select coalesce(max(entry_number), 0) + 1 into n from public.leads;
  insert into public.leads (entry_number, ninja_name, parent_name, phone_number, email, age, gbs_type,
      coding_experience, comments, gbs_date, gbs_time, lead_date,
      inquiry_status, inquiry_email, inquiry_message_id)
    values (n, coalesce(nullif(trim(p->>'ninja_name'), ''), '(child''s name not found)'),
      p->>'parent_name', p->>'phone_number', p->>'email', p->>'age', p->>'gbs_type',
      p->>'coding_experience', p->>'comments', p->>'gbs_date', p->>'gbs_time',
      to_char(now() at time zone 'America/Toronto', 'YYYY-MM-DD'),
      'new', p->>'inquiry_email', nullif(p->>'inquiry_message_id', ''));
  return n;
end $$;
revoke all on function public.add_lead_inquiry(jsonb) from public, anon, authenticated;
grant execute on function public.add_lead_inquiry(jsonb) to service_role;

-- Added later: LineLeader's "Daily Tour Email" (the morning of the GBS, every tour that day).
-- One call per child on a tour. The family's existing lead is found (same email, phone or parent
-- name, and the same child, or the inquiry lead still waiting for a child's name) and given the
-- GBS date, time, staff member and any details it was missing. With no such lead, a new one is added.
-- Tours are never inquiries: these families already have a GBS booked, so a new lead is a normal one
-- (it shows in Upcoming GBS), and an inquiry lead it fills in leaves "New inquiries to follow up".
-- The same email delivered twice changes nothing.
create or replace function public.add_tour_lead(p jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer; lead_id bigint;
  no_name constant text := '(child''s name not found)';
  kid text := lower(trim(coalesce(p->>'ninja_name', '')));
  em text := lower(trim(coalesce(p->>'email', '')));
  ph text := right(regexp_replace(coalesce(p->>'phone_number', ''), '\D', '', 'g'), 10);
  par text := lower(trim(coalesce(p->>'parent_name', '')));
  tour text := coalesce(p->>'inquiry_email', '');
begin
  if coalesce(p->>'inquiry_message_id', '') <> '' then
    select entry_number into n from public.leads
      where inquiry_message_id = p->>'inquiry_message_id' and not deleted limit 1;
    if found then return n; end if;
  end if;
  perform pg_advisory_xact_lock(732001);

  select l.id, l.entry_number into lead_id, n from public.leads l
    where not l.deleted
      and ((em <> '' and lower(trim(coalesce(l.email, ''))) = em)
        or (length(ph) = 10 and right(regexp_replace(coalesce(l.phone_number, ''), '\D', '', 'g'), 10) = ph)
        or (par <> '' and lower(trim(coalesce(l.parent_name, ''))) = par))
      and (kid = '' or l.ninja_name = no_name
        or lower(trim(l.ninja_name)) = kid
        or split_part(lower(trim(l.ninja_name)), ' ', 1) = split_part(kid, ' ', 1))
    order by case when kid <> '' and lower(trim(l.ninja_name)) = kid then 0
                  when kid <> '' and split_part(lower(trim(l.ninja_name)), ' ', 1) = split_part(kid, ' ', 1) then 1
                  when l.ninja_name = no_name then 2 else 3 end,
             l.id desc
    limit 1;

  if lead_id is not null then
    update public.leads set
      ninja_name = case when ninja_name = no_name and kid <> '' then trim(p->>'ninja_name') else ninja_name end,
      parent_name = coalesce(nullif(trim(parent_name), ''), p->>'parent_name'),
      phone_number = coalesce(nullif(trim(phone_number), ''), nullif(p->>'phone_number', '')),
      email = coalesce(nullif(trim(email), ''), nullif(p->>'email', '')),
      age = coalesce(nullif(trim(age), ''), nullif(p->>'age', '')),
      gbs_date = coalesce(nullif(p->>'gbs_date', ''), gbs_date),
      gbs_time = coalesce(nullif(p->>'gbs_time', ''), gbs_time),
      staff_name = coalesce(nullif(p->>'staff_name', ''), staff_name),
      inquiry_status = '',
      inquiry_email = case when coalesce(inquiry_email, '') = '' then tour
                           when tour = '' or position(tour in inquiry_email) > 0 then inquiry_email
                           else inquiry_email || E'\n\n---------- Daily tour email ----------\n\n' || tour end
      where id = lead_id;
    return n;
  end if;

  select coalesce(max(entry_number), 0) + 1 into n from public.leads;
  insert into public.leads (entry_number, ninja_name, parent_name, phone_number, email, age, staff_name,
      gbs_date, gbs_time, lead_date, inquiry_status, inquiry_email, inquiry_message_id)
    values (n, coalesce(nullif(trim(p->>'ninja_name'), ''), no_name),
      p->>'parent_name', p->>'phone_number', p->>'email', p->>'age', p->>'staff_name',
      p->>'gbs_date', p->>'gbs_time', to_char(now() at time zone 'America/Toronto', 'YYYY-MM-DD'),
      '', tour, nullif(p->>'inquiry_message_id', ''));
  return n;
end $$;
revoke all on function public.add_tour_lead(jsonb) from public, anon, authenticated;
grant execute on function public.add_tour_lead(jsonb) to service_role;

-- Saves one text message from a CRM "new inbound text" email and returns its id. Only the email
-- function may call it. The same email delivered twice is only saved once.
create or replace function public.add_lead_message(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare n bigint;
begin
  if coalesce(p->>'email_message_id', '') <> '' then
    select id into n from public.lead_messages
      where email_message_id = p->>'email_message_id' and not deleted limit 1;
    if found then return n; end if;
  end if;
  insert into public.lead_messages (from_name, received, body, reply_link, status, original, email_message_id)
    values (coalesce(nullif(trim(p->>'from_name'), ''), '(name not found)'), p->>'received', p->>'body',
      nullif(p->>'reply_link', ''), 'new', p->>'original', nullif(p->>'email_message_id', ''))
    returning id into n;
  return n;
end $$;
revoke all on function public.add_lead_message(jsonb) from public, anon, authenticated;
grant execute on function public.add_lead_message(jsonb) to service_role;
