-- ClinForms 0119 (Postgres / Supabase): clinic system, diary module - the clash trigger function of 0110, replaced
-- (Khuram's decision A, 28/10/2026). PRACTITIONER: refused unless the write is a flagged double-booking
-- (overbook_write_id = write_id, and on an update a NEW write_id) - never over blocked time. ROOM: absolute.
-- An update that keeps the item where it is and occupying re-checks only the room. Advisory locks per
-- practitioner and room serialise racing writers, as before.
-- Kept in step with db/migrations/sqlite/0119_pms_appointments_clash_override.sql. Idempotent.
create or replace function public.pms_appointments_no_clash() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  lock_keys bigint[] := array[]::bigint[];
  k bigint;
  check_practitioner boolean := true;
  flagged boolean;
begin
  if new.status not in ('booked', 'arrived', 'attended', 'dna') then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    check_practitioner := old.status not in ('booked', 'arrived', 'attended', 'dna')
      or new.starts_at <> old.starts_at or new.ends_at <> old.ends_at
      or old.practitioner_id is null or new.practitioner_id is distinct from old.practitioner_id;
    flagged := new.overbook_write_id is not null and new.write_id is not null and new.overbook_write_id = new.write_id
      and new.write_id is distinct from old.write_id;
  else
    flagged := new.overbook_write_id is not null and new.write_id is not null and new.overbook_write_id = new.write_id;
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
  if check_practitioner and new.practitioner_id is not null and exists (
    select 1 from public.pms_appointments a
    where a.tenant_id = new.tenant_id and a.practitioner_id = new.practitioner_id and a.id <> new.id
      and a.status in ('booked', 'arrived', 'attended', 'dna')
      and a.starts_at < new.ends_at and a.ends_at > new.starts_at
      and a.starts_at > new.starts_at - interval '1 day'
      and (a.kind = 'block' or new.kind = 'block' or not flagged)
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
