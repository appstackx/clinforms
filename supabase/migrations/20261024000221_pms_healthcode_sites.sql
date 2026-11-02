-- ClinForms 0221 (Postgres / Supabase): clinic system, billing - Healthcode e-billing groundwork (HC07): the
-- clinic's Healthcode Site ID and payee provider number, and a site's own where it is registered separately.
-- New tables only (additive). Kept in step with db/migrations/sqlite/0221_pms_healthcode_sites.sql (db/parity.test.ts).
-- RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_healthcode_settings (
  tenant_id text not null primary key,
  rev integer not null check (rev > 0),
  site_code text,
  payee_provider_number text,
  updated_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  foreign key (tenant_id) references public.pms_billing_settings (tenant_id) on delete cascade
);

create table if not exists public.pms_site_healthcode (
  tenant_id text not null,
  site_id text not null,
  rev integer not null check (rev > 0),
  site_code text,
  payee_provider_number text,
  updated_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, site_id),
  foreign key (tenant_id, site_id) references public.pms_sites (tenant_id, id) on delete cascade
);

alter table public.pms_healthcode_settings enable row level security;
alter table public.pms_site_healthcode enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_healthcode_settings from %I', r);
      execute format('revoke all on table public.pms_site_healthcode from %I', r);
    end if;
  end loop;
end;
$$;
