-- ClinForms 0239 (Postgres / Supabase): clinic system, billing - a patient's card kept on file with the clinic's
-- connected account, and the patient's CONSENT to it (cp04). Only the provider's references and what a receipt shows
-- (brand, last 4 digits, expiry) - never a card number. consent_wording = the exact words agreed to, consent_version,
-- consent_channel (portal / desk / phone), consent_recorded_by (the member who recorded it, NULL = the patient in the
-- portal), consent_at. allows_no_show = the patient also agreed to missed-appointment charges. Status pending (the
-- card form is open) / active / removed / failed. Removed by status, never deleted. Hangs off pms_card_settings and
-- the patient (ON DELETE CASCADE, offboarding only).
-- Kept in step with db/migrations/sqlite/0239_pms_card_mandates.sql (db/parity.test.ts).
-- RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_card_mandates (
  tenant_id text not null,
  id text not null,
  patient_id text not null,
  status text not null default 'pending' check (status in ('pending', 'active', 'removed', 'failed')),
  customer_ref text not null,
  method_ref text,
  setup_ref text,
  brand text check (brand is null or length(brand) between 1 and 20),
  last4 text check (last4 is null or length(last4) = 4),
  exp_month integer check (exp_month is null or exp_month between 1 and 12),
  exp_year integer check (exp_year is null or exp_year between 2000 and 2100),
  consent_wording text not null check (length(consent_wording) between 20 and 2000),
  consent_version text not null,
  consent_channel text not null check (consent_channel in ('portal', 'desk', 'phone')),
  consent_recorded_by text,
  consent_at timestamptz not null,
  allows_no_show integer not null default 0 check (allows_no_show in (0, 1)),
  removed_at timestamptz,
  removed_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id) references public.pms_card_settings (tenant_id) on delete cascade,
  foreign key (tenant_id, patient_id) references public.pms_patients (tenant_id, id) on delete cascade
);
create unique index if not exists pms_card_mandates_setup on public.pms_card_mandates (tenant_id, setup_ref);
create index if not exists pms_card_mandates_patient on public.pms_card_mandates (tenant_id, patient_id, status);

alter table public.pms_card_mandates enable row level security;

do $$
declare
  r text;
  t text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      foreach t in array array['pms_card_mandates'] loop
        execute format('revoke all on table public.%I from %I', t, r);
      end loop;
    end if;
  end loop;
end;
$$;
