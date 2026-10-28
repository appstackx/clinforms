-- ClinForms 0140 (Postgres / Supabase): clinic system, comms module part 1 - message settings, message
-- templates, reminder rules, the message log (outbox, sent messages, replies), planned appointment messages and
-- the record of how patients' message preferences changed (PECR evidence). Kept in step with
-- db/migrations/sqlite/0140_pms_comms.sql (db/parity.test.ts). Message text encrypted per clinic (_enc),
-- templates plain. appointment_id has no foreign key (the diary hands comms a snapshot). Never deleted by the
-- app. RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_comms_settings (
  tenant_id text not null primary key,
  rev integer not null default 1 check (rev > 0),
  confirmations_sms integer not null default 1 check (confirmations_sms in (0, 1)),
  confirmations_email integer not null default 1 check (confirmations_email in (0, 1)),
  change_notices integer not null default 1 check (change_notices in (0, 1)),
  dna_follow_up integer not null default 1 check (dna_follow_up in (0, 1)),
  sms_sender text check (sms_sender is null or length(sms_sender) between 3 and 11),
  reply_phone text,
  reply_email text,
  replies_enabled integer not null default 1 check (replies_enabled in (0, 1)),
  quiet_start text not null default '20:00' check (quiet_start ~ '^[0-2][0-9]:[0-5][0-9]$'),
  quiet_end text not null default '08:00' check (quiet_end ~ '^[0-2][0-9]:[0-5][0-9]$'),
  updated_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists public.pms_message_templates (
  tenant_id text not null,
  id text not null,
  rev integer not null check (rev > 0),
  kind text not null check (kind in ('confirmation', 'reminder', 'moved', 'cancelled', 'late_cancelled', 'dna', 'offer', 'general', 'marketing', 'payment_link', 'invoice', 'receipt', 'statement', 'letter', 'portal_link')),
  channel text not null check (channel in ('sms', 'email')),
  name text not null check (length(name) between 1 and 120),
  subject text check (subject is null or length(subject) <= 200),
  body text not null check (length(body) between 1 and 8000),
  is_default integer not null default 0 check (is_default in (0, 1)),
  active integer not null default 1 check (active in (0, 1)),
  import_ref text,
  created_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id)
);
create unique index if not exists pms_message_templates_name on public.pms_message_templates (tenant_id, name);
create unique index if not exists pms_message_templates_import_ref on public.pms_message_templates (tenant_id, import_ref);
create unique index if not exists pms_message_templates_default on public.pms_message_templates (tenant_id, kind, channel) where is_default = 1;

create table if not exists public.pms_reminder_rules (
  tenant_id text not null,
  id text not null,
  rev integer not null check (rev > 0),
  name text not null check (length(name) between 1 and 80),
  channel text not null check (channel in ('sms', 'email')),
  timing text not null check (timing in ('hours_before', 'days_before')),
  hours_before integer check (hours_before is null or hours_before between 1 and 168),
  days_before integer check (days_before is null or days_before between 1 and 14),
  send_at text check (send_at is null or send_at ~ '^[0-2][0-9]:[0-5][0-9]$'),
  template_id text,
  service_ids_json text,
  active integer not null default 1 check (active in (0, 1)),
  created_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, template_id) references public.pms_message_templates (tenant_id, id)
);
create unique index if not exists pms_reminder_rules_name on public.pms_reminder_rules (tenant_id, name);

create table if not exists public.pms_messages (
  tenant_id text not null,
  id text not null,
  patient_id text,
  direction text not null check (direction in ('outbound', 'inbound')),
  channel text not null check (channel in ('sms', 'email')),
  purpose text not null check (purpose in ('service', 'marketing')),
  kind text not null check (kind in ('confirmation', 'reminder', 'moved', 'cancelled', 'late_cancelled', 'dna', 'offer', 'general', 'marketing', 'payment_link', 'invoice', 'receipt', 'statement', 'letter', 'portal_link', 'reply')),
  template_id text,
  appointment_id text,
  in_reply_to_id text,
  to_address text,
  from_address text,
  address_key text,
  subject_enc text,
  body_enc text not null,
  segments integer check (segments is null or segments >= 0),
  status text not null check (status in ('queued', 'outbox', 'sent', 'delivered', 'failed', 'received')),
  provider text not null check (length(provider) between 1 and 20),
  provider_message_id text,
  error_code text,
  reply_intent text check (reply_intent is null or reply_intent in ('confirm', 'cancel', 'stop', 'unknown')),
  action_status text not null default 'none' check (action_status in ('none', 'to_action', 'done')),
  actioned_by text,
  actioned_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  document_type text check (document_type is null or document_type in ('letter', 'invoice', 'receipt', 'statement')),
  document_id text,
  attempts integer not null default 1 check (attempts >= 1),
  created_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, patient_id) references public.pms_patients (tenant_id, id),
  foreign key (tenant_id, template_id) references public.pms_message_templates (tenant_id, id),
  foreign key (tenant_id, in_reply_to_id) references public.pms_messages (tenant_id, id)
);
create index if not exists pms_messages_patient on public.pms_messages (tenant_id, patient_id, id);
create index if not exists pms_messages_address on public.pms_messages (tenant_id, address_key, created_at);
create index if not exists pms_messages_action on public.pms_messages (tenant_id, action_status, id);
create index if not exists pms_messages_appointment on public.pms_messages (tenant_id, appointment_id);
create index if not exists pms_messages_status on public.pms_messages (tenant_id, status, id);
create index if not exists pms_messages_document on public.pms_messages (tenant_id, document_type, document_id);
create unique index if not exists pms_messages_provider_id on public.pms_messages (tenant_id, provider, provider_message_id);

create table if not exists public.pms_message_schedule (
  tenant_id text not null,
  id text not null,
  appointment_id text not null,
  patient_id text not null,
  kind text not null check (kind in ('confirmation', 'reminder', 'moved', 'cancelled', 'late_cancelled', 'dna')),
  channel text not null check (channel in ('sms', 'email')),
  rule_id text,
  dedupe_key text not null check (length(dedupe_key) <= 200),
  due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'skipped', 'cancelled', 'failed')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  site_id text,
  practitioner_id text,
  service_id text,
  message_id text,
  skip_reason text,
  claim_token text,
  claimed_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  held integer not null default 0 check (held in (0, 1)),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, patient_id) references public.pms_patients (tenant_id, id),
  foreign key (tenant_id, rule_id) references public.pms_reminder_rules (tenant_id, id),
  foreign key (tenant_id, site_id) references public.pms_sites (tenant_id, id),
  foreign key (tenant_id, practitioner_id) references public.pms_practitioners (tenant_id, id),
  foreign key (tenant_id, service_id) references public.pms_services (tenant_id, id),
  foreign key (tenant_id, message_id) references public.pms_messages (tenant_id, id)
);
create unique index if not exists pms_message_schedule_dedupe on public.pms_message_schedule (tenant_id, appointment_id, dedupe_key);
create index if not exists pms_message_schedule_due on public.pms_message_schedule (tenant_id, status, due_at);
create index if not exists pms_message_schedule_patient on public.pms_message_schedule (tenant_id, patient_id);
create index if not exists pms_message_schedule_claim on public.pms_message_schedule (tenant_id, claim_token);

create table if not exists public.pms_consent_events (
  tenant_id text not null,
  id text not null,
  patient_id text not null,
  channel text not null check (channel in ('sms', 'email')),
  purpose text not null check (purpose in ('service', 'marketing')),
  action text not null check (action in ('opt_in', 'opt_out')),
  source text not null check (source in ('staff', 'sms_reply', 'email_link', 'import', 'portal')),
  message_id text,
  created_by text,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, patient_id) references public.pms_patients (tenant_id, id),
  foreign key (tenant_id, message_id) references public.pms_messages (tenant_id, id)
);
create index if not exists pms_consent_events_patient on public.pms_consent_events (tenant_id, patient_id, id);

alter table public.pms_comms_settings enable row level security;
alter table public.pms_message_templates enable row level security;
alter table public.pms_reminder_rules enable row level security;
alter table public.pms_messages enable row level security;
alter table public.pms_message_schedule enable row level security;
alter table public.pms_consent_events enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_comms_settings, public.pms_message_templates, public.pms_reminder_rules, public.pms_messages, public.pms_message_schedule, public.pms_consent_events from %I', r);
    end if;
  end loop;
end;
$$;
