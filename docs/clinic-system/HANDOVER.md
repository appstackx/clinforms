# K2 clinic system – handover

> **Read §21 first (29/10/2026 – latest):** final check DONE – K2 is ready for production on `feat/clinic-system`
> **`332b2b8`**: full chain and every e2e green, ClinForms forms output identical to `main`, one go-live bug fixed
> (Turnstile widget/token, §21.3). Go-live steps that need Khuram: §21.7 and [`M11-RUNSHEET.md`](M11-RUNSHEET.md);
> decisions to confirm: §21.5.

> **Update 29/10/2026 (latest – read §19 first):** M9b polish DONE – waiting-list offers hold their slot, diary blocks
> at every height, closure notice, Send message from the drawer, message-sync sweep, share a document with the patient,
> form on a clinic device verified by staff, signed-copy PDF, Preview as patient, portal audit write ids, New and returning
> patients report, utilisation never over 100 %, audit search by patient name, demo seed history; merged into
> `feat/clinic-system` `842bb02` (after M9 `d2b3d59`). See §19.

> **Update 29/10/2026 (latest – read §18 first):** M9 integration DONE – native ClinForms connector + "Complete
> referrer form" (filed back to the case and Forms tab), import from the previous system under Set-up, letters Word/PDF +
> discharge letter + `{{latest_outcomes}}`, insurer claims screen; merged into `feat/clinic-system` `d2b3d59`.

> **Update 28/10/2026 (latest – read §17 first):** M8 set-up + reports + dashboard DONE – Set-up section (sites and
> hours = the one opening-hours source, rooms, services, prices, payers, practitioners linking, billing settings with bank
> details, targets, audit trail), six reports with CSV, "Today" per role, test clock for e2e; merged into
> `feat/clinic-system` `9b97f96`. Next: M9 integration (running in parallel – §18). See §17.

> **Update 28/10/2026 (latest – read §16 first):** M7 online booking + patient portal + intake forms + patient outcome
> questionnaires DONE – online bookings are diary appointments, the portal's emails go through comms, public pages
> under `/clinics/[clinic]`, staff set-up / builder / Forms tab; merged into `feat/clinic-system` `caa9b4d`. Next: M8
> set-up + reports + dashboard. See §16.

> **Update 28/10/2026 (latest – read §15 first):** M6 Messages DONE – back end reviewed, diary hook, Messages screens, letter editor, record Messages tab, billing emails, seed, e2e; merged into `feat/clinic-system` `d1f350b`. Next: M7 online booking + portal. See §15.

> **Update 28/10/2026 (latest – read §14 first):** M5 billing DONE – back end, screens, seed, e2e; merged into `feat/clinic-system` `0acf07c`. Next: M6 Messages. See §14.

> **Update 28/10/2026 (latest – read §13 first):** design received for every screen; design system, app shell, configurable permissions, patients/notes and diary SCREENS are built and merged on `feat/clinic-system` `c05be50`; Prototype A passes end to end. Next: billing (M5), running now. See §13.

> **Update 27/10/2026:** M3 merged – diary and records **back ends** are on `feat/clinic-system` `f54aff5` (no screens yet). See §12.

> **Update 26/10/2026 ~17:05 GMT:** M0 is DONE. The uncommitted work in every `clinforms-wt/cs-*` worktree was committed as-is ("WIP: save uncommitted K2 sprint work for handover", unreviewed) and all seven `feat/cs-*` branches plus `feat/clinic-system` are pushed to origin. Heads: cs-billing e0185da, cs-comms 4aa66a4, cs-diary 60c347c, cs-integration b7fd14d, cs-portal 23a9f0c, cs-records 0eeded6, cs-reporting dbb7bb0. Start from M1. Treat the WIP commits as drafts to review, not finished work.

**Internal.** Mon 26 Oct 2026. For the Claude Code account that picks K2 up cold. Read this, then
[`contract.md`](contract.md) (binding build rules), then [`requirements.md`](requirements.md) (what to build, with
status per requirement). Khuram decides everything; you propose, he approves anything big before you build it.

**K2** = Khuram's temporary internal name for the clinic management system that is to replace Blue Heart Clinics'
current practice system (11 physio sites, owner Dell Baines). In code: module `pms`, product name only through
`CLINIC_SYSTEM_NAME` in `src/lib/brand.ts` (placeholder "Clinic system"). Never write a competitor's name or a
nickname for it in code, copy or commit messages. Don't confuse K2 with **`k2`, the id of ClinForms' production
data key** (`CLINFORMS_DATA_KEY_ID`) – unrelated.

---

## 1. Where everything is

| What | Where |
|---|---|
| Repo | `/Users/khuram/Projects/Appstackx/clinforms` (GitHub `appstackx/clinforms`, private). **This main checkout stays on `main` – never switch branch, commit or run servers there** |
| K2 foundation branch | `feat/clinic-system` @ `8716fbf` (on `origin`), worktree `/Users/khuram/Projects/Appstackx/clinforms-wt/cs-base` (has `.env.local`, no `node_modules`) |
| Module branches | `feat/cs-{diary,records,billing,comms,portal,reporting,integration}` – **local only, not on `origin`**; worktrees `/Users/khuram/Projects/Appstackx/clinforms-wt/cs-<module>` (no `node_modules`; only `cs-integration` has `.env.local`) |
| This spec | branch `docs/k2-spec` (from `feat/clinic-system`), worktree `/Users/khuram/Projects/Appstackx/clinforms-wt/k2-spec`: `docs/clinic-system/{requirements,HANDOVER}.md` |
| Build contract | `docs/clinic-system/contract.md` (on `feat/clinic-system`) |
| Module code map | `src/modules/pms/README.md` |
| Strategy (internal) | `docs/strategy/all-in-one-pms-feasibility.md`, `docs/strategy/pms-reuse-and-packaging.md` (both on `feat/clinic-system` and `main`); `docs/strategy/tm3-feature-comparison.md` (on `main` only, commit `b8e478a`; names vendors – never send it out) |
| ClinForms production docs | `CLAUDE.md`, `docs/production-architecture.md`, `docs/database.md`, `docs/auth.md`, `docs/go-live.md` (read on `main`; `feat/clinic-system` has older copies plus the foundation's additions to `database.md`/`auth.md`) |
| Repo memory (other workstream keeps it current) | `memory/` on `main`; Khuram's notes: `/Users/khuram/.claude/projects/-Users-khuram-Projects-Appstackx/memory/clinforms-repo-memory-pack.md` |
| Ports for K2 work | **3180–3199 only**; stop every server you start. Brand host locally: `http://clinic.localhost:3180` |
| Playwright | `NODE_PATH=/Users/khuram/Projects/Appstackx/pigeon-web/node_modules node scripts/e2e/<script>.cjs` (model: `scripts/e2e/clinic-system-shell.cjs`); screenshots to `.e2e-out/` or a scratchpad |
| Secrets | `~/.config/appstackx/clinforms.secrets.env` and each checkout's `.env.local` – **names only** (`cut -d= -f1 <file>`); never print, copy into git or paste a value |
| Sprint workflow (stopped 24 Oct) | `/Users/khuram/.claude/projects/-Users-khuram-Projects-Appstackx-clinforms/b7653163-bb9e-4e0d-8520-80682f931a5b/workflows/scripts/clinic-system-sprint-wf_12ae1ae4-b57.js` (run `wf_12ae1ae4-b57`). Phases: Foundation → 7 parallel Modules → Integrate → Verify (security, QA, regression) → Fix → Demo. Use it for the module briefs only; **don't resume it** (another account, heavy usage) unless Khuram asks |

Repo commands you need (all from a K2 worktree, after `npm ci` there; `test:gateway` also needs
`(cd workers/data-gateway && npm ci)` once):

```bash
npm run test:pms                       # quick loop: src/modules/pms, src/server/{repos/,}pms, scripts/pms tests
npm run typecheck && npm run lint && npm run test:medreport && npm run test:db && npm run test:auth \
  && npm run test:site && npm run test:gateway && npm run build          # full chain (contract §8)
npm run medreport:eslint-boundary      # regenerate .eslintrc.json when the contract test says it is stale
npm run pms:seed-demo [-- --fresh]     # local SQLite demo clinic (contract §9)
npm run dev -- -p 3180                 # or: npm run build && PORT=3180 MEDREPORT_AI_MODE=demo npm run start
```

---

## 2. Rules that must not be broken

From ClinForms (`CLAUDE.md`):
1. **`main` = production.** Every push to `main` deploys clinforms.co.uk (real clinics, incl. Blue Heart's trial).
   Never push, merge into or rebase `main`; never deploy; never run a script with `--env production` or `--env
   preview` that writes, and never write to a production or preview database.
2. **Fictional data only.** Organisations end "(fictional)", clinicians `PH-DEMO-0N`, patients `sim-pat-NNN`, phones
   `07700 900xxx` / `01632 960xxx`, email `@example.com`. No real patient data until the DPA, DPIA and gate A
   (requirements §10).
3. **No secrets in git** (`.env.local` is gitignored), **never commit `demo-assets/`** (third-party insurer forms).
   Scan every staged diff before committing (e.g. `git diff --cached | grep -nE "sk-ant-|BEGIN (RSA|PRIVATE)|_SECRET=|_KEY="`).
4. **No "AI", model or vendor names on screen** or in customer-facing text; the product name only through
   `CLINIC_SYSTEM_NAME`.
5. Feature branches only, no PRs unless asked. Commit trailer on every commit:
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

From the contract (§1 hard rules – read the full text):
6. **Off unless entitled.** Nothing of K2 is reachable without the `clinic` package; ClinForms must behave
   byte-for-byte as before for every other clinic. Never edit a ClinForms page, the medreport module or a shared
   file outside your module's ownership without the orchestrator (Q-K10: confirm with Khuram who that is now).
7. **Tenant scoping:** `tenant_id` on every table, `PRIMARY KEY (tenant_id, id)`, every FK includes `tenant_id`, every
   query names `tenant_id` – proven by the guarded-database suite (`unscopedStatements(...) = []`).
8. **Clinical free text encrypted** (`_enc` columns, per-clinic AES-GCM); lists never decrypt.
9. **Every write audited** in the same batch; audit rows never hold patient data.
10. **Never delete clinical records** – archive, cancel, void, withdraw; retention rules in `core/retention.ts`.
11. **Providers in outbox/test mode only**; a live-looking key is refused; no new paid service.
12. **Own migration numbers only** (diary `0110–0119`, records `0120–0129`, billing `0130–0139`, comms `0140–0149`,
    portal `0150–0159`, reporting `0160–0169`, integration `0170–0179`), each with its Postgres twin
    `supabase/migrations/2026102400NNNN_<same name>.sql`.
13. Ports 3180–3199; full check chain before handing over; e2e local only.

---

## 3. Current state per module (checked 26 Oct 2026, tests NOT re-run)

Statuses per requirement are in `requirements.md` §13 (205 requirements: 61 done, 36 partial, 49 partial-wt,
59 missing). **No module has a committed screen**; committed work is domain rules + migrations + repositories +
server flows + tests. Several worktrees hold large **uncommitted** work (written by the stopped sprint agents,
unreviewed, may not compile).

| Module | Branch @ commit | Committed (vs `feat/clinic-system`) | Uncommitted in its worktree | Main gaps |
|---|---|---|---|---|
| foundation | `feat/clinic-system` @ `8716fbf` (pushed) | Packages, shell `/app/clinic`, brand by host, shared record + directory repos, migrations 0100–0102, demo seed, platform package switch, offboarding, contract test, `clinic-system-shell.cjs` e2e | none | Module seeds not wired; 35 commits behind `main` (see §7.5) |
| diary | `feat/cs-diary` @ `3d792ef` (1 commit, 20 files, +4,132) | Migration 0110; Europe/London time, statuses, clash rules, recurrence, rotas, free slots, grid layout; repos (book single/recurring, move, status incl. DNA/late-cancel fee flag, blocks, rotas, slots, waiting list, bulk); DB clash triggers both dialects; suites on SQLite, PGlite, D1 stand-in, real local D1 | 3 modified (`diary/types.ts`, `nav/diary.ts`, `record-tabs/diary.ts`) + 17 new (~2,330 lines): `src/app/app/clinic/diary/actions.ts` and `api/{appointments/[appointmentId],patients,patients/[patientId],slots}/route.ts`; `src/components/pms/diary/*` (grid, booking, appointment and block dialogs, patient search, fields, status style); `src/modules/pms/diary/view.ts`; `src/server/pms/diary/{view,details,actions-support}.ts` | **No `page.tsx`** (no diary page at all); no appointments record tab; no rota/waiting-list screens; print view; e2e; `seed-diary.ts` |
| records | `feat/cs-records` @ `74e579c` (1 commit, 27 files, +3,938) | Migrations 0120–0121; templates (SOAP initial, follow-up, discharge), sign rule + fingerprint, amendments, body chart data, NDI/ODI/NPRS/PSFS/QuickDASH scoring, attachment checks, anonymise eligibility; repos incl. encrypted file chunks, history, subject-access collection, anonymise; lock triggers; 11 tests × 4 backends | 3 modified (`nav/records.ts`, `record-tabs/records.ts`, `records/types.ts`) + 37 new (~3,731 lines): pages `src/app/app/clinic/patients/{page,new}`, `[patientId]/{layout,page,edit,cases,cases/new,cases/[caseId],notes,notes/[noteId],outcomes,attachments,history}` + actions and attachment routes; `src/components/pms/records/*` (11); `records/copy.ts`; `src/server/pms/records/*` | Review + commit the UI; template editor; unsigned-notes list; subject-access PDF/JSON output check; e2e (clinician vs staff); `seed-records.ts` |
| billing | `feat/cs-billing` @ `e0185da` (2 commits, 45 files, +6,104) | Migrations 0130–0131; VAT, numbering (≤ 10 chars), states, aged debt, statements, allocation, excess split, CSV guard, claim lines; repos (drafts, issue, credit notes, payments/refunds/allocations, payment links, exports, debtors); services: `stripe_test` provider (refuses live), visit source interface, e-billing channels (CSV; Healthcode "not connected"), PDFs; nav + Invoices tab registered | clean | **All screens** (`src/app/app/clinic/billing/**`, `patients/[patientId]/invoices/**`); diary adapter for the visit source; e2e; seed |
| comms | `feat/cs-comms` @ `fc0d3eb` (1 commit, 43 files, +6,165) | Migrations 0140–0141; merge fields (no clinical detail), SMS segments, UK-time schedule with quiet hours, PECR, replies; repos; engine (outbox/test providers, send run, manual messages, replies, signed unsubscribe, cron/webhook handlers, letters from templates); `syncAppointmentMessages` hook; suite on SQLite + PGlite | `render.ts` modified; new `src/app/api/clinic-messages/{cron,sms,unsubscribe}/route.ts` (**outside comms' route ownership** – decide placement with Khuram) and `src/server/pms/comms/comms-server.test.ts`. Route comments point to `docs/clinic-system/comms.md`, which does not exist | D1 stack test `pms-comms-stack.test.ts`; screens (messages/outbox, letters, messages tab); cron schedule entry (`vercel.json`, shared file); diary wiring; letter document output; seed; e2e |
| portal | `feat/cs-portal` @ `51e6ed6` (1 commit, 42 files, +5,756) | Migrations 0150–0152; slot engine, booking policy, intake forms (typed e-signature, sealing), starter forms; repos and flows: public booking (no patient-existence leaks), portal magic-link accounts/sessions (hash-only), patient cancel/move, intake trust levels, shares, rate limits, bot check (off), outbox mailer, **standalone diary port**; suites on 4 backends | 3 modified (`server/pms/portal/{booking,diary-port}.ts`, `testing/portal-suite.ts`; +61/−11) | Public route group `src/app/(public-clinic)/**`; staff screens (`online-booking`, `intake`, forms tab); **bookings into `pms_appointments`** via a diary adapter; outbox → comms; e2e; seed |
| reporting | `feat/cs-reporting` @ `8716fbf` (**0 commits**) | – | 3 modified (`audit/reporting.ts`, `nav/reporting.ts`, `pms-schema/reporting.ts`) + 61 new (~6,960 lines): migration `0160_pms_reporting_setup.sql` + twin (`pms_site_hours`, `pms_site_closures`, `pms_staff_access`, `pms_staff_sites`); domain (metrics, periods, catalogue, csv, fact-checks, staff, schemas, audit-search, setup sections); repos (opening hours, record figures, staff access, audit search, suite); server (reports, csv-reports, scope, sources); pages `reports/{page,layout,attendance,authorisations,caseload,debtors,patients,revenue,utilisation}` + `export/[report]/route.ts`; `setup/{page,layout,sites,sites/[siteId],services,prices,prices/[priceListId]}` + actions for practitioners, referrers, records, staff; components; D1 stack test | Commit + review; pages for practitioners/referrers/records/staff; site scoping enforced outside reports; `reporting-repos.test.ts` is 9 lines – check it runs the suite |
| integration | `feat/cs-integration` @ `8716fbf` (**0 commits**) | – | 4 modified: medreport `core/schemas.ts` (adds `"native"` to `ConnectorIdSchema` – allowed only with the orchestrator's go), medreport `ui/screens/home/home-screen.tsx` and `ui/studio-events.ts` (type-only follow-ups of the enum change – **outside ownership, need Khuram's go**), `pms-schema/integration.ts`; ~23 new (~5,330 lines): migration `0170_pms_integration.sql` + twin (`pms_import_batches`, `pms_import_rows`, `pms_form_requests`, `pms_filed_forms`, `pms_filed_form_parts`); domain (csv, import kinds patients/cases/appointments/invoices, mapping, resolve, issues, rows, values, merge fields + 2 tests); server (`importer.ts` check/run/undo, `bundle.ts`, `ports.ts`, `wiring.ts`); repos (import batches, filed forms, form requests) | **`src/server/pms/native-connector.ts` missing**; glue registration; import screens; authorisations import; reconciliation report; **no repository suite or D1 stack test for 0170 tables**; e2e |

---

## 4. Recommended build order, milestones and how to verify each

Rationale: commit what exists first (it is the only copy), then finish screens in dependency order (diary and records
are what everything else hangs on), merge early and often into `feat/clinic-system`, leave the cross-module wiring
and ClinForms integration for when the parts are on one branch.

| # | Milestone | Work | Verify (all local, ports 3180–3199) |
|---|---|---|---|
| M0 | **Safeguard** | In each `cs-*` worktree commit the uncommitted work as it is (`WIP: unreviewed sprint work – <module>`), no fixes; with Khuram's OK push `feat/cs-*` to `origin` (pushing a branch may start a Vercel preview build – previews use the preview database; never seed or migrate it) | `git status` clean in every `cs-*`; nothing secret staged |
| M1 | Diary usable | Diary `page.tsx` (day view per site with practitioner/room columns, week view per resource, site + date in the URL), booking/move/status/block dialogs, appointments record tab, rota and waiting-list screens; `seed-diary.ts`; `scripts/e2e/pms-diary-*.cjs` | `npm run test:pms`; diary suite on 4 backends; e2e: book, clash refused, recurring with skip, move by keyboard, DNA, undo, 375 px, keyboard only |
| M2 | Records usable | Review and commit records UI; template editor; unsigned-notes list; subject-access output; `seed-records.ts`; e2e | e2e as clinician (write, sign, amend, outcome, attachment) and as staff (no clinical tab, notes URL refused) |
| M3 | First merge | Merge diary + records into `feat/clinic-system` (§5); wire seeds into `pms:seed-demo` | Full chain green; `clinic-system-shell.cjs` still passes; walk book → arrive → note → sign on a fresh seed |
| M4 | Set-up + reports | Reporting: commit, finish set-up pages, one opening-hours source (§7.2), site scoping enforced in diary/patients/billing lists; merge | Reporting suite incl. D1; report figures equal `fact-checks.ts`; staff limited to site A sees nothing of site B |
| M5 | Billing | Screens; wire the visit source to the diary; remittance allocation screen; seed; e2e; merge | e2e: attended + DNA → draft → issue → part payment → statement PDF → aged debt; credit note gives usage back |
| M6 | Comms | Wire `syncAppointmentMessages` to diary writes; outbox and message-tab screens; letters screens with PDF output; cron/webhook/unsubscribe routes placed as Khuram decides (+ schedule entry); D1 stack test; merge | Booking/moving/cancelling creates/updates/cancels planned messages; cron run with `CRON_SECRET` puts due reminders in the outbox; nothing is sent |
| M7 | Portal + online booking | Diary adapter for the portal's diary port (bookings in `pms_appointments`); portal outbox → comms; public route group pages (booking, portal, intake), staff screens (online booking, intake, forms tab); merge | e2e at 375 px: new patient books online → appears in diary; reception clash refused; patient cancels late → flagged; intake form signed and sealed; reports-only clinic has no public page |
| M8 | Integration | With Khuram's go: additive `"native"` + one glue registration line + `native-connector.ts`; revert the two medreport UI edits unless approved; import screens, authorisations import, reconciliation report, repo suite + D1 test for 0170; one merge-field engine; letters through the Word/RTF engine; merge | ClinForms connector tests with `native`; e2e: case → "Complete referrer form" → approve → filed on the record; import fixture: map → check → run → re-run (no duplicates) → undo |
| M9 | Integrate + verify | Full walk (book → arrive → note → sign → invoice → payment → reminder in outbox → online booking → portal → report → referrer form → letter → import); independent security/tenancy, QA and regression reviews; diary performance with 50,000 fictional appointments; demo script | Full chain; `forms-regression.cjs` against builds of `main` and `feat/clinic-system`, compared with `scripts/e2e/compare-form-outputs.ts` – **all files identical**; no open high findings |
| M10 | Towards production (**Khuram's go only**) | Bring `main` into `feat/clinic-system` (§7.5), gateway allowlist, London Postgres, gates A–C (requirements §10) | Separate plan, approved by Khuram |

---

## 5. How to merge a module into `feat/clinic-system`

```bash
cd /Users/khuram/Projects/Appstackx/clinforms-wt/cs-base          # on feat/clinic-system
git fetch origin && git status --short                             # must be clean
git pull --ff-only origin feat/clinic-system
git merge --no-ff feat/cs-<module> -m "Merge feat/cs-<module>: <one line>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
npm ci                                                             # first time in this worktree
npm run test:pms && <full chain>                                    # contract §8
git push origin feat/clinic-system                                 # never main
# then bring the other module branches up to date:
git -C /Users/khuram/Projects/Appstackx/clinforms-wt/cs-<other> merge --no-ff feat/clinic-system
```

- Merge order: diary → records → reporting → billing → comms → portal → integration (dependency order).
- Expected conflicts are few (each module owns its files). Watch: `src/components/pms/` (one subfolder per module),
  generated `.eslintrc.json` (regenerate with `npm run medreport:eslint-boundary`, never hand-edit), migration
  numbers (each module's own range) and anything a builder edited outside its ownership (§3: comms routes,
  integration's medreport files).
- Adapters between modules (billing's visit source, portal's diary port, integration's `wiring.ts`, comms' diary hook)
  are wired on `feat/clinic-system` after both modules are merged, in the smallest possible change, with a test.
- Module seeds (`scripts/pms/seed-<m>.ts`) are called from `scripts/pms/seed-demo.ts` (foundation-owned).
- Never squash or rebase shared branches; never force-push.

---

## 6. Rules for foundation-owned files

`src/modules/pms/core/**`, the `index.ts`/`foundation.ts` registries, `src/server/db/schema.ts`,
`src/server/repos/pms/*.ts` (top level), `src/server/pms/*.ts` (top level), `src/lib/brand.ts`, `src/middleware.ts`,
`package.json`, `scripts/pms/{seed-demo,seed-lib,demo-data,contract.test}.ts`, migrations 0100–0109 and
`contract.md` are owned by the orchestrator. New permission, new npm dependency, change to a shared table or a
ClinForms file: write the proposal, get Khuram's yes, then make it as its own commit on `feat/clinic-system`.

---

## 7. Integration conflicts to resolve (known now)

1. **Two appointment stores.** Portal keeps `pms_online_bookings` with its own clash trigger; the diary keeps
   `pms_appointments`. Make online bookings diary appointments (requirements K2-BOOK-003); keep portal's table only
   as a booking-request log if useful.
2. **Two opening-hours tables.** Portal `pms_booking_hours` vs reporting `pms_site_hours`/`pms_site_closures`.
   One source per site (K2-SITE-003).
3. **Two outboxes.** Portal `pms_portal_messages` vs comms `pms_messages` (K2-BOOK-004).
4. **Two merge-field engines.** `src/modules/pms/comms/merge-fields.ts` (plain-text letters) vs
   `src/modules/pms/integration/merge-fields.ts` (Word/RTF fields with aliases). One engine (K2-LTR-007).
5. **`main` has moved on.** `feat/clinic-system` forked from `main` at `5600912`; `main` is now 35 commits ahead
   (`c883ce5`, Blue Heart release work) and has its own `clinic_plan`, `clinic_package`, `clinic_usage`,
   `usage_report`, `usage_event` tables (migrations 0006–0008) and a "Packages and usage" section in `docs/auth.md`.
   The foundation's `clinic_entitlements` / `clinic_usage_counters` overlap in concept and wording ("package").
   Decide one model (Q-K6) **before** merging `main` in; do not do that merge without Khuram's go.
6. **Out-of-ownership edits:** comms' `src/app/api/clinic-messages/**` routes; integration's medreport UI edits
   (`home-screen.tsx`, `studio-events.ts`).
7. **Site scoping** lives in reporting (`pms_staff_access`, `pms_staff_sites`) but must be applied by diary, records
   and billing lists – needs a small shared read function (foundation-owned → proposal to Khuram).

---

## 8. What NOT to touch (another workstream is active)

The ClinForms Blue Heart release is being worked on in parallel. Leave all of this alone – no checkout, commit,
merge, rebase, reset, push, server, `npm ci` or file edit:

- Worktrees `/Users/khuram/Projects/Appstackx/clinforms-wt/bh2-*` (copy, corpus, data, drafting, engine, issue,
  opinion, release, review, schema, shim, split, tokenizer) and `/Users/khuram/Projects/Appstackx/clinforms-wt/bhfix-*`
  (clinicians, instructions, mergecodes, opinion, release, review, smallui).
- Branches `release/bh-trial-2`, `release/bh-trial-fixes`, `ws/bh2-*`, `fix/bh-*`, `fix/schema-forward-compat`.
- **Ports 3240–3399.**
- The scratchpad worktrees under `/private/tmp/claude-501/-Users-khuram-Projects-Appstackx/b7653163-bb9e-4e0d-8520-80682f931a5b/scratchpad/bh2/`.
- Also: the main checkout `/Users/khuram/Projects/Appstackx/clinforms` (stays on `main`); the frozen demo
  worktree `/Users/khuram/Projects/Appstackx/clinforms-demo` (tag `red-demo-2026-10-13`); the other `clinforms-wt/`
  worktrees that are not `cs-*` or `k2-spec` (`bh-forms`, `bh-forms-replace`, `bh-legal`, `bh-onboard`,
  `bh-release`, `bh-verify`, `blue-heart-call`, `blue-heart-fit`); `memory/` on `main`.
- Repository-wide commands that affect other worktrees: `git worktree prune`/`remove`, `git gc --prune`,
  `git branch -D`, `git push --force`, `git fetch --prune` with deletes, `git stash` in someone else's worktree.

---

## 9. How to demo

Today only the foundation is demonstrable from committed code (the `/app/clinic` shell with the demo clinic's
figures, packages on/off, brand by host). Module screens come with M1–M7.

1. In `cs-base` (or the merged branch): `npm ci`; check `.env.local` has the names `BETTER_AUTH_SECRET`,
   `CLINFORMS_DATA_KEYS`, `CLINFORMS_DATA_KEY_ID`, `CLINFORMS_PLATFORM_ADMINS` (names only:
   `cut -d= -f1 .env.local`). Local SQLite only.
2. `npm run pms:seed-demo` → "Riverside Physiotherapy (fictional)" (`riverside-demo`), package on, 3 sites, 6 rooms,
   8 practitioners, 200 patients (`sim-pat-001` Megan Hart, `sim-pat-002` Daniel Brooks, `sim-pat-007`–`204`). It
   prints the owner's invitation once: save it to a `chmod 600` file in your scratchpad; never commit it or paste it
   into chat.
3. `npm run build && PORT=3180 MEDREPORT_AI_MODE=demo npm run start` (or `npm run dev -- -p 3180`).
4. Open the invitation on `http://localhost:3180`, set a password and two-step, go to `/app/clinic`. Brand host:
   `http://clinic.localhost:3180` (product name placeholder; public pages go to sign-in).
5. Foundation browser check: `INVITE_A_FILE=<demo clinic invite file> INVITE_B_FILE=<reports-only clinic invite file>
   BASE=http://localhost:3180 NODE_PATH=/Users/khuram/Projects/Appstackx/pigeon-web/node_modules node
   scripts/e2e/clinic-system-shell.cjs`.
6. Target demo walk once M1–M8 exist: diary for one site → book Megan Hart → arrive → attended → follow-up SOAP note
   → sign → amend → invoice to her solicitor/insurer account → record a payment → reminder visible in the outbox →
   online booking by a new fictional patient → portal → reports → "Complete referrer form" on her case → letter.
7. Stop the server. Demos run locally only – never from clinforms.co.uk, never against a preview/production database,
   never with real data, and nothing in the demo may say "AI" or name a vendor.

---

## 10. First hour checklist

1. Read this file, `contract.md` §1–§8, `requirements.md` §0, §3 headings, §7, §10–§11. (20 min)
2. `git -C /Users/khuram/Projects/Appstackx/clinforms fetch origin` and `git -C … worktree list | grep -E "cs-|k2"`;
   check the SHAs match §3 (`8716fbf`, `3d792ef`, `74e579c`, `e0185da`, `fc0d3eb`, `51e6ed6`).
3. `git -C /Users/khuram/Projects/Appstackx/clinforms-wt/cs-<m> status --short` for all seven; compare with §3's
   "Uncommitted" column. **Discard nothing.**
4. Send Khuram one short message asking: (a) are you the orchestrator for foundation files (Q-K10)? (b) OK to commit
   the WIP and push `feat/cs-*`? (c) go for the additive medreport change (`"native"` + glue line + the two type-only
   UI edits)? (d) where the comms cron/webhook routes should live? (e) Q-K6 package model; (f) start with M1?
5. While waiting: M0 commits locally (no push), staged diffs scanned for secrets, no `.env.local`, no `demo-assets/`.
6. In `cs-diary`: `npm ci`, then `npm run typecheck` and `npm run test:pms` to learn the real state of the WIP; note
   failures in your reply to Khuram before fixing anything.
7. Plan M1 in a short table (screens, files, tests) and wait for Khuram's yes ("plan first, build after he
   approves").

---

## 11. Update 27/10/2026 – `main` merged into `feat/clinic-system` (Khuram's go)

`origin/main` @ `cae0c3f` (250 commits: Blue Heart release, trials, demo clinics, packages and usage, owner reset
links, medreport/reports UI fixes) was **merged** (`--no-ff`, no rebase) into `feat/clinic-system`, then
`feat/clinic-system` into `feat/cs-diary` and `feat/cs-records`. `main` was not touched. This supersedes §7.5's
"35 commits behind" and the §3 heads for these three branches.

| Branch | New head (pushed) |
|---|---|
| `feat/clinic-system` | `a13ebef` |
| `feat/cs-diary` | `83a2d50` (no conflicts) |
| `feat/cs-records` | `02371fd` (no conflicts) |

The other five `feat/cs-*` branches are still on the old foundation (`8716fbf`); merge `feat/clinic-system` into
each before working on it.

Migrations: `main` added only `0006–0008` (clinic_plan, plan_usage, demo clinic) – nothing in K2's `0100–0179`.

Conflicts on the foundation merge (9 files), all resolved by keeping both sides:
`package.json` (both sets of scripts), `(clinic)/layout.tsx` (main's trial + demo banners and the package nav/brand),
`studio/layout.tsx` (banners and the Reports-off 404), `platform/actions.ts` (main's plan actions and
`setClinicPackageAction`; the pms `isPackageId` is imported as `isEntitlementPackageId`), `platform/page.tsx`
(main's panels and the on/off table, **retitled "Packages switched on"** so the page doesn't have two "Packages"
panels), `platform-console.ts`, `auth/platform.ts`, `activity-copy.ts`, `repos/audit.ts` (main's `auditRow()`;
`auditInsertQuery()` now built on it). Merge fallout: pms `setDemoClinic()` renamed **`setPmsDemoFlag()`** (main's
admin source check reserves that name for `clinic_plan.demo_clinic`); the e2e's expected ClinForms nav gained
"Plan & usage".

Results (exact counts): foundation – test:pms 67/67, typecheck, lint (boundary up to date), test:medreport 1777
pass/0 fail/3 skipped, test:db 467/0/3, test:auth 134/0, test:site 92/0, test:gateway 265/0/2, build green;
`clinic-system-shell.cjs` 9/9 on `localhost:3180` (fresh scratch SQLite, server stopped). Diary – test:pms 131/131,
typecheck, lint, test:db 531/0/3, test:auth 134/0, test:site 92/0, test:gateway 301/0/2, build green; test:medreport
1776/1 fail/3 – the failure is the timing check in `scripts/medreport/wc-fix2-store.test.ts` (1122 ms vs a 1 s
limit, under load); that file passed 19/19 twice on rerun. Records – test:pms 111/111, typecheck, lint,
test:medreport 1777/0/3, test:db 511/0/3, test:auth 134/0, test:site 92/0, test:gateway 287/0/2, build green.

Open – for Khuram:
1. **Q-K6 is still open, and now it is live on one branch:** main's `clinic_package` (price tier: reports included,
   extra-report price) and the foundation's `clinic_entitlements` (Reports / clinic system on-off) both say
   "package" – on the platform page, in audit actions (`platform.package_set` vs `platform.entitlement_set`) and in
   code (`@/lib/packages` vs `@/modules/pms/core/entitlements`). They work side by side today; choose one word/model.
2. **Two "demo clinic" flags:** main's `clinic_plan.demo_clinic` (banner, notices, PH-DEMO approvals) and the
   foundation's `pms_settings.is_demo` (set by `pms:seed-demo`). The seed should probably set main's flag
   (`setDemoClinic` in `src/server/admin/clinic-plan.ts`) and `is_demo` be dropped or derived – needs a decision.
3. **Two "trial" notions:** main's `clinic_plan` trial (a trial-ended clinic can't create anything new) and the
   foundation's entitlement status `trial` (`src/modules/pms/core/entitlements.ts`). No clinic-system code reads
   main's trial yet – decide whether a trial-ended clinic is also blocked in the clinic system, and whether the
   entitlement `trial` status stays.

---

## 12. Update 27/10/2026 – M3: diary and records back ends merged into `feat/clinic-system` (no screens yet)

M1 (diary) and M2 (records) **back ends are done**: data layer, permission-checked server layer, server actions and
route handlers, demo seeds, tests. **No screens yet** – the diary's components were deleted and its nav/record-tab
entries left empty; records keeps its draft patient pages (not reviewed as screens). Screens and their e2e wait for
design. `main` was not touched.

| Branch | New head (pushed) | What |
|---|---|---|
| `feat/clinic-system` | `f54aff5` | `58cfe2b` merge `feat/cs-diary` @ `97ccf57` → `3e98008` merge `feat/cs-records` @ `a5753dd` (both `--no-ff`, diary first) → `f54aff5` demo-seed wiring |
| `feat/cs-diary` | `361cd21` | `feat/clinic-system` merged back in |
| `feat/cs-records` | `6c5c6cf` | `feat/clinic-system` merged back in |

Conflicts: **none** on either merge (each module kept to its own files; migrations diary `0110–0114`, records
`0120–0124`, each with its Postgres twin). `.eslintrc.json` was not stale (contract test and lint green), so it was
not regenerated.

Foundation wiring (`f54aff5`, smallest change): `scripts/pms/seed-demo.ts` now runs, after `seedDemoClinic(...)`,
`seedDiary({ db, cipher: getDataCipher() }, slug, { log })` then `seedRecords(...)` with the same arguments; new test
`scripts/pms/seed-demo-modules.test.ts` runs clinic → diary → records on one clinic and checks that a re-run adds
nothing. The records seed does **not** link its notes to the seeded appointments (it can't: `seedRecords` never sets
`appointmentId`, though `ImportNoteInput` has the field) – not redesigned, left open below. A fresh
`npm run pms:seed-demo -- --fresh` now prints: 22 rota entries (5 practitioners, Bletchley + Wolverton); week of
2026-10-26 with 212 appointments (75 attended, 1 dna, 24 cancelled, 3 late_cancelled, 109 booked), 6 blocked times;
4 on the waiting list; 241 notes (232 signed, 9 unsigned), 1 amendment, 275 outcome measures.

Results on `feat/clinic-system` `f54aff5` (exact counts): test:pms **270/270**; typecheck, lint green;
test:medreport 1777 pass/0 fail/3 skipped (1780); test:db 670/0/3 (673); test:auth 134/0; test:site 92/0;
test:gateway 401/0/2 (403); build green. `wc-fix2-store` did not flake this time. Module branches after the
merge-back: test:pms 270/270 and typecheck green on both.

**Walk on a fresh local seed** (scratch SQLite, server functions called directly from a script – no screens):
13/13 – reception finds Megan Hart (sim-pat-001) → books a follow-up from a free slot (`loadFreeSlots`,
`bookAppointmentFor`) → arrived (`setAppointmentStatusFor`) → clinician `startNoteFor(..., { appointmentId })` →
`saveNoteFor(..., { sign: true })` → note reads back signed with the appointment id → staff `getNoteFor` and
`listNotesFor` refused (`forbidden`) → `loadDaySheet` shows "Arrived", then after attended both `loadDaySheet` and
`loadDiaryView` show it attended; the day sheet carries no note text. The walk ran with the clock set to the
appointment day (09:05 on 28/10): run at 23:08 the first free slot is tomorrow and signing a note dated in the future
is refused ("The consultation date is in the future") – correct. **Seen on the way:** the diary let reception mark
tomorrow's appointment "arrived" the night before – check whether arrive/attended should be refused for a future
appointment (diary owner).

**Browser check:** `scripts/e2e/clinic-system-shell.cjs` **9/9** on `localhost:3184` (fresh scratch SQLite; clinic B
must have slug `harbour-clinic`), server stopped.

### Server API surface for the screens

- Diary: `src/server/pms/diary/` – `caller.ts` (`diaryCallerOf`, site scope), `view.ts` (`loadDiaryView` – day/week,
  practitioner or room columns), `reads.ts` (`loadDaySheet`, `loadPatientAppointments`, `loadRotas`,
  `loadWaitingList`, `loadWaitingListEntry`, `loadFreeSlots`, `searchDiaryPatients`, `loadBookingOptions`),
  `details.ts` (`loadAppointmentDetails`), `writes.ts` (book, rebook, move, resize, status, cancel, details, cancel
  series, blocks, rota create/update/end, waiting list add/update/status/offer/answer/book-offer;
  `DIARY_ACTION_PERMISSIONS`), `actions-support.ts`. Actions: `src/app/app/clinic/diary/actions.ts`,
  `diary/rotas/actions.ts`, `diary/waiting-list/actions.ts`. Routes: `src/app/app/clinic/diary/api/{view,day-sheet,
  slots,rotas,patients,patients/[patientId],patients/[patientId]/appointments,appointments/[appointmentId],
  waiting-list,waiting-list/[entryId]}/route.ts`.
- Records: `src/server/pms/records/*-service.ts` – `patients-service`, `cases-service`, `notes-service`
  (`listNotesFor`, `getNoteFor`, `startNoteFor`, `saveNoteFor`, `signNoteFor`, `discardNoteFor`, `amendNoteFor`,
  `unsignedNotesFor`), `outcomes-service`, `templates-service`, `attachments-service`, `history-service`,
  `export-service`; plus `access.ts` (guards, `Result`, safe messages), `subject-access-export.ts`. Actions:
  `src/app/app/clinic/patients/{actions.ts,[patientId]/actions.ts,[patientId]/cases/actions.ts,
  [patientId]/notes/actions.ts,[patientId]/outcomes/actions.ts,[patientId]/attachments/actions.ts,
  note-templates/actions.ts}`. Routes: `patients/[patientId]/export/route.ts`,
  `patients/[patientId]/attachments/upload/route.ts`, `patients/[patientId]/attachments/[attachmentId]/route.ts`.

`requirements.md` §3/§5 lines and §13 updated: new status **"back end done, screen pending"** for SITE-002,
DIARY-002/003/004/007/008/009/010/012/013/016/017, PAT-001/002/004/006/007/008/010, NOTE-001/002/004/006/008;
NOTE-007 done (NOTE-003 already done); PAT-009 partial; the remaining diary/records `partial-wt` (PAT-003, NOTE-005,
NOTE-009, AUTHS-005, NFR-012) became `partial` – the work is committed now; PLT-010 stays partial (billing, comms and
portal seeds to come).

### Open

1. `pms_clinical_notes.appointment_id` has **no FK** yet (SQLite needs a table rebuild) – add in records' range
   with its Postgres twin; then let the records seed link notes to the seeded diary appointments.
2. **Shared site-scope read for K2-SITE-004:** `resolveDiarySiteScope` (`src/server/pms/diary/caller.ts`) returns
   "every site"; the diary applies any scope it is given. Needs the foundation read over reporting's
   `pms_staff_access`/`pms_staff_sites` (§7.7), used by diary, patient lists, invoices and reports.
3. Diary performance measured only on local SQLite (`scripts/pms/diary-perf.ts`, 50,000 fictional appointments) –
   measure on Postgres and D1.
4. Waiting-list offers don't hold the slot: someone else can book it while the offer is out.
5. Idea: an unsigned-notes count on the clinic dashboard (`unsignedNotesFor` exists).
6. Arrive/attended allowed for a future appointment (see the walk) – confirm intended or refuse.
7. Screens + e2e for diary and records: waiting for design.

### Decisions for Khuram

1. May reception (`staff`) see a case's **referral reason**? (Today it is treated as clinical.)
2. **Q-K6** naming of package / demo / trial (see §11 open 1–3) – still open.
3. **`diary.book` vs `diary.manage`** (`DIARY_ACTION_PERMISSIONS` in `src/server/pms/diary/writes.ts`): clinicians
   and staff have `diary.book` – book, rebook, move, resize, status, cancel, cancel a series, **blocked time** and the
   whole waiting list; only owner/admin have `diary.manage` – **rotas** (create, change, end). Confirm, or e.g. move
   blocked time to `diary.manage`, or let clinicians change their own rota.


## 13. Update 28/10/2026 – designs in, screens built, how to continue (latest)

**Khuram's working rules for K2 (binding):** never merge into, push to or rebase `main`. `feat/clinic-system` is the K2
main line; module branches merge into it (`--no-ff`) only after the full chain + their e2e pass. Keep this handover
updated at every milestone so another account can continue if the weekly limit is hit. Fictional data only.

### 13.1 State of the K2 line
- `feat/clinic-system` @ **`c05be50`** (pushed). Contains, in order: foundation; `main` @ cae0c3f merged in (§11); diary
  + records back ends (§12); **`feat/cs-ui`** (UI kit `src/components/pms/ui/`, app shell `src/components/pms/shell/`,
  preview `/app/clinic/design-system`, tokens `--primary-strong`, `--accent-text`, `--destructive-strong`,
  `--input-strong` added to globals.css); **`feat/cs-access`** (26 configurable permissions, see 13.3);
  **`feat/cs-records` screens** (patients list, record with tabs by role, note editor, unsigned notes, outcomes,
  attachments, history, note templates, clinical flags PAT-014, SAR export); **`feat/cs-diary` screens** (day/week,
  booking dialog, drawer, keyboard move, rota + waiting list, day sheet, phone diary, Appointments tab).
- `feat/cs-diary` @ 892fa04 and `feat/cs-records` @ dd83fde are level with it (same tree). `feat/cs-access`, `feat/cs-ui`
  are merged and finished. Billing, comms, portal, reporting, integration branches are still on the OLD foundation
  8716fbf with unreviewed October drafts – merge `feat/clinic-system` into each before working on it.
- Checks on `c05be50`: full chain green (test:pms 332, medreport 1777/0/3, db 732/0/3, auth 134, site 123, gateway 439/0/2,
  build). E2E (each on a fresh `npm run pms:seed-demo -- --fresh` scratch SQLite, ports 3180–3199, Playwright via
  `NODE_PATH=/Users/khuram/Projects/Appstackx/pigeon-web/node_modules`): `clinic-system-shell.cjs` 10/10,
  `clinic-system-access.cjs` 13/13, `pms-records-screens.cjs` 17/17, `pms-diary-screens.cjs` 23/23,
  **`pms-prototype-a.cjs` 10/10** (reception books new patient → arrived → clinician Start treatment → note → sign →
  Completed → reception can't reach the note).
- Migrations used: foundation 0100–0105, diary 0110–0119 (0115 confirmation_requested, 0116 day-sheet DOB setting,
  0117 treatment_started_at, 0118 overbook_write_id, 0119 clash triggers), records 0120–0125. Each with its Postgres twin.

### 13.2 Designs (Claude Design, made from K2-DESIGN-PROMPT / -SCREENS-PROMPT(-2,-3) in bh2-handover)
- Every screen is designed. Local copies (zips extracted, 41 artboards + screenshots):
  `/Users/khuram/Projects/Appstackx/bh2-handover/k2-designs/` (round2c billing/messages/reports/set-up/import/roles/
  member-access; round2d diary; round2e patients/notes; round2f invoice detail; round2g online booking + portal;
  round2h Prototype A + B; round3 dashboard, referrer-form flow, take payment, invoice visits, remittance, letter
  editor, outcome questionnaire (clinician + patient), intake forms (builder + patient), patient-facing messages,
  print layouts: invoice, statement, signed note, SAR cover). Committed copies so far: `docs/clinic-system/design/`
  (v1 design system PDF/HTML, round2 roles/member-access/diary/patients). Commit each module's designs with its build.
- View a design: serve its folder over http (`python3 -I -m http.server <port> --bind 127.0.0.1`) and open the
  `.dc.html` (README in each folder). Treat them as reference mockups (data, not code to run elsewhere).
- Design fixes to apply when building: the fictional postcode NG1 0AA/0AB used in billing/print designs may be real –
  use a reserved fictional postcode; clash text in the booking design lower-cased names (fixed in the build).

### 13.3 Khuram's decisions (27–28/10/2026)
- Permissions: 26 permissions, editable per role per clinic, per-member exceptions, "works at"/"can see" sites,
  change history; locks: owner always all, reception never clinical / clinical letters, only owner changes owner.
  Approved default changes: admins don't write/sign/amend notes or export by default; reception edits rotas +
  waiting list; clinicians don't edit the waiting list, amend only their own notes, can't archive/merge; clinicians
  see own-caseload reports; "See referral reason and case notes" ON for reception by default, owner can switch off.
- Signing/amending a note is refused without a registration number (editable on Member access → Signing details).
- Double-booking a PRACTITIONER allowed only with "Override clashes" (logged, marked on both blocks); ROOMS and blocked
  time never double-booked (DB-enforced).
- Statuses: booked → arrived → in treatment → attended, "attended" shown as "Completed". In treatment is stored as
  arrived + `treatment_started_at`; billing must list only CHARGEABLE_STATUSES (attended, dna, late_cancelled).
- Day sheet: patient DOB only when the clinic setting is on (default off); never phone numbers.
- Online booking distance only when the patient shares location/postcode, computed in the browser, not stored.
- Attachments stay clinical (hidden from reception).
- Naming: "K2" is a placeholder only – never in code/UI; product name only via CLINIC_SYSTEM_NAME. Q-K6 (package vs
  plan, two demo flags, two trial ideas) – choose the cleanest without touching production `main`.
- Integration: the additive `"native"` ConnectorId and the native connector are approved (K2 branches only).

### 13.4 Open items carried forward
1. No screen links a member to a diary practitioner (e2e does it by direct DB write) – build with Set-up practitioners.
2. Arrive/attended allowed for future appointments – block it (diary rule + server check).
3. "Double-booked" marker overlaps text on short blocks.
4. Record "Book" button opens the diary, not the booking dialog.
5. Diary performance not yet measured on Postgres/D1; waiting-list offers don't hold the slot.
6. Q-K6 naming/demo/trial consolidation; the reporting branch's `pms_staff_access`/`pms_staff_sites` must be dropped
   in favour of cs-access when reporting merges.

### 13.5 Plan from here (one milestone per run; report to Khuram after each)
| # | Milestone | Notes |
|---|---|---|
| M5 | **Billing** (running 28/10) | review/finish the October draft on `feat/cs-billing` after merging `feat/clinic-system`; diary visit source (CHARGEABLE_STATUSES, fee flags); screens from round2c billing + round2f invoice detail + round3 take payment / invoice visits / remittance / print invoice + statement; `stripe_test` only; drawer "Take payment"; record Account card + Invoices tab; patient list balance + "owes money" filter; dashboard money tiles later |
| M6 | Messages | comms branch; diary hook (confirmations, reminders, waiting-list offers); outbox only; letters editor; patient-facing messages; Messages tab |
| M7 | Online booking + portal + intake + patient questionnaire | Prototype B e2e |
| M8 | Set-up + reports + dashboard | reporting branch (drop its staff-access tables); set-up sub-pages without design; dashboard per role |
| M9 | Integration | native connector, Complete referrer form flow (round3 ReferrerForm prototype), import |
| M10 | Full review | security/tenancy, a11y, 50k perf on Postgres/D1, forms-regression identical vs `main` |
| M11 | Towards production | Khuram's go only |


## 14. M5 billing (28/10/2026) – DONE, merged into `feat/clinic-system`

**Heads (all pushed; `main` untouched):** `feat/cs-billing` `022b3e5` · `feat/clinic-system` `0acf07c` (merge of
`feat/cs-billing`, tree identical to it) · `feat/cs-diary` `2a3811b` · `feat/cs-records` `b8035d9` (both merged
back, typecheck + test:pms green).

| Commit on `feat/cs-billing` | What |
|---|---|
| `547eec6` | `feat/clinic-system` (`c05be50`) merged into the October draft (no conflicts) |
| `94926a8` | Diary fixes from §13.4: (2) seen statuses only from 60 min before the start, DNA only after it (rule + server + tests); (3) Double-booked marker in the block's top line; (4) record Book → booking form for the patient; `waiveAppointmentFee` |
| `0d5a728` | Billing back end: review fixes + void / write-off / transfer, remittance, saved TEST cards, site scope, diary visit adapter |
| `aa095b3` `6c0857e` `ab50aee` `022b3e5` | screens; wiring (drawer, record, patient list); seed + e2e (+ diary/prototype/shell e2e updates); designs |

### 14.1 Review findings on the October draft (fixed)
1. **Authorisation sessions double-counted** (diary on completion + billing on issue): billing now counts the VALUE
   and only hand-entered treatments' sessions.
2. **No site scope** on invoices/payments: `site_id` (0133/0135); every billing read applies `actor.siteIds`;
   out-of-scope = "no such invoice".
3. **Audit after the batch** (issue, unallocate, reverse, link status): now in the same batch (conditional
   `INSERT … WHERE EXISTS`, `billingAuditWhen`); credit note's authorisation reset inside its batch.
4. **Lines from the client**: invoicing visits takes appointment ids only; visits, prices, payers, fees are read on
   the server from the diary adapter.
5. Missing pieces added: void, write-offs, short payments, saved card, clinic-wide "attended, not invoiced", search.

### 14.2 What is built
- **Back end** (`src/server/pms/billing/{access,views,writes}.ts`, repos in `src/server/repos/pms/billing/`):
  diary adapter `src/server/pms/diary/billing-visits.ts` (CHARGEABLE_STATUSES; DNA/late only with the fee flag;
  never arrived/in treatment); pricing (case list → default → service; insured completed visits bill the payer,
  the case excess goes to the patient from the first visits in date order; DNA/late fees bill the patient);
  credit note kinds credit / write_off / void / transfer (0132; void 0134 `voided_at`, refused while paid);
  remittance with leave / write off / move to patient; take payment (card on file = saved TEST card 0136, card now,
  cash with change, bank transfer, payment link); refunds (to the card via the test provider); CSV export
  (reports.export, formula cells defused, audited). Migrations 0132–0136 with Postgres twins.
- **Screens** (`src/app/app/clinic/billing/**`, `src/components/pms/billing/**`): Billing home (totals, tabs
  Invoices / Attended, not invoiced / Aged debt / Remittances / Statements, search, chips, CSV), Invoice visits
  (choose → preview → issue), Invoice detail (split card, items with excess, payments and adjustments, A4 preview,
  Issue / Record payment / Copy payment link / Check for payment / Credit note / Refund / Void / take a payment
  off), Take payment dialog (and 375 px sheet), Remittance allocation, A4 print invoice and statement (print
  stylesheet; Save as PDF).
- **Wiring**: diary drawer "Take payment" (billing.pay); record Account card (+ "Save a test card") and Invoices tab
  (`?pay=1` opens Take payment; header "Take payment" → it); patient list Balance column and "Owes money" filter
  (billing.view); nav "Billing"; "Billing settings" nav entry removed (no screen yet).
- **Seed** `scripts/pms/seed-billing.ts` (called from `seed-demo.ts` after records): settings, historic invoices in
  every age band, payments, a remittance, a credit note, a void, a saved test card, half the week's completed visits
  invoiced; DNA/late fees left to invoice. Idempotent.
- **Tests**: billing service suite (`src/server/pms/billing/testing/service-suite.ts`) on SQLite, PGlite, D1
  stand-in and local D1; e2e `scripts/e2e/pms-billing-screens.cjs` with the provider's local TEST stand-in
  `scripts/e2e/stripe-test-stub.cjs` (`CLINIC_STRIPE_TEST_API_BASE`, loopback or Stripe only).
- Designs committed: `docs/clinic-system/design/round3/billing/` (+ README; postcodes → `ZZ99 9xx`, see there).

### 14.3 Results
Full chain on `022b3e5` (= `feat/clinic-system` `0acf07c`): typecheck, lint green; test:pms 412/412; test:medreport
1777 pass/0 fail/3 skipped; test:db 812/0/3; test:auth 134/0; test:site 123/0 (nav test updated for Billing); test:gateway
487/0/2 (billing D1 stack incl. local workerd D1); build green. Merge-backs: cs-diary and cs-records typecheck + test:pms 412/412.
E2E (each on a fresh `pms:seed-demo -- --fresh` scratch SQLite, ports 3180–3199, servers stopped):
clinic-system-shell 10/10, clinic-system-access 13/13, pms-records-screens 17/17, pms-diary-screens 24/24,
pms-prototype-a 10/10, **pms-billing-screens 18/18** (axe clean). The diary/prototype scripts now book their
"seen" steps within the next hour (they need the clinic's opening hours, as Prototype A always did).
Screenshots: `/private/tmp/claude-501/-Users-khuram-Projects-Appstackx-bh2-handover/ef471414-85b1-422d-bf98-018c56c69aec/scratchpad/k2design/out-billing/`.

### 14.4 Differences from the design
Invoice numbers `INV00052` (prefix + 5 digits, ≤ 10 chars) not `INV-04835`; "Completed" instead of "Attended";
aged debt has a 1–30 days column; largest overdue accounts link to a statement (sending reminders / links needs
Messages); email of receipts, invoices and statements disabled until Messages (M6); Download = print page (Save as
PDF); payer invoices' "Record payment" opens the remittance page; card on file needs a saved TEST card; the excess
is one amount per case taken visit by visit (design shows £20 on every visit – decision 1 below).

### 14.5 Open items
- Billing settings screen (VAT, prefix, terms, bank details) – defaults/seed only; with Set-up (M8).
- Email/SMS of receipts, statements, payment links – M6. Dashboard money tiles – M8.
- ~~A £0 insurer invoice is made (reads "Paid") when the excess covers the whole visit.~~ Fixed in §14.8.
- Insurer e-billing claims CSV (BILL-011) has a back end but no screen; the October react-pdf PDFs remain beside the
  HTML print views – keep one.
- `docs/clinic-system/billing.md` is referenced in code comments but does not exist.
- Live card payments need the clinic system's own Stripe account (CLAUDE.md, Q-K4); test mode only today.
- `round2/set-up` and `round2/import-from-previous-system` designs still carry an `NG… 0..` postcode.

### 14.6 Decisions for Khuram (answered 28/10/2026 – see §14.8 "Decisions")
1. Excess: one amount per case consumed visit by visit (built) vs a per-visit patient contribution as drawn?
2. "Seen" statuses from 60 minutes before the start, DNA only after it – confirm the window.
3. Authorisation sessions counted only by the diary (visit booked under the authorisation, on completion); billing
   counts value – confirm.
4. DNA / late-cancellation fees always billed to the patient, never the insurer – confirm.
5. Void refused while payments are on it; reception cannot credit, refund or void (role defaults) – confirm.
6. Design postcodes replaced with `ZZ99 9xx` (docs only); the app keeps the `MK… 9ZZ` demo units – OK?

### 14.7 Next
**M6 Messages** (comms branch): diary hook, outbox, letters, patient-facing messages, Messages tab – and then the
billing emails (receipts, statements, payment links).


### 14.8 Billing follow-up (28/10/2026) – excess modes, no £0 insurer invoice – DONE, merged

**Heads (pushed; `main` untouched):** `feat/cs-billing` `bf6e6f9` (`4a0e61d` feature, `bf6e6f9` diary e2e slot fix)
· `feat/clinic-system` `f732a11` (merge of `feat/cs-billing`, tree identical to it; `feat/clinic-system` had not
moved since `0acf07c`, so no catch-up merge was needed).

**Decisions (Khuram, 28/10/2026):**
1. **Excess – both modes**, chosen per insurer/payer account with an override per case: **"Excess per case"** (one
   amount used up visit by visit – the DEFAULT, as built in M5) and **"Patient contribution per visit"** (a fixed
   amount the patient pays on every visit, the insurer pays the rest – as the round 2f design draws).
2. **No £0 insurer invoice / line**: when the patient's part covers a whole visit, the visit is billed to the patient
   only and marked as such (nothing claimed from the insurer for it, nothing taken off the authorisation's value).
3. **Confirmed as built:** "seen" statuses from 60 minutes before the start, DNA only after the start; authorisation
   sessions counted once, by the diary on completion (billing counts value); DNA / late-cancellation fees always to
   the patient; void refused while payments are on it and reception cannot credit / refund / void by default;
   `ZZ99` postcodes in design docs, the app's demo data keeps its `9ZZ` units.

**What was built:**
- Migrations **0137** `pms_payer_billing_terms` (per payer account: `contribution_mode` `per_case|per_visit`) and
  `pms_case_billing_terms` (per case, NULL = as the account), **0138** `pms_invoices.per_visit_contribution_pence`
  (kept on both halves of a per-visit split so the invoice reads the same after the case/account changes). Postgres
  twins. No row = excess per case. The **amount stays the case's `excess_pence`** (labelled per mode on the form).
  Billing range used: 0130–0138 (0139 free).
- Logic: `src/modules/pms/billing/excess.ts` (`patientShares`, `effectiveContributionMode`, wording);
  `src/server/repos/pms/billing/contribution-terms.ts`; `createDraftInvoice` (invoices.ts): a treatment line the
  patient's part covers in full moves to the patient's invoice as an `excess` line **with its appointment** (billed
  once, to the patient); partly covered lines stay on the insurer's invoice less one deduction line; if every line
  moves, **no payer invoice is made** (`invoice` = the patient's). Per visit: one "Patient contribution – …" line per
  visit; contributions never use up a case's excess (`excessBilledForCase` ignores per-visit invoices).
  `priceVisits` / Attended-not-invoiced use the same split ("contribution £20.00", "(patient pays it all)", the
  preview makes no £0 invoice).
- Screens: invoice detail wording per mode (heading "Insured visit – patient contribution per visit" vs "… split
  between patient and insurer", an explanation line with amount and insurer, "Patient contribution · INV…" /
  "Patient excess · INV…", column "Contribution" / "Excess", and for a fully covered visit "Nothing claimed from
  <insurer>: the patient's excess/contribution covers this visit in full."); print column; **Billing → Payer
  accounts** (`/app/clinic/billing/payers`, minimal – no insurer-account screen existed: billing.view reads,
  `settings.setup` changes); case form "How the patient's part is billed" (As the payer account (…) / Excess per
  case / Patient contribution per visit), saved by billing after the case (`patients.edit`), case page shows
  "Patient's part billed as". Audit codes `pms.payer_terms.set`, `pms.case_terms.set`.
- Tests: repo suite (both modes, account + case override, no-£0 in both modes, authorisation value untouched,
  clinic isolation) and service suite (permissions, Attended-not-invoiced figures, invoice visits → 3 invoices, no
  payer invoice for the covered visit, detail view) on SQLite, PGlite, the D1 stand-in and local workerd D1; pure
  tests. The old repo test's excess went 100.00 → 50.00 so it stays a partial split.

**Results (on `bf6e6f9` = `f732a11`):** typecheck, lint green; test:pms 420/420; test:medreport 1777/0/3; test:db
820/0/3; test:auth 134/0; test:site 123/0; test:gateway 491/0/2; build green. E2E on fresh `pms:seed-demo -- --fresh`
scratch SQLite (ports 3190–3192, servers stopped): **pms-billing-screens 21/21** (new: payer accounts, case form
per visit £20 + excess £900 covering a visit, invoice both → 3 invoices, no £0, detail in both modes, axe clean),
pms-prototype-a 10/10 (13:42 GMT), pms-diary-screens 24/24 (13:44 GMT; its "next hour" step now picks a slot free
for 45 minutes – it had picked a 15-minute gap and the booking form defaulted to a 45-minute assessment). Both
diary/prototype need the clinic's opening hours and a free slot within the hour.
Screenshots: `/private/tmp/claude-501/-Users-khuram-Projects-Appstackx-bh2-handover/ef471414-85b1-422d-bf98-018c56c69aec/scratchpad/k2design/out-billing2/`
(`1440-invoice-detail-per-visit-insurer.png`, `…-per-visit-patient.png`, `…-per-case-covered.png`,
`…-per-case-insurer.png`, `1440-payer-accounts.png`, `1440-case-form-contribution.png`).

**Notes / open:** the demo seed leaves every account on "excess per case" (the e2e sets Kestrel to per visit through
the screen); the diary's payer label still says "– excess £x" in both modes (diary-owned, cosmetic); the full
payer-account editor belongs with Set-up (M8). `feat/cs-comms` also edits `invoice-detail.tsx` – expect a small
merge there when M6 merges.

## 15. M6 messages (28/10/2026) – DONE, merged into `feat/clinic-system`

**Heads (all pushed; `main` untouched):** `feat/cs-comms` `8213dd4` · `feat/clinic-system` **`d1f350b`** (merge of
`feat/cs-comms`, tree identical to it; includes the billing follow-up `f732a11`, merged into cs-comms first) ·
`feat/cs-diary` `f59a9c8` · `feat/cs-records` `b955bb7` · `feat/cs-billing` `eb15d98` (merged back; typecheck +
test:pms 480/480 each).

| Commit on `feat/cs-comms` | What |
|---|---|
| `8f8148a` | `feat/clinic-system` `0acf07c` merged into the October draft (no conflicts) |
| `aff353b` | Back end reviewed and finished (see 15.1, 15.2); migrations 0140/0141 edited **in place** (they were never on the K2 line or a server DB) |
| `51677c3` | Diary → messages hook (`src/server/pms/diary/message-sync.ts`, called from `diary/writes.ts`) |
| `0bc49da` | Seed `scripts/pms/seed-comms.ts` (from `seed-demo.ts` after billing) |
| `b3c5d10` `e48d1a9` `5bfc0cb` `9640c37` `ac12d6b` | View models + letter follow-ups; shell nav **badge** (foundation shell, own commit); screens; billing buttons; e2e, `comms.md`, designs, contract line |
| `1c72f40` merge, `8213dd4` | `feat/clinic-system` `f732a11` (billing follow-up) merged in (no conflicts); shell e2e nav list |

### 15.1 Review findings on the October draft (fixed)
1. **Audit after the write** (settings, template / rule / letter updates, finalise / sent / void, reply dealt with,
   delivery receipts, opt-out cancellations): now one batch with a conditional audit INSERT (`commsAuditWhen`,
   `src/server/repos/pms/comms/shared.ts`), as billing. Claims of planned rows (processing ↔ pending) stay unaudited
   bookkeeping; every claimed row ends in an audited batch; the give-up after 5 attempts is audited.
2. **No site scope / no permission layer**: new `src/server/pms/comms/{views,writes,billing-mail}.ts` – permission
   first (`messages.send`, `messages.templates`, `messages.letters` – never reception, a lock), `actor.siteIds` on every
   list and read (`patientSiteFilter` via `inPatientScope`), ids read back, zod, plain errors.
3. **Consent too blunt**: per kind now – STOP = no texts (+ one confirmation text); the stop-emails link stops
   reminder / follow-up emails only (confirmations, change notices, invoices still go – design round 3 wording).
4. **Run trusted the snapshot only**: the run re-reads the diary status (`appointmentStatuses`) and skips a
   reminder / confirmation of an appointment no longer booked.
5. Missing: late-cancellation and DNA messages, waiting-list offers, Retry, held-for-quiet-hours flag, letter
   signature, documents linked to messages, letter titles in lists (plain `template_name`; subjects stay encrypted).
6. Wording from design round 3: clinic short name (the SMS sender), "Reply C to cancel" (C = cancel now, not
   confirm), "STOP to opt out", no product name; merge fields never carry clinical detail (appointment context).

### 15.2 What is built (by requirement)
- **COMMS-002** diary hook: book (confirmation only if "Send confirmation text and email" – `confirmation_requested`),
  rebook, move (moved notice; if the confirmation has not gone yet, the confirmation for the new time instead),
  resize / details (refresh), status (arrived etc. cancel reminders; DNA → follow-up 1 h after), cancel (cancelled /
  late-cancelled notice), series cancel (no notices), waiting-list "Offer slot by text" (sends the offer).
- **COMMS-003/004** reminder rules, quiet hours (UK time), outbox / test providers only; cron route with CRON_SECRET.
- **COMMS-008/009/010/011** Messages page (`/app/clinic/messages`): outbox (Today line, filters, View, Retry, "Send due
  messages now"), replies (thread, answer by text/email, dealt with), templates (owner/admin edit, merge-field chips,
  count, preview), letters (titles; open with messages.letters), send a message (channel with reasons, marketing only
  opted-in); Message settings (`/messages/settings`); record **Messages tab** + record "Send message" (`?send=1`);
  nav badge = replies waiting; patient-facing page (`/messages/patient-view`). Stop-emails link page.
- **LTR-001/003/004/005** letters: `/letters/new?patient=` → editor (`/letters/[id]`: recipient, merge fields filled on
  save, Edit / A4 preview, Save draft, Print / Download PDF = print page, Sign (to post), Sign and send by email,
  Withdraw) → signature line "Name, Profession · HCPC number" from the signer's practitioner record.
- **Billing hooks**: Email (invoice), Text payment link, emailed receipt in Take payment, Email statement.
- **Dashboard data source (M8)**: `failedMessagesSummaryFor(actor)` in `src/server/pms/comms/views.ts`.
- Docs: `docs/clinic-system/comms.md`; designs `docs/clinic-system/design/round3/messages/` (+ README section);
  contract §3: comms owns `src/app/api/clinic-messages/**`.

### 15.3 Route placement (decision, implemented)
The three sessionless endpoints stay together, comms-owned: `src/app/api/clinic-messages/{cron,sms,unsubscribe}` – thin
wrappers over `src/server/pms/comms/{cron,webhook,unsubscribe}.ts`. Not `/app/clinic` (needs a session), not portal's
public group, not ClinForms' `/api/cron`. **No vercel.json entry** (Hobby = one run a day; `*/15` would fail the
deploy) – Khuram to choose Pro or a Cloudflare cron calling the route; until then "Send due messages now".

### 15.4 Results
Full chain on the merged tree: typecheck, lint green; test:pms 480/480; test:medreport 1777/0/3; test:db 880/0/3;
test:auth 134/0; test:site 124/0 (nav test: Messages + badge); test:gateway 519/0/2 (incl. **pms-comms-stack** 28/28 –
stand-in + local workerd D1); build green.
E2E (each on a fresh `pms:seed-demo -- --fresh` scratch SQLite, port 3195, servers stopped; runner in the session
scratchpad creates clinic B for the shell script): **pms-messages-screens 18/18** (axe clean, 375 px), clinic-system-shell
10/10, clinic-system-access 13/13, pms-records-screens 17/17, pms-diary-screens 24/24, pms-prototype-a 10/10,
pms-billing-screens 21/21 (with `stripe-test-stub.cjs`). The diary / prototype "seen" steps still need clinic hours
(they book within the next hour). Messages e2e server env: `CLINIC_SMS_PROVIDER=test CLINIC_EMAIL_PROVIDER=test
CRON_SECRET CLINIC_SMS_WEBHOOK_SECRET APP_ORIGIN`. Screenshots:
`/private/tmp/claude-501/-Users-khuram-Projects-Appstackx-bh2-handover/ef471414-85b1-422d-bf98-018c56c69aec/scratchpad/k2design/out-messages/`.

### 15.5 Differences from the design
Merge fields are `{{patient.first_name}}` chips (labels on hover), not `{first_name}`; lists show what a message is for
("Reminder · Fri 30/10 at 11:45"), not its text (encrypted; "View" opens one) – the replies list likewise shows the
intent, the thread the text; no "Manage booking" / "Add to calendar" / manage links (portal M7) – texts say "call
<site phone>"; no "Schedule" on Send a message (sends now); no "Opted out of texts – sent by email instead" fallback for
reminders (skipped with the reason); late-cancel text says "a fee may apply" without the amount; letter editor is plain
text ("- " bullets, blank-line paragraphs) without the rich-text toolbar; template list shows clinical / not clinical
by recipient, all letters need messages.letters; "Download PDF" = print page (Save as PDF); urgent closures "send
anyway" in quiet hours not built.

### 15.6 Open items
- Scheduling of the run (15.3); live providers K2-COMMS-005/006 (gate B, DPA); delivery receipts only via the test webhook.
- "Send message" from the diary's appointment drawer (COMMS-011 partial); bulk / recalls (COMMS-012, Later).
- Letters: Word output and the integration engine (LTR-002/007, M9); discharge letter from the discharge note
  (LTR-006); `{{latest_outcomes}}` field; portal sharing (M7).
- Portal's own outbox (`pms_portal_messages`) → comms (§7.3, M7) – the `portal_link` template is ready.
- Diary write + message sync are two batches: a failed sync is logged and covered by the run's status check (no reconcile job).
- Reception may see letter-email rows in the outbox (address, "Letter"), not their text.

### 15.7 Decisions for Khuram
1. Cron for the message run: Vercel Pro `*/15` or a Cloudflare cron (route ready, CRON_SECRET).
2. Stop-emails link stops reminders only – confirmations and account emails still go (as the design says) – OK?
3. "C" = cancel (design) – YES confirms; a cancel request goes to a person, the diary never changes by itself – OK?
4. Moved before the confirmation went → the confirmation for the new time, no "moved" notice – OK?
5. DNA follow-up on by default (setting), up to 24 h after; waiting-list offers are sent at once (ignore quiet hours).
6. Migrations 0140/0141 edited in place before first merge – fine since never applied anywhere?

### 15.8 Next
**M7 Online booking + portal + intake** (portal branch): diary adapter for the portal's bookings, portal outbox → comms
(`sendDocumentMessage` / templates incl. `portal_link`), public pages, Prototype B e2e.

## 16. M7 online booking + portal + intake + patient questionnaires (28/10/2026) – DONE, merged into `feat/clinic-system`

**Final heads (all pushed; `main` untouched):** `feat/cs-portal` **`9e008fb`** · `feat/clinic-system` **`caa9b4d`** (merge
of `feat/cs-portal`, tree identical to it; `feat/clinic-system` had not moved since `d1f350b`) · merged back:
`feat/cs-diary` `6c36133`, `feat/cs-records` `169d944`, `feat/cs-billing` `b968b06`, `feat/cs-comms` `c378fc9` (trees
identical to `caa9b4d`; typecheck + test:pms each – see 16.6).

**Midpoint state (kept for the record):** `feat/cs-portal` **`6f3320f`** = `feat/clinic-system` `d1f350b` merged in
(`dffa6f6`, no conflicts) + `572ac44` (comms: offer texts respect quiet hours) + `6f3320f` (portal back end). Worktree
`/Users/khuram/Projects/Appstackx/clinforms-wt/cs-portal` (npm ci done incl. workers/data-gateway; `.env.local` copied
from cs-comms). test:pms green; portal suite 17/17 on SQLite, PGlite, D1 stand-in, local workerd D1.
**Not yet done at midpoint:** screens (public route group, portal, staff set-up / intake builder / record Forms tab /
Overview card / outcome send), seed `seed-portal.ts`, e2e `pms-prototype-b.cjs` + `pms-portal-screens.cjs`, designs
commit, full chain, merges. If you pick this up: continue from `6f3320f` on `feat/cs-portal`.

### 16.1 Decisions (Khuram, 28/10/2026) – recorded here
- **M6 follow-ups:** (5) waiting-list offer texts MUST respect quiet hours – DONE in `572ac44` (held as `queued` with
  `hold_until`, migration 0142, released by the message run; email offers never held; a slot before quiet hours end
  goes by email or is refused as too late; suite test). DNA follow-up on by default (as built); "stop emails" stops
  reminder emails only (as built – note: it also stops offer emails and staff-written emails, since only booking
  notices, invoices, receipts, statements, letters and the portal sign-in count as transactional); C/NO replies go to a
  person, no auto-cancel (as built); a move before the confirmation went sends the confirmation for the new time (as
  built); in-place edits of never-applied 0140/0141 were OK.
- **(1) Scheduled message run:** a free **Cloudflare cron** (Workers Cron Trigger, e.g. `*/15 * * * *`) that calls
  `POST /api/clinic-messages/cron` on the app with the `CRON_SECRET` bearer header. Plan only: a tiny Worker
  (`scheduled()` → `fetch(APP_ORIGIN + "/api/clinic-messages/cron", { headers: { authorization: "Bearer " + CRON_SECRET } })`)
  with `CRON_SECRET` as a Worker secret; no vercel.json entry. **Nothing deployed to Cloudflare or Vercel** – do it only
  with Khuram's go at go-live. Until then "Send due messages now" on Messages.
- **Online booking distance** ("0.8 miles") shown ONLY after the patient taps "Use my location" or enters a postcode,
  computed in the browser from the sites' map positions (new `pms_booking_sites.lat_e6/lng_e6`); nothing about the
  patient is sent or stored. Without it the sites are listed by name with the next available time.

### 16.2 Review findings on the October draft (fixed in `6f3320f`)
1. **Two appointment stores** – online bookings were portal rows with their own clash trigger. Now every online booking
   is a diary appointment (`pms_appointments.source = online`) booked by the diary's own `bookAppointment` through the
   diary's adapter for the portal's port (`src/server/pms/diary/portal-adapter.ts`); `pms_online_bookings` keeps only
   reference, channel, patient match and the manage-link hash, written in the SAME batch (new `BookOptions.alsoWrite`).
2. **Two opening-hours sources** – `pms_booking_hours` dropped; slots are the diary's `findFreeSlots` (rota windows
   marked "online", minus appointments and blocked time incl. closures) within notice / horizon. New
   `pms_booking_sites` (on/off per site + map position).
3. **Own outbox** – `pms_portal_messages` dropped; sign-in links through comms (`portal_link` template via
   `sendDocumentMessage`); confirmation / cancelled / late-cancelled / moved notices are the diary hook's appointment
   messages; the portal runs the due messages straight after a patient's write so the confirmation is in the outbox.
4. **Audit after the write** (settings, account status, sign-out, shares, intake update / submit / cancel / review /
   apply) – now one batch with a conditional audit row (`portalAuditWhen`, `src/server/repos/pms/portal/shared.ts`).
5. **Late cancellation refused** – now allowed and recorded as the diary's `late_cancelled` with the fee flag (design:
   "Cancel and accept the fee"); a MOVE inside the notice is refused ("call the clinic").
6. Sign-in by **email only** (design) with the same answer for everyone; links 15 min (patient asked) / 72 h (staff
   sent with a form), single use, hash only.
7. Migrations 0150–0152 **edited in place** (never applied anywhere – same reasoning as 0140/0141).

### 16.3 Commits on `feat/cs-portal`
| Commit | What |
|---|---|
| `dffa6f6` | `feat/clinic-system` `d1f350b` merged into the October draft (no conflicts) |
| `572ac44` | Comms: waiting-list offer texts respect quiet hours (0142 `hold_until`, release in the message run) |
| `6f3320f` | Portal back end: online bookings = diary appointments (adapter + `alsoWrite`), sites table, comms instead of the portal outbox, batched audits, late cancellation, email-only sign-in, outcome questionnaires; suite rewritten |
| `2b42084` | Screens: public route group, staff set-up / intake builder / record Forms tab + signed copy, Overview card, Outcomes link; `next.config.mjs` + `src/lib/site.ts` (see 16.8) |
| `1a4b321` | Seed `scripts/pms/seed-portal.ts` (from `seed-demo.ts` after comms) + e2e `pms-prototype-b.cjs`, `pms-portal-screens.cjs` |
| `e2112dd` | Designs `docs/clinic-system/design/round3/portal/` (+ README, ZZ99 postcodes) and `docs/clinic-system/portal.md` |
| `9e008fb` | Shell nav test + shell e2e: Online booking and Intake forms under Set-up |

### 16.4 What is built (by requirement)
- **BOOK-001/002/003/004/005/007** – `/clinics/[clinic]/book` (6 steps at 375 px: where → what → who → when → details
  → confirm → booked; "Add to calendar" .ics; "Manage booking" link), `/clinics/[clinic]/booking/[link]` (+ `/move`,
  `/forms/[id]`), slots = the diary's `findFreeSlots` (rota windows marked online, appointments, blocks/closures) within
  notice/horizon; booking = diary `bookAppointment` (source online, confirmation requested) + `pms_online_bookings` +
  forms in one batch (`src/server/pms/diary/portal-adapter.ts`); messages via the diary→comms hook, run straight away;
  late cancel = diary `late_cancelled` + fee flag; staff **Set-up → Online booking** (`/app/clinic/online-booking`,
  `settings.setup`): switches, notice / horizon / step / free-changes hours, texts, per-site on/off + map position,
  types and practitioners offered, latest online bookings (new patient flag, Mark checked – `diary.book`).
- **PORTAL-001/002/003/005/006** – `/clinics/[clinic]/portal` (email-only sign-in, "Check your email", link page with a
  Sign in button, home: forms to complete, upcoming, shared with you), appointment page (late warning with the fee,
  cancel confirm, move), portal booking/move (`/portal/book[?move=]`), forms (`/portal/forms/[id]`), shared documents.
  **PORTAL-004** partial: portal pages done, no staff "share a document" screen yet.
- **FORM-002/004/005/006** – `/app/clinic/intake` (list, starter forms, new form) + builder `/app/clinic/intake/[form]`
  (questions, types, required, **Mark clinical**, copy-to-record mapping, sending, signature, Save draft / Publish);
  record **Forms tab** (`patients.view`: list; Send form – `patients.edit`, email + 72 h one-time portal link via comms;
  Send a questionnaire to the portal – `clinical.write`; portal access on/off) and the **signed copy** (sealed,
  signature panel, fingerprint, Mark checked, Copy to the record; clinical answers hidden without `clinical.view`,
  outcome questionnaires clinicians only); Overview **Forms card**. **FORM-007** partial (builder + mapping; no uploads /
  tablet mode).
- **Outcome questionnaires (NOTE outcomes):** patient copies without a template (`kind = outcome`), forms built from the
  records measures (NDI/ODI/NPRS/QuickDASH topics + a plain scale; PSFS from the patient's own activities of the latest
  PSFS), answered one question at a time, scored by records (`recordOutcome`) into `pms_outcome_measures`, linked back;
  the Outcomes page links "Send a questionnaire to the patient's portal" and marks "from the patient's portal".
- **NFR-003** done (noindex header + metadata on `/clinics/*`, limits per client / email / clinic, bot check ready, off).

### 16.5 Results
Full chain on `1a4b321`+ (code identical to `9e008fb` apart from the nav test): typecheck, lint green; **test:pms
529/529**; test:medreport 1777/0/3; test:db 929/0/3; test:auth 134/0; **test:site 124/0** (after the nav test update);
**test:gateway 555/0/2** (incl. **pms-portal-stack** – stand-in + local workerd D1 with wrangler-applied migrations); build
green. Portal suite 17/17 on SQLite, PGlite, D1 stand-in, local D1.
E2E on fresh `pms:seed-demo -- --fresh` scratch SQLite + a reports-only clinic (`harbour-clinic`), production build,
ports 3180–3184, servers stopped, run **21:20–21:30 GMT** (outside clinic hours): **pms-prototype-b 6/6**,
**pms-portal-screens 15/15** (axe clean at 375 and 1440), clinic-system-shell 10/10, clinic-system-access 13/13,
pms-records-screens 17/17, pms-billing-screens 21/21. Time-of-day failures (pre-existing, unrelated to M7):
pms-diary-screens 20/24 (the 4 steps that need today's future appointments / a free slot within the next hour),
pms-prototype-a 2/10 (its set-up needs a free 45 minutes within the next hour), pms-messages-screens 17/18 (step 13
Retry needs the seed's "failed" text, which the comms seed does not produce at this hour – the same with the M6 code
on cs-comms, checked). **Re-run those three in clinic hours.** Runner: `$SCRATCH/run-e2e-portal.sh <script> <port>
<outdir>` and `$SCRATCH/all-e2e-portal.sh` (scratchpad of this session).
Screenshots: `/private/tmp/claude-501/-Users-khuram-Projects-Appstackx-bh2-handover/ef471414-85b1-422d-bf98-018c56c69aec/scratchpad/k2design/out-portal/`
(`prototype-b/`, `portal/` – 375 px patient screens and 1440 px staff screens).

### 16.6 Merge-backs
`feat/clinic-system` `caa9b4d` merged into cs-diary `6c36133`, cs-records `169d944`, cs-billing `b968b06`, cs-comms
`c378fc9` (trees identical to `caa9b4d`): typecheck green and **test:pms 529/529** in each; all pushed.

### 16.7 Differences from the design
- No 10-minute hold of the chosen time (round 2g/2h): the time is re-checked against the diary at Confirm; a taken
  time says so and the times reload. Reception sees the booking only once it is made.
- "What's the problem?" is not asked on the booking page (it would be health information in a booking note reception
  reads) – the health questionnaire (clinical) asks it.
- Booked screen: "We've sent you a confirmation by text and email" without the addresses (a matched record's addresses
  must not show); reference format `K7M3-Q9TX`, not `NP-7H2KQ`.
- Distance from a typed postcode: placed at a site of the same postcode district (no lookup service – nothing is sent);
  another district gets "use your location". "Use my location" works anywhere.
- Inside the notice period only Cancel (with the fee) is offered; "Move" says call the clinic.
- Builder: sending = "with a new patient's first online booking / every online booking / only when staff send it"; no
  "2 days before", no reminder, no per-site use, no "Preview as patient"; the signed copy has no "Download PDF".
- Prototype B: no diary-wide activity feed or toast – the drawer's activity line "Booked by the patient online …".
- The clinician's tabbed outcome screen (round 3 Outcome) is not built: records' Outcomes page + "Send a questionnaire"
  on the Forms tab. Patient questionnaires use topics + a plain scale (no licensed wording).

### 16.8 Open items
1. Files outside the portal's ownership changed (smallest change, need Khuram's OK): `next.config.mjs` – `/clinics/*`
   gets `X-Robots-Tag: noindex` and `Permissions-Policy: geolocation=(self)` (the site-wide `geolocation=()` blocked
   "Use my location"; ClinForms paths unchanged); `src/lib/site.ts` – `/clinics` is an app area (no cookie banner, no
   analytics pageviews); the diary's `BookOptions.alsoWrite` and `portal-adapter.ts`; the records Overview Forms card
   and the Outcomes link; comms `sendDocumentMessage` accepts `portal_link`.
2. Staff "share a document with the patient" screen (PORTAL-004); completing a form in the clinic (tablet, verified).
3. PDF of the sealed signed copy; "Preview as patient" in the builder.
4. Postcode distance needs a postcode-district centroid table (ONS, OGL, ~3,000 rows) to work for any postcode.
5. Live email (gate B): sign-in links reach patients only once email is live; the Cloudflare cron (16.1) not deployed.
6. Portal conditional audit rows key on the write's time (as comms/billing key on write ids): two identical writes in
   the same millisecond could both audit – low risk; a `write_id` column would close it.
7. Insured patients booking online (BOOK-009, Later), deposits (BOOK-008, Later).
8. Re-run pms-diary-screens, pms-prototype-a and pms-messages-screens in clinic hours on the merged line.

### 16.9 Decisions for Khuram
1. Distance from a typed postcode: bundle the ONS postcode-district centroids (OGL, no service called), or keep "same
   district + Use my location"?
2. The 10-minute slot hold of the design: build it (a short-lived diary hold reception sees) or keep "re-check at
   Confirm"?
3. "What's the problem?" moved from the booking page into the health questionnaire (clinical) – OK?
4. Staff-sent form links last 72 hours (single use); patient-requested links 15 minutes – OK?
5. Outcome questionnaires in the portal use section topics + a plain scale (no licensed wording, Q-K8) and show the
   patient their score – OK until the licences are checked, or hold the feature?
6. Approve the shared-file edits in 16.8 item 1 (next.config.mjs, src/lib/site.ts).
7. Inside the notice: patient may cancel online (late, fee flagged) but not move – OK?
8. Online booking matches an existing record only on email + date of birth + last name; anything else makes a new
   record for staff to merge (flagged "New patient" on Set-up → Online booking) – OK?

### 16.10 Next
**M8 Set-up + reports + dashboard** (reporting branch, drop its staff-access tables in favour of cs-access; set-up
sub-pages without design; dashboard per role incl. billing money tiles and `failedMessagesSummaryFor`).

## 17. M8 set-up + reports + dashboard (28/10/2026) – DONE, merged into `feat/clinic-system`

### 17.1 Decisions (Khuram, 28/10/2026 – M7 follow-ups) – recorded here, implemented in M8
1. **Postcode distance:** bundle the ONS postcode-district centroid list (Open Government Licence v3.0) as a small
   static file – no external calls; attribution line on the booking page and in docs. Built:
   `src/modules/pms/portal/data/postcode-districts.json` (2,863 GB districts, mean of live postcodes in the ONS
   Postcode Directory Aug 2026, 3 decimals, 64 KB; Northern Ireland BT left out – its data needs a separate LPS licence
   for commercial use) + `postcode-districts.SOURCE.md`; loaded as its own chunk on first use; the patient's postcode
   never leaves the browser. Attribution under the sites list on `/clinics/[clinic]/book`.
2. **Keep re-check at Confirm** (no 10-minute hold).
3. **"What's the problem?"** stays in the health questionnaire.
4. **Portal links:** staff-sent 72 h, patient-requested 15 min (as built).
5. **Portal questionnaires** keep plain wording and show the score until the licences (Q-K8) are checked.
6. **M7 shared-file edits approved** (next.config.mjs `/clinics` noindex + geolocation=(self), `src/lib/site.ts` app
   area, diary alsoWrite/adapter, records card, comms portal_link).
7. **Late cancel online allowed** with the fee flag; no move inside the notice (as built).
8. **Existing-patient match only on email + DOB + surname**, otherwise a new record flagged for merge (as built).

### 17.2 Midpoint (28/10/2026 ~22:30 GMT)
- `feat/cs-reporting` **`5ebd9c3`** (pushed) = the October draft `dbb7bb0` + `feat/clinic-system` `caa9b4d` merged in
  (no conflicts). Everything below is **uncommitted in the worktree** at the midpoint (`npm ci` done there incl.
  workers/data-gateway; `.env.local` copied from cs-portal). If you pick this up: `git -C …/cs-reporting status` –
  commit what is there in logical groups after `npx tsc --noEmit -p .` and `npm run test:pms` pass.
- Done so far: migration **0160 edited in place** (never applied anywhere): the draft's `pms_staff_access` /
  `pms_staff_sites` dropped (site access = access module's `pms_member_sites`, `actor.siteIds`); kept
  `pms_site_hours`, `pms_site_closures`; added `pms_reporting_settings` (utilisation target %, DNA target in tenths).
  The draft's staff-access repo/server/actions deleted; `src/modules/pms/reporting/site-scope.ts` + `scope.ts` build
  the scope from `actor.siteIds`.
- **Test clock** (`src/modules/pms/core/clock.ts`): `PMS_TEST_CLOCK=1 PMS_TEST_NOW=<ISO> PMS_TEST_NOW_SET_AT=<epoch ms>`
  shifts the clinic system's clock (runs at real speed; seed, dev server and e2e script share it); honoured only when
  `NODE_ENV !== "production"` (Next inlines that, so a production build drops the code); `clock.test.ts` proves a
  production NODE_ENV ignores it. All PMS server code, repos' `now`, seeds and `ukToday()` use it; sign-in/TOTP keep
  the real clock. The three time-dependent scripts read it (`clockNow()`); run them on `next dev` with the clock at
  10:30 London today (runner: scratchpad `run-e2e-m8.sh <script> <port> <out> dev`). Comms seed: its history (and the
  failed text for Retry) no longer depends on the hour. First run at 21:50 GMT: pms-diary-screens 22/24 (the 2 fails
  were the dev server reloading mid-run while files were edited).
- Shell: main list ends with **Reports** and one **Set-up** entry; set-up pages of every module form the Set-up
  section's list ("← Clinic navigation", design round 2c, own icons, `SETUP_ORDER`); reception keeps "Practitioner
  rotas" in its main list (no Set-up area); nav entries may name several permissions (Reports = own or all);
  "Overview" → "Dashboard" (the start page is now "Today"). Nav tests + shell/access/diary e2e updated.
- Dashboard ("Today" per role) built: `src/server/pms/reporting/dashboard.ts`, `src/components/pms/reporting/dashboard.tsx`,
  `src/app/app/clinic/page.tsx`, `src/server/repos/pms/reporting/dashboard-figures.ts`.
- Diary payer label per billing mode ("– patient pays £20.00 a visit" for per-visit contribution).
- Running in parallel (same worktree): Set-up pages + one opening-hours source (diary availability clipped to site
  hours/closures) + billing settings (0139 bank details) – and Reports (sources, pages, CSV, fact-check suite, D1).
- Not yet: e2e `pms-setup-reports.cjs`, full chain, merges, designs commit, requirements statuses.

### 17.3 Final heads (all pushed; `main` untouched)
`feat/cs-reporting` **`e717370`** · `feat/clinic-system` **`9b97f96`** (merge of `feat/cs-reporting`, tree identical;
`feat/clinic-system` had not moved since `caa9b4d` – M9 had not merged yet, so M9 merges second and takes M8 in first) ·
merged back (trees identical to `9b97f96`, typecheck + test:pms 597/597 each): `feat/cs-diary` `229e81c`,
`feat/cs-records` `c5fcefc`, `feat/cs-billing` `7622c8e`, `feat/cs-comms` `b90eacd`, `feat/cs-portal` `631c2f6`.

| Commit on `feat/cs-reporting` | What |
|---|---|
| `5ebd9c3` | `feat/clinic-system` `caa9b4d` merged into the October draft (no conflicts) |
| `f6f97f5` | Test clock (`pmsNow()` in all clinic-system server code, repos' `ctx.now`, seeds); comms seed history at any hour; removes the draft's pages/staff-access code (intermediate tree does not build alone) |
| `d751256` | Reports back end + pages (0160 edited in place) |
| `0d57c68` | Set-up pages + one opening-hours source + billing bank details (0139) + demo hours/closures |
| `fb57d0c` | Shell Set-up / Reports sections, Dashboard start page, nav tests, contract, e2e nav updates |
| `c03f988` | "Today" per role; diary payer label per billing mode; idempotent diary site-cookie and reply-thread effects |
| `ce90c57` | Bundled ONS postcode-district centres + attribution (decision 1) |
| `e717370` | e2e `pms-setup-reports.cjs`, designs `docs/clinic-system/design/round3/setup-reports-dashboard/`, `reporting.md` |

### 17.4 Review findings on the October draft (fixed)
1. **Own staff-access tables** (`pms_staff_access`/`pms_staff_sites`) duplicated the access module – dropped (0160 edited
   in place, never applied anywhere); every scope is `actor.siteIds`.
2. **Old permission ids** (`reports.view`, `settings.manage`, `directory.edit`) → `reports.own|all|export`, `settings.setup`,
   `settings.members`, `settings.import`.
3. **Two opening-hours notions** (reporting's hours only fed utilisation; diary/portal used rota windows alone) – now
   `availabilityWindows` clips every rota window to the site's hours and drops closure days, so diary shading, free
   slots, booking check, online booking and utilisation agree. A site with no hours rows = not limited (existing data);
   "closed every day" is refused (switch the site off or add a closure).
4. **No data sources registered** – reports read nothing from the diary or billing; now a diary source and a billing
   source (aggregated SQL in the owning module, registered by default), fact-checked again in reporting.
5. `reporting-repos.test.ts` ran nothing – now runs the suite on SQLite + PGlite; D1 stack runs repo + service suites.
6. Draft set-up pages had no design pattern and missed practitioners/referrers/records/staff – all rebuilt (below).
7. Found while testing: a new price list could overwrite the default list when the form was typed into before the page
   switched (test race – the e2e now waits; the page keys the form by list); price items reset on refresh (fixed); the
   seed's payment instructions duplicated the new bank line (seed moved to the bank fields, lines de-duplicated); the
   diary's site-cookie effect and the reply thread's load were not safe with React's double effects (fixed – dev only).

### 17.5 What is built (by requirement)
- **SITE-003** one opening-hours source (above); **SITE-004** scope everywhere incl. reports, CSV, dashboard (e2e).
- **ADM-001** Set-up (`/app/clinic/setup/*`, `settings.setup`, audited, tenant-scoped; site-specific writes need the site
  in scope, clinic-wide need every site): Sites and hours (design round 2c – list + details + weekly hours + closures,
  Add site with default hours Mon–Fri 08–20, Sat 09–13), Rooms, Services (duration, buffer, price, bookable online),
  Price lists (incl. an insurer's own list, items), Referrers and insurers (+ payer-account editor: "How the patient's
  part is billed" per case / per visit, the clinic's account terms, the payer's lists), Practitioners (link a member's
  sign-in – §13.4/1 closed; bookable / bookable online; rota link; signing details stay on Member access), Record
  templates (note templates + retention, upward only), Billing settings, Report targets, Audit trail, Import data
  (placeholder for M9). Staff access, Roles and permissions, Online booking, Intake forms, Practitioner rotas and Message
  settings now sit in the Set-up section list. `/app/clinic/setup` opens the first page the member may open.
- **ADM-002** member ↔ practitioner link on screen; **ADM-005 / BILL-013** billing settings screen incl. bank details
  (`pms_billing_settings.bank_details_json`, 0139) printed on invoices and statements; **AUD-003** audit search + CSV.
- **REP-001** "Today" per role (`/app/clinic`, design round 3, 1440 + 375 px, refreshes every minute; tiles only for
  who may see the data; per-tile "Couldn't load"): owner/admin – appointments today, utilisation by site vs target,
  taken today by method, overdue invoices (Payment link / Send reminder), failed messages (Retry), authorisations ending
  soon (Request extension = a letter); clinician – my next patients, unsigned notes, outcome measures due (first visit
  or every 4th session), open cases; reception – arrivals (Arrived), waiting list (Book), invoices to raise, replies.
- **REP-002/003/005/006** Attendance and DNA, Utilisation, Caseload, Revenue, Debtors, Authorisations (design round 2c):
  period chips (This week / Last 6 weeks / This quarter / Custom), site / practitioner / service filters, three figures,
  chart, tables, Export CSV (`reports.export`, formula-safe, audited `pms.report.export`); clinicians with
  `reports.own` get Attendance / Utilisation / Caseload for their own practitioner only; in treatment counts as
  arrived = attended; Completed = attended. Reports section in the shell (Appointments / Clinical / Finance).
- Diary payer label per billing mode ("– patient pays £20.00 a visit"); decision 1: ONS district centres bundled.

### 17.6 Test clock (how the three time-dependent scripts became deterministic)
`src/modules/pms/core/clock.ts` – see §17.2 and `reporting.md` "Test clock". Proof it never runs in production: the
guard is `process.env.NODE_ENV === "production"` (inlined by Next.js at build time), `clock.test.ts` checks a production
NODE_ENV ignores it, and a grep of the production build (`.next/server`, `.next/static`) finds **0** occurrences of
`PMS_TEST_NOW`. Runner (scratchpad `run-e2e-m8.sh <script> <port> <out> dev`) seeds and starts `next dev` with the
clock at 10:30 London today.

### 17.7 Results
- Full chain on `e717370` (= `9b97f96`): typecheck, lint green; **test:pms 597/597**; test:medreport 1777/0/3; test:db
  997/0/3; test:auth 134/0; **test:site 125/0**; **test:gateway 591/0/2** (incl. **pms-reporting-stack** 36/36 – stand-in
  + local workerd D1); build green (re-built after the last dashboard tweak).
- E2E, each on a fresh `pms:seed-demo -- --fresh` scratch SQLite + reports-only clinic B, port 3185/3186, servers
  stopped, run 22:27–22:55 GMT (outside clinic hours): with the TEST clock on `next dev` – **pms-diary-screens 24/24**,
  **pms-prototype-a 10/10**, **pms-messages-screens 18/18**, **pms-setup-reports 13/13** (new; axe clean); production
  build – clinic-system-shell 10/10, clinic-system-access 13/13, pms-records-screens 17/17, pms-billing-screens 21/21
  (stub), pms-prototype-b 6/6, pms-portal-screens 15/15, and pms-messages-screens 18/18 again (now passes at night
  without the clock too – the seed fix).
- Screenshots: `/private/tmp/claude-501/-Users-khuram-Projects-Appstackx-bh2-handover/ef471414-85b1-422d-bf98-018c56c69aec/scratchpad/k2design/out-setup/`
  (`setup-reports/` – 1440 set-up pages, every report, dashboard per role, admin limited to one site, 375 dashboards /
  report / set-up, booking times following the hours, invoice print with bank details; plus one folder per script).

### 17.8 Differences from the design
Set-up: one opening session per day in the form (repo takes up to 3); Services have no note-template column; payer
card shows the clinic's account terms read-only (no per-payer terms in billing). Reports: Debtors uses billing's five
age bands; Utilisation adds a By-site table; Caseload has no "Avg sessions"; Revenue adds Received and by-payer; money
in pence; no previous-period comparison; filter chips are selects styled as chips. Dashboard: "done" = arrived + in
treatment + completed (as the Attendance report); overdue pill "Over 30 days"/"Overdue" (design "Over 24 h");
Request extension opens a new letter; waiting-list action is "Book" (no "Offer 14:00 by text" suggestion);
utilisation can show >100 % when appointments sit outside the (changed) hours; bottom tabs only on Today at 375 px.

### 17.9 Open items
1. K2-REP-004 new vs returning: loader + tests kept, no page (dropped from the six) – decision below.
2. Utilisation does not subtract leave blocks from rota time.
3. Admins cannot export CSV by default (access defaults) – as designed, note for demos.
4. Closure notice ("Closed – Christmas") not shown on the diary day view (slots are already gone).
5. Audit "patient" search by record id only (rows hold no names).
6. The demo seed's history is only this week (earlier weeks of the six-week charts are empty).
7. M9 (running in parallel, §18) puts Import under Set-up (`SETUP_ORDER` has `reporting.import` – replace or add).

### 17.10 Decisions for Khuram (defaults chosen and built – change any if you disagree)
1. Reception keeps "Practitioner rotas" in its main list and has no Set-up area; owners/admins find rotas under Set-up.
2. A site with no opening-hours rows is unrestricted; closing a site = switch it off or add a closure.
3. Dashboard "Request extension" = a new letter to the insurer (no request workflow).
4. New-vs-returning report: keep it out of the six (as now) or add a seventh page?
5. Outcome measures "due" = first visit of a case (no score yet) or every 4th attended session.

### 17.11 Next
**M9 integration** (native connector, "Complete referrer form", import) – running in parallel on `feat/cs-integration`;
it merges second, so it merges `feat/clinic-system` `9b97f96` in first and re-runs the chain (§18).

## 18. M9 integration (28–29/10/2026) – DONE, merged into `feat/clinic-system`

**Heads (all pushed; `main` untouched):** `feat/cs-integration` **`bbcce64`** · `feat/clinic-system` **`d2b3d59`** (merge of
`feat/cs-integration`, tree identical to it; `feat/clinic-system` was still at M8's `9b97f96`, already merged in).
M9b polish (`feat/cs-polish`) had not merged when this landed – whoever merges second merges the other in first.

| Commit on `feat/cs-integration` | What |
|---|---|
| `88981bf` | `feat/clinic-system` `caa9b4d` merged into the October draft `b7fd14d` (no conflicts) |
| `bf32e29` | Letters: one merge-field engine (LTR-007), `{{latest_outcomes}}`, `{{case.discharge_date}}`, discharge letter (LTR-006), Word/PDF output (LTR-002/005); insurer claims screen (BILL-011); `billing.md` |
| `8994e40` | Back end review fixes; native connector; Complete referrer form; filed forms; ClinForms hand-over/file-back; product switch |
| `afc18da` | `feat/clinic-system` `9b97f96` (M8) merged in (no conflicts) |
| `064862e` | Import screens under Set-up → Import data (replaces M8's placeholder; `reporting.import` in SETUP_ORDER) |
| `d1b8870` | Suite on 4 backends, 50,000-row import test, D1 stand-in at 2,000, demo seed `seed-integration.ts` |
| `ca8f080` `198e557` `bbcce64` | e2e `pms-integration.cjs`; column matching; neutral source wording for native reports; chain fixes |

### 18.1 Review findings on the October draft (fixed)
1. **Audit after the change** on every import batch transition (upload, map, approve, cancel, close, check/import/undo
   finish): now one batch with a conditional audit INSERT on the new revision (`batchAuditWhen`).
2. **No adapters wired** (records/diary/billing ports were null): records and diary adapters
   (`src/server/pms/integration/adapters.ts`); billing stays unwired – invoices can be CHECKED, not run.
3. **Clinical data to ClinForms for anyone**: the bundle now reads signed notes and outcomes only with `clinical.view`,
   the referral reason only with `patients.referral`; never drafts or notes entered in error.
4. **No undo window / undo semantics**: 7 days (design); patients and cases archived (import reference released),
   appointments the import made deleted only if unchanged and nothing points at them; anything changed is kept.
5. Missing pieces: `native-connector.ts`, glue registration, screens, repo suite, D1 test (all built now).
6. `"native"` in ClinForms' `ConnectorIdSchema` breaks the forward-compat guard (production cannot read such a report)
   – listed as `PENDING_SHIM_ON_MAIN` in `scripts/medreport/schema-forward-compat.test.ts` (see decisions).

### 18.2 What is built
- **Native connector (CF-001/002)** `src/server/pms/native-connector.ts`, registered in `src/app/api/_medreport-glue.ts`
  (`connectorRegistry()`: `get("native")` only, never in `list()`/tiles). Every call re-checks the signed-in member
  (same clinic, clinic-system package, `patients.view`, site scope); reads (`pms.native.bundle_read`) and filings
  (`pms.filed_form.create`) audited; in-process (no HTTP to itself).
- **Complete referrer form (CF-003/004)**: case page panel "Referrer and insurer forms" → "Complete referrer form" →
  picker of the clinic's ClinForms library (confirmed forms; the case's insurer/referrer's first) + consent tick →
  request recorded (`pms_form_requests`: form, title, clinical prefill, status) → in-process launch token →
  `/app/studio/new?lt=…&form=…` → Studio shows the hand-over banner ("Opened from … When you approve, the form is filed
  back on the case", "← Back to the record without filing") → approve → **filed automatically once** (native only;
  "Save to clinic record" stays for a retry) → `pms_filed_forms` (+ request marked filed in the same batch) → case
  panel and the record's **Forms tab** show "Approved by Priya Shah (PH-DEMO-03) on dd/mm/yyyy at hh:mm · PDF, n KB",
  View PDF (`clinical.view` only, audited `pms.filed_form.view`). Reception may start a form; ClinForms then gets no
  clinical prefill.
- **ClinForms changes (all guarded by connector "native" or the clinic package; other clinics unchanged):** file-back
  allowed for native, hand-over banner, auto-file, `clinicRecordUrl` for native → the case, "From clinic records" /
  "from the patient's record in the clinic system" wording, product switch bar above the Studio only for clinics with
  the clinic system; shell's ClinForms link now `/app/studio`.
- **Import (IMP-001…007)** Set-up → Import data (`/app/clinic/setup/import`, `settings.import`): kind + CSV (parsed in the
  browser, sent in parts of 500) → map columns (examples, CamelCase/abbreviated names matched) → check (Ready /
  Warnings / Errors, issues list, nothing written) → "Import N …" after ticking the issues were seen → progress page by
  page (resumes after reload) → Done with undo (7 days) → re-run finds every row already in the clinic. Kinds:
  patients, cases (payer, referrer, authorisation), appointments (into the diary; clash rows skipped); invoices check
  only. CSV templates per kind.
- **Letters**: see `bf32e29` (Word = pizzip-built .docx, PDF = @react-pdf with the bundled DejaVu font; buttons in the
  editor; `/app/clinic/letters/[id]/file?format=pdf|docx`, `messages.letters`, audited `pms.letter.download`).
- **Claims screen** `/app/clinic/billing/claims` (billing.view; download also reports.export).
- **Seed** `scripts/pms/seed-integration.ts` (from `seed-demo.ts`): Northfield + Harrow & Pike sample forms in the
  library (attested, files stored), Emily Turner (sim-int-001) / "Right shoulder – rotator cuff" / Northfield Assurance
  / NA-55021 / signed note / NPRS. The ClinForms demo-clinic flag (PH-DEMO numbers may approve) is set only by
  `npm run admin:set-demo-clinic -- --slug riverside-demo --on` (ClinForms staff only – the e2e runner does it).

### 18.3 Results
Full chain on `ca8f080`, then typecheck, lint, test:pms, test:db, test:medreport again on `198e557` (later commits change only tests, the seed and e2e; `bbcce64` = `d2b3d59`): typecheck, lint green; **test:pms 650/650**; test:medreport 1776 pass / 1 fail / 3
skipped – the fail is the known timing check `wc-fix2-store.test.ts` R2-SEC-2 (1020 ms vs 1 s under load; 19/19 on
rerun); **test:db 1050/0/3**; test:auth 134/0; test:site 125/0; **test:gateway 608/0/2** (incl. pms-integration-stack:
D1 stand-in + local workerd D1 + 2,000 rows); build green.
Import at scale: **50,000 patients on SQLite** upload 0.8 s, check+import 25 s, re-run check 6 s, undo 35 s; **50,000 on
PGlite** (measured once, `IMPORT_SCALE_PGLITE_ROWS=50000`): check+import 316 s, re-run 24 s, undo 135 s – the chain runs
PGlite at 5,000; D1 stand-in 2,000: check+import 0.8 s, undo 1.8 s.
E2E (fresh `pms:seed-demo -- --fresh` scratch SQLite, production build, ports 3190–3198, servers stopped):
**pms-integration 14/14** (three runs), pms-records-screens 17/17, pms-billing-screens 21/21 (stub), clinic-system-shell
10/10, pms-setup-reports 13/13 (dev + test clock, as M8 runs it; in prod mode its 375 px step timed out on
networkidle). **Forms regression vs `main`** (`forms-regression.cjs` on a build of `origin/main` cae0c3f and of this
branch, public demo, `compare-form-outputs.ts`): **all 5 files match** (2 PDFs identical, 3 Word files equivalent – only
ZIP container bytes differ).
Screenshots: `/private/tmp/claude-501/-Users-khuram-Projects-Appstackx-bh2-handover/ef471414-85b1-422d-bf98-018c56c69aec/scratchpad/k2design/out-integration/`.
Runner: scratchpad `run-e2e-m9.sh <script> <port> <out> [dev] [ENV=…]`; forms regression `forms-reg.sh <checkout> <port> <out>`
(a detached `origin/main` worktree at scratchpad `main-ref` – remove it with `git worktree remove` when convenient).

### 18.4 Differences from the design
- Picker shows the whole confirmed library (case's referrer/insurer first, "for this case" / "other referrer") rather
  than only the filtered forms; consent is a tick in the picker.
- ClinForms keeps its own review screen (questions, flags, approve dialog), not the design's single-column form; the
  hand-over banner and "Approve → filed to the case" behaviour are as drawn. "Send to insurer" on the filed form is not built.
- Import: no separate "Default site" field (site per row / practitioner's default); undone patients/cases are
  **archived** (references released), not deleted; no "Download skipped rows"; "Possible duplicate of X" warning by
  name + DOB not built (duplicates are by the previous system's reference).
- Letter editor stays plain text (no rich-text toolbar) – Word/PDF downloads added.

### 18.5 Open items
1. **Shim on `main` for connector id "native"** before the clinic system goes to production (forward-compat guard).
2. Invoices/opening balances import (billing port), reconciliation report (IMP-008), historic notes/documents archive
   (IMP-009), mapping saved per clinic (IMP-002), possible-duplicate warning, "Download skipped rows".
3. Imported future appointments get no confirmation/reminder messages (bulk insert bypasses the comms hook) – decide.
4. A clinic's own Word/RTF letter templates filled in their layout (rest of LTR-002); portal sharing of letters.
5. CF-006: usage counting is connector-agnostic in ClinForms (`api/usage.ts`) – no dedicated native usage test yet.
6. Studio launch skips `assertTenantMayCreate` (trial ended) at launch; the Studio's own create checks still apply.
7. pms-setup-reports 375 px step in prod mode (networkidle) – M8 owner to check.
8. `.env.local` of cs-integration replaced by cs-reporting's copy (original backed up in the session scratchpad).

### 18.6 Decisions taken (defaults implemented – Khuram to confirm)
1. Reception may start "Complete referrer form" but ClinForms gets no clinical notes/outcomes from their account.
2. Filed referrer forms are clinical: list visible with `patients.view`, file only with `clinical.view`.
3. Import undo: patients/cases archived (never deleted – contract), appointments deleted when untouched; 7 days.
4. "Import N" needs a tick that the issues were looked at (replaces the draft's staff sample check).
5. Native approval auto-files once (design "Approve and file to case").
6. 50,000-row PGlite run kept out of the everyday chain (8 min); SQLite 50,000 stays in.
7. `"native"` kept in ClinForms' enum with the guard exception rather than a new connector-id mechanism.

## 19. M9b polish (28–29/10/2026) – DONE, merged into `feat/clinic-system`

**Branches (`main` untouched):** `feat/cs-polish` from `feat/clinic-system` `9b97f96`, worktree
`/Users/khuram/Projects/Appstackx/clinforms-wt/cs-polish` (npm ci done incl. workers/data-gateway, `.env.local` from
cs-reporting). Two helper branches merge into it before the final merge: `feat/cs-polish-portal` (worktree
`clinforms-wt/cs-polish-portal` – items 6, 7, 8, 10) and `feat/cs-polish-rep` (worktree `clinforms-wt/cs-polish-rep` –
item 9 apart from the closure notice, plus utilisation ≤ 100 %). E2E ports 3170–3179. Runs in parallel with M9 (§18).

**Migration numbers ≥ 0180** (new `extra` ranges in `src/modules/pms/core/modules.ts`, contract §3): diary `0180`–`0181`
and `0189`, portal `0182`–`0185`, reporting `0186`–`0187`, records `0188`.

**Midpoint – done on `feat/cs-polish` `0cea140` (pushed):**
| Commit | What |
|---|---|
| `0d60865` | Contract: follow-up migration ranges |
| `715dc2a` | **Waiting-list offers hold their slot** (0180 `hold_until`, 0181 triggers on SQLite/D1 + Postgres: nobody else can book, move or block over an open unexpired offer, except the patient it is held for; expiry needs no job; decline/withdraw release it); hold length on offer (30 min – 1 day, default 2 h, never past the start; a text held for quiet hours moves the hold on); holds in the booking check, free slots / online booking, the diary grid ("Held for … until 14:20") and the waiting list (Book offered slot / Patient declined / Withdraw offer). **Closure notice** "Closed – reason" on the diary. **Diary blocks** fit every height (lines by height; alert / online icons join the Double-booked marker in the top line) |
| `1256ea1` | Diary drawer **Send message** (COMMS-011) – comms' own send form + templates in a dialog |
| `0cea140` | **Diary → messages sweep** (0189 `pms_diary_message_sweeps`): the message run (cron + "Send due messages now") re-syncs appointments changed since the last sweep, so a failed sync heals itself; a re-sync keeps pending notices that are still true |

Found already done in M5 (`94926a8`) and checked: items 1 (seen statuses only from 60 min before the start – rule,
server check in `setAppointmentStatus`, drawer, note screen's "Mark appointment as completed", dashboard Arrived), 3
(record Book → booking form with the patient, `?patient=`).

**Not yet done at midpoint:** merging the helper branches, e2e `scripts/e2e/pms-polish.cjs` + re-runs, full chain,
merge into `feat/clinic-system`, requirement statuses. If you pick this up: `git -C …/cs-polish log`, then check the
two helper branches on origin.

### 19.1 Final heads (all pushed; `main` untouched)
`feat/cs-polish` **`be0c412`** · `feat/clinic-system` **`842bb02`** (merge of `feat/cs-polish`, tree identical; M9
`d2b3d59` was merged into `feat/cs-polish` first – `8444c1d`, one conflict in the record Forms tab: kept M9's filed
referrer forms and the clinic-device button). Helper branches (merged into `feat/cs-polish`, kept on origin):
`feat/cs-polish-rep` `bc8d8ab`, `feat/cs-polish-portal` `5d3eb10`.

| Commit on `feat/cs-polish` | What |
|---|---|
| `0d60865` | Contract: follow-up migration ranges (`extra` in `core/modules.ts`, contract §3, contract test) |
| `715dc2a` `1256ea1` `0cea140` `3d768ac` | Diary items (midpoint table above) + e2e `pms-polish.cjs`; the diary hold's visible words are its accessible name |
| `ce2cf33` | merge `feat/cs-polish-rep` (`3ba66f3` reports, `4235a92` seed history + billing fix, `bc8d8ab` e2e + reporting.md) |
| `f3b5554` | merge `feat/cs-polish-portal` (`1a29cae` data 0182–0185, `bfae6ef` FORM-007 device, `9148664` PORTAL-004 share, `64db97d` PDF + preview, `5d3eb10` e2e + portal.md) |
| `8444c1d` | merge `feat/clinic-system` `d2b3d59` (M9) |
| last two | e2e: Send now contrast wait; **pms-setup-reports 375 px step waits for each page's content, not `networkidle`** (it timed out on a production build – now 13/13 in production and dev) |

Migrations: diary **0180** `hold_until`, **0181** hold triggers, **0189** `pms_diary_message_sweeps`; portal **0182**
`pms_intake_handoffs` + `pms_portal_share_files`, **0183–0185** `write_id` on intake responses, shares, sessions. Each
with its Postgres twin. Reporting/records follow-up numbers 0186–0188 unused.

### 19.2 What is built (by scope item)
1. **Seen statuses for future appointments** – already built in M5 (`statusAllowedAt`: arrived / in treatment /
   completed only from 60 min before the start, DNA only after it; server check in `setAppointmentStatus`, drawer, note
   screen's "Mark appointment as completed", dashboard Arrived). Verified by e2e.
2. **Diary blocks at every height** – `blockLines(heightPx)` (one line < 34 px, two < 56 px, three from 56 px); alert and
   online icons join the Double-booked marker in the top line (nothing absolute over the text); the status word truncates
   first. Kit test for every height + e2e measuring 30- and 15-minute double-booked blocks.
3. **Record Book → booking form with the patient** – already built in M5 (`?patient=`); verified by e2e.
4. **Offer slot holds the slot** – see midpoint table; database-enforced on SQLite/D1/Postgres; hold length 30 min – 1 day
   (default 2 h, never past the start); a text held for quiet hours moves the hold on (`pms.waiting_list.offer_hold`);
   visible to reception in the diary ("Held for … until 14:20", links to the waiting list) and on the waiting list (Book
   offered slot / Patient declined / Withdraw offer); left out of free slots and online booking.
5. **Send message from the drawer** (COMMS-011) – comms' own send form + templates in a dialog (`messages.send`).
6. **Share a document with the patient** (PORTAL-004) – record Attachments tab (clinical.view + clinical.write);
   optional email through comms' portal sign-in email (does not name the document); withdraw; portal download route
   checks the fingerprint, always a download, audited. Shares point at the record's file (no copy).
7. **Form completed in the clinic, verified by staff** (FORM-007) – Forms tab "Complete in the clinic" (patients.edit):
   30-min hand-off, device cookie scoped to `/clinics/<clinic>/device`, page shows only the form; patient submits
   (stored unverified), device locks "Please hand the device back"; staff verify at `/app/clinic/intake/device/<id>` with
   **their own password** (5 tries / 15 min) → "Completed in the clinic, verified by <member>" on the signed copy, PDF and
   audit; consent recorded at verification.
8. **Signed copy PDF** (pdf-lib, already a dependency – same visibility rules as the screen) and **Preview as patient**
   in the builder (a dialog, shows unsaved edits, cannot send).
9. **M8 leftovers** – REP-004 "New and returning patients" (seventh report, `/app/clinic/reports/patients`); utilisation =
   booked minutes within available minutes, available = rota/hours ∪ booked time − leave/blocked time (never > 100 %;
   Bletchley with hours cut now 96 %, was 275 %), applied to the report, by-site table and dashboard tile; diary
   "Closed – <reason>" notice; audit search by patient name/number/DOB via the existing patient search (≤ 20 matches,
   needs "View patients", nothing new stored); demo seed with ~8 weeks of history (≈1,300 visits, invoices, payments,
   leave and meetings), deterministic, follows the test clock.
10. **Portal audit write ids** – conditional audit rows key on a per-write `write_id` (submit, cancel, review, apply,
    score, share view/withdraw, sign-out, hand-offs); a same-millisecond repeat audits once (suite on 4 databases).
11. **Diary write + message sync** – the message run reconciles (no new cron): `reconcileDiaryMessages` before each run
    (cron + "Send due messages now"), re-syncs appointments changed since the last sweep (≤ 1 day back, 300 a run);
    re-plans reminders, the confirmation asked for, cancellation / DNA notices; `syncAppointmentMessages` now keeps a
    pending notice that is still true. A lost "moved" notice is not re-created.
- Also: billing "Attended, not invoiced" read the 500 OLDEST visits of 90 days (this week's went missing once a clinic
  has history) – now a week at a time from today (`src/server/pms/billing/views.ts`).

### 19.3 Results (on `be0c412` = `842bb02`)
Full chain: typecheck, lint green; **test:pms 685/685**; test:medreport 1777/0/3; **test:db 1085/0/3**; test:auth 134/0;
test:site 126/0; **test:gateway 622/0/2**; build green. (A medreport timing test, "R2-SEC-2 … under a second", is flaky
only under heavy parallel load; it passed in this run.)
E2E, each on a fresh `pms:seed-demo -- --fresh` scratch SQLite, ports 3170–3173, servers stopped. Production build:
**pms-polish-portal 9/9**, pms-portal-screens 15/15, pms-records-screens 17/17, pms-prototype-b 6/6, **pms-setup-reports
13/13** (the 375 px fix), pms-integration 14/14. `next dev` with the TEST clock at **Wed 28/10/2026 10:30** London
(`E2E_DAY=2026-10-28`): **pms-polish 8/8**, **pms-polish-reports 8/8**, pms-diary-screens 24/24, pms-prototype-a 10/10,
pms-messages-screens 18/18, pms-setup-reports 13/13. Note: pms-diary-screens and pms-messages-screens hard-code dates of
the demo week (e.g. 28/10) – with the clock on Thursday 29/10 three of their steps fail; pin the clock to 28/10.
Runners (session scratchpad): `m9b-main-e2e.sh <script> <port> <out> [dev]` (+ `E2E_DAY=`), `m9b-int-e2e.sh` (demo flag
for pms-integration).
Screenshots: `/private/tmp/claude-501/-Users-khuram-Projects-Appstackx-bh2-handover/ef471414-85b1-422d-bf98-018c56c69aec/scratchpad/k2design/out-polish/`
(`final2/` – every script on the merged tree; `polish/`, `portal/`, `reports/` – the three new scripts' 1440 / 820 / 375 px
shots incl. held offer, diary hold, short double-booked blocks, closure notice, send-message dialog, share + portal
download, clinic device + hand-back + verify, signed-copy PDFs, preview, the seventh report, utilisation with hours cut,
audit by patient).

### 19.4 Decisions taken (defaults – change any)
1. Offer holds: default 2 hours, choices 30 min / 1 h / 2 h / 4 h / 1 day, never past the slot's start; the held patient
   may still book it; a hold is never overridable ("Override clashes" is for appointments); blocked time cannot be put
   over a hold; offers before 0180 hold nothing.
2. Expiry by comparison with the writing row's time (no job); expired offers stay "open" (shown "hold has ended").
3. Message sweep keeps a pending confirmation / moved notice for the current start and cancellation / DNA notices while
   still true (behaviour change for every sync, comms-owned `schedule.ts`).
4. Send message from the drawer sends now (no appointment-specific merge fields beyond the patient's).
5. Sharing needs clinical.view + clinical.write; email on by default; no copy of the file.
6. Clinic-device verification by the member's own password; device-completed forms stored unverified until then;
   hand-offs 30 min; outcome questionnaires not on a device.
7. New and returning: "new" = first attended appointment ever, counted for its practitioner/site; weekly table counts
   visits, figures count patients.
8. Utilisation: every kind of practitioner block counts at any site; room-only blocks do not reduce practitioner time.
9. Audit search by name: ≤ 20 patients, needs "View patients".
10. Seed history only on a clinic's first seed run.

### 19.5 Open items
1. Five more portal tables still key audit rows on rev + time (booking settings, booking sites, intake templates,
   online-booking review, portal account status) – staff-only screens; ~5 more migration numbers to close.
2. Clinic device: if a staff PC is used, the browser may still hold a staff session – use the device's kiosk / guided
   access (in `portal.md`).
3. Records-owned Attachments header text fails axe colour contrast (grey on grey).
4. The diary's visit adapter (`billing-visits.ts`) still caps at 500 visits per read.
5. Audit rows about an appointment whose detail lacks the patient id are not found by name (record-id search still works).
6. Reports nav label "New and returning patie…" is truncated at 1440 px – a shorter nav label would fix it.
7. The phone diary (375 px) shows neither holds nor the closure notice; a "moved" notice lost to a failed sync is not
   re-created; two simultaneous OFFERS of the same slot are checked by the server only (bookings over a hold are
   database-enforced).
8. pms-diary-screens / pms-messages-screens hard-code demo-week dates – make them relative to the clock.

## 20. M10 full review

### 20.1 Security findings and fixes

**Branch:** `feat/cs-m10-sec` from `feat/clinic-system` `842bb02` (then `1db2928`, the native read shim, merged in),
worktree `/Users/khuram/Projects/Appstackx/clinforms-wt/cs-m10-sec`, e2e ports 3210–3219. `main` untouched; no
production action. Findings: `scratchpad/m10/security-findings.md` (C1, H1–H4, M1–M6, L1–L7). Every fix has a
regression test that failed before it (checked by reverting the fix where it was not obvious). Most service-level
tests are in `src/server/pms/security-m10.test.ts`; the others sit in the module suites named below.

**Migration:** portal **0190** `pms_intake_device_pairings` (+ Postgres twin `20261024000190_…`), new `extra` range
`[190, 190]` for portal in `src/modules/pms/core/modules.ts`, contract §3 and `scripts/pms/contract.test.ts` updated.
0191–0199 are unused.

| Finding | Fix | Test | Commit |
|---|---|---|---|
| **C1** reception could read a patient's portal sign-in link in Messages → Outbox | The `portal_link` email is stored with the link replaced by "[Sign-in link – only in the email sent to the patient]"; only the provider gets the real link (`DocumentMessageInput.secretFields`, `deliver(sendAs)`). View, reply threads and copies written before the fix are redacted when shown (`src/modules/pms/comms/secret-links.ts`). A failed sign-in email shows no Retry and `retryMessage` refuses it. Payment links (the provider's hosted pay page) and stop-email links (opt-out only) are not keys to the patient's data: left as they are | `security-m10.test.ts` C1 (no 43-character token in any staff view, not even encrypted in `pms_messages`; Retry refused); portal suite reads the link from the test provider; e2e helpers check the hidden link | `ebd63ae` |
| **H1** subject-access export with `reports.export` only | Needs `reports.export` AND `clinical.view` (service; record menu and Data rights panel hidden otherwise) | records service suite (reception with an exception, admin without clinical.view) | `c8f83f4` |
| **L1** Copy from last note with `clinical.write` only | Also `clinical.view` | records service suite | `c8f83f4` |
| **M3** `{{latest_outcomes}}` filled without `clinical.view` | Filled only when the member has `clinical.view` (start and save of a letter; discharge letter already required it); `startLetter` defaults to not filling it | `letter-files.test.ts` | `c8f83f4` |
| **L5** claims CSV Diagnosis code | Blank without `clinical.view` (column kept) | `letter-files.test.ts` | `c8f83f4` |
| **H2** native ClinForms reports readable by any member | New optional `MedreportDeps.mayReadReport` / `restrictsReports`. Host rule (`src/server/pms/native-report-access.ts`): a report with `connectorId "native"` whose snapshot holds notes or outcome scores, or that is approved, needs the clinic system's `clinical.view` (`resolveMemberAccess`). Store GET / PUT / DELETE / reuse and `/render` answer 404 otherwise (as for a missing report). Reception's own forms (no clinical prefill) stay readable. Other reports: no access read at all; ClinForms-only clinics: no extra store read | `native-report-access.test.ts` (same status and body with and without the hook for a non-native report); host wiring in `security-m10.test.ts` | `5755203` |
| **H4** self-escalation through the role grid | `settings.members` locked off for clinicians and reception; nobody but the owner changes their own role's row; only owner/admin change the admin row or an admin member (access, role, activation, signing) | `security-m10.test.ts` H4 | `53887af` |
| **H3** the clinic device was a staff browser | Pairing by code: "Complete in the clinic" opens the member's own hand-off page with "Show a code for the device" (8 characters, no look-alikes, valid 10 min, works once, New code replaces it). A separate browser, not signed in, opens `/clinics/<c>/device` and types it (10 tries per address, 60 per clinic per 10 min); only then does it get its own secret. No staff cookie or session on the device, no `/app` link on the device page; verification stays on the staff screen with the member's password (page refreshes itself every 5 s) | `portal-polish.test.ts` (pairing, replaced/used/expired/other-clinic codes, rate limit, audit has no code); e2e `pms-polish-portal` steps 4–6 with a separate signed-out device context | `ea130ce` |
| **M1** native launch skipped the trial-ended check | `assertTenantMayCreate(profile, "launch")` before anything is written: "Your ClinForms trial has ended…"; the panel answers `canStart:false` with the reason | `security-m10.test.ts` M1 | `161e25d` |
| **M2** import ignored site scope | Every import function needs `settings.import` and every site | `security-m10.test.ts` M2 | `20d2205` |
| **L2** booking options without scope | Patient outside the sites → nothing; cases at other sites left out | `security-m10.test.ts` L2 | `20d2205` |
| **L3** overlapping imports | One import of a kind at a time: approve refuses while another is approved/importing; `claimImportStep` holds a batch off while another of its kind imports (step answers busy) | integration suite (SQLite + PGlite) | `20d2205` |
| **M4** booking showed whether someone is a patient | Every public booking gets the same forms (matched or new); answer no sooner than 1.5 s, rounded up to the next second | portal suite (same forms both ways) | `1abb654` |
| **M5** manage link showed later answers | A sent form shows "Sent" only (`manageFormView`) | portal suite | `1abb654` |
| **M6** booking spam | Production (`VERCEL_ENV=production`): booking for new patients cannot be switched on and is refused without Turnstile; client address from the platform header (pms-local `trustedClientIp`; `session.ts` unchanged); ≤ 40 public bookings an hour per clinic reach the patient step | `security-m10.test.ts` M6; portal suite (production refusal, cap) | `1abb654` |
| **L6** access off for a patient without an account | Account created, disabled | `security-m10.test.ts` L6 | `1abb654` |
| **L7** | Sign-in padding 2.5 s, slower rounded up to the second; manage link swaps its secret for a cookie (`/booking/<secret>` route → `/booking/manage`); staff email change ends portal sessions and unused links; hand-off password throttle fails closed (pms-local; ClinForms' `throttle()` unchanged); `signInWithLink` uses the link inside the session batch; in-app launches carry `forUserId` and open only for that member. SMS webhook replay check left as is (not live) | `security-m10.test.ts` L7; `native-report-access.test.ts` (launch) | `1abb654` |
| **L4** CSV formula defusing | One helper `src/modules/pms/core/csv-safe.ts` (leading whitespace, full-width ＝＋－＠｜, `\n=`, `|`; quotes CR) used by the five writers | `csv-safe.test.ts` | `c516c5c` |
| (follow-ups) | Audit labels for `pms.intake_handoff.pair_code`, `…paired`, `pms.portal_account.signed_out`; guard first in `lastNoteForCopyFor`; e2e clinic-system-access counts the 2 new locked cells | admin.test, records-routes.test | `7facfbe`, `(e2e commit)` |

**Decisions taken (safe defaults – change any):**
1. C1: the stored copy of a sign-in email has the WHOLE link replaced (the `?next=` page is not kept either); a
   failed sign-in email is never re-sent from the log – the patient asks for a new link or staff send the form again.
   Payment links and stop-email links are not hidden (not keys to the patient's data).
2. H1: no partial export – without `clinical.view` the subject-access copy is refused (a copy without notes would
   look complete and is not).
3. H2: native report rule = native AND (notes or outcome scores in the snapshot, OR approved). Reception still opens
   the forms they start (no clinical prefill). A clinician's later answers in a reception-started DRAFT remain
   readable by reception until it is approved (then clinical.view only, like the filed copy). Refused = 404. The
   Studio's snapshot list still lists the report id (summaries carry no patient data); opening it answers 404.
4. H3: code only, no QR (a QR would put the code into a camera app's history); 8 characters from 29 without
   look-alikes; 10 tries per address and 60 per clinic per 10 minutes; a device that completed a form stays on
   "hand back" until staff verify or end it; the staff page refreshes itself every 5 s while the device has the form.
5. H4: `settings.members` is a lock for clinicians and reception (stored overrides/exceptions that granted it stop
   working); admins cannot change the admin row – only the owner can.
6. M4: public bookings matched to an existing record now get the new-patient forms too (the same as a new record);
   staff may see an extra health questionnaire for a returning patient booking online.
7. M6: production = `VERCEL_ENV=production`; the public booking page refuses bookings there without Turnstile and
   booking for new patients cannot be switched on; preview/local unchanged. Cap: 40 public bookings an hour per clinic
   reach the patient step (counted before the match so it reveals nothing).
8. L7: sign-in answers take ≥ 2.5 s (slower rounded up to the whole second); booking ≥ 1.5 s. Manage-link cookie
   `clinic_manage` (httpOnly, Lax, path `/clinics/<c>/booking`, until the link expires); the address is now
   `/booking/manage` (old links still work – they swap and redirect). The email-change sign-out runs only for a staff
   edit of the record (a form applied to the record does not). `forUserId` is an optional launch claim (partner
   launches unchanged).
9. ClinForms behaviour: unchanged for non-native reports and for clinics without the clinic system (H2 tests compare
   answers with and without the hook); `src/server/auth/session.ts` untouched (pms-local IP and throttle helpers).

**Results (final head `14dad73`, chain c3, before the merge into `feat/clinic-system`):** typecheck and lint green;
test:pms 721/0, test:medreport 1786/0 (3 LibreOffice skips; the R2-SEC-2 "under a second" timing test failed once
under heavy parallel load in c2 and passes in c3), test:db 1121/0/3, test:auth 134/0, test:site 126/0, test:gateway
628/0/2; build green. **Merged** `--no-ff` into `feat/clinic-system` as `8796702` (from `1db2928`).
E2E (fresh `pms:seed-demo -- --fresh` scratch SQLite each, servers stopped). Production build: **pms-polish-portal
9/9** (new pairing steps), **pms-portal-screens 15/15**, **pms-records-screens 17/17**, **clinic-system-access 13/13**,
**pms-integration 14/14**. `next dev` with the TEST clock at Wed 28/10/2026 10:30 London: **pms-messages-screens
18/18**. Runner: scratchpad `sec-e2e.sh <script> <port> <out> [dev]` (`DEMO_FLAG=1` for pms-integration,
`E2E_DAY=2026-10-28` for dev). The portal e2e helpers no longer read a sign-in link from the outbox (it is hidden):
they check the hidden text, then give the newest link a known secret in the scratch database (its hash only).

**Open items (security):** the Studio still lists ids of reports it will not open for a member (H2, harmless); the
SMS webhook replay check uses the message id only (not live – leave); a theoretical same-millisecond double use of
one sign-in link by its own holder could open two sessions (L7 batch); Turnstile itself is still not configured
anywhere (production booking is therefore refused until it is).

### 20.2 Accessibility, UX, design and production findings and fixes

**Branch:** `feat/cs-m10-ux` from `feat/clinic-system` `1db2928`, worktree
`/Users/khuram/Projects/Appstackx/clinforms-wt/cs-m10-ux`, e2e ports 3220–3229. Helper branches (pushed, merged in):
`feat/cs-m10-ux-routes` `3f7895e`, `-prod` `989979d`, `-ds` `e9278b5`, `-diary` `a4c0dff`. `main` untouched; no
production action; **no migrations**.

**UX (all fixed):**

| # | Finding | Fix |
|---|---|---|
| 1 | Appointment drawer not modal | role=dialog, aria-modal; page inert except toasts; Esc returns focus to the block |
| 2 | Take payment `?pay=1` ignored when the Invoices tab is already open | Opens the dialog from a useEffect, then clears `?pay=1` |
| 3 | Keyboard move/resize | Across practitioners or sites needs a second Enter; out-of-hours warning in the live hint; focus goes to the moved block. Drag-and-drop unchanged (keeps Undo) |
| 4 | Records header contrast | Text #475569 |
| 5 | Set-up sideways scroll escaped its box | Scroll box `relative` (Services table, SetupCard, set-up nav) |
| 6 | Scroll regions not reachable by keyboard | Kit `ScrollRegion` (named region, tabIndex=0 only while it overflows); about 19 places, incl. print roots and the letter editor |
| 7 | 15-minute blocks too small to hit | Invisible hit area to ≥ 24 px, neighbours split the space (`hitArea` in grid-model.ts) |
| 8 | Phone diary on closed days | "Closed – reason" and holds shown; New appointment hidden |
| 9 | Reports nav label too long | "New and returning" (full name on hover); test keeps every nav label ≤ 20 characters |
| 10 | Dashboard at 375 px; truncation without tooltips | Badge and button stack under the text below sm; full names on hover (set-up lists, payers, table cells) |
| 11 | Booking "Your details": Continue disabled with no reason | Continue stays enabled; per-field message with aria-invalid/aria-describedby; focus to the first problem; the server's own schema (`bookingDetailsErrors`) |
| 12 | Focus lost after a payment | Returns to the opener, falling back to the Invoices tab's Take payment |
| 13 | No loading/error states | loading.tsx + error.tsx for every clinic section; public: book has both, clinic home / booking links / portal error.tsx only |
| 14 | Touch targets on mobile | 44 px: booking Back, Earlier/Later dates, portal Sign out, Book an appointment, outcome Back, drawer actions/close, booking-dialog inputs |
| 15 | Design-system page incomplete | Every Part A component from the kit (spec: K2-SCREENS-PROMPT.md; the k2-designs exports have no Part A screens) + a live context menu |
| 16 | No context menu on diary blocks | Kit `ContextMenu`: right-click, Shift+F10 or the Menu key; same actions as the drawer |
| 17 | Recurring series not marked | Icon in the block's top line, with screen-reader text |
| 18 | Drawer had no change history | "History of changes" from `GET /app/clinic/diary/api/appointments/[id]/history`; redacted for reception like the record's History |
| 19 | Patient list had no Site filter | Patients with a case or appointment at the site; only sites in the member's scope; in the export and its audit |
| 20 | New appointment opened at a fixed time | Opens on the first free slot (the grid's slot steps) |
| 21 | Day sheet overflowed at 375 px | Fixed |

**Rules:** short days are DD/MM ("Fri 30/10") in the diary, waiting-list offers and the portal short form; record
History, attachments, consent and audit show "29/10/2026 00:51" (ClinForms' `activityTime` untouched). "Clinic
system" in `activity-copy.ts` and medreport `view-model.ts` was kept (on main; it means a third-party system, so
`CLINIC_SYSTEM_NAME` would be wrong) – comments only.

**Production (all fixed except 6, documented):**
- **2** Offboarding deletes only the non-empty clinic-system tables; one atomic batch while it fits
  `GATEWAY_MAX_STATEMENTS`, otherwise ordered batches with the tombstone last (tested at the limit).
- **3** `countPmsRows`, `exportPmsData`, `listClinicPackages` treat a missing table as empty (SQLite and PGlite with
  only 0001–0008).
- **4** Reports switch-off on the platform page needs the clinic id typed (checked on the server too).
- **5** Studio layout reads the packages once; the clinic layout's read moved inside its Promise.all.
- **6** Global CSS **not split** – contract §13: 19.2 kB gzip now, 13.6 kB without the clinic-system files; a split
  risks class-order conflicts and Next 14 CSS-order bugs.
- **7** Middleware matcher back to main's coverage; public pages match only on the `clinic\.localhost` host; a test
  keeps the pattern in step with brand.ts.
- **8** `tenant-studio.cjs FLOW=complete` adds the owner's signing details first (15/15 on K2).

**Added:** the loading skeletons turned forbidden pages into HTTP 200 (streamed 404 page). The clinic shell layout
(above every skeleton) now checks the page's permission by address (`x-clinforms-path`) against
`src/modules/pms/core/page-permissions.ts` (61 pages + report access; a test keeps it in step with the pages) and
answers a real 404. The member is read once per request through React `cache` (plain call where React has none –
node tests). A permission check in generateMetadata did not work on Next 14.2.35 (undone).

**Crawl follow-ups (after the reviewer's crawl was re-run on `79c501c`):** authorisation "expires …" text on the
Cases tab at #475569 (was 4.48:1 on #F8FAFC); the booking details' hidden Enter-submit button taken out of the tab
order (`d18c1bc`).

**Decisions taken (safe defaults – change any):** reports off needs the clinic id typed; split offboarding batches
are ordered, not atomic (only above about 720 accounts); CSS not split; no loading skeleton on public pages that
redirect or 404; Site filter = a case or appointment at the site, an out-of-scope site is ignored, desktop only;
keyboard-only move confirmation; first free slot uses the grid's slot steps; time picker is a native select; "New
and returning" nav label; generic "Clinic system" phrases kept.

### 20.3 M10 results and merge

**Merge:** `origin/feat/clinic-system` `8796702` (security, §20.1) merged into `feat/cs-m10-ux` as `363ad7d` with no
conflicts (the booking-link `error.tsx` sits at `booking/`, so it covers the new `booking/manage/`); crawl follow-ups
`d18c1bc`. **Merged** `--no-ff` into `feat/clinic-system` as **`ac6d52f`** (same tree as `d18c1bc`) and pushed.

**Chain on `d18c1bc`:** build, typecheck and lint green; test:pms 770/0, test:db 1175/0/3, test:auth 139/0, test:site
155/0, test:gateway 629/0/2, test:medreport 1786/0/3. (`typecheck:gateway` reports one `pdfjs-dist` declaration error
in `src/modules/medreport/forms/pdfjs.ts`, a file unchanged since main – not from M10.) On `79c501c` before the merge:
the same chain green; the earlier gateway failures were ENOSPC, and medreport's only failure (R2-SEC-2 "under a
second", 1001 ms) passes alone.

**E2E on the merged head** (fresh `pms:seed-demo -- --fresh` scratch SQLite each, servers stopped). Production build:
pms-polish-portal 9/9, pms-portal-screens 15/15, clinic-system-access 13/13, pms-m10-ux 8/8. `next dev` with the TEST
clock at Wed 28/10/2026 10:30 London: pms-diary-screens 32/32. Before the merge (`0b2b6ff`/`79c501c`) every other
script also passed: clinic-system-shell 11/11, pms-records-screens 17/17, pms-billing-screens 21/21 (local payment
stub), pms-prototype-b 6/6, pms-polish 9/9, pms-integration 14/14, pms-setup-reports 13/13, pms-design-system 14/14,
tenant-studio FLOW=complete 15/15, pms-prototype-a 10/10, pms-messages-screens 18/18, pms-polish-reports 8/8.
Runner: scratchpad `m10-e2e.sh` / `m10fix/prod-batch.sh` (`MODE=dev E2E_DAY=2026-10-28` for dev).

**Reviewer crawl** (`m10fix/crawl-run.sh`, every clinic page × owner/admin/clinician/reception × 1440/375, axe WCAG
2.2 AA, on `79c501c`): no horizontal scroll; access denials as expected. Remaining axe: **target-size** on the diary
for 15-minute blocks with an appointment directly above AND below (only the 2 px gaps are free; the 18 px button is
what axe measures – the 24 px hit span is not a target to axe). Passing it needs a taller time scale (≥ 26 px per 15
minutes); left as a known limit (keyboard, drawer and context menu reach every block). The contrast finding is fixed
(`d18c1bc`). `letter-new` "Page not found" is the crawl opening it without `?patient=` (404 by design, 200 status under
the skeleton – the limit below). The crawl's portal step passed at 375 px; at 1440 it reused the spent sign-in link
(tool artifact) – and after C1 the tool cannot read sign-in links from Messages at all.

**Open items (M10 UX):** a missing or out-of-scope record id under a skeleton still returns HTTP 200 with the 404 page
(no data shown); two back-to-back 15-minute blocks only gain the 2 px gap; the reviewer's `portal.cjs` needs the
e2e helpers' approach (give the newest link a known secret in the scratch DB) after C1.

### 20.4 Performance (50k clinic) – findings, fixes, before/after table

**Branch:** `feat/cs-m10-perf` (worktree `clinforms-wt/cs-m10-perf`, e2e ports 3230–3239, from `feat/clinic-system` `1db2928`; the
security merge `8796702` was merged in before the undo work was finished, and the UX merge `ac6d52f` before the final runs), merged `--no-ff` into `feat/clinic-system` as `1d861d9` after
the security and UX branches. `main` untouched. Findings: scratchpad `m10/perf-findings.md` (reviewer at 842bb02).

**Dataset** (reviewer's `m10-perf-tools/gen.ts`, fictional): 11 sites, 40 practitioners, 38 rooms, 50,000 patients,
~452k diary rows over 3 years + 6 weeks, ~147k notes, ~100k invoices / 345k lines, 89k payments. Measured with
`bench.ts` (median of 5 after a warm-up; reports 3 runs, jobs 1) on SQLite (node:sqlite), the D1 stand-in (gateway →
node:sqlite), local workerd D1 (wrangler `getPlatformProxy`, rows_read from D1's meta) and PGlite. "Before" = 1db2928,
"after" = this branch with migrations 0210–0213 applied to the copy (no ANALYZE on SQLite/D1, as in production).
Changes to the bench tool: its working copies are APFS clones, and its runner now points the app's own database
(`getDb`) at a fresh clone per run. Before that change, every run opened the master dataset directly, applied that
tree's migrations to it and wrote to it, so the first "before" runs here also had this branch's indexes. Those numbers
were thrown away, the dataset was cleaned and every SQLite-family run was repeated. Generated DBs were deleted afterwards.

#### Findings – fixed or not
| # | Finding | Status | What was done |
|---|---|---|---|
| A | Free-slot search: 500 items/day cap, a full day offered nothing; 90+90 IN-list parameters | **Fixed** | `listOccupiedSpans` (busy columns only, keyset-paged, practitioners and rooms in groups of 80), read a week at a time while slots are still wanted; `freeSlots` indexes busy time per practitioner/room and stops after the date that fills the limit; `listDiary` refuses > 90 sites+practitioners+rooms instead of silently cutting each list to 90. Test: 577 items on one day still offers its free time; 96 practitioner + 90 room ids read in groups (4 backends). |
| B | "Attended, not invoiced": 500 oldest per 7-day window, then filtered | **Fixed** | Port method `listUninvoicedVisits` (diary adapter) with billing's own `notOnAnInvoice` predicate (NOT EXISTS on the partial unique index `pms_invoice_lines_appointment`) in the SQL, newest first by keyset, plus the total; Billing tab / Today show the true count, Invoice visits says "Showing the 500 most recent of N". Test: 600 visits in a week, newest listed, total 600, invoicing 2 → 598, two keyset pages (4 backends). |
| C | Today: 500 per group of 90 sites; serial tiles | **Fixed** | `countDiaryDay` (the whole day by `starts_on`, grouped by site, practitioner and status, with still-to-arrive; sites filtered in code, because with `site_id IN (?…)` bound SQLite/D1 chose the site index and read the sites' whole history) for every figure; clinician list = own day; reception arrivals = booked/arrived ending after now−30 min; overdue = `overdueInvoicesSummary` (all overdue, not a page of 200); invoices to raise = count + 4 longest waiting; each role's tiles start together. Test: 600 appointments today → "600", "240 done · 60 DNA", 90 still to arrive, clinician 20 (4 backends). |
| D | Aged debt: names of every debtor; site filter through `listInvoicesPage(200)` | **Fixed** | `debtInvoices` returns `site_id` and filters by site in SQL (open invoices only, 2,000 a page); names looked up for the top 8 only; statement ages read one debtor. Test: site-limited member with 230 open invoices → exact total; top 8 named (4 backends). |
| 1 | `pms_appointments (tenant_id, starts_on)` | **Fixed (0210)** | As `(tenant_id, starts_on, site_id)`: with `site_id IN (…)` and no statistics SQLite otherwise picked `pms_appointments_site_starts` and read the sites' whole history. |
| 2 | `pms_appointments (tenant_id, updated_at)` | **Fixed (0210)** | For the message sweep. |
| 3 | `pms_clinical_notes (tenant_id, status, seen_on)` | **Fixed (0211)** | Unsigned notes. |
| 4 | `pms_invoices (tenant_id, patient_id, status)`, `(created_at)`, `(status, due_on)` | **Fixed differently (0212)** | Partial `pms_invoices_open (tenant_id, status, id) WHERE status='issued' AND balance <> 0` – the queries repeat it as literal SQL (`OPEN_INVOICE`) so SQLite/D1 use it without statistics (checked with EXPLAIN QUERY PLAN); `(tenant_id, created_at)` for the list order. `(patient_id, status)` not added: `pms_invoices_patient (tenant_id, patient_id, created_at)` already serves the per-patient reads. |
| 5 | `pms_cases_practitioner`, `audit_log_target` | **cases: fixed (0213, foundation range). audit_log: not added** | `audit_log` is a ClinForms table no clinic-system module owns; every ClinForms write would pay for the index and the record History tab takes about 68 ms on local D1 without it (22k audit rows read). Left for the orchestrator to decide. |
| 6 | Partial index / first_attended_on for the patients report | **Fixed without a new index** | `attendedPatients`: one probe of `pms_appointments_patient_starts` per patient; `visitFacts`: "first" = NOT EXISTS an earlier attended visit (same answer, ties included). |
| 7 | PRAGMA optimize via a migration | **Not done (decision)** | On new / empty D1 databases it would store statistics for empty tables that mislead the planner as they grow; the indexes above are chosen without statistics. |
| – | Comms sweep N+1 (907 requests) | **Fixed** | `syncAppointmentsMessages`: settings/rules once, planned messages 90 appointments a read, in-step rows write nothing, writes packed into batches of whole appointments (fallback one by one). Also used by every diary write's sync. Test: 150 rows healed, then an in-step sweep in ≤ 12 statements (4 backends). |
| – | send-due batching | **Fixed (partly)** | Settings, directory, rules, contact and templates read once per run (`RunCache`); 45 rows per write batch (was 20). Requests 198 → 107. On local workerd the job is still about 12.7 s, but D1's own reported time is 0.15 s. The rest is the local proxy's cost per write batch (SQLite 0.13 s, D1 stand-in 0.16 s). Re-measure on real D1 before go-live. |
| – | `billingFigures` adds up every invoice | **Fixed** | Three indexed reads: drafts, OPEN invoices, this month. |
| – | Patients report / appointmentFacts / availabilityFacts | **Patients fixed; availability not moved to SQL** | `availabilityFacts` keeps its exact interval maths in code (union of rota, booked and blocked time per practitioner-day); moving it to SQL would change utilisation figures. It now reads through the starts_on index: utilisation year 1,894 → 1,569 ms on local D1 (rows read 1.04M → 418k). The target for reports (< 5 s) is met. appointmentFacts' 7-column GROUP BY is unchanged. |
| – | Import undo ~5 statements/row | **Fixed** | `archiveImportedPatients` / `closeImportedCases`: UPDATE … WHERE id IN (≤ 90) AND rev = ? RETURNING id per revision group + one audit row (`pms.patient.import_undo`, `pms.case.import_undo`, `pms.authorisation.import_undo`, count). Only the undo functions in importer.ts changed. Undo of 5,000 patients on local workerd: 363 s → 46 s, longest page 11.8 s → 1.6 s, statements per page 518 → 20. 50,000 on the D1 stand-in: 67 s → 12 s; gateway requests for the whole import 270k → 21k. |
| – | Patient list exact count; owes money 286k rows | **Owes money: open invoices only; count kept** | Owes-money reads only open invoices; on SQLite/D1 the planner still walks `pms_invoices_patient` (it avoids a sort for the GROUP BY) (166 ms on local D1, within target). The exact count stays (≈ 110 ms on local D1). |
| – | `copy-d1-to-postgres` LIMIT/OFFSET | **Fixed** | Keyset `(pk…) > (…)` on SQLite, the gateway and Postgres; new gateway test. |
| extra | found while measuring | **Fixed** | `excessBilledForCase` read every invoice line of the clinic per case (~400 ms each when pricing visits) → lines WHERE invoice_id IN (the case's invoices); clinician's `caseOutcomeFigures` used the start-time index over all history (~700 ms) → the case index. |

#### Before / after (ms; workerd rows_read and gateway requests)
SQLite, D1 stand-in and local workerd: before = `1db2928`, after = `30f2c83` (this branch with the UX merge), both on
the same clean copy of the dataset, run back to back with nothing else running. PGlite: before = `1db2928`, after =
`e0148c6` (before the last two commits, which only change the day counts and the aged-debt page size). Median ms;
rows_read and requests are per page or job.

| Path | SQLite ms | D1 stand-in ms (requests) | local workerd D1 ms | workerd rows_read | workerd requests | PGlite ms |
|---|---|---|---|---|---|---|
| diary day view (site, today) | 5 → 5 | 8 (14) → 6 (14) | 154 → 148 | 3k → 3k | 14 → 14 | 13 → 15 |
| diary day view (site, past day) | 6 → 4 | 7 (14) → 7 (14) | 158 → 158 | 3k → 3k | 14 → 14 | 9 → 11 |
| diary day view by room | 6 → 5 | 8 (14) → 7 (14) | 152 → 153 | 3k → 3k | 14 → 14 | 9 → 12 |
| diary week view (1 practitioner) | 9 → 8 | 11 (15) → 11 (15) | 151 → 163 | 8k → 8k | 15 → 15 | 11 → 15 |
| diary week view (site) | 10 → 8 | 11 (15) → 11 (15) | 165 → 161 | 8k → 8k | 15 → 15 | 11 → 15 |
| free-slot search (site, 21 days) | 250 → 6 | 274 (24) → 8 (12) | 486 → 123 | 16k → 7k | 24 → 12 | 286 → 11 |
| free-slot search (all sites, 28 days) | 2817 → 27 | 2894 (29) → 35 (16) | 3161 → 192 | 31k → 20k | 29 → 16 | 3052 → 72 |
| online booking slots (week, any practitioner) | 10 → 5 | 12 (16) → 8 (14) | 158 → 138 | 5k → 7k | 16 → 14 | 16 → 12 |
| patient search name 'hart' | 0 → 0 | 1 (1) → 1 (1) | 9 → 9 | 1k → 1k | 1 → 1 | 1 → 1 |
| patient search 'amelia ashdown' | 1 → 1 | 1 (1) → 1 (1) | 9 → 10 | 3k → 3k | 1 → 1 | 11 → 12 |
| patient search phone '900123' | 8 → 7 | 9 (1) → 9 (1) | 18 → 18 | 23k → 23k | 1 → 1 | 12 → 12 |
| patient search no match 'zzzz' | 16 → 13 | 17 (1) → 17 (1) | 26 → 23 | 50k → 50k | 1 → 1 | 10 → 9 |
| diary quick patient search 'hart' | 5 → 5 | 7 (2) → 7 (2) | 24 → 23 | 20k → 20k | 2 → 2 | 2 → 1 |
| patient list page (default) | 34 → 30 | 37 (9) → 35 (10) | 107 → 116 | 118k → 119k | 9 → 10 | 15 → 19 |
| patient list 'no future appt' | 81 → 81 | 79 (9) → 73 (10) | 155 → 166 | 169k → 169k | 9 → 10 | 32 → 36 |
| patient list 'owes money' | 94 → 94 | 105 (9) → 90 (10) | 173 → 166 | 286k → 286k | 9 → 10 | 94 → 82 |
| patient list search 'hart' page 3 | 30 → 34 | 35 (9) → 35 (10) | 102 → 115 | 120k → 120k | 9 → 10 | 14 → 15 |
| patient search (site-limited admin) 'hart' | 2 → 2 | 2 (1) → 2 (1) | 11 → 12 | 3k → 3k | 1 → 1 | 38 → 42 |
| record: header (layout) | 2 → 1 | 3 (16) → 3 (16) | 192 → 159 | 301 → 301 | 16 → 16 | 6 → 6 |
| record: overview tab | 35 → 21 | 38 (28) → 22 (28) | 289 → 283 | 202k → 24k | 28 → 28 | 8 → 10 |
| record: notes tab | 0 → 0 | 0 (2) → 0 (2) | 19 → 20 | 8 → 8 | 2 → 2 | 1 → 1 |
| record: appointments tab | 1 → 1 | 2 (6) → 2 (6) | 63 → 60 | 286 → 286 | 6 → 6 | 4 → 3 |
| record: invoices tab | 0 → 0 | 1 (4) → 1 (4) | 35 → 40 | 31 → 31 | 4 → 4 | 2 → 1 |
| record: cases tab | 0 → 0 | 0 (3) → 0 (3) | 31 → 28 | 5 → 5 | 3 → 3 | 1 → 1 |
| record: details tab | 0 → 0 | 1 (7) → 1 (7) | 92 → 91 | 6 → 6 | 7 → 7 | 3 → 2 |
| record: outcomes tab | 0 → 0 | 0 (2) → 0 (2) | 21 → 20 | 2 → 2 | 2 → 2 | 1 → 1 |
| record: attachments tab | 0 → 0 | 0 (2) → 0 (2) | 23 → 21 | 2 → 2 | 2 → 2 | 0 → 1 |
| record: messages tab | 1 → 1 | 1 (7) → 1 (7) | 78 → 81 | 87 → 87 | 7 → 7 | 3 → 2 |
| record: forms tab | 0 → 0 | 1 (7) → 1 (7) | 67 → 83 | 7 → 7 | 7 → 7 | 3 → 2 |
| record: history tab | 4 → 4 | 5 (7) → 5 (7) | 59 → 68 | 22k → 22k | 7 → 7 | 6 → 7 |
| unsigned notes (all) | 49 → 10 | 50 (6) → 12 (6) | 103 → 61 | 295k → 148k | 6 → 6 | 7 → 8 |
| unsigned notes (mine, clinician) | 1 → 1 | 1 (4) → 1 (4) | 36 → 45 | 92 → 636 | 4 → 4 | 1 → 2 |
| dashboard owner | 323 → 38 | 326 (26) → 41 (28) | 568 → 277 | 1.22M → 52k | 26 → 28 | 153 → 105 |
| dashboard admin | 335 → 38 | 327 (26) → 37 (28) | 573 → 273 | 1.22M → 52k | 26 → 28 | 158 → 101 |
| dashboard clinician | 125 → 3 | 142 (12) → 4 (12) | 237 → 127 | 488k → 4k | 12 → 12 | 26 → 6 |
| dashboard staff | 303 → 36 | 311 (54) → 35 (27) | 805 → 272 | 871k → 111k | 54 → 27 | 63 → 128 |
| billing home | 363 → 46 | 364 (20) → 47 (10) | 538 → 121 | 1.27M → 223k | 20 → 10 | 170 → 169 |
| billing attended, not invoiced | 301 → 44 | 295 (35) → 54 (44) | 609 → 473 | 868k → 111k | 35 → 44 | 36 → 153 |
| billing aged debt (debtors list) | 92 → 47 | 131 (112) → 64 (8) | 1296 → 170 | 117k → 12k | 112 → 8 | 223 → 128 |
| report attendance quarter | 147 → 47 | 160 (6) → 60 (6) | 227 → 118 | 486k → 68k | 6 → 6 | 97 → 121 |
| report attendance year | 306 → 210 | 312 (6) → 179 (6) | 442 → 273 | 585k → 274k | 6 → 6 | 351 → 430 |
| report attendance year CSV | 269 → 171 | 276 (7) → 217 (7) | 386 → 316 | 585k → 274k | 7 → 7 | 344 → 423 |
| report utilisation quarter | 440 → 234 | 476 (12) → 261 (12) | 704 → 470 | 939k → 104k | 12 → 12 | 449 → 487 |
| report utilisation year | 1096 → 926 | 1242 (12) → 1045 (12) | 1894 → 1569 | 1.04M → 418k | 12 → 12 | 1629 → 1837 |
| report utilisation year CSV | 1084 → 865 | 1216 (13) → 957 (13) | 1925 → 1585 | 1.04M → 418k | 13 → 13 | 1546 → 1813 |
| report patients quarter | 526 → 93 | 528 (7) → 98 (7) | 608 → 154 | 1.57M → 176k | 7 → 7 | 357 → 210 |
| report patients year | 750 → 310 | 773 (7) → 316 (7) | 812 → 411 | 2.15M → 645k | 7 → 7 | 674 → 674 |
| report patients year CSV | 745 → 327 | 778 (8) → 317 (8) | 778 → 379 | 2.15M → 645k | 8 → 8 | 659 → 644 |
| report caseload quarter | 46 → 58 | 47 (8) → 61 (8) | 127 → 123 | 200k → 200k | 8 → 8 | 27 → 32 |
| report caseload year | 50 → 60 | 46 (8) → 61 (8) | 115 → 119 | 201k → 201k | 8 → 8 | 25 → 31 |
| report caseload year CSV | 53 → 46 | 54 (9) → 49 (9) | 131 → 124 | 201k → 201k | 9 → 9 | 23 → 30 |
| report revenue quarter | 10 → 8 | 10 (8) → 9 (8) | 75 → 74 | 30k → 30k | 8 → 8 | 12 → 19 |
| report revenue year | 54 → 43 | 52 (8) → 46 (8) | 128 → 123 | 147k → 147k | 8 → 8 | 49 → 65 |
| report revenue year CSV | 50 → 43 | 54 (9) → 47 (9) | 124 → 128 | 147k → 147k | 9 → 9 | 47 → 61 |
| report debtors quarter | 36 → 35 | 39 (7) → 36 (7) | 111 → 103 | 113k → 113k | 7 → 7 | 47 → 54 |
| report debtors year | 35 → 38 | 39 (7) → 41 (7) | 111 → 105 | 113k → 113k | 7 → 7 | 51 → 55 |
| report debtors year CSV | 38 → 37 | 37 (8) → 42 (8) | 122 → 112 | 113k → 113k | 8 → 8 | 58 → 57 |
| report authorisations quarter | 2 → 2 | 4 (13) → 4 (13) | 130 → 113 | 1k → 1k | 13 → 13 | 7 → 10 |
| report authorisations year | 2 → 2 | 3 (13) → 3 (13) | 144 → 133 | 1k → 1k | 13 → 13 | 6 → 10 |
| report authorisations year CSV | 2 → 2 | 3 (14) → 3 (14) | 155 → 124 | 1k → 1k | 14 → 14 | 7 → 8 |
| comms run: reconcile sweep | 190 → 10 | 235 (907) → 12 (13) | 10986 → 153 | 441k → 1k | 907 → 13 | 299 → 26 |
| comms run: send due messages | 157 → 131 | 190 (198) → 159 (107) | 13433 → 12675 | 24k → 23k | 198 → 107 | 646 → 761 |


#### Decisions taken (defaults – change any)
1. Migration numbers: diary 0210, records 0211, billing 0212, foundation 0213 (`extra` in `core/modules.ts`, contract §3); 0214–0219 unused.
2. No `audit_log` index and no `PRAGMA optimize` migration (above).
3. "Attended, not invoiced" shows the newest 500 (oldest first) with "Showing the 500 most recent of N"; Today's "Invoices to raise" lists the 4 longest waiting with the full count.
4. Today's overdue list now shows the 4 longest overdue of ALL overdue invoices (was: of the 200 most recently created).
5. `listDiary` throws a plain error over 90 IN-list ids instead of silently cutting the list.
6. Import undo writes one audit row per group of ≤ 90 (count) instead of two rows per record.

#### Open items
1. send-due on local workerd (about 12.7 s, D1 time 0.15 s): re-measure on real D1.
2. Owes-money filter still reads the clinic's invoices through the patient index on D1 (fine at 50k, 180 ms).
3. `audit_log (tenant_id, target_id)` – orchestrator's call.
4. Utilisation year is the slowest report (1.6 s on local D1) – in-code interval maths kept on purpose.

#### Results
**Results (final head `ddb6433` = merge `1d861d9`'s tree):** typecheck and lint green; test:pms 780/0, test:medreport
1786/0 (3 skips), test:db 1185/0/3 (the first run failed 1 test: the new import-undo audit actions had no plain-English
labels, fixed in `ddb6433`), test:auth 139/0, test:site 155/0, test:gateway 646/0/2; build green. New regression
tests: free slots on a full day and with 96+90 ids (A), 600 uninvoiced visits in a week (B), 600 appointments today (C),
aged debt for a site-limited member past 200 invoices (D), sweep of 150 rows with statement counts, and keyset copy
through the gateway. Each runs on SQLite, PGlite, the D1 stand-in and local workerd where that suite runs.
E2E (fresh `pms:seed-demo -- --fresh` scratch SQLite each, servers stopped; runner scratchpad `m10perf-e2e.sh`).
Production build: **pms-billing-screens 21/21** (local payment stub), **pms-polish-reports 8/8**, **pms-setup-reports
13/13**, **clinic-system-shell 11/11**, **pms-m10-ux 8/8**, **pms-records-screens 17/17**, **pms-integration 14/14**
(`DEMO_FLAG=1`). `next dev` with the TEST clock at Wed 28/10/2026 10:30 London: **pms-diary-screens 32/32**,
**pms-messages-screens 18/18**. pms-diary-screens fails 4 steps at the real clock at night (no free slot in the next hour)
and 2 steps on any day other than the demo Wednesday (hard-coded dates, open item 8 in §19). Running a dev server
overwrites `.next`, so run the production-build scripts first.

## 21. Ready for production – status 29/10/2026

Final verification of the K2 line after M8–M10, one bug fixed (§21.3), production pack written. `main` untouched; no
production action (no deploy, no production DB read). Fictional data only.

### 21.1 Heads (all pushed)
| What | Where | Sha |
|---|---|---|
| **K2 line** | `feat/clinic-system` | **`332b2b8`** (three `--no-ff` merges of `feat/cs-final` onto `1d861d9`: `c7ec444`, `24bc57b`, `332b2b8`; tree = `feat/cs-final` `5162e9b`) |
| Final-check fix | `feat/cs-final` (from `1d861d9`) | `c72601c` (fix + tests), `a7c120f` (wording-scan allow entry), `5162e9b` (billing e2e wait) |
| Read shim for connector id `"native"` (ships to `main` FIRST, its own deployment) | `fix/native-connector-read-shim` (from `main` `cae0c3f`) | `4e867f3` – not merged, not deployed |
| `main` (reference for the forms regression) | `main` | `cae0c3f` (untouched) |
| Docs | `docs/k2-spec`: this file, [`M11-RUNSHEET.md`](M11-RUNSHEET.md) (go-live run-sheet), `contract.md`, `requirements.md` | see `git log docs/k2-spec` |

Migrations on the K2 line: 52 new SQLite files 0100–0105, 0110–0125, 0130–0142, 0150–0152, 0160, 0170, 0180–0185, 0189,
0190, 0210–0213 (+ Postgres twins); 0191–0209 and 0214–0219 unused. They create 76 tables, 149 indexes, 9 triggers and
alter or drop nothing of ClinForms'.

### 21.2 Final chain and e2e
**Chain** (sequential, nothing else running; worktree `clinforms-wt/k2-final`, `npm ci` root + `workers/data-gateway`,
`.env.local` from cs-reporting; disk 37 GiB free):

| Step | `1d861d9` (start) | `24bc57b` (after the fix; `332b2b8` differs only in one e2e script) |
|---|---|---|
| typecheck | green | green |
| lint | green | green |
| test:pms | 780/0 | **782/0** (+2 final-check tests) |
| test:medreport | 1786/0/3 | **1786/0/3** |
| test:db | 1185/0/3 | **1187/0/3** |
| test:auth | 139/0 | 139/0 |
| test:site | 155/0 | 155/0 |
| test:gateway | 646/0/2 | 646/0/2 |
| build | green | green |

No timing test failed (R2-SEC-2 "under a second" passed in every run). On the first merge (`c7ec444`) test:medreport
had 1 fail – the neutral-wording scan on the widget's script address (§21.3), fixed in `a7c120f`.

**E2E** on `332b2b8` (`24bc57b` + the billing script fix), each on a fresh `npm run pms:seed-demo -- --fresh` scratch
SQLite (+ reports-only clinic B), ports 3240–3248, Playwright from pigeon-web, servers stopped after each.
Runner: scratchpad `k2final/k2final-e2e.sh` / `k2final/batch.sh <port> <out> prod|dev <scripts…>`.

| Script | Mode | Result |
|---|---|---|
| clinic-system-access | production build | 13/13 |
| clinic-system-shell | production build | 11/11 |
| pms-billing-screens (local payment stub) | production build | **20/21 twice, then 21/21** – test drift, fixed (`5162e9b`): the remittance step read the page under the M10 loading skeleton (the save had worked) |
| pms-design-system | production build | 14/14 |
| pms-integration (`DEMO_FLAG=1`) | production build | 14/14 |
| pms-m10-ux | production build | 8/8 |
| pms-polish-portal | production build | 9/9 |
| pms-portal-screens | production build | 15/15 |
| pms-prototype-b | production build | 6/6 |
| pms-records-screens | production build | 17/17 |
| pms-setup-reports | production build | 13/13 |
| **pms-human-check** (new; Cloudflare test keys) | production build | **3/3** (1/3 on `1d861d9`) |
| tenant-studio `FLOW=complete` (Reports-only clinic) | production build | 15/15 (5 "page problems" = RSC prefetch fallbacks on marketing links, not failures) |
| pms-diary-screens | `next dev`, TEST clock Wed 28/10/2026 10:30 London | 32/32 |
| pms-prototype-a | dev + clock | 10/10 |
| pms-messages-screens | dev + clock | 18/18 |
| pms-polish | dev + clock | 9/9 |
| pms-polish-reports | dev + clock | 8/8 |
| pms-setup-reports | dev + clock | 13/13 |

**Forms regression vs `main`** (as M9: `forms-regression.cjs`, public demo, on a production build of `origin/main`
`cae0c3f` – detached worktree, removed afterwards – and of the K2 head; `compare-form-outputs.ts` on the two
`final-outputs`): **All 5 files match** – R2 Northfield and R4 Ashcroft PDFs byte-identical; R1, R3, R5 Word files
EQUIVALENT (all 21 parts identical, only ZIP container bytes differ). Both runs 7/7 steps, no page problems, no HTTP ≥ 400.
**ClinForms output is identical.**
Logs and screenshots: session scratchpad `k2final/` (`chain/`, `chain-1d861d9/`, `e2e/`, `forms-reg/`).

### 21.3 Bug fixed in the final check (`feat/cs-final` `c72601c` + `a7c120f`, merged as `24bc57b`; head `332b2b8`)
**Turnstile was required but could not work.** Since M10 M6, production (`VERCEL_ENV=production`) refuses public
bookings and will not let staff switch on booking for new patients until `NEXT_PUBLIC_CLINIC_TURNSTILE_SITE_KEY` and
`CLINIC_TURNSTILE_SECRET` are set. But no page rendered the Turnstile widget and neither server action passed its
token on, so the moment both keys were set **every public booking and every "Email me a sign-in link" was refused**
("Please complete the check that you are not a robot…"). Public online booking for new patients was therefore
impossible on production either way.
Fix: `src/components/pms/portal/human-check.tsx` (explicit Turnstile render; token to the form; reset after each
submit, because a token works once). The booking flow's "Check and confirm" step (public mode only) and the portal
sign-in (both the form and "Send it again") show it when the page passes `humanCheckSiteKey()`; Confirm / Email me a
link wait for a token. `book/actions.ts` and `portal/actions.ts` pass `humanTokenFrom(input)` as
`FlowDeps.humanToken`. `next.config.mjs` adds `https://challenges.cloudflare.com` to `script-src` and `frame-src` (CSP
still report-only) only when the site key is set at build time. Without the keys nothing changes: no widget, no
request to Cloudflare, the same CSP for ClinForms.
Tests: `security-m10.test.ts` "final check" ×2 (the token reaches siteverify; pages and actions wired – fails on
`1d861d9`); new e2e `scripts/e2e/pms-human-check.cjs` with Cloudflare's published test keys (site key
`1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`; always pass; needs network): **1/3 on
`1d861d9`, 3/3 on the fix** (public booking with the widget; portal sign-in link twice). The neutral-wording scan
(`neutral-wording-files.test.ts`) flagged the widget's script address in `human-check.tsx` on the first merge
(`c7ec444`); it is loaded, never shown, so it got an allow entry with its reason (`a7c120f`).
The reviewer's `portal.cjs` (scratchpad `m10ux-tools/`, `m10fix/tools/`) is not part of the repo's e2e set, so it was left
as it is (§20.3 open item stands for that tool only; the repo's own portal helpers already use the scratch-DB secret).

### 21.4 What is built (by module)
- **Foundation / access** – clinic packages (Reports on, clinic system off per clinic), app shell and product switch,
  configurable role permissions with locks, page-permission map (real 404s), design system, test clock (dev only).
- **Patients and records** – patient list (search, filters incl. site, export), record with overview, notes (sign,
  addenda, copy from last), cases, outcomes, attachments, consent, history, subject-access export, data rights.
- **Diary** – day/week/room views, drag/keyboard move and resize, recurring series, rotas, blocks, closures, waiting
  list with held offers, clash/overbook rules, appointment drawer with history and context menu, free-slot search.
- **Billing** – invoices, credit notes, payments (manual; Stripe test stub), payers and contribution terms (excess
  modes), insurer claims screen + CSV, aged debt, "attended, not invoiced", bank details.
- **Messages (comms)** – templates and rules, confirmations / reminders / moved / cancelled / DNA notices, outbox
  (sign-in links hidden), letters (Word/PDF, merge fields, discharge letter), manual "Send due messages now".
- **Online booking, portal, intake** – public booking page, patient portal (email link sign-in, book / move / cancel,
  forms, documents), intake and outcome questionnaires, clinic device paired by code, staff verification, Turnstile.
- **Set-up, reports, dashboard** – sites and hours, rooms, services, prices, payers, practitioners, billing settings,
  targets, audit trail; seven reports with CSV; "Today" per role.
- **Integration** – native ClinForms connector, "Complete referrer form" filed back to the case and Forms tab, import
  from the previous system (patients, cases, appointments; undo 7 days), invoices import check only.
- **ClinForms side** – unchanged for clinics without the clinic system (forms regression §21.2); read shim on its own
  branch for rollback safety.

### 21.5 Decisions taken overnight – Khuram to confirm (default chosen and built; change any)
From §17.10 (M8 set-up, reports, dashboard)
1. Reception keeps "Practitioner rotas" in its main list and has no Set-up area; owners/admins find rotas under Set-up. **Default: as described.**
2. A site with no opening-hours rows is unrestricted; closing a site = switch it off or add a closure. **Default: unrestricted.**
3. Dashboard "Request extension" = a new letter to the insurer (no request workflow). **Default: a letter.**
4. New-vs-returning report: keep it out of the six or add a seventh page. **Default: added as the seventh report (M9b), nav label "New and returning".**
5. Outcome measures "due" = first visit of a case (no score yet) or every 4th attended session. **Default: as described.**

From §18.6 (M9 integration)
6. Reception may start "Complete referrer form", but ClinForms gets no clinical notes/outcomes from their account. **Default: allowed, no clinical prefill.**
7. Filed referrer forms are clinical: list visible with `patients.view`, file only with `clinical.view`. **Default: as described.**
8. Import undo: patients/cases archived (never deleted), appointments deleted only when untouched; undo window 7 days. **Default: as described.**
9. "Import N" needs a tick that the issues were looked at (replaces the draft's staff sample check). **Default: the tick.**
10. Native approval files the form to the case automatically, once. **Default: auto-file.**
11. The 50,000-row PGlite import run is kept out of the everyday chain (8 min); SQLite 50,000 stays in. **Default: as described.**
12. `"native"` kept in ClinForms' connector enum with a read shim on `main`, not a new connector-id mechanism. **Default: enum + shim (`fix/native-connector-read-shim` `4e867f3`).**

From §19.4 (M9b polish)
13. Waiting-list offer holds: default 2 hours (choices 30 min / 1 h / 2 h / 4 h / 1 day), never past the slot's start; the held patient may still book it; a hold cannot be overridden; blocked time cannot go over a hold; offers made before migration 0180 hold nothing. **Default: as described.**
14. Hold expiry by comparing times (no job); expired offers stay "open", shown as "hold has ended". **Default: as described.**
15. The message sweep keeps a pending confirmation / moved notice for the current start, and cancellation / DNA notices while still true (applies to every sync). **Default: as described.**
16. "Send message" from the appointment drawer sends now (only the patient's merge fields). **Default: as described.**
17. Sharing a document with the patient needs `clinical.view` + `clinical.write`; email on by default; no copy of the file kept. **Default: as described.**
18. Clinic-device forms: verified by the member's own password; stored unverified until then; hand-offs last 30 min; no outcome questionnaires on a device. **Default: as described.**
19. New and returning report: "new" = first attended appointment ever, counted for its practitioner/site; the weekly table counts visits, the figures count patients. **Default: as described.**
20. Utilisation: every kind of practitioner block counts at any site; room-only blocks do not reduce practitioner time. **Default: as described.**
21. Audit search by patient name: up to 20 patients, needs "View patients". **Default: as described.**
22. Demo seed history only on a clinic's first seed run. **Default: as described.**

From §20.1 (M10 security)
23. C1: the stored copy of a portal sign-in email has the whole link replaced; a failed sign-in email is never re-sent from the log (the patient asks again or staff resend the form). Payment and stop-email links stay visible. **Default: as described.**
24. H1: subject-access export without `clinical.view` is refused (no partial copy). **Default: refused.**
25. H2: a native ClinForms report needs `clinical.view` when it holds notes or outcome scores or is approved; refused = 404; reception still opens forms they started (no clinical prefill) until approved; the Studio list may still show the id. **Default: as described.**
26. H3: clinic device paired by an 8-character code only (no QR), 10 tries per address and 60 per clinic per 10 minutes; the device stays on "hand back" until staff verify or end it; the staff page refreshes every 5 s. **Default: as described.**
27. H4: `settings.members` locked off for clinicians and reception; only the owner changes the admin row. **Default: as described.**
28. M4: public bookings matched to an existing patient also get the new-patient forms (so the answer reveals nothing). **Default: as described.**
29. M6: production = `VERCEL_ENV=production`; there, public booking is refused and new-patient booking cannot be switched on without Turnstile; cap of 40 public bookings an hour per clinic. **Default: as described.**
30. L7: sign-in answers take at least 2.5 s, bookings at least 1.5 s; manage-link cookie `clinic_manage`, address `/booking/manage` (old links still work); staff email change ends portal sessions; `forUserId` optional launch claim. **Default: as described.**
31. ClinForms behaviour unchanged for non-native reports and clinics without the clinic system; `session.ts` untouched. **Default: as described.**

From §20.2 (M10 UX, design, production)
32. Switching Reports off on the platform page needs the clinic id typed (checked on the server). **Default: typed id.**
33. Offboarding above the gateway's 100-statement limit (only with about 720+ accounts) runs as ordered batches, organization last – not atomic as a whole. **Default: ordered batches.**
34. Global CSS not split (19.2 kB gzip; 13.6 kB without the clinic system). **Default: not split.**
35. No loading skeleton on public pages that redirect or 404. **Default: none.**
36. Patient list Site filter = a case or appointment at the site; out-of-scope sites ignored; desktop only. **Default: as described.**
37. Keyboard move/resize across practitioners or sites needs a second Enter; New appointment opens on the first free slot (grid steps); time picker is a native select. **Default: as described.**
38. Generic "Clinic system" phrases in ClinForms code kept (they mean a third-party system). **Default: kept.**

From §20.4 (M10 performance)
39. Migration numbers: diary 0210, records 0211, billing 0212, foundation 0213; 0214–0219 unused. **Default: as described.**
40. No `audit_log (tenant_id, target_id)` index (ClinForms table; history tab ~68 ms without it) and no `PRAGMA optimize` migration. **Default: neither.**
41. "Attended, not invoiced" shows the newest 500 with "Showing the 500 most recent of N"; Today's "Invoices to raise" lists the 4 longest waiting with the full count. **Default: as described.**
42. Today's overdue list shows the 4 longest overdue of all overdue invoices. **Default: as described.**
43. `listDiary` throws over 90 IN-list ids instead of silently cutting the list. **Default: throw.**
44. Import undo writes one audit row per group of up to 90 (with a count) instead of two rows per record. **Default: as described.**

From the final check (§21.3)
45. The Turnstile widget sits on the booking's "Check and confirm" step (public booking only) and on the portal sign-in (form and "Send it again"); Confirm / Email me a link stay disabled until it gives a token; Managed mode; portal bookings by signed-in patients and staff bookings have no widget. **Default: as described.**
46. The CSP gets `challenges.cloudflare.com` only when the site key is set at build time (so Turnstile needs a redeploy after the variables are added). **Default: as described.**

### 21.6 Open items and known limits
**Before go-live (blocking, all Khuram's – §21.7):** the read shim on `main` and live; production D1 migrations; the
K2 merge; Turnstile for public booking (until then production refuses public bookings – safe); a real email provider
before any patient can use the portal (the outbox-only default sends nothing, and sign-in links are not shown to
staff).

**Open items (not blocking an "off for every clinic" release):**
1. Preview rehearsal (run-sheet §2) not run – needs preview D1 and a preview deployment.
2. "Send due messages" on real D1 – re-measure (12.7 s on the local workerd proxy, D1's own time 0.15 s). The message
   run stays manual on Hobby (one cron a day, used by retention).
3. Import: invoices / opening balances (billing port unwired), reconciliation report, historic notes/documents archive,
   mapping saved per clinic, possible-duplicate warning, "Download skipped rows". Imported future appointments get no
   confirmation/reminder messages.
4. A clinic's own Word/RTF letter templates filled in their own layout; portal sharing of letters; "Send to insurer" on
   a filed form.
5. CF-006: no dedicated native-connector usage test (usage counting is connector-agnostic).
6. Five portal set-up tables still key audit rows on revision + time (staff-only screens).
7. `audit_log (tenant_id, target_id)` index – not added (decision 40).
8. pms-diary-screens / pms-messages-screens hard-code dates of the demo week – they pass only with the test clock on
   Wed 28/10/2026 (and pms-diary-screens needs free slots in the next hour at the real clock).
9. The reviewer's crawl tool `portal.cjs` (scratchpad, not in the repo) still reads sign-in links from Messages, which
   C1 hides – update it to the repo helpers' approach if the crawl is run again.
10. The remaining axe target-size case on 15-minute diary blocks with appointments directly above and below (needs
    ≥ 26 px per 15 min; keyboard, drawer and context menu reach every block).

**Known limits:**
- A missing or out-of-scope record id under a loading skeleton returns HTTP 200 with the 404 page (no data shown).
- The Studio's snapshot list still lists ids of native reports a member may not open (opening answers 404).
- SMS webhook replay check uses the message id only (SMS provider not live).
- A same-millisecond double use of one sign-in link by its own holder could open two sessions.
- Offboarding above about 720 member accounts is ordered batches, not one atomic batch.
- Clinic device on a staff PC may still hold a staff session in that browser – use kiosk / guided access.
- Two simultaneous OFFERS of the same slot are checked by the server only (bookings over a hold are database-enforced);
  a "moved" notice lost to a failed sync is not re-created.
- Utilisation year is the slowest report (about 1.6 s on local D1 at 50k patients); the owes-money filter reads through
  the patient index (about 180 ms).
- The global CSS includes the clinic-system styles on every page (19.2 kB gzip vs 13.6 kB).
- `typecheck:gateway` reports one `pdfjs-dist` declaration error in a file unchanged since `main` (not run in the chain).

### 21.7 Go-live steps that need Khuram
All in [`M11-RUNSHEET.md`](M11-RUNSHEET.md) (gates G1–G9 first). In order:
1. **Ship the read shim** `fix/native-connector-read-shim` `4e867f3` to `main` on its own and let it deploy – this
   deployment is K2's rollback point (run-sheet §1).
2. (M11, no production access) merge the candidate with the new `main`, re-run the chain, the forms regression and
   the preview rehearsal on preview D1 (§2–§3).
3. **Apply the 52 migrations to production D1** after taking a time-travel bookmark (§4).
4. **Merge `feat/clinic-system` into `main` and push** – the clinic system is off for every clinic (§5).
5. Read-only smoke tests and the flag check (every clinic Reports ON, clinic OFF) (§6a–6b); **signed-in check as
   `appstackx-test`**, not Blue Heart (§6c).
6. When public online booking is wanted: **create the Turnstile widget** (hostnames `clinforms.co.uk`,
   `www.clinforms.co.uk`), set `NEXT_PUBLIC_CLINIC_TURNSTILE_SITE_KEY` and `CLINIC_TURNSTILE_SECRET` (Sensitive) for
   Production, redeploy (§4b).
7. Only with a separate go: switch the clinic package on for a demo or test clinic (§6d). Never switch Reports off for a
   live clinic (the platform page now asks for the clinic id typed).
8. Answer the decisions in §21.5.
