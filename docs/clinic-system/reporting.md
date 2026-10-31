# Reporting and set-up module

Internal. The clinic system's reports, dashboard and Set-up pages (module `reporting`, migrations 0160–0169).

## Set-up

All Set-up pages live under `/app/clinic/setup/**` and appear in the shell's Set-up area ("← Clinic navigation /
Set-up", order in `src/components/pms/shell/nav-model.ts` `SETUP_ORDER`, entries in `src/modules/pms/nav/*.ts`).
`/app/clinic/setup` redirects to the first page the member may open.

| Page | Route | Permission | Writes (audit code) |
|---|---|---|---|
| Sites and hours (design round 2c) | `/setup/sites[?site=]` | settings.setup | site (`pms.site.*`), opening hours (`pms.opening_hours.set`), closures (`pms.closure.create/remove`) |
| Rooms | `/setup/rooms[?site=&room=]` | settings.setup | `pms.room.*` |
| Services | `/setup/services[?service=]` | settings.setup | `pms.service.*` |
| Price lists (incl. an insurer's own list) | `/setup/prices[?list=]` | settings.setup | price lists and items |
| Referrers and insurers + payer account | `/setup/referrers[?kind=&referrer=]` | settings.setup | `pms.referrer.*`, `pms.payer_terms.set` |
| Practitioners (link a member's sign-in, bookable, rota link) | `/setup/practitioners[?practitioner=]` | settings.setup | `pms.practitioner.*` |
| Record templates (note templates + retention, upward only) | `/setup/records` | settings.setup | `pms.settings.update` |
| Billing settings (VAT, prefixes, terms, charges, bank details) | `/setup/billing` | settings.setup | `pms.billing_settings.update` |
| Report targets (utilisation %, DNA %) | `/setup/targets` | settings.setup | `pms.report_targets.set` |
| Audit trail (search incl. by patient, CSV) | `/setup/audit` (+ `/export`) | settings.members (CSV: reports.export; patient search: patients.view) | `pms.audit.export` |
| Import data (placeholder, M9) | `/setup/import` | settings.import | – |

Moved under Set-up (built by other modules): Staff access and Roles and permissions (`/access`, settings.members),
Practitioner rotas (`/diary/rotas`, diary.rota – reception keeps it in the main list), Online booking and Intake
forms (`/online-booking`, `/intake`), Message settings (`/messages/settings`).

Rules (server layer `src/server/pms/reporting/setup.ts`): permission first; a site's own details, rooms, hours and
closures need that site in the member's site access (`actor.siteIds`); clinic-wide changes (new site, all-sites
closure, services, prices, payers, practitioners, templates, billing, targets) need every site; ids read back from
the clinic; zod; plain errors. Every write is audited in the same batch by the repositories.

### One opening-hours source

`pms_site_hours` / `pms_site_closures` (0160) are the only opening hours. `availabilityWindows`
(`src/server/repos/pms/diary/availability.ts`) clips every rota window to its site's sessions of that weekday and
drops windows on closure dates (the site's own or all-sites closures) – `src/modules/pms/reporting/opening.ts`.
Because the diary's shading and grid hours, `findFreeSlots`, the booking check ("outside working hours"), online
booking (portal → `findFreeSlots`, online-marked windows) and utilisation all read `availabilityWindows`, they all
follow the same hours. A site with **no** opening sessions is "not set" and is not limited (clinics before set-up
keep working); the form therefore refuses "closed every day" – switch the site off or add a closure instead. New
sites start with Mon–Fri 08:00–20:00, Sat 09:00–13:00 (`DEFAULT_SITE_HOURS`); the demo seed
(`scripts/pms/seed-setup.ts`) gives every demo site those hours and two all-sites closures (Christmas 25–28/12/2026,
New Year's Day 01/01/2027).

### Audit trail: search by patient (AUD-003)

Audit rows hold ids and codes only, never names. The "Patient" field (name, patient number or date of birth) is
resolved with the ORDINARY patient search (`searchPatients` – the patients' search keys, limited to the member's
sites, any status; `src/server/pms/reporting/audit-patients.ts`), at most 20 patients; the audit search then shows the
entries about those ids (`relatedIds` in `src/server/repos/pms/reporting/audit-search.ts`): the record itself
(`target_id`) or an entry whose detail names it as its patient (`"patientId":"…"`, LIKE with the wildcards escaped).
The screen lists the patients matched ("Entries about Megan Hart · patient no. 1"); nobody matching = no rows. Needs
"View patients" as well as settings.members; the CSV keeps the filter and its own audit row records only that a
patient was searched for (`patientSearch: true`), never the text. Entries about an appointment whose detail does not
name the patient are not found this way (search by record id).

### Bank details on invoices

Migration 0139 (billing) adds `pms_billing_settings.bank_details_json` (`{accountName, sortCode, accountNumber}`);
the invoice and statement "How to pay" lines print "Bank transfer: … · sort code … · account … · reference …".

## Reports

Design: round 2c "Reports" (`docs/clinic-system/design/…/Reports.dc.html`). Pages `/app/clinic/reports/<report>`
(`/app/clinic/reports` opens the first one the member may see); the shell's left navigation shows the Reports section
(APPOINTMENTS: Attendance and DNA, Utilisation, New and returning patients · CLINICAL: Caseload · FINANCE: Revenue,
Debtors, Authorisations, with "← Clinic navigation").

**Who sees what.** `reports.all` (owners, admins by default): every report, for the member's sites. `reports.own`
(clinicians by default): Attendance, Utilisation, New and returning patients and Caseload limited to the member's OWN linked practitioner (no linked
practitioner = an empty report saying so); finance reports need `reports.all`. Reception has neither. "Export CSV" needs
`reports.export` (owners by default). Sites come from the access module (`actor.siteIds`): a member limited to some
sites sees nothing of the others – a site asked for outside them is ignored – in the figures, the tables and the CSV.

**Where the figures come from.** The reports never read another module's tables. The diary
(`src/server/pms/diary/reporting-source.ts`) and billing (`src/server/pms/billing/reporting-source.ts`) each answer
AGGREGATED facts (`src/modules/pms/reporting/facts.ts`) – GROUP BY UK date, site, room, practitioner, appointment type,
outcome / payer type – with tenant_id in every statement and the site filter in SQL. The reports then CHECK every fact
(`src/modules/pms/reporting/fact-checks.ts`: date inside the period, a known site inside the requested sites, the
practitioner asked for, sane counts) and leave out – and log – anything else, so a faulty source cannot show another
site's figures. Server layer: `src/server/pms/reporting/service.ts` (permission first, then a `ReportView`: stat cards,
chart, tables and the CSV rows of the same figures); loaders in `reports.ts`; dashboard figures for today in `today.ts`.

**Definitions (shown on screen).**
- Attendance: booked = attended + did not attend + late cancellations (cancelled in good time freed the slot and is left
  out). Arrived and in treatment (arrived + `treatment_started_at`) count as attended; "Completed" on screen = attended.
  Past appointments still marked booked are "not recorded" (shown as a count, out of the rates). Blocked time never
  counts. DNA target from Set-up → Report targets (default 4.0 %); a darker bar = a week above it.
- Utilisation: booked minutes ÷ available minutes, per practitioner, UK date and site, worked out by the diary's
  source (`availabilityFacts`, `src/modules/pms/reporting/intervals.ts` `dayUtilisation`):
  available = (rota windows from `availabilityWindows`, i.e. clipped to the sites' opening hours and closures ∪ the
  time actually booked) − the practitioner's blocked time (every block kind: leave, meeting, training, admin, closed,
  other – at any site; cancelled blocks out); booked = bookings that held their slot (incl. DNA and late
  cancellations – they used the time; cancelled in good time out) − blocked time, overlaps counted once. A booking
  outside the rota or the hours (e.g. the hours were changed after it was booked – M8's "Bletchley 275 %") counts as
  available time too, so a figure can never pass 100 %. The facts carry `bookedMinutes` / `blockedMinutes` (fact
  checks refuse booked > available); the stat card "Available hours" says how many hours of leave and blocked time
  were taken off. The report, its By-site table and the dashboard's "Utilisation today" tile all use these figures.
  Target from Report targets (default 80 %). (The room-time figures `utilisationBySite`/`ByRoom` – opening hours ×
  rooms – are not shown on any screen.)
- New and returning patients (REP-004, `/reports/patients`): from attended appointments (arrived / in treatment /
  completed). A new patient = their FIRST attended appointment ever (any site, any practitioner) is in the period; it
  counts for the practitioner and site of that appointment (diary source `visitFacts`: attended appointments by date,
  site, practitioner and "first visit"). Patients seen = different patients attended in the period (`attendedPatients`);
  returning = seen − new (with a practitioner or site filter: first seen before, or elsewhere). Stat cards (patients
  seen, new, returning), chart "New patients by week", tables by week / practitioner / site (attended, new, returning
  visits, new share), CSV `group,name,patients_seen,attended,new_patients,returning_visits,new_share_percent` (no
  names). The record-based mix (`loadPatients`, by cases) is kept for when the diary is not in use.
- Caseload: open cases now; opened and closed in the period; a case belongs to its site and practitioner.
- Revenue: issued invoices by issue date (void invoices and drafts out); credit notes by date (the void kind out);
  received = recorded payments less refunds by date received (reversed payments out). Patients = invoices addressed to
  the patient (incl. excesses and fees); insurers = invoices to an account.
- Debtors: owed today on issued invoices, aged from the due date (else the issue date) in billing's own bands (not yet
  due, 1–30, 31–60, 61–90, over 90) – the totals equal Billing → Aged debt.
- Authorisations: active authorisations with a session limit by sessions left; "to act on" = expiring within 30 days,
  expired in the last 30, used up, or one session / little value left.

**Filters.** Period chips This week / Last 6 weeks (default) / This quarter / Custom (dates), the site (the shell's
chosen site preselects; "Sites: all N" = every site of the member), practitioner (attendance, utilisation, caseload) and
appointment type (attendance). Everything is in the address, so the CSV link reproduces the view.

**CSV.** `GET /app/clinic/reports/export/<report>?…` – the same view's rows, UTF-8 with BOM, formula cells defused
(`'=`), audited as `pms.report.export` (report id, row count, whether filtered – no names).

**Tests.** `src/modules/pms/reporting/reporting.test.ts` (intervals, `dayUtilisation`, fact checks);
`src/server/pms/reporting/testing/reports-suite.ts` also checks the out-of-hours and leave cases (a meeting inside
the rota, a booking outside it, a day of leave, then the site's hours cut to one hour: 100 %, not more), the new and
returning report (weeks, practitioners, sites, own caseload, site limit, CSV) and the audit search by patient name
(site limit, permission); `reporting-suite.ts` the repository's `relatedIds`. The suite seeds a small fictional clinic (every appointment
status, a rota and a closure, cases, authorisations, issued / void / draft invoices, credit notes, payments, a refund and
a reversed payment) and asserts every report's figures equal the hand-worked values and billing's aged debt, the
site-limit rule, own caseload, reception refused, CSV and audit – on SQLite, PGlite (`reports-service.test.ts`), the D1
stand-in and local workerd D1 (`workers/data-gateway/test/pms-reporting-stack.test.ts`).

## Today (the dashboard)

`/app/clinic` is "Today" per role (design round 3 – `docs/clinic-system/design/round3/setup-reports-dashboard/`):
`src/server/pms/reporting/dashboard.ts` (view model in `src/modules/pms/reporting/dashboard.ts`, client
`src/components/pms/reporting/dashboard.tsx`, refreshes every minute). It reads the modules' own functions within the
member's sites and permissions; each tile is read on its own and says "Couldn't load" without hiding the rest.

| Role | Figures | Cards |
|---|---|---|
| Owner / administrator | Appointments today (done = arrived, in treatment, completed; DNA; sites) · Utilisation today vs the target (`reports.all`; the Utilisation report's own figures) · Taken today by method (billing's figures) · Overdue invoices | Today by site (bars, dashed target), Failed messages (Retry – comms `failedMessagesSummaryFor`), Authorisations ending soon (≤ 1 session left or ending in 14 days; Request extension = a letter to the insurer), Overdue invoices (Payment link for patients, Send reminder = email the invoice) |
| Clinician | My appointments today · Unsigned notes · Outcome measures due (first visit of a case or every 4th session) · Open cases | My next patients, Unsigned notes (Open), Outcome measures due |
| Reception | Appointments today at the chosen site · Still to arrive · Invoices to raise · Replies to answer | Arrivals (Arrived, from 60 minutes before the start), Waiting list (Book), Invoices to raise, Replies to answer |

At 375 px the cards stack and the design's bottom tabs (Today, Diary, Patients, Messages) appear.

## Demo data for the reports

`npm run pms:seed-demo -- --fresh` (scripts/pms/seed-diary.ts, seed-billing.ts) adds, on the first run, a history
before this week: six ordinary past weeks plus two earlier weeks in which most patients had their first visit
(rota valid from the start of the history), 4–7 new patients a week among returning ones, completed / DNA / late
cancellations / cancellations (fees flagged), a team meeting each Wednesday and one practitioner's day of leave each
week, closure days skipped; six of this week's patients are kept new. Billing invoices each past week's chargeable
visits on its Friday (most patients pay at the desk that day, insurers three weeks later, the last four weeks still
open, one patient in eight owing). Deterministic and idempotent ("demo-hist-…" import references; a re-run adds
nothing), follows the test clock. "Attended, not invoiced" stays this week's: billing now reads the last 90 days a
week at a time from today backwards (`src/server/pms/billing/views.ts`), as one 90-day read capped at the 500 oldest
visits missed this week's once a clinic had history.

E2E: `scripts/e2e/pms-polish-reports.cjs` (seventh report + CSV, six-week figures, utilisation ≤ 100 % after cutting a
site's hours below today's bookings – report, by-site table, dashboard tile – audit search by patient name).

## Test clock (e2e only)

`src/modules/pms/core/clock.ts`: every clinic-system "now" (repositories' `ctx.now`, `ukToday()`, server code, seeds)
comes from `pmsNow()`. With `PMS_TEST_CLOCK=1 PMS_TEST_NOW=<ISO> PMS_TEST_NOW_SET_AT=<epoch ms>` it reads
`PMS_TEST_NOW + (real time − SET_AT)` – **only when `NODE_ENV !== "production"`**; Next.js inlines `NODE_ENV` in a
build, so the override is dead code there (`clock.test.ts`; the M8 check found no `PMS_TEST_NOW` in `.next/`). Sign-in,
two-step codes and sessions keep the real clock. The diary, Prototype A and Messages browser checks run on `next dev`
with the clock at 10:30 London so they pass at any hour.
