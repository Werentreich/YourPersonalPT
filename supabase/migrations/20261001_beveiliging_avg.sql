-- Beveiliging en AVG (security-audit 1 oktober 2026)

-- 1. Rechten die de app nooit nodig heeft. TRUNCATE valt buiten row level
--    security; via de API is het niet bereikbaar, maar het hoort er niet.
revoke truncate, references, trigger on public.nexa_data from anon, authenticated;
revoke all on public.nexa_data from anon;
revoke all on public.nexa_subscriptions from anon;
revoke truncate, references, trigger on public.nexa_subscriptions from authenticated;

-- 2. Opslag begrenzen: alleen app-sleutels, hoogstens 20 per gebruiker.
alter table public.nexa_data
  add constraint nexa_data_key_vorm check (key ~ '^macroverdeling:[a-z0-9:_-]{1,60}$');

create or replace function public.nexa_data_max_rijen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.nexa_data where user_id = new.user_id) >= 20 then
    raise exception 'te veel sleutels voor deze gebruiker' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger nexa_data_max_rijen
  before insert on public.nexa_data
  for each row execute function public.nexa_data_max_rijen();

-- 3. Dagquotum voor de etiketscanner. Alleen via label_quota(); de
--    gebruiker kan zijn eigen teller niet lezen, wijzigen of wissen.
create table public.nexa_label_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);
create index nexa_label_usage_user_at on public.nexa_label_usage (user_id, at);
alter table public.nexa_label_usage enable row level security;
revoke all on public.nexa_label_usage from anon, authenticated;
comment on table public.nexa_label_usage is
  'Nexa: tijdstip van elke etiketanalyse per gebruiker (quotum). Wordt na een dag opgeschoond.';

create or replace function public.label_quota()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  lim constant integer := 30;
  uid uuid := auth.uid();
  used integer;
begin
  if uid is null then
    raise exception 'niet ingelogd' using errcode = '28000';
  end if;
  delete from public.nexa_label_usage where user_id = uid and at < now() - interval '1 day';
  select count(*) into used from public.nexa_label_usage where user_id = uid;
  if used >= lim then
    return -1;
  end if;
  insert into public.nexa_label_usage (user_id) values (uid);
  return lim - used - 1;
end;
$$;
revoke all on function public.label_quota() from public, anon;
grant execute on function public.label_quota() to authenticated;

-- 4. Recht op vergetelheid (AVG art. 17): de gebruiker verwijdert zijn eigen
--    account. Alle rijen in nexa_data, nexa_subscriptions en
--    nexa_label_usage gaan mee (on delete cascade). Een lopend Stripe-
--    abonnement zegt de app eerst op via de functie billing.
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'niet ingelogd' using errcode = '28000';
  end if;
  delete from auth.users where id = uid;
end;
$$;
revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;

-- 5. Startdatum van het abonnement, voor de herroepingsknop (14 dagen).
alter table public.nexa_subscriptions add column if not exists started_at timestamptz;
