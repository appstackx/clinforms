# Card payments through each clinic's own payment account (cp01–cp09, l04, pk03)

Built 13/11/2026 on branch `feat/card-payments` – **switched off** (`CLINFORMS_CARD_PAYMENTS` unset) and **test mode
only** so far. Clinic guide: [`../clinic-guides/card-payments.md`](../clinic-guides/card-payments.md).

## 1. The model (owner's plan)

| Question | Answer |
|---|---|
| Whose money? | The **clinic's**. Each clinic is its own **connected account** (Stripe Accounts v2) on the ClinDesk payment account `acct_1UWi2yLYNzei2exh`, and the **merchant of record**: every payment is a **direct charge on the clinic's account** (v1 requests with the `Stripe-Account` header). |
| Who pays the provider's fees, refunds, disputes? | The clinic (`defaults.responsibilities.fees_collector = "stripe"`, `losses_collector = "stripe"`, `dashboard = "full"` – the clinic has its own Stripe Dashboard). |
| Onboarding | **Stripe-hosted** (v2 account links, `account_onboarding`). The clinic's business, representative and bank details never touch our system. |
| Our platform fee | Optional `application_fee_amount` per payment = `fee_bps` × amount + `fee_fixed_pence` (per clinic; plan defaults `DEFAULT_PLATFORM_FEE` all 0). **Default 0 = the parameter is left out.** Capped at 10 % + £5 and never more than half a payment. Refunds give our fee back proportionally (`refund_application_fee`) when there was one. |
| Switches | Platform: `CLINFORMS_CARD_PAYMENTS=on` (else no page, no nav entry, actions refuse, webhook 404, cron step no-op). Clinic: Set-up → Card payments → *Take card payments* (owner). Both default off. |
| Test vs live | The key decides (`STRIPE_CLINDESK_SECRET_KEY`, same live guard as subscriptions: `STRIPE_CLINDESK_ALLOW_LIVE`, `CLINDESK_BILLING_LIVE`). An account remembers its mode; a test account never takes live payments. In **test mode** an account that has not finished verification may take test payments (the provider's sandboxes allow it); in **live mode** only `active` accounts. |
| ClinDesk's own subscription billing | **Untouched.** Separate code (`src/server/billing/**`), separate webhook (`/api/billing/stripe-webhook`) and secret. |

## 2. Flows

All flows write an **intent row first** (`pms_card_intents`), use its id as the provider's **idempotency key**, put
`tenant_id` + `card_intent_id` in the provider object's metadata, and record money through **one function**
(`recordIntentPayment` / `recordIntentRefund` in `src/server/pms/billing/connect/service.ts`).

1. **Connect (owner).** Set-up → Card payments → *Connect* → `GET /app/clinic/setup/card-payments/connect` creates
   the v2 account once (idempotency key = clinic + mode + settings revision) and redirects to a fresh single-use
   onboarding link. Return URL `?returned=1` re-reads the account; *Refresh status*; the webhook keeps it current.
   Status: `pending` (not finished / provider reviewing), `active` (card_payments active), `restricted`, `closed`.
   Readers, saved cards and customers belong to the account they were made on (`account_ref`): moving from a test
   account to a live one never reuses a test location, customer or card.
2. **Desk – card reader (cp03).** Owner registers a reader per site (a Terminal **location** per site on the clinic's
   account, made once; test mode registers the provider's **simulated** reader `simulated-wpe`). Invoice → *Send to
   card reader* → PaymentIntent (`allowed_payment_method_types[]=card_present`, automatic capture) →
   `process_payment_intent` → patient taps → *Check payment* (or the webhook) records it. *Cancel on the reader*
   cancels (if it went through meanwhile it is recorded instead). Test mode: *Tap a test card* / *declined card*.
   One open desk payment (reader or saved card) per invoice – a unique partial index, so two members at once cannot
   both start one.
3. **Saved cards (cp04).** Consent first: the member reads the exact words (`cardConsentWording`, version
   `card-on-file-1`) and ticks that the patient agreed (or the patient ticks in the portal); the mandate row stores
   the **words, version, channel (desk/portal), who recorded it and when**, and whether missed-appointment charges
   are included. Then the provider's **hosted setup-mode Checkout** opens for the patient to type the card (staff
   never type card numbers – SAQ A). The card becomes usable when the provider confirms the SetupIntent (return page,
   `checkout.session.completed` or `setup_intent.succeeded`). Charge from the invoice: off-session PaymentIntent with
   the saved PaymentMethod. Customers on the clinic's account carry only our ids (no name, email or address).
4. **Missed-appointment / late-cancellation fees.** An invoice with a `did_not_attend` / `late_cancellation` line can
   be charged to a saved card only when the clinic's policy is on (with its wording) **and** that card's consent
   included such charges (`noShowChargeRefusal`). A saved-card charge is *processing* before the provider is asked; a
   lost answer keeps the invoice's desk payment busy until *Check payment* finds it at the provider (search by our
   intent id) or, after 10 minutes with nothing found, marks it failed.
5. **Refunds (cp06).** Invoice → *Refund to card* (billing.refund: owners and admins by default), full or partial,
   reason required (encrypted in the refund's notes), audited. Order: (1) claim the amount – the refund intent's
   INSERT refuses more than is left of that payment, in the same batch as a lock on the payment's row, so two
   simultaneous refunds cannot exceed it on D1 or Postgres; (2) the **provider refund first** (idempotency key = the
   refund intent; a refused refund changes nothing in the books); (3) a credit note for the part of THIS payment that
   paid the invoice (a part of the payment that sits on the patient's account is refunded first and is never credited
   on the invoice); (4) the refund recorded (`kind=refund`, allocated up to that part). A refund whose answer is lost
   stays *processing*: refunding the same amount again resumes it with the same key (never twice), any other amount is
   refused until it is confirmed, and its event records it after a 5-minute grace (the webhook answers 409 meanwhile so
   the provider retries). `refund.failed` later → the recorded refund is **reversed**. A refund made in the clinic's
   own Stripe Dashboard is recorded too (on the patient's account, audit `pms.card_refund.outside`; its reference is in
   the claiming INSERT, so duplicate deliveries record it once).
6. **Portal pay button (l04).** Portal home → *Payments*: the patient's issued, patient-billed invoices with a balance
   ≥ £0.30 → *Pay now* → hosted payment-mode Checkout on the clinic's account (an open one for the same amount is
   reused). Return `?paid=<intent>` re-reads; the webhook also records; once.
7. **Memberships (pk03) – our own scheduler, not provider subscriptions.** Why: the invoice stays the clinic
   system's own (numbering, VAT, statements, takings, aged debt) – no second ledger in Stripe Billing to reconcile;
   no Stripe Billing fee on the clinic; pause/cancel/consent rules stay ours; the same exactly-once recording path as
   every other card payment. Cost: we own retries (3 daily attempts, then `payment_failed` and the invoice stays open)
   and SCA re-authentication is not automated (a card that needs the patient's confirmation is a decline → the
   patient pays in the portal). Daily cron (after the expiry sweep): per due membership, the month is **claimed**
   (unique `(membership, period)`), an invoice is issued once (linked on the intent), the card charged off-session; a
   charge whose answer was lost is found by searching the provider for the intent id before any retry (and a payment
   still in flight is never charged again). The invoice is made as a draft and linked to the month's intent BEFORE it is
   issued (no second invoice after a crash). A month cancelled at the provider marks the membership *payment failed*.
   Plans are VAT-exempt (the price the patient agrees to is exactly what is charged); one active membership per plan
   per patient; the first month is charged on the start date (the consent words say so).
8. **Payouts and fees (cp05).** Billing → *Card payouts and fees* (billing.refund): balance, payouts, balance
   transactions per payout with provider fee / platform fee / net, matched to the clinic's invoices through its own
   intents. Read live, nothing stored.

## 3. Webhook

`POST /api/billing/connect-webhook` (`src/server/pms/billing/connect/webhook.ts`). Register **two event destinations**
(Workbench → Webhooks), both pointing at that URL, API version `2026-10-28.endive`:

| Destination | Events | Secret env |
|---|---|---|
| **Connected accounts**, snapshot | `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `setup_intent.succeeded`, `refund.created`, `refund.updated`, `refund.failed`, `charge.dispute.created`, `charge.dispute.closed`, `account.updated` | `STRIPE_CLINDESK_CONNECT_WEBHOOK_SECRET` |
| **Your account**, thin (optional) | `v2.core.account[requirements].updated`, `v2.core.account[configuration.merchant].capability_status_updated`, `v2.core.account.closed` | `STRIPE_CLINDESK_ACCOUNTS_WEBHOOK_SECRET` |

Rules: 404 switch off; 503 no secret; 400 bad signature (HMAC-SHA256, 5 min); wrong mode → 200 ignored; the clinic is
found by the **account** the event came from (the only cross-clinic read, plus the cron's list of clinics); every
object is **re-read** from that clinic's account with our key; our objects must carry this clinic's id and our
intent id; a handled event id is noted per clinic (repeat → `duplicate`); duplicate/out-of-order deliveries are safe
because recording is exactly-once (below) and a refund first settles its payment. 502 when the provider cannot be
reached (it retries).

## 4. Data (migrations 0226–0229, 0239–0241; Postgres twins `20261024000NNN_*`)

| Table | What |
|---|---|
| `pms_card_settings` (0226) | One per clinic: switch, `account_ref` (unique across clinics), mode, status + capabilities + requirements due, platform fee, missed-appointment policy |
| `pms_card_readers` (0227) | Reader per site: location / reader ids, label, simulated |
| `pms_card_intents` (0228) | Every payment / card set-up / refund through the account: kind, purpose, status, provider refs (unique per clinic), invoice, patient, card, reader, membership + period (unique), amount, fee, `payment_id`, attempts |
| `pms_card_events` (0229) | Handled webhook events per clinic |
| `pms_card_mandates` (0239) | Saved card refs + brand/last4/expiry + **consent** (exact words, version, channel, recorded by, at, includes missed-appointment fees) |
| `pms_membership_plans` (0240), `pms_memberships` (0241) | Plans; a patient's membership with its consent words, charge day, next date, attempts, status |

All hang off `pms_billing_settings` by `ON DELETE CASCADE` (offboarding names none of them – the gateway statement
limit). **Money lives only in `pms_payments`** (provider `stripe_connect`, `provider_ref` = `pi_…` / `re_…`, unique per
clinic) and its allocations – takings, aged debt and statements need no change.

**Exactly once:** the payment row, its allocation and the intent's `succeeded` are written in **one atomic batch**;
the unique provider reference refuses a second row whichever path comes second (screen, return page, webhook, cron);
the loser reads the winner's row back. Allocation never takes an invoice below zero – the rest stays on account.

## 5. Security and PCI scope

- No card data ever touches our servers or pages: cards are typed into the provider's hosted Checkout or presented to
  the provider's reader (PCI SAQ A for online; the reader is the provider's P2PE device). No Stripe.js, no CSP change.
- Permissions: owner only for the account, readers and policy (`settings.owner`, two-step required); plans
  `settings.setup`; take payments / save cards / memberships `billing.pay`; refunds and payouts `billing.refund`.
  Every id is read back from the member's clinic and site scope (another clinic's id = not found).
- Tenant isolation: every statement names `tenant_id` except the two documented cross-clinic reads of
  `pms_card_settings`; a provider object is only trusted when re-read from that clinic's own account with our metadata.
- Keys: the ClinDesk account's key from env only; test/live guard; answers checked against the key's mode; ids
  validated before they go into a URL; no key or card detail is logged.
- Patient data sent to the provider: none beyond our ids in metadata and "Invoice INV00042".

## 6. Code and tests

| What | Where |
|---|---|
| Pure rules, copy, views | `src/modules/pms/billing/card-payments.ts` |
| Provider client (v2 accounts, Terminal, Checkout, refunds, payouts) | `src/server/pms/billing/connect/client.ts` |
| Services, exactly-once recording, cron, portal, webhook | `src/server/pms/billing/connect/{service,memberships-run,portal,webhook,screen}.ts` |
| Repositories | `src/server/repos/pms/billing/card-payments.ts` |
| Screens | `src/app/app/clinic/setup/card-payments/**`, `src/app/app/clinic/billing/{card-actions.ts,payouts}`, `src/components/pms/billing/{card-payments-setup,invoice-card-panel,patient-cards}.tsx`, portal `card-actions.ts` + `src/components/pms/portal/portal-cards.tsx` |
| Tests | `connect/card-payments.test.ts` (pure + suite on SQLite/PGlite), `workers/data-gateway/test/pms-billing-cards-stack.test.ts` (D1 stand-in + real local D1), fake provider `connect/testing/fake-connect.ts` |
| Real TEST API run | `npm run pms:cards-stripe-test` with `STRIPE_CLINDESK_TEST_SECRET_KEY` (two fictional accounts, closed at the end) |
| Screens e2e | `scripts/e2e/pms-billing-cards.cjs` |

## 7. What the owner must decide before go-live

1. **Platform fee** – none, a percentage, a fixed amount, per plan? (Set per clinic: `setPlatformFee`; plan defaults
   in `DEFAULT_PLATFORM_FEE`.) Our fee shows on the clinic's provider statement and needs a line in our terms.
2. **Which plans get missed-appointment charging and memberships** (today: every clinic, behind its own policy switch).
3. **Live platform profile questionnaire** in the ClinDesk Stripe account (Connect → platform profile: business model,
   who onboards, who is liable – answers must match §1) and Connect branding (name, icon, colour) for the hosted pages.
4. **Physical readers:** which model (WisePOS E / S700 are server-driven compatible), who orders and pays for them
   (clinic orders in its own Dashboard, or we resell?), UK availability.
5. Terms: the clinic's agreement must incorporate the Stripe Connected Account Agreement; our privacy notice names
   Stripe as the clinic's processor for card payments.
6. Go-live order: live key + `STRIPE_CLINDESK_ALLOW_LIVE=1` + two live event destinations + secrets → apply migrations
   → `CLINFORMS_CARD_PAYMENTS=on` → one internal clinic end to end with a real card and a refund.

## 8. Known limits

- Test-mode card payments are recorded like real ones (reference "TEST – …"): use test mode on a demo or internal
  clinic only.
- Two portal *Pay now* clicks at the same moment can open two payment pages; if both are paid, the second payment is
  recorded once and kept on the patient's account (refund it).
- A lost dispute is not taken off takings automatically (audit only) – record it by hand until this is built.
- Membership SCA: a card needing the patient's confirmation fails the off-session charge (no e-mail link yet).
- Disputes are noted (audit) only – the clinic answers them in its own Dashboard.
- A refund made in the clinic's Stripe Dashboard is recorded on the patient's account, not allocated: credit the
  invoice to match.
- Reader payments: one open per invoice; the webhook or *Check payment* records them (no live push to the screen).
