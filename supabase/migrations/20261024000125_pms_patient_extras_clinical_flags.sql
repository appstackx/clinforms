-- ClinForms 0125 (Postgres / Supabase): clinic system, records module - pronouns (pms_patient_extras, one row per
-- patient, id = the patient's id) and clinical flags (pms_clinical_flags, K2-PAT-014: words encrypted in flag_enc,
-- clinicians, owners and administrators only, ended - never deleted). See the SQLite twin for the full notes.
-- Kept in step with db/migrations/sqlite/0125_pms_patient_extras_clinical_flags.sql. Idempotent.

create table if not exists public.pms_patient_extras (
  tenant_id text not null,
  id text not null,
  rev integer not null check (rev > 0),
  pronouns text check (pronouns is null or length(pronouns) between 1 and 40),
  updated_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, id) references public.pms_patients (tenant_id, id)
);

create table if not exists public.pms_clinical_flags (
  tenant_id text not null,
  id text not null,
  rev integer not null check (rev > 0),
  patient_id text not null,
  flag_enc text,
  status text not null default 'active' check (status in ('active', 'ended')),
  created_by text,
  ended_at timestamptz,
  ended_by text,
  anonymised_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  check (status <> 'ended' or ended_at is not null),
  primary key (tenant_id, id),
  foreign key (tenant_id, patient_id) references public.pms_patients (tenant_id, id)
);
create index if not exists pms_clinical_flags_patient on public.pms_clinical_flags (tenant_id, patient_id, status);

alter table public.pms_patient_extras enable row level security;
alter table public.pms_clinical_flags enable row level security;

do $$
declare
  r text;
  t text;
begin
  foreach t in array array['pms_patient_extras', 'pms_clinical_flags'] loop
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on table public.%I from %I', t, r);
      end if;
    end loop;
  end loop;
end;
$$;
