-- Travel-ID initial schema (Indonesia + Malaysia, 7 languages)
-- Apply via Supabase SQL Editor or `supabase db push`
-- Idempotent: safe to re-run during development.

-- ─────────────────────────────────────────────────────────
-- Extensions
-- ─────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
-- PostGIS optional; enable for future nearest-spot queries.
-- create extension if not exists postgis;

-- ─────────────────────────────────────────────────────────
-- profiles  (extends auth.users with app-specific fields)
-- ─────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  preferred_lang text check (preferred_lang in ('en','id','ms','ko','zh','ja','ar')),
  signup_source text,                  -- 'web' | 'twa' | 'ios'
  planner_usage jsonb not null default '{}'::jsonb,
                                       -- { "YYYY-MM-DD": <int>, ... } last 7 days
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', new.email),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────
-- spots
-- ─────────────────────────────────────────────────────────
create table if not exists public.spots (
  id uuid primary key default gen_random_uuid(),
  slug text unique,                    -- /spot/{slug} for SEO; nullable until backfilled
  name text not null,                  -- canonical English name
  category text not null check (category in (
    'beach','temple','cultural','volcano','nature','diving',
    'food','cafe','shopping','nightlife',
    'mosque','museum','adventure','wellness'
  )),
  region text,                         -- free text but populated from a known list
  country text not null default 'ID' check (country in ('ID','MY')),
  latitude double precision,
  longitude double precision,
  address text,
  cover_image text,
  photos text[] not null default '{}',
  tags text[] not null default '{}',
  instagram text,
  website text,
  google_map_link text,
  rating numeric(3,2) check (rating is null or (rating >= 0 and rating <= 5)),
  featured boolean not null default false,
  published boolean not null default false,
  -- Indonesia/Malaysia-specific flags
  halal boolean not null default false,
  prayer_room boolean not null default false,
  veg_friendly boolean not null default false,
  -- Pricing in local currency (IDR for ID, MYR for MY)
  entry_fee numeric(12,2),             -- 0 means free; null means unknown
  best_time_to_visit text check (best_time_to_visit is null or best_time_to_visit in (
    'All Year','Dry Season (May-Sep)','Wet Season (Oct-Apr)',
    'Sunrise','Sunset','Early Morning','Evening'
  )),
  local_tips text,
  opening_hours text,
  submitted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Block duplicate spot creation at the DB level (case-insensitive on name)
create unique index if not exists spots_name_lower_uniq
  on public.spots (lower(name));

create index if not exists spots_published_idx
  on public.spots (published) where published = true;
create index if not exists spots_country_idx on public.spots (country);
create index if not exists spots_category_idx on public.spots (category);
create index if not exists spots_region_idx on public.spots (region);
create index if not exists spots_featured_idx on public.spots (featured) where featured = true;
create index if not exists spots_halal_idx on public.spots (halal) where halal = true;
create index if not exists spots_created_idx on public.spots (created_at desc);

-- ─────────────────────────────────────────────────────────
-- spot_translations
-- ─────────────────────────────────────────────────────────
create table if not exists public.spot_translations (
  spot_id uuid not null references public.spots(id) on delete cascade,
  lang text not null check (lang in ('en','id','ms','ko','zh','ja','ar')),
  name text,
  description text,
  primary key (spot_id, lang)
);

create index if not exists spot_translations_lang_idx on public.spot_translations (lang);

-- ─────────────────────────────────────────────────────────
-- bookmarks   (one row per user × spot × type)
-- ─────────────────────────────────────────────────────────
create table if not exists public.bookmarks (
  user_id uuid not null references auth.users(id) on delete cascade,
  spot_id uuid not null references public.spots(id) on delete cascade,
  type text not null check (type in ('want_to_visit','interested')),
  created_at timestamptz not null default now(),
  primary key (user_id, spot_id, type)
);

create index if not exists bookmarks_user_idx on public.bookmarks (user_id, created_at desc);
create index if not exists bookmarks_spot_idx on public.bookmarks (spot_id);

-- ─────────────────────────────────────────────────────────
-- shared_plans   (separated from spots — no length limit)
-- ─────────────────────────────────────────────────────────
create table if not exists public.shared_plans (
  id uuid primary key default gen_random_uuid(),
  share_id text not null unique,          -- 8-hex public-facing
  user_id uuid references auth.users(id) on delete set null,
  title text not null,
  days int,
  budget text,
  style text,
  lang text,
  spot_names text[] not null default '{}',
  plan_html text not null,                -- no truncation
  created_at timestamptz not null default now(),
  expires_at timestamptz                  -- nullable: NULL = never expires
);

create index if not exists shared_plans_user_idx on public.shared_plans (user_id, created_at desc);
create index if not exists shared_plans_created_idx on public.shared_plans (created_at desc);

-- ─────────────────────────────────────────────────────────
-- spot_submissions   (user-submitted candidates pending review)
-- ─────────────────────────────────────────────────────────
create table if not exists public.spot_submissions (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid references auth.users(id) on delete set null,
  submitter_email text,
  payload jsonb not null,                  -- full submission body
  status text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  approved_spot_id uuid references public.spots(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists submissions_status_idx
  on public.spot_submissions (status, created_at desc);

-- ─────────────────────────────────────────────────────────
-- events   (append-only user behavior log)
-- ─────────────────────────────────────────────────────────
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  session_id text,                         -- groups anonymous user activity
  event_type text not null,                -- 'spot_view','search','bookmark_add','plan_create',...
  payload jsonb not null default '{}'::jsonb,
  ip_country text,
  ua_device text,                          -- 'mobile' | 'desktop' | 'twa' | 'ios'
  lang text,
  occurred_at timestamptz not null default now()
);

create index if not exists events_user_idx
  on public.events (user_id, occurred_at desc);
create index if not exists events_type_idx
  on public.events (event_type, occurred_at desc);
create index if not exists events_session_idx
  on public.events (session_id, occurred_at desc) where session_id is not null;

-- Append-only: block UPDATE/DELETE via triggers (service_role bypasses RLS,
-- so triggers are the right enforcement layer here).
create or replace function public.events_no_update_delete()
returns trigger language plpgsql as $$
begin
  raise exception 'events table is append-only';
end;
$$;

drop trigger if exists events_no_update on public.events;
create trigger events_no_update before update on public.events
  for each row execute function public.events_no_update_delete();

drop trigger if exists events_no_delete on public.events;
create trigger events_no_delete before delete on public.events
  for each row execute function public.events_no_update_delete();

-- ─────────────────────────────────────────────────────────
-- updated_at maintenance
-- ─────────────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists spots_touch on public.spots;
create trigger spots_touch before update on public.spots
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────
alter table public.profiles          enable row level security;
alter table public.spots             enable row level security;
alter table public.spot_translations enable row level security;
alter table public.bookmarks         enable row level security;
alter table public.shared_plans      enable row level security;
alter table public.spot_submissions  enable row level security;
alter table public.events            enable row level security;

-- profiles: each user reads/writes their own row; service_role bypasses RLS.
drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update using (auth.uid() = id);

-- spots: anonymous read of published only; writes are service_role only.
drop policy if exists spots_public_read on public.spots;
create policy spots_public_read on public.spots
  for select using (published = true);

-- spot_translations: read freely IF the parent spot is published.
drop policy if exists translations_public_read on public.spot_translations;
create policy translations_public_read on public.spot_translations
  for select using (
    exists (
      select 1 from public.spots s
      where s.id = spot_translations.spot_id and s.published = true
    )
  );

-- bookmarks: each user manages their own rows.
drop policy if exists bookmarks_self_select on public.bookmarks;
create policy bookmarks_self_select on public.bookmarks
  for select using (auth.uid() = user_id);

drop policy if exists bookmarks_self_insert on public.bookmarks;
create policy bookmarks_self_insert on public.bookmarks
  for insert with check (auth.uid() = user_id);

drop policy if exists bookmarks_self_delete on public.bookmarks;
create policy bookmarks_self_delete on public.bookmarks
  for delete using (auth.uid() = user_id);

-- shared_plans: anyone can read by share_id; writes by signed-in users for own
-- user_id, OR anonymous with user_id IS NULL.
drop policy if exists shared_plans_public_read on public.shared_plans;
create policy shared_plans_public_read on public.shared_plans
  for select using (true);

drop policy if exists shared_plans_self_insert on public.shared_plans;
create policy shared_plans_self_insert on public.shared_plans
  for insert with check (
    user_id is null or auth.uid() = user_id
  );

drop policy if exists shared_plans_self_delete on public.shared_plans;
create policy shared_plans_self_delete on public.shared_plans
  for delete using (auth.uid() = user_id);

-- spot_submissions: a user can read & insert their own; reviews via service_role.
drop policy if exists submissions_self_select on public.spot_submissions;
create policy submissions_self_select on public.spot_submissions
  for select using (auth.uid() = submitted_by);

drop policy if exists submissions_self_insert on public.spot_submissions;
create policy submissions_self_insert on public.spot_submissions
  for insert with check (
    submitted_by is null or auth.uid() = submitted_by
  );

-- events: a user can read their own activity log; writes only via service_role.
drop policy if exists events_self_read on public.events;
create policy events_self_read on public.events
  for select using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────
-- Helper: log_event   (called from server with service_role)
-- ─────────────────────────────────────────────────────────
create or replace function public.log_event(
  p_event_type text,
  p_user_id uuid default null,
  p_session_id text default null,
  p_payload jsonb default '{}'::jsonb,
  p_ip_country text default null,
  p_ua_device text default null,
  p_lang text default null
) returns uuid language plpgsql security definer as $$
declare
  v_id uuid;
begin
  insert into public.events (
    user_id, session_id, event_type, payload, ip_country, ua_device, lang
  ) values (
    p_user_id, p_session_id, p_event_type, p_payload, p_ip_country, p_ua_device, p_lang
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.log_event(text,uuid,text,jsonb,text,text,text) from public;
grant execute on function public.log_event(text,uuid,text,jsonb,text,text,text) to service_role;
