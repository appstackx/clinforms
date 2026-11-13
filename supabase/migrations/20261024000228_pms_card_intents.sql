-- ClinForms 0228 (Postgres / Supabase): clinic system, billing - every payment, saved-card set-up and refund made
-- through the clinic's connected account (cp03-cp06, l04, pk03). Written BEFORE the provider is asked, so a payment
-- that succeeds while the app is not looking (a crash, a closed tab) is still found and recorded - once.
-- kind payment / setup / refund, purpose reader / saved_card / portal / membership / save_card / refund.
-- intent_ref = the provider's payment intent (pi_...), set-up intent (seti_...) or refund (re_...), checkout_ref = a
-- hosted checkout (cs_...), parent_ref = the payment a refund belongs to. payment_id = the pms_payments row recorded
-- for it (no foreign key - a payment is never deleted, and pms_payments stays the one record of money: a payment is
-- recorded once because its provider reference is unique per clinic). membership_id + period: one monthly charge per
-- membership and month (unique). Hangs off pms_card_settings, its invoice and patient (ON DELETE CASCADE, offboarding).
-- Kept in step with db/migrations/sqlite/0228_pms_card_intents.sql (db/parity.test.ts).
-- RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_card_intents (
  tenant_id text not null,
  id text not null,
  kind text not null check (kind in ('payment', 'setup', 'refund')),
  purpose text not null check (purpose in ('reader', 'saved_card', 'portal', 'membership', 'save_card', 'refund')),
  status text not null default 'open' check (status in ('open', 'processing', 'succeeded', 'failed', 'canceled')),
  intent_ref text,
  checkout_ref text,
  parent_ref text,
  invoice_id text,
  patient_id text,
  mandate_id text,
  reader_id text,
  membership_id text,
  period text check (period is null or period ~ '^[0-9]{4}-[0-9]{2}$'),
  amount_pence integer not null check (amount_pence >= 0),
  fee_pence integer not null default 0 check (fee_pence >= 0),
  payment_id text,
  failure_code text,
  attempts integer not null default 0 check (attempts >= 0),
  created_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id) references public.pms_card_settings (tenant_id) on delete cascade,
  foreign key (tenant_id, invoice_id) references public.pms_invoices (tenant_id, id) on delete cascade,
  foreign key (tenant_id, patient_id) references public.pms_patients (tenant_id, id) on delete cascade
);
create unique index if not exists pms_card_intents_intent on public.pms_card_intents (tenant_id, intent_ref);
create unique index if not exists pms_card_intents_checkout on public.pms_card_intents (tenant_id, checkout_ref);
create unique index if not exists pms_card_intents_period on public.pms_card_intents (tenant_id, membership_id, period) where kind = 'payment' and membership_id is not null;
create index if not exists pms_card_intents_invoice on public.pms_card_intents (tenant_id, invoice_id);
create index if not exists pms_card_intents_parent on public.pms_card_intents (tenant_id, parent_ref);
create index if not exists pms_card_intents_status on public.pms_card_intents (tenant_id, status, updated_at);

alter table public.pms_card_intents enable row level security;

do $$
declare
  r text;
  t text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      foreach t in array array['pms_card_intents'] loop
        execute format('revoke all on table public.%I from %I', t, r);
      end loop;
    end if;
  end loop;
end;
$$;
