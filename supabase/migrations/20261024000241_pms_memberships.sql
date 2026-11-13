-- ClinForms 0241 (Postgres / Supabase): clinic system, billing - a patient's membership (pk03), charged every
-- month to a saved card by the clinic system's own daily run (an invoice, then the charge - one per month, the
-- unique period in pms_card_intents). charge_day 1-28, next_charge_on, attempts (failed tries this period), status
-- active / payment_failed / cancelled. The patient's consent to the monthly charge: consent_wording (exact words),
-- consent_channel, consent_recorded_by, consent_at. Hangs off pms_card_settings, the patient, the plan and the
-- saved card (ON DELETE CASCADE, offboarding only).
-- Kept in step with db/migrations/sqlite/0241_pms_memberships.sql (db/parity.test.ts).
-- RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_memberships (
  tenant_id text not null,
  id text not null,
  rev integer not null default 1 check (rev > 0),
  patient_id text not null,
  plan_id text not null,
  mandate_id text not null,
  site_id text,
  status text not null default 'active' check (status in ('active', 'payment_failed', 'cancelled')),
  charge_day integer not null check (charge_day between 1 and 28),
  started_on text not null check (started_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  next_charge_on text check (next_charge_on is null or next_charge_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  attempts integer not null default 0 check (attempts >= 0),
  consent_wording text not null check (length(consent_wording) between 20 and 2000),
  consent_channel text not null check (consent_channel in ('portal', 'desk', 'phone')),
  consent_recorded_by text,
  consent_at timestamptz not null,
  cancelled_at timestamptz,
  cancelled_by text,
  created_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id) references public.pms_card_settings (tenant_id) on delete cascade,
  foreign key (tenant_id, patient_id) references public.pms_patients (tenant_id, id) on delete cascade,
  foreign key (tenant_id, plan_id) references public.pms_membership_plans (tenant_id, id) on delete cascade,
  foreign key (tenant_id, mandate_id) references public.pms_card_mandates (tenant_id, id) on delete cascade
);
create index if not exists pms_memberships_due on public.pms_memberships (tenant_id, status, next_charge_on);
create index if not exists pms_memberships_patient on public.pms_memberships (tenant_id, patient_id);

alter table public.pms_memberships enable row level security;

do $$
declare
  r text;
  t text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      foreach t in array array['pms_memberships'] loop
        execute format('revoke all on table public.%I from %I', t, r);
      end loop;
    end if;
  end loop;
end;
$$;
