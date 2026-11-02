# Healthcode e-billing – groundwork (ClinDesk)

**Internal.** 01/11/2026, branch `feat/healthcode-phase1`. Not merged, not deployed, migrations not applied anywhere.

Healthcode is the UK clearing house most private medical insurers take bills through (Bupa, AXA Health, Aviva,
Vitality, WPA, Cigna and others). We do **not** have Healthcode's file specification yet, so this phase builds
everything that does not depend on it: the identifiers and codes each bill needs, a check that tells the clinic which
insurer invoices are ready, and a manual bill status. Nothing is sent to Healthcode.

## 1. What is built

| Id | What | Where (screen) | Code |
|---|---|---|---|
| HC06 | Per insurer: Healthcode insurer identifier (e.g. `bup`), the clinic's provider number with that insurer, "diagnosis code on every bill" (default by name: Bupa, AXA Health, Vitality – needed; others not; the clinic can override) | Set-up → Referrers and insurers → an insurer → **Healthcode** card | `pms_payer_healthcode` (0220) |
| HC07 | The clinic's **Healthcode Site ID** and **payee provider number**; a site registered on its own can have its own (blank = the clinic's) | Set-up → Billing settings → **Healthcode** card | `pms_healthcode_settings`, `pms_site_healthcode` (0221) |
| HC08 | Each practitioner's provider number per insurer | Set-up → Practitioners → a practitioner → **Insurer provider numbers** | `pms_practitioner_insurer_numbers` (0222) |
| HC09 | Each insurer's treatment code (ISC) per service; a CCSD code per service. No code values are built in | Set-up → **Insurer treatment codes** (new page); Set-up → Services (CCSD field + column) | `pms_service_insurer_codes`, `pms_service_codes` (0223) |
| HC10 | ICD-10 diagnosis: format check (letter + 2 digits, optional `.` + 1–2 characters; `m545` → `M54.5`) on invoice drafts/edits and on the case; picker of 23 common MSK codes (WHO ICD-10); an invoice uses its own code, else its case's | Case page → **Diagnosis** panel (clinical.view; patients.edit to change); invoice page → **Healthcode** panel (billing.edit + clinical.view) | `pms_case_diagnosis` (0224, encrypted), `pms_invoices.diagnosis_enc` (existing); `src/modules/pms/billing/icd10.ts` |
| HC11 | "Ready / needs review" check, pure, plain-English reasons with a fix link | – | `src/modules/pms/billing/healthcode-check.ts` |
| HC12 | Claims page **Healthcode** tab: issued insurer invoices (default last 90 days, max 200 checked) in Ready / Needs review; one Site ID per file noted; export log by batch reference; **Download Healthcode file** disabled – "Available once Healthcode file submission is switched on" | Billing → Insurer claims → Healthcode (`?tab=healthcode`) | `src/server/pms/billing/healthcode.ts`, `src/components/pms/billing/healthcode-claims.tsx` |
| HC13 | Bill status per insurer invoice: exported, validated, failed, collected, paid (or "Not sent yet"), set by hand; shown on the invoice and in both claims lists; audited with old → new | Invoice page → Healthcode panel | `pms_invoice_bill_status` (0225) |

**The check (HC11)** – an issued, not voided invoice to an insurer is *Ready* when: the insurer's Healthcode
identifier and the clinic's provider number with it are set; the payee provider number and Site ID (the invoice's site
or the clinic's) are set; the patient has first and last name, date of birth and postcode; the case has a membership
number; there is an authorisation that is not cancelled, valid on every treatment date and not over its sessions
(sessions are already counted when the invoice is issued, so "used = authorised" is fine); a diagnosis code is present
when the insurer needs one and in ICD-10 format whenever present; every treatment line has a date, a practitioner with
their provider number for that insurer, and the insurer's treatment code for the service. Item and excess lines are
not treatments and are not checked line by line. A batch of ready invoices with more than one Site ID is shown as
that many files.

**Permissions.** Set-up cards: `settings.setup`, changes by the owner or an admin with every site. Healthcode tab:
`billing.view` in the member's site scope. Bill status: `billing.edit`. Diagnosis codes are clinical
(`clinical.view` to see; reasons never repeat a code).

**Audit actions** (`src/modules/pms/audit/billing.ts`): `pms.payer_healthcode.set`, `pms.healthcode_settings.set`,
`pms.site_healthcode.set`, `pms.practitioner_insurer_number.set`, `pms.service_ccsd.set`,
`pms.service_insurer_code.set`, `pms.case_diagnosis.set`, `pms.invoice.diagnosis_set`, `pms.invoice.bill_status`.
Details name fields set or statuses, never the numbers or codes themselves.

**Before the migrations:** every read answers "not set up yet" when its table is missing (`readOrEmpty`), so the
release can go out before 0220–0225 are applied; only saves fail until then.

## 2. Migrations (additive only – new tables)

Billing owns `0220`–`0229` (`src/modules/pms/core/modules.ts`). Each SQLite file has its Postgres twin
`supabase/migrations/20261024000NNN_*.sql` (RLS on, Data API roles revoked):

| SQLite | Postgres | Tables |
|---|---|---|
| `0220_pms_payer_healthcode.sql` | `20261024000220_pms_payer_healthcode.sql` | `pms_payer_healthcode` |
| `0221_pms_healthcode_sites.sql` | `20261024000221_pms_healthcode_sites.sql` | `pms_healthcode_settings`, `pms_site_healthcode` |
| `0222_pms_practitioner_insurer_numbers.sql` | `20261024000222_pms_practitioner_insurer_numbers.sql` | `pms_practitioner_insurer_numbers` |
| `0223_pms_service_codes.sql` | `20261024000223_pms_service_codes.sql` | `pms_service_codes`, `pms_service_insurer_codes` |
| `0224_pms_case_diagnosis.sql` | `20261024000224_pms_case_diagnosis.sql` | `pms_case_diagnosis` (`id` = the case id, so the offboarding export decrypts it) |
| `0225_pms_invoice_bill_status.sql` | `20261024000225_pms_invoice_bill_status.sql` | `pms_invoice_bill_status` |

Every foreign key is `ON DELETE CASCADE` to its parent row (payer account, the clinic's `pms_billing_settings` row,
site, practitioner, service, case, invoice): offboarding deletes these rows with their parents and does not name the
tables in its one-batch delete (the gateway's 100-statement limit; `PMS_CASCADE_DELETED_TABLES`). Nothing in the app
hard-deletes those parents otherwise.

Production (Supabase): apply with the usual runner (session pooler, `CLINFORMS_DB=postgres npm run db:migrate`)
**only with Khuram's go**. All tables are in `src/server/db/pms-schema/billing.ts`, so the D1 → Postgres copy and
offboarding (export + delete) include them.

## 3. What waits on Healthcode's specification

- **The file itself**: format (XML schema), field names and lengths, encoding, how lines, practitioners, diagnosis and
  payee are expressed, batch header (Site ID, counts, totals), file naming. The channel stub
  (`src/server/pms/billing/ebilling-channels.ts`, Healthcode channel) still refuses; `claimLines` + the facts gathered
  for the check (`healthcodeFactsFor`) are the input a file builder will take.
- **Which insurers need what**: diagnosis required per insurer (today a name-based default the clinic can override),
  whether CCSD or ISC codes go on the line, practitioner numbers vs registration numbers, excess handling.
- **Submission**: upload route (portal upload vs. secure transfer/API), test environment, certification steps,
  acknowledgement and rejection files – then the bill status (HC13) can be set automatically from Healthcode's
  responses instead of by hand.
- **Code lists**: identifier list for insurers (we only have the example `bup`), whether Healthcode validates ISC/CCSD
  values against its own tables.
- Then: switch `HEALTHCODE_FILE_SUBMISSION_ENABLED` per clinic (it becomes a clinic setting), log each file in
  `pms_invoice_exports` with channel `healthcode`, and add Healthcode to the DPA/DPIA (billing.md §11).

## 4. Clinic set-up guide (draft – for clinics, plain wording)

> **Sending insurer bills through Healthcode – getting ready**
>
> 1. **Register with Healthcode.** The clinic registers for Healthcode's e-billing service and receives its
>    **Site ID** and the **payee provider number** (who the insurers pay). Enter both in **Set-up → Billing
>    settings → Healthcode**. If a site is registered on its own, enter its own Site ID under that site.
> 2. **Insurers.** For each insurer you bill (Set-up → Referrers and insurers → the insurer → Healthcode):
>    - the insurer's **Healthcode identifier** – as Healthcode lists it;
>    - the clinic's **provider number** with that insurer – from the insurer's recognition letter;
>    - whether the insurer needs a **diagnosis code** on every bill (Bupa, AXA Health and Vitality do by default).
> 3. **Practitioners.** Each insurer recognises practitioners individually. Enter every practitioner's number for each
>    insurer under **Set-up → Practitioners → Insurer provider numbers**.
> 4. **Treatment codes.** Under **Set-up → Insurer treatment codes**, choose an insurer and enter its code for each
>    service you bill it. Enter the **CCSD code** on each service (Set-up → Services) where the insurer uses it.
> 5. **Every case.** Record the patient's **membership number**, the insurer's **authorisation** (code, sessions,
>    dates) and the **diagnosis** (ICD-10, e.g. M54.5 – pick from the list or type the code). Check the patient's
>    date of birth and postcode.
> 6. **Before sending.** Billing → Insurer claims → **Healthcode** lists each issued insurer invoice as **Ready** or
>    **Needs review**, with what to add and a link to the right screen. Once Healthcode file submission is switched
>    on for the clinic, ready invoices go in one file per Site ID. Until then, keep using the claims file or the
>    insurer's portal, and record each bill's status (Exported, Validated, Failed, Collected, Paid) on the invoice.

## 5. Tests

`src/modules/pms/billing/healthcode.test.ts`, `icd10.test.ts`, `healthcode-check.test.ts` (pure);
`src/server/repos/pms/billing/healthcode-repos.test.ts` (+ `testing/healthcode-suite.ts`) and
`src/server/pms/billing/healthcode-service.test.ts` on node:sqlite and PGlite with the tenant-scope guard; migration
parity (`db/parity.test.ts`) and ranges (`scripts/pms/contract.test.ts`). The public website is unchanged (its test
still bans the word "healthcode" there).
