-- Nexa Hybrid: koppeling met Strava (fase 4).
-- NOG NIET TOEGEPAST. Toepassen in Supabase (SQL editor of supabase db push)
-- vóór de Strava-functies worden ingeschakeld.

-- 1. Koppelingen: tokens staan alleen hier en zijn alleen voor de server
--    (service role). De app krijgt ze nooit te zien.
create table public.hybrid_integrations (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('strava')),
  athlete_id bigint not null,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scope text,
  athlete_name text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider),
  unique (provider, athlete_id)
);
alter table public.hybrid_integrations enable row level security;
revoke all on public.hybrid_integrations from anon, authenticated;
comment on table public.hybrid_integrations is
  'Nexa Hybrid: koppelingen met Strava. Alleen de server (service role) leest en schrijft; tokens komen nooit in de app.';

-- 2. Postvak: nieuwe of gewijzigde activiteiten die de app bij openen
--    ophaalt en daarna verwijdert. Alleen samenvattingen (afstand, tijd,
--    hartslag, hartslagverdeling), geen GPS-route: locatie blijft buiten de
--    server (AVG, zie docs/hybrid/00-PLAN.md §9).
create table public.hybrid_inbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('strava')),
  external_id text not null,
  deleted boolean not null default false,
  activity jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, provider, external_id),
  constraint hybrid_inbox_grootte check (activity is null or pg_column_size(activity) < 16384)
);
create index hybrid_inbox_user on public.hybrid_inbox (user_id, created_at);
alter table public.hybrid_inbox enable row level security;
revoke all on public.hybrid_inbox from anon;
revoke insert, update, truncate, references, trigger on public.hybrid_inbox from authenticated;
grant select, delete on public.hybrid_inbox to authenticated;

create policy "eigen postvak lezen"
  on public.hybrid_inbox for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "eigen postvak legen"
  on public.hybrid_inbox for delete
  to authenticated
  using ((select auth.uid()) = user_id);

comment on table public.hybrid_inbox is
  'Nexa Hybrid: activiteiten uit Strava die nog naar de app moeten. De server schrijft, de gebruiker leest en verwijdert alleen de eigen rijen.';

-- 3. Postvak niet laten vollopen: rijen ouder dan 60 dagen weg.
create or replace function public.hybrid_inbox_opruimen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  delete from public.hybrid_inbox where user_id = new.user_id and created_at < now() - interval '60 days';
  return new;
end;
$$;

create trigger hybrid_inbox_opruimen
  after insert on public.hybrid_inbox
  for each row execute function public.hybrid_inbox_opruimen();
