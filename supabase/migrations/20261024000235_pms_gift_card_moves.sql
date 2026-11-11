-- ClinForms 0235 (Postgres / Supabase): clinic system, billing - gift cards (PK04): every change to a card's balance,
-- append-only, with the balance after it. New table only (additive).
-- Kept in step with db/migrations/sqlite/0235_pms_gift_card_moves.sql (db/parity.test.ts).
-- RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_gift_card_moves (
  tenant_id text not null,
  id text not null,
  gift_card_id text not null,
  kind text not null check (kind in ('sale', 'redeem', 'refund', 'expire', 'adjust')),
  amount_pence integer not null,
  payment_id text,
  balance_after integer not null check (balance_after >= 0),
  created_by text,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, gift_card_id) references public.pms_gift_cards (tenant_id, id) on delete cascade
);

create index if not exists pms_gift_card_moves_card on public.pms_gift_card_moves (tenant_id, gift_card_id, created_at);
create index if not exists pms_gift_card_moves_payment on public.pms_gift_card_moves (tenant_id, payment_id);

alter table public.pms_gift_card_moves enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_gift_card_moves from %I', r);
    end if;
  end loop;
end;
$$;
