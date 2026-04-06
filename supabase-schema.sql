create extension if not exists pgcrypto;

create table if not exists public.workshops (
  id uuid primary key default gen_random_uuid(),
  session_name text not null default 'Okestro Workshop',
  team_count integer not null default 0,
  status text not null default 'draft',
  final_rankings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.workshop_teams (
  id bigint generated always as identity primary key,
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  team_order integer not null,
  name text not null,
  motto text not null default '',
  scores jsonb not null default '[0,0,0,0]'::jsonb,
  total_score integer not null default 0,
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workshop_id, team_order)
);

alter table public.workshops enable row level security;
alter table public.workshop_teams enable row level security;

drop policy if exists "anon can read workshops" on public.workshops;
create policy "anon can read workshops"
on public.workshops
for select
to anon
using (true);

drop policy if exists "anon can insert workshops" on public.workshops;
create policy "anon can insert workshops"
on public.workshops
for insert
to anon
with check (true);

drop policy if exists "anon can update workshops" on public.workshops;
create policy "anon can update workshops"
on public.workshops
for update
to anon
using (true)
with check (true);

drop policy if exists "anon can read workshop teams" on public.workshop_teams;
create policy "anon can read workshop teams"
on public.workshop_teams
for select
to anon
using (true);

drop policy if exists "anon can insert workshop teams" on public.workshop_teams;
create policy "anon can insert workshop teams"
on public.workshop_teams
for insert
to anon
with check (true);

drop policy if exists "anon can update workshop teams" on public.workshop_teams;
create policy "anon can update workshop teams"
on public.workshop_teams
for update
to anon
using (true)
with check (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'workshops'
  ) then
    alter publication supabase_realtime add table public.workshops;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'workshop_teams'
  ) then
    alter publication supabase_realtime add table public.workshop_teams;
  end if;
end
$$;
