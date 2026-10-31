-- ClinForms 0009 (SQLite / Cloudflare D1): subscription billing for ClinDesk and ClinForms (31/10/2026). Kept in
-- step with supabase/migrations/20261031000009_clinic_billing.sql. Idempotent. No patient data: payment service
-- references, plan keys, dates, counts and pence only. Written by the billing code only (src/server/billing), from
-- the payment service's own copy of each subscription (re-read on every webhook event and on the success page).
--
-- clinic_subscription - one row per clinic: its ONE subscription at the payment service (ClinDesk band +
--   optional Reports add-on, or ClinForms on its own).
--   mode                test | live (a test-mode row never counts once live billing is on)
--   status              the payment service's status (active, trialing, past_due, unpaid, canceled, incomplete ...)
--   state               ours: pending_payment | active | past_due | canceled | expired (src/lib/billing/plans.ts)
--   product / plan_key / billing_interval / reports_key   the plan (clindesk solo..multisite month|year +
--                       reports 25..500, or clinforms starter..group_plus)
--   reports_included    the allowance a month from the price metadata (NULL = no ClinForms in the plan)
--   practitioners_max   the ClinDesk band's top (a warning above it, never a block)
--   amount_pence        what one billing period costs, ex VAT
--   activated_at        when the first payment cleared (a Direct Debit takes days) - nothing is switched on before
--   past_due_since / grace_until   a failed payment: everything works until grace_until (7 days), then read-only
--   grace_notified_at / read_only_notified_at   the owner emails, sent once each
--   override            1 = ClinForms staff manage the clinic's packages by hand (admin scripts / platform page):
--                       the subscription is recorded but changes no package and puts no hold on the account
--   applied_json        what the subscription last set (packages, allowance) - compared so a change is audited once
--
-- clinic_billing_extras - extra reports billed per clinic and UK month (period YYYY-MM), once each: the month's
--   count above the allowance (clinic_usage) added as extra_report invoice items to the next invoice.
--   status pending | billed | skipped; invoice_item_ref is the payment service's item (unique).

CREATE TABLE IF NOT EXISTS clinic_subscription (
  tenant_id TEXT NOT NULL PRIMARY KEY,
  customer_ref TEXT NOT NULL,
  subscription_ref TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('test', 'live')),
  status TEXT NOT NULL CHECK (length(status) BETWEEN 1 AND 30),
  state TEXT NOT NULL CHECK (state IN ('pending_payment', 'active', 'past_due', 'canceled', 'expired')),
  product TEXT CHECK (product IS NULL OR product IN ('clindesk', 'clinforms')),
  plan_key TEXT,
  billing_interval TEXT CHECK (billing_interval IS NULL OR billing_interval IN ('month', 'year')),
  reports_key TEXT,
  reports_included INTEGER CHECK (reports_included IS NULL OR reports_included >= 0),
  practitioners_max INTEGER CHECK (practitioners_max IS NULL OR practitioners_max > 0),
  amount_pence INTEGER CHECK (amount_pence IS NULL OR amount_pence >= 0),
  current_period_start TEXT,
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK (cancel_at_period_end IN (0, 1)),
  canceled_at TEXT,
  ended_at TEXT,
  activated_at TEXT,
  past_due_since TEXT,
  grace_until TEXT,
  grace_notified_at TEXT,
  read_only_notified_at TEXT,
  override INTEGER NOT NULL DEFAULT 0 CHECK (override IN (0, 1)),
  override_note TEXT CHECK (override_note IS NULL OR length(override_note) <= 200),
  applied_json TEXT,
  last_event_ref TEXT,
  last_synced_at TEXT,
  rev INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS clinic_subscription_ref ON clinic_subscription (subscription_ref);
CREATE INDEX IF NOT EXISTS clinic_subscription_customer ON clinic_subscription (customer_ref);

CREATE TABLE IF NOT EXISTS clinic_billing_extras (
  tenant_id TEXT NOT NULL,
  period TEXT NOT NULL CHECK (length(period) = 7),
  subscription_ref TEXT NOT NULL,
  reports_counted INTEGER NOT NULL CHECK (reports_counted >= 0),
  reports_included INTEGER NOT NULL CHECK (reports_included >= 0),
  extra_reports INTEGER NOT NULL CHECK (extra_reports >= 0),
  unit_pence INTEGER NOT NULL CHECK (unit_pence >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'billed', 'skipped')),
  invoice_item_ref TEXT,
  invoice_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, period)
);
CREATE UNIQUE INDEX IF NOT EXISTS clinic_billing_extras_item ON clinic_billing_extras (invoice_item_ref);
