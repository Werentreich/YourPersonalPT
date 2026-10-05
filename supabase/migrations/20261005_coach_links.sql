-- Nexa: gezin en coaching (fase 1).
-- Een coach (bijv. partner of personal trainer) koppelt een sporter met
-- een uitnodigingscode. De sporter kiest wat de coach mag (rechten) en kan
-- dat altijd intrekken. Alles loopt via de serverfunctie team.mjs (service
-- role); de app zelf leest of schrijft deze tabellen niet rechtstreeks.

-- 1. Koppelingen
create table public.coach_links (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users (id) on delete cascade,
  client_id uuid references auth.users (id) on delete cascade,
  status text not null default 'uitgenodigd' check (status in ('uitgenodigd', 'actief')),
  code text unique,
  coach_name text not null check (char_length(coach_name) between 1 and 40),
  client_name text check (client_name is null or char_length(client_name) between 1 and 40),
  -- schema: trainingsschema instellen; voeding: voedingsdoel instellen;
  -- voortgang: trainingen, check-ins en gewicht bekijken
  scopes jsonb not null default '{"schema": true, "voeding": true, "voortgang": true}',
  expires_at timestamptz not null default now() + interval '14 days',
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  constraint coach_links_niet_zelf check (client_id is null or client_id <> coach_id),
  constraint coach_links_code_vorm check (code is null or code ~ '^[A-Z2-9]{8}$')
);
create unique index coach_links_paar on public.coach_links (coach_id, client_id) where client_id is not null;
create index coach_links_client on public.coach_links (client_id);
alter table public.coach_links enable row level security;
revoke all on public.coach_links from anon, authenticated;
comment on table public.coach_links is
  'Nexa: koppeling coach - sporter met de rechten die de sporter gaf. Alleen de server (service role) leest en schrijft.';

-- 2. Opdrachten van de coach (schema of voedingsdoel). De app van de
--    sporter past ze toe en meldt dat; de sporter kan het ongedaan maken.
create table public.coach_assignments (
  id bigint generated always as identity primary key,
  link_id uuid not null references public.coach_links (id) on delete cascade,
  client_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('schema', 'voeding')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  constraint coach_assignments_grootte check (pg_column_size(payload) < 8192)
);
create index coach_assignments_client on public.coach_assignments (client_id, applied_at);
alter table public.coach_assignments enable row level security;
revoke all on public.coach_assignments from anon, authenticated;
comment on table public.coach_assignments is
  'Nexa: schema of voedingsdoel dat een coach voor een gekoppelde sporter instelde. Alleen de server leest en schrijft.';
