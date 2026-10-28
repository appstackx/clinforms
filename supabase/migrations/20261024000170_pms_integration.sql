-- ClinForms 0170 (Postgres / Supabase): clinic system, integration module - data import from an earlier system
-- (batches and their staged rows), "Complete referrer form" requests from a case, and completed referrer forms
-- filed back to the patient's record (file in encrypted parts). Kept in step with
-- db/migrations/sqlite/0170_pms_integration.sql (db/parity.test.ts). Staged rows encrypted and wiped once used.
-- Filed forms never deleted by the app. RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_import_batches (
  tenant_id text not null,
  id text not null,
  rev integer not null check (rev > 0),
  kind text not null check (kind in ('patients', 'cases', 'appointments', 'invoices')),
  status text not null check (status in ('uploading', 'mapping', 'checking', 'checked', 'approved', 'importing', 'imported', 'undoing', 'undone', 'cancelled')),
  file_name_enc text,
  file_sha256 text check (file_sha256 is null or length(file_sha256) = 64),
  delimiter text not null default ',' check (delimiter in (',', ';', 'tab')),
  headers_enc text,
  column_count integer not null check (column_count between 1 and 200),
  expected_rows integer not null check (expected_rows between 0 and 100000),
  row_count integer not null default 0 check (row_count >= 0),
  mapping_json text,
  counts_json text,
  lease_until timestamptz,
  directory_added_json text,
  created_by text,
  checked_by text,
  checked_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  imported_by text,
  imported_at timestamptz,
  undone_by text,
  undone_at timestamptz,
  cancelled_by text,
  cancelled_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id)
);
create index if not exists pms_import_batches_created on public.pms_import_batches (tenant_id, created_at);
create index if not exists pms_import_batches_status on public.pms_import_batches (tenant_id, status);

create table if not exists public.pms_import_rows (
  tenant_id text not null,
  id text not null,
  batch_id text not null,
  row_no integer not null check (row_no > 0),
  data_enc text,
  source_ref text check (source_ref is null or length(source_ref) between 1 and 80),
  status text not null default 'staged' check (status in ('staged', 'ready', 'error', 'duplicate', 'imported', 'skipped', 'undone', 'kept')),
  issues_json text,
  patient_id text,
  case_id text,
  target_id text,
  target_rev integer check (target_rev is null or target_rev > 0),
  extra_json text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, batch_id) references public.pms_import_batches (tenant_id, id),
  foreign key (tenant_id, patient_id) references public.pms_patients (tenant_id, id),
  foreign key (tenant_id, case_id) references public.pms_cases (tenant_id, id)
);
create unique index if not exists pms_import_rows_batch_row on public.pms_import_rows (tenant_id, batch_id, row_no);
create index if not exists pms_import_rows_batch_status on public.pms_import_rows (tenant_id, batch_id, status, row_no);
create index if not exists pms_import_rows_batch_ref on public.pms_import_rows (tenant_id, batch_id, source_ref);
create index if not exists pms_import_rows_patient on public.pms_import_rows (tenant_id, patient_id);
create index if not exists pms_import_rows_case on public.pms_import_rows (tenant_id, case_id);
create index if not exists pms_import_rows_target on public.pms_import_rows (tenant_id, target_id);

create table if not exists public.pms_form_requests (
  tenant_id text not null,
  id text not null,
  patient_id text not null,
  case_id text not null,
  referrer_id text,
  consent_recorded integer not null default 0 check (consent_recorded in (0, 1)),
  consent_on text check (consent_on is null or consent_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  consent_note_enc text,
  form_ref text check (form_ref is null or length(form_ref) between 1 and 128),
  form_title text check (form_title is null or length(form_title) between 1 and 300),
  clinical_prefill integer not null default 0 check (clinical_prefill in (0, 1)),
  status text not null default 'opened' check (status in ('opened', 'filed')),
  filed_form_id text,
  filed_at timestamptz,
  requested_by text,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, patient_id, case_id) references public.pms_cases (tenant_id, patient_id, id),
  foreign key (tenant_id, referrer_id) references public.pms_referrers (tenant_id, id)
);
create index if not exists pms_form_requests_case on public.pms_form_requests (tenant_id, case_id, created_at);

create table if not exists public.pms_filed_forms (
  tenant_id text not null,
  id text not null,
  patient_id text not null,
  case_id text not null,
  title text not null check (length(title) between 1 and 300),
  file_name_enc text not null,
  mime_type text not null check (mime_type in ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  size_bytes integer not null check (size_bytes > 0),
  sha256 text not null check (length(sha256) = 64),
  part_count integer not null check (part_count > 0),
  complete integer not null default 0 check (complete in (0, 1)),
  report_id text not null,
  receipt_json text not null,
  signer_name text,
  signer_registration text,
  signed_at timestamptz,
  form_request_id text,
  filed_by text,
  filed_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, patient_id, case_id) references public.pms_cases (tenant_id, patient_id, id)
);
create unique index if not exists pms_filed_forms_report_file on public.pms_filed_forms (tenant_id, report_id, sha256);
create index if not exists pms_filed_forms_patient on public.pms_filed_forms (tenant_id, patient_id, filed_at);
create index if not exists pms_filed_forms_case on public.pms_filed_forms (tenant_id, case_id);

create table if not exists public.pms_filed_form_parts (
  tenant_id text not null,
  id text not null,
  filed_form_id text not null,
  idx integer not null check (idx >= 0),
  data_enc text not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, filed_form_id) references public.pms_filed_forms (tenant_id, id) on delete cascade
);
create unique index if not exists pms_filed_form_parts_form_idx on public.pms_filed_form_parts (tenant_id, filed_form_id, idx);

alter table public.pms_import_batches enable row level security;
alter table public.pms_import_rows enable row level security;
alter table public.pms_form_requests enable row level security;
alter table public.pms_filed_forms enable row level security;
alter table public.pms_filed_form_parts enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_import_batches, public.pms_import_rows, public.pms_form_requests, public.pms_filed_forms, public.pms_filed_form_parts from %I', r);
    end if;
  end loop;
end;
$$;
