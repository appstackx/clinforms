-- ClinForms 0131 (Postgres / Supabase): clinic system, billing part 2 - payments and refunds, their allocations to
-- invoices, card payment links (test mode only) and the insurer e-billing export log. Kept in step with
-- db/migrations/sqlite/0131_pms_payments.sql (db/parity.test.ts). Same CHECK invariants as SQLite/D1.
-- RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_payments (
  tenant_id text not null,
  id text not null,
  kind text not null default 'payment' check (kind in ('payment', 'refund')),
  status text not null default 'recorded' check (status in ('recorded', 'reversed')),
  payer_kind text not null check (payer_kind in ('patient', 'account')),
  patient_id text,
  payer_referrer_id text,
  received_on text not null check (received_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  method text not null check (method in ('card', 'cash', 'bank_transfer', 'cheque', 'online', 'other')),
  amount_pence integer not null check (amount_pence > 0),
  allocated_pence integer not null default 0 check (allocated_pence >= 0 and allocated_pence <= amount_pence),
  reference text,
  notes_enc text,
  provider text not null default 'manual',
  provider_ref text,
  reversed_at timestamptz,
  reversed_by text,
  reverse_reason_enc text,
  import_ref text,
  created_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  check ((payer_kind = 'patient' and patient_id is not null and payer_referrer_id is null) or (payer_kind = 'account' and payer_referrer_id is not null and patient_id is null)),
  foreign key (tenant_id, patient_id) references public.pms_patients (tenant_id, id),
  foreign key (tenant_id, payer_referrer_id) references public.pms_referrers (tenant_id, id)
);
create unique index if not exists pms_payments_provider_ref on public.pms_payments (tenant_id, provider, provider_ref);
create unique index if not exists pms_payments_import_ref on public.pms_payments (tenant_id, import_ref);
create index if not exists pms_payments_received on public.pms_payments (tenant_id, received_on);
create index if not exists pms_payments_patient on public.pms_payments (tenant_id, patient_id);
create index if not exists pms_payments_payer on public.pms_payments (tenant_id, payer_referrer_id);

create table if not exists public.pms_payment_allocations (
  tenant_id text not null,
  id text not null,
  payment_id text not null,
  invoice_id text not null,
  amount_pence integer not null check (amount_pence <> 0),
  invoice_balance_after integer not null,
  reversed integer not null default 0 check (reversed in (0, 1)),
  created_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  check ((amount_pence > 0 and invoice_balance_after >= 0) or (amount_pence < 0 and invoice_balance_after <= 0)),
  foreign key (tenant_id, payment_id) references public.pms_payments (tenant_id, id),
  foreign key (tenant_id, invoice_id) references public.pms_invoices (tenant_id, id)
);
create unique index if not exists pms_payment_allocations_pair on public.pms_payment_allocations (tenant_id, payment_id, invoice_id) where reversed = 0;
create index if not exists pms_payment_allocations_invoice on public.pms_payment_allocations (tenant_id, invoice_id);

create table if not exists public.pms_payment_links (
  tenant_id text not null,
  id text not null,
  invoice_id text not null,
  provider text not null,
  mode text not null check (mode = 'test'),
  provider_link_id text not null,
  url text not null,
  amount_pence integer not null check (amount_pence > 0),
  status text not null default 'active' check (status in ('active', 'paid', 'deactivated')),
  last_checked_at timestamptz,
  created_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, invoice_id) references public.pms_invoices (tenant_id, id)
);
create unique index if not exists pms_payment_links_provider on public.pms_payment_links (tenant_id, provider, provider_link_id);
create index if not exists pms_payment_links_invoice on public.pms_payment_links (tenant_id, invoice_id);

create table if not exists public.pms_invoice_exports (
  tenant_id text not null,
  id text not null,
  invoice_id text not null,
  channel text not null check (channel in ('csv', 'healthcode')),
  batch_ref text not null,
  created_by text,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, invoice_id) references public.pms_invoices (tenant_id, id)
);
create index if not exists pms_invoice_exports_invoice on public.pms_invoice_exports (tenant_id, invoice_id);
create index if not exists pms_invoice_exports_batch on public.pms_invoice_exports (tenant_id, batch_ref);

alter table public.pms_payments enable row level security;
alter table public.pms_payment_allocations enable row level security;
alter table public.pms_payment_links enable row level security;
alter table public.pms_invoice_exports enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_payments, public.pms_payment_allocations, public.pms_payment_links, public.pms_invoice_exports from %I', r);
    end if;
  end loop;
end;
$$;
