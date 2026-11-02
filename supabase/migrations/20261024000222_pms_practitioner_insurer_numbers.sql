-- ClinForms 0222 (Postgres / Supabase): clinic system, billing - Healthcode e-billing groundwork (HC08): a
-- practitioner's own provider number with each insurer. New table only (additive).
-- Kept in step with db/migrations/sqlite/0222_pms_practitioner_insurer_numbers.sql (db/parity.test.ts).
-- RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_practitioner_insurer_numbers (
  tenant_id text not null,
  practitioner_id text not null,
  referrer_id text not null,
  rev integer not null check (rev > 0),
  provider_number text not null,
  updated_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, practitioner_id, referrer_id),
  foreign key (tenant_id, practitioner_id) references public.pms_practitioners (tenant_id, id) on delete cascade,
  foreign key (tenant_id, referrer_id) references public.pms_referrers (tenant_id, id) on delete cascade
);

create index if not exists pms_practitioner_insurer_numbers_referrer on public.pms_practitioner_insurer_numbers (tenant_id, referrer_id);

alter table public.pms_practitioner_insurer_numbers enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_practitioner_insurer_numbers from %I', r);
    end if;
  end loop;
end;
$$;
