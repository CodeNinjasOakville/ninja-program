-- Run this ONCE in Supabase: SQL Editor -> New query -> paste -> Run.
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

create table if not exists public.settings (
  key text primary key, value text not null,
  updated_at timestamptz not null default now()
);

create index if not exists leads_updated on public.leads (updated_at);
create index if not exists belt_entries_updated on public.belt_entries (updated_at);
create index if not exists receipts_updated on public.receipts (updated_at);
create index if not exists active_ninjas_updated on public.active_ninjas (updated_at);
create index if not exists settings_updated on public.settings (updated_at);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['leads','belt_entries','receipts','active_ninjas','settings'] loop
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
