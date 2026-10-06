-- Nexa: gezin en coaching (fase 4): trainingen verplaatsen en krachtprogramma aanpassen.
alter table public.coach_assignments drop constraint coach_assignments_kind_check;
alter table public.coach_assignments add constraint coach_assignments_kind_check check (kind in ('schema', 'voeding', 'verplaats', 'programma'));
alter table public.coach_assignments drop constraint coach_assignments_grootte;
alter table public.coach_assignments add constraint coach_assignments_grootte check (pg_column_size(payload) < 32768);
