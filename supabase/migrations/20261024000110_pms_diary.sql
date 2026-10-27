-- ClinForms 0110 (Postgres / Supabase): clinic system, diary module - appointments and blocked time, recurring
-- series, practitioner rotas (availability) and the waiting list. Kept in step with
-- db/migrations/sqlite/0110_pms_diary.sql (db/parity.test.ts). Composite (tenant_id, id) keys, foreign keys that
-- include tenant_id. RLS on, no policies, Data API roles revoked. Idempotent.
--
-- NO DOUBLE BOOKING: two items that overlap in time and share a practitioner or a room cannot both occupy the
-- diary (booked, arrived, attended, dna - cancelled and late_cancelled free the slot). Enforced by the trigger
-- function below, which first takes a transaction-scoped advisory lock per practitioner and per room (in a fixed
-- order, so two writers never wait for each other in a circle): under READ COMMITTED each statement in the
-- function sees every booking committed before the lock was granted, so two concurrent writers cannot both pass.
-- (No exclusion constraint: that needs the btree_gist extension, which the test database does not load - a
-- possible later hardening, same rule.) An item lasts at most one day, which bounds the look-back.

create table if not exists public.pms_appointment_series (
  tenant_id text not null,
  id text not null,
  interval_weeks integer not null check (interval_weeks between 1 and 8),
  occurrences integer not null check (occurrences between 1 and 52),
  created_by text,
  created_at timestamptz not null,
  primary key (tenant_id, id)
);

create table if not exists public.pms_availability (
  tenant_id text not null,
  id text not null,
  rev integer not null check (rev > 0),
  practitioner_id text not null,
  site_id text not null,
  room_id text,
  weekday integer not null check (weekday between 1 and 7),
  start_minute integer not null check (start_minute between 0 and 1439),
  end_minute integer not null check (end_minute between 1 and 1440),
  every_weeks integer not null default 1 check (every_weeks between 1 and 4),
  valid_from text not null check (valid_from ~ '^\d{4}-\d{2}-\d{2}$'),
  valid_to text check (valid_to is null or valid_to ~ '^\d{4}-\d{2}-\d{2}$'),
  online_bookable integer not null default 1 check (online_bookable in (0, 1)),
  active integer not null default 1 check (active in (0, 1)),
  import_ref text,
  created_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  check (end_minute > start_minute),
  check (valid_to is null or valid_to >= valid_from),
  foreign key (tenant_id, practitioner_id) references public.pms_practitioners (tenant_id, id),
  foreign key (tenant_id, site_id) references public.pms_sites (tenant_id, id),
  foreign key (tenant_id, room_id) references public.pms_rooms (tenant_id, id)
);
create index if not exists pms_availability_practitioner on public.pms_availability (tenant_id, practitioner_id, weekday);
create index if not exists pms_availability_site on public.pms_availability (tenant_id, site_id, weekday);
create unique index if not exists pms_availability_import_ref on public.pms_availability (tenant_id, import_ref);

create table if not exists public.pms_appointments (
  tenant_id text not null,
  id text not null,
  rev integer not null check (rev > 0),
  kind text not null check (kind in ('appointment', 'block')),
  site_id text not null,
  practitioner_id text,
  room_id text,
  patient_id text,
  case_id text,
  service_id text,
  authorisation_id text,
  series_id text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  starts_on text not null check (starts_on ~ '^\d{4}-\d{2}-\d{2}$'),
  status text not null check (status in ('booked', 'arrived', 'attended', 'dna', 'late_cancelled', 'cancelled')),
  block_kind text check (block_kind is null or block_kind in ('leave', 'meeting', 'training', 'admin', 'closed', 'other')),
  title text check (title is null or length(title) <= 80),
  notes_enc text,
  source text not null default 'staff' check (source in ('staff', 'online', 'import')),
  fee_due integer not null default 0 check (fee_due in (0, 1)),
  fee_pence integer check (fee_pence is null or fee_pence >= 0),
  auth_session_used integer not null default 0 check (auth_session_used in (0, 1)),
  cancel_reason text check (cancel_reason is null or cancel_reason in ('patient', 'clinic', 'practitioner_unavailable', 'illness', 'weather', 'other')),
  cancel_note_enc text,
  cancelled_at timestamptz,
  cancelled_by text,
  status_at timestamptz,
  status_by text,
  import_ref text,
  created_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '1 day'),
  check (practitioner_id is not null or room_id is not null),
  check (kind = 'block' or (patient_id is not null and service_id is not null and practitioner_id is not null)),
  check (kind = 'appointment' or (patient_id is null and case_id is null and authorisation_id is null)),
  foreign key (tenant_id, site_id) references public.pms_sites (tenant_id, id),
  foreign key (tenant_id, practitioner_id) references public.pms_practitioners (tenant_id, id),
  foreign key (tenant_id, room_id) references public.pms_rooms (tenant_id, id),
  foreign key (tenant_id, patient_id) references public.pms_patients (tenant_id, id),
  foreign key (tenant_id, patient_id, case_id) references public.pms_cases (tenant_id, patient_id, id),
  foreign key (tenant_id, service_id) references public.pms_services (tenant_id, id),
  foreign key (tenant_id, authorisation_id) references public.pms_authorisations (tenant_id, id),
  foreign key (tenant_id, series_id) references public.pms_appointment_series (tenant_id, id)
);
create index if not exists pms_appointments_starts on public.pms_appointments (tenant_id, starts_at);
create index if not exists pms_appointments_site_starts on public.pms_appointments (tenant_id, site_id, starts_at);
create index if not exists pms_appointments_practitioner_starts on public.pms_appointments (tenant_id, practitioner_id, starts_at);
create index if not exists pms_appointments_room_starts on public.pms_appointments (tenant_id, room_id, starts_at);
create index if not exists pms_appointments_patient_starts on public.pms_appointments (tenant_id, patient_id, starts_at);
create index if not exists pms_appointments_case on public.pms_appointments (tenant_id, case_id);
create index if not exists pms_appointments_series on public.pms_appointments (tenant_id, series_id);
create index if not exists pms_appointments_fee_due on public.pms_appointments (tenant_id, fee_due, starts_on);
create unique index if not exists pms_appointments_import_ref on public.pms_appointments (tenant_id, import_ref);

create or replace function public.pms_appointments_no_clash() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  lock_keys bigint[] := array[]::bigint[];
  k bigint;
begin
  if new.status not in ('booked', 'arrived', 'attended', 'dna') then
    return new;
  end if;
  if new.practitioner_id is not null then
    lock_keys := lock_keys || hashtextextended(new.tenant_id || ':pms-practitioner:' || new.practitioner_id, 0);
  end if;
  if new.room_id is not null then
    lock_keys := lock_keys || hashtextextended(new.tenant_id || ':pms-room:' || new.room_id, 0);
  end if;
  foreach k in array coalesce((select array_agg(x order by x) from unnest(lock_keys) as x), array[]::bigint[]) loop
    perform pg_advisory_xact_lock(k);
  end loop;
  if new.practitioner_id is not null and exists (
    select 1 from public.pms_appointments a
    where a.tenant_id = new.tenant_id and a.practitioner_id = new.practitioner_id and a.id <> new.id
      and a.status in ('booked', 'arrived', 'attended', 'dna')
      and a.starts_at < new.ends_at and a.ends_at > new.starts_at
      and a.starts_at > new.starts_at - interval '1 day'
  ) then
    raise exception 'new row for relation "pms_appointments" violates check constraint "pms_appointments_practitioner_clash"'
      using errcode = '23514', constraint = 'pms_appointments_practitioner_clash';
  end if;
  if new.room_id is not null and exists (
    select 1 from public.pms_appointments a
    where a.tenant_id = new.tenant_id and a.room_id = new.room_id and a.id <> new.id
      and a.status in ('booked', 'arrived', 'attended', 'dna')
      and a.starts_at < new.ends_at and a.ends_at > new.starts_at
      and a.starts_at > new.starts_at - interval '1 day'
  ) then
    raise exception 'new row for relation "pms_appointments" violates check constraint "pms_appointments_room_clash"'
      using errcode = '23514', constraint = 'pms_appointments_room_clash';
  end if;
  return new;
end;
$$;
revoke all on function public.pms_appointments_no_clash() from public;

drop trigger if exists pms_appointments_no_clash on public.pms_appointments;
create trigger pms_appointments_no_clash
  before insert or update of starts_at, ends_at, practitioner_id, room_id, status on public.pms_appointments
  for each row execute function public.pms_appointments_no_clash();

create table if not exists public.pms_waiting_list (
  tenant_id text not null,
  id text not null,
  rev integer not null check (rev > 0),
  patient_id text not null,
  case_id text,
  service_id text,
  practitioner_id text,
  site_id text,
  priority text not null default 'routine' check (priority in ('urgent', 'soon', 'routine')),
  preferred_days text check (preferred_days is null or preferred_days ~ '^[1-7](,[1-7])*$'),
  preferred_time text not null default 'any' check (preferred_time in ('any', 'morning', 'afternoon', 'evening')),
  earliest_on text check (earliest_on is null or earliest_on ~ '^\d{4}-\d{2}-\d{2}$'),
  latest_on text check (latest_on is null or latest_on ~ '^\d{4}-\d{2}-\d{2}$'),
  status text not null default 'waiting' check (status in ('waiting', 'offered', 'booked', 'removed')),
  notes_enc text,
  booked_appointment_id text,
  removed_reason text,
  created_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, patient_id) references public.pms_patients (tenant_id, id),
  foreign key (tenant_id, patient_id, case_id) references public.pms_cases (tenant_id, patient_id, id),
  foreign key (tenant_id, service_id) references public.pms_services (tenant_id, id),
  foreign key (tenant_id, practitioner_id) references public.pms_practitioners (tenant_id, id),
  foreign key (tenant_id, site_id) references public.pms_sites (tenant_id, id),
  foreign key (tenant_id, booked_appointment_id) references public.pms_appointments (tenant_id, id)
);
create index if not exists pms_waiting_list_status on public.pms_waiting_list (tenant_id, status, created_at);
create index if not exists pms_waiting_list_patient on public.pms_waiting_list (tenant_id, patient_id);

alter table public.pms_appointment_series enable row level security;
alter table public.pms_availability enable row level security;
alter table public.pms_appointments enable row level security;
alter table public.pms_waiting_list enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_appointment_series, public.pms_availability, public.pms_appointments, public.pms_waiting_list from %I', r);
    end if;
  end loop;
end;
$$;
