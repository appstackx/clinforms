-- ClinForms 0128 (Postgres / Supabase): clinic system, records module - home exercise programmes, part 3 (ex05):
-- pms_exercise_checkins (one per programme per UK day; done, pain 0-10, comment encrypted; hangs off the programme
-- by cascade). Behind CLINFORMS_EXERCISE=on. See the SQLite twin for the full notes.
-- Kept in step with db/migrations/sqlite/0128_pms_exercise_checkins.sql. Idempotent.

create table if not exists public.pms_exercise_checkins (
  tenant_id text not null,
  id text not null,
  rev integer not null check (rev > 0),
  programme_id text not null,
  patient_id text not null,
  done_on text not null check (done_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  completed integer not null check (completed in (0, 1)),
  pain_score integer check (pain_score is null or pain_score between 0 and 10),
  comment_enc text,
  anonymised_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  unique (tenant_id, programme_id, done_on),
  foreign key (tenant_id, programme_id, patient_id) references public.pms_exercise_programmes (tenant_id, id, patient_id) on delete cascade
);
create index if not exists pms_exercise_checkins_patient on public.pms_exercise_checkins (tenant_id, patient_id, done_on);

alter table public.pms_exercise_checkins enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_exercise_checkins from %I', r);
    end if;
  end loop;
end;
$$;
