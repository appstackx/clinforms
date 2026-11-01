-- ClinForms 0220 (Postgres / Supabase): clinic system, billing - Healthcode e-billing groundwork (HC06): per payer
-- account the insurer's Healthcode identifier, the clinic's provider number with that insurer and whether a diagnosis
-- code is needed (NULL = the default for its name). New table only (additive).
-- Kept in step with db/migrations/sqlite/0220_pms_payer_healthcode.sql (db/parity.test.ts).
-- RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_payer_healthcode (
  tenant_id text not null,
  referrer_id text not null,
  rev integer not null check (rev > 0),
  insurer_code text,
  provider_number text,
  diagnosis_required integer check (diagnosis_required is null or diagnosis_required in (0, 1)),
  updated_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, referrer_id),
  foreign key (tenant_id, referrer_id) references public.pms_referrers (tenant_id, id)
);

alter table public.pms_payer_healthcode enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_payer_healthcode from %I', r);
    end if;
  end loop;
end;
$$;
