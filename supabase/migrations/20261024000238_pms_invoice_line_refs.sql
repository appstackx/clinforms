-- ClinForms 0238 (Postgres / Supabase): clinic system, billing - what an invoice line sells (a course, gift card or
-- product). New table only (additive).
-- Kept in step with db/migrations/sqlite/0238_pms_invoice_line_refs.sql (db/parity.test.ts).
-- RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_invoice_line_refs (
  tenant_id text not null,
  invoice_line_id text not null,
  ref_type text not null check (ref_type in ('course', 'gift_card', 'product')),
  ref_id text not null,
  created_at timestamptz not null,
  primary key (tenant_id, invoice_line_id),
  foreign key (tenant_id, invoice_line_id) references public.pms_invoice_lines (tenant_id, id) on delete cascade
);

create index if not exists pms_invoice_line_refs_ref on public.pms_invoice_line_refs (tenant_id, ref_type, ref_id);

alter table public.pms_invoice_line_refs enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_invoice_line_refs from %I', r);
    end if;
  end loop;
end;
$$;
