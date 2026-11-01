-- ClinForms 0009 (Postgres / Supabase): subscription billing for ClinDesk and ClinForms (31/10/2026) -
-- clinic_subscription (one subscription per clinic) and clinic_billing_extras (extra reports billed per UK month).
-- Columns and their meaning: see db/migrations/sqlite/0009_clinic_billing.sql (kept in step with it). Idempotent.
-- No patient data. Row level security on and no policies for anon/authenticated, like every other table.

create table if not exists public.clinic_subscription (
  tenant_id text not null primary key,
  customer_ref text not null,
  subscription_ref text not null,
  mode text not null check (mode in ('test', 'live')),
  status text not null check (length(status) between 1 and 30),
  state text not null check (state in ('pending_payment', 'active', 'past_due', 'canceled', 'expired')),
  product text check (product is null or product in ('clindesk', 'clinforms')),
  plan_key text,
  billing_interval text check (billing_interval is null or billing_interval in ('month', 'year')),
  reports_key text,
  reports_included integer check (reports_included is null or reports_included >= 0),
  practitioners_max integer check (practitioners_max is null or practitioners_max > 0),
  amount_pence integer check (amount_pence is null or amount_pence >= 0),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end integer not null default 0 check (cancel_at_period_end in (0, 1)),
  canceled_at timestamptz,
  ended_at timestamptz,
  activated_at timestamptz,
  past_due_since timestamptz,
  grace_until timestamptz,
  grace_notified_at timestamptz,
  read_only_notified_at timestamptz,
  override integer not null default 0 check (override in (0, 1)),
  override_note text check (override_note is null or length(override_note) <= 200),
  applied_json text,
  last_event_ref text,
  last_synced_at timestamptz,
  rev integer not null default 0,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create unique index if not exists clinic_subscription_ref on public.clinic_subscription (subscription_ref);
create index if not exists clinic_subscription_customer on public.clinic_subscription (customer_ref);

create table if not exists public.clinic_billing_extras (
  tenant_id text not null,
  period text not null check (length(period) = 7),
  subscription_ref text not null,
  reports_counted integer not null check (reports_counted >= 0),
  reports_included integer not null check (reports_included >= 0),
  extra_reports integer not null check (extra_reports >= 0),
  unit_pence integer not null check (unit_pence >= 0),
  status text not null check (status in ('pending', 'billed', 'skipped')),
  invoice_item_ref text,
  invoice_ref text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, period)
);
create unique index if not exists clinic_billing_extras_item on public.clinic_billing_extras (invoice_item_ref);

alter table public.clinic_subscription enable row level security;
alter table public.clinic_billing_extras enable row level security;

do $$
declare
  r text;
  t text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      foreach t in array array['clinic_subscription', 'clinic_billing_extras'] loop
        execute format('revoke all on table public.%I from %I', t, r);
      end loop;
    end if;
  end loop;
end;
$$;
