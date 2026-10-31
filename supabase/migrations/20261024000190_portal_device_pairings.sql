-- ClinForms 0190 (Postgres / Supabase): clinic system, portal module, M10 security review (H3) -
-- pms_intake_device_pairings (a clinic device is paired with a hand-off by a short code the member of staff gets on
-- their own screen - only the SHA-256 of the code is stored, valid 10 minutes, used once). Kept in step with
-- db/migrations/sqlite/0190_portal_device_pairings.sql (db/parity.test.ts). RLS on, no policies, Data API roles
-- revoked. Idempotent.

create table if not exists public.pms_intake_device_pairings (
  tenant_id text not null,
  handoff_id text not null,
  code_hash text not null check (length(code_hash) = 64),
  expires_at timestamptz not null,
  paired_at timestamptz,
  write_id text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, handoff_id),
  foreign key (tenant_id, handoff_id) references public.pms_intake_handoffs (tenant_id, id)
);
create unique index if not exists pms_intake_device_pairings_code on public.pms_intake_device_pairings (tenant_id, code_hash);

alter table public.pms_intake_device_pairings enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_intake_device_pairings from %I', r);
    end if;
  end loop;
end;
$$;
