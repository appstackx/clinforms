# Decision: Xero sync scope (tracker xe02)

Status: proposed, 11/11/2026. Owner: Khuram. Covers ClinDesk (clinic system) billing → Xero.

## Recommendation

1. **v1 sends data one way, from ClinDesk to Xero.** ClinDesk stays the system of record for billing. Nothing is
   read back from Xero except setup lists (accounts, tax rates, tracking categories, organisation).
2. **v1 sends four things:** issued invoices, credit notes (all four kinds), payment and refund allocations, and the
   contacts those need (patients and payer accounts). It sends no account codes. Instead, the clinic **maps** its
   services, payment methods and sites to accounts, tax rates and tracking options that already exist in Xero.
3. **Invoices go to Xero as AUTHORISED, with ClinDesk's own number** (`number_prefix` + `number_seq`). TM3 sends
   drafts and only new transactions (docs/strategy/tm3-feature-comparison.md, line 212). Xero cannot attach a
   payment to a draft, so authorised invoices are what let payments sync.
4. **Each send is queued in the same database transaction as the billing action** (an outbox). A worker sends it
   straight away and retries from a list. When a send fails, the clinic sees a plain-English message with Retry and
   Skip buttons.
5. **Each clinic connects one Xero organisation**, using the standard OAuth 2.0 code flow with a client secret
   (server-side app, not PKCE). The app requests the minimum granular scopes. Tokens are encrypted with the existing
   data envelope.
6. **Xero tier:** start on **Starter** (free, 5 connections) for the build and the pilot. Move to **Core** (AUD 35 a
   month, 50 connections) before the 6th clinic connects, which needs certification (xe07).

## What ClinDesk has today (read from the repo)

| Area | Tables / columns (Supabase `supabase/migrations`, SQLite twin in `db/migrations/sqlite`) |
| --- | --- |
| Settings | `pms_billing_settings`: `vat_registered`, `vat_number`, `prices_include_vat`, `invoice_prefix`, `credit_note_prefix`, terms days |
| VAT per service | `pms_service_vat (service_id, vat_code)`. Codes are `exempt` / `standard` / `reduced` / `zero`, plus `none` on lines. Rates live in `src/modules/pms/billing/vat.ts` (basis points, rounded per line) |
| Invoices | `pms_invoices`: `status` draft / issued / cancelled; `bill_to` patient / payer; `payer_type` self_pay / insurer / mlc / solicitor / employer / other; `payer_referrer_id`; `patient_id`; `site_id`; `issued_on`; `due_on`; `net_pence` / `vat_pence` / `total_pence` / `paid_pence` / `credited_pence`; `prices_include_vat`; `voided_at`; `exported_at` (Healthcode/CSV). An issued invoice is never edited; a credit note changes it instead (`src/server/repos/pms/billing/invoices.ts` header) |
| Lines | `pms_invoice_lines`: `kind` service / item / excess / excess_deduction (negative); `service_id`; `practitioner_id`; `service_on`; `visit_status` (DNA, late cancellation); `quantity`; `unit_price_pence`; `discount_pence`; `vat_code`; `vat_rate_bp`; net / VAT / total; `description_enc` (encrypted free text) |
| Credit notes | `pms_credit_notes`: `invoice_id`, own number, `kind` credit / write_off / void / transfer, totals, `reason_enc`. Lines are in `pms_credit_note_lines` (`invoice_line_id`) |
| Payments | `pms_payments`: `kind` payment / refund; `status` recorded / reversed; `payer_kind` patient / account; `method` card / cash / bank_transfer / cheque / online / other; `site_id`; `provider` / `provider_ref`. Money is spread with `pms_payment_allocations (payment_id, invoice_id, amount_pence ±, reversed)`; the rest stays "on account" |
| Payers | `pms_referrers` (`kind` includes insurer, mlc, solicitor, employer…; name, email, address_json), `pms_payer_healthcode` |
| Patients | `pms_patients` (`patient_number`, names, email, address_json, `merged_into_id`, `status`) |
| Sites | `pms_sites (id, name, code, active)` |
| Audit | `audit_log` via `pmsAuditQuery`; billing codes in `src/modules/pms/audit/billing.ts`. Details hold ids, counts and amounts only, never names |
| Crypto | `src/server/crypto/envelope.ts` (AES-256-GCM, per-tenant HKDF subkey, AAD tenant:table:row). `encryptField` lives in `src/server/repos/pms/context.ts` |
| Scheduling | Vercel cron (`vercel.json`), but only one job: daily retention. Hobby plan crons run once a day, so a retry loop needs another trigger (see below) |

## Object mapping (v1, push only)

| ClinDesk | Xero object | When it syncs | How it maps |
| --- | --- | --- | --- |
| Patient (self-pay `bill_to = patient`) | Contact | Just before that patient's first invoice is sent | `ContactNumber = CD-P{patient_number}`; Name = "First Last (P1234)", which keeps it unique; email and address only if the clinic ticks "send contact details" |
| Payer account (`pms_referrers`, `bill_to = payer`) | Contact | Before that payer's first invoice. The clinic can link an existing Xero contact on the mapping screen | `ContactNumber = CD-R{short id}`; name, email and address from the referrer |
| Issued invoice | Invoice `Type=ACCREC`, `Status=AUTHORISED` | When `pms.invoice.issue` runs (drafts and cancelled drafts are never sent) | `InvoiceNumber` = ClinDesk number; `Date` = `issued_on`; `DueDate` = `due_on`; `Reference` = authorisation number if there is one, else the patient number; `LineAmountTypes` = Inclusive / Exclusive from `prices_include_vat`, NoTax when the clinic is not VAT-registered |
| Invoice line | LineItem | With its invoice | Description = service name + `service_on` (never `description_enc`, diagnosis or notes); `AccountCode` from the service map; `TaxType` from the tax map; `TaxAmount` sent as stored so Xero's figure matches to the penny; Tracking = site option; `excess_deduction` is sent as a negative line on the same account |
| Credit note `credit` / `void` | CreditNote `ACCRECCREDIT` + allocation to its invoice | On `pms.credit_note.create` / `pms.invoice.void` | Own number; lines use the same account and tax as the invoice lines they credit; allocated up to the invoice's amount due in Xero, with any rest left on the credit note |
| Credit note `write_off` | CreditNote + allocation | On `pms.invoice.write_off` | Lines go to the mapped **write-off account** (e.g. Bad debts) |
| Credit note `transfer` | CreditNote on the payer invoice + allocation | On `pms.invoice.transfer` | The patient's new invoice is sent as its own invoice when it is issued |
| Payment allocation (+) | Payment (one per allocation) | On `pms.payment.allocate` / `pms.payment.record` | `Invoice` + `Account` = the bank or clearing account mapped for the payment `method` (optionally per site); `Date` = `received_on`; `Amount` = allocation; `Reference` = payment reference |
| Refund allocation (−) | Payment against the CreditNote (refund) | On `pms.refund.record` | Paid from the account mapped for its method |
| Payment reversed / allocation taken off | Payment set to DELETED | On `pms.payment.reverse` / `pms.payment.unallocate` | Uses the stored Xero PaymentID |
| Money left "on account" (unallocated) | not sent in v1 | Sent once it is allocated | Sending it now would need Overpayments or Prepayments and the bank-transactions scope |

### Mapping rules (the xe04 screen)

| Map | Key → Xero value | Default / rule |
| --- | --- | --- |
| Revenue account | each `pms_services` row → `AccountCode` (REVENUE type) | One required default; per-service overrides are optional. `item` lines use the default "Items" account. An optional DNA / late-cancellation account applies when `visit_status` is set |
| Write-off account | one → `AccountCode` | Required before any write-off is sent |
| Payment accounts | each `method` (and optionally `site_id`) → bank account with `EnablePaymentsToAccount` | Required for each method in use. Card and online payments usually go to a "Stripe clearing" account |
| Tax rates | `vat_code` → `TaxType` | Pre-filled from `GET /TaxRates`: standard → OUTPUT2, reduced → RROUTPUT, exempt → EXEMPTOUTPUT, zero → the org's zero-rated income type, none → NONE. **Check these against the Demo Company.** Xero cannot create tax rates through the API; the clinic picks an existing one |
| Tracking | `pms_sites.id` → one option of one tracking category | Optional, and pre-matched by site name. Xero allows 2 active categories, so a practitioner category is left for later |
| Currency | org base currency must be GBP | Checked when the clinic connects; it is blocked if not |

Nothing is sent until the required maps are complete. A send with a gap is **blocked** (it stays on the list and is
not retried) and the clinic sees what to fix.

### Contacts: creation and de-duplication

1. Look up the local link (`pms_xero_links`). If found, use that ContactID.
2. Otherwise `GET /Contacts?searchTerm=CD-P1234`, or search by ContactNumber. Link the first exact match.
3. **Payers only:** if no match, offer an exact case-insensitive name match on the mapping screen ("AXA Health
   already exists in Xero – link it?"). Insurers usually already exist in a clinic's Xero.
4. Otherwise create the contact. Name collisions are avoided by the "(P1234)" suffix for patients.
5. **Merged patients** (`merged_into_id`): old invoices keep the old contact, new invoices use the survivor's
   contact. Contacts are never merged in Xero from ClinDesk.
6. A changed name or email updates the Xero contact when its next invoice is sent. A hash of the sent fields is
   stored so nothing changes needlessly.

## Sync mechanics

| Topic | Design |
| --- | --- |
| Trigger | Each billing action adds a `pms_xero_sync_items` row in the same `runBatch` transaction, so nothing is missed. After the response, Next.js sends it at once. A scheduled Cloudflare Worker (`workers/`) calls `/api/xero/drain` every 5 min for retries, because Vercel Hobby crons run once a day |
| Order | Per tenant, one at a time: contact → invoice → credit note → payment. A child waits (`blocked_by`) until its parent has a Xero ID |
| Batching | Invoices and payments are sent in batches (`summarizeErrors=false`) when there is a backlog, so one bad row does not fail the batch |
| Idempotency | `Idempotency-Key` header (max 128 chars) = `cd:{tenant}:{type}:{id}:v{n}`. Before re-creating an invoice whose earlier attempt timed out, the worker also checks `InvoiceNumber` |
| Rate limits | Per Xero org: 5 calls in progress at once, 60 a minute, 5,000 a day (1,000 on Starter); 10,000 a minute across the whole app. HTTP 429 means wait for `Retry-After`. The drain runs one worker per tenant and stops at 80 % of the daily cap |
| Retry list | Statuses `pending`, `in_flight`, `done`, `failed`, `blocked`, `skipped`. Back-off 1 min, 5 min, 30 min, 2 h, 12 h, then `failed` |
| Error classes | **transient** (429, 5xx, timeout) retries by itself. **validation** (missing map, archived account, locked period, contact archived) goes to `blocked` and waits for a fix plus Retry. **auth** (refresh failed, connection removed in Xero) pauses the tenant and shows a "Reconnect Xero" banner |
| Screen | Settings › Xero › "Sync" shows counts, failures with Xero's message in plain words, and Retry / Skip buttons (both audited). The same list feeds a daily email to owners if anything has failed |
| Start date | The clinic picks a "send from" date when connecting (default: today). Only invoices issued on or after it are sent, and their later payments and credits follow. Backfill is out of scope |
| Audit | New codes `pms.xero.connect`, `.disconnect`, `.mapping_set`, `.push` (counts), `.retry`, `.skip`, in a new `src/modules/pms/audit/xero.ts`. Details hold ids and counts only |

## Connection, scopes and tokens (xe03)

| Item | Decision |
| --- | --- |
| Flow | Standard authorisation-code flow with the client secret on the server, plus a `state` value tied to the session. PKCE is meant for apps that cannot keep a secret (mobile, desktop, single-page), and ClinDesk can |
| Scopes | `openid profile email offline_access accounting.invoices accounting.payments accounting.contacts accounting.settings.read`. Apps created after 2 March 2026 can only use granular scopes, and `accounting.transactions` is not allowed. `accounting.invoices` covers credit notes |
| Tenant | After the callback, `GET /connections` picks the org (one per clinic in v1). The `xero-tenant-id` header is sent on every call |
| Tokens | Access tokens last about 30 minutes. A refresh token can be used once and is replaced on every refresh, and it expires if unused (check the current lifetime in Xero's docs). Both are stored encrypted (`encryptField`, AAD `tenant:pms_xero_connections.*:row`). A refresh happens under a row lock (`rev` check) so two workers never use the same refresh token |
| Disconnect | The clinic disconnects in ClinDesk: `DELETE /connections/{id}` + revoke, wipe tokens, keep links and history. A disconnect made inside Xero shows up as a 403 from Xero, and ClinDesk then marks the connection disconnected |
| Who can | Owners and admins only, the same rule as "Plan and billing" |
| Data protection | Patient names, and optionally contact details, go to the clinic's own Xero. No clinical text goes. Add a line to the clinic DPA/privacy notice and the DPIA |

## DB tables to add (Supabase + SQLite twin, parity test; RLS on, Data API roles revoked)

| Table | Key columns |
| --- | --- |
| `pms_xero_connections` | `tenant_id` PK, `rev`, `status` (connected / paused / disconnected), `xero_tenant_id`, `connection_id`, `org_name`, `base_currency`, `access_token_enc`, `refresh_token_enc`, `access_expires_at`, `scopes`, `send_from` (date), `connected_by`, timestamps |
| `pms_xero_mappings` | (`tenant_id`, `map_kind`, `local_key`) PK; `map_kind` = service_account / default_account / item_account / visit_account / write_off_account / payment_account / tax_type / tracking; `xero_value`, `xero_label`, `rev`, `updated_by` |
| `pms_xero_links` | (`tenant_id`, `local_type`, `local_id`) PK; `local_type` = patient / referrer / invoice / credit_note / allocation / refund; `xero_id`, `xero_number`, `sent_hash`, `pushed_at` |
| `pms_xero_sync_items` | (`tenant_id`, `id`) PK; `local_type`, `local_id`, `op` (create / allocate / delete / update_contact), `status`, `attempts`, `next_attempt_at`, `blocked_by`, `error_class`, `error_message` (Xero's text with no patient data), `idempotency_key`, `lease_until`, timestamps; index (`tenant_id`, `status`, `next_attempt_at`) |

## Out of scope for v1

- Reading anything back from Xero: payments recorded in Xero, edits made in Xero, and webhooks. Webhooks are
  candidates for v2: INVOICE, CONTACT and the CREDITNOTE events added in February 2026.
- Unallocated, on-account money (Overpayments and Prepayments), bank transactions, bank reconciliation, and Stripe
  fees and payouts.
- Backfilling history from before the "send from" date.
- More than one Xero org per clinic (for example one company per site), and currencies other than GBP.
- Items/products sync, attachments (invoice PDFs), sending invoices from Xero, and practitioner tracking.
- ClinDesk's own subscription billing (that is AppstackX's Stripe account, not the clinic's books).

## Tracker tasks

| Task | Scope from this decision |
| --- | --- |
| xe01 | Khuram's setup (below) |
| xe02 | This doc |
| xe03 Connect | OAuth routes (`/api/xero/connect`, `/callback`), `pms_xero_connections`, token refresh with lock, org/currency check, disconnect, status card in Settings, audit |
| xe04 Mapping screen | Load accounts, tax rates and tracking (`accounting.settings.read`); pre-fill the maps; required-map checks; payer contact linking; "send from" date |
| xe05 Push + retry | Outbox writes inside the billing repos, the mappers (pure, unit-tested), the drain worker, idempotency, rate-limit handling, the Sync screen, Retry/Skip, daily failure email, Cloudflare cron trigger |
| xe06 Tests | Mapper unit tests (VAT inclusive/exclusive, excess deduction, every credit-note kind, refunds, reversals, penny totals); a repo test that every billing action queues an item; a fake Xero server for 429, 5xx and validation errors; a manual run against the UK Demo Company |
| xe07 Certification | Xero's checkpoints: connection (view, reconnect, disconnect, handle a disconnect made in Xero), branding, minimum scopes, errors shown in the UI, data integrity (currency check), account mapping screen, tax rates taken from the org. The App Store listing (optional on Plus) and the "Sign up with Xero" journey (needed on Enterprise) come later |

## What Khuram must do (xe01)

1. **Create a Xero developer account** at developer.xero.com, signed in with khuram@appstackx.co.uk. It is free.
2. **Create an app "ClinDesk"**, type **Web app**, with these redirect URIs:
   - `http://localhost:3000/api/xero/callback`
   - the production clinic app's `/api/xero/callback`
   - the company URL appstackx.co.uk (or clindesk.co.uk).

   Copy the Client ID and secret into Vercel env vars (`XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`). Do not put them in
   app `.env` files.
3. **Turn on the UK Demo Company** in the Xero account. Xero provides it free and resets it about every 4 weeks. Also
   consider a free 30-day UK trial org set up as a VAT-registered clinic, so the tax mapping can be tested on a clean
   ledger.
4. **Tier:** stay on **Starter** (free, 5 connections, 1,000 calls per org per day) for the build and the first 5
   clinics. Before the 6th clinic: pass certification and move to **Core**. Core is AUD 35 a month (about £18), with
   50 connections, 5,000 calls per org per day and 10 GB a month of data out. Then **Plus** (AUD 245, 1,000
   connections, App Store listing optional) at about 45 clinics. Xero bills in AUD and adding payment details is what
   moves an app above Starter.
5. Do not sign up for an App Store listing yet.

## Sources

- Pricing and tiers: https://developer.xero.com/pricing ; https://developer.xero.com/faq/pricing-and-policy-updates ; GBP estimate https://apideck.com/blog/xero-api-pricing-and-the-app-partner-program
- Rate limits: https://developer.xero.com/faq/limits ; https://developer.xero.com/documentation/guides/oauth2/limits/
- Granular scopes (2 Mar 2026 for new apps, Sept 2027 deadline for old ones): https://developer.xero.com/faq/granular-scopes ; https://developer.xero.com/documentation/guides/oauth2/scopes/ ; scope → endpoint list https://apideck.com/blog/xero-scopes
- OAuth flows: https://developer.xero.com/documentation/guides/oauth2/auth-flow/ ; https://developer.xero.com/documentation/guides/oauth2/pkce-flow/
- Idempotency-Key (128 chars, POST/PUT/PATCH): https://developer.xero.com/documentation/guides/idempotent-requests/idempotency/ ; https://xeroapi.github.io/xero-node/accounting
- Webhooks (credit-note events, Feb 2026): https://developer.xero.com/documentation/guides/webhooks/overview/ ; https://cfotech.co.uk/story/xero-adds-richer-credit-note-webhooks-for-developers
- Certification checkpoints: https://developer.xero.com/documentation/xero-app-store/app-partner-guides/certification-checkpoints/ ; summary https://docs.codat.io/integrations/accounting/xero/partner-certification/checkpoints-app-store
- UK tax types: https://www.rubydoc.info/gems/xero-ruby/3.0.0/XeroRuby/Accounting/TaxType ; https://help.linkmybooks.com/en/articles/5782859-why-am-i-getting-a-tax-code-error-when-sending-to-xero
- Contacts (ContactNumber, searchTerm): https://xeroapi.github.io/xero-node/accounting

**Still to check** (Xero's doc pages load their content with JavaScript, so some figures came from secondary
sources): the refresh-token lifetime, the zero-rated UK TaxType name, the recommended batch size, whether Core needs
certification, and whether a PAYMENT webhook category exists. Check each against developer.xero.com or the Demo
Company during xe03 and xe04.
