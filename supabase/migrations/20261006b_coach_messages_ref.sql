-- Nexa: gezin en coaching (fase 3): een bericht kan bij een training horen.
alter table public.coach_messages add column ref jsonb;
alter table public.coach_messages add constraint coach_messages_ref_grootte check (ref is null or pg_column_size(ref) < 512);
comment on column public.coach_messages.ref is 'Optioneel: de training waar het bericht bij hoort { sessionId, title, date }.';
