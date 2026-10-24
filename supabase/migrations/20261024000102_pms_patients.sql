-- ClinForms 0102 (Postgres / Supabase): clinic-system foundation, part 3 - the shared patient record: patients,
-- cases (episodes of care, each with its payer) and treatment authorisations. Kept in step with
-- db/migrations/sqlite/0102_pms_patients.sql (db/parity.test.ts). Demographics plain and indexed, free text
-- encrypted per clinic (_enc). Never deleted by the app or a scheduled job. RLS on, no policies, Data API roles
-- revoked. Idempotent.

create table if not exists public.pms_patients (
  tenant_id text not null,
  id text not null,
  rev integer not null check (rev > 0),
  patient_number integer not null check (patient_number > 0),
  title text,
  first_name text not null check (length(first_name) between 1 and 80),
  last_name text not null check (length(last_name) between 1 and 80),
  preferred_name text,
  date_of_birth text check (date_of_birth is null or date_of_birth ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  sex text check (sex is null or sex in ('female', 'male', 'other', 'unknown')),
  email text,
  phone_mobile text,
  phone_home text,
  phone_work text,
  address_json text,
  postcode text,
  occupation text,
  employer text,
  emergency_name text,
  emergency_phone text,
  emergency_relationship text,
  gp_name text,
  gp_practice text,
  gp_phone text,
  gp_address_json text,
  gp_postcode text,
  consent_treatment integer not null default 0 check (consent_treatment in (0, 1)),
  consent_treatment_at timestamptz,
  consent_share_gp integer not null default 0 check (consent_share_gp in (0, 1)),
  reminder_sms integer not null default 1 check (reminder_sms in (0, 1)),
  reminder_email integer not null default 1 check (reminder_email in (0, 1)),
  marketing_email integer not null default 0 check (marketing_email in (0, 1)),
  marketing_sms integer not null default 0 check (marketing_sms in (0, 1)),
  marketing_consent_at timestamptz,
  marketing_consent_source text check (marketing_consent_source is null or marketing_consent_source in ('verbal', 'written', 'online', 'import')),
  alerts_enc text,
  notes_enc text,
  search_name text not null,
  search_phone text not null,
  status text not null default 'active' check (status in ('active', 'archived', 'deceased')),
  legal_hold integer not null default 0 check (legal_hold in (0, 1)),
  last_seen_on text check (last_seen_on is null or last_seen_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  merged_into_id text,
  archived_at timestamptz,
  import_ref text,
  created_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, merged_into_id) references public.pms_patients (tenant_id, id)
);
create unique index if not exists pms_patients_number on public.pms_patients (tenant_id, patient_number);
create unique index if not exists pms_patients_import_ref on public.pms_patients (tenant_id, import_ref);
create index if not exists pms_patients_search_name on public.pms_patients (tenant_id, search_name);
create index if not exists pms_patients_dob on public.pms_patients (tenant_id, date_of_birth);
create index if not exists pms_patients_last_name on public.pms_patients (tenant_id, last_name, first_name);

create table if not exists public.pms_cases (
  tenant_id text not null,
  id text not null,
  rev integer not null check (rev > 0),
  patient_id text not null,
  title text not null check (length(title) between 1 and 120),
  status text not null default 'open' check (status in ('open', 'discharged', 'closed')),
  opened_on text not null check (opened_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  closed_on text check (closed_on is null or closed_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  practitioner_id text,
  site_id text,
  payer_type text not null default 'self_pay' check (payer_type in ('self_pay', 'insurer', 'mlc', 'solicitor', 'employer', 'other')),
  payer_referrer_id text,
  membership_number text,
  claim_reference text,
  excess_pence integer check (excess_pence is null or excess_pence >= 0),
  price_list_id text,
  referrer_id text,
  referral_received_on text,
  injury_on text,
  referral_reason_enc text,
  notes_enc text,
  import_ref text,
  created_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, patient_id) references public.pms_patients (tenant_id, id),
  foreign key (tenant_id, practitioner_id) references public.pms_practitioners (tenant_id, id),
  foreign key (tenant_id, site_id) references public.pms_sites (tenant_id, id),
  foreign key (tenant_id, payer_referrer_id) references public.pms_referrers (tenant_id, id),
  foreign key (tenant_id, price_list_id) references public.pms_price_lists (tenant_id, id),
  foreign key (tenant_id, referrer_id) references public.pms_referrers (tenant_id, id)
);
create unique index if not exists pms_cases_patient on public.pms_cases (tenant_id, patient_id, id);
create unique index if not exists pms_cases_import_ref on public.pms_cases (tenant_id, import_ref);
create index if not exists pms_cases_status on public.pms_cases (tenant_id, status, opened_on);
create index if not exists pms_cases_payer on public.pms_cases (tenant_id, payer_referrer_id);

create table if not exists public.pms_authorisations (
  tenant_id text not null,
  id text not null,
  rev integer not null check (rev > 0),
  case_id text not null,
  patient_id text not null,
  referrer_id text,
  code text not null check (length(code) between 1 and 60),
  sessions_authorised integer check (sessions_authorised is null or sessions_authorised >= 0),
  value_authorised_pence integer check (value_authorised_pence is null or value_authorised_pence >= 0),
  sessions_used integer not null default 0 check (sessions_used >= 0),
  value_used_pence integer not null default 0 check (value_used_pence >= 0),
  valid_from text,
  expires_on text,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  notes_enc text,
  import_ref text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, patient_id, case_id) references public.pms_cases (tenant_id, patient_id, id),
  foreign key (tenant_id, referrer_id) references public.pms_referrers (tenant_id, id)
);
create unique index if not exists pms_authorisations_case_code on public.pms_authorisations (tenant_id, case_id, code);
create unique index if not exists pms_authorisations_import_ref on public.pms_authorisations (tenant_id, import_ref);
create index if not exists pms_authorisations_patient on public.pms_authorisations (tenant_id, patient_id);
create index if not exists pms_authorisations_expires on public.pms_authorisations (tenant_id, expires_on);

alter table public.pms_patients enable row level security;
alter table public.pms_cases enable row level security;
alter table public.pms_authorisations enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_patients, public.pms_cases, public.pms_authorisations from %I', r);
    end if;
  end loop;
end;
$$;
