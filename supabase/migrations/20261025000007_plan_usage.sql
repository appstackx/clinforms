-- ClinForms 0007 (Postgres / Supabase): packages and usage (25/10/2026) - clinic_package, clinic_usage,
-- usage_report, usage_event. Columns and their meaning: see db/migrations/sqlite/0007_plan_usage.sql (kept in step
-- with it). Idempotent. No patient data: ids, counts, prices and token totals only. Calendar dates (starts_on,
-- founding_until) and months (period, billable_period) are text (YYYY-MM-DD / YYYY-MM), as in SQLite.
-- Row level security on and no policies for anon/authenticated, like every other table.

create table if not exists public.clinic_package (
  tenant_id text not null primary key,
  package text not null check (package in ('starter', 'practice', 'group', 'group_plus', 'custom', 'trial')),
  monthly_price_pence integer not null check (monthly_price_pence >= 0 and monthly_price_pence <= 100000000),
  reports_included integer not null check (reports_included >= 0 and reports_included <= 1000000),
  extra_report_pence integer check (extra_report_pence is null or (extra_report_pence >= 0 and extra_report_pence <= 10000000)),
  founding_price_pence integer check (founding_price_pence is null or (founding_price_pence >= 0 and founding_price_pence <= 100000000)),
  founding_until text,
  setup_fee_pence integer check (setup_fee_pence is null or (setup_fee_pence >= 0 and setup_fee_pence <= 100000000)),
  setup_fee_status text check (setup_fee_status is null or setup_fee_status in ('due', 'paid', 'waived')),
  starts_on text not null,
  notes text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists public.clinic_usage (
  tenant_id text not null,
  period text not null check (length(period) = 7),
  package text,
  plan_price_pence integer,
  plan_reports_included integer,
  plan_extra_report_pence integer,
  reports_started integer not null default 0,
  reports_drafted integer not null default 0,
  reports_approved integer not null default 0,
  amendments_approved integer not null default 0,
  billable_reports integer not null default 0,
  billable_on_approval integer not null default 0,
  forms_read integer not null default 0,
  question_sets integer not null default 0,
  drafting_calls integer not null default 0,
  failed_calls integer not null default 0,
  reading_calls integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cache_read_tokens bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  cost_micro_usd bigint not null default 0,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, period)
);

create table if not exists public.usage_report (
  tenant_id text not null,
  report_id text not null,
  episode_fp text not null default '',
  root_report_id text not null,
  started_at timestamptz,
  first_drafted_at timestamptz,
  first_approved_at timestamptz,
  drafting_calls integer not null default 0,
  billable_period text,
  billable_at timestamptz,
  billable_via text check (billable_via is null or billable_via in ('drafted', 'approved')),
  started_event text,
  drafted_event text,
  approved_event text,
  billable_event text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, report_id, episode_fp)
);

create index if not exists usage_report_billable on public.usage_report (tenant_id, billable_period);

create table if not exists public.usage_event (
  id text not null primary key,
  tenant_id text not null,
  kind text not null,
  period text not null,
  created_at timestamptz not null
);

create index if not exists usage_event_created on public.usage_event (created_at);

alter table public.clinic_package enable row level security;
alter table public.clinic_usage enable row level security;
alter table public.usage_report enable row level security;
alter table public.usage_event enable row level security;

do $$
declare
  r text;
  t text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      foreach t in array array['clinic_package', 'clinic_usage', 'usage_report', 'usage_event'] loop
        execute format('revoke all on table public.%I from %I', t, r);
      end loop;
    end if;
  end loop;
end;
$$;
