-- ClinForms 0227 (Postgres / Supabase): clinic system, billing - card readers at the desk (cp03). One row per
-- reader registered on the clinic's connected account: the site it stands at, the provider's location (tml_...) and
-- reader (tmr_...) ids, a label, simulated (1 = the provider's test reader). Removed by status, never deleted.
-- Hangs off the clinic's pms_card_settings row and its site (ON DELETE CASCADE, offboarding only).
-- Kept in step with db/migrations/sqlite/0227_pms_card_readers.sql (db/parity.test.ts).
-- RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_card_readers (
  tenant_id text not null,
  id text not null,
  site_id text not null,
  account_ref text not null,
  location_ref text not null,
  reader_ref text not null,
  label text not null check (length(label) between 1 and 60),
  device_type text,
  simulated integer not null default 0 check (simulated in (0, 1)),
  status text not null default 'active' check (status in ('active', 'removed')),
  removed_at timestamptz,
  removed_by text,
  created_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id) references public.pms_card_settings (tenant_id) on delete cascade,
  foreign key (tenant_id, site_id) references public.pms_sites (tenant_id, id) on delete cascade
);
create unique index if not exists pms_card_readers_reader on public.pms_card_readers (tenant_id, reader_ref);
create index if not exists pms_card_readers_site on public.pms_card_readers (tenant_id, site_id, status);

alter table public.pms_card_readers enable row level security;

do $$
declare
  r text;
  t text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      foreach t in array array['pms_card_readers'] loop
        execute format('revoke all on table public.%I from %I', t, r);
      end loop;
    end if;
  end loop;
end;
$$;
