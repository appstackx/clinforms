-- ClinForms 0160 (Postgres / Supabase): clinic system, reporting and set-up module - opening hours and closures
-- of the sites and staff site access. Kept in step with db/migrations/sqlite/0160_pms_reporting_setup.sql
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

create table if not exists public.pms_staff_access (
  tenant_id text not null,
  user_id text not null,
  all_sites integer not null default 1 check (all_sites in (0, 1)),
  rev integer not null default 0 check (rev >= 0),
  write_token text,
  updated_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, user_id)
);

create table if not exists public.pms_staff_sites (
  tenant_id text not null,
  user_id text not null,
  site_id text not null,
  primary key (tenant_id, user_id, site_id),
  foreign key (tenant_id, user_id) references public.pms_staff_access (tenant_id, user_id) on delete cascade,
  foreign key (tenant_id, site_id) references public.pms_sites (tenant_id, id)
);
create index if not exists pms_staff_sites_site on public.pms_staff_sites (tenant_id, site_id);

alter table public.pms_site_hours enable row level security;
alter table public.pms_site_closures enable row level security;
alter table public.pms_staff_access enable row level security;
alter table public.pms_staff_sites enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_site_hours, public.pms_site_closures, public.pms_staff_access, public.pms_staff_sites from %I', r);
    end if;
  end loop;
end;
$$;
