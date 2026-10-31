# Billing (clinic system)

Internal. What the billing module does, where its code lives and the rules it keeps. Requirements: `requirements.md`
§3 BILL-*. Build contract: `contract.md`. Product name on screen only through `CLINIC_SYSTEM_NAME`.

## What it does

- **Invoices from the diary.** Chargeable visits (`CHARGEABLE_STATUSES`: completed, did not attend, late cancellation –
  the last two only with the fee flag) are read on the server from the diary adapter
  (`src/server/pms/diary/billing-visits.ts`); the browser sends appointment ids only, never amounts. Prices: the case's
  price list → the default list → the service's price. Insured visits bill the payer account; the patient's part is
  billed to the patient (see *Excess modes*). DNA and late-cancellation fees always bill the patient.
- **States.** Draft → issued → part paid / paid / overdue; credit notes of kind credit, write-off, void, transfer.
  Void is refused while payments are on the invoice. Numbers: clinic prefix + 5 digits (≤ 10 characters), sequential.
- **Payments.** Card on file (saved TEST card), card now, cash with change, bank transfer, payment link; refunds to the
  card through the test provider; remittances from payers allocated per invoice (leave / write off / move to patient).
- **Documents.** A4 print pages for invoices and statements (print stylesheet; "Save as PDF"); react-pdf PDFs
  (`src/server/pms/billing/pdf.tsx`) for emailed documents.
- **Reports and exports.** Aged debt, statements, "attended, not invoiced", the invoice list CSV (`reports.export`,
  formula-looking cells defused, audited).
- **Insurer claims (BILL-011).** Billing → *Insurer claims* (`/app/clinic/billing/claims`): a payer account and invoice
  dates → the issued invoices to claim → *Download claims file (CSV)*, one row per treatment with membership number,
  claim reference and authorisation code. Each invoice is logged as sent (`pms_invoice_exports`, audit row in the same
  batch). **Healthcode e-billing is listed as not connected and never sends** – a real connection needs this system's
  own Healthcode registration and agreement (a commercial step, Khuram's decision).

## Excess modes (Khuram, 28/10/2026)

Per payer account (`pms_payer_billing_terms`), overridable per case (`pms_case_billing_terms`):

- **Excess per case** (default): one amount (the case's `excess_pence`) used up visit by visit from the first visits.
- **Patient contribution per visit**: a fixed amount on every visit; the insurer pays the rest.

A visit the patient's part covers in full is billed to the patient only – no £0 insurer invoice or line, nothing taken
off the authorisation's value. Authorisation *sessions* are counted once, by the diary on completion; billing counts
value.

## Tables (migrations 0130–0138, each with its Postgres twin in `supabase/migrations/2026102400013N_*.sql`)

| Migration | Tables / columns |
|---|---|
| 0130 | `pms_billing_settings`, `pms_service_vat`, `pms_invoices`, `pms_invoice_lines`, `pms_credit_notes`, `pms_credit_note_lines` |
| 0131 | `pms_payments`, `pms_payment_allocations`, `pms_payment_links`, `pms_invoice_exports` |
| 0132 | credit note kinds (credit / write_off / void / transfer) |
| 0133, 0135 | `site_id` on invoices and payments (site scope) |
| 0134 | `pms_invoices.voided_at` |
| 0136 | `pms_saved_cards` (TEST cards only) |
| 0137 | `pms_payer_billing_terms`, `pms_case_billing_terms` |
| 0138 | `pms_invoices.per_visit_contribution_pence` |

Every table: `tenant_id` first in the primary key and every foreign key; money in whole pence; free text that may hold
personal detail in `_enc` columns.

## Permissions

`billing.view` (look), `billing.edit` (draft, issue), `billing.pay` (take payments, remittances), `billing.refund`
(refunds, credit notes, write-offs), `billing.void`, `reports.export` (CSV and the claims file), `settings.setup`
(payer-account billing terms). Every read applies the member's sites (`actor.siteIds`); out of scope reads as "no such
invoice".

## Rules kept

- Permission first, then ids read back from the member's clinic and sites, zod on input, plain-English errors.
- Every write has its audit row **in the same batch** (conditional `INSERT … WHERE EXISTS` – `billingAuditWhen`);
  audit rows hold ids and counts, never patient data.
- **Test mode only.** Card payments go through `stripe_test` (`src/server/pms/billing/payments/`), which refuses a live
  key. Live card payments need the clinic system's own Stripe account (one account per product – CLAUDE.md), not
  set up yet.

## Where the code lives

| Part | Path |
|---|---|
| Pure rules (VAT, numbering, states, aged debt, statements, excess, claims CSV) | `src/modules/pms/billing/` |
| Repositories | `src/server/repos/pms/billing/` |
| Server layer (views, writes, access, PDFs, e-billing channels, claims) | `src/server/pms/billing/` |
| Screens | `src/app/app/clinic/billing/**`, `src/components/pms/billing/**`, record Invoices tab |
| Seed | `scripts/pms/seed-billing.ts` |
| Tests | billing repo suite + service suite on SQLite, PGlite, the D1 stand-in and local D1; e2e `scripts/e2e/pms-billing-screens.cjs` |
