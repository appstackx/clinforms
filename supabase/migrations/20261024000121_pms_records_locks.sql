-- ClinForms 0121 (Postgres / Supabase): clinic system, records module - the database backs up the app's
-- sign-and-lock rule. A signed clinical note's content, author, signature and links cannot change, and an
-- amendment cannot change at all; the one exception is anonymisation after the record-keeping period, which sets
-- anonymised_at in the same statement. Deleting stays possible only for offboarding a whole clinic after a
-- verified export. Kept in step with db/migrations/sqlite/0121_pms_records_locks.sql. Idempotent.

create or replace function public.pms_clinical_notes_signed_locked() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if old.status = 'signed' and new.anonymised_at is null and (
    new.status is distinct from old.status
    or new.sections_enc is distinct from old.sections_enc
    or new.body_chart_enc is distinct from old.body_chart_enc
    or new.content_hash is distinct from old.content_hash
    or new.template_json is distinct from old.template_json
    or new.seen_on is distinct from old.seen_on
    or new.patient_id is distinct from old.patient_id
    or new.case_id is distinct from old.case_id
    or new.author_user_id is distinct from old.author_user_id
    or new.signed_at is distinct from old.signed_at
    or new.signed_by_user_id is distinct from old.signed_by_user_id
    or new.signed_by_name is distinct from old.signed_by_name
    or new.signed_registration is distinct from old.signed_registration
  ) then
    raise exception 'pms_clinical_notes: a signed note is locked (append-only: add an amendment)' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.pms_clinical_notes_signed_locked() from public;

drop trigger if exists pms_clinical_notes_signed_locked on public.pms_clinical_notes;
create trigger pms_clinical_notes_signed_locked
  before update on public.pms_clinical_notes
  for each row execute function public.pms_clinical_notes_signed_locked();

create or replace function public.pms_note_amendments_locked() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.anonymised_at is null
    or new.kind is distinct from old.kind
    or new.note_id is distinct from old.note_id
    or new.patient_id is distinct from old.patient_id
    or new.author_user_id is distinct from old.author_user_id
    or new.created_at is distinct from old.created_at then
    raise exception 'pms_note_amendments: an amendment is locked (append-only)' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.pms_note_amendments_locked() from public;

drop trigger if exists pms_note_amendments_locked on public.pms_note_amendments;
create trigger pms_note_amendments_locked
  before update on public.pms_note_amendments
  for each row execute function public.pms_note_amendments_locked();
