-- ClinForms 0233 (Postgres / Supabase): clinic system, billing - courses (PK02): a visit used from a patient's course
-- (one per appointment while not reversed). New table only (additive).
-- Kept in step with db/migrations/sqlite/0233_pms_course_uses.sql (db/parity.test.ts).
-- RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_course_uses (
  tenant_id text not null,
  id text not null,
  patient_course_id text not null,
  appointment_id text not null,
  used_on text not null check (used_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  reversed_at timestamptz,
  reversed_by text,
  created_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, patient_course_id) references public.pms_patient_courses (tenant_id, id) on delete cascade
);

create unique index if not exists pms_course_uses_appointment on public.pms_course_uses (tenant_id, appointment_id) where reversed_at is null;
create index if not exists pms_course_uses_course on public.pms_course_uses (tenant_id, patient_course_id, used_on);

alter table public.pms_course_uses enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_course_uses from %I', r);
    end if;
  end loop;
end;
$$;
