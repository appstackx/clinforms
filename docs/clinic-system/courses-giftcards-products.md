# Courses, gift cards and products (tracker PK01–PK07)

**Internal design, 11/11/2026.** Billing module, migrations 0231–0239. Patient-facing names: **Courses** (a block
of sessions paid up front), **Gift cards**, **Products**. "Package" is NOT used: in the code it already means the
ClinDesk product packages (`clinic`, `reports`).

## 1. Decisions

| Question | Decision | Why |
|---|---|---|
| How is a course, gift card or product sold? | An ordinary invoice line of kind `item`, linked by `pms_invoice_line_refs` (line → course / gift card / product) | The line-kind CHECK cannot change on SQLite without rebuilding the table; every report, credit note, payment and export keeps working |
| How is a course session used? | When an appointment is billed, a covered visit is marked **used from the course** (`pms_course_uses`, one row per appointment) instead of becoming a priced line. No £0 invoice | Matches how clinics think ("3 of 6 used"), keeps invoices honest |
| When does a course start counting? | On issue of the invoice that sold it (sold = issued, not drafted). Unpaid courses can still be used; the balance shows as owed | Clinics often let the first session go ahead before payment |
| Expiry | Optional "valid for N days" from the sale date; expired sessions cannot be used; owner can extend (audited) | Common practice, avoids indefinite liability |
| Refund / cancel a course | Credit note on the sale line for the unused sessions (pro rata by default, editable); the course closes | Uses the existing credit-note path |
| Gift card redemption | A new payment method `gift_card` (zod enum only – the DB has no CHECK on `method`): the payment's `reference` is the card id, the card's balance drops by the allocated amount | Payments, allocation and refunds already exist |
| Gift card code | 12 characters, no look-alikes (e.g. `CD7K-M4Q9-X2HP`), stored as SHA-256 + last 4 shown; balance kept in pence; expiry 24 months by default (UK: state it on the card) | A code is a bearer value: never stored readable |
| Gift card VAT | No VAT at sale (multi-purpose voucher); VAT is on the redeemed service/product as usual | HMRC treatment of multi-purpose vouchers |
| Products and stock | `pms_products` (name, SKU, price, VAT code, active) + `pms_stock_moves` per site (+received, −sold, ±adjusted, with reason). Stock on hand = sum of moves. Selling on an invoice writes a −sold move on issue; crediting the line writes it back | Append-only, auditable, no counters to drift |
| Memberships (monthly) | **Blocked**: needs saved cards and automatic charging (card payments, cp04). Until then a clinic can sell a course monthly | No silent manual monthly invoicing |
| Liability report | Courses: sold value × unused sessions ÷ total sessions; gift cards: outstanding balances; both per site and date | Accountants need the deferred-income figure |

## 2. Tables (billing, all `tenant_id` first, RLS on, Data API revoked)

| # | Table | Key columns |
|---|---|---|
| 0231 | `pms_course_types` | id, name, service_ids_json (which services it covers), sessions, price_pence, vat_code, valid_days (null = no expiry), active, rev |
| 0232 | `pms_patient_courses` | id, patient_id, course_type_id, case_id (optional), sale_line_id, sessions_total, sold_on, expires_on, status (`active`, `used_up`, `expired`, `cancelled`), rev |
| 0233 | `pms_course_uses` | id, patient_course_id, appointment_id (unique per tenant while not reversed), used_on, reversed_at |
| 0234 | `pms_gift_cards` | id, code_sha256 (unique), code_last4, initial_pence, balance_pence (CHECK ≥ 0), sold_on, expires_on, sale_line_id, buyer_patient_id (optional), recipient_name_enc, status |
| 0235 | `pms_gift_card_moves` | id, gift_card_id, kind (`sale`, `redeem`, `refund`, `expire`, `adjust`), amount_pence, payment_id, balance_after (CHECK ≥ 0) |
| 0236 | `pms_products` | id, name, sku, price_pence, vat_code, active, rev |
| 0237 | `pms_stock_moves` | id, product_id, site_id, kind (`received`, `sold`, `returned`, `adjusted`), quantity (signed), invoice_line_id, reason_enc |
| 0238 | `pms_invoice_line_refs` | invoice_line_id (PK with tenant), ref_type (`course`, `gift_card`, `product`), ref_id |

Every new table is listed in `src/server/db/pms-schema/billing.ts` (offboarding export/delete, D1→Postgres copy).

## 3. Screens

- **Set-up → Courses / Products** (settings.setup): list, add, edit, archive.
- **Patient → Billing → Courses**: active courses with "3 of 6 used · expires 12/03/2027", sell a course (creates a
  draft invoice with the line), history of uses.
- **Billing → New invoice**: "Add course / gift card / product" picker next to "Add item".
- **Visit suggestions**: a visit covered by an active course shows "Use course (3 of 6 left)" ticked by default;
  ticking it records the use instead of adding a line.
- **Gift cards** (Billing → Gift cards): sell, look up by code, balance, history; **Take payment → Gift card** asks
  for the code.
- **Stock** (Billing → Stock, per site): on hand, receive stock, adjust with reason, low-stock threshold.
- **Reports**: course and gift-card liability; product sales and stock value.

## 4. Permissions and audit

Sell/use/cancel: `billing.edit`. Set-up: `settings.setup`. Extend expiry or adjust a gift-card balance: owner or
admin. Audit actions `pms.course.*`, `pms.gift_card.*` (never the code), `pms.product.*`, `pms.stock.*`.

## 5. Build order

PK02 courses (types, sell, use from visits, cancel/credit) → PK04 gift cards → PK05 products and stock → PK06 tests
and liability/stock reports → PK07 website. PK03 memberships after card payments (cp04).

## 6. Built – PK02 courses (11/11/2026, branch `feat/courses`, not merged, migrations not applied anywhere)

| What | Where (screen) | Code |
|---|---|---|
| Course types: name, services covered, sessions, price, VAT code (VAT-registered clinics), valid N days from the sale (blank = no expiry), on sale / switched off | Set-up → **Courses** (`/app/clinic/setup/courses`, settings.setup; changes by the owner or an admin with every site) | `pms_course_types` (0231); `src/components/pms/billing/courses-setup.tsx` |
| Sell a course: a draft invoice to the patient with an `item` line "Course: <name>" + its `pms_invoice_line_refs` row (one batch), or "Sell and issue invoice". The course is made in the **issue** batch (sold = issued; expiry = sale date + N − 1 days). Draft courses show as "on a draft invoice"; a cancelled draft starts nothing; a draft that sells something cannot have its lines replaced (cancel and sell again) | Patient → **Invoices** tab → Courses → **Sell a course** | `pms_patient_courses` (0232), `pms_invoice_line_refs` (0238); `createDraftInvoice(…, { lineRefs })`, `courseStartQueries` in `issueInvoice` |
| Progress: "3 of 6 used · expires 12/03/2027", state Active / Used up / Expired (worked out from the date) / Cancelled, the visits used | same | `src/modules/pms/billing/courses.ts` |
| Visit suggestions: a completed self-pay visit a patient's active course covers (service, case if the course has one, visit date ≤ expiry, a session left – counted down in date order, the course running out first used first) shows **"Use course (3 of 6 left)"**, ticked by default; ticked visits are used from the course (`pms_course_uses`, unique per appointment while not reversed) and get no line. Used visits leave "Invoice visits", the Billing figure and the dashboard (the uninvoiced test is `not on an invoice AND not used from a course` once the tables exist) | Billing → Invoice visits / Attended, not invoiced | `offerCourses`, `courseOffersFor`, `useCoursesForVisits`, `notBilledNorUsed` |
| Reverse a use (the visit can be invoiced again) | Patient → Invoices → the course → **Reverse** | `reverseCourseUse` |
| Cancel a course: credit note on the sale line for the unused sessions (pro rata by default, any amount up to what is left on the line), the course closed – one batch. Voiding the sale invoice, or crediting the line in full, closes the course too | Patient → Invoices → **Cancel course** | `cancelPatientCourse` (`course-cancel.ts`), `courseCloseOnCreditQueries` in `issueCreditNote` |
| Move or remove the expiry (owner or admin), audited with the old and new date | Patient → Invoices → **Change expiry** | `setCourseExpiry` |

**Decisions taken while building (differ from §1–§4):**
- `pms_invoice_line_refs.ref_id` for a course is the **course type** (the patient's course only exists once the invoice is
  issued, found by `sale_line_id`). A draft therefore never leaves a half-made course behind.
- Cancelling a course needs **billing.edit and billing.refund** (it issues a credit note, which is billing.refund
  everywhere else), not billing.edit alone.
- Only **completed, self-pay** visits are offered a course (an insured visit bills its payer; a missed visit is
  charged or waived as before).
- `pms_course_types` hangs off the clinic's `pms_billing_settings` row (ON DELETE CASCADE, written in the same batch)
  like the Healthcode settings, so offboarding's one-batch delete stays within the gateway limit (450 member accounts
  still fit); the other course tables go with their parents.
- Selling from the patient's record, not a "New invoice" screen (there is none yet).

**Permissions** as §4, plus the cancel rule above. **Audit actions**: `pms.course_type.create|update`, `pms.course.sell`,
`pms.course.start`, `pms.course.use`, `pms.course.use_reverse`, `pms.course.cancel`, `pms.course.expiry` (ids,
counts and amounts only).

**Before the migrations:** every course read answers "none" (`readOrEmpty`), invoices issue and credit as before (no
course statement is added unless the invoice has course rows), the visits list keeps the old test until
`pms_course_uses` exists; only course saves fail.

**Tests:** `src/modules/pms/billing/courses.test.ts` (pure), `src/server/repos/pms/billing/courses-repos.test.ts`
(+ `testing/courses-suite.ts`) and `src/server/pms/billing/courses-service.test.ts` on node:sqlite and PGlite with the
tenant-scope guard; parity, ranges, offboarding batch and Set-up navigation as before.

**Review fixes (11/11/2026)** – regression tests in `src/server/pms/billing/courses-giftcards-review.test.ts` (node:sqlite
and PGlite, a fresh database per test; each fails on the code before the fix) and `courses.test.ts`:
- **A voided / fully credited sale no longer strands its used visits.** `reverseCourseUse` now works on a cancelled
  course too: the course stays closed (no session comes back), the use is kept and marked reversed (never deleted), and
  the visit is billable again like any other. Patient → Invoices → the course shows **Reverse to invoice** on each used
  visit, with a note, when the sale was voided or its line credited in full (`saleCreditedInFull` on the view); on a
  course cancelled with a pro-rata credit the button stays **Reverse** (the used sessions were paid for – reversing
  would bill them twice, so it is the member's call). Audit `pms.course.use_reverse` carries `courseCancelled`.
- **Pro rata after a part credit:** `proRataCredit` = (line total − already credited) × unused ÷ total, capped at what is
  left (£600 for 6, £300 credited, 3 used → £150, was £300).
- **What a draft sells is fixed with the draft:** `pms_invoice_line_refs.snapshot_json` (sessions, services, validity –
  taken by `createDraftInvoice` from the course type) and `pms_patient_courses.service_ids_json` (the services sold;
  NULL = the type's, for rows made before). Editing the course type between draft and issue changes nothing sold.
  Both columns were added to the **unapplied** migrations 0232/0238 (SQLite and Postgres twins) rather than new files.
- **Invoicing a visit and using it from a course can no longer both win.** The invoice-line insert of a visit is
  conditional in the same batch: its `invoice_id` is `(select … where not exists (an active course use))`, NULL – the
  whole draft refused, "already on another invoice or used from a course" – when a use landed meanwhile; the separate
  pre-read is gone (no extra request per invoice). Same for replacing a draft's lines (`updateDraftInvoice`, which had no
  course check at all). The use's insert already reads invoice lines in its batch. On Postgres both batches first take a
  transaction advisory lock per appointment (`visitLockQueries`, sorted) so READ COMMITTED cannot let each pass the
  other's check; SQLite/D1 run one write batch at a time. Only once the course tables exist (`coursesInstalledCached`,
  remembered per database once true).
- **Gateway requests:** issuing makes the course / gift-card / product reads only when the invoice has an `item` line,
  once before the retry loop (each attempt builds its statements with its own token); credit notes likewise only for
  credited item lines. A plain service invoice issues with exactly the requests it made before PK02.
- **Screens:** the use buttons' accessible names start with their visible text ("Reverse – put back the visit on …",
  "Reverse to invoice – the visit on …", WCAG 2.5.3); the Courses intro reads "1 active course. Visits a course covers…".
- **Demo seed resume (pre-existing, not changed):** `workers/data-gateway/test/pms-demo-seed-stack.test.ts` stops billing
  at 6 fixed request counts. Stopped at other counts (3,000 / 6,000 / 18,000 / 24,000 requests) the resumed seed ends
  with ±1 payment allocation against an uninterrupted run – **on `main` too** (checked 11/11/2026), so it is the seed's
  resume, not PK02–PK05. The branch's 6 fixed points pass now that ordinary invoices make the same requests as on
  `main`. Left for a seed fix of its own.
- **Known behaviour (no change):** a session used for a visit stays used if the appointment later becomes DNA or
  cancelled – Reverse puts it back (it never looks at the appointment's status); `recordCourseUse` accepts a visit dated
  before the sale.

## 7. Built – PK04 gift cards (11/11/2026, branch `feat/courses`, not merged, migrations not applied anywhere)

| What | Where (screen) | Code |
|---|---|---|
| Sell a gift card (value £1–£1,000, optional "for" name, encrypted): a draft invoice to the buyer with an `item` line "Gift card (no VAT – VAT is charged when it is spent)" + its line reference + the card (status pending) – one batch; or "Sell and issue invoice". The **code is shown once** ("Write this code on the gift card now"), stored only as SHA-256 of clinic + code and its last 4 | Patient → **Invoices** → Gift cards → **Sell a gift card** | `pms_gift_cards` (0234); `giftCardDraftQueries` via `createDraftInvoice(…, { extra })` |
| The card can be spent once its invoice is **issued** (activated in the issue batch: balance = value, "sale" move, expiry 24 months less a day); a cancelled draft cancels the card | – | `giftCardStartQueries`, `giftCardCancelDraftQueries` |
| Spend: **Take payment → Gift card** asks for the code (typed any way); refused when not issued, cancelled, expired, empty or more than is left ("Only £30.00 is left…"). The payment and the balance change are one batch, optimistic on the balance read | Take payment dialog | `giftCardRedeemQueries` via `recordPayment(…, { extra })`; `pms_gift_card_moves` (0235) |
| Reversing that payment puts the amount back (a "refund" move) in the reversal's batch | Invoice → payments | `giftCardRestoreQueries` in `reversePayment` |
| Crediting (or voiding) the sale line: only in full and only while the card is unspent – the card is then cancelled (balance 0, an "adjust" move) | Invoice → credit note / void | `giftCardCreditQueries` in `issueCreditNote` |
| Billing → **Gift cards**: what active cards still hold (liability), the latest 200 cards, look one up by its code (a server action – **a code never goes in a URL**), a card's history | `/app/clinic/billing/gift-cards` (billing.view; site-limited members see cards bought by patients of their sites) | `src/server/pms/billing/gift-cards.ts`, `src/components/pms/billing/gift-cards.tsx` |

**Decisions taken while building (differ from §1):**
- **No `gift_card` payment method:** `pms_payments.method` HAS a CHECK (0131), so changing it means rebuilding the table on
  SQLite. A gift-card payment is method **`other`** with reference "Gift card •••• •••• X2HP"; the link payment → card is
  the move's `payment_id` (that is how a reversal finds what to put back).
- The buyer must be a **patient** (an invoice needs one); `buyer_patient_id` stays nullable for later.
- The card row is made with the **draft** (status `pending`, one more status than §2) so the code can be handed over at
  the till; it spends nothing until the invoice is issued.
- Expiry fixed at 24 months less a day from the sale (no per-card choice yet); no expiry sweep job (the screens show
  "Expired" from the date; the `expire` move kind is reserved).
- Line VAT code `exempt` when the clinic is VAT-registered (`none` otherwise) – the line carries no VAT either way.
- Codes: 12 characters from `ACDEFGHJKMNPQRTUVWXYZ234679` (no 0/O, 1/I/L, 5/S, 8/B), `XXXX-XXXX-XXXX`.

**Review fixes (11/11/2026)** – tests in `src/server/pms/billing/courses-giftcards-review.test.ts` and `gift-cards.test.ts`:
- **Gift-card value never becomes cash.** (a) A gift-card payment must be allocated in full to invoices: Take payment
  refuses "nothing is kept on account", and the database refuses it too (the redeem move's card id is NULL unless the
  payment's `allocated_pence = amount_pence` in its batch). Taking a gift-card payment off its invoice (Take off /
  `removeAllocation`) is refused – reverse it instead. (b) **Refunds: the simpler safe option – refuse.** `refundFor`
  never pays out the gift-card-funded part as cash, card or bank transfer: "£X of what was paid on this invoice came
  from a gift card … reverse that payment: the amount goes back on the card" (at most the money paid another way can be
  refunded). The Refund dialog says so and defaults to that amount (`giftCardPaidPence` on the invoice view). No
  "back to the gift card" refund kind was added: reversing the gift-card payment already restores the card.
- **Takings exclude redemptions.** Billing → "Taken today" (and the dashboard tile, which reads the same figures) and the
  reports' money **received** leave out payments that have a gift-card `redeem` move – identified by the move linked to
  the payment, never by the method or reference text (`notGiftCardSpend`, only once the tables exist). The money was
  counted when the card itself was sold. There is no separate cash-up report; account statements still list the
  gift-card payment against the invoice it paid (reference "Gift card •••• …").
- **The code is never lost.** If the draft (and card) is made but issuing fails (refused or an error), `sellGiftCardFor`
  still returns ok with the one-time code, `issued: false` and `issueProblem`; the card stays pending on its draft and
  the screen shows the code with "issue the invoice from the invoice page".
- **Crediting a sale:** at most the card's **unspent** balance can be credited (a partly spent card included); the
  balance drops by the credit in the same batch (an "adjust" move, optimistic on the balance read); credited down to
  nothing, the card is cancelled. Audit `pms.gift_card.credit` (part) / `pms.gift_card.cancel` (to nothing).
- **Reversing a gift-card payment on a cancelled card is refused** (its value was credited on the sale – putting it back
  would give it twice); before, the reversal went through and the amount was silently lost.
- **VAT on the sale line:** `VAT_CODES` has no "outside the scope of VAT" code, so the line stays `exempt` (VAT-registered)
  / `none` – it carries no VAT either way. Adding such a code would touch the invoice line CHECKs; left for later.

**Audit:** `pms.gift_card.sell|start|redeem|refund|cancel|credit` (ids and amounts, never the code). **Before the migrations:**
reads answer "no gift cards"; invoices, credit notes and payments get no gift-card statement unless they have card rows.
**Tests:** `src/server/pms/billing/gift-cards.test.ts` (pure code rules + the whole flow on node:sqlite and PGlite, offboarding,
tenant-scope guard).

## 8. Built – PK05 products and stock (11/11/2026, branch `feat/courses`, not merged, migrations not applied anywhere)

| What | Where (screen) | Code |
|---|---|---|
| Products: name, SKU (optional, once per clinic), price, VAT code (default standard rate; the field shows for VAT-registered clinics), "warn when stock is at or below", on sale / switched off | Set-up → **Products** (`/app/clinic/setup/products`, settings.setup; owner or admin with every site) | `pms_products` (0236), hangs off `pms_billing_settings` |
| Stock per site as append-only moves: **received** (+), **sold** (−), **returned** (+), **adjusted** (±, reason required, encrypted). On hand = the sum; value = on hand × price; low-stock flag | Billing → **Stock** (`/app/clinic/billing/stock?site=`; billing.view, receive/adjust billing.edit at the member's sites) | `pms_stock_moves` (0237) |
| Sell a product: product, quantity 1–99, the site it is sold from (required – its stock goes down there) → draft invoice with an `item` line + line reference, or "Sell and issue invoice" | Patient → **Invoices** → Products → **Sell a product** | `sellProductFor`; `createDraftInvoice(…, { lineRefs })` |
| The −sold move is written in the **issue** batch at the invoice's site (an invoice selling a product without a site is refused at issue); a product line credited in **full** (credit note or void) writes +returned once (unique per line and kind); a part credit or a write-off leaves the stock as it is | – | `stockSaleQueries` in `issueInvoice`, `stockReturnQueries` in `issueCreditNote` |

**Decisions taken while building:** selling from the patient's record (no "New invoice" screen yet); low-stock level is per
product (not per site); a negative on-hand is allowed (sold before it was received) and shows as such – no stock
reservation on drafts. **Audit:** `pms.product.create|update`, `pms.stock.receive|adjust|sell` (ids and quantities; never
the reason). **Before the migrations:** reads answer "no products", invoices issue and credit as before.
**Tests:** `src/server/pms/billing/products.test.ts` on node:sqlite and PGlite with offboarding and the tenant-scope guard.
**Review fixes (11/11/2026):** the −sold moves are prepared once per issue (reads before the retry loop, only for an
invoice with an item line) and +returned only looked up for credited item lines – no extra gateway requests for other
invoices and credit notes.

**Still to do (PK06/PK07):** done 12/11/2026 – see §9.

## 9. Built – PK06 reports and the expiry sweep, PK07 website (12/11/2026, branch `feat/pk06-reports`, not merged, no migration)

| What | Where | Code |
|---|---|---|
| **Course liability**: per site, as at the period's last day (today when the period ends later) – courses sold in the period and for how much (cancelled ones included; a voided sale invoice left out, as in Revenue and Products), courses with sessions left, sessions sold / used / left, **value unused** = sale line total less credit notes issued by that date × left ÷ sold (whole pence, halves away from zero), and what expires within 30 days of the date | Reports → Finance → **Course liability** (`/app/clinic/reports/course-liability`, CSV) | `courseFacts` in `src/server/pms/billing/reporting-source.ts`; `courseLiability` in `src/modules/pms/reporting/liability.ts` |
| **Gift card liability**: per site, held at the start (end of the day before the period), sold, spent (less spends put back), credited, expired, held at the end ("as at"). Reconciles: start + sold − spent − credited − expired = end | Reports → Finance → **Gift card liability** | `giftCardFacts`, `giftCardLiability` |
| **Products and stock**: per product and site, units sold and given back, net (sold less credit notes in the period), VAT, total; stock on hand today per site, value at today's sale price (nothing for a count below zero), low-stock flag | Reports → Finance → **Products and stock** | `productSaleFacts`, `stockFacts`, `products`; `productSales`, `stockRows` |
| **Expiry sweep**: active courses past their expiry → `expired` (audit `pms.course.expire`); gift cards past their expiry (active, used up, or expired with a spend put back) → `expired`, balance 0, an `expire` move of what was left (audit `pms.gift_card.expire`, ids and amounts only) | Daily cron `GET /api/cron/retention` (vercel.json `17 3 * * *`, `CRON_SECRET`) – after an authorised retention pass and AFTER the billing extras (`afterRetentionCron`); a time budget of 20 s (`EXPIRY_RUN_BUDGET_MS`): no new clinic or batch after it, the rest the next night, logged `stoppedEarly`; each step caught on its own (getDb() opened inside), so the route always returns its response | `src/server/repos/pms/billing/expiry.ts`, `src/server/cron/expiry.ts` |
| **Course uses follow the VISIT's date** (review fix): a course is offered for, and used by, any visit dated on or before its expiry – whenever the use is recorded, also after the course expired and after the sweep marked it `expired` (its last session used, it stays `expired`). Refused: a visit after the expiry ("The course had expired on the visit's date."), no session left ("That course has no session left."), a cancelled course. A visit ticked "Use course" whose use is refused is NOT invoiced instead: the result lists it (`courseRefused`) and the visits screen says why (`courseRefusedText`) | Billing → Visits to invoice | `recordCourseUse`, `courseOffersFor`, `courseCovers`, `useCoursesForVisits`, `invoiceVisitsFor` |
| **Gift cards keep today's rule**: past its expiry (UK date) a card spends nothing (the balance update matches no row), and its sale can no longer be credited or voided ("has expired") – the same answer before and after the sweep (also for an expired card holding a spend put back) | – | `giftCardRedeemQueries`, `giftCardCreditQueries` |
| **Reversing a gift-card spend on an expired card** (or one whose last valid day is today): a warning that the amount goes back on an expired card and is removed by the nightly expiry. **No reverse-payment dialog exists yet** – the warning is ready for it (`giftCardReversalNotice(ctx, tenantId, paymentId)`; text `giftCardReversalWarning`) | – | `src/server/repos/pms/billing/gift-cards.ts`, `src/modules/pms/billing/gift-cards.ts` |
| Moving an expired course's expiry to today or later (or removing it) makes it active again – used up when no session is left (audit detail `reactivated`) | Patient → Invoices → Change expiry | `setCourseExpiry` |
| **Website (PK07)**: two lines in the billing section of clindesk.co.uk/features (courses; gift cards, products and stock, the reports) – no memberships, no online selling | `src/app/clindesk-site/features/page.tsx` | – |

**Rules and decisions:**
- **The expiry day itself is valid**; "expired" = the UK date is after `expires_on` (BST midnight included). For a
  COURSE USE the date that counts is the visit's (visit date ≤ `expires_on`), not today: a visit on the last day can be
  invoiced and used from the course days later, before or after the sweep – the answer is the same either way. For a
  GIFT CARD it is today (spend, credit, void). (Changed 12/11/2026 after review: a "today" rule for course uses let a
  last-day visit be charged as well as paid for by the course.)
- Every figure comes from billing's reporting source (the reports never read billing's tables); facts are checked
  (another site, an unknown product, an expired course, bad numbers are dropped and logged). Permissions as the other
  Finance reports: `reports.all`, CSV `reports.export` (audited `pms.report.export`, formula-safe cells), site scope from
  the member's sites. A course / card belongs to the site of the invoice that sold it ("No site" when it has none –
  shown only to members who see the whole clinic).
- "As at" uses the stored dates and instants: a course counts from its sale date until cancelled (`cancelled_at`), used
  sessions by the visit date (reversals by `reversed_at`), credits by the credit note's date; a card's sale by its sale
  date, other moves by when they were recorded. The sweep's own "expire" move is never counted as a spend or credit,
  so the gift-card figures are the same before and after it.
- Sweep safety: per clinic (a cross-clinic read of clinic ids only, to find who has something to sweep), 25 rows per
  batch (≤ 75 statements, few parameters), each statement conditional on the row as read (status, rev / balance, still
  past expiry) – a second run, or two at once, change nothing; a card changed between read and batch makes the batch
  refuse and the cards are then tried one by one (the changed one waits for the next night). At most 2,000 of each per
  clinic per night. One clinic's failure does not stop the others. Logs counts only (`cron.expiry.done`).
- A spend put back (payment reversed) on a card that has expired goes back on the card and is taken off again by the
  next sweep (unchanged PK04 behaviour – the money is not refunded); the reverse-payment confirmation is to warn of it
  (see the table). The gift-card liability's opening balance never counts an `expire` move either.
- **Known, left as is (review item 7): two site definitions for gift cards.** The reports put a card at the site of the
  invoice that sold it; the Gift cards screen scopes a site-limited member by the buyer patient's visibility. They
  agree in the normal case (sold at the patient's site); a card sold at another site can show on one and not the other.
- No migration (0239 unused): the sweep's reads use the existing indexes; volumes are small.

**Tests:** `src/modules/pms/reporting/liability.test.ts` (pure figures, fact checks, catalogue);
`src/server/pms/billing/testing/pk06-reports-suite.ts` and `pk06-expiry-suite.ts` (incl. the review fixes: last-day
visit used after expiry and after the sweep, the use messages, refused uses returned, past-expiry card credit / void
refused, the reversal warning, the sweep's deadline, a voided course sale left out), run on node:sqlite and PGlite
(`pk06-reports.test.ts`, `pk06-expiry.test.ts`, tenant-scope guard) and on D1 through the gateway
(`workers/data-gateway/test/pk06-stack.test.ts`, stand-in and local workerd). Also `courses-service.test.ts`
(invoicing through the diary's visits: last-day visit before / after the sweep, a refused use not invoiced),
`src/server/cron/expiry.test.ts` (order billing → sweep, nothing thrown, a database that cannot be opened),
`liability.test.ts` (opening balance without `expire`), `courses.test.ts`, `gift-cards.test.ts` (pure).
