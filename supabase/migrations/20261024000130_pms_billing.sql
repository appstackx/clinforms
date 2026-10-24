-- ClinForms 0130 (Postgres / Supabase): clinic system, billing part 1 - billing settings, VAT per appointment type,
-- invoices, invoice lines, credit notes and their lines. Kept in step with db/migrations/sqlite/0130_pms_billing.sql
-- (db/parity.test.ts). Composite (tenant_id, id) keys, foreign keys that include tenant_id, money in whole pence,
-- dates text YYYY-MM-DD, free text encrypted in the _enc columns. The CHECK constraints are the same invariants as
-- on SQLite/D1 (a failed one aborts the whole transaction). RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_billing_settings (
  tenant_id text not null,
  rev integer not null default 1 check (rev > 0),
  invoice_prefix text not null default 'INV' check (length(invoice_prefix) between 1 and 4),
  credit_note_prefix text not null default 'CN' check (length(credit_note_prefix) between 1 and 4),
  first_invoice_number integer not null default 1 check (first_invoice_number between 1 and 999999),
  first_credit_note_number integer not null default 1 check (first_credit_note_number between 1 and 999999),
  self_pay_terms_days integer not null default 0 check (self_pay_terms_days between 0 and 90),
  account_terms_days integer not null default 30 check (account_terms_days between 0 and 180),
  vat_registered integer not null default 0 check (vat_registered in (0, 1)),
  vat_number text,
  prices_include_vat integer not null default 1 check (prices_include_vat in (0, 1)),
  dna_charge_percent integer not null default 100 check (dna_charge_percent between 0 and 100),
  late_cancel_charge_percent integer not null default 50 check (late_cancel_charge_percent between 0 and 100),
  payment_instructions text,
  payment_links_enabled integer not null default 0 check (payment_links_enabled in (0, 1)),
  updated_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id)
);

create table if not exists public.pms_service_vat (
  tenant_id text not null,
  service_id text not null,
  vat_code text not null check (vat_code in ('exempt', 'standard', 'reduced', 'zero')),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, service_id),
  foreign key (tenant_id, service_id) references public.pms_services (tenant_id, id)
);

create table if not exists public.pms_invoices (
  tenant_id text not null,
  id text not null,
  rev integer not null check (rev > 0),
  status text not null default 'draft' check (status in ('draft', 'issued', 'cancelled')),
  number_prefix text,
  number_seq integer check (number_seq is null or number_seq between 1 and 999999),
  patient_id text not null,
  case_id text,
  bill_to text not null check (bill_to in ('patient', 'payer')),
  payer_type text not null check (payer_type in ('self_pay', 'insurer', 'mlc', 'solicitor', 'employer', 'other')),
  payer_referrer_id text,
  authorisation_id text,
  related_invoice_id text,
  issued_on text check (issued_on is null or issued_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  due_on text check (due_on is null or due_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  first_service_on text,
  last_service_on text,
  net_pence integer not null,
  vat_pence integer not null check (vat_pence >= 0),
  total_pence integer not null check (total_pence >= 0),
  paid_pence integer not null default 0 check (paid_pence >= 0),
  credited_pence integer not null default 0 check (credited_pence >= 0 and credited_pence <= total_pence),
  prices_include_vat integer not null check (prices_include_vat in (0, 1)),
  auth_sessions integer not null default 0 check (auth_sessions >= 0),
  auth_value_pence integer not null default 0 check (auth_value_pence >= 0),
  bill_to_enc text,
  diagnosis_enc text,
  notes_enc text,
  exported_at timestamptz,
  edit_token text,
  import_ref text,
  created_by text,
  issued_by text,
  issued_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  check (status <> 'issued' or (number_seq is not null and number_prefix is not null and issued_on is not null)),
  check (status = 'issued' or number_seq is null),
  check (bill_to = 'patient' or payer_referrer_id is not null),
  foreign key (tenant_id, patient_id) references public.pms_patients (tenant_id, id),
  foreign key (tenant_id, patient_id, case_id) references public.pms_cases (tenant_id, patient_id, id),
  foreign key (tenant_id, payer_referrer_id) references public.pms_referrers (tenant_id, id),
  foreign key (tenant_id, authorisation_id) references public.pms_authorisations (tenant_id, id),
  foreign key (tenant_id, related_invoice_id) references public.pms_invoices (tenant_id, id)
);
create unique index if not exists pms_invoices_number on public.pms_invoices (tenant_id, number_seq);
create unique index if not exists pms_invoices_import_ref on public.pms_invoices (tenant_id, import_ref);
create index if not exists pms_invoices_patient on public.pms_invoices (tenant_id, patient_id, created_at);
create index if not exists pms_invoices_case on public.pms_invoices (tenant_id, case_id);
create index if not exists pms_invoices_status_issued on public.pms_invoices (tenant_id, status, issued_on);
create index if not exists pms_invoices_payer on public.pms_invoices (tenant_id, payer_referrer_id, status);

create table if not exists public.pms_invoice_lines (
  tenant_id text not null,
  id text not null,
  invoice_id text not null,
  line_no integer not null check (line_no between 1 and 100),
  kind text not null check (kind in ('service', 'item', 'excess', 'excess_deduction')),
  service_id text,
  appointment_id text,
  visit_status text check (visit_status is null or visit_status in ('attended', 'did_not_attend', 'late_cancellation')),
  practitioner_id text,
  service_on text check (service_on is null or service_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  description_enc text,
  billing_code text,
  quantity integer not null check (quantity between 1 and 99),
  unit_price_pence integer not null,
  discount_pence integer not null default 0 check (discount_pence >= 0),
  vat_code text not null check (vat_code in ('exempt', 'standard', 'reduced', 'zero', 'none')),
  vat_rate_bp integer not null check (vat_rate_bp between 0 and 10000),
  net_pence integer not null,
  vat_pence integer not null,
  total_pence integer not null,
  credited_pence integer not null default 0 check (credited_pence >= 0 and credited_pence <= greatest(total_pence, 0)),
  billing_lock integer not null default 1 check (billing_lock in (0, 1)),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  check (kind = 'excess_deduction' or (unit_price_pence >= 0 and total_pence >= 0)),
  check (kind <> 'excess_deduction' or total_pence <= 0),
  foreign key (tenant_id, invoice_id) references public.pms_invoices (tenant_id, id),
  foreign key (tenant_id, service_id) references public.pms_services (tenant_id, id),
  foreign key (tenant_id, practitioner_id) references public.pms_practitioners (tenant_id, id)
);
create unique index if not exists pms_invoice_lines_line_no on public.pms_invoice_lines (tenant_id, invoice_id, line_no);
create unique index if not exists pms_invoice_lines_appointment on public.pms_invoice_lines (tenant_id, appointment_id) where appointment_id is not null and billing_lock = 1;
create index if not exists pms_invoice_lines_service_on on public.pms_invoice_lines (tenant_id, service_on);

create table if not exists public.pms_credit_notes (
  tenant_id text not null,
  id text not null,
  invoice_id text not null,
  number_prefix text not null,
  number_seq integer not null check (number_seq between 1 and 999999),
  issued_on text not null check (issued_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  net_pence integer not null,
  vat_pence integer not null check (vat_pence >= 0),
  total_pence integer not null check (total_pence >= 0),
  reason_enc text,
  import_ref text,
  created_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, invoice_id) references public.pms_invoices (tenant_id, id)
);
create unique index if not exists pms_credit_notes_number on public.pms_credit_notes (tenant_id, number_seq);
create unique index if not exists pms_credit_notes_import_ref on public.pms_credit_notes (tenant_id, import_ref);
create index if not exists pms_credit_notes_invoice on public.pms_credit_notes (tenant_id, invoice_id);
create index if not exists pms_credit_notes_issued on public.pms_credit_notes (tenant_id, issued_on);

create table if not exists public.pms_credit_note_lines (
  tenant_id text not null,
  id text not null,
  credit_note_id text not null,
  invoice_line_id text not null,
  net_pence integer not null,
  vat_pence integer not null check (vat_pence >= 0),
  total_pence integer not null check (total_pence > 0),
  line_remaining_after integer not null check (line_remaining_after >= 0),
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, credit_note_id) references public.pms_credit_notes (tenant_id, id),
  foreign key (tenant_id, invoice_line_id) references public.pms_invoice_lines (tenant_id, id)
);
create unique index if not exists pms_credit_note_lines_line on public.pms_credit_note_lines (tenant_id, credit_note_id, invoice_line_id);
create index if not exists pms_credit_note_lines_invoice_line on public.pms_credit_note_lines (tenant_id, invoice_line_id);

alter table public.pms_billing_settings enable row level security;
alter table public.pms_service_vat enable row level security;
alter table public.pms_invoices enable row level security;
alter table public.pms_invoice_lines enable row level security;
alter table public.pms_credit_notes enable row level security;
alter table public.pms_credit_note_lines enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_billing_settings, public.pms_service_vat, public.pms_invoices, public.pms_invoice_lines, public.pms_credit_notes, public.pms_credit_note_lines from %I', r);
    end if;
  end loop;
end;
$$;
