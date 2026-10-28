-- ClinForms 0114 (Postgres / Supabase): clinic system, diary module - slots offered to patients on the waiting
-- list (offered, then accepted = booked from the entry, declined or withdrawn). An offer does not hold the slot.
-- Kept in step with db/migrations/sqlite/0114_pms_waiting_list_offers.sql (db/parity.test.ts). Composite
-- (tenant_id, id) keys, foreign keys that include tenant_id. RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_waiting_list_offers (
  tenant_id text not null,
  id text not null,
  rev integer not null check (rev > 0),
  waiting_list_id text not null,
  site_id text not null,
  practitioner_id text not null,
  room_id text,
  service_id text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'accepted', 'declined', 'withdrawn')),
  appointment_id text,
  write_id text,
  created_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  check (ends_at > starts_at),
  foreign key (tenant_id, waiting_list_id) references public.pms_waiting_list (tenant_id, id),
  foreign key (tenant_id, site_id) references public.pms_sites (tenant_id, id),
  foreign key (tenant_id, practitioner_id) references public.pms_practitioners (tenant_id, id),
  foreign key (tenant_id, room_id) references public.pms_rooms (tenant_id, id),
  foreign key (tenant_id, service_id) references public.pms_services (tenant_id, id),
  foreign key (tenant_id, appointment_id) references public.pms_appointments (tenant_id, id)
);
create index if not exists pms_waiting_list_offers_entry on public.pms_waiting_list_offers (tenant_id, waiting_list_id, created_at);

alter table public.pms_waiting_list_offers enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_waiting_list_offers from %I', r);
    end if;
  end loop;
end;
$$;
