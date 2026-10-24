-- ClinForms 0006 (Postgres / Supabase): clinic_plan - a clinic's trial and its own drafting limits, set by
-- ClinForms staff only (the platform page /app/platform or npm run admin:set-trial / admin:set-limits). One row
-- per clinic, keyed by the clinic id (tenant_id = organization slug), like clinic_profile. No row = a clinic
-- without a trial on the default limits (every clinic made before this migration).
-- Columns: see db/migrations/sqlite/0006_clinic_plan.sql (kept in step with it). Idempotent.
-- Row level security on and no policies for anon/authenticated, like every other table.

create table if not exists public.clinic_plan (
  tenant_id text not null primary key,
  status text not null check (status in ('standard', 'trial', 'paid')),
  trial_days integer check (trial_days is null or (trial_days > 0 and trial_days <= 366)),
  start_on_first_sign_in integer not null default 0 check (start_on_first_sign_in in (0, 1)),
  trial_starts_at timestamptz,
  trial_ends_at timestamptz,
  owner_first_sign_in_at timestamptz,
  ended_at timestamptz,
  live_calls_per_minute integer check (live_calls_per_minute is null or live_calls_per_minute > 0),
  live_calls_per_day integer check (live_calls_per_day is null or live_calls_per_day > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

alter table public.clinic_plan enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.clinic_plan from %I', r);
    end if;
  end loop;
end;
$$;
