-- ClinForms 0224 (Postgres / Supabase): clinic system, billing - Healthcode e-billing groundwork (HC10): a case's
-- ICD-10 diagnosis code (encrypted). New table only (additive).
-- Kept in step with db/migrations/sqlite/0224_pms_case_diagnosis.sql (db/parity.test.ts).
-- RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_case_diagnosis (
  tenant_id text not null,
  id text not null,
  rev integer not null check (rev > 0),
  diagnosis_enc text,
  updated_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, id) references public.pms_cases (tenant_id, id) on delete cascade
);

alter table public.pms_case_diagnosis enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_case_diagnosis from %I', r);
    end if;
  end loop;
end;
$$;
