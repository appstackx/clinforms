-- ClinForms 0236 (Postgres / Supabase): clinic system, billing - products (PK05): name, SKU, price, VAT code, low-stock
-- level. New table only (additive).
-- Kept in step with db/migrations/sqlite/0236_pms_products.sql (db/parity.test.ts).
-- RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_products (
  tenant_id text not null,
  id text not null,
  rev integer not null check (rev > 0),
  name text not null check (length(name) between 1 and 120),
  sku text,
  price_pence integer not null check (price_pence between 0 and 100000000),
  vat_code text not null check (vat_code in ('exempt', 'standard', 'reduced', 'zero')),
  low_stock_at integer check (low_stock_at is null or low_stock_at >= 0),
  active integer not null default 1 check (active in (0, 1)),
  updated_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id) references public.pms_billing_settings (tenant_id) on delete cascade
);

create unique index if not exists pms_products_sku on public.pms_products (tenant_id, sku) where sku is not null;
create index if not exists pms_products_name on public.pms_products (tenant_id, active, name);

alter table public.pms_products enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_products from %I', r);
    end if;
  end loop;
end;
$$;
