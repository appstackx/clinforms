-- ClinForms 0234 (Postgres / Supabase): clinic system, billing - gift cards (PK04): code kept as SHA-256 + last 4,
-- balance in pence never below zero. New table only (additive).
-- Kept in step with db/migrations/sqlite/0234_pms_gift_cards.sql (db/parity.test.ts).
-- RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_gift_cards (
  tenant_id text not null,
  id text not null,
  rev integer not null check (rev > 0),
  code_sha256 text not null,
  code_last4 text not null check (length(code_last4) = 4),
  initial_pence integer not null check (initial_pence > 0),
  balance_pence integer not null check (balance_pence >= 0 and balance_pence <= initial_pence),
  sold_on text check (sold_on is null or sold_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  expires_on text check (expires_on is null or expires_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  sale_invoice_id text,
  sale_line_id text,
  buyer_patient_id text,
  recipient_name_enc text,
  status text not null check (status in ('pending', 'active', 'used', 'expired', 'cancelled')),
  created_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id) references public.pms_billing_settings (tenant_id) on delete cascade,
  foreign key (tenant_id, buyer_patient_id) references public.pms_patients (tenant_id, id) on delete cascade,
  foreign key (tenant_id, sale_invoice_id) references public.pms_invoices (tenant_id, id) on delete cascade,
  foreign key (tenant_id, sale_line_id) references public.pms_invoice_lines (tenant_id, id) on delete cascade
);

create unique index if not exists pms_gift_cards_code on public.pms_gift_cards (tenant_id, code_sha256);
create unique index if not exists pms_gift_cards_sale_line on public.pms_gift_cards (tenant_id, sale_line_id);
create index if not exists pms_gift_cards_created on public.pms_gift_cards (tenant_id, created_at);

alter table public.pms_gift_cards enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_gift_cards from %I', r);
    end if;
  end loop;
end;
$$;
