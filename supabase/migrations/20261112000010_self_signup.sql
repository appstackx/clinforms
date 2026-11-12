-- ClinForms 0010 (Postgres / Supabase): self-serve sign-up with online acceptance of the terms and the data
-- processing agreement (12/11/2026, tracker l01; behind CLINFORMS_SELF_SIGNUP, off by default) - signup_requests
-- (forms waiting for the email link) and signup_acceptances (the record of acceptance, one per clinic).
-- Columns and their meaning: see db/migrations/sqlite/0010_self_signup.sql (kept in step with it). Idempotent.
-- No patient data. Row level security on and no policies for anon/authenticated, like every other table.

create table if not exists public.signup_requests (
  id text not null primary key,
  token_hash text not null,
  brand text not null check (brand in ('clinforms', 'clinic')),
  clinic_name text not null check (length(clinic_name) between 2 and 200),
  owner_name text not null check (length(owner_name) between 1 and 200),
  email text not null check (length(email) between 3 and 254),
  password_hash text,
  terms_version text not null check (length(terms_version) between 1 and 80),
  dpa_version text not null check (length(dpa_version) between 1 and 80),
  ip_hash text not null,
  ua_hash text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  tenant_id text,
  completed_at timestamptz
);
create unique index if not exists signup_requests_token on public.signup_requests (token_hash);
create index if not exists signup_requests_email on public.signup_requests (email);
create index if not exists signup_requests_expires on public.signup_requests (expires_at);

create table if not exists public.signup_acceptances (
  id text not null primary key,
  tenant_id text not null,
  user_id text not null,
  signup_id text not null,
  brand text not null check (brand in ('clinforms', 'clinic')),
  terms_version text not null,
  dpa_version text not null,
  accepted_at timestamptz not null,
  confirmed_at timestamptz not null,
  ip_hash text not null,
  ua_hash text not null
);
create unique index if not exists signup_acceptances_signup on public.signup_acceptances (signup_id);
create index if not exists signup_acceptances_tenant on public.signup_acceptances (tenant_id);

alter table public.signup_requests enable row level security;
alter table public.signup_acceptances enable row level security;

do $$
declare
  r text;
  t text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      foreach t in array array['signup_requests', 'signup_acceptances'] loop
        execute format('revoke all on table public.%I from %I', t, r);
      end loop;
    end if;
  end loop;
end;
$$;
