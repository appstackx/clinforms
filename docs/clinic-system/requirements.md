# K2 clinic system – requirements specification

**Internal.** Version 1.0, Mon 26 Oct 2026. Branch `docs/k2-spec` (cut from `feat/clinic-system` at `8716fbf`).
Owner and decision-maker: Khuram. Status: draft for Khuram's approval. Handover for the next builder:
[`HANDOVER.md`](HANDOVER.md).

**Naming.** "K2" is the internal, temporary name of the clinic management system. In code and on screen the product
name is only the placeholder `CLINIC_SYSTEM_NAME` (`src/lib/brand.ts`, today `"Clinic system"`); the code module is
`pms` (`src/modules/pms`). Never put a competitor's product name, "CareConnect", "Practice" (a Reports plan) or an informal
nickname in code, copy or documents (`scripts/pms/contract.test.ts` enforces this for the code folders).
In this document "the current system" means the practice system Blue Heart uses today.

**This spec does not repeat the build rules.** They are in [`contract.md`](contract.md) (hard rules, ownership,
migration numbers, conventions – binding for every builder) and in ClinForms' `CLAUDE.md`,
`docs/production-architecture.md`, `docs/database.md`, `docs/auth.md`. Background:
`docs/strategy/all-in-one-pms-feasibility.md` (scope, compliance, cost), `docs/strategy/pms-reuse-and-packaging.md`
(one codebase, packages, prices), and the 129-row feature comparison `docs/strategy/tm3-feature-comparison.md` (on
`main`, commit `b8e478a`; internal only, it names vendors).

---

## 0. How to read this

- **IDs:** `K2-<AREA>-NNN`. Areas: `PLT` platform foundation, `SITE` multi-site, `DIARY`, `BOOK` online booking,
  `PAT` patients and records, `NOTE` clinical notes, `LTR` letters, `FORM` intake forms, `PORTAL`, `COMMS`, `BILL`
  billing, `AUTHS` treatment authorisations, `PAY` payments, `REP` reporting, `IMP` data import, `CF` ClinForms
  integration, `ADM` admin and settings, `AUD` audit, `NFR` non-functional.
- **Line format** (machine-read by the traceability table, §13): `ID · priority · status · code module · FC rows —
  requirement. AC: acceptance criteria.`
- **Priority:** **MVP** = needed before Blue Heart can run a clinician's whole diary on K2 and then switch all 11
  sites. **Later** = after the switch, or only if Dell asks. "MVP (ext)" in the text means the code is MVP but it
  only works once an outside account or agreement exists (§10).
- **Status** (checked 26 Oct 2026 from the branches and worktrees, tests **not** re-run for this spec; diary and
  records ids updated 27 Oct 2026 after the M3 merge – HANDOVER §12):
  - **done** – implemented in committed code on the named branch, with automated tests per its commit; if the
    requirement has a screen, the screen is committed too;
  - **back end done, screen pending** – (27 Oct 2026, M3) the data layer and the server layer the screens will
    call (permission-checked services, server actions, route handlers) are committed, merged into
    `feat/clinic-system` and tested; only the screen (and its e2e) is missing – waiting for design;
  - **partial** – some layers are committed (usually domain rules + repositories + tests) but the screen, the
    wiring to another module or the live provider is missing;
  - **partial-wt** – as partial, but the missing layer exists **only as uncommitted work** in the module's worktree
    (`/Users/khuram/Projects/Appstackx/clinforms-wt/cs-<module>`) – unreviewed, may not compile;
  - **missing** – no code.
- **Code module** = the owner in contract §3: `foundation` (branch `feat/clinic-system`), `diary`, `records`,
  `billing`, `comms`, `portal`, `reporting`, `integration` (branches `feat/cs-<module>`), or `ops` (not code:
  hosting, legal, process).
- **FC rows** = rows of the feature comparison, numbered `<section>-<row>` in table order, e.g. `2.1-06` = §2.1, sixth
  row ("Double-booking prevention"). Full index with feature names in §13.2.

---

## 1. Purpose and scope

### 1.1 Why

Blue Heart Clinics (11 physiotherapy sites, owner **Dell Baines**) uses ClinForms (the `reports` package: completes
insurer and medico-legal forms from treatment notes; ~£300 a month for up to 500 reports; 400–500 reports a month;
trial live since 24 Oct 2026). Dell wants to replace his current practice system and has said he could pay about
**£300 a month more** for an all-in-one system (not in writing). K2 is that system: a multi-site clinic management
system built **inside the ClinForms codebase** as the `clinic` package, so one sign-in, one patient record and one
subscription cover both, and ClinForms reads the K2 record directly instead of uploads.

### 1.2 Goals

1. A UK physio group can run its day on K2: diary across sites and rooms, patients, notes, letters, invoices
   (self-pay, insurer and medico-legal accounts), payments, reminders, online booking, intake forms, reports.
2. Blue Heart can move from the current system with its data (patients, cases, authorisations, future
   appointments, open balances) and keep its historic records accessible for the retention period.
3. With both packages, "Complete referrer form" on a case fills the referrer's own form from the K2 record with no
   upload – the one thing the current system cannot do (FC 2.3-03).
4. ClinForms behaves exactly as before for every clinic without the `clinic` package.
5. Safe to hold real patient data once the gates in §10 are passed: tenant isolation, encryption, audit,
   retention, UK hosting, backups.

### 1.3 Scope

In scope: the requirement areas in §3 (MVP and Later items), the non-functional requirements in §5, the
migration in §8. Out of scope: §12. **Until a DPA is signed and the §10 gates are passed, K2 holds fictional data
only** (contract rule 7). Demo first; onboarding a real clinic is a separate, gated task.

### 1.4 Constraints (fixed decisions)

| Decision | Where recorded |
|---|---|
| One codebase: `src/modules/pms` beside `src/modules/medreport`, host-side repositories, one deployment | packaging note §2, contract §3 |
| Packages per clinic: `reports` and `clinic` (`clinic_entitlements`); no row = reports on, clinic off | contract §5 |
| Brand by host name: one deployment, several domains, one config (`src/lib/brand.ts`) | contract §2 |
| Host-side native connector so ClinForms reads K2 records directly (`src/server/pms/native-connector.ts`) | contract §3 (integration) |
| Postgres in London before real patient data (D1 EU + PGlite/SQLite in dev today; both dialects kept in parity) | `docs/database.md` §8, feasibility §3b row 7 |
| SMS/email/payments behind interfaces, default outbox/log, test mode only; candidate live SMS/WhatsApp provider: MailerSend (UK coverage unchecked) | contract §11 |
| `main` = production; K2 is never pushed to `main` or deployed without Khuram's go | `CLAUDE.md`, contract §1 |
| Fictional data only until a DPA is signed | `CLAUDE.md`, contract §1 |
| Commercial: Blue Heart ~£300 Reports now; K2 ramps at £29 per live practitioner, all-in-one capped at £599 (proposal, Khuram to confirm) | packaging note §3 |

---

## 2. Users, roles and permissions

Roles are ClinForms' member roles (Better Auth, `src/server/auth/roles.ts`), mapped to K2 permissions in
`src/modules/pms/core/permissions.ts` (fixed list; a change needs the orchestrator). Two-step sign-in is required for
every staff user (existing ClinForms rule). Patients never get staff accounts.

| Role | Who | May | May not |
|---|---|---|---|
| **owner** | Clinic owner (Dell) | Everything, incl. set-up, exports, import, packages view | – |
| **admin** | Operations or clinic manager | Everything (same as owner) | Change the owner |
| **clinician** | Physiotherapist (practitioner) | Patients (view/edit), clinical notes (view/write/sign), diary (view/book), messages (view/send), billing read-only, directory edit | Billing edits, reports, exports, settings, import |
| **staff** | Reception / admin staff | Patients (demographics, contacts, consent), diary (view/book), billing (view/edit), messages, directory edit | **Any clinical note content**, reports, exports, settings, import |
| **patient** | A clinic's patient | Public booking; portal (own upcoming appointments, cancel/rebook within policy, own forms, documents shared with them) | Anything of another patient or clinic; clinical notes unless explicitly shared |
| **platform admin** | ClinForms support (`khuram@appstackx.co.uk`) | `/app/platform`: switch packages, create/offboard clinics (production only with Khuram's go) | Read patient data in the app |

Permission matrix (from `core/permissions.ts`; owner and admin = all 22):

| Permission | clinician | staff |
|---|:-:|:-:|
| `clinic.view`, `patients.view`, `patients.edit`, `diary.view`, `diary.book`, `billing.view`, `messages.view`, `messages.send`, `directory.edit` | ✓ | ✓ |
| `clinical.view`, `clinical.edit`, `clinical.sign` | ✓ | – |
| `billing.edit` | – | ✓ |
| `patients.export`, `diary.manage`, `billing.manage`, `messages.manage`, `booking.manage`, `reports.view`, `reports.export`, `settings.manage`, `import.run` | – | – |

Notes: site scoping (a user limited to some sites) is a separate layer (K2-SITE-004). Open question Q-K5: should
clinicians see reports for their own caseload (`reports.view` is owner/admin only today)?

---

## 3. Functional requirements

### 3.1 PLT – platform foundation (packages, brand, shell, shared record)

- **K2-PLT-001** · MVP · done · foundation · FC none — Each clinic has packages `reports` and `clinic` with status active / trial / paused / cancelled; no row means reports on, clinic off. AC: a reports-only clinic gets the 404 page on every `/app/clinic/**` URL, server actions and routes refuse with `not_entitled`, no clinic navigation item, no clinic filter on the activity page.
- **K2-PLT-002** · MVP · done · foundation · FC none — With `reports` off, Studio and the Report API are unreachable for that clinic. AC: Studio 404, no Studio nav item, Report API returns `NO_CLINIC`.
- **K2-PLT-003** · MVP · done · foundation · FC none — Packages are switched from `/app/platform` → Packages and `npm run admin:set-entitlement`; off = paused, nothing deleted. AC: change audited in the clinic's trail (`clinic.package_change`) and the platform's (`platform.entitlement_set`); production needs `--confirm --yes` and Khuram's go.
- **K2-PLT-004** · MVP · done · foundation · FC none — If the package table cannot be read, Reports stays on and K2 stays off. AC: unit test of `clinicPackages` fail-safe.
- **K2-PLT-005** · MVP · done · foundation · FC none — Brand by host name from one config: ClinForms on `clinforms.co.uk`, previews and localhost; on a host in `BRANDS.clinic.hosts` the product name is `CLINIC_SYSTEM_NAME`, public pages redirect to sign-in and members land on `/app/clinic`. AC: `clinic.localhost:3180` shows the placeholder name; `src/lib/brand.test.ts` passes.
- **K2-PLT-006** · Later · missing · foundation · FC none — Sign-in on a second domain: Better Auth `trustedOrigins` + per-request base URL, invitation and reset links per brand, decision whether one account spans both hosts. AC: a member signs in on the second host; links in emails point at the host they were requested from.
- **K2-PLT-007** · MVP · done · foundation · FC none — The product name appears only through `CLINIC_SYSTEM_NAME`; banned names fail a test. AC: `scripts/pms/contract.test.ts` naming test passes on every branch.
- **K2-PLT-008** · MVP · done · foundation · FC none — Shell `/app/clinic` with navigation and patient-record tabs aggregated from each module's registry and filtered by permission. AC: a module adds `nav/<m>.ts` / `record-tabs/<m>.ts` entries only; nothing else changes.
- **K2-PLT-009** · MVP · done · foundation · FC 2.2-01 — Shared patient record and directory (patients, cases, authorisations, referrers/payers, sites, rooms, practitioners, services, price lists) with repositories used by every module. AC: `src/server/repos/pms/*` suite passes on SQLite, PGlite and D1 with the tenant-scope guard.
- **K2-PLT-010** · MVP · partial · foundation · FC none — Demo seed `npm run pms:seed-demo` creates "Riverside Physiotherapy (fictional)" with 3 sites, 6 rooms, 8 practitioners, 9 appointment types, 4 price lists, 12 referrers/payers, 200 patients, ~250 cases, ~80 authorisations; each module adds `scripts/pms/seed-<m>.ts`, wired in at integration. AC: a fresh local database shows a full working week of fictional diary, notes, invoices and messages. Foundation seed done; the diary and records seeds are wired in (27 Oct 2026, M3); billing, comms and portal seeds still to come.
- **K2-PLT-011** · MVP · done · foundation · FC none — Offboarding a clinic exports every K2 row decrypted (`clinic-system.json`) and deletes them atomically with ClinForms' data, generically over each module's `<M>_TENANT_TABLES`. AC: every new per-clinic table is listed in its module's `_TENANT_TABLES`; offboard test covers it.

### 3.2 SITE – multi-site

- **K2-SITE-001** · MVP · done · foundation · FC 2.1-01, 2.1-04 — Sites (name, address, phone, email) with rooms per site; practitioners may work at several sites. AC: directory repositories; set-up screens in K2-ADM-001.
- **K2-SITE-002** · MVP · back end done, screen pending · diary · FC 2.1-01 — Every diary view is for a chosen site (switcher) and date; reception can switch site without losing the date. AC: switching site keeps the day; URL carries site and date; keyboard operable.
- **K2-SITE-003** · MVP · partial-wt · reporting · FC 2.6-10 — Opening hours and closure days per site, used by the diary and online booking. AC: one opening-hours source for both (today reporting has `pms_site_hours`/`pms_site_closures` uncommitted and portal has its own `pms_booking_hours` – reconcile, §7).
- **K2-SITE-004** · MVP · partial-wt · reporting · FC 2.6-12 — A user can be limited to some sites (`pms_staff_access`, `pms_staff_sites`); the limit applies to diary, patient lists, invoices and reports, not only to the reports screens. AC: a staff user limited to site A sees no appointment, invoice or report line of site B; repository suite proves it; default = all sites.
- **K2-SITE-005** · MVP · missing · billing · FC 2.1-01 — Invoices, statements, letters and messages show the site's address and contact details (the site of the appointment, else the case's site). AC: a PDF invoice for an appointment at site B shows site B's address.
- **K2-SITE-006** · Later · missing · diary · FC 2.1-01 — Per-site cancellation/DNA charges and per-site reminder templates. AC: two sites with different DNA fees produce different charges.

### 3.3 DIARY – diary and scheduling (multi-site)

Committed on `feat/cs-diary` (`3d792ef`): migration `0110`, domain rules, repositories, suites on SQLite/PGlite/D1
stand-in/real local D1. Uncommitted in `cs-diary`: grid, booking/appointment/block dialogs, patient search, view
model, server actions and API routes – **but no `page.tsx`** under `src/app/app/clinic/diary/`.

- **K2-DIARY-001** · MVP · done · foundation · FC 2.1-10 — Appointment types/services with duration, price, category, colour and an online-bookable flag. AC: services in the directory; diary uses the duration as default length.
- **K2-DIARY-002** · MVP · back end done, screen pending · diary · FC 2.1-07 — Practitioner working times (rotas) per site: days, times, repeat every N weeks, end date; overlap refused. AC: repository done (`availability.ts`); set-up screen missing; free slots respect rotas.
- **K2-DIARY-003** · MVP · back end done, screen pending · diary · FC 2.1-02, 2.1-04 — Day view with one column per practitioner or per room for a site; 24 h Europe/London; colour **and** text for status. AC: 10 practitioner columns readable on a laptop; at 375 px the grid scrolls inside its box; keyboard can reach every appointment.
- **K2-DIARY-004** · MVP · back end done, screen pending · diary · FC 2.1-03 — Week view for one practitioner or one room. AC: Monday–Sunday, same keyboard support as the day view.
- **K2-DIARY-005** · Later · missing · diary · FC 2.1-03 — Week view across several practitioners or rooms. AC: up to 5 resources side by side for a week.
- **K2-DIARY-006** · MVP · done · diary · FC 2.1-06, 2.1-04 — No double booking of a practitioner or a room, enforced in the database (SQLite trigger `RAISE(ABORT)`; Postgres trigger with per-practitioner/per-room advisory locks; cancelled and late-cancelled rows excluded) and explained in the screen. AC: two concurrent bookings for the same slot – exactly one succeeds on SQLite, PGlite and D1; the other gets a plain message naming what is in the way.
- **K2-DIARY-007** · MVP · back end done, screen pending · diary · FC 2.1-11 — Reception books from a free slot: patient search, appointment type, practitioner, room, case (payer), note. AC: repository done; booking dialog uncommitted; booking from an empty slot takes ≤ 4 inputs for an existing patient.
- **K2-DIARY-008** · MVP · back end done, screen pending · diary · FC 2.1-12 — Recurring appointments (series): all-or-nothing or skip clashes; cancel the rest of a series. AC: repository done; a 6-week weekly series with one clash books 5 and lists the clash when "skip" is chosen.
- **K2-DIARY-009** · MVP · back end done, screen pending · diary · FC 2.1-13 — Move/reschedule an appointment, by drag **and** by a keyboard/click alternative. AC: repository done; moving into a clash is refused with the reason.
- **K2-DIARY-010** · MVP · back end done, screen pending · diary · FC 2.1-14, 2.1-15 — Statuses booked, arrived, attended, did not attend, cancelled, late cancellation (with fee flag), reinstate and undo. AC: repository done; DNA/late-cancel flag reaches billing as a charge suggestion (K2-BILL-001).
- **K2-DIARY-011** · MVP · done · diary · FC 2.2-08 — Marking attended updates the patient's last-seen date (retention) and uses one authorisation session; undo gives it back. AC: suite covers usage and give-back ordering.
- **K2-DIARY-012** · MVP · back end done, screen pending · diary · FC 2.1-08 — Blocked time (meeting, holiday, other) that stops booking. AC: repository done; block dialog uncommitted.
- **K2-DIARY-013** · MVP · back end done, screen pending · diary · FC 2.1-16 — Waiting list per clinic with preferred practitioner/site/times; book from an entry atomically. AC: repository done; screen missing; no automatic offers.
- **K2-DIARY-014** · MVP · done · diary · FC 2.1-17 — Two users editing the same appointment: optimistic revision check; the second save gets "changed by someone else". AC: suite covers `rev` conflicts.
- **K2-DIARY-015** · MVP · done · diary · FC none — Times are Europe/London including both clock changes. AC: domain tests for the March and October changes.
- **K2-DIARY-016** · MVP · back end done, screen pending · diary · FC 2.1-18 — Quick patient search from the diary (name, number, phone, DOB). AC: results in < 1 s on 10,000 patients; never decrypts.
- **K2-DIARY-017** · MVP · back end done, screen pending · diary · FC 2.1-20 — Printable day list per practitioner/site (paper fallback during an outage). AC: print stylesheet; names, times, rooms; no clinical notes.
- **K2-DIARY-018** · MVP · done · diary · FC none — Booking, cancellation and waiting-list notes are encrypted; appointments are never deleted. AC: suite proves no plaintext in the row.
- **K2-DIARY-019** · Later · missing · diary · FC 2.1-05 — Equipment as a bookable resource (beyond rooms). AC: a resource type other than room can be clash-checked.
- **K2-DIARY-020** · Later · missing · diary · FC 2.1-09 — Skills limit which services a practitioner can be booked for. AC: a practitioner without the skill is not offered.
- **K2-DIARY-021** · Later · missing · diary · FC 2.1-19 — List view of appointments with bulk actions. AC: select many, change status or send a message.
- **K2-DIARY-022** · Later · missing · diary · FC 2.1-21 — Calendar feed for practitioners (no patient names). AC: read-only iCal with initials only.

### 3.4 BOOK – online booking (public)

Committed on `feat/cs-portal` (`51e6ed6`): migrations `0150`–`0152`, slot engine, policy, repositories and flows.
**Online bookings are stored in portal's own `pms_online_bookings` with its own clash trigger, through a
standalone "diary port"** – not yet in the diary's `pms_appointments`. No public routes yet.

- **K2-BOOK-001** · MVP · partial · portal · FC 2.1-24 — Public booking page per clinic and site in route group `src/app/(public-clinic)/**`: no staff cookie, `noindex`, rate-limited, never reveals whether a patient exists. AC: flows done; pages missing; e2e books as a new and as an existing patient at 375 px.
- **K2-BOOK-002** · MVP · partial · portal · FC 2.1-25 — Availability from the diary: rotas, opening hours, bookable appointment types, buffers, minimum notice, horizon, existing appointments and blocks. AC: a slot shown online is always bookable by reception at the same moment and vice versa.
- **K2-BOOK-003** · MVP · missing · portal · FC 2.1-24, 2.1-06 — An online booking becomes a diary appointment in `pms_appointments` (one appointment store, one clash rule) through a diary adapter for the portal's diary port. AC: an online booking appears in the diary immediately; a reception booking in the same slot is refused, and the reverse.
- **K2-BOOK-004** · MVP · partial · portal · FC 2.5-01 — Booking confirmation, cancellation and change messages go through comms (outbox until a live provider). AC: portal's own outbox (`pms_portal_messages`) replaced by, or forwarded to, comms' message log; one outbox screen.
- **K2-BOOK-005** · MVP · partial · portal · FC 2.1-29 — Patient cancels or rebooks online within the notice policy; a cancellation inside the notice is flagged late. AC: flows done; pages missing.
- **K2-BOOK-006** · MVP · done · portal · FC none — Bot check ready but off; rate limits per client, email and clinic. AC: `human-check.ts` off by default; tests for limits.
- **K2-BOOK-007** · MVP · partial · portal · FC 2.1-25 — Staff settings for online booking (`/app/clinic/online-booking`, permission `booking.manage`): on/off per site, bookable types and practitioners, notice, horizon, cancellation policy text. AC: data done; screen missing.
- **K2-BOOK-008** · Later · missing · portal · FC 2.1-26 — Deposit or payment at booking. AC: needs live payments (K2-PAY-005).
- **K2-BOOK-009** · Later · missing · portal · FC 2.1-28 — Insured patients book online with insurer and authorisation details captured for staff to confirm.
- **K2-BOOK-010** · Later · missing · portal · FC 2.1-27 — Forms, add-ons and companion bookings inside the booking flow.

### 3.5 PAT – patients and records

Foundation repositories done. Records UI (list, record layout and tabs, edit, cases, case page with
authorisations, notes, outcomes, attachments, history, subject access/anonymise actions) is **uncommitted** in
`cs-records`.

- **K2-PAT-001** · MVP · back end done, screen pending · records · FC 2.1-18, 2.2-01 — Patient list with search by name words, patient number, phone, date of birth, email; never decrypts in lists. AC: `searchPatients` done; list page uncommitted.
- **K2-PAT-002** · MVP · back end done, screen pending · records · FC 2.2-01, 2.2-02 — Create and edit a patient: demographics, contacts, emergency contact, GP, consent flags, marketing consent (email/SMS), with revision conflict handling. AC: repository done; form uncommitted; UK postcode/phone validation.
- **K2-PAT-003** · MVP · partial · records · FC none — Patient record page with tabs registered by modules (appointments, notes, outcomes, attachments, invoices, messages, forms, history). AC: a module's tab appears only with its permission; reception sees no clinical tab.
- **K2-PAT-004** · MVP · back end done, screen pending · records · FC 2.2-07 — Cases (episodes) with payer type (self-pay, insurer + membership/policy number, medico-legal company or solicitor, employer), referrer, referral reason (encrypted), status. AC: repository done; case screens uncommitted.
- **K2-PAT-005** · MVP · partial · records · FC 2.2-04 — Medical alerts (encrypted) shown on the record and in the diary's appointment dialog. AC: field exists in the shared record; display in both places.
- **K2-PAT-006** · MVP · back end done, screen pending · records · FC 2.2-03 — Patient status (active, archived, deceased with date) and legal hold. AC: `setPatientStatus`, `setPatientLegalHold` done; screen missing.
- **K2-PAT-007** · MVP · back end done, screen pending · records · FC 2.2-20 — Attachments: encrypted per clinic, type checked by magic bytes, size limits, withdrawn (never deleted). AC: repository done; upload/download routes uncommitted; download sends `Content-Disposition: attachment`.
- **K2-PAT-008** · MVP · back end done, screen pending · records · FC 2.6-13 — Per-patient history built from the audit log (who did what, when). AC: repository done; page uncommitted.
- **K2-PAT-009** · MVP · partial · records · FC 2.7-04 — Subject access export of one patient's full record as PDF and JSON (permission `patients.export`), audited. AC: collection done; output and screen uncommitted; export opens and lists every module's data for that patient.
- **K2-PAT-010** · MVP · back end done, screen pending · records · FC 2.7-05 — Anonymise a patient only after the retention review date, never under legal hold, confirmed by typing the patient number. AC: repository done (only path that passes the lock triggers); action uncommitted.
- **K2-PAT-011** · MVP · partial-wt · reporting · FC 2.2-10 — Referrers and payer accounts directory (GP, consultant, insurer, medico-legal company, solicitor, employer, case manager). AC: repository done; set-up actions uncommitted.
- **K2-PAT-012** · Later · missing · records · FC 2.2-06 — Merge duplicate patients (with audit and undo window).
- **K2-PAT-013** · Later · missing · records · FC 2.2-05 — Tags on patients.
- **K2-PAT-014** · Later · missing · records · FC 2.2-04 — Clinical flags (red/black) that require acknowledgement.

### 3.6 NOTE – clinical notes (sign, lock, amend)

Committed on `feat/cs-records` (`74e579c`): migrations `0120`/`0121`, rules, repositories, suites (11 tests × 4
backends). Screens uncommitted.

- **K2-NOTE-001** · MVP · back end done, screen pending · records · FC 2.2-11, 2.3-04 — Built-in templates (initial assessment SOAP, follow-up SOAP, discharge) and clinic templates (template editor). AC: templates done; editor screen uncommitted/missing.
- **K2-NOTE-002** · MVP · back end done, screen pending · records · FC 2.2-11 — Write a note for a patient, linked to a case and appointment; drafts saved with revision. AC: repository done; editor uncommitted.
- **K2-NOTE-003** · MVP · done · records · FC 2.2-17 — Sign and lock: only the author signs; a content fingerprint is stored; a database trigger refuses any change to a signed note. AC: suite proves `APPEND_ONLY` on SQLite, PGlite and D1.
- **K2-NOTE-004** · MVP · back end done, screen pending · records · FC 2.2-17 — Amendments to a signed note: append-only, with reason, author and time, shown as a visible history. AC: repository done; screen uncommitted.
- **K2-NOTE-005** · MVP · partial · records · FC 2.2-14 — Body chart (front/back outlines, markers stored as data). AC: rules done; editor uncommitted; usable by keyboard (markers via a list too).
- **K2-NOTE-006** · MVP · back end done, screen pending · records · FC 2.2-15 — Outcome measures NDI, ODI, NPRS, PSFS, QuickDASH, scored automatically, chart over time; no questionnaire wording held until licences are checked (Q-K8). AC: scoring tests done; screens uncommitted.
- **K2-NOTE-007** · MVP · done · records · FC none — Reception (`staff`) can never see clinical note content, outcome answers or health answers of intake forms. AC: permission rule done; every notes page/route checks `clinical.view`; e2e as staff gets 404/refusal.
- **K2-NOTE-008** · MVP · back end done, screen pending · records · FC 2.2-18 — Unsigned-notes list per clinician (drafts older than N days, N per clinic). AC: clinician dashboard shows count; owner sees all.
- **K2-NOTE-009** · MVP · partial · records · FC 2.2-23 — Notes can be written on a phone (375 px). AC: e2e at 375 px writes and signs a note.
- **K2-NOTE-010** · Later · missing · records · FC 2.2-12, 2.2-13, 2.2-16 — Note-writing aids (snippets), medical history carried across cases, goals.
- **K2-NOTE-011** · Later · missing · records · FC 2.2-19 — Restrict a case to its own practitioner.

### 3.7 LTR – letters and templates

Two engines exist: comms (`feat/cs-comms`, plain-text letter templates with merge fields, committed) and
integration (`cs-integration`, Word/RTF merge-field resolver, **uncommitted**). One must be chosen (K2-LTR-007).

- **K2-LTR-001** · MVP · partial · comms · FC 2.3-01 — Letter templates with merge fields from patient, case, payer, practitioner, appointments, invoices, clinic and today. AC: comms letters committed; a value not recorded shows as "[not recorded: …]".
- **K2-LTR-002** · MVP · partial-wt · integration · FC 2.3-02 — A clinic's own Word/RTF letter templates are filled in their own layout using ClinForms' existing RTF/Word engine; unknown field names are reported, never guessed, and can be pointed at a field once. AC: merge-field resolver uncommitted; engine wiring missing; Blue Heart's `<<…>>`-style fields resolve.
- **K2-LTR-003** · MVP · done · comms · FC 2.3-01 — Recipient: the patient, their GP, the case's payer or referrer, or a typed recipient. AC: `startLetter` tests.
- **K2-LTR-004** · MVP · done · comms · FC none — A letter cannot be finalised while it contains "[not recorded: …]" or "[[…]]" gaps. AC: repository refuses.
- **K2-LTR-005** · MVP · missing · comms · FC 2.3-05 — Output: PDF (and Word for Word templates), filed on the patient record, optionally emailed through comms (outbox) or shared to the portal. AC: letter downloadable and listed on the record.
- **K2-LTR-006** · MVP · partial · records · FC 2.3-04 — Discharge summary letter from the discharge note. AC: discharge template exists; letter generation from it missing.
- **K2-LTR-007** · MVP · missing · integration · FC none — One merge-field engine for letters and ClinForms (reconcile comms `merge-fields.ts` and integration `merge-fields.ts`). AC: one list of fields, one resolver, both callers use it.

### 3.8 FORM – intake and consent forms

Committed on `feat/cs-portal`: form templates, patients' copies (`pms_intake_templates`, `pms_intake_responses`),
starter forms, typed e-signature, sealing trigger.

- **K2-FORM-001** · MVP · done · portal · FC 2.2-21 — Starter new-patient intake and consent forms (written for the product) and clinic copies. AC: tests; no third-party wording.
- **K2-FORM-002** · MVP · partial · portal · FC 2.2-21 — Staff send a form link to a patient (e.g. before the first appointment) through comms. AC: flow done; send uses portal's own outbox today (see K2-BOOK-004).
- **K2-FORM-003** · MVP · done · portal · FC 2.2-21 — Typed e-signature; answers and typed name encrypted; the copy is sealed by a trigger once submitted. AC: suite proves seal.
- **K2-FORM-004** · MVP · partial · portal · FC 2.2-21 — Verified vs unverified submissions: consent recorded on the record only when verified; staff apply other answers to the record. AC: flows done; staff screen missing.
- **K2-FORM-005** · MVP · partial · portal · FC none — Health answers visible to clinicians only. AC: domain rule done; enforced in the forms record tab (missing).
- **K2-FORM-006** · MVP · missing · portal · FC 2.3-05 — Forms tab on the patient record (`/app/clinic/patients/[patientId]/forms`) and intake screen (`/app/clinic/intake`). AC: list, view, apply answers.
- **K2-FORM-007** · Later · missing · portal · FC 2.2-22 — Form builder with field-to-record mapping, file uploads, clinic-tablet mode.

### 3.9 PORTAL – patient portal

- **K2-PORTAL-001** · MVP · partial · portal · FC 2.1-31 — Magic-link sign-in; patient accounts separate from staff accounts; secrets stored as hashes; sessions expire. AC: flows done; routes missing; links reach patients only once email is live (K2-COMMS-005).
- **K2-PORTAL-002** · MVP · partial · portal · FC 2.1-30, 2.1-29 — Portal shows upcoming appointments with cancel/rebook within policy. AC: flows done; pages missing.
- **K2-PORTAL-003** · MVP · partial · portal · FC 2.1-30 — Forms to complete. AC: flows done; pages missing.
- **K2-PORTAL-004** · MVP · partial · portal · FC 2.1-30 — Documents explicitly shared by staff (letters, exercise sheets); no clinical notes unless shared. AC: `pms_portal_shares` done; pages missing.
- **K2-PORTAL-005** · MVP · done · portal · FC none — Strict tenant and patient scoping; a patient can never reach another patient's or clinic's data or any staff route. AC: suite with two clinics and two patients.
- **K2-PORTAL-006** · MVP · partial · portal · FC 2.1-32 — Works as mobile web at 375 px. AC: e2e at 375 px.
- **K2-PORTAL-007** · Later · missing · portal · FC 2.1-30 — View and pay invoices in the portal.

### 3.10 COMMS – communications and reminders

Committed on `feat/cs-comms` (`fc0d3eb`): migrations `0140`/`0141`, rules, repositories, engine, providers
(outbox default, test adapter), handlers. Uncommitted in `cs-comms`: route files under
`src/app/api/clinic-messages/{cron,sms,unsubscribe}` (outside the contract's comms routes – needs the
orchestrator's approval or a move) and a server test. No D1 stack test (`pms-comms-stack.test.ts`) yet.

- **K2-COMMS-001** · MVP · done · comms · FC 2.5-04 — Message templates with merge fields; appointment messages never carry clinical detail. AC: domain tests.
- **K2-COMMS-002** · MVP · partial · comms · FC 2.5-01 — Booking, change and cancellation confirmations triggered by diary changes (`syncAppointmentMessages`). AC: hook done; diary not wired.
- **K2-COMMS-003** · MVP · partial-wt · comms · FC 2.5-02 — Reminder rules (e.g. 24 h before) with quiet hours, UK time and clock changes, run by a cron route protected by `CRON_SECRET`. AC: engine done; cron route uncommitted; a reminder is planned once per appointment and re-planned on a move.
- **K2-COMMS-004** · MVP · done · comms · FC 2.5-03 — Providers behind interfaces (`CLINIC_SMS_PROVIDER`, `CLINIC_EMAIL_PROVIDER`), default outbox (stored, shown, never sent), test adapter; a live-looking key is refused in this phase. AC: tests.
- **K2-COMMS-005** · MVP · missing · comms · FC 2.5-03 — Live email adapter (MailerSend; domain `clinforms.co.uk` DNS authorised 24 Oct; click/open tracking off). AC: (ext) sends from the clinic's sender name; bounces recorded; only after gate B.
- **K2-COMMS-006** · MVP · missing · comms · FC 2.5-03 — Live SMS adapter (candidate MailerSend SMS/WhatsApp – check UK coverage, alphanumeric sender IDs, pricing, WhatsApp template rules first, Q-K3). AC: (ext) delivery status recorded; segments counted into `sms_segments` usage.
- **K2-COMMS-007** · MVP · done · comms · FC 2.5-03 — SMS segment counting (GSM-7/UCS-2) shown before sending. AC: domain tests.
- **K2-COMMS-008** · Later · partial-wt · comms · FC 2.5-05 — Two-way SMS: YES/NO/STOP replies via a provider webhook confirm or cancel the appointment. AC: rules and handler done; webhook route uncommitted; live needs provider.
- **K2-COMMS-009** · MVP · partial-wt · comms · FC 2.5-07, 2.2-02 — PECR: marketing only with recorded opt-in; signed unsubscribe links; consent events log. AC: engine done; unsubscribe route uncommitted.
- **K2-COMMS-010** · MVP · partial · comms · FC 2.5-08, 2.3-05 — Message log per patient (record tab) and an outbox screen (`/app/clinic/messages`). AC: data done; screens missing.
- **K2-COMMS-011** · MVP · partial · comms · FC 2.5-06 — One-off message from a record or an appointment. AC: engine done; screen missing.
- **K2-COMMS-012** · Later · missing · comms · FC 2.5-09, 2.5-10, 2.5-11, 2.5-12, 2.5-13 — Bulk messages, recalls, automations, multi-step journeys, feedback surveys.

### 3.11 BILL – billing and invoicing (incl. insurer and medico-legal accounts)

Committed on `feat/cs-billing` (`8ef137d`, `e0185da`): migrations `0130`/`0131`, domain, repositories, services
(payment links, visit source, e-billing channels, PDFs), suites incl. real local D1. **No screens** (routes
`/app/clinic/billing/**` and the invoices tab are missing).

- **K2-BILL-001** · MVP · done · billing · FC 2.4-01, 2.1-15 — Invoice from attended appointments (and DNA/late-cancellation charges), priced from the case's price list (payer list → default list → service price). AC: diary visit adapter (CHARGEABLE_STATUSES; DNA/late only with the fee flag; never arrived/in treatment) wired (M5); service suite on 4 backends; e2e pms-billing-screens.
- **K2-BILL-002** · MVP · done · billing · FC 2.4-03 — Bill-to self-pay, insurer on account, medico-legal company/solicitor on account, employer; bill-to frozen and encrypted when issued. AC: suite.
- **K2-BILL-003** · MVP · done · billing · FC 2.4-04 — Insurance excess/shortfall split between patient and payer on the same visits. AC: domain tests; the case's excess is taken from the first visits in date order and shown per line (M5).
- **K2-BILL-004** · MVP · done · billing · FC 2.4-05 — Price per payer (price lists per service and payer). AC: `priceFor` tests.
- **K2-BILL-005** · MVP · done · billing · FC 2.4-02 — VAT per line (exempt default for physio treatment; standard/reduced/zero), prices inclusive or exclusive; VAT summary when the clinic is registered. AC: domain tests.
- **K2-BILL-006** · MVP · done · billing · FC 2.4-01 — Gap-free sequential numbers per clinic with prefix, at most 10 characters (insurer limit), assigned on issue. AC: constraint + suite.
- **K2-BILL-007** · MVP · done · billing · FC 2.4-01 — Invoice states draft → issued → part paid/paid, cancel (draft) and void via credit note; revision-checked edits. AC: suite; void = credit note of kind void + voided_at, refused while paid (M5).
- **K2-BILL-008** · MVP · done · billing · FC 2.4-06 — Credit notes with proportional VAT; release the appointments; give authorisation usage back; never over-credit. AC: suite.
- **K2-BILL-009** · MVP · done · billing · FC 2.4-08 — Statements per patient and per payer account, as PDF. AC: PDF tests; A4 print views of invoices and patient/account statements (M5, browser Save as PDF); demonstration notice on demo clinics.
- **K2-BILL-010** · MVP · done · billing · FC 2.4-09, 2.6-05 — Debtors and aged debt (by payer and patient, age bands). AC: repository; aged debt tab by account type and age band, largest overdue accounts (M5).
- **K2-BILL-011** · MVP · done · billing · FC 2.4-14 — Insurer claims export (CSV, logged) with codes and pre-authorisation number; the Healthcode channel is listed as "not connected" and refuses. AC: tests.
- **K2-BILL-012** · MVP · done · billing · FC 2.4-19 — Accounts CSV exports with a formula-injection guard. AC: tests.
- **K2-BILL-013** · MVP · partial · billing · FC 2.4-01 — Billing screens: invoice list, draft from appointments, issue, credit, payments, statements, debtors, billing settings (VAT, prefix, terms, bank details), the patient's Invoices tab. AC: M5 – invoice list (search, chips, CSV), invoice visits (choose → preview → issue), invoice detail (issue, credit, refund, void, payment link), take payment (incl. 375 px), remittance, statements, aged debt, the patient's Invoices tab and Account card; e2e pms-billing-screens 18/18. Missing: billing settings screen (VAT, prefix, terms, bank details – defaults apply; with Set-up, M8).
- **K2-BILL-014** · Later · missing · billing · FC 2.4-14 — Healthcode e-billing (registration is per practice system; 2–6 months). MVP only if Dell's insurers refuse other routes (Q-D3).
- **K2-BILL-015** · Later · partial · billing · FC 2.4-06, 2.4-10 — Discounts, write-offs and debt chasing.
- **K2-BILL-016** · Later · missing · billing · FC 2.4-19, 2.4-20 — Ledger codes, period lock, accounting-software sync.

### 3.12 AUTHS – treatment authorisations

- **K2-AUTHS-001** · MVP · done · foundation · FC 2.2-08 — Authorisation per case: insurer/MLC code, sessions and/or value, valid from/to, encrypted notes. AC: foundation suite.
- **K2-AUTHS-002** · MVP · done · foundation · FC 2.2-08 — Usage recorded atomically, never over the limit or below zero; diary (attended) and billing (issue) use it; undo/credit give it back. AC: suite; a diary visit's session is counted once (by the diary on completion); billing counts the value and only hand-entered treatments' sessions (M5 fix).
- **K2-AUTHS-003** · MVP · partial · diary · FC 2.2-08 — Booking or attending beyond the remaining sessions or after expiry shows a warning (`canUseAuthorisation`). AC: rule done; warning in booking dialog to verify.
- **K2-AUTHS-004** · MVP · partial-wt · reporting · FC 2.2-09 — Expiring authorisations list (by date and by sessions left). AC: `listExpiringAuthorisations` done; report page uncommitted.
- **K2-AUTHS-005** · MVP · partial · records · FC 2.2-08 — Authorisation screens on the case page (add, edit, remaining). AC: case page uncommitted.
- **K2-AUTHS-006** · Later · missing · comms · FC none — Extension request letter to the payer from a template.

### 3.13 PAY – payments

- **K2-PAY-001** · MVP · done · billing · FC 2.4-07 — Record payments by hand (cash, card on an outside terminal, bank transfer, other) and allocate across invoices; never over-allocate. AC: constraints + suite; take-payment dialog (card now, cash with change, bank transfer) (M5).
- **K2-PAY-002** · MVP · done · billing · FC 2.4-06 — Refunds, reversals and removal of a mistaken payment, audited. AC: suite; refunds from the invoice (to the card through the test provider when it was taken there) (M5).
- **K2-PAY-003** · MVP · done · billing · FC 2.4-07 — Insurer remittance: one payment allocated across many invoices of one payer, matched by invoice number. AC: remittance screen – one payment over a payer's invoices, short payments left / written off / moved to the patient, match from remittance advice (M5).
- **K2-PAY-004** · MVP · done · billing · FC 2.4-11 — Payment provider interface (`CLINIC_PAYMENTS_PROVIDER`): manual default; `stripe_test` via REST, refuses non-test keys and live answers. AC: tests with stubbed API.
- **K2-PAY-005** · Later · partial · billing · FC 2.4-11 — Payment links (single payment, nothing clinical) recorded once by provider reference. AC: test mode done incl. the invoice's Copy payment link and Check for payment (M5); live needs a dedicated Stripe account (one per product, `CLAUDE.md`), likely Connect (Q-K4).
- **K2-PAY-006** · Later · partial · billing · FC 2.4-12, 2.4-13 — Card terminals, saved cards, automatic fees, deposits.

### 3.14 REP – reporting

All reporting code is **uncommitted** in `cs-reporting` (no commit on `feat/cs-reporting`): domain metrics,
periods, catalogue, CSV, repositories, report pages (attendance, authorisations, caseload, debtors, patients,
revenue, utilisation, export route), migration `0160`, D1 stack test.

- **K2-REP-001** · MVP · partial-wt · reporting · FC 2.6-01 — Dashboard: today's appointments, utilisation, DNA rate, revenue, outstanding, expiring authorisations. AC: figures match the seeded data's hand-calculated values (`fact-checks.ts`).
- **K2-REP-002** · MVP · partial-wt · reporting · FC 2.6-02 — Utilisation by practitioner, site and room for a period. AC: booked minutes ÷ rota minutes; excludes blocks.
- **K2-REP-003** · MVP · partial-wt · reporting · FC 2.6-03 — DNA and late-cancellation rates by practitioner and site. AC: matches diary statuses.
- **K2-REP-004** · MVP · partial-wt · reporting · FC 2.6-04 — New vs returning patients. AC: definition stated on screen.
- **K2-REP-005** · MVP · partial-wt · reporting · FC 2.6-05 — Revenue (invoiced, paid) and outstanding debt by payer type. AC: equals billing's totals.
- **K2-REP-006** · MVP · partial-wt · reporting · FC 2.6-06 — Caseload and a fixed report library with CSV export of every report (`reports.export`, audited, formula-injection guard). AC: each report downloads as CSV.
- **K2-REP-007** · Later · missing · reporting · FC 2.6-07, 2.6-08, 2.6-09 — Clinical reports, outcome exports (national datasets), custom reports.

### 3.15 IMP – data import from the current system

All import code is **uncommitted** in `cs-integration` (no commit on `feat/cs-integration`): migration `0170`
(`pms_import_batches`, `pms_import_rows`), CSV parser, kinds (patients, cases, appointments, invoices), mapping,
resolve, issues, importer (check, run, undo pages), batch repository. No import screens.

- **K2-IMP-001** · MVP · partial-wt · integration · FC 2.8-01 — CSV import of patients, cases (payer, referrer), appointments (past and future) and invoices/open balances. AC: domain tests uncommitted; each kind imports a fictional fixture end to end.
- **K2-IMP-002** · MVP · partial-wt · integration · FC 2.8-01 — Column mapping step (any header naming), saved per clinic; template headers downloadable. AC: mapping tests.
- **K2-IMP-003** · MVP · partial-wt · integration · FC 2.8-01 — Dry run ("check") with row-level issues; nothing written. AC: issues list per row; counts.
- **K2-IMP-004** · MVP · partial-wt · integration · FC 2.8-01 — Run in batches of ≤ 40 rows, one audit row per batch; `import_ref` unique per clinic so a re-run never duplicates. AC: re-running the same file creates nothing new.
- **K2-IMP-005** · MVP · partial-wt · integration · FC 2.8-01 — Undo a batch while nothing depends on it (`undoBlocker`). AC: undo refused once an imported appointment was attended.
- **K2-IMP-006** · MVP · missing · integration · FC 2.8-01 — Import screens `/app/clinic/import/**` (permission `import.run`). AC: e2e upload → map → check → run → undo.
- **K2-IMP-007** · MVP · missing · integration · FC 2.8-01 — Treatment authorisations import (code, sessions/value used and remaining, dates). AC: remaining sessions after import equal the source.
- **K2-IMP-008** · MVP · missing · integration · FC 2.8-01 — Reconciliation report per import: counts per kind, open balance per payer and patient, future appointments per practitioner per day vs the source totals; owner sign-off recorded. AC: report downloadable; sign-off audited.
- **K2-IMP-009** · MVP · missing · integration · FC 2.8-02 — Historic clinical notes and documents stay accessible for the retention period: imported as read-only attachments on the patient record (PDF/RTF/DOC), or a documented read-only archive (decision Q-D6). AC: a clinician finds a 2019 note for an imported patient in under a minute.
- **K2-IMP-010** · MVP · missing · ops · FC 2.8-01 — Formats are confirmed from Dell's real exit export only after the solicitor's advice and gate A; until then fixtures are fictional and written by us (never guessed proprietary formats, never from the current system's screens). AC: written advice on file.

### 3.16 CF – ClinForms integration

Requires both packages. Uncommitted in `cs-integration`: ports (`ports.ts`), bundle builder (`bundle.ts`),
filed-forms and form-requests repositories, the additive `"native"` in medreport's `ConnectorIdSchema`, and edits
to two medreport UI files (`home-screen.tsx`, `studio-events.ts` – **outside the integration module's ownership; need
Khuram's/the orchestrator's go**). **`src/server/pms/native-connector.ts` does not exist yet.**

- **K2-CF-001** · MVP · missing · integration · FC 2.3-03 — Native connector `src/server/pms/native-connector.ts` implementing medreport's connector interface (all four methods), registered in `src/app/api/_medreport-glue.ts`, for clinics with both packages only, never listed on `GET /connectors`. AC: ClinForms' connector tests pass with `native`; a reports-only clinic never sees it.
- **K2-CF-002** · MVP · partial-wt · integration · FC 2.3-03 — The connector sends registration, referral, payer and consent from the shared record, and signed notes, outcome scores and appointments through ports; unsigned drafts are never sent. AC: bundle test with a draft and a signed note.
- **K2-CF-003** · MVP · missing · integration · FC 2.3-03 — "Complete referrer form" on a case opens the existing ClinForms flow with the case's data already loaded (no upload). AC: e2e from case page to approved form.
- **K2-CF-004** · MVP · partial-wt · integration · FC 2.3-05, 2.3-03 — The approved form is filed back to the patient record and listed there; form requests are tracked per case. AC: filed form visible on the record; audited.
- **K2-CF-005** · MVP · done · foundation · FC none — `medreport` never imports `pms`; `pms` imports only medreport's connector types (generated ESLint boundary). AC: `npm run lint` + contract test.
- **K2-CF-006** · MVP · missing · integration · FC none — A report completed through the native connector counts against the clinic's Reports allowance exactly like any other (main's plan-and-usage rules, `docs/auth.md` "Packages and usage"). AC: usage test.

### 3.17 ADM – admin and settings

- **K2-ADM-001** · MVP · partial-wt · reporting · FC 2.6-10 — Set-up screens (`/app/clinic/setup/**`): sites (and rooms, opening hours, closures), practitioners, services/appointment types, price lists and items, referrers/payers, record-keeping settings (retention years, upward only). AC: pages for sites, services, prices uncommitted; practitioners, referrers, records, staff have actions only.
- **K2-ADM-002** · MVP · partial-wt · reporting · FC 2.6-11, 2.6-12 — Staff: members (existing ClinForms invitations), role, link to a practitioner, site limits. AC: changing a role takes effect on the next request; audited.
- **K2-ADM-003** · MVP · done · foundation · FC 2.6-11 — Fixed permission matrix (§2). AC: `pmsCan` tests.
- **K2-ADM-004** · MVP · done · foundation · FC 2.7-01 — Two-step sign-in required for every staff user (existing ClinForms). AC: existing auth tests.
- **K2-ADM-005** · MVP · partial · billing · FC 2.4-02 — Billing settings (VAT registration and number, number prefix, payment terms, bank details). AC: data done; screen missing.
- **K2-ADM-006** · MVP · partial · comms · FC 2.5-02 — Comms settings (sender name, reminder rules, quiet hours, templates). AC: data done; screen missing.
- **K2-ADM-007** · Later · missing · foundation · FC 2.7-02 — SSO and IP allow-list.
- **K2-ADM-008** · Later · missing · reporting · FC 2.6-14 — Tasks and teams.

### 3.18 AUD – audit

- **K2-AUD-001** · MVP · done · foundation · FC 2.6-13 — Every write is audited through the repositories in the same atomic batch; codes `pms.<entity>.<verb>`, each labelled; audit rows hold ids, counts, field names and statuses – never names, DOBs or note text. AC: activity test fails on an unlabelled code; per-module suites check audit rows.
- **K2-AUD-002** · MVP · done · foundation · FC 2.6-13 — "Clinic system" filter group on `/app/settings/activity` with CSV, only for clinics with the package. AC: foundation e2e.
- **K2-AUD-003** · MVP · partial-wt · reporting · FC 2.6-13 — Audit search by user, patient, action, record type and date. AC: repository uncommitted.
- **K2-AUD-004** · MVP · done · foundation · FC none — Platform actions on a clinic (package changes) appear in the clinic's own trail as "ClinForms support". AC: foundation tests.
- **K2-AUD-005** · Later · missing · records · FC 2.6-13 — Record views (who opened a patient's clinical notes) are logged. MVP if the DPIA requires it (Q-K7).

---

## 4. Data model summary

All tables: `tenant_id` first, `PRIMARY KEY (tenant_id, id)`, foreign keys include `tenant_id`, free text in `_enc`
columns (per-clinic AES-GCM), money in pence, dates `YYYY-MM-DD` text, `rev` on co-edited records, `import_ref` on
anything an import creates (contract §4). Both dialects: SQLite/D1 `db/migrations/sqlite/01NN_*.sql` and Postgres
twins `supabase/migrations/20261024000NNN_*.sql`.

| Module (migrations) | Tables | Committed? |
|---|---|---|
| foundation (0100–0102) | `clinic_entitlements`, `clinic_usage_counters`, `pms_settings`, `pms_sites`, `pms_rooms`, `pms_practitioners`, `pms_services`, `pms_price_lists`, `pms_price_list_items`, `pms_referrers`, `pms_patients`, `pms_cases`, `pms_authorisations` | yes |
| diary (0110) | `pms_appointment_series`, `pms_availability`, `pms_appointments` (appointments and blocked time, `kind`), `pms_waiting_list` | yes |
| records (0120–0121) | `pms_note_templates`, `pms_clinical_notes`, `pms_note_amendments`, `pms_outcome_measures`, `pms_attachments`, `pms_attachment_chunks`, `pms_patient_anonymisations` | yes |
| billing (0130–0131) | `pms_billing_settings`, `pms_service_vat`, `pms_invoices`, `pms_invoice_lines`, `pms_credit_notes`, `pms_credit_note_lines`, `pms_payments`, `pms_payment_allocations`, `pms_payment_links`, `pms_invoice_exports` | yes |
| comms (0140–0141) | `pms_comms_settings`, `pms_message_templates`, `pms_reminder_rules`, `pms_messages`, `pms_message_schedule`, `pms_consent_events`, `pms_letter_templates`, `pms_letters` | yes |
| portal (0150–0152) | `pms_booking_settings`, `pms_booking_hours`, `pms_online_bookings`, `pms_portal_accounts`, `pms_portal_links`, `pms_portal_sessions`, `pms_portal_messages`, `pms_portal_shares`, `pms_intake_templates`, `pms_intake_responses` | yes |
| reporting (0160) | `pms_site_hours`, `pms_site_closures`, `pms_staff_access`, `pms_staff_sites` | **no (worktree)** |
| integration (0170) | `pms_import_batches`, `pms_import_rows`, `pms_form_requests`, `pms_filed_forms`, `pms_filed_form_parts` | **no (worktree)** |

Key relationships: patient 1–n cases; case 1–n authorisations; case → payer (`pms_referrers`, kind insurer/MLC/…);
appointment → patient, case, practitioner, site, room, service; note → patient (+ case, appointment); invoice →
bill-to payer or patient, lines → appointments; payment → allocations → invoices.

**Overlaps to resolve at integration (§7 of HANDOVER):** `pms_online_bookings` vs `pms_appointments` (one store);
`pms_booking_hours` vs `pms_site_hours` (one opening-hours source); `pms_portal_messages` vs `pms_messages` (one
outbox); two merge-field engines; foundation `clinic_entitlements`/`clinic_usage_counters` vs `main`'s newer
`clinic_package`/`clinic_usage` (migrations 0006–0008 on `main`, Reports plans and usage) – one package model.

---

## 5. Non-functional requirements

### 5.1 Security
- **K2-NFR-001** · MVP · done · foundation · FC none — Every page/layout under `/app/clinic` calls `requireClinicActor` first; every action `clinicActionActor`; every route `clinicRoute`; tenant and user never taken from the request. AC: contract source-check tests.
- **K2-NFR-002** · MVP · done · foundation · FC none — Writes same-origin only; JSON errors; `no-store`. AC: `http.test.ts`.
- **K2-NFR-003** · MVP · partial · portal · FC none — Public endpoints rate-limited (`hitRateLimit`), `noindex`, bot check ready. AC: limits tested; pages missing.
- **K2-NFR-004** · MVP · partial · records · FC 2.2-20 — Uploads: magic-byte type check, size limits, never executed or rendered inline. AC: tests; route review in the security lens.
- **K2-NFR-005** · MVP · partial · billing · FC none — Every CSV export guards against formula injection (billing done; reporting and import to verify). AC: shared helper used everywhere.
- **K2-NFR-006** · MVP · missing · ops · FC none — No patient data in logs, analytics (PostHog), error messages or URLs. AC: security lens finds none; PostHog off on `/app/clinic` pages or property-scrubbed.
- **K2-NFR-007** · MVP · missing · ops · FC none — Independent penetration test and retest of K2 before real patient data. AC: report with no open high findings.
- **K2-NFR-008** · MVP · missing · ops · FC none — Content Security Policy enforced (today Report-Only on `main`). AC: no violations in the e2e suite.

### 5.2 UK GDPR
- **K2-NFR-010** · MVP · missing · ops · FC none — Clinic = controller, AppstackX Ltd = processor; Article 28 DPA covering K2 with its sub-processors (hosting, database, email/SMS, payments). AC: signed DPA before any real data.
- **K2-NFR-011** · MVP · missing · ops · FC none — DPIA covering K2 (names visible in the diary all day, plain demographics, reminders, portal, import). AC: DPIA approved by Khuram and the clinic.
- **K2-NFR-012** · MVP · partial · records · FC 2.7-04 — Subject access answered within one month using K2-PAT-009. AC: export complete across modules.
- **K2-NFR-013** · MVP · done · records · FC 2.2-17 — Rectification through amendments; erasure limited by the retention rule (records not deleted). AC: triggers.
- **K2-NFR-014** · MVP · done · comms · FC 2.5-07 — Data minimisation in messages; PECR consent for marketing. AC: tests.

### 5.3 Retention
- **K2-NFR-020** · MVP · done · foundation · FC 2.7-06 — Adults: 8 years after the last treatment; children: until their 25th birthday (26th if 17 at the last treatment), never less than 8 years after the last treatment; deceased: 8 years after death; unknown dates: a person decides; clinic settings may only raise these. AC: `retention.ts` tests.
- **K2-NFR-021** · MVP · done · foundation · FC 2.7-06 — No code or scheduled job deletes clinical records; archive or anonymise after the review date only; legal hold blocks. AC: contract rule; lock triggers; no `deleteFrom` on clinical tables (grep in review).
- **K2-NFR-022** · MVP · missing · ops · FC 2.7-06 — ClinForms' daily retention cron (`/api/cron/retention`, 30-day report retention) never touches `pms_*` tables. AC: test proving the cron's statements name no `pms_` table.
- **K2-NFR-023** · MVP · done · foundation · FC none — Offboarding = verified decrypted export, then delete (K2-PLT-011).

### 5.4 Encryption
- **K2-NFR-030** · MVP · done · foundation · FC 2.7-03 — Clinical free text, files and sensitive fields encrypted with the per-clinic AES-GCM envelope, AAD `<tenant>:<table>.<column>:<id>`; a moved ciphertext does not decrypt. AC: per-module suites.
- **K2-NFR-031** · MVP · done · foundation · FC 2.7-03 — Lists never decrypt; decrypt only in get-by-id. AC: review + tests.
- **K2-NFR-032** · MVP · done · foundation · FC none — TLS everywhere, HSTS (existing). AC: headers.
- **K2-NFR-033** · MVP · missing · ops · FC 2.7-03 — Key rotation and the offline key check (`docs/go-live.md` §7.6) cover K2 data. AC: rotation drill decrypts a K2 note.

### 5.5 Tenancy
- **K2-NFR-040** · MVP · partial · foundation · FC none — Tenant scope proven per module: two clinics, no cross-clinic read/write, cross-clinic foreign keys refused, `unscopedStatements(...) = []`, on SQLite, PGlite and D1. AC: done for foundation, diary, records, billing, portal; comms lacks the D1 stack test; reporting and integration uncommitted.
- **K2-NFR-041** · MVP · done · foundation · FC none — Postgres: RLS enabled and `anon`/`authenticated` revoked on every table. AC: migration review.

### 5.6 Accessibility
- **K2-NFR-050** · MVP · partial · ops · FC 2.7-11 — WCAG 2.2 AA: labels, errors in `role="alert"`, visible focus, keyboard for everything (diary included), contrast ≥ 4.5:1, no information by colour alone, 375 px without sideways scrolling. AC: each module's e2e checks keyboard and 375 px; an outside audit of the public booking, portal and forms before go-live.

### 5.7 Performance
- **K2-NFR-060** · MVP · missing · diary · FC none — With 50,000 appointments and 20,000 patients: diary day view for a site (10 practitioners) server time ≤ 500 ms p95; patient search ≤ 300 ms p95; report pages ≤ 2 s for a year. AC: measured on Postgres and D1 with a generated fictional dataset.
- **K2-NFR-061** · MVP · done · foundation · FC none — D1 limits respected: ≤ 100 parameters (`IN` lists of 90), list limits ≤ 500, keyset paging, bulk batches ≤ 40 rows. AC: real local D1 runs.

### 5.8 Availability and support
- **K2-NFR-070** · MVP · missing · ops · FC 2.7-09, 2.7-10 — Target 99.5 % in clinic hours (proposal: Mon–Sat 07:00–21:00 UK); public status page; alerts; engineer on call with ≤ 1 h response in clinic hours (Khuram works full-time elsewhere – Q-K1). AC: written support arrangement before gate C.
- **K2-NFR-071** · MVP · missing · ops · FC none — Releases outside clinic hours, through a staging/preview database first; migrations applied before the code that reads them. AC: deploy runbook for K2.

### 5.9 Backups and hosting
- **K2-NFR-080** · MVP · missing · ops · FC 2.7-07 — Production K2 data in Postgres in London with point-in-time recovery, a nightly encrypted offline copy and a passed restore drill; RPO ≤ 15 min (PITR), RTO ≤ 4 h (proposal). Today: D1 (EU) with 7-day Time Travel, no off-site export. AC: restore drill log.
- **K2-NFR-081** · MVP · missing · ops · FC 2.7-07 — Commercial hosting plans (Vercel Pro – Hobby is non-commercial; Workers Paid). AC: plans active before gate A.

### 5.10 Compatibility and wording
- **K2-NFR-090** · MVP · missing · ops · FC none — ClinForms unchanged for clinics without the package: full check chain green and `scripts/e2e/forms-regression.cjs` outputs byte-identical to a `main` build. AC: comparison report at every merge into `feat/clinic-system`.
- **K2-NFR-091** · MVP · done · foundation · FC none — Both dialects in parity (columns, keys, FKs, indexes). AC: parity test.
- **K2-NFR-092** · MVP · missing · ops · FC none — The data-gateway Worker's statement allowlist covers every K2 statement before a D1 deploy. AC: gateway test with each module's suite.
- **K2-NFR-093** · MVP · done · foundation · FC none — UK English, neutral, no "AI"/vendor/model names on screen; product name only through `CLINIC_SYSTEM_NAME`. AC: contract and neutral-wording tests.

---

## 6. Integrations and providers (behind interfaces)

| Need | Interface (where) | Default now | Live candidate | Gate |
|---|---|---|---|---|
| Email (confirmations, reminders, portal links, letters) | `src/server/pms/comms/providers/*`, env `CLINIC_EMAIL_PROVIDER` | outbox (stored, never sent) | MailerSend (domain authorised 24 Oct; turn tracking off) | B |
| SMS / WhatsApp | same, env `CLINIC_SMS_PROVIDER` | outbox | MailerSend SMS/WhatsApp – **UK coverage, sender IDs, pricing, WhatsApp template rules unchecked** (Q-K3); fallback: another UK SMS provider | B |
| Inbound replies (YES/NO/STOP) | `src/server/pms/comms/webhook.ts`, `replies.ts` | not connected | provider webhook | Later |
| Card payments | `src/server/pms/billing/payments/*`, env `CLINIC_PAYMENTS_PROVIDER` | manual | Stripe – new dedicated account (one Stripe account per product), probably Connect for patient payments | Later |
| Insurer e-billing | `src/server/pms/billing/ebilling-channels.ts` | claims CSV; Healthcode "not connected" | Healthcode (per-system registration, 2–6 months) | Q-D3 |
| ClinForms (reports) | `src/server/pms/native-connector.ts` → medreport connector interface | – (missing) | in-process | A |
| Bot check | `src/server/pms/portal/human-check.ts` | off | Cloudflare Turnstile | B |
| Calendar, accounting, networks, exercise prescription | – | – | – | Out of scope (§12) |

Every provider: test mode only in this phase, refuses live-looking keys, sends nothing clinical, no new paid service
without Khuram's go.

---

## 7. Cross-module rules for the integration step

- One appointment store (`pms_appointments`): online bookings, imports and recurring series all write through the
  diary repositories, so the database clash rule covers every path (K2-BOOK-003, K2-IMP-001).
- One outbox and message log (`pms_messages`): portal, letters and reminders send through comms (K2-BOOK-004).
- One opening-hours source per site, read by diary, online booking and reports (K2-SITE-003).
- One merge-field engine (K2-LTR-007).
- Modules talk through the ports they already declare (billing's visit source, portal's diary port, integration's
  `ports.ts`/`wiring.ts`, comms' `syncAppointmentMessages`); adapters are wired at integration, never by importing
  another module's internals.

---

## 8. Migration from the current system

### 8.1 What data

| Data | Needed for | K2 target | Requirement |
|---|---|---|---|
| Sites, rooms, practitioners, services, prices, referrers/payers | Set-up | directory (by hand or CSV) | K2-ADM-001, K2-PAT-011 |
| Patients (demographics, contacts, GP, consent, alerts) | Everything | `pms_patients` | K2-IMP-001 |
| Cases with payer and referrer | Billing, ClinForms | `pms_cases` | K2-IMP-001 |
| Authorisations (used/remaining, dates) | Insurer/MLC treatment | `pms_authorisations` | K2-IMP-007 |
| Future appointments | Diary from day one | `pms_appointments` | K2-IMP-001 |
| Past appointments (dates, status) | Last-seen date → retention; history | `pms_appointments` | K2-IMP-001 |
| Open balances per patient and payer (and invoice history if exportable) | Debt collection | `pms_invoices` (opening balances) | K2-IMP-001 |
| Clinical notes, letters, documents (PDF/RTF/DOC) | Retention, continuity of care | attachments or archive | K2-IMP-009 |
| Outcome scores | Nice to have | `pms_outcome_measures` | Later |

### 8.2 Format

- CSV per kind with a mapping step, so any header naming works; UK dates; encoding to be confirmed (UTF-8 or
  Windows-1252, Q-D7). Documents as files.
- Known from public sources (feature comparison §3, closing paragraph):
  access to the current system can end when its exit export starts; cases created in its desktop version export as
  CSV data only, with no note PDFs; some third-party importers move no financial data. Confirm with Dell which version
  his team uses (Q-D1).
- Contract caution: the current supplier's terms restrict using its service to build a competing product. Design
  from public documentation and Dell's stated needs only – never from its screens, logins or exports – and get a
  solicitor's view on using the exit extract before touching it (K2-IMP-010).

### 8.3 Cut-over plan

1. **Before:** gates A and B passed (§10); set-up done in K2 (sites, rooms, practitioners, services, prices,
   payers); staff trained on fictional data.
2. **Trial extract** (real data – only after gate A): import into a separate, non-live K2 clinic; run
   reconciliation (K2-IMP-008); fix mappings; Dell signs the reconciliation off; delete the trial clinic through
   offboarding.
3. **Pilot by clinician, not by site:** move one clinician's whole diary (future appointments) to K2 for 4 weeks
   while everyone else stays on the current system, so no slot is bookable in two systems. Messages from K2 only
   for that clinician's patients.
4. **Full cut-over weekend** (after gate C): Friday close in the current system → final extract → import → reconcile
   (counts, balances, future appointments per practitioner per day) → Dell's sign-off → Monday go-live with on-call
   support; printable day lists (K2-DIARY-017) as fallback.
5. **Finance:** close the month in the current system; open balances come across as opening balances; full
   financial history stays in the archive.
6. **Rollback:** until the sign-off, the current system stays the system of record; Dell keeps his current
   contract until K2 has run all sites for an agreed period (his notice period is his to manage).
7. **Archive:** historic notes and documents accessible for the retention period (K2-IMP-009).

---

## 9. Packages, pricing and usage (summary)

`reports` = ClinForms; `clinic` = K2; both = all-in-one. Usage counters in `clinic_usage_counters`
(`practitioners_active`, `sms_segments`, …). Blue Heart proposal (packaging note §3, Khuram to confirm): Reports £299;
K2 £29 per practitioner whose whole diary runs on it; all-in-one capped at £599 for 12 months from the first clinician
going live. No billing of clinics exists yet in ClinForms.

---

## 10. Compliance and operational gates before real data

| # | Item | Gate | Status (26 Oct) |
|---|---|---|---|
| 1 | Article 28 DPA covering K2 signed with the right legal entity (Blue Heart Clinics Ltd 09158709 files dormant accounts – check which entity contracts) | A | not started for K2 |
| 2 | DPIA for K2 | A | not started |
| 3 | ICO registration fee paid (tier 1) | A | check |
| 4 | Sub-processor list updated (database, email/SMS, payments) | A | not started |
| 5 | Postgres in London with PITR, offline encrypted backup, restore drill (K2-NFR-080) | A | not started |
| 6 | Vercel Pro and Workers Paid (K2-NFR-081) | A | not started (Hobby today) |
| 7 | Tech PI + cyber insurance covering hosted health data | A | current PI covers software engineering only |
| 8 | Cyber Essentials (then CE Plus before gate C) | A / C | not started |
| 9 | Independent pen test + retest (K2-NFR-007) | A | not started (£5–11k est.) |
| 10 | CSP enforced (K2-NFR-008); ClinForms ops items open on `main` (first retention cron run, go-live §7.6 key check) | A | open |
| 11 | Solicitor's advice on using the current system's exit extract (K2-IMP-010) | A | not started |
| 12 | Outcome-measure licences (ODI via Mapi Research Trust; NDI; QuickDASH) before scored versions are used | B | not checked |
| 13 | Live email/SMS accounts with sender verification; reminders without clinical detail | B | email DNS done; SMS unchecked |
| 14 | Accessibility audit of public booking, portal and forms (WCAG 2.2 AA) | B | not started |
| 15 | Intended-purpose statement + light hazard log (K2 is not a medical device; no diagnosis suggestions) | B | not started |
| 16 | Contract pack: SaaS terms, SLA, exit and data-return clause, continuity/escrow | C | not started |
| 17 | Support in clinic hours with ≤ 1 h engineer response (K2-NFR-070) | C | not arranged |
| 18 | Insurer billing route agreed with Dell (Healthcode or manual) | C | Q-D3 |
| 19 | Dedicated Stripe account for patient payments (only if live payments are wanted) | Later | – |

Gate A = before any real patient data enters K2 (incl. a trial extract). Gate B = before the first clinician's
diary runs on K2. Gate C = before all sites switch. Commercial gates G0–G2: packaging note §4/§5.

---

## 11. Open questions

**For Dell** (spoken questions, no vendor names; don't ask for his contract, invoices or screenshots of the current
system):
- **Q-D1** Does the team use the browser version, the desktop version, or both? (Decides the export format.)
- **Q-D2** Which of these are used daily: insurer e-billing (and who handles remittances), card machines or payment
  links, online booking, text reminders (who reads replies), waiting list, recalls?
- **Q-D3** Which insurers does Blue Heart bill, and do any accept invoices only electronically? (Healthcode needed
  at switch or not.)
- **Q-D4** Does reception book centrally across sites or per site? Are rooms booked? Is a week view across
  practitioners needed? Should staff be limited to their sites?
- **Q-D5** Which note templates and outcome scores do clinicians use? Red-flag alerts?
- **Q-D6** How many patients, cases and years of history? Must historic notes be inside K2, or is a read-only
  archive enough?
- **Q-D7** Who will produce the exit export, and when could a trial extract be taken (after the DPA)?
- **Q-D8** Classes, video, packages, stock, accounting sync – used at all?
- **Q-D9** How many clinicians, receptionists and admins per site? Which clinician would pilot?
- **Q-D10** Will he sign a DPA covering K2 and confirm the "~£300 more" in writing (letter of intent)?
- **Q-D11** Do his solicitor or his medico-legal/insurer partners require a pen test, Cyber Essentials Plus or ISO
  27001 from his practice-system supplier?

**For Khuram:**
- **Q-K1** Support in clinic hours while working full-time elsewhere: who answers at 09:00 on a Tuesday?
- **Q-K2** Real product name and second domain (and whether one account spans both hosts, K2-PLT-006).
- **Q-K3** SMS provider: check MailerSend SMS/WhatsApp UK coverage, sender IDs and price, or choose a UK SMS provider.
- **Q-K4** Live payments at all for Blue Heart? If yes, a new dedicated Stripe account and Connect.
- **Q-K5** Should clinicians see reports for their own caseload?
- **Q-K6** One package model: keep foundation's `clinic_entitlements` and fold `main`'s `clinic_package` into it,
  or the reverse? (Must be decided before `feat/clinic-system` is merged with `main`.)
- **Q-K7** Log record views (K2-AUD-005) for MVP?
- **Q-K8** Outcome-measure licences: which scored instruments may we ship?
- **Q-K9** Is K2 ever deployed on D1, or only after the move to London Postgres?
- **Q-K10** Who acts as orchestrator for foundation-owned files and the contract now that the sprint workflow is
  stopped – the second account, with Khuram approving each foundation change?
- **Q-K11** Confirm the Blue Heart price proposal (£29 per live practitioner, cap £599).

---

## 12. Out of scope (for the Blue Heart switch)

- Group classes and courses, video appointments (FC 2.1-22, 2.1-23); class invoicing (FC 2.4-21).
- Packages, subscriptions, memberships, gift vouchers, discount codes, stock and retail, expenditure (FC 2.4-15,
  2.4-16, 2.4-17, 2.4-18).
- Third-party booking networks and outsourced reception, reports to referral networks, incoming network referrals and
  a referral portal (FC 2.1-33, 2.3-06, 2.8-07).
- Exercise prescription, note-writing scribe, marketing tools, booking analytics, public API and data warehouse
  (FC 2.8-03, 2.8-04, 2.8-05, 2.8-06, 2.8-08).
- ISO 27001 certification in this phase (Cyber Essentials instead) (FC 2.7-08).
- Native mobile apps (mobile web only), NHS integrations, clinical decision support, telephony.
- Live sending, live payments and real data until the gates in §10.

---

## 13. Traceability

Generated from the requirement lines above (§3, §5). "FC" = feature-comparison row(s), named in §13.2. Branch:
`foundation` = `feat/clinic-system`; others = `feat/cs-<module>`; `ops` = no code branch.

<!-- TRACE:BEGIN (generated by a one-off script from the requirement lines; regenerate if lines change) -->
**Counts:** 205 requirements – MVP 176, Later 29.

| Priority | done | back end done (screen pending) | partial | partial-wt | missing | total |
|---|---:|---:|---:|---:|---:|---:|
| MVP | 65 | 24 | 35 | 23 | 29 | 176 |
| Later | 0 | 0 | 3 | 1 | 25 | 29 |
| **All** | 65 | 24 | 38 | 24 | 54 | 205 |

| Area | done | back end done (screen pending) | partial | partial-wt | missing |
|---|---:|---:|---:|---:|---:|
| PLT | 9 | 0 | 1 | 0 | 1 |
| SITE | 1 | 1 | 0 | 2 | 2 |
| DIARY | 6 | 11 | 0 | 0 | 5 |
| BOOK | 1 | 0 | 5 | 0 | 4 |
| PAT | 0 | 7 | 3 | 1 | 3 |
| NOTE | 2 | 5 | 2 | 0 | 2 |
| LTR | 2 | 0 | 2 | 1 | 2 |
| FORM | 2 | 0 | 3 | 0 | 2 |
| PORTAL | 1 | 0 | 5 | 0 | 1 |
| COMMS | 3 | 0 | 3 | 3 | 3 |
| BILL | 12 | 0 | 2 | 0 | 2 |
| AUTHS | 2 | 0 | 2 | 1 | 1 |
| PAY | 4 | 0 | 2 | 0 | 0 |
| REP | 0 | 0 | 0 | 6 | 1 |
| IMP | 0 | 0 | 0 | 5 | 5 |
| CF | 1 | 0 | 0 | 2 | 3 |
| ADM | 2 | 0 | 2 | 2 | 2 |
| AUD | 3 | 0 | 0 | 1 | 1 |
| NFR | 14 | 0 | 6 | 0 | 14 |

### 13.1 Requirement → feature-comparison rows → branch → status

| ID | Pri | Status | Branch | FC rows | Requirement (short) |
|---|---|---|---|---|---|
| K2-PLT-001 | MVP | done | feat/clinic-system | – | Each clinic has packages `reports` and `clinic` with status active / trial / paused / … |
| K2-PLT-002 | MVP | done | feat/clinic-system | – | With `reports` off, Studio and the Report API are unreachable for that clinic |
| K2-PLT-003 | MVP | done | feat/clinic-system | – | Packages are switched from `/app/platform` → Packages and `npm run … |
| K2-PLT-004 | MVP | done | feat/clinic-system | – | If the package table cannot be read, Reports stays on and K2 stays off |
| K2-PLT-005 | MVP | done | feat/clinic-system | – | Brand by host name from one config: ClinForms on `clinforms.co.uk`, previews and … |
| K2-PLT-006 | Later | missing | feat/clinic-system | – | Sign-in on a second domain: Better Auth `trustedOrigins` + per-request base URL, … |
| K2-PLT-007 | MVP | done | feat/clinic-system | – | The product name appears only through `CLINIC_SYSTEM_NAME`; banned names fail a test |
| K2-PLT-008 | MVP | done | feat/clinic-system | – | Shell `/app/clinic` with navigation and patient-record tabs aggregated from each module's … |
| K2-PLT-009 | MVP | done | feat/clinic-system | 2.2-01 | Shared patient record and directory (patients, cases, authorisations, referrers/payers, … |
| K2-PLT-010 | MVP | partial | feat/clinic-system | – | Demo seed `npm run pms:seed-demo` creates "Riverside Physiotherapy (fictional)" with 3 … |
| K2-PLT-011 | MVP | done | feat/clinic-system | – | Offboarding a clinic exports every K2 row decrypted (`clinic-system.json`) and deletes … |
| K2-SITE-001 | MVP | done | feat/clinic-system | 2.1-01, 2.1-04 | Sites (name, address, phone, email) with rooms per site; practitioners may work at … |
| K2-SITE-002 | MVP | back end done, screen pending | feat/cs-diary | 2.1-01 | Every diary view is for a chosen site (switcher) and date; reception can switch site … |
| K2-SITE-003 | MVP | partial-wt | feat/cs-reporting | 2.6-10 | Opening hours and closure days per site, used by the diary and online booking |
| K2-SITE-004 | MVP | partial-wt | feat/cs-reporting | 2.6-12 | A user can be limited to some sites (`pms_staff_access`, `pms_staff_sites`); the limit … |
| K2-SITE-005 | MVP | missing | feat/cs-billing | 2.1-01 | Invoices, statements, letters and messages show the site's address and contact details … |
| K2-SITE-006 | Later | missing | feat/cs-diary | 2.1-01 | Per-site cancellation/DNA charges and per-site reminder templates |
| K2-DIARY-001 | MVP | done | feat/clinic-system | 2.1-10 | Appointment types/services with duration, price, category, colour and an online-bookable … |
| K2-DIARY-002 | MVP | back end done, screen pending | feat/cs-diary | 2.1-07 | Practitioner working times (rotas) per site: days, times, repeat every N weeks, end date; … |
| K2-DIARY-003 | MVP | back end done, screen pending | feat/cs-diary | 2.1-02, 2.1-04 | Day view with one column per practitioner or per room for a site; 24 h Europe/London; … |
| K2-DIARY-004 | MVP | back end done, screen pending | feat/cs-diary | 2.1-03 | Week view for one practitioner or one room |
| K2-DIARY-005 | Later | missing | feat/cs-diary | 2.1-03 | Week view across several practitioners or rooms |
| K2-DIARY-006 | MVP | done | feat/cs-diary | 2.1-06, 2.1-04 | No double booking of a practitioner or a room, enforced in the database (SQLite trigger … |
| K2-DIARY-007 | MVP | back end done, screen pending | feat/cs-diary | 2.1-11 | Reception books from a free slot: patient search, appointment type, practitioner, room, … |
| K2-DIARY-008 | MVP | back end done, screen pending | feat/cs-diary | 2.1-12 | Recurring appointments (series): all-or-nothing or skip clashes; cancel the rest of a … |
| K2-DIARY-009 | MVP | back end done, screen pending | feat/cs-diary | 2.1-13 | Move/reschedule an appointment, by drag **and** by a keyboard/click alternative |
| K2-DIARY-010 | MVP | back end done, screen pending | feat/cs-diary | 2.1-14, 2.1-15 | Statuses booked, arrived, attended, did not attend, cancelled, late cancellation (with … |
| K2-DIARY-011 | MVP | done | feat/cs-diary | 2.2-08 | Marking attended updates the patient's last-seen date (retention) and uses one … |
| K2-DIARY-012 | MVP | back end done, screen pending | feat/cs-diary | 2.1-08 | Blocked time (meeting, holiday, other) that stops booking |
| K2-DIARY-013 | MVP | back end done, screen pending | feat/cs-diary | 2.1-16 | Waiting list per clinic with preferred practitioner/site/times; book from an entry … |
| K2-DIARY-014 | MVP | done | feat/cs-diary | 2.1-17 | Two users editing the same appointment: optimistic revision check; the second save gets … |
| K2-DIARY-015 | MVP | done | feat/cs-diary | – | Times are Europe/London including both clock changes |
| K2-DIARY-016 | MVP | back end done, screen pending | feat/cs-diary | 2.1-18 | Quick patient search from the diary (name, number, phone, DOB) |
| K2-DIARY-017 | MVP | back end done, screen pending | feat/cs-diary | 2.1-20 | Printable day list per practitioner/site (paper fallback during an outage) |
| K2-DIARY-018 | MVP | done | feat/cs-diary | – | Booking, cancellation and waiting-list notes are encrypted; appointments are never deleted |
| K2-DIARY-019 | Later | missing | feat/cs-diary | 2.1-05 | Equipment as a bookable resource (beyond rooms) |
| K2-DIARY-020 | Later | missing | feat/cs-diary | 2.1-09 | Skills limit which services a practitioner can be booked for |
| K2-DIARY-021 | Later | missing | feat/cs-diary | 2.1-19 | List view of appointments with bulk actions |
| K2-DIARY-022 | Later | missing | feat/cs-diary | 2.1-21 | Calendar feed for practitioners (no patient names) |
| K2-BOOK-001 | MVP | partial | feat/cs-portal | 2.1-24 | Public booking page per clinic and site in route group `src/app/(public-clinic)/**`: no … |
| K2-BOOK-002 | MVP | partial | feat/cs-portal | 2.1-25 | Availability from the diary: rotas, opening hours, bookable appointment types, buffers, … |
| K2-BOOK-003 | MVP | missing | feat/cs-portal | 2.1-24, 2.1-06 | An online booking becomes a diary appointment in `pms_appointments` (one appointment … |
| K2-BOOK-004 | MVP | partial | feat/cs-portal | 2.5-01 | Booking confirmation, cancellation and change messages go through comms (outbox until a … |
| K2-BOOK-005 | MVP | partial | feat/cs-portal | 2.1-29 | Patient cancels or rebooks online within the notice policy; a cancellation inside the … |
| K2-BOOK-006 | MVP | done | feat/cs-portal | – | Bot check ready but off; rate limits per client, email and clinic |
| K2-BOOK-007 | MVP | partial | feat/cs-portal | 2.1-25 | Staff settings for online booking (`/app/clinic/online-booking`, permission … |
| K2-BOOK-008 | Later | missing | feat/cs-portal | 2.1-26 | Deposit or payment at booking |
| K2-BOOK-009 | Later | missing | feat/cs-portal | 2.1-28 | Insured patients book online with insurer and authorisation details captured for staff to … |
| K2-BOOK-010 | Later | missing | feat/cs-portal | 2.1-27 | Forms, add-ons and companion bookings inside the booking flow |
| K2-PAT-001 | MVP | back end done, screen pending | feat/cs-records | 2.1-18, 2.2-01 | Patient list with search by name words, patient number, phone, date of birth, email; … |
| K2-PAT-002 | MVP | back end done, screen pending | feat/cs-records | 2.2-01, 2.2-02 | Create and edit a patient: demographics, contacts, emergency contact, GP, consent flags, … |
| K2-PAT-003 | MVP | partial | feat/cs-records | – | Patient record page with tabs registered by modules (appointments, notes, outcomes, … |
| K2-PAT-004 | MVP | back end done, screen pending | feat/cs-records | 2.2-07 | Cases (episodes) with payer type (self-pay, insurer + membership/policy number, … |
| K2-PAT-005 | MVP | partial | feat/cs-records | 2.2-04 | Medical alerts (encrypted) shown on the record and in the diary's appointment dialog |
| K2-PAT-006 | MVP | back end done, screen pending | feat/cs-records | 2.2-03 | Patient status (active, archived, deceased with date) and legal hold |
| K2-PAT-007 | MVP | back end done, screen pending | feat/cs-records | 2.2-20 | Attachments: encrypted per clinic, type checked by magic bytes, size limits, withdrawn … |
| K2-PAT-008 | MVP | back end done, screen pending | feat/cs-records | 2.6-13 | Per-patient history built from the audit log (who did what, when) |
| K2-PAT-009 | MVP | partial | feat/cs-records | 2.7-04 | Subject access export of one patient's full record as PDF and JSON (permission … |
| K2-PAT-010 | MVP | back end done, screen pending | feat/cs-records | 2.7-05 | Anonymise a patient only after the retention review date, never under legal hold, … |
| K2-PAT-011 | MVP | partial-wt | feat/cs-reporting | 2.2-10 | Referrers and payer accounts directory (GP, consultant, insurer, medico-legal company, … |
| K2-PAT-012 | Later | missing | feat/cs-records | 2.2-06 | Merge duplicate patients (with audit and undo window) |
| K2-PAT-013 | Later | missing | feat/cs-records | 2.2-05 | Tags on patients |
| K2-PAT-014 | Later | missing | feat/cs-records | 2.2-04 | Clinical flags (red/black) that require acknowledgement |
| K2-NOTE-001 | MVP | back end done, screen pending | feat/cs-records | 2.2-11, 2.3-04 | Built-in templates (initial assessment SOAP, follow-up SOAP, discharge) and clinic … |
| K2-NOTE-002 | MVP | back end done, screen pending | feat/cs-records | 2.2-11 | Write a note for a patient, linked to a case and appointment; drafts saved with revision |
| K2-NOTE-003 | MVP | done | feat/cs-records | 2.2-17 | Sign and lock: only the author signs; a content fingerprint is stored; a database trigger … |
| K2-NOTE-004 | MVP | back end done, screen pending | feat/cs-records | 2.2-17 | Amendments to a signed note: append-only, with reason, author and time, shown as a … |
| K2-NOTE-005 | MVP | partial | feat/cs-records | 2.2-14 | Body chart (front/back outlines, markers stored as data) |
| K2-NOTE-006 | MVP | back end done, screen pending | feat/cs-records | 2.2-15 | Outcome measures NDI, ODI, NPRS, PSFS, QuickDASH, scored automatically, chart over time; … |
| K2-NOTE-007 | MVP | done | feat/cs-records | – | Reception (`staff`) can never see clinical note content, outcome answers or health … |
| K2-NOTE-008 | MVP | back end done, screen pending | feat/cs-records | 2.2-18 | Unsigned-notes list per clinician (drafts older than N days, N per clinic) |
| K2-NOTE-009 | MVP | partial | feat/cs-records | 2.2-23 | Notes can be written on a phone (375 px) |
| K2-NOTE-010 | Later | missing | feat/cs-records | 2.2-12, 2.2-13, 2.2-16 | Note-writing aids (snippets), medical history carried across cases, goals |
| K2-NOTE-011 | Later | missing | feat/cs-records | 2.2-19 | Restrict a case to its own practitioner |
| K2-LTR-001 | MVP | partial | feat/cs-comms | 2.3-01 | Letter templates with merge fields from patient, case, payer, practitioner, appointments, … |
| K2-LTR-002 | MVP | partial-wt | feat/cs-integration | 2.3-02 | A clinic's own Word/RTF letter templates are filled in their own layout using ClinForms' … |
| K2-LTR-003 | MVP | done | feat/cs-comms | 2.3-01 | Recipient: the patient, their GP, the case's payer or referrer, or a typed recipient |
| K2-LTR-004 | MVP | done | feat/cs-comms | – | A letter cannot be finalised while it contains "[not recorded: …]" or "[[…]]" gaps |
| K2-LTR-005 | MVP | missing | feat/cs-comms | 2.3-05 | Output: PDF (and Word for Word templates), filed on the patient record, optionally … |
| K2-LTR-006 | MVP | partial | feat/cs-records | 2.3-04 | Discharge summary letter from the discharge note |
| K2-LTR-007 | MVP | missing | feat/cs-integration | – | One merge-field engine for letters and ClinForms (reconcile comms `merge-fields.ts` and … |
| K2-FORM-001 | MVP | done | feat/cs-portal | 2.2-21 | Starter new-patient intake and consent forms (written for the product) and clinic copies |
| K2-FORM-002 | MVP | partial | feat/cs-portal | 2.2-21 | Staff send a form link to a patient (e.g |
| K2-FORM-003 | MVP | done | feat/cs-portal | 2.2-21 | Typed e-signature; answers and typed name encrypted; the copy is sealed by a trigger once … |
| K2-FORM-004 | MVP | partial | feat/cs-portal | 2.2-21 | Verified vs unverified submissions: consent recorded on the record only when verified; … |
| K2-FORM-005 | MVP | partial | feat/cs-portal | – | Health answers visible to clinicians only |
| K2-FORM-006 | MVP | missing | feat/cs-portal | 2.3-05 | Forms tab on the patient record (`/app/clinic/patients/[patientId]/forms`) and intake … |
| K2-FORM-007 | Later | missing | feat/cs-portal | 2.2-22 | Form builder with field-to-record mapping, file uploads, clinic-tablet mode |
| K2-PORTAL-001 | MVP | partial | feat/cs-portal | 2.1-31 | Magic-link sign-in; patient accounts separate from staff accounts; secrets stored as … |
| K2-PORTAL-002 | MVP | partial | feat/cs-portal | 2.1-30, 2.1-29 | Portal shows upcoming appointments with cancel/rebook within policy |
| K2-PORTAL-003 | MVP | partial | feat/cs-portal | 2.1-30 | Forms to complete |
| K2-PORTAL-004 | MVP | partial | feat/cs-portal | 2.1-30 | Documents explicitly shared by staff (letters, exercise sheets); no clinical notes unless … |
| K2-PORTAL-005 | MVP | done | feat/cs-portal | – | Strict tenant and patient scoping; a patient can never reach another patient's or … |
| K2-PORTAL-006 | MVP | partial | feat/cs-portal | 2.1-32 | Works as mobile web at 375 px |
| K2-PORTAL-007 | Later | missing | feat/cs-portal | 2.1-30 | View and pay invoices in the portal |
| K2-COMMS-001 | MVP | done | feat/cs-comms | 2.5-04 | Message templates with merge fields; appointment messages never carry clinical detail |
| K2-COMMS-002 | MVP | partial | feat/cs-comms | 2.5-01 | Booking, change and cancellation confirmations triggered by diary changes … |
| K2-COMMS-003 | MVP | partial-wt | feat/cs-comms | 2.5-02 | Reminder rules (e.g |
| K2-COMMS-004 | MVP | done | feat/cs-comms | 2.5-03 | Providers behind interfaces (`CLINIC_SMS_PROVIDER`, `CLINIC_EMAIL_PROVIDER`), default … |
| K2-COMMS-005 | MVP | missing | feat/cs-comms | 2.5-03 | Live email adapter (MailerSend; domain `clinforms.co.uk` DNS authorised 24 Oct; … |
| K2-COMMS-006 | MVP | missing | feat/cs-comms | 2.5-03 | Live SMS adapter (candidate MailerSend SMS/WhatsApp – check UK coverage, alphanumeric … |
| K2-COMMS-007 | MVP | done | feat/cs-comms | 2.5-03 | SMS segment counting (GSM-7/UCS-2) shown before sending |
| K2-COMMS-008 | Later | partial-wt | feat/cs-comms | 2.5-05 | Two-way SMS: YES/NO/STOP replies via a provider webhook confirm or cancel the appointment |
| K2-COMMS-009 | MVP | partial-wt | feat/cs-comms | 2.5-07, 2.2-02 | PECR: marketing only with recorded opt-in; signed unsubscribe links; consent events log |
| K2-COMMS-010 | MVP | partial | feat/cs-comms | 2.5-08, 2.3-05 | Message log per patient (record tab) and an outbox screen (`/app/clinic/messages`) |
| K2-COMMS-011 | MVP | partial | feat/cs-comms | 2.5-06 | One-off message from a record or an appointment |
| K2-COMMS-012 | Later | missing | feat/cs-comms | 2.5-09, 2.5-10, 2.5-11, 2.5-12, 2.5-13 | Bulk messages, recalls, automations, multi-step journeys, feedback surveys |
| K2-BILL-001 | MVP | done | feat/cs-billing | 2.4-01, 2.1-15 | Invoice from attended appointments (and DNA/late-cancellation charges), priced from the … |
| K2-BILL-002 | MVP | done | feat/cs-billing | 2.4-03 | Bill-to self-pay, insurer on account, medico-legal company/solicitor on account, … |
| K2-BILL-003 | MVP | done | feat/cs-billing | 2.4-04 | Insurance excess/shortfall split between patient and payer on the same visits |
| K2-BILL-004 | MVP | done | feat/cs-billing | 2.4-05 | Price per payer (price lists per service and payer) |
| K2-BILL-005 | MVP | done | feat/cs-billing | 2.4-02 | VAT per line (exempt default for physio treatment; standard/reduced/zero), prices … |
| K2-BILL-006 | MVP | done | feat/cs-billing | 2.4-01 | Gap-free sequential numbers per clinic with prefix, at most 10 characters (insurer … |
| K2-BILL-007 | MVP | done | feat/cs-billing | 2.4-01 | Invoice states draft → issued → part paid/paid, cancel (draft) and void via credit note; … |
| K2-BILL-008 | MVP | done | feat/cs-billing | 2.4-06 | Credit notes with proportional VAT; release the appointments; give authorisation usage … |
| K2-BILL-009 | MVP | done | feat/cs-billing | 2.4-08 | Statements per patient and per payer account, as PDF |
| K2-BILL-010 | MVP | done | feat/cs-billing | 2.4-09, 2.6-05 | Debtors and aged debt (by payer and patient, age bands) |
| K2-BILL-011 | MVP | done | feat/cs-billing | 2.4-14 | Insurer claims export (CSV, logged) with codes and pre-authorisation number; the … |
| K2-BILL-012 | MVP | done | feat/cs-billing | 2.4-19 | Accounts CSV exports with a formula-injection guard |
| K2-BILL-013 | MVP | partial | feat/cs-billing | 2.4-01 | Billing screens: invoice list, draft from appointments, issue, credit, payments, … |
| K2-BILL-014 | Later | missing | feat/cs-billing | 2.4-14 | Healthcode e-billing (registration is per practice system; 2–6 months) |
| K2-BILL-015 | Later | partial | feat/cs-billing | 2.4-06, 2.4-10 | Discounts, write-offs and debt chasing |
| K2-BILL-016 | Later | missing | feat/cs-billing | 2.4-19, 2.4-20 | Ledger codes, period lock, accounting-software sync |
| K2-AUTHS-001 | MVP | done | feat/clinic-system | 2.2-08 | Authorisation per case: insurer/MLC code, sessions and/or value, valid from/to, encrypted … |
| K2-AUTHS-002 | MVP | done | feat/clinic-system | 2.2-08 | Usage recorded atomically, never over the limit or below zero; diary (attended) and … |
| K2-AUTHS-003 | MVP | partial | feat/cs-diary | 2.2-08 | Booking or attending beyond the remaining sessions or after expiry shows a warning … |
| K2-AUTHS-004 | MVP | partial-wt | feat/cs-reporting | 2.2-09 | Expiring authorisations list (by date and by sessions left) |
| K2-AUTHS-005 | MVP | partial | feat/cs-records | 2.2-08 | Authorisation screens on the case page (add, edit, remaining) |
| K2-AUTHS-006 | Later | missing | feat/cs-comms | – | Extension request letter to the payer from a template |
| K2-PAY-001 | MVP | done | feat/cs-billing | 2.4-07 | Record payments by hand (cash, card on an outside terminal, bank transfer, other) and … |
| K2-PAY-002 | MVP | done | feat/cs-billing | 2.4-06 | Refunds, reversals and removal of a mistaken payment, audited |
| K2-PAY-003 | MVP | done | feat/cs-billing | 2.4-07 | Insurer remittance: one payment allocated across many invoices of one payer, matched by … |
| K2-PAY-004 | MVP | done | feat/cs-billing | 2.4-11 | Payment provider interface (`CLINIC_PAYMENTS_PROVIDER`): manual default; `stripe_test` … |
| K2-PAY-005 | Later | partial | feat/cs-billing | 2.4-11 | Payment links (single payment, nothing clinical) recorded once by provider reference |
| K2-PAY-006 | Later | partial | feat/cs-billing | 2.4-12, 2.4-13 | Card terminals, saved cards, automatic fees, deposits |
| K2-REP-001 | MVP | partial-wt | feat/cs-reporting | 2.6-01 | Dashboard: today's appointments, utilisation, DNA rate, revenue, outstanding, expiring … |
| K2-REP-002 | MVP | partial-wt | feat/cs-reporting | 2.6-02 | Utilisation by practitioner, site and room for a period |
| K2-REP-003 | MVP | partial-wt | feat/cs-reporting | 2.6-03 | DNA and late-cancellation rates by practitioner and site |
| K2-REP-004 | MVP | partial-wt | feat/cs-reporting | 2.6-04 | New vs returning patients |
| K2-REP-005 | MVP | partial-wt | feat/cs-reporting | 2.6-05 | Revenue (invoiced, paid) and outstanding debt by payer type |
| K2-REP-006 | MVP | partial-wt | feat/cs-reporting | 2.6-06 | Caseload and a fixed report library with CSV export of every report (`reports.export`, … |
| K2-REP-007 | Later | missing | feat/cs-reporting | 2.6-07, 2.6-08, 2.6-09 | Clinical reports, outcome exports (national datasets), custom reports |
| K2-IMP-001 | MVP | partial-wt | feat/cs-integration | 2.8-01 | CSV import of patients, cases (payer, referrer), appointments (past and future) and … |
| K2-IMP-002 | MVP | partial-wt | feat/cs-integration | 2.8-01 | Column mapping step (any header naming), saved per clinic; template headers downloadable |
| K2-IMP-003 | MVP | partial-wt | feat/cs-integration | 2.8-01 | Dry run ("check") with row-level issues; nothing written |
| K2-IMP-004 | MVP | partial-wt | feat/cs-integration | 2.8-01 | Run in batches of ≤ 40 rows, one audit row per batch; `import_ref` unique per clinic so a … |
| K2-IMP-005 | MVP | partial-wt | feat/cs-integration | 2.8-01 | Undo a batch while nothing depends on it (`undoBlocker`) |
| K2-IMP-006 | MVP | missing | feat/cs-integration | 2.8-01 | Import screens `/app/clinic/import/**` (permission `import.run`) |
| K2-IMP-007 | MVP | missing | feat/cs-integration | 2.8-01 | Treatment authorisations import (code, sessions/value used and remaining, dates) |
| K2-IMP-008 | MVP | missing | feat/cs-integration | 2.8-01 | Reconciliation report per import: counts per kind, open balance per payer and patient, … |
| K2-IMP-009 | MVP | missing | feat/cs-integration | 2.8-02 | Historic clinical notes and documents stay accessible for the retention period: imported … |
| K2-IMP-010 | MVP | missing | – | 2.8-01 | Formats are confirmed from Dell's real exit export only after the solicitor's advice and … |
| K2-CF-001 | MVP | missing | feat/cs-integration | 2.3-03 | Native connector `src/server/pms/native-connector.ts` implementing medreport's connector … |
| K2-CF-002 | MVP | partial-wt | feat/cs-integration | 2.3-03 | The connector sends registration, referral, payer and consent from the shared record, and … |
| K2-CF-003 | MVP | missing | feat/cs-integration | 2.3-03 | "Complete referrer form" on a case opens the existing ClinForms flow with the case's data … |
| K2-CF-004 | MVP | partial-wt | feat/cs-integration | 2.3-05, 2.3-03 | The approved form is filed back to the patient record and listed there; form requests are … |
| K2-CF-005 | MVP | done | feat/clinic-system | – | `medreport` never imports `pms`; `pms` imports only medreport's connector types … |
| K2-CF-006 | MVP | missing | feat/cs-integration | – | A report completed through the native connector counts against the clinic's Reports … |
| K2-ADM-001 | MVP | partial-wt | feat/cs-reporting | 2.6-10 | Set-up screens (`/app/clinic/setup/**`): sites (and rooms, opening hours, closures), … |
| K2-ADM-002 | MVP | partial-wt | feat/cs-reporting | 2.6-11, 2.6-12 | Staff: members (existing ClinForms invitations), role, link to a practitioner, site limits |
| K2-ADM-003 | MVP | done | feat/clinic-system | 2.6-11 | Fixed permission matrix (§2) |
| K2-ADM-004 | MVP | done | feat/clinic-system | 2.7-01 | Two-step sign-in required for every staff user (existing ClinForms) |
| K2-ADM-005 | MVP | partial | feat/cs-billing | 2.4-02 | Billing settings (VAT registration and number, number prefix, payment terms, bank details) |
| K2-ADM-006 | MVP | partial | feat/cs-comms | 2.5-02 | Comms settings (sender name, reminder rules, quiet hours, templates) |
| K2-ADM-007 | Later | missing | feat/clinic-system | 2.7-02 | SSO and IP allow-list |
| K2-ADM-008 | Later | missing | feat/cs-reporting | 2.6-14 | Tasks and teams |
| K2-AUD-001 | MVP | done | feat/clinic-system | 2.6-13 | Every write is audited through the repositories in the same atomic batch; codes … |
| K2-AUD-002 | MVP | done | feat/clinic-system | 2.6-13 | "Clinic system" filter group on `/app/settings/activity` with CSV, only for clinics with … |
| K2-AUD-003 | MVP | partial-wt | feat/cs-reporting | 2.6-13 | Audit search by user, patient, action, record type and date |
| K2-AUD-004 | MVP | done | feat/clinic-system | – | Platform actions on a clinic (package changes) appear in the clinic's own trail as … |
| K2-AUD-005 | Later | missing | feat/cs-records | 2.6-13 | Record views (who opened a patient's clinical notes) are logged |
| K2-NFR-001 | MVP | done | feat/clinic-system | – | Every page/layout under `/app/clinic` calls `requireClinicActor` first; every action … |
| K2-NFR-002 | MVP | done | feat/clinic-system | – | Writes same-origin only; JSON errors; `no-store` |
| K2-NFR-003 | MVP | partial | feat/cs-portal | – | Public endpoints rate-limited (`hitRateLimit`), `noindex`, bot check ready |
| K2-NFR-004 | MVP | partial | feat/cs-records | 2.2-20 | Uploads: magic-byte type check, size limits, never executed or rendered inline |
| K2-NFR-005 | MVP | partial | feat/cs-billing | – | Every CSV export guards against formula injection (billing done; reporting and import to … |
| K2-NFR-006 | MVP | missing | – | – | No patient data in logs, analytics (PostHog), error messages or URLs |
| K2-NFR-007 | MVP | missing | – | – | Independent penetration test and retest of K2 before real patient data |
| K2-NFR-008 | MVP | missing | – | – | Content Security Policy enforced (today Report-Only on `main`) |
| K2-NFR-010 | MVP | missing | – | – | Clinic = controller, AppstackX Ltd = processor; Article 28 DPA covering K2 with its … |
| K2-NFR-011 | MVP | missing | – | – | DPIA covering K2 (names visible in the diary all day, plain demographics, reminders, … |
| K2-NFR-012 | MVP | partial | feat/cs-records | 2.7-04 | Subject access answered within one month using K2-PAT-009 |
| K2-NFR-013 | MVP | done | feat/cs-records | 2.2-17 | Rectification through amendments; erasure limited by the retention rule (records not … |
| K2-NFR-014 | MVP | done | feat/cs-comms | 2.5-07 | Data minimisation in messages; PECR consent for marketing |
| K2-NFR-020 | MVP | done | feat/clinic-system | 2.7-06 | Adults: 8 years after the last treatment; children: until their 25th birthday (26th if 17 … |
| K2-NFR-021 | MVP | done | feat/clinic-system | 2.7-06 | No code or scheduled job deletes clinical records; archive or anonymise after the review … |
| K2-NFR-022 | MVP | missing | – | 2.7-06 | ClinForms' daily retention cron (`/api/cron/retention`, 30-day report retention) never … |
| K2-NFR-023 | MVP | done | feat/clinic-system | – | Offboarding = verified decrypted export, then delete (K2-PLT-011) |
| K2-NFR-030 | MVP | done | feat/clinic-system | 2.7-03 | Clinical free text, files and sensitive fields encrypted with the per-clinic AES-GCM … |
| K2-NFR-031 | MVP | done | feat/clinic-system | 2.7-03 | Lists never decrypt; decrypt only in get-by-id |
| K2-NFR-032 | MVP | done | feat/clinic-system | – | TLS everywhere, HSTS (existing) |
| K2-NFR-033 | MVP | missing | – | 2.7-03 | Key rotation and the offline key check (`docs/go-live.md` §7.6) cover K2 data |
| K2-NFR-040 | MVP | partial | feat/clinic-system | – | Tenant scope proven per module: two clinics, no cross-clinic read/write, cross-clinic … |
| K2-NFR-041 | MVP | done | feat/clinic-system | – | Postgres: RLS enabled and `anon`/`authenticated` revoked on every table |
| K2-NFR-050 | MVP | partial | – | 2.7-11 | WCAG 2.2 AA: labels, errors in `role="alert"`, visible focus, keyboard for everything … |
| K2-NFR-060 | MVP | missing | feat/cs-diary | – | With 50,000 appointments and 20,000 patients: diary day view for a site (10 … |
| K2-NFR-061 | MVP | done | feat/clinic-system | – | D1 limits respected: ≤ 100 parameters (`IN` lists of 90), list limits ≤ 500, keyset … |
| K2-NFR-070 | MVP | missing | – | 2.7-09, 2.7-10 | Target 99.5 % in clinic hours (proposal: Mon–Sat 07:00–21:00 UK); public status page; … |
| K2-NFR-071 | MVP | missing | – | – | Releases outside clinic hours, through a staging/preview database first; migrations … |
| K2-NFR-080 | MVP | missing | – | 2.7-07 | Production K2 data in Postgres in London with point-in-time recovery, a nightly encrypted … |
| K2-NFR-081 | MVP | missing | – | 2.7-07 | Commercial hosting plans (Vercel Pro – Hobby is non-commercial; Workers Paid) |
| K2-NFR-090 | MVP | missing | – | – | ClinForms unchanged for clinics without the package: full check chain green and … |
| K2-NFR-091 | MVP | done | feat/clinic-system | – | Both dialects in parity (columns, keys, FKs, indexes) |
| K2-NFR-092 | MVP | missing | – | – | The data-gateway Worker's statement allowlist covers every K2 statement before a D1 deploy |
| K2-NFR-093 | MVP | done | feat/clinic-system | – | UK English, neutral, no "AI"/vendor/model names on screen; product name only through … |

### 13.2 Feature-comparison row → requirements

Every one of the 129 rows maps to at least one requirement or to §12 (out of scope).

| FC row | Feature | Requirements / scope |
|---|---|---|
| 2.1-01 | Multi-site diary | K2-SITE-001, K2-SITE-002, K2-SITE-005, K2-SITE-006 |
| 2.1-02 | Day view, several practitioners side by side | K2-DIARY-003 |
| 2.1-03 | Week view across several practitioners or rooms | K2-DIARY-004, K2-DIARY-005 |
| 2.1-04 | Room diary | K2-SITE-001, K2-DIARY-003, K2-DIARY-006 |
| 2.1-05 | Equipment / other resources | K2-DIARY-019 |
| 2.1-06 | Double-booking prevention (practitioner and room) | K2-DIARY-006, K2-BOOK-003 |
| 2.1-07 | Practitioner working times / rotas per site | K2-DIARY-002 |
| 2.1-08 | Diary block-outs (meeting, holiday, other) | K2-DIARY-012 |
| 2.1-09 | Skills / specialisms | K2-DIARY-020 |
| 2.1-10 | Appointment types / services | K2-DIARY-001 |
| 2.1-11 | Reception books from a slot | K2-DIARY-007 |
| 2.1-12 | Recurring appointments | K2-DIARY-008 |
| 2.1-13 | Move / reschedule | K2-DIARY-009 |
| 2.1-14 | Appointment statuses and info icons | K2-DIARY-010 |
| 2.1-15 | Cancellations, late-cancel and DNA fees | K2-DIARY-010, K2-BILL-001 |
| 2.1-16 | Waiting list | K2-DIARY-013 |
| 2.1-17 | Two users editing the same appointment | K2-DIARY-014 |
| 2.1-18 | Quick patient search | K2-DIARY-016, K2-PAT-001 |
| 2.1-19 | List view with bulk actions | K2-DIARY-021 |
| 2.1-20 | Print the diary | K2-DIARY-017 |
| 2.1-21 | Calendar sync (Google / Apple / Outlook) | K2-DIARY-022 |
| 2.1-22 | Group classes and courses | out of scope (§12) |
| 2.1-23 | Video appointments | out of scope (§12) |
| 2.1-24 | Online booking page | K2-BOOK-001, K2-BOOK-003 |
| 2.1-25 | Online booking rules | K2-BOOK-002, K2-BOOK-007 |
| 2.1-26 | Pay or leave a deposit when booking online | K2-BOOK-008 |
| 2.1-27 | Forms, add-ons and companion bookings while booking | K2-BOOK-010 |
| 2.1-28 | Insured patients booking online | K2-BOOK-009 |
| 2.1-29 | Patient cancels or rebooks online | K2-BOOK-005, K2-PORTAL-002 |
| 2.1-30 | Patient portal contents | K2-PORTAL-002, K2-PORTAL-003, K2-PORTAL-004, K2-PORTAL-007 |
| 2.1-31 | Patient sign-in | K2-PORTAL-001 |
| 2.1-32 | Patient "app" | K2-PORTAL-006 |
| 2.1-33 | Third-party booking (networks, outsourced reception) | out of scope (§12) |
| 2.2-01 | Demographics and contacts | K2-PLT-009, K2-PAT-001, K2-PAT-002 |
| 2.2-02 | Consent and marketing preferences | K2-PAT-002, K2-COMMS-009 |
| 2.2-03 | Patient status (current, non-current, deceased) | K2-PAT-006 |
| 2.2-04 | Alerts and clinical flags | K2-PAT-005, K2-PAT-014 |
| 2.2-05 | Tags | K2-PAT-013 |
| 2.2-06 | Merging duplicate patients | K2-PAT-012 |
| 2.2-07 | Cases / episodes | K2-PAT-004 |
| 2.2-08 | Treatment authorisations | K2-DIARY-011, K2-AUTHS-001, K2-AUTHS-002, K2-AUTHS-003, K2-AUTHS-005 |
| 2.2-09 | Warning before authorisations expire | K2-AUTHS-004 |
| 2.2-10 | Referrers directory | K2-PAT-011 |
| 2.2-11 | Clinical note templates | K2-NOTE-001, K2-NOTE-002 |
| 2.2-12 | Note-writing aids | K2-NOTE-010 |
| 2.2-13 | Medical history across cases | K2-NOTE-010 |
| 2.2-14 | Body chart | K2-NOTE-005 |
| 2.2-15 | Outcome measures | K2-NOTE-006 |
| 2.2-16 | Goals | K2-NOTE-010 |
| 2.2-17 | Sign, lock and amend | K2-NOTE-003, K2-NOTE-004, K2-NFR-013 |
| 2.2-18 | Incomplete-notes warning | K2-NOTE-008 |
| 2.2-19 | Restrict a case to its own practitioner | K2-NOTE-011 |
| 2.2-20 | Attachments | K2-PAT-007, K2-NFR-004 |
| 2.2-21 | Intake and consent forms | K2-FORM-001, K2-FORM-002, K2-FORM-003, K2-FORM-004 |
| 2.2-22 | Forms on a clinic tablet | K2-FORM-007 |
| 2.2-23 | Writing notes on a phone | K2-NOTE-009 |
| 2.3-01 | Letter templates with merge fields | K2-LTR-001, K2-LTR-003 |
| 2.3-02 | Use uploaded Word/RTF/PDF forms and templates in their own layout | K2-LTR-002 |
| 2.3-03 | Complete each referrer's own report form (MLC, insurer, solicitor) from the course of treatment | K2-CF-001, K2-CF-002, K2-CF-003, K2-CF-004 |
| 2.3-04 | Discharge summary | K2-NOTE-001, K2-LTR-006 |
| 2.3-05 | Correspondence history | K2-LTR-005, K2-FORM-006, K2-COMMS-010, K2-CF-004 |
| 2.3-06 | Reports to referral networks (Pronto) | out of scope (§12) |
| 2.4-01 | Invoices from appointments | K2-BILL-001, K2-BILL-006, K2-BILL-007, K2-BILL-013 |
| 2.4-02 | VAT | K2-BILL-005, K2-ADM-005 |
| 2.4-03 | Insurer / MLC / solicitor accounts | K2-BILL-002 |
| 2.4-04 | Excess / shortfall | K2-BILL-003 |
| 2.4-05 | Price per payer | K2-BILL-004 |
| 2.4-06 | Credit notes, discounts, write-offs, refunds | K2-BILL-008, K2-BILL-015, K2-PAY-002 |
| 2.4-07 | Record and allocate payments | K2-PAY-001, K2-PAY-003 |
| 2.4-08 | Statements | K2-BILL-009 |
| 2.4-09 | Aged debt | K2-BILL-010 |
| 2.4-10 | Chasing unpaid invoices | K2-BILL-015 |
| 2.4-11 | Online payment links | K2-PAY-004, K2-PAY-005 |
| 2.4-12 | Card terminals and virtual terminal | K2-PAY-006 |
| 2.4-13 | Saved cards, fees charged automatically, deposits | K2-PAY-006 |
| 2.4-14 | Healthcode insurer e-billing | K2-BILL-011, K2-BILL-014 |
| 2.4-15 | Packages, subscriptions, memberships | out of scope (§12) |
| 2.4-16 | Gift vouchers, discount codes | out of scope (§12) |
| 2.4-17 | Stock and retail | out of scope (§12) |
| 2.4-18 | Expenditure | out of scope (§12) |
| 2.4-19 | Accounts export and ledger codes | K2-BILL-012, K2-BILL-016 |
| 2.4-20 | Xero | K2-BILL-016 |
| 2.4-21 | Class (group) invoicing | out of scope (§12) |
| 2.5-01 | Booking and cancellation confirmations | K2-BOOK-004, K2-COMMS-002 |
| 2.5-02 | Scheduled reminders | K2-COMMS-003, K2-ADM-006 |
| 2.5-03 | Messages actually reaching patients | K2-COMMS-004, K2-COMMS-005, K2-COMMS-006, K2-COMMS-007 |
| 2.5-04 | Templates and merge fields | K2-COMMS-001 |
| 2.5-05 | Two-way SMS (confirm or cancel by reply) | K2-COMMS-008 |
| 2.5-06 | One-off messages from an appointment or record | K2-COMMS-011 |
| 2.5-07 | Consent and opt-out | K2-COMMS-009, K2-NFR-014 |
| 2.5-08 | Message log per patient | K2-COMMS-010 |
| 2.5-09 | Bulk messages and smart lists | K2-COMMS-012 |
| 2.5-10 | Automatic recall | K2-COMMS-012 |
| 2.5-11 | Automations | K2-COMMS-012 |
| 2.5-12 | Journeys (multi-step workflows) | K2-COMMS-012 |
| 2.5-13 | NPS / feedback surveys | K2-COMMS-012 |
| 2.6-01 | Dashboard | K2-REP-001 |
| 2.6-02 | Utilisation | K2-REP-002 |
| 2.6-03 | DNA and late-cancel rates | K2-REP-003 |
| 2.6-04 | New vs returning patients | K2-REP-004 |
| 2.6-05 | Revenue and outstanding debt | K2-BILL-010, K2-REP-005 |
| 2.6-06 | Standard report library | K2-REP-006 |
| 2.6-07 | Clinical reports | K2-REP-007 |
| 2.6-08 | Outcome exports (Physio First DFI, MSKPN) | K2-REP-007 |
| 2.6-09 | Custom and bespoke reports, data warehouse | K2-REP-007 |
| 2.6-10 | Settings: sites, rooms, services, prices, practitioners, opening hours | K2-SITE-003, K2-ADM-001 |
| 2.6-11 | Staff roles | K2-ADM-002, K2-ADM-003 |
| 2.6-12 | Staff limited to their own sites | K2-SITE-004, K2-ADM-002 |
| 2.6-13 | Audit search | K2-PAT-008, K2-AUD-001, K2-AUD-002, K2-AUD-003, K2-AUD-005 |
| 2.6-14 | Tasks and teams | K2-ADM-008 |
| 2.7-01 | Two-step sign-in for staff | K2-ADM-004 |
| 2.7-02 | SSO and IP allow-list | K2-ADM-007 |
| 2.7-03 | Encryption of clinical data | K2-NFR-030, K2-NFR-031, K2-NFR-033 |
| 2.7-04 | Subject access request | K2-PAT-009, K2-NFR-012 |
| 2.7-05 | Anonymise a patient | K2-PAT-010 |
| 2.7-06 | Retention of clinical records | K2-NFR-020, K2-NFR-021, K2-NFR-022 |
| 2.7-07 | Hosting and backups | K2-NFR-080, K2-NFR-081 |
| 2.7-08 | ISO 27001 / Cyber Essentials | out of scope (§12) |
| 2.7-09 | Status page and uptime | K2-NFR-070 |
| 2.7-10 | Support and SLA | K2-NFR-070 |
| 2.7-11 | Phones, tablets and accessibility | K2-NFR-050 |
| 2.8-01 | Import from TM3 | K2-IMP-001, K2-IMP-002, K2-IMP-003, K2-IMP-004, K2-IMP-005, K2-IMP-006, K2-IMP-007, K2-IMP-008, K2-IMP-010 |
| 2.8-02 | TM3 clinical notes (PDF) and documents | K2-IMP-009 |
| 2.8-03 | Exercise prescription | out of scope (§12) |
| 2.8-04 | Note-writing scribe | out of scope (§12) |
| 2.8-05 | Marketing tools (Mailchimp, HubSpot, Pipedrive) | out of scope (§12) |
| 2.8-06 | Booking analytics (GA4 / Tag Manager) | out of scope (§12) |
| 2.8-07 | Referral networks (Pronto) and referral portal | out of scope (§12) |
| 2.8-08 | Public API, data warehouse | out of scope (§12) |
<!-- TRACE:END -->
