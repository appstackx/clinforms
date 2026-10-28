# K2 clinic system – handover

> **Update 28/10/2026 (M5 billing – IN PROGRESS, read §14 first):** billing BACK END done and pushed on `feat/cs-billing` `0d5a728` (not yet merged into `feat/clinic-system`); screens, seed and e2e next. See §14.

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


## 14. M5 billing (28/10/2026) – IN PROGRESS (midpoint)

**Where:** worktree `/Users/khuram/Projects/Appstackx/clinforms-wt/cs-billing`, branch `feat/cs-billing`, pushed.
`feat/clinic-system` is still `c05be50` (billing NOT merged yet). `main` untouched.

| Commit | What |
|---|---|
| `547eec6` | `origin/feat/clinic-system` (`c05be50`) merged into the October draft – no conflicts; records test updated (billing's Invoices tab replaces its stand-in) |
| `94926a8` | Diary fixes from §13.4: (2) arrived / in treatment / completed only from 60 min before the start, DNA only after it (rule + server check + tests; existing diary suites now change statuses on the visit's own time); (3) Double-booked marker is part of the block's top line (never covers text); (4) record "Book" → `diary?patient=<id>` opens the booking form with the patient and open case. Plus `waiveAppointmentFee` for billing |
| `0d5a728` | Billing back end (review fixes + new work, below) |

### 14.1 Review findings on the October draft (fixed in `0d5a728`)
1. **Authorisation sessions double-counted**: the diary counts a session when a visit is completed; the draft's
   `issueInvoice` counted the same sessions again. Now billing counts the VALUE and only hand-entered treatments'
   sessions (`sessionsUsedBy`).
2. **No site scope** on invoices/payments: `site_id` added (0133 invoices, 0135 payments; set from the visits / the
   site the payment was taken at); every billing read applies `actor.siteIds`; out-of-scope = "no such invoice".
3. **Audit after the batch** in issue, unallocate, reverse, link status: now in the same batch with a conditional
   `INSERT … WHERE EXISTS` (`billingAuditWhen`); the credit note's authorisation reset is inside its batch (the
   foundation's `recordAuthorisationUsage` still audits itself just after).
4. **Lines from the client**: invoicing visits takes appointment ids only; visits, prices, payers and fees are read
   on the server from the diary adapter.
5. Missing: void, write-offs, short payments, saved card, clinic-wide "attended not invoiced", invoice search.

### 14.2 What the back end does now
- Diary visit adapter `src/server/pms/diary/billing-visits.ts` (wired in `visit-source.ts`): CHARGEABLE_STATUSES
  only – completed, and DNA / late cancellation only with the diary's fee flag; never arrived / in treatment.
- Pricing (`priceVisits`): completed visits of a case with a payer bill the payer; DNA/late fees and self-pay bill
  the patient; case price list → default → service price; the case's excess (one amount per case) is taken from
  the first visits in date order and goes on its own patient invoice (`excess_deduction` on the insurer's).
- Credit note kinds (0132): credit, write_off, void, transfer (all numbered CN). Void (0134 `voided_at`) =
  `billing.void`, refused while payments are on it. Write-off / transfer keep the visit billed.
- Remittance (`remittanceFor`): one insurer payment over many invoices; per invoice short payment → leave /
  write off (reason) / move to patient (patient invoice + transfer credit). Write-off and move need `billing.refund`.
- Take payment (`takePaymentFor`): card on file (saved TEST card, 0136), card now (reader, recorded by hand), cash
  (change), bank transfer, payment link. Refunds go back to the card through the test provider when the payment
  was taken through it. `stripe_test` still refuses non-test keys; new `CLINIC_STRIPE_TEST_API_BASE` accepts only
  Stripe's host or a loopback address (for the local e2e stub).
- Server layer `src/server/pms/billing/{access,views,writes}.ts`; tests `src/server/pms/billing/testing/service-suite.ts`
  on SQLite, PGlite, D1 stand-in and local D1.

Checks at `0d5a728`: test:pms 412/412, lint clean, billing D1 stack 46/46, parity 11/11 (full chain not yet run).

### 14.3 Next (in this order)
Screens (billing list/tabs, invoice detail, take payment incl. 375 px, invoice visits, remittance, print invoice +
statement), wiring (drawer Take payment, record Account card + Invoices tab, patient list Balance + Owes money,
nav), billing seed from `seed-demo.ts`, `scripts/e2e/pms-billing-screens.cjs`, full chain, merge into
`feat/clinic-system`, merge back into cs-diary/cs-records, finish this section.
