-- ClinForms 0226 (Postgres / Supabase): clinic system, billing - card payments through the clinic's OWN connected
-- payment account (docs/clinic-system/card-payments.md, cp01-cp09). Behind the platform switch
-- CLINFORMS_CARD_PAYMENTS=on AND this per-clinic setting (enabled), both off by default.
-- pms_card_settings: one row per clinic. account_ref = the provider's connected account id (acct_...), unique across
--   clinics (the webhook finds the clinic by it). account_mode = the key mode it was made with (test / live).
--   account_status / card_capability / payouts_capability / requirements_due = the provider's answer at last_synced_at.
--   fee_bps + fee_fixed_pence = the platform fee on each payment (0 by default - owner's decision).
--   no_show_enabled + no_show_policy = whether missed-appointment fees may be charged to saved cards, and the policy
--   wording the patient agrees to. Hangs off the clinic's pms_billing_settings row (ON DELETE CASCADE, offboarding only).
-- Kept in step with db/migrations/sqlite/0226_pms_card_settings.sql (db/parity.test.ts).
-- RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_card_settings (
  tenant_id text not null primary key,
  rev integer not null default 1 check (rev > 0),
  enabled integer not null default 0 check (enabled in (0, 1)),
  account_ref text check (account_ref is null or length(account_ref) between 8 and 64),
  account_mode text check (account_mode is null or account_mode in ('test', 'live')),
  account_status text not null default 'none' check (account_status in ('none', 'pending', 'active', 'restricted', 'closed')),
  card_capability text,
  payouts_capability text,
  requirements_due integer not null default 0 check (requirements_due >= 0),
  last_synced_at timestamptz,
  fee_bps integer not null default 0 check (fee_bps between 0 and 1000),
  fee_fixed_pence integer not null default 0 check (fee_fixed_pence between 0 and 500),
  no_show_enabled integer not null default 0 check (no_show_enabled in (0, 1)),
  no_show_policy text check (no_show_policy is null or length(no_show_policy) <= 500),
  updated_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  foreign key (tenant_id) references public.pms_billing_settings (tenant_id) on delete cascade
);
create unique index if not exists pms_card_settings_account on public.pms_card_settings (account_ref);

alter table public.pms_card_settings enable row level security;

do $$
declare
  r text;
  t text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      foreach t in array array['pms_card_settings'] loop
        execute format('revoke all on table public.%I from %I', t, r);
      end loop;
    end if;
  end loop;
end;
$$;
