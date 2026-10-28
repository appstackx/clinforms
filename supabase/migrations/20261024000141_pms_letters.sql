-- ClinForms 0141 (Postgres / Supabase): clinic system, comms module part 2 - letter templates and letters.
-- Kept in step with db/migrations/sqlite/0141_pms_letters.sql (db/parity.test.ts). Subject and body
-- encrypted per clinic (_enc). Never deleted by the app (withdrawn letters are kept, status void). A letter's
-- case is one of the same patient's cases. RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_letter_templates (
  tenant_id text not null,
  id text not null,
  rev integer not null check (rev > 0),
  name text not null check (length(name) between 1 and 120),
  recipient_kind text not null check (recipient_kind in ('patient', 'gp', 'referrer', 'other')),
  subject text not null check (length(subject) between 1 and 200),
  body text not null check (length(body) between 1 and 20000),
  active integer not null default 1 check (active in (0, 1)),
  import_ref text,
  created_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id)
);
create unique index if not exists pms_letter_templates_name on public.pms_letter_templates (tenant_id, name);
create unique index if not exists pms_letter_templates_import_ref on public.pms_letter_templates (tenant_id, import_ref);

create table if not exists public.pms_letters (
  tenant_id text not null,
  id text not null,
  rev integer not null check (rev > 0),
  patient_id text not null,
  case_id text,
  template_id text,
  template_name text check (template_name is null or length(template_name) <= 120),
  practitioner_id text,
  recipient_kind text not null check (recipient_kind in ('patient', 'gp', 'referrer', 'other')),
  recipient_referrer_id text,
  recipient_name text,
  recipient_address_json text,
  recipient_postcode text,
  recipient_email text,
  letter_on text not null check (letter_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  subject_enc text not null,
  body_enc text not null,
  status text not null default 'draft' check (status in ('draft', 'final', 'void')),
  finalised_at timestamptz,
  finalised_by text,
  signature_text text check (signature_text is null or length(signature_text) <= 300),
  sent_at timestamptz,
  sent_via text check (sent_via is null or sent_via in ('post', 'email', 'hand')),
  voided_at timestamptz,
  voided_by text,
  created_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, patient_id) references public.pms_patients (tenant_id, id),
  foreign key (tenant_id, patient_id, case_id) references public.pms_cases (tenant_id, patient_id, id),
  foreign key (tenant_id, template_id) references public.pms_letter_templates (tenant_id, id),
  foreign key (tenant_id, practitioner_id) references public.pms_practitioners (tenant_id, id),
  foreign key (tenant_id, recipient_referrer_id) references public.pms_referrers (tenant_id, id)
);
create index if not exists pms_letters_patient on public.pms_letters (tenant_id, patient_id, id);
create index if not exists pms_letters_status on public.pms_letters (tenant_id, status, id);

alter table public.pms_letter_templates enable row level security;
alter table public.pms_letters enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_letter_templates, public.pms_letters from %I', r);
    end if;
  end loop;
end;
$$;
