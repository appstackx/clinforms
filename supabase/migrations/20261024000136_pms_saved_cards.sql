-- ClinForms 0136 (Postgres / Supabase): clinic system, billing - a patient's saved card (test mode only:
-- provider references, brand, last four digits and expiry - never a card number) and the site indexes for
-- 0133/0135. Kept in step with db/migrations/sqlite/0136_pms_saved_cards.sql (db/parity.test.ts).
-- RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_saved_cards (
  tenant_id text not null,
  id text not null,
  patient_id text not null,
  provider text not null,
  mode text not null check (mode = 'test'),
  customer_ref text not null,
  method_ref text not null,
  brand text not null check (length(brand) between 1 and 20),
  last4 text not null check (length(last4) = 4),
  exp_month integer not null check (exp_month between 1 and 12),
  exp_year integer not null check (exp_year between 2000 and 2100),
  status text not null default 'active' check (status in ('active', 'removed')),
  created_by text,
  removed_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, patient_id) references public.pms_patients (tenant_id, id)
);
create unique index if not exists pms_saved_cards_method on public.pms_saved_cards (tenant_id, provider, method_ref);
create index if not exists pms_saved_cards_patient on public.pms_saved_cards (tenant_id, patient_id, status);
create index if not exists pms_invoices_site on public.pms_invoices (tenant_id, site_id, status);
create index if not exists pms_payments_site_received on public.pms_payments (tenant_id, site_id, received_on);

alter table public.pms_saved_cards enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_saved_cards from %I', r);
    end if;
  end loop;
end;
$$;
