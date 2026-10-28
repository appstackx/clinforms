-- ClinForms 0152 (Postgres / Supabase): clinic system, portal module part 3 - intake and consent forms: the
-- clinic's form templates and each patient's copy (snapshot of the form, answers and typed name encrypted, the
-- SHA-256 of what was signed). A completed copy is sealed by a trigger (check-violation 23514, constraint
-- pms_intake_responses_sealed - the same words D1 reports). Kept in step with
-- db/migrations/sqlite/0152_portal_intake.sql (db/parity.test.ts). RLS on, no policies, Data API roles revoked.
-- Idempotent.
-- Outcome questionnaires (kind outcome, measure set) have no template; their score lands in
-- pms_outcome_measures (outcome_id). A copy sent for an appointment points at pms_appointments.

create table if not exists public.pms_intake_templates (
  tenant_id text not null,
  id text not null,
  rev integer not null default 1 check (rev > 0),
  version integer not null default 1 check (version > 0),
  name text not null check (length(name) between 1 and 120),
  kind text not null check (kind in ('intake', 'questionnaire', 'consent', 'outcome')),
  description text,
  status text not null default 'active' check (status in ('draft', 'active', 'archived')),
  send_when text not null default 'manual' check (send_when in ('manual', 'new_patient', 'every_booking')),
  requires_signature integer not null default 0 check (requires_signature in (0, 1)),
  signature_statement text,
  sets_treatment_consent integer not null default 0 check (sets_treatment_consent in (0, 1)),
  definition_json text not null,
  created_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id)
);
create unique index if not exists pms_intake_templates_name on public.pms_intake_templates (tenant_id, name);

create table if not exists public.pms_intake_responses (
  tenant_id text not null,
  id text not null,
  rev integer not null default 1 check (rev > 0),
  template_id text,
  template_version integer not null check (template_version > 0),
  name text not null,
  kind text not null check (kind in ('intake', 'questionnaire', 'consent', 'outcome')),
  patient_id text not null,
  appointment_id text,
  measure text check (measure is null or measure in ('ndi', 'odi', 'nprs', 'psfs', 'quickdash')),
  case_id text,
  outcome_id text,
  status text not null default 'requested' check (status in ('requested', 'submitted', 'cancelled')),
  form_json text not null,
  requires_signature integer not null default 0 check (requires_signature in (0, 1)),
  signature_statement text,
  sets_treatment_consent integer not null default 0 check (sets_treatment_consent in (0, 1)),
  answers_enc text,
  signature_name_enc text,
  signed_at timestamptz,
  trust text check (trust is null or trust in ('verified', 'unverified')),
  content_sha256 text check (content_sha256 is null or length(content_sha256) = 64),
  requested_by text,
  requested_at timestamptz not null,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by text,
  applied_at timestamptz,
  applied_by text,
  cancelled_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, template_id) references public.pms_intake_templates (tenant_id, id),
  foreign key (tenant_id, patient_id) references public.pms_patients (tenant_id, id),
  foreign key (tenant_id, appointment_id) references public.pms_appointments (tenant_id, id),
  foreign key (tenant_id, patient_id, case_id) references public.pms_cases (tenant_id, patient_id, id),
  foreign key (tenant_id, outcome_id) references public.pms_outcome_measures (tenant_id, id),
  check ((kind = 'outcome') = (measure is not null)),
  check (kind = 'outcome' or template_id is not null),
  check (status <> 'submitted' or (answers_enc is not null and submitted_at is not null and content_sha256 is not null)),
  check (requires_signature = 0 or status <> 'submitted' or (signature_name_enc is not null and signed_at is not null))
);
create index if not exists pms_intake_responses_patient on public.pms_intake_responses (tenant_id, patient_id, requested_at);
create index if not exists pms_intake_responses_status on public.pms_intake_responses (tenant_id, status, submitted_at);
create index if not exists pms_intake_responses_appointment on public.pms_intake_responses (tenant_id, appointment_id);

create or replace function public.pms_intake_responses_sealed() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if old.status = 'submitted' and (
    new.form_json is distinct from old.form_json or new.answers_enc is distinct from old.answers_enc
    or new.signature_name_enc is distinct from old.signature_name_enc or new.signed_at is distinct from old.signed_at
    or new.content_sha256 is distinct from old.content_sha256 or new.patient_id is distinct from old.patient_id
    or new.template_id is distinct from old.template_id or new.submitted_at is distinct from old.submitted_at
    or new.status is distinct from old.status
  ) then
    raise exception using
      errcode = '23514',
      message = 'new row for relation "pms_intake_responses" violates check constraint "pms_intake_responses_sealed"',
      constraint = 'pms_intake_responses_sealed';
  end if;
  return new;
end;
$$;
revoke all on function public.pms_intake_responses_sealed() from public;

drop trigger if exists pms_intake_responses_sealed on public.pms_intake_responses;
create trigger pms_intake_responses_sealed
  before update on public.pms_intake_responses
  for each row execute function public.pms_intake_responses_sealed();

alter table public.pms_intake_templates enable row level security;
alter table public.pms_intake_responses enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_intake_templates, public.pms_intake_responses from %I', r);
    end if;
  end loop;
end;
$$;
