# Clinic system – prepaid text credits (runbook)

**Internal.** 31/10/2026, branch `feat/clindesk-sms-credits` (from `main` 172bbca). Not merged, not deployed.
Code map at the end. Comms background: [`comms.md`](comms.md).

## 1. What it does (Khuram's decisions, 31/10/2026)

- **Prepaid only.** A clinic buys a pack up front by card payment. Nothing is ever sent on credit, the balance is
  never negative (database CHECK + the condition in every debit).
- **1 credit = 1 UK text segment**: up to 160 GSM-7 characters is one credit, then one per 153; a text with a
  character outside GSM-7 (emoji, some accents, curly quotes the normaliser did not replace) is unicode: 70, then 67
  per segment (`creditsForSms` → `smsInfo`, `src/modules/pms/comms/sms.ts`). Counted on what is actually sent.
- **Packs** (ClinDesk's own payment account, TEST mode, one-time prices with lookup keys, product `sms_credits`,
  metadata `sms_credits=N` on each price): `sms_500` £40, `sms_1000` £75, `sms_5000` £325 (repriced 31/10/2026; old prices archived). The code holds the same
  table (`SMS_PACKS`) and refuses a checkout if the account's price differs in amount, currency, type or credits.
- **Not enough credit** for an automatic text (confirmation, reminder, notice, waiting-list offer): it goes **by email
  instead** when the patient has an email address and allows email for that kind of message (PECR, per kind), unless
  the appointment gets an email of the same kind anyway; otherwise it is recorded as **not sent – "no text credit"**.
  The outbox row says "By email instead of a text – not enough text credit". A text staff write by hand (Send a
  message, payment link by text, Retry) is refused with "Not enough text credit…" – staff choose the channel.
- **Warnings** by email to the clinic's **owner and admins** at **20 % of the last pack** bought (100 until a pack is
  bought) and **at zero**, once per crossing (credit above the line arms the warning again). Sent through the
  account email service (ClinDesk's sender when `MAILERSEND_*_CLINIC` is set).
- **Automatic top-up (optional)**: the owner/admin saves a card (card payment page in "save a card" mode, or "Save
  this card for automatic top-up" when buying). When a text would take the balance below the threshold (default 100),
  the chosen pack is charged **off-session before the text is sent**, credited once. On failure: nothing credited,
  **automatic top-up paused**, the owner and admins told, the text goes by email or not at all. Switching it on again
  (or saving a new card) lifts the pause.
- **Unused credits stay while the account is open; not refundable** (Text credits page + terms line
  `legal.textCredits` in `content/clindesk-site.json`, terms §7 on clindesk.co.uk/terms).
- **Roles**: everyone with `messages.send` sees the balance (Messages header link) and the history; only the
  **owner and admins** (fixed rule, not a grid permission) buy, save/remove the card and change automatic top-up.
- **Outbox provider** (production default today): nothing is sent, so **nothing is charged** – but the balance is
  still checked, so the outbox shows what would happen (a clinic with 0 credits sees "by email instead").

## 2. The ledger (consistency guarantee)

Migration **0143** (`db/migrations/sqlite/0143_pms_sms_credits.sql` + `supabase/migrations/20261024000143_pms_sms_credits.sql`):

| Table | What |
|---|---|
| `pms_sms_credit_accounts` | one row per clinic: cached `balance` (CHECK ≥ 0), `last_pack_credits`, `low_threshold`, `low_warned`/`zero_warned`, automatic top-up (`auto_topup`, `auto_topup_threshold`, `auto_topup_pack`, `auto_topup_paused_at`, `auto_topup_failure`, `topup_claim`), the provider's `customer_ref` (unique) and the saved card (method ref, brand, last four, expiry – never a number), `last_entry_id`, `rev` |
| `pms_sms_credit_entries` | **append-only** ledger (UPDATE refused by a trigger on both dialects): `purchase`, `auto_topup`, `debit`, `adjustment`, `reversal`; `credits` (signed), `balance_after`, pack, amount, message id, `reverses_id` (unique per clinic), `payment_ref` (**unique everywhere**), `event_ref` = the webhook event that made it (**unique everywhere**), reason |

Two tables only, on purpose: offboarding deletes every clinic-system table in one gateway batch, and the headroom test
(`src/server/auth/offboard-batch.test.ts`, ≥ 450 member accounts) allows two more – so webhook-event idempotency
lives on the ledger entry (`event_ref`), not in a table of its own. An event that changes no balance (a card saved,
a payment already credited) is safe to apply again.

Every balance change is **one batch** (D1 has no interactive transactions): insert the account row if missing →
`UPDATE balance = balance + Δ, last_entry_id = <new> WHERE balance + Δ >= 0 [AND payment/reversal not recorded]` →
`INSERT entry … SELECT … FROM account WHERE last_entry_id = <new>` → the audit row only if the entry exists
(the UPDATE also checks the payment, reversal and event are not recorded yet). So the
entry exists exactly when the change happened and **sum(credits) = balance** (`ledgerCheck`, shown on the platform
page). Parallel sends cannot spend the same credit twice (the condition is in the UPDATE; Postgres re-checks it on the
latest row after a concurrent commit); a payment is credited once (NOT EXISTS + unique `payment_ref` – the loser of a
race fails as a whole and is answered "already recorded"); a debit is returned once (unique `reverses_id`).

**Around a text** (`src/server/pms/comms/dispatch.ts`): reserve (= the debit entry) **before** the provider call →
message written → provider → **sent: the debit stands**; failed / kept in the outbox / not written: a `reversal` entry
returns it. A crash between the provider call and the answer leaves the debit (conservative – never a free text).
Every change is audited (`pms.sms_credit.*`, ids and counts only – no message text, no patient data).

## 3. Environment variables (names only)

| Variable | Where | Meaning |
|---|---|---|
| `STRIPE_CLINDESK_SECRET_KEY` | Vercel Production (Sensitive) | ClinDesk account's secret key. **Test key** (`sk_test_…`/`rk_test_…`) until go-live. A live key is refused unless `STRIPE_CLINDESK_ALLOW_LIVE=1` |
| `STRIPE_CLINDESK_WEBHOOK_SECRET` | Vercel Production (Sensitive) | the webhook endpoint's signing secret (`whsec_…`). Without it the webhook answers 503 (the success page still credits) |
| `STRIPE_CLINDESK_PUBLISHABLE_KEY` | optional | not used by the hosted card payment page (kept for later) |
| `STRIPE_CLINDESK_ALLOW_LIVE` | Vercel Production, at go-live only | `1` lets a live key work |
| `CLINDESK_BILLING_LIVE` | Vercel Production, at go-live only (after the clean-up, §8) | `1` = live payments only: a test key is refused |
| `STRIPE_CLINDESK_API_BASE` | **local e2e only** | a stand-in for the provider's API on this machine; anything but `api.stripe.com` or loopback is refused, and never with a live key |

Without `STRIPE_CLINDESK_SECRET_KEY` the page shows "Card payments for text credits are not set up yet." and nothing
can be bought (support adjustments still work). Local: the test key is `STRIPE_CLINDESK_TEST_SECRET_KEY` in
`~/.config/appstackx/clinforms.secrets.env` (read programmatically by the e2e; never print it). API version pinned in
code: `2026-10-28.endive` (`CARD_API_VERSION`, `src/server/pms/comms/credits/card-payments.ts`).

## 4. Webhook endpoint (Khuram, in the ClinDesk account's Dashboard)

1. **Test first**: Dashboard (ClinDesk account, **Test mode/Sandbox**) → Developers → Webhooks → Add endpoint:
   - URL `https://clindesk.co.uk/api/clinic-messages/credit-payments` (same deployment serves clinforms.co.uk – either host works);
   - events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `payment_intent.succeeded`
     (the subscription events too – one endpoint for everything, BILLING.md);
   - API version: `2026-10-28.endive` (the code re-reads every object with its own pinned version, so this only affects the event body).
   - Copy the signing secret → Vercel **Production** `STRIPE_CLINDESK_WEBHOOK_SECRET` (Sensitive); test secret key →
     `STRIPE_CLINDESK_SECRET_KEY`. Redeploy.
2. **Payment methods**: the card payment page offers what the account's settings allow (Card, Klarna, Revolut Pay,
   wallets were on in the sandbox). Buying works with any of them, but **automatic top-up needs a card** – consider
   Settings → Payment methods: cards + Apple Pay/Google Pay only for this account.
3. **Branding / statement descriptor**: set public details (name ClinDesk, support email khuram@appstackx.co.uk,
   descriptor `CLINDESK`) – CLAUDE.md: check after business verification that they are not another product's.
4. Check: buy a 500 pack on the test clinic with card `4242 4242 4242 4242` → Text credits shows +500; Developers →
   Webhooks → the endpoint shows the events delivered `200` (`already` for the second – expected).

## 5. Go-live (live payments)

1. Activate the ClinDesk account; recreate the three prices **in live mode** with the same lookup keys
   (`sms_500`, `sms_1000`, `sms_5000`), one-time, GBP, metadata `sms_credits=500|1000|5000`, product `sms_credits`
   (the code refuses a mismatch).
2. Live webhook endpoint as §4 (same URL, same events) → its signing secret.
3. Vercel Production: `STRIPE_CLINDESK_SECRET_KEY` = live secret key (or a restricted key with Checkout Sessions,
   Customers, Payment Intents, Payment Methods, Prices read/write), `STRIPE_CLINDESK_WEBHOOK_SECRET` = live secret,
   `STRIPE_CLINDESK_ALLOW_LIVE=1`. Redeploy.
4. **Apply migration 0143 on Supabase BEFORE deploying the code** (`CLINFORMS_DB=postgres npm run db:migrate`,
   session pooler, as M11-RUNSHEET §4) – the platform page reads a missing table as "not on this database yet", but
   sends need the tables. D1 previews: `CLINFORMS_DB=d1 npm run db:migrate -- --d1-env preview`.
5. Smoke: buy the smallest pack on the internal test clinic with a real card, check the ledger on the platform page
   ("consistent"), refund it in the Dashboard and take the credits off with a **support adjustment** (refunds are
   not automatic – credits are non-refundable for clinics; a refund you choose to make is mirrored by hand).
6. **Before** live billing: run the go-live clean-up (§8) – `npm run admin:billing-go-live -- --env production`
   (preview), then `--confirm --yes` – and only then set `CLINDESK_BILLING_LIVE=1` on Vercel Production and redeploy.
7. The text provider (The SMS Works) is set up separately (§7); until its key is set everything stays in the outbox
   and no credits are used.

## 6. Still open

- **SMS provider**: **The SMS Works** chosen (Khuram, 31/10/2026 – UK, charges only for delivered texts); adapter
  built and tested with mocked HTTP (§7). No account yet – Khuram signs up when the first real clinic onboards.
  Our price: £40 / 500 = 8p per credit.
- Cron for the message run (comms.md – Vercel Pro or a Cloudflare cron): automatic top-up and warnings happen inside the run.
- A refund or chargeback in the Dashboard does not change credits (support adjustment by hand).
- Offboarding exports and deletes the clinic's credit rows with everything else (unused credits end with the account).

## 7. Text provider – The SMS Works (built 31/10/2026, not switched on)

**How it works.** `CLINIC_SMS_PROVIDER=smsworks` **and** `SMSWORKS_API_KEY` set → texts go out through
`src/server/pms/comms/providers/smsworks.ts` (mode `live`); without the key texts stay in the outbox (nothing sent,
nothing charged). A live text provider also means **live billing is required**: a test payment key is refused
(`billingLiveRequired`, §8). Each text: `POST https://api.thesmsworks.co.uk/v1/message/send` with
`Authorization: <JWT>`, sender (the clinic's own sender name from Messages → Settings when it is 4–11 letters/digits
– spaces dropped – else `SMSWORKS_SENDER`, else `ClinDesk`), destination `447…`, the text, our clinic and message ids
as metadata and, when `SMSWORKS_RECEIPT_SECRET` and the app origin are set, the receipt URL. Credits: reserved before
the call; a 4xx refusal returns them; a 5xx / timeout / dropped connection is recorded as failed with
`provider_unknown` and **keeps** them until the receipt (review fix 6).

**Receipts** (`POST /api/clinic-messages/sms-receipts?token=<SMSWORKS_RECEIPT_SECRET>`,
`src/server/pms/comms/sms-receipts.ts`): the provider does not sign receipts, so the token authenticates the URL and
the report is **re-read** from the API (`GET /v1/message/{id}`) before anything changes. DELIVERED → the debit stands;
UNDELIVERABLE / EXPIRED / REJECTED → the credits come back once (reversal) and the message is marked failed with the
reason code; SCHEDULED / SENT → nothing yet. A timed-out send is found by its metadata and settled the same way.

| Variable | Where | Meaning |
|---|---|---|
| `CLINIC_SMS_PROVIDER` | Vercel Production | `smsworks` (default `outbox`) |
| `SMSWORKS_API_KEY` | Vercel Production (Sensitive) | the account's JSON Web Token |
| `SMSWORKS_SENDER` | Vercel Production | default sender ID, e.g. `ClinDesk` (4–11 letters/digits, no spaces) |
| `SMSWORKS_RECEIPT_SECRET` | Vercel Production (Sensitive) | 32+ random characters (`openssl rand -hex 24`) – the receipt URL's token |
| `SMSWORKS_API_BASE` | local tests only | a loopback stand-in; anything else refused |

**Khuram's set-up steps (when the first real clinic onboards):**
1. Sign up at thesmsworks.co.uk as AppstackX Ltd (business email `khuram@appstackx.co.uk`); buy a small credit
   top-up (they charge only for delivered texts).
2. Sender ID: alphanumeric senders need no UK registration, but generic words are blocked (their error 4012) – use
   `ClinDesk` and each clinic's own short name (Messages → Settings → sender name; 4–11 letters/digits). Send one test
   text from their dashboard to your own phone with sender `ClinDesk` to confirm it is accepted.
3. Dashboard → API Key → generate the key and secret → copy the **JSON Web Token** → Vercel Production
   `SMSWORKS_API_KEY` (Sensitive). Generating a new key later invalidates the old token (update Vercel then).
4. `SMSWORKS_RECEIPT_SECRET` = `openssl rand -hex 24` → Vercel Production (Sensitive). Optional belt-and-braces:
   Dashboard → Delivery Reports → Webhook Configuration → `https://clindesk.co.uk/api/clinic-messages/sms-receipts?token=<the secret>`
   (each text also carries this URL itself).
5. Run the go-live clean-up and set `CLINDESK_BILLING_LIVE=1` (§8) – real texts must never be paid for with
   test-mode credits. Then `CLINIC_SMS_PROVIDER=smsworks`, redeploy.
6. Smoke on the internal test clinic (fictional patient, your own mobile): buy 500 credits with a real card, send one
   text → Messages shows "Sent" then "Delivered", the credits show −1; a text to an invalid number comes back failed
   and its credit returns.

## 8. Review fixes (31/10/2026) and the go-live clean-up

| # | Finding | Fix |
|---|---|---|
| 1 | Test-mode credits could leak into live (a test key on Production buys credits with card 4242) | `CLINDESK_BILLING_LIVE=1` (or a live text provider) refuses a test key outright (`billingLiveRequired`, `card-payments.ts`); customers carry their mode (`customer_mode`, migration 0144) and a test customer/card is never reused in live (replaced, card cleared – `credits/customer.ts`); paid entries carry their mode (`mode`, 0145); **`npm run admin:billing-go-live`** forgets test customers/cards and reverses test-mode packs once (support adjustment naming the purchase, reason "Test-mode payment reversed at go-live"); test-mode subscriptions likewise (BILLING.md) |
| 2 | Automatic top-up could charge repeatedly (trigger level above the pack) | trigger level ≤ the pack's credits (schema + `effectiveTopUpThreshold` for stored values); at most one attempt per 10 minutes per clinic (`topup_claimed_at` kept as the last attempt; reset only when the owner switches top-up on again) |
| 3 | "Paid but refused" answered 200 silently; top-up without webhook; a charge whose credit failed | refused paid payments raise a payment alert (platform audit `platform.payment_alert` + email to the platform admins, `src/server/billing/payment-alerts.ts`); automatic top-up needs the webhook signing secret; a charge whose credit could not be recorded is not retried (claim time) and is credited by its `payment_intent.succeeded` event |
| 4 | The message run could strand debits after a crash | try/finally settles every planned debit (not reached the provider → returned; answered → by the answer; started but unanswered → kept) |
| 5 | Settling skipped if recording the outcome failed | settled in `finally` (single send, Retry, the run, held texts) |
| 6 | A timeout refunded a text that may have gone | provider errors without an answer → `provider_unknown`, credits kept until the receipt (§7) |
| + | A double-submitted platform adjustment applied twice | one-time form id → `event_ref` `adj_<id>` (unique): the second submit is "already recorded" |

**Go-live order (payments):** live prices and webhook as §5 → migrations 0144/0145 (+ BILLING.md's) on Supabase →
deploy → `npm run admin:billing-go-live -- --env production` (preview, read it) → `… --confirm --yes` → Vercel
`CLINDESK_BILLING_LIVE=1` + live key + `STRIPE_CLINDESK_ALLOW_LIVE=1` → redeploy → smoke (§5.5).

## 9. Code map and tests

| What | Where |
|---|---|
| Rules, packs, copy, view types | `src/modules/pms/comms/credits.ts` (+ `credits.test.ts`: segments, packs, warnings, top-up) |
| Ledger | `src/server/repos/pms/comms/credits.ts`; suite `testing/credits-suite.ts` on SQLite + PGlite (`credits-repos.test.ts`), D1 stand-in + local workerd D1 (`workers/data-gateway/test/pms-sms-credits-stack.test.ts`), real Postgres pool of 4 (`credits-concurrency.test.ts`, with `CLINFORMS_TEST_PG_URL`) |
| Around a text, fallback, warnings, top-up, payments | `src/server/pms/comms/credits/service.ts`, `dispatch.ts`; tests `credits/credits-service.test.ts` (provider mocked) |
| Card payment client, webhook | `credits/card-payments.ts`, `credits/webhook.ts`, route `src/app/api/clinic-messages/credit-payments/route.ts` |
| Warning emails | `credits/notify.ts`, `src/server/email/templates.ts` `textCreditNoticeEmail` |
| Screens | `src/app/app/clinic/messages/credits/{page,done/page,cancelled/page,actions}.tsx`, `src/components/pms/comms/text-credits.tsx`; Messages header link; Set-up → Text credits |
| Platform | `src/app/app/platform/text-credits/*`, `src/server/admin/text-credits.ts` |
| Review fixes | `credits/credits-review-fixes.test.ts` (one test per finding), `src/server/admin/billing-go-live.ts` + `scripts/admin/billing-go-live.ts` |
| Text provider | `providers/smsworks.ts`, receipts `sms-receipts.ts` + route `src/app/api/clinic-messages/sms-receipts/route.ts`; tests `providers/smsworks.test.ts` (HTTP mocked) |
| Browser | `scripts/e2e/pms-sms-credits.cjs` (real TEST checkout + `stripe listen` forwarding when the key and CLI are there; else a local stand-in + signed webhooks) |
