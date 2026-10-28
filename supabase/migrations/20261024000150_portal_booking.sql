-- ClinForms 0150 (Postgres / Supabase): clinic system, portal module part 1 - online booking: booking settings,
-- which sites take online bookings (with a map position for "distance from you", worked out in the patient's
-- browser only) and a log of the appointments booked online. Kept in step with
-- db/migrations/sqlite/0150_portal_booking.sql (db/parity.test.ts). Composite (tenant_id, id) keys, foreign keys
-- that include tenant_id. Times are timestamptz.
-- One appointment store: an online booking IS a diary appointment (pms_appointments, source online) - the diary's
-- clash triggers cover it. pms_online_bookings holds the reference, how the record was found and the hash of the
-- "manage this booking" link. RLS on, no policies, Data API roles revoked. Idempotent.

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

create table if not exists public.pms_booking_sites (
  tenant_id text not null,
  site_id text not null,
  rev integer not null default 1 check (rev > 0),
  online integer not null default 1 check (online in (0, 1)),
  lat_e6 integer check (lat_e6 is null or lat_e6 between -90000000 and 90000000),
  lng_e6 integer check (lng_e6 is null or lng_e6 between -180000000 and 180000000),
  updated_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, site_id),
  foreign key (tenant_id, site_id) references public.pms_sites (tenant_id, id),
  check ((lat_e6 is null) = (lng_e6 is null))
);

create table if not exists public.pms_online_bookings (
  tenant_id text not null,
  id text not null,
  rev integer not null default 1 check (rev > 0),
  reference text not null,
  patient_id text not null,
  appointment_id text not null,
  channel text not null check (channel in ('booking_page', 'portal')),
  patient_match text not null check (patient_match in ('new', 'existing', 'portal')),
  manage_token_hash text check (manage_token_hash is null or length(manage_token_hash) = 64),
  manage_expires_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, patient_id) references public.pms_patients (tenant_id, id),
  foreign key (tenant_id, appointment_id) references public.pms_appointments (tenant_id, id)
);
create unique index if not exists pms_online_bookings_reference on public.pms_online_bookings (tenant_id, reference);
create unique index if not exists pms_online_bookings_appointment on public.pms_online_bookings (tenant_id, appointment_id);
create unique index if not exists pms_online_bookings_manage_token on public.pms_online_bookings (tenant_id, manage_token_hash);
create index if not exists pms_online_bookings_patient on public.pms_online_bookings (tenant_id, patient_id, created_at);
create index if not exists pms_online_bookings_created on public.pms_online_bookings (tenant_id, created_at);

alter table public.pms_booking_settings enable row level security;
alter table public.pms_booking_sites enable row level security;
alter table public.pms_online_bookings enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_booking_settings, public.pms_booking_sites, public.pms_online_bookings from %I', r);
    end if;
  end loop;
end;
$$;
