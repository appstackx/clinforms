-- ClinForms 0240 (Postgres / Supabase): clinic system, billing - membership plans (pk03): a name, a monthly price
-- in pence and its VAT code. Switched off, never deleted. Hangs off pms_card_settings (ON DELETE CASCADE, offboarding).
-- Kept in step with db/migrations/sqlite/0240_pms_membership_plans.sql (db/parity.test.ts).
-- RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_membership_plans (
  tenant_id text not null,
  id text not null,
  rev integer not null default 1 check (rev > 0),
  name text not null check (length(name) between 1 and 80),
  price_pence integer not null check (price_pence between 30 and 100000),
  vat_code text not null default 'exempt' check (vat_code in ('exempt', 'standard', 'reduced', 'zero')),
  active integer not null default 1 check (active in (0, 1)),
  created_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id) references public.pms_card_settings (tenant_id) on delete cascade
);
create unique index if not exists pms_membership_plans_name on public.pms_membership_plans (tenant_id, name);

alter table public.pms_membership_plans enable row level security;

do $$
declare
  r text;
  t text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      foreach t in array array['pms_membership_plans'] loop
        execute format('revoke all on table public.%I from %I', t, r);
      end loop;
    end if;
  end loop;
end;
$$;
