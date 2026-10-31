-- ClinForms 0122 (Postgres / Supabase): clinic system, records module - the clinic's record-keeping settings for
-- clinical notes. One row per clinic (id 'records'): after how many days an unsigned note counts as overdue on the
-- unsigned-notes list. No row = the default (3 days). Configuration only - no patient data.
-- Kept in step with db/migrations/sqlite/0122_pms_records_settings.sql. Idempotent.

create table if not exists public.pms_records_settings (
  tenant_id text not null,
  id text not null check (id = 'records'),
  rev integer not null check (rev > 0),
  unsigned_note_days integer not null default 3 check (unsigned_note_days between 1 and 60),
  updated_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id)
);

alter table public.pms_records_settings enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_records_settings from %I', r);
    end if;
  end loop;
end;
$$;
