# K2 clinic system – handover

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
