-- ClinForms 0223 (Postgres / Supabase): clinic system, billing - Healthcode e-billing groundwork (HC09): a
-- service's CCSD code and each insurer's own treatment code (ISC) for it. New tables only (additive).
-- Kept in step with db/migrations/sqlite/0223_pms_service_codes.sql (db/parity.test.ts).
-- RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_service_codes (
  tenant_id text not null,
  service_id text not null,
  rev integer not null check (rev > 0),
  ccsd_code text,
  updated_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, service_id),
  foreign key (tenant_id, service_id) references public.pms_services (tenant_id, id)
);

create table if not exists public.pms_service_insurer_codes (
  tenant_id text not null,
  service_id text not null,
  referrer_id text not null,
  rev integer not null check (rev > 0),
  isc_code text not null,
  updated_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, service_id, referrer_id),
  foreign key (tenant_id, service_id) references public.pms_services (tenant_id, id),
  foreign key (tenant_id, referrer_id) references public.pms_referrers (tenant_id, id)
);

create index if not exists pms_service_insurer_codes_referrer on public.pms_service_insurer_codes (tenant_id, referrer_id);

alter table public.pms_service_codes enable row level security;
alter table public.pms_service_insurer_codes enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_service_codes from %I', r);
      execute format('revoke all on table public.pms_service_insurer_codes from %I', r);
    end if;
  end loop;
end;
$$;
