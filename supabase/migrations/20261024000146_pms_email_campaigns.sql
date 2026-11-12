-- ClinForms 0146 (Postgres / Supabase): clinic system, comms - BULK EMAIL to groups of patients (tracker xt02),
-- behind CLINFORMS_BULK_EMAIL=on and a per-clinic setting that is off by default. Settings per clinic, campaigns
-- (subject and body encrypted per clinic), and the recipients written when a campaign starts (one per address).
-- Campaigns cascade from the settings row, recipients from their campaign, patient and message (offboarding).
-- Kept in step with db/migrations/sqlite/0146_pms_email_campaigns.sql (db/parity.test.ts).
-- RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_bulk_email_settings (
  tenant_id text not null primary key,
  rev integer not null default 1 check (rev > 0),
  enabled integer not null default 0 check (enabled in (0, 1)),
  daily_cap integer not null default 500 check (daily_cap between 1 and 5000),
  updated_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists public.pms_email_campaigns (
  tenant_id text not null,
  id text not null,
  rev integer not null check (rev > 0),
  name text not null check (length(name) between 1 and 120),
  purpose text not null check (purpose in ('marketing', 'service')),
  service_reason text check (service_reason is null or length(service_reason) between 1 and 300),
  subject_enc text not null,
  body_enc text not null,
  audience_json text not null,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sending', 'sent', 'cancelled')),
  scheduled_for timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  cancelled_at timestamptz,
  recipients_total integer not null default 0 check (recipients_total >= 0),
  created_by text,
  scheduled_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id) references public.pms_bulk_email_settings (tenant_id) on delete cascade,
  check (purpose = 'marketing' or service_reason is not null)
);
create index if not exists pms_email_campaigns_status on public.pms_email_campaigns (tenant_id, status, scheduled_for);
create index if not exists pms_email_campaigns_created on public.pms_email_campaigns (tenant_id, created_at);

create table if not exists public.pms_email_campaign_recipients (
  tenant_id text not null,
  id text not null,
  campaign_id text not null,
  patient_id text not null,
  address_key text not null check (length(address_key) between 3 and 254),
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'outbox', 'failed', 'skipped')),
  message_id text,
  skip_reason text,
  claim_token text,
  claimed_at timestamptz,
  sent_on text check (sent_on is null or sent_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, campaign_id) references public.pms_email_campaigns (tenant_id, id) on delete cascade,
  foreign key (tenant_id, patient_id) references public.pms_patients (tenant_id, id) on delete cascade,
  foreign key (tenant_id, message_id) references public.pms_messages (tenant_id, id) on delete cascade
);
create unique index if not exists pms_email_campaign_recipients_address on public.pms_email_campaign_recipients (tenant_id, campaign_id, address_key);
create unique index if not exists pms_email_campaign_recipients_patient on public.pms_email_campaign_recipients (tenant_id, campaign_id, patient_id);
create index if not exists pms_email_campaign_recipients_status on public.pms_email_campaign_recipients (tenant_id, campaign_id, status);
create index if not exists pms_email_campaign_recipients_claim on public.pms_email_campaign_recipients (tenant_id, claim_token);
create index if not exists pms_email_campaign_recipients_sent_on on public.pms_email_campaign_recipients (tenant_id, sent_on);
create index if not exists pms_email_campaign_recipients_message on public.pms_email_campaign_recipients (tenant_id, message_id);

alter table public.pms_bulk_email_settings enable row level security;
alter table public.pms_email_campaigns enable row level security;
alter table public.pms_email_campaign_recipients enable row level security;

do $$
declare
  r text;
  t text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      foreach t in array array['pms_bulk_email_settings', 'pms_email_campaigns', 'pms_email_campaign_recipients'] loop
        execute format('revoke all on table public.%I from %I', t, r);
      end loop;
    end if;
  end loop;
end;
$$;
