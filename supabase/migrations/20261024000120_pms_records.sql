-- ClinForms 0120 (Postgres / Supabase): clinic system, records module - note templates, clinical notes and their
-- amendments, outcome measures, attached files (encrypted in chunks) and patient anonymisations. Kept in step with
-- db/migrations/sqlite/0120_pms_records.sql (db/parity.test.ts). Composite (tenant_id, id) keys, foreign keys that
-- include tenant_id and the patient. Calendar dates are text YYYY-MM-DD (as on D1). RLS on, no policies, Data API
-- roles revoked. Idempotent.

create table if not exists public.pms_note_templates (
  tenant_id text not null,
  id text not null,
  rev integer not null check (rev > 0),
  name text not null check (length(name) between 1 and 80),
  note_type text not null check (note_type in ('initial', 'follow_up', 'discharge', 'general')),
  sections_json text not null,
  body_chart integer not null default 0 check (body_chart in (0, 1)),
  active integer not null default 1 check (active in (0, 1)),
  sort_order integer not null default 100,
  based_on text,
  created_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id)
);
create unique index if not exists pms_note_templates_name on public.pms_note_templates (tenant_id, name);

create table if not exists public.pms_clinical_notes (
  tenant_id text not null,
  id text not null,
  rev integer not null check (rev > 0),
  patient_id text not null,
  case_id text,
  template_id text not null,
  template_name text not null,
  note_type text not null check (note_type in ('initial', 'follow_up', 'discharge', 'general')),
  template_json text not null,
  seen_on text not null check (seen_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  practitioner_id text,
  author_user_id text,
  author_name text,
  status text not null default 'draft' check (status in ('draft', 'signed', 'discarded')),
  sections_enc text,
  body_chart_enc text,
  content_hash text,
  signed_at timestamptz,
  signed_by_user_id text,
  signed_by_name text,
  signed_registration text,
  entered_in_error integer not null default 0 check (entered_in_error in (0, 1)),
  amendment_count integer not null default 0 check (amendment_count >= 0),
  discarded_at timestamptz,
  anonymised_at timestamptz,
  import_ref text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  check (status <> 'signed' or (signed_at is not null and content_hash is not null)),
  primary key (tenant_id, id),
  foreign key (tenant_id, patient_id) references public.pms_patients (tenant_id, id),
  foreign key (tenant_id, patient_id, case_id) references public.pms_cases (tenant_id, patient_id, id),
  foreign key (tenant_id, practitioner_id) references public.pms_practitioners (tenant_id, id)
);
create unique index if not exists pms_clinical_notes_patient_id on public.pms_clinical_notes (tenant_id, patient_id, id);
create unique index if not exists pms_clinical_notes_import_ref on public.pms_clinical_notes (tenant_id, import_ref);
create index if not exists pms_clinical_notes_patient_seen on public.pms_clinical_notes (tenant_id, patient_id, seen_on);
create index if not exists pms_clinical_notes_case on public.pms_clinical_notes (tenant_id, case_id);
create index if not exists pms_clinical_notes_author on public.pms_clinical_notes (tenant_id, author_user_id, status);

create table if not exists public.pms_note_amendments (
  tenant_id text not null,
  id text not null,
  note_id text not null,
  patient_id text not null,
  kind text not null check (kind in ('addendum', 'correction', 'entered_in_error')),
  section_key text,
  text_enc text,
  reason_enc text,
  author_user_id text,
  author_name text,
  author_registration text,
  anonymised_at timestamptz,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, patient_id, note_id) references public.pms_clinical_notes (tenant_id, patient_id, id)
);
create index if not exists pms_note_amendments_note on public.pms_note_amendments (tenant_id, note_id, id);
create index if not exists pms_note_amendments_patient on public.pms_note_amendments (tenant_id, patient_id);

create table if not exists public.pms_outcome_measures (
  tenant_id text not null,
  id text not null,
  rev integer not null check (rev > 0),
  patient_id text not null,
  case_id text,
  note_id text,
  measure text not null check (measure in ('ndi', 'odi', 'nprs', 'psfs', 'quickdash')),
  taken_on text not null check (taken_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  score_tenths integer not null check (score_tenths between 0 and 1000),
  band text,
  answered integer not null check (answered >= 0),
  answers_enc text,
  status text not null default 'recorded' check (status in ('recorded', 'entered_in_error')),
  error_reason_enc text,
  error_at timestamptz,
  recorded_by text,
  anonymised_at timestamptz,
  import_ref text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, patient_id) references public.pms_patients (tenant_id, id),
  foreign key (tenant_id, patient_id, case_id) references public.pms_cases (tenant_id, patient_id, id),
  foreign key (tenant_id, patient_id, note_id) references public.pms_clinical_notes (tenant_id, patient_id, id)
);
create unique index if not exists pms_outcome_measures_import_ref on public.pms_outcome_measures (tenant_id, import_ref);
create index if not exists pms_outcome_measures_patient on public.pms_outcome_measures (tenant_id, patient_id, measure, taken_on);

create table if not exists public.pms_attachments (
  tenant_id text not null,
  id text not null,
  patient_id text not null,
  note_id text,
  case_id text,
  file_type text not null check (file_type in ('pdf', 'jpeg', 'png', 'docx')),
  mime_type text not null,
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 4000000),
  sha256 text not null check (length(sha256) = 64),
  chunk_count integer not null check (chunk_count > 0),
  file_name_enc text,
  description_enc text,
  status text not null default 'active' check (status in ('active', 'withdrawn')),
  withdrawn_at timestamptz,
  withdrawn_by text,
  withdrawn_reason_enc text,
  uploaded_by text,
  anonymised_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, patient_id) references public.pms_patients (tenant_id, id),
  foreign key (tenant_id, patient_id, note_id) references public.pms_clinical_notes (tenant_id, patient_id, id),
  foreign key (tenant_id, patient_id, case_id) references public.pms_cases (tenant_id, patient_id, id)
);
create index if not exists pms_attachments_patient on public.pms_attachments (tenant_id, patient_id, created_at);

create table if not exists public.pms_attachment_chunks (
  tenant_id text not null,
  id text not null,
  attachment_id text not null,
  idx integer not null check (idx >= 0),
  data_enc text,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, attachment_id) references public.pms_attachments (tenant_id, id)
);
create unique index if not exists pms_attachment_chunks_idx on public.pms_attachment_chunks (tenant_id, attachment_id, idx);

create table if not exists public.pms_patient_anonymisations (
  tenant_id text not null,
  id text not null,
  patient_id text not null,
  status text not null check (status in ('started', 'done')),
  started_at timestamptz not null,
  done_at timestamptz,
  by_user_id text,
  counts_json text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, patient_id) references public.pms_patients (tenant_id, id)
);
create unique index if not exists pms_patient_anonymisations_patient on public.pms_patient_anonymisations (tenant_id, patient_id);

alter table public.pms_note_templates enable row level security;
alter table public.pms_clinical_notes enable row level security;
alter table public.pms_note_amendments enable row level security;
alter table public.pms_outcome_measures enable row level security;
alter table public.pms_attachments enable row level security;
alter table public.pms_attachment_chunks enable row level security;
alter table public.pms_patient_anonymisations enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_note_templates, public.pms_clinical_notes, public.pms_note_amendments, public.pms_outcome_measures, public.pms_attachments, public.pms_attachment_chunks, public.pms_patient_anonymisations from %I', r);
    end if;
  end loop;
end;
$$;
