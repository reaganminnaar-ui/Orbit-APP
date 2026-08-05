create table if not exists public.orbit_state (
  id text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.orbit_state enable row level security;

revoke all on table public.orbit_state from anon, authenticated;
