-- ClinForms 0172 (Postgres / Supabase): clinic system, integration - XERO SYNC groundwork (tracker xe03-xe06),
-- behind CLINFORMS_XERO=on and a per-clinic setting that is off by default. One connection row per clinic (tokens
-- encrypted with the data envelope in tokens_sealed - never an _enc column, so offboarding never exports them in
-- clear), the clinic's mappings to Xero accounts / tax rates / tracking, links ClinDesk record -> Xero id, and the
-- send list with retry state. Mappings, links and sync items cascade from the connection, the connection from the
-- clinic's pms_billing_settings row.
-- Kept in step with db/migrations/sqlite/0172_pms_xero_sync.sql (db/parity.test.ts).
-- RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_xero_connections (
  tenant_id text not null primary key,
  rev integer not null default 1 check (rev > 0),
  enabled integer not null default 0 check (enabled in (0, 1)),
  status text not null default 'not_connected' check (status in ('not_connected', 'connected', 'paused', 'disconnected')),
  xero_tenant_id text check (xero_tenant_id is null or length(xero_tenant_id) <= 64),
  connection_id text check (connection_id is null or length(connection_id) <= 64),
  org_name text check (org_name is null or length(org_name) <= 200),
  base_currency text check (base_currency is null or length(base_currency) = 3),
  tokens_sealed text,
  access_expires_at timestamptz,
  refresh_lock_until timestamptz,
  scopes text check (scopes is null or length(scopes) <= 500),
  send_from text check (send_from is null or send_from ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  send_contact_details integer not null default 0 check (send_contact_details in (0, 1)),
  state_hash text check (state_hash is null or length(state_hash) = 64),
  state_session text,
  state_user text,
  state_expires_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 500),
  connected_by text,
  connected_at timestamptz,
  updated_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  foreign key (tenant_id) references public.pms_billing_settings (tenant_id) on delete cascade
);
create index if not exists pms_xero_connections_active on public.pms_xero_connections (status, enabled);

create table if not exists public.pms_xero_mappings (
  tenant_id text not null,
  map_kind text not null check (map_kind in ('default_account', 'item_account', 'visit_account', 'service_account', 'write_off_account', 'payment_account', 'tax_type', 'tracking')),
  local_key text not null check (length(local_key) between 1 and 100),
  xero_value text not null check (length(xero_value) between 1 and 100),
  xero_label text check (xero_label is null or length(xero_label) <= 200),
  updated_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, map_kind, local_key),
  foreign key (tenant_id) references public.pms_xero_connections (tenant_id) on delete cascade
);

create table if not exists public.pms_xero_links (
  tenant_id text not null,
  local_type text not null check (local_type in ('patient', 'referrer', 'invoice', 'credit_note', 'allocation')),
  local_id text not null,
  xero_id text not null check (length(xero_id) between 1 and 64),
  xero_number text check (xero_number is null or length(xero_number) <= 100),
  sent_hash text check (sent_hash is null or length(sent_hash) = 64),
  pushed_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, local_type, local_id),
  foreign key (tenant_id) references public.pms_xero_connections (tenant_id) on delete cascade
);

create table if not exists public.pms_xero_sync_items (
  tenant_id text not null,
  id text not null check (length(id) between 1 and 120),
  local_type text not null check (local_type in ('invoice', 'credit_note', 'allocation')),
  local_id text not null,
  op text not null check (op in ('create', 'delete')),
  status text not null default 'pending' check (status in ('pending', 'in_flight', 'done', 'failed', 'blocked', 'skipped')),
  attempts integer not null default 0 check (attempts >= 0),
  payload_version integer not null default 1 check (payload_version > 0),
  next_attempt_at timestamptz not null,
  lease_until timestamptz,
  error_class text check (error_class is null or error_class in ('transient', 'validation', 'auth', 'waiting')),
  error_message text check (error_message is null or length(error_message) <= 500),
  xero_id text check (xero_id is null or length(xero_id) <= 64),
  done_at timestamptz,
  resolved_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id) references public.pms_xero_connections (tenant_id) on delete cascade
);
create index if not exists pms_xero_sync_items_due on public.pms_xero_sync_items (tenant_id, status, next_attempt_at);
create index if not exists pms_xero_sync_items_local on public.pms_xero_sync_items (tenant_id, local_type, local_id);

alter table public.pms_xero_connections enable row level security;
alter table public.pms_xero_mappings enable row level security;
alter table public.pms_xero_links enable row level security;
alter table public.pms_xero_sync_items enable row level security;

do $$
declare
  r text;
  t text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      foreach t in array array['pms_xero_connections', 'pms_xero_mappings', 'pms_xero_links', 'pms_xero_sync_items'] loop
        execute format('revoke all on table public.%I from %I', t, r);
      end loop;
    end if;
  end loop;
end;
$$;
