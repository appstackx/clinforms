# Clinic system – build contract (one-week sprint)

**Internal.** Sat 24 Oct 2026. Branch `feat/clinic-system` (foundation). Every module builder follows this file; changing
it needs the orchestrator. Background: `docs/strategy/pms-reuse-and-packaging.md` (one codebase, `src/modules/pms`
beside `medreport`, entitlements per clinic, composite tenant keys) and `docs/strategy/all-in-one-pms-feasibility.md`
(§2 module table, §3 compliance). ClinForms rules still apply in full: `CLAUDE.md`, `docs/production-architecture.md`,
`docs/database.md`, `docs/auth.md`.

**What the sprint builds:** a clinic management system with the feature set UK physio groups expect from their practice
system – multi-site diary, online booking, patients, clinical notes, letters, invoicing incl. insurer and MLC accounts,
payments, reminders, reporting, roles, intake forms, patient portal, data import – as production-ready code inside
ClinForms, switched on per clinic. Demo first (fictional data only); onboarding a real clinic is a separate task.

---

## 1. Hard rules (every module)

1. **`main` is production.** Never push to `main`, never deploy, never write to a production database. Work on your
   module branch, cut from `feat/clinic-system`.
2. **Off unless entitled.** Nothing of the clinic system is reachable unless the clinic has the `clinic` package.
   ClinForms (the `reports` package) must behave byte-for-byte as before for every clinic without it – never edit a
   ClinForms page, the medreport module or a shared file outside your ownership (§3) without the orchestrator.
3. **Tenant scoping.** Every table has `tenant_id`; record tables have `PRIMARY KEY (tenant_id, id)`; every foreign
   key includes `tenant_id`; every query names `tenant_id` (tested, §8).
4. **Clinical free text is encrypted** with the per-clinic AES-GCM envelope (`_enc` columns, §4). Lists never decrypt.
5. **Every write is audited** through the repositories (§7). Audit rows never hold patient data.
6. **Retention:** clinical records are kept (adults 8 years after the last treatment, configurable upwards;
   children longer – `src/modules/pms/core/retention.ts`). **No code deletes clinical records**, no scheduled job
   either; records are archived. Only offboarding a whole clinic deletes, after a verified export (§10).
7. **Fictional data only:** organisations end "(fictional)", clinicians `PH-DEMO-0N`, patients `sim-pat-NNN`, phone
   numbers from Ofcom's drama ranges (`07700 900xxx`, `01632 960xxx`), email `@example.com`.
8. **No secrets in git, no third-party templates, no new paid services.** SMS, email and payment providers sit
   behind interfaces with a safe default (outbox/log) and test mode only – no live keys, no real messages (§11).
9. **Wording:** UK English, neutral, plain. No "AI", vendor or model names on screen; never "TM3", a competitor's
   product name, "CareConnect" or "Practice" as a name (§2). Accessibility: keyboard, labels, contrast, 375 px.
10. **Ports 3180–3199 only**; stop every server you start. Playwright:
    `NODE_PATH=/Users/khuram/Projects/Appstackx/pigeon-web/node_modules node scripts/e2e/<script>.cjs`.
11. **Commit trailer:** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Full check chain before you hand
    over (§8).

## 2. Product name, brands and domains

- The clinic system's name is a **placeholder**: `CLINIC_SYSTEM_NAME = "Clinic system"` in **`src/lib/brand.ts`** – the
  ONE constant. Import it; never type the name. Screens are labelled by what they do ("Diary", "Patients",
  "Invoices"). `scripts/pms/contract.test.ts` fails on banned names in clinic-system files.
- **Brand by host name, one config, no duplicated code** (`src/lib/brand.ts`):
  - `clinforms.co.uk` (and previews, localhost): brand **ClinForms**. The public site is about reports. A clinic with
    the `clinic` package sees "Clinic system" in its navigation and the clinic area at `/app/clinic`.
  - A future second domain (e.g. `app.<newbrand>.co.uk`): add its host to `BRANDS.clinic.hosts` – same deployment,
    same code, same pages and database. On that host the product name is the placeholder, `/` and the other public
    pages redirect to sign-in (`src/middleware.ts`), and members land on `/app/clinic`. Locally:
    `http://clinic.localhost:3180`.
  - **Before a second domain goes live** (not in this sprint): Better Auth takes one base URL today, so sign-in on a
    second host needs `trustedOrigins` + a per-request base URL (as for previews), invitation and reset links per
    brand, and a decision on whether one account spans both hosts (cookies are host-only: signing in on one host does
    not sign you in on the other). The pages need nothing else.
- Server components get the request's brand with `currentBrand()` (`src/server/brand.ts`).

## 3. Modules, ownership and migration numbers

Each builder edits **only** its own folders, its own migration numbers, and its own registry files (navigation,
record tabs, audit labels, schema). Everything else is read-only; ask the orchestrator for a change.

| Module | Builds | SQLite / D1 migrations | Postgres twins | Nav `order` band |
|---|---|---|---|---|
| **foundation** | Packages (entitlements), shell, brand, shared patient record, directory, demo seed | `0100`–`0109` | `20261024000100`–`…0109` | 0–9 |
| **diary** | Multi-site diary: availability/rotas, appointments, rooms, statuses (booked, arrived, in treatment, attended – "Completed" on screen –, did not attend, late cancellation), recurring bookings, no double booking of rooms (a practitioner only with `diary.override`, logged), day/week views by practitioner and room | `0110`–`0119` | `…0110`–`…0119` | 10–19 |
| **records** | Patient list and record screens, cases and authorisations screens, clinical notes (templates, sign and lock, amendments, attachments, outcome measures) | `0120`–`0129` | `…0120`–`…0129` | 20–29 |
| **billing** | Invoices (self-pay, insurer/MLC on account, excess split), credit notes, payments (manual + provider interface), insurer/MLC accounts and statements, debtors | `0130`–`0139` | `…0130`–`…0139` | 30–39 |
| **comms** | Reminders (SMS/email, outbox by default), message log, templates, letters with merge fields | `0140`–`0149` | `…0140`–`…0149` | 40–49 |
| **portal** | Online booking (public), patient portal, intake forms and consent with e-signature | `0150`–`0159` | `…0150`–`…0159` | 50–59 |
| **reporting** | Fixed reports + CSV, clinic set-up screens (sites, rooms, practitioners, appointment types, prices, referrers, record-keeping settings), roles overview | `0160`–`0169` | `…0160`–`…0169` | 60–69 |
| **integration** | Data import (CSV exports of an earlier system: patients, cases, appointments, balances), native connector to ClinForms, public API | `0170`–`0179` | `…0170`–`…0179` | 70–79 |

Follow-up numbers (M9b polish, handover §19), owned exactly like the ranges above: diary `0180`–`0181` and `0189`, portal
`0182`–`0185`, reporting `0186`–`0187`, records `0188` (`extra` in `src/modules/pms/core/modules.ts`). M10 performance
(handover §20.4, additive indexes only, 0210–0219): diary `0210`, records `0211`, billing `0212`, foundation `0213`.

Postgres twin of `0NNN_name.sql` = `supabase/migrations/20261024000NNN_name.sql` (`2026102400` + the 4 digits + same
name). Single source: `src/modules/pms/core/modules.ts`; `scripts/pms/contract.test.ts` fails on a number outside a
range or a missing twin.

### File ownership

`<m>` = your module id (`diary`, `records`, `billing`, `comms`, `portal`, `reporting`, `integration`).

| Owner | Files and folders |
|---|---|
| **Every module `<m>`** | `src/modules/pms/<m>/**` (pure domain: types, zod schemas, rules, copy) · `src/modules/pms/nav/<m>.ts` · `src/modules/pms/record-tabs/<m>.ts` · `src/modules/pms/audit/<m>.ts` · `src/server/db/pms-schema/<m>.ts` · `src/server/repos/pms/<m>/**` · `src/server/pms/<m>/**` · `src/components/pms/<m>/**` · its routes (below) · its migrations · `scripts/pms/<m>-*.ts` and `scripts/pms/seed-<m>.ts` · `scripts/e2e/pms-<m>-*.cjs` · `workers/data-gateway/test/pms-<m>-stack.test.ts` · `docs/clinic-system/<m>.md` |
| diary | routes `src/app/app/clinic/diary/**`; record tab folder `src/app/app/clinic/patients/[patientId]/appointments/**` |
| records | routes `src/app/app/clinic/patients/**` (the list, the record's layout and its first page, cases, authorisations, notes) – except other modules' tab folders |
| billing | routes `src/app/app/clinic/billing/**`; tab folder `…/patients/[patientId]/invoices/**` |
| comms | routes `src/app/app/clinic/messages/**`, `src/app/app/clinic/letters/**`; tab folder `…/patients/[patientId]/messages/**` (in the record's `(record)` group); its sessionless endpoints `src/app/api/clinic-messages/**` (the message run for the cron, the SMS provider's webhook, the stop-emails link – thin wrappers over `src/server/pms/comms/*`, M6) |
| portal | routes `src/app/app/clinic/online-booking/**`, `src/app/app/clinic/intake/**`; public routes `src/app/(public-clinic)/**` (booking, portal, intake – create the route group); tab folder `…/patients/[patientId]/forms/**` |
| reporting | routes `src/app/app/clinic/reports/**`, `src/app/app/clinic/setup/**` (UI over the foundation's directory repositories) |
| integration | routes `src/app/app/clinic/import/**`; `src/server/pms/native-connector.ts`; with the orchestrator's go only: the additive `"native"` in medreport's `ConnectorIdSchema` and one registration line in `src/app/api/_medreport-glue.ts` |
| **foundation / orchestrator** (read-only for builders) | `src/modules/pms/core/**`, `src/modules/pms/{nav,record-tabs,audit}/{index,foundation}.ts`, `src/modules/pms/README.md` · `src/server/db/schema.ts`, `src/server/db/pms-schema/{index,foundation}.ts` · `src/server/repos/pms/*.ts` (top level) and `src/server/repos/pms/testing/**` · `src/server/pms/*.ts` (top level: actor, entitlements, http, admin, offboard) · `src/app/app/clinic/{layout,page}.tsx` · `src/lib/brand.ts`, `src/lib/activity-copy.ts`, `src/middleware.ts` · `src/app/app/(clinic)/**`, `src/app/app/platform/**`, `src/app/app/studio/layout.tsx` · `scripts/pms/{seed-demo,seed-lib,demo-data,contract.test,seed-demo.test}.ts`, `scripts/admin/set-entitlement.ts` · `package.json`, `.eslintrc.json` (generated), `scripts/medreport/gen-eslint-boundary.mjs` · migrations `0100`–`0109` · this file |

New npm dependencies, a new permission, a change to a shared (foundation) table, a ClinForms file: ask the
orchestrator. A module that needs more data about a patient or case adds **its own table** keyed by
`(tenant_id, patient_id)` / `(tenant_id, case_id)` – it never alters a foundation table.

### Module boundary (ESLint, generated)

- `src/modules/pms/**` is pure and browser-safe: no `src/lib`, `src/components`, `src/server`, `src/app`, sandbox, no
  server-only libraries (`node:*` only in tests), no relative imports out of the module. From medreport it may import
  **only** `@/modules/medreport/connectors/types` (with `import type`). **medreport never imports pms.**
- Rules: `scripts/medreport/gen-eslint-boundary.mjs` → `npm run medreport:eslint-boundary` (never hand-edit
  `.eslintrc.json`; the contract test fails when it is stale).

## 4. Data: migrations, schema, repositories

**Migrations (both dialects, same commit).** Follow `docs/database.md` §3 and these:
- `CREATE TABLE IF NOT EXISTS …`, `PRIMARY KEY (tenant_id, id)`, `FOREIGN KEY (tenant_id, <x>_id) REFERENCES
  pms_<y> (tenant_id, id)`; name tables `pms_<thing>`; indexes and unique indexes named `<table>_<what>` and identical
  on both sides (the parity test compares columns, NOT NULL, keys, foreign keys with ON DELETE, indexes).
- Conventions: ids TEXT `<prefix>_<ULID>`; timestamps `*_at` (TEXT ISO / `timestamptz`); calendar dates `*_on` or
  `valid_from`/`valid_to` as TEXT `YYYY-MM-DD` **on both dialects** (Postgres `date` would come back as a JS Date);
  booleans INTEGER 0/1; money INTEGER pence; free text `<name>_enc`; JSON TEXT; `rev INTEGER` on records two people
  edit; `import_ref` + unique `(tenant_id, import_ref)` on anything an import creates.
- SQLite file: no `BEGIN`/`COMMIT`, **no semicolons in comments**, a lone `ALTER TABLE … ADD COLUMN` per file.
  Postgres file: `alter table … enable row level security` for each table + the `revoke … from anon, authenticated`
  block (copy `20261024000101_pms_directory.sql`).
- Overlap rules (diary): D1 has no exclusion constraints and PGlite has no `btree_gist` loaded – check overlaps in
  the INSERT/UPDATE itself (`… WHERE NOT EXISTS (…)`) and back it with a `BEFORE INSERT/UPDATE` trigger on SQLite and
  a trigger on Postgres. Ask the orchestrator before adding a Postgres extension.

**Schema registry.** In `src/server/db/pms-schema/<m>.ts`: the table interfaces, `<M>Tables`, `<M>_TABLES` (foreign
-key order), `<M>_PRIMARY_KEYS`, `<M>_TIMESTAMP_COLUMNS` (the D1 → Postgres copy) and `<M>_TENANT_TABLES` (offboarding).
The aggregator merges them into `Database`, `TABLES_IN_FK_ORDER` and `PRIMARY_KEYS` – no edit to `schema.ts`.

**Repositories** (`src/server/repos/pms/<m>/<entity>.ts`), pattern = `src/server/repos/pms/patients.ts`:
- signature `fn(ctx: RepoContext, tenantId: string, …, actor: PmsActor)`; validate input with the module's zod schema
  (`parseInput`); `assertTenantId`; `tenant_id` in every WHERE and every insert;
- inserts: `writeWithAudit(ctx, [insert, pmsAuditQuery(ctx, tenantId, actor, {action, targetType, targetId})])` – one
  atomic batch (D1 too); updates: a conditional `UPDATE … WHERE tenant_id = ? AND id = ? AND rev = ?` then
  `pmsAudit(…)` when a row changed; `PmsSaveResult` for revisioned updates (`conflict` / `not_found`);
- constraint errors → `RepoInputError` with a plain message (`guarded`, `translateDbError`);
- encrypted columns: `encryptField(ctx, tenantId, table, "<name>_enc", id, text)` / `decryptField(…)` – AAD
  `<tenant>:<table>.<column>:<id>`; decrypt only in get-by-id, never in lists;
- lists: a limit (≤ 500), ordered, by keyset where it can grow; `IN (…)` lists in groups of 90 (D1: 100 parameters);
- no interactive transactions (D1): multi-statement writes through `runBatch`, conditions in SQL;
- bulk loads (import, seed): batches of ≤ 40 rows + one audit row per batch (see `bulkCreatePatients`).
- **Never** `deleteFrom` a clinical table. Archive (status), cancel or void instead.

**The shared patient record (foundation, read-only for modules).** `src/server/repos/pms/*`:

| Function file | Tables | Main functions |
|---|---|---|
| `patients.ts` | `pms_patients` | `createPatient`, `bulkCreatePatients`, `updatePatient(expectedRev)`, `getPatient`, `getPatientSummaries(ids)`, `searchPatients({q})` (name words, number, phone, DOB, email), `setPatientStatus`, `setPatientLegalHold`, `touchPatientLastSeen` (diary: when attended), `countPatients` |
| `cases.ts` | `pms_cases`, `pms_authorisations` | `createCase`, `bulkCreateCases`, `updateCase`, `getCase`, `listCasesForPatient`, `countCases`; `createAuthorisation`, `bulkCreateAuthorisations`, `updateAuthorisation`, `recordAuthorisationUsage` (atomic, never over the limit or below zero – billing/diary call it), `listAuthorisations`, `listExpiringAuthorisations({from, until})` |
| `directory.ts` | `pms_sites`, `pms_rooms`, `pms_practitioners`, `pms_services` | create/update/get/list each; `findPractitionerByUser` |
| `referrers.ts` | `pms_referrers` (referrers and payer accounts: GP, consultant, insurer, MLC, solicitor, employer, case manager) | `createReferrer`, `updateReferrer(expectedRev)`, `getReferrer`, `listReferrers({kind, q})` |
| `price-lists.ts` | `pms_price_lists`, `pms_price_list_items` | create/update/list, `setPriceListItem`, `removePriceListItem`, `priceFor(serviceId, priceListId)` (payer list → default list → service price) |
| `entitlements.ts`, `settings.ts` | `clinic_entitlements`, `clinic_usage_counters`, `pms_settings` | `isPackageOn`, `setEntitlement`, `incrementUsage`, `getUsage`; `getPmsSettings` (retention years, demo flag) |

Plain vs encrypted: demographics, contacts, GP and consent flags are plain indexed columns (the diary shows names all
day – a DPIA item); medical alerts, patient/case/referrer notes, referral reasons, authorisation notes are encrypted.

**Shared types and rules** (`src/modules/pms/core/`): `types.ts` (Patient, PatientSummary, Case, CaseSummary,
Authorisation, Site, Room, Practitioner, Service, Referrer, PriceList, PriceListItem, PmsActor, PmsSaveResult,
Entitlement, PmsSettings), `schemas.ts` (zod inputs, enums: payer types, case statuses, referrer kinds, professions,
service categories; `fieldErrors`), `text.ts` (`formatUkDate`, `formatPence`, `ukToday`, `normalisePostcode`,
`phoneDigits`, `searchKey`, `isIsoDate`), `authorisations.ts` (`authorisationView`, `canUseAuthorisation`),
`retention.ts`, `permissions.ts`, `entitlements.ts`, `ids.ts`, `modules.ts`, `nav.ts`, `record-tabs.ts`.

**Id prefixes.** Foundation: `pat case auth ref site room prac svc pl pli`. Suggested per module (declare yours in
`src/modules/pms/<m>/ids.ts`, never reuse one): diary `appt avl blk rec`; records `note ntpl natt om`; billing `inv
invl crn pay acct stmt`; comms `msg mtpl ltr`; portal `bkr ptl ifm ifr`; reporting `rpt`; integration `imp impr`.

## 5. Packages (entitlements)

- `clinic_entitlements` (`tenant_id`, `package` = `reports` | `clinic`, `status` = active | trial | paused | cancelled,
  plan code, price source, limits, start/end). **No row = default: reports ON, clinic OFF.** Migration 0100 wrote
  an explicit `reports = active` row for every existing clinic. `clinic_usage_counters` (monthly, per metric:
  `forms_completed`, `practitioners_active`, `sms_segments`, … – `incrementUsage`).
- Switch: platform page `/app/platform` → **Packages** (On/Off; off = paused, nothing deleted), or
  `npm run admin:set-entitlement -- --slug <id> --package clinic|reports --on|--off [--status trial] [--env preview|production]`
  – a preview unless `--confirm` (production also `--yes`, and only with Khuram's go). Audited in the clinic's trail
  (`clinic.package_change`, by "ClinForms support") and the platform's (`platform.entitlement_set`).
- Effects: `clinic` off → `/app/clinic/**` is the 404 page, actions/routes refuse (`not_entitled`), no navigation item,
  no activity filter group. `reports` off → no Studio (404), no Studio navigation item, the Report API refuses the
  members (`NO_CLINIC`) – so a clinic-system-only clinic never reaches the drafting service.
- Fail-safe: if the package table cannot be read, ClinForms keeps Reports on and the clinic system off
  (`clinicPackages`). **Deploy order:** apply migrations `0100`+ before the code that reads them.

## 6. Routes, actors, permissions, navigation

- Every page and layout under `/app/clinic`: `const actor = await requireClinicActor({ permission })` **first**
  (signed in, two-step on, member of the active clinic, `clinic` package on, the role's permission – else the sign-in
  redirects or the 404 page). The shell layout checks too, but a layout never protects a page or an action.
- Server actions (`actions.ts` beside the page, `"use server"`): first two lines
  `const actor = await clinicActionActor({ permission: "…" });` / `if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };`.
  Return `{ ok: true, … } | { ok: false, error, fieldErrors? }`; `revalidatePath` what changed.
- Route handlers (`route.ts`): `export const GET = clinicRoute({ permission }, async (req, actor, params) => …)`
  (`src/server/pms/http.ts`: actor, same-origin for writes, JSON errors, `no-store`).
- Repositories get `actor.repo()` (database + cipher), `actor.tenantId` and `actor.actor` (audit). Never take a
  tenant id or a user id from the request.
- **Permissions** (`src/modules/pms/core/permissions.ts`; changed 28/10/2026 with Khuram's approval – roles design
  round 2): 26 permissions in 7 groups (Diary `diary.view|book|override|rota`; Patients
  `patients.view|edit|referral|merge`; Clinical `clinical.view|write|amend`; Billing `billing.view|edit|pay|refund|void`;
  Messages `messages.send|templates|letters`; Reports `reports.own|all|export`; Settings
  `settings.setup|members|import|owner`) with a default per role, plus `clinic.view` for every active member. A clinic
  can change a role's defaults and give one member exceptions (Set-up → Roles and permissions / Staff access,
  migration 0103); `actor.can()` answers the EFFECTIVE permission. Locks always win: the owner has everything, only
  the owner changes the owner, **reception (staff) never gets a clinical permission or clinical letters**. The first
  build's ids (`patients.export`, `clinical.edit|sign`, `diary.manage`, `billing.manage`, `messages.view|manage`,
  `booking.manage`, `reports.view`, `directory.edit`, `settings.manage`, `import.run`) still work as aliases
  (`LEGACY_ALIASES`); new code uses the grid's ids. Site scope: `actor.siteIds` (works at ∪ can see; null = every
  site) from `src/server/pms/access.ts` – apply it to every list and record read.
- **Appointment statuses for other modules (28/10/2026, Khuram's decision B):** "in treatment" is stored as status
  `arrived` with `treatment_started_at` set (migration 0117), so an adapter reading `pms_appointments.status` sees
  `arrived`. Billing's visit source lists only `CHARGEABLE_STATUSES` (attended, dna, late_cancelled –
  `src/modules/pms/diary/rules.ts`): in treatment is NOT billable until attended. Reports count in treatment as
  arrived (`reportingStatus`). On screen `attended` is "Completed" everywhere.
- **Navigation:** add entries to `src/modules/pms/nav/<m>.ts` (`{ id: "<m>.<x>", module, label, href under
  /app/clinic, order in your band, permission (or a list – any of them), group: "main" | "manage" }`). "manage"
  entries are set-up pages: the main list shows one "Set-up" entry and a set-up page shows the Set-up section's own list
  ("← Clinic navigation"), ordered by `SETUP_ORDER` in `src/components/pms/shell/nav-model.ts` (add your id there).
  Reports have their own section list (reporting). The start page `/app/clinic` is "Today" (reporting, M8). **Record tabs:** `src/modules/pms/record-tabs/<m>.ts` (`segment` = your folder under
  `/app/clinic/patients/[patientId]/`); the records module renders them in the record's layout.
- Public pages (portal: booking, intake) live outside `/app` in their own route group, have no sign-in cookie
  requirement, must rate-limit (`hitRateLimit`), never reveal whether a patient exists, and carry `noindex`.

## 7. Audit

- Codes `pms.<entity>.<verb>` (lower case, e.g. `pms.appointment.book`), each labelled in
  `src/modules/pms/audit/<m>.ts` (`<M>_AUDIT_LABELS`) with plain words; record types in `<M>_AUDIT_TARGETS`
  (`pms_appointment: "Appointment"`). The activity test fails on an unlabelled code written in `src/server` or
  `src/app`. Details: ids, counts, field names, statuses – **never** names, dates of birth, note text.
- Clinics with the package get a "Clinic system" filter group on `/app/settings/activity`; others see the page as before.

## 8. Tests and the check chain

- Pure rules: `src/modules/pms/<m>/*.test.ts` (node:test).
- Repositories: a suite run on **guarded** node:sqlite and PGlite databases
  (`src/server/repos/pms/testing/guarded-db.ts`: `createGuardedSqliteDb`, `createGuardedPgliteDb`) ending with
  `assert.deepEqual(unscopedStatements(log.statements), [])` – the tenant-scope guard. Cover: two clinics, a row of
  clinic B never readable/changeable from A, foreign keys across clinics refused, encryption at rest (no plaintext in
  the row; a moved ciphertext does not decrypt), revisions, audit rows. Model: `src/server/repos/pms/testing/pms-suite.ts`.
- D1: `workers/data-gateway/test/pms-<m>-stack.test.ts` running your suite through the gateway (model:
  `stack.test.ts`); the real local D1 run applies every migration with wrangler.
- Browser: `scripts/e2e/pms-<m>-*.cjs`, LOCAL only, ports 3180–3199, 375 px and keyboard checks, screenshots to
  `.e2e-out/` or the scratchpad. Model: `scripts/e2e/clinic-system-shell.cjs`.
- **Time:** take "now" from `src/modules/pms/core/clock.ts` (`pmsNow()`, `pmsNowMs()`; repositories get it as
  `ctx.now` from `actor.repo()`) – never `new Date()` / `Date.now()` in clinic-system server code. Browser checks that
  need clinic hours run on `next dev` with the TEST clock (`PMS_TEST_CLOCK=1 PMS_TEST_NOW PMS_TEST_NOW_SET_AT`), which
  a production build ignores.
- Quick loop: `npm run test:pms` (all `src/modules/pms`, `src/server/{repos/,}pms`, `scripts/pms` tests).
- **Full chain before handing over:** `npm run typecheck && npm run lint && npm run test:medreport && npm run test:db && npm run test:auth && npm run test:site && npm run test:gateway && npm run build`
  (`test:gateway` needs `(cd workers/data-gateway && npm ci)` once). ClinForms unchanged: `scripts/e2e/forms-regression.cjs`
  against a build of `main` and yours, compared with `scripts/e2e/compare-form-outputs.ts` – all files must match.

## 9. Demo data

- `npm run pms:seed-demo` (local SQLite; `.env.local` with `BETTER_AUTH_SECRET`, `CLINFORMS_DATA_KEYS`/`_KEY_ID`):
  creates "Riverside Physiotherapy (fictional)" (`riverside-demo`) if missing, prints the owner's invitation once,
  flags it as a demonstration clinic, switches the `clinic` package on and loads 3 sites, 6 rooms, 8 practitioners
  (`PH-DEMO-01`–`08`), 9 appointment types, 4 price lists, 12 referrers and payers, **200 patients** (`sim-pat-001`
  Megan Hart, `sim-pat-002` Daniel Brooks, then `sim-pat-007`–`sim-pat-204`), ~250 cases with payers, ~80
  authorisations. `--fresh` replaces it (local only). Server databases: `--env preview --confirm` / `--env production
  --confirm --yes`, only for a clinic flagged as a demonstration clinic (`--mark-demo` flags an EMPTY clinic whose name
  ends "(fictional)").
- Module demo data: `scripts/pms/seed-<m>.ts` exporting `seed<M>(ctx, tenantId)` that refuses a clinic that is not
  flagged demo (`getPmsSettings(...).isDemo`) and uses the seeded directory/patients; the orchestrator wires it into
  `pms:seed-demo` at integration.

## 10. Offboarding

`npm run admin:offboard-clinic` exports every clinic-system row of the clinic **decrypted** (`clinic-system.json`, by
table, `_enc` columns as plain fields) and deletes them in the same atomic batch as ClinForms' data – generically over
`<M>_TENANT_TABLES` (`src/server/pms/offboard.ts`). List every per-clinic table there; give encrypted columns an `id`
row key (the AAD needs it).

## 11. Providers (SMS, email, payments)

Interfaces in the module's server folder (`src/server/pms/comms/providers/*`, `src/server/pms/billing/payments/*`),
chosen by env (`CLINIC_SMS_PROVIDER`, `CLINIC_EMAIL_PROVIDER`, `CLINIC_PAYMENTS_PROVIDER`), **default = outbox/log**:
messages are stored and shown (an outbox screen), never sent; payments are recorded by hand. Test mode only – no live
keys in code, env files or git; a provider refuses to run with a live-looking key. No new paid service. Reminders carry
no clinical detail (PECR + confidentiality); marketing only with recorded opt-in (`marketingEmail`/`marketingSms`).

## 12. UI conventions

- Pages: server components under `src/app/app/clinic/<area>/`; client components in `src/components/pms/<m>/`
  (browser-safe: no `src/server`). Kit: `src/components/ui/*` (button, card, dialog, input, tabs, tooltip, badge…),
  `src/components/account/shell.tsx` (`PageHeader`, `Panel`, `Notice`, `Field`), `form-controls.tsx`
  (`SubmitButton`). Tailwind; teal-700 accent; slate text.
- Accessibility: every input has a `<label>`; errors next to the field and in an `role="alert"`; visible focus rings;
  keyboard for everything (diary included); text contrast ≥ 4.5:1; no information by colour alone; works at 375 px
  without sideways scrolling (wide tables scroll inside their own box).
- UK formats: dates DD/MM/YYYY (`formatUkDate`), times 24 h Europe/London, money `formatPence`, UK postcodes and
  phone numbers (`normalisePostcode`, `isPlausiblePhone`).
- Copy: plain UK English, neutral; never vendor/technology names; the product name only through `src/lib/brand.ts`.
