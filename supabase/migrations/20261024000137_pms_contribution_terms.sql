-- ClinForms 0137 (Postgres / Supabase): clinic system, billing - how the patient's part of an insured visit is
-- billed: 'per_case' (one excess per case, used up visit by visit - the default) or 'per_visit' (a fixed patient
-- contribution on every visit). Per payer account, with a case override (NULL = as the payer account).
-- Kept in step with db/migrations/sqlite/0137_pms_contribution_terms.sql (db/parity.test.ts).
-- RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_payer_billing_terms (
  tenant_id text not null,
  referrer_id text not null,
  rev integer not null check (rev > 0),
  contribution_mode text not null check (contribution_mode in ('per_case', 'per_visit')),
  updated_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, referrer_id),
  foreign key (tenant_id, referrer_id) references public.pms_referrers (tenant_id, id)
);

create table if not exists public.pms_case_billing_terms (
  tenant_id text not null,
  case_id text not null,
  rev integer not null check (rev > 0),
  contribution_mode text check (contribution_mode is null or contribution_mode in ('per_case', 'per_visit')),
  updated_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, case_id),
  foreign key (tenant_id, case_id) references public.pms_cases (tenant_id, id)
);

alter table public.pms_payer_billing_terms enable row level security;
alter table public.pms_case_billing_terms enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_payer_billing_terms from %I', r);
      execute format('revoke all on table public.pms_case_billing_terms from %I', r);
    end if;
  end loop;
end;
$$;
