-- ClinForms 0127 (Postgres / Supabase): clinic system, records module - home exercise programmes, part 2 (ex03/ex04):
-- pms_exercise_programmes (draft / shared / ended; title, note and exercises encrypted; hangs off pms_patients by
-- cascade). Behind CLINFORMS_EXERCISE=on. See the SQLite twin for the full notes.
-- Kept in step with db/migrations/sqlite/0127_pms_exercise_programmes.sql. Idempotent.

create table if not exists public.pms_exercise_programmes (
  tenant_id text not null,
  id text not null,
  rev integer not null check (rev > 0),
  patient_id text not null,
  case_id text,
  replaces_id text,
  status text not null default 'draft' check (status in ('draft', 'shared', 'ended')),
  title_enc text,
  notes_enc text,
  items_enc text,
  item_count integer not null default 0 check (item_count between 0 and 30),
  shared_at timestamptz,
  shared_by text,
  shared_by_name text check (shared_by_name is null or length(shared_by_name) <= 200),
  ended_at timestamptz,
  ended_by text,
  patient_viewed_at timestamptz,
  created_by text,
  anonymised_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  check (status <> 'shared' or shared_at is not null),
  check (status <> 'ended' or ended_at is not null),
  primary key (tenant_id, id),
  unique (tenant_id, id, patient_id),
  foreign key (tenant_id, patient_id) references public.pms_patients (tenant_id, id) on delete cascade
);
create index if not exists pms_exercise_programmes_patient on public.pms_exercise_programmes (tenant_id, patient_id, status);

alter table public.pms_exercise_programmes enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_exercise_programmes from %I', r);
    end if;
  end loop;
end;
$$;
