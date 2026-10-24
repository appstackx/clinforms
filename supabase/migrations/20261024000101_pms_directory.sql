-- ClinForms 0101 (Postgres / Supabase): clinic-system foundation, part 2 - the clinic directory: sites, rooms,
-- practitioners, services (appointment types), referrers and payer accounts, price lists. Kept in step with
-- db/migrations/sqlite/0101_pms_directory.sql (db/parity.test.ts). Composite (tenant_id, id) keys, foreign keys
-- that include tenant_id. RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_sites (
  tenant_id text not null,
  id text not null,
  name text not null check (length(name) between 1 and 120),
  code text,
  address_json text,
  postcode text,
  phone text,
  email text,
  active integer not null default 1 check (active in (0, 1)),
  sort_order integer not null default 0,
  import_ref text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id)
);
create unique index if not exists pms_sites_name on public.pms_sites (tenant_id, name);
create unique index if not exists pms_sites_import_ref on public.pms_sites (tenant_id, import_ref);

create table if not exists public.pms_rooms (
  tenant_id text not null,
  id text not null,
  site_id text not null,
  name text not null check (length(name) between 1 and 80),
  active integer not null default 1 check (active in (0, 1)),
  sort_order integer not null default 0,
  import_ref text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, site_id) references public.pms_sites (tenant_id, id)
);
create unique index if not exists pms_rooms_site_name on public.pms_rooms (tenant_id, site_id, name);
create unique index if not exists pms_rooms_import_ref on public.pms_rooms (tenant_id, import_ref);

create table if not exists public.pms_practitioners (
  tenant_id text not null,
  id text not null,
  user_id text,
  display_name text not null check (length(display_name) between 1 and 120),
  profession text not null default 'physiotherapist',
  registration_number text,
  email text,
  phone text,
  colour text,
  default_site_id text,
  bookable integer not null default 1 check (bookable in (0, 1)),
  online_bookable integer not null default 0 check (online_bookable in (0, 1)),
  active integer not null default 1 check (active in (0, 1)),
  sort_order integer not null default 0,
  import_ref text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, default_site_id) references public.pms_sites (tenant_id, id)
);
create unique index if not exists pms_practitioners_user on public.pms_practitioners (tenant_id, user_id);
create unique index if not exists pms_practitioners_import_ref on public.pms_practitioners (tenant_id, import_ref);

create table if not exists public.pms_services (
  tenant_id text not null,
  id text not null,
  name text not null check (length(name) between 1 and 120),
  code text,
  category text not null default 'treatment',
  duration_minutes integer not null check (duration_minutes between 5 and 480),
  buffer_minutes integer not null default 0 check (buffer_minutes between 0 and 120),
  default_price_pence integer check (default_price_pence is null or default_price_pence >= 0),
  colour text,
  online_bookable integer not null default 0 check (online_bookable in (0, 1)),
  active integer not null default 1 check (active in (0, 1)),
  sort_order integer not null default 0,
  import_ref text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id)
);
create unique index if not exists pms_services_name on public.pms_services (tenant_id, name);
create unique index if not exists pms_services_import_ref on public.pms_services (tenant_id, import_ref);

create table if not exists public.pms_referrers (
  tenant_id text not null,
  id text not null,
  rev integer not null check (rev > 0),
  kind text not null,
  name text not null check (length(name) between 1 and 160),
  search_name text not null,
  contact_name text,
  email text,
  phone text,
  address_json text,
  postcode text,
  notes_enc text,
  active integer not null default 1 check (active in (0, 1)),
  import_ref text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id)
);
create index if not exists pms_referrers_kind_name on public.pms_referrers (tenant_id, kind, search_name);
create unique index if not exists pms_referrers_import_ref on public.pms_referrers (tenant_id, import_ref);

create table if not exists public.pms_price_lists (
  tenant_id text not null,
  id text not null,
  name text not null check (length(name) between 1 and 120),
  payer_type text,
  referrer_id text,
  is_default integer not null default 0 check (is_default in (0, 1)),
  valid_from text,
  valid_to text,
  active integer not null default 1 check (active in (0, 1)),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, referrer_id) references public.pms_referrers (tenant_id, id)
);
create unique index if not exists pms_price_lists_name on public.pms_price_lists (tenant_id, name);

create table if not exists public.pms_price_list_items (
  tenant_id text not null,
  id text not null,
  price_list_id text not null,
  service_id text not null,
  price_pence integer not null check (price_pence >= 0),
  billing_code text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, price_list_id) references public.pms_price_lists (tenant_id, id) on delete cascade,
  foreign key (tenant_id, service_id) references public.pms_services (tenant_id, id)
);
create unique index if not exists pms_price_list_items_list_service on public.pms_price_list_items (tenant_id, price_list_id, service_id);
create index if not exists pms_price_list_items_service on public.pms_price_list_items (tenant_id, service_id);

alter table public.pms_sites enable row level security;
alter table public.pms_rooms enable row level security;
alter table public.pms_practitioners enable row level security;
alter table public.pms_services enable row level security;
alter table public.pms_referrers enable row level security;
alter table public.pms_price_lists enable row level security;
alter table public.pms_price_list_items enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_sites, public.pms_rooms, public.pms_practitioners, public.pms_services, public.pms_referrers, public.pms_price_lists, public.pms_price_list_items from %I', r);
    end if;
  end loop;
end;
$$;
