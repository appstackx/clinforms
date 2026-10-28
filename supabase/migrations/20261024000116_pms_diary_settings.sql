-- ClinForms 0116 (Postgres / Supabase): clinic system, diary module - the diary's own settings, one row per clinic
-- (no row = every default). show_dob_on_day_sheet: print dates of birth on the paper day sheet (default off).
-- Kept in step with db/migrations/sqlite/0116_pms_diary_settings.sql (db/parity.test.ts). RLS on, no policies, Data
-- API roles revoked. Idempotent.

create table if not exists public.pms_diary_settings (
  tenant_id text not null primary key,
  rev integer not null default 1 check (rev > 0),
  show_dob_on_day_sheet integer not null default 0 check (show_dob_on_day_sheet in (0, 1)),
  updated_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

alter table public.pms_diary_settings enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_diary_settings from %I', r);
    end if;
  end loop;
end;
$$;
