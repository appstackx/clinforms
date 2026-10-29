-- ClinForms 0181 (Postgres / Supabase): clinic system, diary module - a held waiting-list offer cannot be booked
-- over (see the SQLite file): an open offer with hold_until later than the writing row's updated_at holds its
-- practitioner (and room) for its time, except for the patient it is held for. Takes the same advisory locks as the
-- clash trigger (practitioner, room) so it serialises with racing bookings. An update that keeps an item where it
-- is and occupying is not re-checked.
-- Kept in step with db/migrations/sqlite/0181_pms_offer_hold_triggers.sql. Idempotent.
create or replace function public.pms_appointments_no_hold() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.status not in ('booked', 'arrived', 'attended', 'dna') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status in ('booked', 'arrived', 'attended', 'dna')
    and new.starts_at = old.starts_at and new.ends_at = old.ends_at
    and new.practitioner_id is not distinct from old.practitioner_id and new.room_id is not distinct from old.room_id then
    return new;
  end if;
  if new.practitioner_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(new.tenant_id || ':pms-practitioner:' || new.practitioner_id, 0));
  end if;
  if exists (
    select 1 from public.pms_waiting_list_offers o
    join public.pms_waiting_list w on w.tenant_id = o.tenant_id and w.id = o.waiting_list_id
    where o.tenant_id = new.tenant_id and o.status = 'open' and o.hold_until is not null and o.hold_until > new.updated_at
      and o.starts_at < new.ends_at and o.ends_at > new.starts_at
      and ((new.practitioner_id is not null and o.practitioner_id = new.practitioner_id) or (new.room_id is not null and o.room_id = new.room_id))
      and (new.patient_id is null or w.patient_id <> new.patient_id)
  ) then
    raise exception 'new row for relation "pms_appointments" violates check constraint "pms_appointments_offer_hold"'
      using errcode = '23514', constraint = 'pms_appointments_offer_hold';
  end if;
  return new;
end;
$$;
revoke all on function public.pms_appointments_no_hold() from public;

drop trigger if exists pms_appointments_no_hold on public.pms_appointments;
create trigger pms_appointments_no_hold
  before insert or update of starts_at, ends_at, practitioner_id, room_id, status on public.pms_appointments
  for each row execute function public.pms_appointments_no_hold();
