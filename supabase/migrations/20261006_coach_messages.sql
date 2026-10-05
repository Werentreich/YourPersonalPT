-- Nexa: gezin en coaching (fase 2): berichten tussen coach en sporter.
-- Alleen via de Edge Function team (service role); dicht voor de app.
create table public.coach_messages (
  id bigint generated always as identity primary key,
  link_id uuid not null references public.coach_links (id) on delete cascade,
  author text not null check (author in ('coach', 'sporter')),
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index coach_messages_link on public.coach_messages (link_id, created_at);
alter table public.coach_messages enable row level security;
revoke all on public.coach_messages from anon, authenticated;
comment on table public.coach_messages is
  'Nexa: berichten tussen coach en sporter binnen een koppeling. Verdwijnen bij ontkoppelen. Alleen de server leest en schrijft.';
