-- ClinForms 0150 (Postgres / Supabase): clinic system, portal module part 1 - online booking: booking settings,
-- the weekly hours each practitioner offers online at a site, and the appointments booked online. Kept in step
-- with db/migrations/sqlite/0150_portal_booking.sql (db/parity.test.ts). Composite (tenant_id, id) keys, foreign
-- keys that include tenant_id. Times are timestamptz, calendar dates text YYYY-MM-DD (as on D1).
-- No double booking: a trigger takes a per-practitioner transaction lock (no btree_gist needed) and refuses a
-- booked row that overlaps another booked row of the same practitioner, with check-violation SQLSTATE 23514 and
-- the constraint name pms_online_bookings_overlap (the same words D1 reports). A move to another time
-- (rebooked_from_id) needs the earlier booking cancelled as "rebooked" in the same transaction
-- (pms_online_bookings_rebook), and a booking can be moved only once (unique index). RLS on, no policies, Data
-- API roles revoked. Idempotent.

create table if not exists public.pms_booking_settings (
  tenant_id text not null primary key,
  rev integer not null default 1 check (rev > 0),
  online_booking integer not null default 0 check (online_booking in (0, 1)),
  portal integer not null default 0 check (portal in (0, 1)),
  new_patients integer not null default 1 check (new_patients in (0, 1)),
  min_notice_hours integer not null default 24 check (min_notice_hours between 0 and 336),
  max_days_ahead integer not null default 42 check (max_days_ahead between 1 and 365),
  slot_step_minutes integer not null default 15 check (slot_step_minutes in (5, 10, 15, 20, 30, 60)),
  cancel_notice_hours integer not null default 24 check (cancel_notice_hours between 0 and 336),
  patient_cancel integer not null default 1 check (patient_cancel in (0, 1)),
  intro_text text check (intro_text is null or length(intro_text) <= 600),
  cancellation_policy text check (cancellation_policy is null or length(cancellation_policy) <= 1000),
  contact_phone text,
  contact_email text,
  updated_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists public.pms_booking_hours (
  tenant_id text not null,
  id text not null,
  practitioner_id text not null,
  site_id text not null,
  weekday integer not null check (weekday between 1 and 7),
  start_minute integer not null check (start_minute between 0 and 1435),
  end_minute integer not null check (end_minute between 5 and 1440),
  valid_from text,
  valid_to text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, practitioner_id) references public.pms_practitioners (tenant_id, id),
  foreign key (tenant_id, site_id) references public.pms_sites (tenant_id, id),
  check (end_minute > start_minute)
);
create index if not exists pms_booking_hours_practitioner on public.pms_booking_hours (tenant_id, practitioner_id, weekday);
create index if not exists pms_booking_hours_site on public.pms_booking_hours (tenant_id, site_id, weekday);

create table if not exists public.pms_online_bookings (
  tenant_id text not null,
  id text not null,
  rev integer not null default 1 check (rev > 0),
  reference text not null,
  patient_id text not null,
  site_id text not null,
  practitioner_id text not null,
  service_id text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  blocks_until timestamptz not null,
  status text not null default 'booked' check (status in ('booked', 'cancelled')),
  channel text not null check (channel in ('booking_page', 'portal', 'clinic')),
  patient_match text not null check (patient_match in ('new', 'existing', 'portal')),
  cancelled_by text check (cancelled_by is null or cancelled_by in ('patient', 'clinic')),
  cancel_reason text check (cancel_reason is null or cancel_reason in ('patient_request', 'rebooked', 'clinic', 'other')),
  cancelled_at timestamptz,
  late_cancellation integer not null default 0 check (late_cancellation in (0, 1)),
  rebooked_from_id text,
  appointment_id text,
  manage_token_hash text,
  manage_expires_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, patient_id) references public.pms_patients (tenant_id, id),
  foreign key (tenant_id, site_id) references public.pms_sites (tenant_id, id),
  foreign key (tenant_id, practitioner_id) references public.pms_practitioners (tenant_id, id),
  foreign key (tenant_id, service_id) references public.pms_services (tenant_id, id),
  foreign key (tenant_id, rebooked_from_id) references public.pms_online_bookings (tenant_id, id),
  check (ends_at > starts_at and blocks_until >= ends_at)
);
create unique index if not exists pms_online_bookings_reference on public.pms_online_bookings (tenant_id, reference);
create unique index if not exists pms_online_bookings_manage_token on public.pms_online_bookings (tenant_id, manage_token_hash);
create index if not exists pms_online_bookings_practitioner on public.pms_online_bookings (tenant_id, practitioner_id, starts_at);
create index if not exists pms_online_bookings_patient on public.pms_online_bookings (tenant_id, patient_id, starts_at);
create index if not exists pms_online_bookings_created on public.pms_online_bookings (tenant_id, created_at);
create unique index if not exists pms_online_bookings_rebooked_from on public.pms_online_bookings (tenant_id, rebooked_from_id);

create or replace function public.pms_online_bookings_no_overlap() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.rebooked_from_id is not null and not exists (
    select 1 from public.pms_online_bookings b
    where b.tenant_id = new.tenant_id and b.id = new.rebooked_from_id and b.status = 'cancelled' and b.cancel_reason = 'rebooked'
      and b.patient_id = new.patient_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'new row for relation "pms_online_bookings" violates check constraint "pms_online_bookings_rebook"',
      constraint = 'pms_online_bookings_rebook';
  end if;
  if new.status = 'booked' then
    -- One booking at a time per practitioner (released at commit): two simultaneous bookings cannot both pass.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pms_online_bookings:' || new.tenant_id || ':' || new.practitioner_id, 0));
    if exists (
      select 1 from public.pms_online_bookings b
      where b.tenant_id = new.tenant_id and b.practitioner_id = new.practitioner_id and b.status = 'booked'
        and b.id <> new.id and b.starts_at < new.blocks_until and new.starts_at < b.blocks_until
    ) then
      raise exception using
        errcode = '23514',
        message = 'new row for relation "pms_online_bookings" violates check constraint "pms_online_bookings_overlap"',
        constraint = 'pms_online_bookings_overlap';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.pms_online_bookings_no_overlap() from public;

drop trigger if exists pms_online_bookings_no_overlap on public.pms_online_bookings;
create trigger pms_online_bookings_no_overlap
  before insert or update of status, starts_at, blocks_until, practitioner_id on public.pms_online_bookings
  for each row execute function public.pms_online_bookings_no_overlap();

alter table public.pms_booking_settings enable row level security;
alter table public.pms_booking_hours enable row level security;
alter table public.pms_online_bookings enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_booking_settings, public.pms_booking_hours, public.pms_online_bookings from %I', r);
    end if;
  end loop;
end;
$$;
