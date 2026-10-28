-- ClinForms 0189 (Postgres / Supabase): clinic system, diary module - how far the message run has re-checked the
-- diary's appointments against their planned messages (see the SQLite file). One row per clinic, no patient data.
-- Kept in step with db/migrations/sqlite/0189_pms_diary_message_sweeps.sql (db/parity.test.ts). RLS on, no
-- policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_diary_message_sweeps (
  tenant_id text not null primary key,
  synced_to timestamptz not null,
  updated_at timestamptz not null
);

alter table public.pms_diary_message_sweeps enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_diary_message_sweeps from %I', r);
    end if;
  end loop;
end;
$$;
