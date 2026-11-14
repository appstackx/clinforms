-- ClinForms 0011 (Postgres / Supabase): the self-serve 14-day free trial (13/11/2026, behind CLINFORMS_SELF_SIGNUP,
-- off by default) - self_trial (what each self-serve trial was given, its sample clinic, tips switch, conversion),
-- trial_report_hold (free-report reservations) and trial_email (claimed rows per email: never sent twice). Columns and their meaning: see
-- db/migrations/sqlite/0011_self_trial.sql (kept in step with it). New table names: the parked 0010_lifecycle_email
-- tables (lifecycle_email, lifecycle_email_pref - already on production, empty) are not touched. Idempotent. No patient
-- data. Row level security on and no policies for anon/authenticated, like every other table.

create table if not exists public.self_trial (
  tenant_id text not null primary key,
  brand text not null check (brand in ('clinforms', 'clinic')),
  sample_of text,
  email_key text not null,
  network_key text not null,
  domain_key text,
  reports_included integer not null check (reports_included between 0 and 1000),
  texts_granted integer not null check (texts_granted between 0 and 1000),
  reports_reserved integer not null default 0 check (reports_reserved >= 0),
  repeat_reason text check (repeat_reason is null or repeat_reason in ('email', 'network', 'domain')),
  sample_tenant_id text,
  sample_state text check (sample_state is null or sample_state in ('creating', 'ready', 'declined')),
  sample_claimed_at timestamptz,
  sample_step integer not null default 0 check (sample_step between 0 and 20),
  tips_off_at timestamptz,
  converted_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create index if not exists self_trial_email on public.self_trial (email_key);
create index if not exists self_trial_network on public.self_trial (network_key, created_at);
create index if not exists self_trial_domain on public.self_trial (domain_key, created_at);

create table if not exists public.trial_report_hold (
  tenant_id text not null,
  report_key text not null,
  episode_fp text not null default '',
  held_at timestamptz not null,
  primary key (tenant_id, report_key, episode_fp)
);

create table if not exists public.trial_email (
  tenant_id text not null,
  kind text not null check (kind in ('welcome', 'tips', 'four_days', 'last_day', 'ended', 'paid')),
  recipient_ref text not null default '',
  status text not null check (status in ('claimed', 'sent', 'failed', 'skipped')),
  attempts integer not null default 1 check (attempts between 1 and 10),
  recipients integer not null default 0 check (recipients >= 0),
  claimed_at timestamptz not null,
  sent_at timestamptz,
  primary key (tenant_id, kind, recipient_ref)
);
create index if not exists trial_email_kind on public.trial_email (kind, claimed_at);

alter table public.self_trial enable row level security;
alter table public.trial_email enable row level security;
alter table public.trial_report_hold enable row level security;

do $$
declare
  r text;
  t text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      foreach t in array array['self_trial', 'trial_email', 'trial_report_hold'] loop
        execute format('revoke all on table public.%I from %I', t, r);
      end loop;
    end if;
  end loop;
end;
$$;
