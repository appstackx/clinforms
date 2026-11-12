-- ClinForms 0171 (Postgres / Supabase): clinic system, integration - the PUBLIC CLINIC API v1 (tracker xt03),
-- behind CLINFORMS_CLINIC_API=on and a per-clinic setting that is off by default. Settings per clinic, API keys
-- (only the SHA-256 of a key is stored, with its lookup id and last 4 characters), calls per key per day, and the
-- Idempotency-Key rows of bookings (unique per key family: a key and its replacements). Keys cascade from the
-- settings row, days and idempotency rows from their key.
-- Kept in step with db/migrations/sqlite/0171_pms_clinic_api.sql (db/parity.test.ts).
-- RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_api_settings (
  tenant_id text not null primary key,
  rev integer not null default 1 check (rev > 0),
  enabled integer not null default 0 check (enabled in (0, 1)),
  updated_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists public.pms_api_keys (
  tenant_id text not null,
  id text not null,
  family_id text not null,
  lookup text not null check (length(lookup) = 16),
  key_hash text not null check (length(key_hash) = 64),
  last4 text not null check (length(last4) = 4),
  name text not null check (length(name) between 1 and 80),
  scopes_json text not null,
  site_ids_json text,
  expires_at timestamptz,
  last_used_at timestamptz,
  use_count integer not null default 0 check (use_count >= 0),
  replaced_by_id text,
  revoked_at timestamptz,
  revoked_by text,
  write_id text,
  created_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id) references public.pms_api_settings (tenant_id) on delete cascade
);
create unique index if not exists pms_api_keys_lookup on public.pms_api_keys (tenant_id, lookup);
create index if not exists pms_api_keys_created on public.pms_api_keys (tenant_id, created_at);
create index if not exists pms_api_keys_family on public.pms_api_keys (tenant_id, family_id);

create table if not exists public.pms_api_key_days (
  tenant_id text not null,
  key_id text not null,
  day text not null check (day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  calls integer not null default 0 check (calls >= 0),
  patient_reads integer not null default 0 check (patient_reads >= 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, key_id, day),
  foreign key (tenant_id, key_id) references public.pms_api_keys (tenant_id, id) on delete cascade
);

create table if not exists public.pms_api_idempotency (
  tenant_id text not null,
  id text not null,
  key_id text not null,
  family_id text not null,
  idem_key text not null check (length(idem_key) between 8 and 100),
  request_sha256 text not null check (length(request_sha256) = 64),
  appointment_id text not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, key_id) references public.pms_api_keys (tenant_id, id) on delete cascade,
  foreign key (tenant_id, appointment_id) references public.pms_appointments (tenant_id, id) on delete cascade
);
create unique index if not exists pms_api_idempotency_key on public.pms_api_idempotency (tenant_id, family_id, idem_key);
create index if not exists pms_api_idempotency_key_id on public.pms_api_idempotency (tenant_id, key_id);
create index if not exists pms_api_idempotency_appointment on public.pms_api_idempotency (tenant_id, appointment_id);

alter table public.pms_api_settings enable row level security;
alter table public.pms_api_keys enable row level security;
alter table public.pms_api_key_days enable row level security;
alter table public.pms_api_idempotency enable row level security;

do $$
declare
  r text;
  t text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      foreach t in array array['pms_api_settings', 'pms_api_keys', 'pms_api_key_days', 'pms_api_idempotency'] loop
        execute format('revoke all on table public.%I from %I', t, r);
      end loop;
    end if;
  end loop;
end;
$$;
