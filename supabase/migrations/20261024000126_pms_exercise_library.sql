-- ClinForms 0126 (Postgres / Supabase): clinic system, records module - home exercise programmes, part 1 (ex03):
-- the per-clinic switch (pms_exercise_settings, off by default, hangs off pms_records_settings by cascade) and the
-- clinic's own exercise library (pms_exercises, plain configuration, links only). Behind CLINFORMS_EXERCISE=on.
-- See the SQLite twin for the full notes.
-- Kept in step with db/migrations/sqlite/0126_pms_exercise_library.sql. Idempotent.

create table if not exists public.pms_exercise_settings (
  tenant_id text not null,
  id text not null check (id = 'exercises'),
  records_id text not null default 'records' check (records_id = 'records'),
  rev integer not null check (rev > 0),
  enabled integer not null default 0 check (enabled in (0, 1)),
  updated_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, records_id) references public.pms_records_settings (tenant_id, id) on delete cascade
);

create table if not exists public.pms_exercises (
  tenant_id text not null,
  id text not null,
  settings_id text not null default 'exercises' check (settings_id = 'exercises'),
  rev integer not null check (rev > 0),
  name text not null check (length(name) between 1 and 120),
  body_area text check (body_area is null or length(body_area) between 1 and 60),
  instructions text check (instructions is null or length(instructions) <= 2000),
  cautions text check (cautions is null or length(cautions) <= 1000),
  image_url text check (image_url is null or (length(image_url) <= 500 and image_url like 'https://%')),
  video_url text check (video_url is null or (length(video_url) <= 500 and video_url like 'https://%')),
  active integer not null default 1 check (active in (0, 1)),
  created_by text,
  updated_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, settings_id) references public.pms_exercise_settings (tenant_id, id) on delete cascade
);
create index if not exists pms_exercises_name on public.pms_exercises (tenant_id, active, name);

alter table public.pms_exercise_settings enable row level security;
alter table public.pms_exercises enable row level security;

do $$
declare
  r text;
  t text;
begin
  foreach t in array array['pms_exercise_settings', 'pms_exercises'] loop
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on table public.%I from %I', t, r);
      end if;
    end loop;
  end loop;
end;
$$;
