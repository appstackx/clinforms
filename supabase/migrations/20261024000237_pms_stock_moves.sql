-- ClinForms 0237 (Postgres / Supabase): clinic system, billing - stock (PK05): append-only stock moves per product and
-- site (received, sold, returned, adjusted). New table only (additive).
-- Kept in step with db/migrations/sqlite/0237_pms_stock_moves.sql (db/parity.test.ts).
-- RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_stock_moves (
  tenant_id text not null,
  id text not null,
  product_id text not null,
  site_id text not null,
  kind text not null check (kind in ('received', 'sold', 'returned', 'adjusted')),
  quantity integer not null check (quantity <> 0),
  invoice_line_id text,
  reason_enc text,
  created_by text,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  check ((kind in ('received', 'returned') and quantity > 0) or (kind = 'sold' and quantity < 0) or kind = 'adjusted'),
  foreign key (tenant_id, product_id) references public.pms_products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, site_id) references public.pms_sites (tenant_id, id) on delete cascade,
  foreign key (tenant_id, invoice_line_id) references public.pms_invoice_lines (tenant_id, id) on delete cascade
);

create unique index if not exists pms_stock_moves_line on public.pms_stock_moves (tenant_id, invoice_line_id, kind) where invoice_line_id is not null;
create index if not exists pms_stock_moves_site on public.pms_stock_moves (tenant_id, site_id, product_id);
create index if not exists pms_stock_moves_created on public.pms_stock_moves (tenant_id, site_id, created_at);

alter table public.pms_stock_moves enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_stock_moves from %I', r);
    end if;
  end loop;
end;
$$;
