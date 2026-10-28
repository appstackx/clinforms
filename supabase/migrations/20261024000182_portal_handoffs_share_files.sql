-- ClinForms 0182 (Postgres / Supabase): clinic system, portal module follow-up (M9b) - pms_intake_handoffs (a form
-- completed in the clinic on a clinic device, verified by a member of staff afterwards - only the SHA-256 of the
-- device's secret is stored) and pms_portal_share_files (a document shared in the portal that is a file attached to
-- the record). Never deleted. Kept in step with db/migrations/sqlite/0182_portal_handoffs_share_files.sql
-- (db/parity.test.ts). RLS on, no policies, Data API roles revoked. Idempotent.

create table if not exists public.pms_intake_handoffs (
  tenant_id text not null,
  id text not null,
  response_id text not null,
  patient_id text not null,
  token_hash text not null check (length(token_hash) = 64),
  status text not null default 'open' check (status in ('open', 'completed', 'verified', 'ended')),
  started_by text not null,
  expires_at timestamptz not null,
  completed_at timestamptz,
  verified_at timestamptz,
  verified_by text,
  ended_at timestamptz,
  ended_by text,
  write_id text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, response_id) references public.pms_intake_responses (tenant_id, id),
  foreign key (tenant_id, patient_id) references public.pms_patients (tenant_id, id)
);
create unique index if not exists pms_intake_handoffs_token on public.pms_intake_handoffs (tenant_id, token_hash);
create index if not exists pms_intake_handoffs_response on public.pms_intake_handoffs (tenant_id, response_id, created_at);

create table if not exists public.pms_portal_share_files (
  tenant_id text not null,
  share_id text not null,
  attachment_id text not null,
  created_at timestamptz not null,
  primary key (tenant_id, share_id),
  foreign key (tenant_id, share_id) references public.pms_portal_shares (tenant_id, id),
  foreign key (tenant_id, attachment_id) references public.pms_attachments (tenant_id, id)
);
create index if not exists pms_portal_share_files_attachment on public.pms_portal_share_files (tenant_id, attachment_id);

alter table public.pms_intake_handoffs enable row level security;
alter table public.pms_portal_share_files enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.pms_intake_handoffs, public.pms_portal_share_files from %I', r);
    end if;
  end loop;
end;
$$;
