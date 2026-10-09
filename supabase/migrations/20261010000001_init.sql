-- ClinForms 0001_init (Postgres / Supabase). Kept in step with db/migrations/sqlite/0001_init.sql
-- (db/parity.test.ts checks tables and columns match).
-- Conventions: ids text, timestamps timestamptz, booleans integer 0/1, JSON and ciphertext text.
-- Every table has row level security ENABLED and NO policies for anon/authenticated: the Data API cannot
-- read or write them. The app connects as the table owner through the pooler.
-- Idempotent (IF NOT EXISTS / OR REPLACE), so a re-run is harmless.

create table if not exists public.clinic_profile (
  tenant_id text not null primary key,
  organization_id text not null,
  display_name text not null,
  legal_name text,
  address_json text,
  postcode text,
  phone text,
  email text,
  retention_days integer not null default 365 check (retention_days > 0),
  drafting_enabled integer not null default 0 check (drafting_enabled in (0, 1)),
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create unique index if not exists clinic_profile_organization_id on public.clinic_profile (organization_id);

create table if not exists public.member_profile (
  organization_id text not null,
  user_id text not null,
  job_title text,
  hcpc_number text,
  can_sign integer not null default 0 check (can_sign in (0, 1)),
  updated_at timestamptz not null,
  primary key (organization_id, user_id)
);

create table if not exists public.tenant_settings (
  tenant_id text not null primary key,
  referrer_links_json text not null,
  updated_at timestamptz not null
);

create table if not exists public.forms (
  tenant_id text not null,
  id text not null,
  rev integer not null check (rev > 0),
  file_sha256 text not null,
  status text not null,
  title text not null,
  referrer text,
  kind text not null,
  sample_id text,
  payload_enc text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id)
);
create index if not exists forms_tenant_updated on public.forms (tenant_id, updated_at);

create table if not exists public.form_files (
  tenant_id text not null,
  sha256 text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  chunk_count integer not null check (chunk_count >= 0),
  created_at timestamptz not null,
  primary key (tenant_id, sha256)
);

create table if not exists public.form_file_chunks (
  tenant_id text not null,
  sha256 text not null,
  idx integer not null check (idx >= 0),
  data_enc text not null,
  primary key (tenant_id, sha256, idx),
  foreign key (tenant_id, sha256) references public.form_files (tenant_id, sha256) on delete cascade
);

create table if not exists public.reports (
  tenant_id text not null,
  id text not null,
  rev integer not null check (rev > 0),
  status text not null,
  form_id text,
  template_id text not null,
  payload_enc text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  delete_after timestamptz,
  primary key (tenant_id, id)
);
create index if not exists reports_tenant_updated on public.reports (tenant_id, updated_at);
create index if not exists reports_delete_after on public.reports (delete_after);

create table if not exists public.audit_log (
  id text not null primary key,
  tenant_id text not null,
  user_id text,
  session_id text,
  action text not null,
  target_type text,
  target_id text,
  detail_json text,
  at timestamptz not null
);
create index if not exists audit_log_tenant_id on public.audit_log (tenant_id, id);

create table if not exists public.partner_keys (
  id text not null primary key,
  tenant_id text not null,
  name text not null,
  key_hash text not null,
  last4 text not null,
  created_by text,
  created_at timestamptz not null,
  revoked_at timestamptz
);
create unique index if not exists partner_keys_key_hash on public.partner_keys (key_hash);
create index if not exists partner_keys_tenant on public.partner_keys (tenant_id);

create table if not exists public.launch_token_uses (
  jti text not null primary key,
  expires_at timestamptz not null
);
create index if not exists launch_token_uses_expires_at on public.launch_token_uses (expires_at);

create table if not exists public.rate_limits (
  "key" text not null,
  window_start timestamptz not null,
  count integer not null check (count >= 0),
  primary key ("key", window_start)
);
create index if not exists rate_limits_window_start on public.rate_limits (window_start);

create table if not exists public.access_requests (
  id text not null primary key,
  clinic_name text not null,
  contact_name text not null,
  email text not null,
  phone text,
  message text,
  created_at timestamptz not null
);
create index if not exists access_requests_created_at on public.access_requests (created_at);

-- audit_log is append-only: revoke UPDATE/DELETE/TRUNCATE and refuse them in a trigger as well
-- (the trigger also binds the table owner, which the app connects as).
create or replace function public.clinforms_audit_log_append_only() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only' using errcode = 'P0001';
end;
$$;
revoke all on function public.clinforms_audit_log_append_only() from public;

drop trigger if exists audit_log_no_update_delete on public.audit_log;
create trigger audit_log_no_update_delete
  before update or delete on public.audit_log
  for each row execute function public.clinforms_audit_log_append_only();

drop trigger if exists audit_log_no_truncate on public.audit_log;
create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.clinforms_audit_log_append_only();

revoke update, delete, truncate on public.audit_log from public;

-- Row level security on every table, with no policies: the Data API (anon / authenticated) gets nothing.
alter table public.clinic_profile enable row level security;
alter table public.member_profile enable row level security;
alter table public.tenant_settings enable row level security;
alter table public.forms enable row level security;
alter table public.form_files enable row level security;
alter table public.form_file_chunks enable row level security;
alter table public.reports enable row level security;
alter table public.audit_log enable row level security;
alter table public.partner_keys enable row level security;
alter table public.launch_token_uses enable row level security;
alter table public.rate_limits enable row level security;
alter table public.access_requests enable row level security;

-- Supabase roles: take away the default table grants too (defence in depth on top of RLS). The roles do
-- not exist on a plain Postgres (or PGlite in tests), hence the checks.
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'revoke all on table public.clinic_profile, public.member_profile, public.tenant_settings, '
        'public.forms, public.form_files, public.form_file_chunks, public.reports, public.audit_log, '
        'public.partner_keys, public.launch_token_uses, public.rate_limits, public.access_requests from %I',
        r
      );
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke update, delete, truncate on table public.audit_log from service_role';
  end if;
end;
$$;
