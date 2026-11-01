-- ClinForms 0143 (Postgres / Supabase): clinic system, comms - PREPAID text credits (1 credit = 1 text segment):
-- the per-clinic account (cached balance, never negative; warning flags; automatic top-up; the clinic's saved card -
-- provider references, brand, last four digits and expiry only), the append-only ledger (purchase, auto_topup,
-- debit, adjustment, reversal - a payment credited once, a debit reversed once, a webhook event applied once).
-- No message text, no patient data.
-- Kept in step with db/migrations/sqlite/0143_pms_sms_credits.sql (db/parity.test.ts).
-- RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_sms_credit_accounts (
  tenant_id text not null,
  balance integer not null default 0 check (balance >= 0),
  last_pack_credits integer check (last_pack_credits is null or last_pack_credits > 0),
  low_threshold integer not null default 100 check (low_threshold >= 0),
  low_warned integer not null default 0 check (low_warned in (0, 1)),
  zero_warned integer not null default 0 check (zero_warned in (0, 1)),
  auto_topup integer not null default 0 check (auto_topup in (0, 1)),
  auto_topup_threshold integer not null default 100 check (auto_topup_threshold between 1 and 100000),
  auto_topup_pack text check (auto_topup_pack is null or auto_topup_pack in ('sms_500', 'sms_1000', 'sms_5000')),
  auto_topup_paused_at timestamptz,
  auto_topup_failure text,
  topup_claim text,
  topup_claimed_at timestamptz,
  customer_ref text,
  card_method_ref text,
  card_brand text check (card_brand is null or length(card_brand) between 1 and 20),
  card_last4 text check (card_last4 is null or length(card_last4) = 4),
  card_exp_month integer check (card_exp_month is null or card_exp_month between 1 and 12),
  card_exp_year integer check (card_exp_year is null or card_exp_year between 2000 and 2100),
  last_entry_id text,
  rev integer not null default 0,
  updated_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id)
);
create unique index if not exists pms_sms_credit_accounts_customer on public.pms_sms_credit_accounts (customer_ref);

create table if not exists public.pms_sms_credit_entries (
  tenant_id text not null,
  id text not null,
  kind text not null check (kind in ('purchase', 'auto_topup', 'debit', 'adjustment', 'reversal')),
  credits integer not null check (credits <> 0),
  balance_after integer not null check (balance_after >= 0),
  pack text check (pack is null or pack in ('sms_500', 'sms_1000', 'sms_5000')),
  amount_pence integer check (amount_pence is null or amount_pence >= 0),
  message_id text,
  reverses_id text,
  payment_ref text,
  event_ref text,
  reason text check (reason is null or length(reason) <= 200),
  created_by text,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id) references public.pms_sms_credit_accounts (tenant_id)
);
create unique index if not exists pms_sms_credit_entries_payment on public.pms_sms_credit_entries (payment_ref);
create unique index if not exists pms_sms_credit_entries_reverses on public.pms_sms_credit_entries (tenant_id, reverses_id);
create index if not exists pms_sms_credit_entries_message on public.pms_sms_credit_entries (tenant_id, message_id);
create index if not exists pms_sms_credit_entries_kind on public.pms_sms_credit_entries (tenant_id, kind, id);
create unique index if not exists pms_sms_credit_entries_event on public.pms_sms_credit_entries (event_ref);

-- The ledger is append-only: an entry never changes. Deleting stays possible only for offboarding a whole clinic
-- after a verified export.
create or replace function public.pms_sms_credit_entries_locked() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  raise exception 'pms_sms_credit_entries: entries are append-only' using errcode = 'P0001';
end;
$$;
revoke all on function public.pms_sms_credit_entries_locked() from public;

drop trigger if exists pms_sms_credit_entries_locked on public.pms_sms_credit_entries;
create trigger pms_sms_credit_entries_locked
  before update on public.pms_sms_credit_entries
  for each row execute function public.pms_sms_credit_entries_locked();

alter table public.pms_sms_credit_accounts enable row level security;
alter table public.pms_sms_credit_entries enable row level security;

do $$
declare
  r text;
  t text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      foreach t in array array['pms_sms_credit_accounts', 'pms_sms_credit_entries'] loop
        execute format('revoke all on table public.%I from %I', t, r);
      end loop;
    end if;
  end loop;
end;
$$;
