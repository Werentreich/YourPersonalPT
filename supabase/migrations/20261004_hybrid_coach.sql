-- Nexa Hybrid: dagquotum voor de AI-coach (fase 5).
-- NOG NIET TOEGEPAST. Toepassen in Supabase vóór ANTHROPIC_API_KEY de coach
-- aanzet. Zelfde opzet als label_quota (20261001_beveiliging_avg.sql).

create table public.hybrid_coach_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);
create index hybrid_coach_usage_user_at on public.hybrid_coach_usage (user_id, at);
alter table public.hybrid_coach_usage enable row level security;
revoke all on public.hybrid_coach_usage from anon, authenticated;
comment on table public.hybrid_coach_usage is
  'Nexa Hybrid: tijdstip van elke vraag aan de AI-coach per gebruiker (quotum). Wordt na een dag opgeschoond.';

create or replace function public.coach_quota()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  lim constant integer := 20;
  uid uuid := auth.uid();
  used integer;
begin
  if uid is null then
    raise exception 'niet ingelogd' using errcode = '28000';
  end if;
  delete from public.hybrid_coach_usage where user_id = uid and at < now() - interval '1 day';
  select count(*) into used from public.hybrid_coach_usage where user_id = uid;
  if used >= lim then
    return -1;
  end if;
  insert into public.hybrid_coach_usage (user_id) values (uid);
  return lim - used - 1;
end;
$$;
revoke all on function public.coach_quota() from public, anon;
grant execute on function public.coach_quota() to authenticated;
