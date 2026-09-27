-- Toegepast op project nexa (lrtkedstyhfnwaxylyue) op 2026-09-27.
create table public.nexa_subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status text not null default 'none',
  plan text,
  trial_end timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  updated_at timestamptz not null default now()
);

comment on table public.nexa_subscriptions is
  'Nexa: abonnementsstatus per gebruiker. Alleen de server (webhook van Stripe, service role) schrijft; de gebruiker leest alleen de eigen rij.';
comment on column public.nexa_subscriptions.status is
  'trialing, active, past_due, canceled, unpaid, incomplete, incomplete_expired, paused of comp (gratis toegang toegekend)';

alter table public.nexa_subscriptions enable row level security;

create policy "eigen abonnement lezen"
  on public.nexa_subscriptions for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke insert, update, delete on public.nexa_subscriptions from anon, authenticated;

-- Gratis toegang geven (bijvoorbeeld aan uzelf of een tester):
-- insert into public.nexa_subscriptions (user_id, status, plan)
-- values ('<user-id uit auth.users>', 'comp', 'comp')
-- on conflict (user_id) do update set status = 'comp', plan = 'comp', updated_at = now();
