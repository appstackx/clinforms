-- ClinForms 0160 (Postgres / Supabase): clinic system, reporting and set-up module - opening hours and closures
-- of the sites (the one opening-hours source) and the clinic's report targets (edited in place before first merge:
-- the draft's staff site-access tables were dropped in favour of the access module's). Kept in step with db/migrations/sqlite/0160_pms_reporting_setup.sql
-- (db/parity.test.ts). Composite keys and foreign keys that include tenant_id. Times of day TEXT HH:MM, dates
-- TEXT YYYY-MM-DD (as on D1). RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_site_hours (
  tenant_id text not null,
  id text not null,
  site_id text not null,
  weekday integer not null check (weekday between 1 and 7),
  opens_at text not null check (length(opens_at) = 5),
  closes_at text not null check (length(closes_at) = 5),
  created_by text,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, site_id) references public.pms_sites (tenant_id, id),
  check (opens_at < closes_at)
);
create unique index if not exists pms_site_hours_site_day on public.pms_site_hours (tenant_id, site_id, weekday, opens_at);

create table if not exists public.pms_site_closures (
  tenant_id text not null,
  id text not null,
  site_id text,
  starts_on text not null check (length(starts_on) = 10),
  ends_on text not null check (length(ends_on) = 10),
  reason text check (reason is null or length(reason) <= 120),
  created_by text,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, site_id) references public.pms_sites (tenant_id, id),
  check (starts_on <= ends_on)
);
create index if not exists pms_site_closures_dates on public.pms_site_closures (tenant_id, starts_on);

create table if not exists public.pms_reporting_settings (
  tenant_id text not null,
  rev integer not null default 1 check (rev > 0),
  utilisation_target_percent integer not null default 80 check (utilisation_target_percent between 1 and 100),
  dna_target_tenths integer not null default 40 check (dna_target_tenths between 0 and 500),
  updated_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id)
);

alter table public.pms_site_hours enable row level security;
alter table public.pms_site_closures enable row level security;
alter table public.pms_reporting_settings enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_site_hours, public.pms_site_closures, public.pms_reporting_settings from %I', r);
    end if;
  end loop;
end;
$$;
