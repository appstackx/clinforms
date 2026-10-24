-- ClinForms 0151 (Postgres / Supabase): clinic system, portal module part 2 - the patient portal: portal
-- accounts (separate from staff accounts), one-time sign-in links and sessions (SHA-256 hashes only), the outbox
-- (recipient and body encrypted) and documents shared with a patient (body encrypted). Kept in step with
-- db/migrations/sqlite/0151_portal_accounts.sql (db/parity.test.ts). RLS on, no policies, Data API roles revoked.
-- Idempotent.

create table if not exists public.pms_portal_accounts (
  tenant_id text not null,
  id text not null,
  patient_id text not null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  last_sign_in_at timestamptz,
  updated_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, patient_id) references public.pms_patients (tenant_id, id)
);
create unique index if not exists pms_portal_accounts_patient on public.pms_portal_accounts (tenant_id, patient_id);

create table if not exists public.pms_portal_links (
  tenant_id text not null,
  id text not null,
  account_id text not null,
  token_hash text not null check (length(token_hash) = 64),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, account_id) references public.pms_portal_accounts (tenant_id, id)
);
create unique index if not exists pms_portal_links_token on public.pms_portal_links (tenant_id, token_hash);
create index if not exists pms_portal_links_account on public.pms_portal_links (tenant_id, account_id, created_at);

create table if not exists public.pms_portal_sessions (
  tenant_id text not null,
  id text not null,
  account_id text not null,
  token_hash text not null check (length(token_hash) = 64),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, account_id) references public.pms_portal_accounts (tenant_id, id)
);
create index if not exists pms_portal_sessions_account on public.pms_portal_sessions (tenant_id, account_id, created_at);

create table if not exists public.pms_portal_messages (
  tenant_id text not null,
  id text not null,
  patient_id text,
  kind text not null check (kind in ('sign_in_link', 'booking_confirmed', 'booking_cancelled', 'booking_changed', 'form_request', 'document_shared')),
  channel text not null default 'email' check (channel in ('email')),
  subject text not null check (length(subject) between 1 and 200),
  recipient_enc text,
  body_enc text,
  status text not null check (status in ('outbox', 'sent', 'failed')),
  provider text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, patient_id) references public.pms_patients (tenant_id, id)
);
create index if not exists pms_portal_messages_created on public.pms_portal_messages (tenant_id, created_at);
create index if not exists pms_portal_messages_patient on public.pms_portal_messages (tenant_id, patient_id, created_at);

create table if not exists public.pms_portal_shares (
  tenant_id text not null,
  id text not null,
  patient_id text not null,
  title text not null check (length(title) between 1 and 120),
  body_enc text not null,
  shared_by text,
  shared_at timestamptz not null,
  viewed_at timestamptz,
  withdrawn_at timestamptz,
  withdrawn_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, patient_id) references public.pms_patients (tenant_id, id)
);
create index if not exists pms_portal_shares_patient on public.pms_portal_shares (tenant_id, patient_id, shared_at);

alter table public.pms_portal_accounts enable row level security;
alter table public.pms_portal_links enable row level security;
alter table public.pms_portal_sessions enable row level security;
alter table public.pms_portal_messages enable row level security;
alter table public.pms_portal_shares enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_portal_accounts, public.pms_portal_links, public.pms_portal_sessions, public.pms_portal_messages, public.pms_portal_shares from %I', r);
    end if;
  end loop;
end;
$$;
