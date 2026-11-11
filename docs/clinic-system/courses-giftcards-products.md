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

**Audit:** `pms.gift_card.sell|start|redeem|refund|cancel` (ids and amounts, never the code). **Before the migrations:**
reads answer "no gift cards"; invoices, credit notes and payments get no gift-card statement unless they have card rows.
**Tests:** `src/server/pms/billing/gift-cards.test.ts` (pure code rules + the whole flow on node:sqlite and PGlite, offboarding,
tenant-scope guard).
