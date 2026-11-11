-- ClinForms 0231 (Postgres / Supabase): clinic system, billing - courses (PK02): the course types a clinic sells
-- (sessions, services covered, price, VAT code, days valid), hanging off the clinic's billing settings row (on delete
-- cascade, offboarding only). New table only (additive).
-- Kept in step with db/migrations/sqlite/0231_pms_course_types.sql (db/parity.test.ts).
-- RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_course_types (
  tenant_id text not null,
  id text not null,
  rev integer not null check (rev > 0),
  name text not null check (length(name) between 1 and 120),
  service_ids_json text not null,
  sessions integer not null check (sessions between 1 and 100),
  price_pence integer not null check (price_pence between 0 and 100000000),
  vat_code text not null check (vat_code in ('exempt', 'standard', 'reduced', 'zero')),
  valid_days integer check (valid_days is null or valid_days between 1 and 3650),
  active integer not null default 1 check (active in (0, 1)),
  updated_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id) references public.pms_billing_settings (tenant_id) on delete cascade
);

create index if not exists pms_course_types_name on public.pms_course_types (tenant_id, active, name);

alter table public.pms_course_types enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_course_types from %I', r);
    end if;
  end loop;
end;
$$;
