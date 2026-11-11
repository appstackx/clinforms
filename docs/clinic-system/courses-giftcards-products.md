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
