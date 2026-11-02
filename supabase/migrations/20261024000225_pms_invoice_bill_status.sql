-- ClinForms 0225 (Postgres / Supabase): clinic system, billing - Healthcode e-billing groundwork (HC13): an insurer
-- invoice's bill status (exported, validated, failed, collected, paid - set by hand for now). New table only (additive).
-- Kept in step with db/migrations/sqlite/0225_pms_invoice_bill_status.sql (db/parity.test.ts).
-- RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_invoice_bill_status (
  tenant_id text not null,
  invoice_id text not null,
  rev integer not null check (rev > 0),
  status text check (status is null or status in ('exported', 'validated', 'failed', 'collected', 'paid')),
  updated_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, invoice_id),
  foreign key (tenant_id, invoice_id) references public.pms_invoices (tenant_id, id)
);

alter table public.pms_invoice_bill_status enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_invoice_bill_status from %I', r);
    end if;
  end loop;
end;
$$;
