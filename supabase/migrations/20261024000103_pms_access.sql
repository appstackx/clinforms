-- ClinForms 0103 (Postgres / Supabase): clinic-system foundation, part 4 - configurable access. The clinic's
-- overrides of a role's permissions, a member's own exceptions, the sites a member works at and can see, whether
-- their clinic-system access is on, and the change history (who, when, what - never patient data).
-- Kept in step with db/migrations/sqlite/0103_pms_access.sql (db/parity.test.ts). RLS on, no policies, Data API
-- roles revoked. Idempotent.

create table if not exists public.pms_role_permissions (
  tenant_id text not null,
  role text not null check (role in ('owner', 'admin', 'clinician', 'staff')),
  permission text not null check (length(permission) between 3 and 40),
  allowed integer not null check (allowed in (0, 1)),
  updated_by text,
  updated_at timestamptz not null,
  primary key (tenant_id, role, permission)
);

create table if not exists public.pms_member_access (
  tenant_id text not null,
  user_id text not null,
  active integer not null default 1 check (active in (0, 1)),
  all_sites integer not null default 1 check (all_sites in (0, 1)),
  rev integer not null default 1 check (rev >= 1),
  updated_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, user_id)
);

create table if not exists public.pms_member_permissions (
  tenant_id text not null,
  user_id text not null,
  permission text not null check (length(permission) between 3 and 40),
  allowed integer not null check (allowed in (0, 1)),
  updated_by text,
  updated_at timestamptz not null,
  primary key (tenant_id, user_id, permission),
  foreign key (tenant_id, user_id) references public.pms_member_access (tenant_id, user_id) on delete cascade
);

create table if not exists public.pms_member_sites (
  tenant_id text not null,
  user_id text not null,
  site_id text not null,
  works_at integer not null default 0 check (works_at in (0, 1)),
  can_see integer not null default 0 check (can_see in (0, 1)),
  updated_at timestamptz not null,
  primary key (tenant_id, user_id, site_id),
  foreign key (tenant_id, user_id) references public.pms_member_access (tenant_id, user_id) on delete cascade,
  foreign key (tenant_id, site_id) references public.pms_sites (tenant_id, id)
);
create index if not exists pms_member_sites_site on public.pms_member_sites (tenant_id, site_id);

create table if not exists public.pms_access_changes (
  tenant_id text not null,
  id text not null,
  kind text not null check (kind in ('role', 'member')),
  subject_role text,
  subject_user_id text,
  items_json text not null,
  changed_by text,
  created_at timestamptz not null,
  primary key (tenant_id, id)
);
create index if not exists pms_access_changes_created on public.pms_access_changes (tenant_id, created_at);
create index if not exists pms_access_changes_subject on public.pms_access_changes (tenant_id, subject_user_id, created_at);

alter table public.pms_role_permissions enable row level security;
alter table public.pms_member_access enable row level security;
alter table public.pms_member_permissions enable row level security;
alter table public.pms_member_sites enable row level security;
alter table public.pms_access_changes enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_role_permissions, public.pms_member_access, public.pms_member_permissions, public.pms_member_sites, public.pms_access_changes from %I', r);
    end if;
  end loop;
end;
$$;
