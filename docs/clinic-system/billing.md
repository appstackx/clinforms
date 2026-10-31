# Subscription billing – ClinDesk and ClinForms (runbook)

**Internal.** 31/10/2026, branch `feat/clindesk-billing` (on `feat/clindesk-sms-credits` + `main`). Not merged, not
deployed. Text credits: [`SMS-CREDITS.md`](SMS-CREDITS.md) (same payment account, same key, same webhook).

## 1. What it does

- **One payment account for both products** (`acct_1UWi2yLYNzei2exh`, public name ClinDesk, descriptor `CLINDESK` –
  CLAUDE.md's deliberate exception). **One customer per clinic** (shared with text credits:
  `pms_sms_credit_accounts.customer_ref` + its mode) and **one subscription per clinic** with one or two items.
- **Plans** (prices ex VAT, GBP, found by lookup key and checked against `src/lib/billing/plans.ts` before every
  checkout – amount, interval, `reports_included` metadata):

  | Plan | Practitioners | Monthly | Yearly (10×) | Lookup keys |
  |---|---|---|---|---|
  | ClinDesk Solo | 1 | £39 | £390 | `clindesk_solo_monthly` / `_yearly` |
  | ClinDesk Small | 2–5 | £89 | £890 | `clindesk_small_*` |
  | ClinDesk Practice | 6–10 | £169 | £1,690 | `clindesk_practice_*` |
  | ClinDesk Group | 11–25 | £299 | £2,990 | `clindesk_group_*` |
  | ClinDesk Multi-site | 26–60 | £499 | £4,990 | `clindesk_multisite_*` |
  | Reports add-on 25 / 100 / 250 / 500 a month | – | £79 / £159 / £279 / £439 | **monthly only** | `clindesk_reports_<n>_monthly` |
  | ClinForms Starter / Practice / Group / Group Plus (25/100/250/500) | – | £99 / £199 / £349 / £549 | – | `clinforms_<tier>_monthly` |
  | Extra report above the allowance | – | £1.50 each | – | `extra_report` (one-off) |

  **Decision:** the hosted payment page refuses mixed billing intervals in one subscription (checked against the
  account: "Checkout does not support multiple prices with different billing intervals", also with flexible billing
  mode). So a **yearly ClinDesk plan cannot take the Reports add-on** – the screen disables it and says "The Reports
  add-on is billed monthly. Choose monthly billing to add it." (`choiceProblem`). `clinforms_setup` (£250) is not sold
  online – add it by hand as an invoice item when agreed.
- **Plan and billing** (`/app/settings/billing`, owners and admins, both brands; nav "Plan and billing"): current plan,
  status, price, next payment (DD/MM/YYYY), notices; choose a plan (ClinDesk band monthly/yearly + optional Reports
  add-on, or ClinForms on its own – the default follows the clinic's packages / host, `?product=` switches); the hosted
  payment page in **subscription mode** (card incl. wallets, Bacs Direct Debit, Revolut Pay – the account's settings);
  success page `/done` (re-reads and applies at once, idempotent with the webhook), `/cancelled`; **Manage billing** =
  the hosted billing page (card / Direct Debit details, invoices, cancel at period end; a configuration with
  `metadata.app=clindesk` is created on first use; plan changes stay in the app). A running plan is **changed** (items
  replaced, prorated on the next invoice), never bought twice. No vendor name on screen (neutral-wording test now bans
  "stripe" in the screens).
- **Entitlements follow the subscription** (`src/server/billing/sync.ts`, re-read from the payment service every time):

  | Subscription | Packages |
  |---|---|
  | **active** (first invoice paid) | ClinDesk band → `clinic` active (`plan_code` `clindesk-<band>`, `limits.practitioners_max`); Reports add-on / ClinForms tier → `reports` active + `clinic_package` (allowance from the price's `reports_included`, extra £1.50); ClinDesk without the add-on → `reports` **paused**; ClinForms on its own leaves `clinic` alone (cancelled if this subscription had switched it on); a running 3-day trial is converted (`paid`) |
  | **pending_payment** (Bacs not cleared, incomplete) | **nothing switched on** – Bacs activates only on its cleared payment (`checkout.session.async_payment_succeeded` / `invoice.paid` / the subscription update that follows) |
  | **past_due / unpaid** | everything works for **7 days** (owner + admins emailed once, banner), then **read-only** (§4) until paid; paid → "payment received" email |
  | cancel at period end | the packages get the period end as `ends_at` (they switch off by themselves); "cancelled" email |
  | **canceled** | packages the subscription switched on → `cancelled` (no data deleted) |

  Every change is audited (ids, plan keys, states only): `clinic.subscription_<state>`, `clinic.package_change`,
  `clinic.package_set/removed`, `clinic.trial_converted`, `clinic.subscription_checkout/change`, `clinic.billing_portal`,
  `clinic.extra_reports_billed` (activity labels in `src/lib/activity-copy.ts`; actor "Automatic").
- **Seat band check**: active practitioners (`pms_practitioners.active`) above the band → warning with the suggested
  band on Plan and billing and a banner for owners/admins (ClinDesk shell, clinic area, Studio). **Never blocks.**
- **Extra reports** (`src/server/billing/extras.ts`) – decision: per completed **UK calendar month**, exactly what
  "Plan & usage" shows (`clinic_usage.billable_reports` − `plan_reports_included`), as **one invoice item**
  (`extra_report` × count) on the subscription's renewal invoice: on `invoice.created` (billing_reason
  `subscription_cycle`, still a draft for ~1 hour) every completed month since activation that has no
  `clinic_billing_extras` row is billed (row first, idempotency key `extra-<clinic>-<YYYY-MM>`, then marked billed with
  the item id – unique). A missed renewal catches up next month; months without extras are recorded `skipped`.
- **Platform page** `/app/platform/billing` (link "Subscriptions" on /app/platform): every clinic's plan, status, next
  payment / end, grace or READ-ONLY, practitioners vs band, test/live, override; buttons **Re-read** (apply the
  service's current copy) and **Manage by hand (override)** / **Follow the subscription again**.

## 2. Manual overrides (platform overrides win)

`clinic_subscription.override = 1` → the subscription is still recorded (state, next payment) but changes **no
package** and puts **no hold** on the account. Switched on:
- explicitly – platform page, or `npm run admin:set-billing-override -- --slug <id> --on [--note "…"]`;
- **automatically by any manual change** for a clinic with a running subscription: `admin:set-entitlement`,
  `admin:set-package`, the platform page's package switches and package form (`src/server/admin/billing.ts
  overrideForManualChange`; the script prints "billing override is now ON").

Switched off only explicitly (`… --off` or the platform button), which re-applies the subscription at once (forced, so
the manual settings are replaced) when payments are configured, else at its next event. Trials (`admin:set-trial`) and
drafting limits are independent of the override (a paid subscription converts a running trial). Audited twice
(`clinic.billing_override_on|off`, `platform.billing_override_on|off`).

## 3. One webhook

**`POST /api/billing/stripe-webhook`** (`src/server/billing/webhook.ts`) handles subscriptions **and** text credits.
`/api/clinic-messages/credit-payments` is now an **alias** of the same handler (an endpoint registered there keeps
working – move it to the new URL at go-live and delete the old endpoint). 503 until key + signing secret are set; 400
without a valid signature (5 minutes); every object **re-read** with our key; checked: clinic id in the metadata (and
`client_reference_id` on checkouts), the clinic's own customer in the same mode, prices we sell, the key's mode; a
refused **paid** object → 200 + payment alert (platform audit `platform.payment_alert` + email to
`CLINFORMS_PLATFORM_ADMINS`). Idempotent (state re-applied; extras once per month; credits once per event/payment).

**Events to register** (Developers → Webhooks → endpoint `https://clindesk.co.uk/api/billing/stripe-webhook`, API
version `2026-10-28.endive`): `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, `customer.subscription.created`, `customer.subscription.updated`,
`customer.subscription.deleted`, `invoice.created`, `invoice.paid`, `invoice.payment_failed`, `payment_intent.succeeded`.

## 4. Read-only (payment overdue past the grace period)

`src/server/billing/access.ts` (`holdOf`): state past_due, `grace_until` (past_due_since + 7 days) passed, no override,
not a test-mode row once live billing is on. Then: every clinic-system server action whose permission is not a
`.view` permission answers "Your account is read-only because a payment for your plan is overdue…"
(`clinicActionActor` → `read_only`); ClinForms' Report API refuses anything new with **403 `PAYMENT_OVERDUE`** (same
places as an ended trial; existing reports open and download). Plan and billing always works. Fail open: an unreadable
table never blocks clinical work. **Note for Khuram:** read-only also stops clinical notes being written – to give a
clinic more time, switch the override on (it lifts the hold).

## 5. Tables (migration 0009)

`db/migrations/sqlite/0009_clinic_billing.sql` + `supabase/migrations/20261031000009_clinic_billing.sql` (RLS on,
anon/authenticated revoked): **`clinic_subscription`** (one row per clinic; mode, status, our state, plan, allowance,
band max, amount, period, cancel, activated, past due / grace, notices, override, applied packages, last event) and
**`clinic_billing_extras`** (per clinic and month; unique item id). Plus text credits' 0144/0145 (mode columns).
Offboarding: the rows stay with a closed clinic's id (billing records); with `--release-slug` they are deleted in a
batch after the main one. **Cancel the clinic's subscription in the Dashboard before offboarding.**

## 6. Environment variables (names only)

| Variable | Meaning |
|---|---|
| `STRIPE_CLINDESK_SECRET_KEY` | the account's key (test until go-live; restricted key needs Checkout Sessions, Customers, Subscriptions, Invoices, Invoice Items, Prices read, Billing Portal, Payment Intents, Payment Methods) |
| `STRIPE_CLINDESK_WEBHOOK_SECRET` | the ONE endpoint's signing secret |
| `STRIPE_CLINDESK_ALLOW_LIVE` | `1` lets a live key work (go-live) |
| `CLINDESK_BILLING_LIVE` | `1` = live billing only: a test key is refused, test-mode rows never count (after the go-live clean-up) |
| `CLINFORMS_PLATFORM_ADMINS` | also the recipients of payment alerts |
| `STRIPE_CLINDESK_API_BASE` | local tests only |

Local: test key `STRIPE_CLINDESK_TEST_SECRET_KEY` in `~/.config/appstackx/clinforms.secrets.env` (never printed).

## 7. Go-live (exact order)

1. **Dashboard (live mode, ClinDesk account)**: activate the account; check public details (ClinDesk, descriptor
   CLINDESK, support `hello@clindesk.co.uk`) are not another product's (CLAUDE.md); recreate the catalogue **in live
   mode with the same lookup keys, amounts, intervals and metadata** (`reports_included` on the reports and ClinForms
   prices; `sms_credits` on the packs; `extra_report` one-off £1.50; tax behaviour exclusive) – the code refuses any
   mismatch. Payment methods: card (+ wallets), Bacs Direct Debit (needs the Bacs mandate set-up in live), Revolut Pay.
   **VAT:** decide (Stripe Tax or tax rates) – nothing adds VAT today (prices are ex VAT).
2. **Webhook endpoint (live)**: `https://clindesk.co.uk/api/billing/stripe-webhook`, the 10 events of §3, API version
   `2026-10-28.endive` → copy the signing secret. (Delete the old `/api/clinic-messages/credit-payments` endpoint once
   the new one shows deliveries.)
3. **Migrations BEFORE the code**, on Supabase (session pooler, as M11-RUNSHEET §4):
   `CLINFORMS_DB=postgres npm run db:migrate` – applies **0009** (subscriptions), **0144**, **0145** (text credit mode
   columns); D1 previews `CLINFORMS_DB=d1 npm run db:migrate -- --d1-env preview`.
4. **Deploy** the code (merge to `main` = production – Khuram's go).
5. **Clean-up of test mode**: `npm run admin:billing-go-live -- --env production` (preview – read it), then
   `npm run admin:billing-go-live -- --env production --confirm --yes`: test customers/cards forgotten, test-mode
   credit packs reversed (reason "Test-mode payment reversed at go-live"), test-mode subscriptions ended and the
   packages they switched on cancelled (overridden clinics untouched). Re-set any internal clinic by hand afterwards.
6. **Vercel Production env**: `STRIPE_CLINDESK_SECRET_KEY` = live key, `STRIPE_CLINDESK_WEBHOOK_SECRET` = live secret,
   `STRIPE_CLINDESK_ALLOW_LIVE=1`, `CLINDESK_BILLING_LIVE=1` (Sensitive). Redeploy.
7. **Smoke** on the internal clinic: choose ClinDesk Solo monthly with a real card → active, packages on; Manage
   billing opens; cancel at period end in the billing page → "Ends on"; refund in the Dashboard; set the internal
   clinic back by hand (override on).

## 8. Known limits

- Plan changes are prorated onto the next invoice (not charged at once); a downgrade credits the difference.
- The last part-month's extra reports after a subscription ends are not billed (no further invoice) – add by hand.
- No dunning beyond the payment service's own retries; the read-only email goes when the next sync after the grace
  period runs (a retry's `invoice.payment_failed`, the success page or "Re-read").
- One subscription per clinic: a second running subscription for the same customer (made outside the app) is ignored
  once it is older than the recorded one.
- `clinforms_setup` is not sold online.

## 9. Code map and tests

| What | Where |
|---|---|
| Plans, prices, states (pure) | `src/lib/billing/plans.ts` |
| Payment service (fetch, pinned version, shared config) | `src/server/billing/payments.ts` (+ `paymentsHttp` in `src/server/pms/comms/credits/card-payments.ts`) |
| Sync / entitlements | `src/server/billing/sync.ts`; hold `access.ts`; extras `extras.ts`; emails `notify.ts` (+ `billingNoticeEmail`); banner `banner.ts`; go-live `go-live.ts` |
| Webhook | `src/server/billing/webhook.ts`, `webhook-route.ts`; routes `src/app/api/billing/stripe-webhook`, alias `src/app/api/clinic-messages/credit-payments` |
| Screens | `src/app/app/(clinic)/settings/billing/{page,forms,actions,done,cancelled}`; banner `src/components/account/billing-banner.tsx` |
| Platform | `src/app/app/platform/billing/*`, `src/server/admin/billing.ts`; scripts `admin:set-billing-override`, `admin:billing-go-live` |
| Repos | `src/server/repos/clinic-subscription.ts` |
| Unit tests (payment service mocked) | `src/server/billing/billing.test.ts` → `testing/billing-suite.ts` on SQLite + PGlite (test:db) |
| Browser, real TEST mode | `scripts/e2e/billing-subscriptions.cjs` (card 4242, Bacs 10-88-00 / 00012345, `stripe listen` forwarding to the one webhook) |
