-- ClinForms 0100 (Postgres / Supabase): clinic-system foundation, part 1 - packages per clinic (entitlements),
-- monthly usage counters and the clinic-system settings. Kept in step with
-- db/migrations/sqlite/0100_clinic_entitlements.sql (db/parity.test.ts).
-- A clinic WITHOUT a row keeps the default - reports ON, clinic OFF. The backfill writes the explicit
-- "reports = active" row for every existing clinic. RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.clinic_entitlements (
  tenant_id text not null,
  package text not null check (package in ('reports', 'clinic')),
  status text not null check (status in ('active', 'trial', 'paused', 'cancelled')),
  plan_code text check (plan_code is null or length(plan_code) <= 40),
  price_source text check (price_source is null or price_source in ('list', 'founding', 'design_partner')),
  limits_json text,
  starts_at timestamptz,
  ends_at timestamptz,
  note text check (note is null or length(note) <= 500),
  updated_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, package)
);

create table if not exists public.clinic_usage_counters (
  tenant_id text not null,
  period text not null check (length(period) = 7),
  metric text not null,
  count integer not null default 0 check (count >= 0),
  updated_at timestamptz not null,
  primary key (tenant_id, period, metric)
);

create table if not exists public.pms_settings (
  tenant_id text not null primary key,
  retention_adult_years integer not null default 8 check (retention_adult_years between 8 and 100),
  retention_child_until_age integer not null default 25 check (retention_child_until_age between 25 and 40),
  is_demo integer not null default 0 check (is_demo in (0, 1)),
  updated_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

insert into public.clinic_entitlements (tenant_id, package, status, plan_code, price_source, limits_json, starts_at, ends_at, note, updated_by, created_at, updated_at)
select tenant_id, 'reports', 'active', null, null, null, created_at, null, 'Existing clinic (migration 0100)', null, now(), now()
from public.clinic_profile
on conflict (tenant_id, package) do nothing;

alter table public.clinic_entitlements enable row level security;
alter table public.clinic_usage_counters enable row level security;
alter table public.pms_settings enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.clinic_entitlements, public.clinic_usage_counters, public.pms_settings from %I', r);
    end if;
  end loop;
end;
$$;
