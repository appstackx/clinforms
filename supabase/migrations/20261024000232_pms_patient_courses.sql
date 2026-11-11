-- ClinForms 0232 (Postgres / Supabase): clinic system, billing - courses (PK02): a course sold to a patient (made
-- when its invoice is issued; sessions and expiry fixed at the sale). New table only (additive).
-- Kept in step with db/migrations/sqlite/0232_pms_patient_courses.sql (db/parity.test.ts).
-- RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_patient_courses (
  tenant_id text not null,
  id text not null,
  rev integer not null check (rev > 0),
  patient_id text not null,
  course_type_id text not null,
  case_id text,
  sale_invoice_id text not null,
  sale_line_id text not null,
  sessions_total integer not null check (sessions_total between 1 and 100),
  sold_on text not null check (sold_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  expires_on text check (expires_on is null or expires_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  status text not null default 'active' check (status in ('active', 'used_up', 'expired', 'cancelled')),
  cancelled_at timestamptz,
  cancel_credit_note_id text,
  created_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, patient_id) references public.pms_patients (tenant_id, id) on delete cascade,
  foreign key (tenant_id, course_type_id) references public.pms_course_types (tenant_id, id) on delete cascade,
  foreign key (tenant_id, case_id) references public.pms_cases (tenant_id, id) on delete cascade,
  foreign key (tenant_id, sale_invoice_id) references public.pms_invoices (tenant_id, id) on delete cascade,
  foreign key (tenant_id, sale_line_id) references public.pms_invoice_lines (tenant_id, id) on delete cascade
);

create unique index if not exists pms_patient_courses_sale_line on public.pms_patient_courses (tenant_id, sale_line_id);
create index if not exists pms_patient_courses_patient on public.pms_patient_courses (tenant_id, patient_id, status);

alter table public.pms_patient_courses enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_patient_courses from %I', r);
    end if;
  end loop;
end;
$$;
