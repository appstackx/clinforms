-- ClinForms 0229 (Postgres / Supabase): clinic system, billing - the provider's webhook events for a clinic's
-- connected account, one row per event id (evt_...) once handled: type, the object it named and the outcome. A
-- repeated delivery of a handled event is answered at once and changes nothing. Hangs off pms_card_settings
-- (ON DELETE CASCADE, offboarding only).
-- Kept in step with db/migrations/sqlite/0229_pms_card_events.sql (db/parity.test.ts).
-- RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_card_events (
  tenant_id text not null,
  id text not null,
  type text not null check (length(type) between 1 and 100),
  object_ref text,
  outcome text not null check (length(outcome) between 1 and 60),
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id) references public.pms_card_settings (tenant_id) on delete cascade
);
create index if not exists pms_card_events_created on public.pms_card_events (tenant_id, created_at);

alter table public.pms_card_events enable row level security;

do $$
declare
  r text;
  t text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      foreach t in array array['pms_card_events'] loop
        execute format('revoke all on table public.%I from %I', t, r);
      end loop;
    end if;
  end loop;
end;
$$;
