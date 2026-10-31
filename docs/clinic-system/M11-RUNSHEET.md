# M11 run-sheet – clinic system (K2, module `pms`) to production

**Status 29/10/2026 (final check):** candidate `feat/clinic-system` @ `332b2b8` (M8–M10 merged, plus the final-check
fix `feat/cs-final`), reviewed against `main` @ `cae0c3f` (main is the merge base, so this is a fast-forward of
ClinForms code plus the K2 commits). Read-shim branch `fix/native-connector-read-shim` @ `4e867f3` (from `cae0c3f`;
pushed, not merged, not deployed). First drafted by M10 on `842bb02`; brought up to date with M10's changes
(migrations to 0213, Turnstile, offboarding batches, Reports switch-off with the typed id, sign-in link hidden in the
outbox) and the final check (HANDOVER §21).

**Update 30/10/2026 – production data is on Supabase Postgres.** ClinForms production moved from D1 to Supabase
(project `clinforms`, Postgres 17, London) on 29/10 ~22:45 (bh2-handover `SUPABASE-MOVE-PLAN.md`, "Live log"). So K2's
52 migrations now go to **Supabase** with `CLINFORMS_DB=postgres npm run db:migrate` (session pooler + CA, step 4),
**not** `wrangler d1 migrations apply`. **Previews stay on D1 `clinforms-preview`** (step 2 unchanged). K2 was proven end
to end on a Supabase-like Postgres (Docker `postgres:17`, en_US.UTF-8): every e2e script, the chain, the 50k-patient
perf run and two Postgres-only bug fixes – HANDOVER §22. New Supabase-only steps: §4 (pre-checks S1–S5) and the
rollback rows in §7.

**Nothing here has been run against production.** Every step marked **[K]** is Khuram's to approve or run himself
(CLAUDE.md: production D1, `main`, Vercel promotion, Cloudflare dashboard). Never paste secrets, invite links, sign-in
links or tokens into chat or logs. Secrets live in `~/.config/appstackx/clinforms.secrets.env`; refer to them by name only.

Production facts this sheet relies on:
- App: Vercel project `clinforms`, Hobby plan. A push to `main` builds and promotes to production. **One-step rollback
  only** (to the deployment immediately before), **one cron a day** (`vercel.json` already uses it for
  `/api/cron/retention`).
- Data (PRODUCTION, since 29/10/2026): **Supabase Postgres 17** project `clinforms` (eu-west-2 London, compute
  **Micro**, Pro organisation, Data API off, automatic RLS on). Vercel Production has `CLINFORMS_DB=postgres`,
  `DATABASE_SSL=verify-full`, `DATABASE_URL` = the shared **transaction** pooler (port 6543) and `DATABASE_CA_CERT`.
  The app connects as `postgres` (owner, BYPASSRLS – see S3). Migrations need ONE session: the **session** pooler
  (port 5432, `DATABASE_URL_SESSION`); the runner refuses 6543. Connection values: `~/.config/appstackx/clinforms.supabase.env`
  (`PRODUCTION_DATABASE_URL_SESSION`, `PRODUCTION_DATABASE_URL`), CA: `~/.config/appstackx/supabase-ca.crt` – names only,
  never print them. Text sorts in **en_US.UTF-8** order there, not byte order (HANDOVER §22).
- D1 `clinforms-prod` is FROZEN (rollback target until about 29/11/2026; `CLINFORMS_D1_GATEWAY_*` kept in Vercel). Do
  **not** apply K2's migrations to it. Previews still use D1 `clinforms-preview` behind the `clinforms-data` Worker
  (account `appstackx-demos` `a04ab546d0f1be2aa339bafebcdb3ffa`; no table allow-list, SQL shape only; at most **100
  statements per batch**; no Worker redeploy needed).
- The public clinic pages (booking, portal, clinic device) are served by the same deployment at
  `https://clinforms.co.uk/clinics/<clinic>/…`. They answer 404 for every clinic without the clinic package.
- Blue Heart (`blue-heart-clinics`) is on a live ClinForms trial. It must see no change.

Helpers (as DEPLOY.md):
```bash
MAIN=~/Projects/Appstackx/clinforms
vc() { npx --yes vercel@63.1.0 "$@"; }
wr() { (cd "$MAIN/workers/data-gateway" && CI=1 WRANGLER_SEND_METRICS=false CLOUDFLARE_ACCOUNT_ID=a04ab546d0f1be2aa339bafebcdb3ffa ./node_modules/.bin/wrangler "$@"); }
CHAIN='npm run typecheck && npm run lint && npm run test:pms && npm run test:medreport && npm run test:db && npm run test:auth && npm run test:site && npm run test:gateway && npm run build'
RUN=~/Desktop/k2-deploy-$(date +%Y%m%d); mkdir -p "$RUN"
# Supabase PRODUCTION migrations (session pooler, verified TLS). Values are read into the subshell only, never printed.
pgprod() { (set -a; . ~/.config/appstackx/clinforms.supabase.env; set +a
  export CLINFORMS_DB=postgres DATABASE_SSL=verify-full DATABASE_CA_CERT="$(cat ~/.config/appstackx/supabase-ca.crt)"
  export DATABASE_URL_SESSION="$PRODUCTION_DATABASE_URL_SESSION" DATABASE_URL="$PRODUCTION_DATABASE_URL_SESSION"
  "$@"); }
# read-only SQL on production (psql 17+ installed locally; or paste the SELECT into the Supabase SQL editor)
pgq() { pgprod sh -c 'PGSSLMODE=verify-full PGSSLROOTCERT=$HOME/.config/appstackx/supabase-ca.crt psql "$DATABASE_URL_SESSION" -X -A -t -v ON_ERROR_STOP=1 -c "$1"' _ "$1"; }
```

---

## 0. Go / no-go gates (all must hold before step 1)

| # | Gate | Status 29/10/2026 | Who |
|---|---|---|---|
| G1 | **Read shim for `"native"` is on `main` and LIVE as its own deployment** (step 1). Without it, a Vercel rollback from K2 makes every report a clinic made through "Complete referrer form" unreadable. | Shim built and green (`4e867f3`, `m10/SHIM-DEPLOY-NOTE.md`); not merged. K2 line already has it merged and the guard (`schema-forward-compat.test.ts`) runs with **no** `PENDING_SHIM_ON_MAIN` exception. | **[K]** merges and pushes it |
| G2 | M10 findings (security C1, H1–H4, M1–M6, L1–L7; UX 1–21; production 2–8; performance A–D and 1–7) are fixed on `feat/clinic-system`, or Khuram accepts them. | All fixed except the documented "not done" items (HANDOVER §20, §21.6). Khuram to accept the decisions list in §21.5. | **[K]** |
| G3 | The full CHAIN is green on the exact commit to be merged (re-run after any rebase onto a moved `main`). | Green on `332b2b8` (HANDOVER §21.2). | M11 |
| G4 | `feat/clinic-system` is rebased or merged onto the **current** `main` **including the shim merge** (main must not have moved past `cae0c3f` + shim without a re-run of G3 and of the forms regression). | `main` = `cae0c3f` on 29/10. | M11 |
| G5 | Forms regression (`scripts/e2e/forms-regression.cjs` + `compare-form-outputs.ts`) on builds of `main` and of the candidate: **all 5 files match**. Also the tenant-mode Studio check for a Reports-only clinic (`scripts/e2e/tenant-studio.cjs` with `FLOW=complete`), on both builds. | Both green on `332b2b8` vs `cae0c3f` (§21.2). The `tenant-studio` script drift found by M10 is fixed (it adds the owner's signing details first). | M11 |
| G6 | Preview D1 has had all **52** K2 migrations applied and the preview app has run on the candidate for at least one smoke pass (step 2). | Not done (needs preview access). | M11 (preview only) |
| G6b | **K2 on Postgres** proven on a Supabase-like Postgres 17 (en_US.UTF-8): migrations in production order (main's 7, then K2's 52), RLS on every table, every e2e script, the chain, 50k perf. | **Done 30/10** (HANDOVER §22; `feat/clinic-system` `d5fc35f`). | M11 |
| G10 | Supabase pre-checks S1–S5 (step 4): backups/PITR, compute size, app role decision, JIT setting, pooler limits. | Open | **[K]** |
| G7 | Khuram chose a quiet window: no Blue Heart session in progress (`trial-activity.sh`, read-only, counts only). | – | **[K]** |
| G8 | Nobody deploys anything else between the shim deployment (step 1) and the K2 deployment (step 5): Hobby rolls back one step only. | – | everyone |
| G9 | **Turnstile** decision: either the widget is set up (step 4b) before any clinic switches on online booking for new patients, or online booking stays off / existing patients only. Without it production **refuses** public bookings (M10 M6). Not needed for the K2 deployment itself (the clinic package is off everywhere). | Widget not created yet; code path verified locally with Cloudflare's test keys (`pms-human-check.cjs`). | **[K]** |

## 1. Ship the read shim for connector id `"native"` to `main` FIRST (its own deployment = rollback point)  **[K]**

Branch `fix/native-connector-read-shim` @ `4e867f3`, off `main` `cae0c3f`. Full description, risk and test results:
`SHIM-DEPLOY-NOTE.md` (session scratchpad `m10/`). In short:
- `src/modules/medreport/core/stored-schemas.ts`: `ConnectorIdSchema` joins `FORWARD_OPEN_ENUMS`, so a STORED report,
  bundle snapshot or receipt with `connectorId: "native"` reads with every key kept. Writes stay strict
  (`core/schemas.ts` unchanged), so main can never create or sign a native report.
- Neutral display fallbacks for an unknown connector id (`labels.ts`, review `originLabel` "From clinic records",
  `use-review-actions`, `studio-events` → `clinic_system`, `home-screen`, `approved-banner`).
- "Re-use notes" on such a report answers **403 `CONNECTOR_NOT_AVAILABLE`** (was 500); file-back to `native` stays 404.
- Closed-vocabulary fixture updated; new `scripts/medreport/native-connector-read-shim.test.ts` (9 tests: lists, reads
  whole in both stores, receipt verifies, FINAL byte-identical to a known connector's, reuse/file-back 4xx, writes strict,
  labels).
- Shim chain (29/10): typecheck, lint, build green; test:medreport 1786/0/3, test:db 398/0/3, test:auth 132/0,
  test:site 88/0, test:gateway 239/0/2.

Nothing is left to do on `feat/clinic-system` for the shim: it is merged there and `PENDING_SHIM_ON_MAIN` is gone.

```bash
cd "$MAIN" && git fetch origin && git switch main && git pull --ff-only && git status --porcelain     # clean
git diff origin/main...origin/fix/native-connector-read-shim --stat                                  # review
vc ls clinforms --environment production --limit 3 | tee "$RUN/prod-before-shim.txt"                # note current (cae0c3f)
git merge --no-ff origin/fix/native-connector-read-shim -m "Merge fix/native-connector-read-shim: read reports whose connector is the clinic system"
npm ci && (cd workers/data-gateway && npm ci) && eval "$CHAIN"
git push origin main
SHIM=$(git rev-parse HEAD); PROD=$(vc ls clinforms --environment production -m githubCommitSha="$SHIM" --limit 1)
echo "$PROD" | tee "$RUN/shim-deployment.txt"; vc inspect "$PROD" --wait --timeout 15m
```
Smoke: the read-only checks of step 6a, plus the shim note's step 4 (sign in to a test clinic, open the report list and
an approved report, render FINAL, "Re-use notes" on an uploaded-notes report, public demo + Simulated TM3 flow).
**This deployment is the rollback point for K2.** Any later rollback from K2 must go to it or later, never before it.

## 2. Preview rehearsal (no production access)

```bash
cd <candidate worktree>                                   # feat/clinic-system merged with main incl. the shim
wr d1 migrations list clinforms-preview --remote --env preview              # expect 52 pending: 0100…0190, 0210…0213
wr d1 time-travel info clinforms-preview                                     # note the bookmark
wr d1 migrations apply clinforms-preview --remote --env preview              # 52 ✅
wr d1 execute clinforms-preview --remote --env preview --json --command \
  "SELECT package, status, count(*) n FROM clinic_entitlements GROUP BY package, status"   # reports|active = number of clinic_profile rows
```
Then deploy the candidate as a Vercel **preview** (not production) pointed at the preview gateway, and run on it:
`tenant-studio.cjs FLOW=complete` (Reports-only clinic: nav has no "Clinic system", Studio works, no product switch);
`clinic-system-shell.cjs` and `pms-integration.cjs` with a preview clinic that has the clinic package switched on
(`npm run admin:set-entitlement -- --env preview --slug <zz-test> --package clinic --on --confirm`).
Optional on preview: set Cloudflare's **test** Turnstile keys (site key `1x00000000000000000000AA`, secret
`1x0000000000000000000000000000000AA` – published test values, always pass) on the preview environment only and run
`pms-human-check.cjs` against it; preview does not require Turnstile (`VERCEL_ENV=preview`).

**Offboard the test clinics afterwards** (`admin:offboard-clinic`). Since M10 the offboarding deletes only the
clinic-system tables that have rows, and sends **one atomic batch** while the statements fit the Worker's 100-statement
limit (always, in practice – `src/server/auth/offboard-batch.test.ts`); past it (only with hundreds of member accounts,
about 720+) it sends **ordered batches with the organization tombstone last**, which are not atomic as a whole. A test
clinic is far below the limit, so the preview offboarding proves the single batch on the real Worker. Tables that do not
exist yet are treated as empty (`countPmsRows`, `exportPmsData`, `listClinicPackages`).

## 3. Forms regression (local, both builds)

As M9 and the final check did (scratchpad `forms-reg.sh <checkout> <port> <out>`), on a production build of `main`
(with the shim) and of the candidate, then
`node --import ./scripts/medreport/test-setup.mjs --import tsx scripts/e2e/compare-form-outputs.ts <main-out> <cand-out>`
→ "All 5 files match" (2 PDFs byte-identical; 3 Word files equivalent – only ZIP container bytes differ). Plus
`tenant-studio.cjs FLOW=complete` on both, against local SQLite, for a Reports-only clinic (15/15 on the candidate).

## 4. Production migrations on SUPABASE BEFORE the app  **[K]**

Order matters: the new app reads `clinic_entitlements` on every `/app` page. That read is fail-safe (Reports ON,
clinic OFF), and the platform page, offboarding and exports treat a missing clinic-system table as empty – but every
clinic-system page needs its tables. The migrations are additive for ClinForms: `main`'s code never reads the new tables,
so applying them first is invisible to ClinForms. **Not `wrangler d1 migrations apply`** – production data is on Supabase.

### 4a. Supabase pre-checks (G10) **[K]** – in the Supabase dashboard, nothing changes data
| # | Check | Why |
|---|---|---|
| S1 | **Backups:** Database → Backups shows a daily backup from today. **Turn on PITR** (add-on) **before any real clinic data** goes into the clinic system (not needed while the clinic package is off everywhere, but before 6d for a real clinic). Note the time just before 4b as the restore point. | There is no D1 time travel on Supabase; a restore is whole-database (§7). |
| S2 | **Compute:** Micro (1 GB RAM, shared CPU) is enough for the release (clinic package off; ClinForms is small). **Move to Small (or larger) before a real clinic's data** – the 50k-patient clinic is 1.2 GB on disk, more than Micro's memory; the heaviest reports read hundreds of thousands of rows (HANDOVER §22.5). Check Reports → Database: memory and CPU after the first weeks. | Report speed at scale. |
| S3 | **App login role:** the app still connects as `postgres` (owner, BYPASSRLS). Planned (docs/database.md §10): a non-owner role, e.g. `clinforms_app` – `LOGIN`, **`BYPASSRLS`** (RLS is on with NO policies, so without it every read returns nothing) or real policies; `USAGE` on schema `public`; `SELECT, INSERT, UPDATE, DELETE` on all tables **except** `audit_log` (`SELECT, INSERT` only); `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT …` so tables from later migrations are covered; migrations keep running as `postgres`. Pooler user name = `clinforms_app.<project ref>`. Not required for the K2 release; if done, do it as its own change with a sign-in smoke test, not together with step 4b. | An owner can drop the audit triggers. |
| S4 | **JIT:** run `show jit;` in the SQL editor. If `on`, consider `alter role postgres set jit = off` (or on the app role) – JIT added ~150 ms to the year reports on Postgres 17 locally (HANDOVER §22.5); OLTP pages are unaffected. Optional. | Report latency. |
| S5 | **Pooler:** the app uses the transaction pooler (6543) with a pool of 3 per function instance (`DATABASE_POOL_MAX`); K2 needs no session state, advisory locks are transaction-scoped (`pg_advisory_xact_lock`), no named prepared statements. Check the pooler's client-connection limit for Micro in Database → Settings is well above (Vercel instances × 3). | Connection limits. |

### 4b. Apply the migrations **[K]**
```bash
cd <candidate worktree>                                   # feat/clinic-system merged with main incl. the shim; npm ci done
# Before: what is applied (expect 7 rows: 20261010000001, …02, …04, …05, 20261024000006, 20261025000007, …08)
pgq "select version from public.schema_migrations order by version" | tee "$RUN/pg-migrations-before.txt"
pgq "select count(*) from pg_tables where schemaname = 'public'" | tee -a "$RUN/pg-migrations-before.txt"   # 27
pgq "select count(*) from public.clinic_profile" | tee -a "$RUN/pg-migrations-before.txt"                   # N clinics
# Apply: one transaction per file, session-level advisory lock, idempotent. Prints the file names only.
pgprod npm run -s db:migrate | tee "$RUN/pg-migrations-apply.txt"     # "Postgres: applied 20261024000100_…, …, 20261024000213_…" (52)
pgprod npm run -s db:migrate                                          # "Postgres: up to date"
# After
pgq "select count(*) from public.schema_migrations"                                   # 59
pgq "select count(*), count(*) filter (where c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'"   # 103|103 (plus any Supabase tables in public, e.g. none)
pgq "select package, status, count(*) from public.clinic_entitlements group by 1, 2"   # reports|active|N (= clinic_profile count)
```
The 52 files (0100–0105, 0110–0125, 0130–0142, 0150–0152, 0160, 0170, 0180–0185, 0189, 0190, 0210–0213 as
`supabase/migrations/20261024000NNN_*.sql`) create 76 tables with their indexes, and 5 trigger functions with 5 triggers on 4 `pms_*` tables
(appointment clash and hold, signed-note and amendment locks, sealed intake responses). Their `ALTER TABLE` / `DROP TRIGGER` statements touch only the clinic system's own
tables created earlier in the same set; **no ClinForms table, index or trigger is altered or dropped**. Every table gets
`enable row level security` in its own file (Supabase's automatic-RLS event trigger is not relied on). The backfill
(0100) inserts `reports/active` per `clinic_profile` row (`on conflict do nothing`). Their timestamps (20261024…) sort
BEFORE main's `20261025000007/8`; the repo's runner applies by missing version, so that is fine – **do not use `supabase
db push`** (it would refuse them without `--include-all`). Rehearsed on Postgres 17.11 with en_US.UTF-8 in exactly this
order (main's 7 first, two `clinic_profile` rows, then K2's 52): 27 → 103 tables, all RLS on, backfill 2 rows, second run
"up to date", schema identical to a from-scratch migration (HANDOVER §22.1).
**Stop rule:** any error → stop (the runner stops at the failed file; that file's transaction is rolled back, the files
before it stay recorded). Do not push the app. Fix forward on the branch with a new migration number, never by editing
an applied file. The new tables take locks only on themselves; ClinForms requests are not blocked.

## 4b. Cloudflare Turnstile for public online booking  **[K]** (before any clinic takes online bookings from new patients)

Why: on production (`VERCEL_ENV=production`) the public booking page **refuses every booking** and staff **cannot switch
on "booking for new patients"** until the bot check is set up (M10 M6, `src/server/pms/portal/human-check.ts`). When it
is set up, the booking page's "Check and confirm" step and the portal's "Email me a sign-in link" show the Turnstile
widget, and the server checks each token with Cloudflare's siteverify before booking or sending a link. (The widget and
the token hand-over were missing until the final check – fixed in `feat/cs-final`, HANDOVER §21.3.) Existing
patients booking from the portal (signed in) and staff booking are not affected.

1. Cloudflare dashboard → Turnstile → **Add widget** (account of Khuram's choice; `appstackx-demos` holds the D1).
   Name "Clinic system public booking"; hostnames **`clinforms.co.uk`**, **`www.clinforms.co.uk`** (and the clinic
   system's own domain when `src/lib/brand.ts` gets one); widget mode **Managed**; no pre-clearance.
2. Vercel → project `clinforms` → Settings → Environment Variables, **Production only**:
   - `NEXT_PUBLIC_CLINIC_TURNSTILE_SITE_KEY` = the widget's site key (public; shown in the page);
   - `CLINIC_TURNSTILE_SECRET` = the widget's secret key (**Sensitive**; never in chat or logs).
   Both must be set – with only one, the check counts as not set up.
3. **Redeploy** production (Vercel → Deployments → the current production deployment → Redeploy, or the next push to
   `main`). The site key is read at run time, but `next.config.mjs` adds `https://challenges.cloudflare.com` to the
   Content-Security-Policy (`script-src`, `frame-src`; still report-only) only when the site key is present **at build
   time**. Note: a redeploy is a new deployment – it moves the one-step rollback point (G8). Do this **after** step 5 is
   settled, or set the two variables **before** step 5 so the K2 build already carries them.
4. Check (no sign-in): `curl -sI https://clinforms.co.uk/ | grep -i content-security` lists `challenges.cloudflare.com`;
   on a demo clinic with the clinic package and online booking on, `/clinics/<demo>/book` shows the widget on "Check and
   confirm", and `/clinics/<demo>/portal` shows it above "Email me a sign-in link". Set-up → Online booking now lets
   the owner switch on booking for new patients.
5. To switch it off again: remove both variables and redeploy – production then refuses public bookings again (safe).

## 5. App to production  **[K]**

```bash
cd "$MAIN" && git switch main && git pull --ff-only && git status --porcelain        # HEAD = $SHIM
git merge --no-ff origin/feat/clinic-system -m "Merge feat/clinic-system: clinic system (K2), off for every clinic until switched on"
npm ci && (cd workers/data-gateway && npm ci) && eval "$CHAIN"
git push origin main
K2=$(git rev-parse HEAD); PROD=$(vc ls clinforms --environment production -m githubCommitSha="$K2" --limit 1)
echo "$PROD" | tee "$RUN/k2-deployment.txt"; vc inspect "$PROD" --wait --timeout 15m; vc inspect "$PROD" --logs | tail -40
```
No env var is required for the app to run with the clinic system OFF. Defaults are safe: messages go to the outbox,
payments are manual, Turnstile is not set up (so production refuses public bookings – step 4b), and
`CLINIC_*_PROVIDER=test` is refused on `VERCEL_ENV=production` unless `CLINIC_ALLOW_TEST_PROVIDER=1` (never set it).
`CRON_SECRET` already exists and is used by the retention cron. **Do not add a second cron to `vercel.json`**: Hobby
refuses the deploy. The message run stays manual ("Send due messages now"); re-measure "send due" on **Supabase** once a
demo clinic has messages (locally on Postgres 17: 848 ms for 1,787 statements at the 50k clinic – each statement is a
round trip through the pooler, so expect about 2–4 s from lhr1; M10's 12.7 s was the local D1 proxy). No production env
var changes for K2: `CLINFORMS_DB=postgres` and the pooler URL + CA are already set.

## 5b. ClinDesk domain go-live – clindesk.co.uk  **[K]**

The ClinDesk website (`src/app/clindesk-site`, `205fa00`) and sign-in on both hosts (`feat/clindesk-auth` `6ea6a1c`,
merged into `feat/clinic-system` at `00faac8` – `docs/auth.md` §1a) ship in the same deployment as step 5. Without
the variables below, production behaves exactly as before: one static base URL (`BETTER_AUTH_URL`), every link and
email on clinforms.co.uk / ClinForms (tests: `src/server/auth/brand-hosts.test.ts` "regression", the e2e runs). The
website shows only on ClinDesk's hosts (`src/lib/brand.ts`, `src/middleware.ts`). Do these after step 5.

1. **Fill-ins.** Fill `content/clindesk-site.json` (57 keys – `docs/clinic-system/CLINDESK-SITE-CONTENT.md`; the 8
   `legal.*` keys and `security.region` / `security.icoRegistration` / `company.*` are the legal pages' [to confirm]
   items, some for a lawyer) on a branch → `feat/clinic-system` → `main`. Production shows "[to confirm]" for anything
   left in brackets. Check:
   `for p in /pricing /privacy /terms /cookies; do curl -s https://clindesk.co.uk$p | grep -o 'data-to-confirm="[^"]*"'; done | sort -u`.
   `/privacy`, `/terms`, `/cookies` are ClinDesk's own text now (ClinForms' pages unchanged); have them reviewed.
2. **Vercel domains** – already added to project `clinforms` (`clindesk.co.uk` Production, `www.clindesk.co.uk`
   308 → apex). Nothing to do; they show "Invalid Configuration" until step 3. (The app also redirects www → apex –
   `next.config.mjs`.)
3. **DNS on Cloudflare** (zone `clindesk.co.uk`) – both records **DNS only (grey cloud)**, TTL Auto; delete any other
   `@` A/AAAA/CNAME and `www` record first (parking, registrar defaults):

   | Type | Name | Value | Proxy |
   |---|---|---|---|
   | A | `@` | `76.76.21.21` | DNS only |
   | CNAME | `www` | `cname.vercel-dns.com` | DNS only |

   CAA: only if the zone has CAA records, add `@ CAA 0 issue "letsencrypt.org"`. SSL/TLS mode does not matter while
   grey-clouded. Wait until Vercel → Settings → Domains shows "Valid Configuration" and a certificate for both, then
   `curl -sI https://clindesk.co.uk/ | head -1` → 200 and `curl -sI https://www.clindesk.co.uk/ | grep -i ^location`
   → `https://clindesk.co.uk/`. Rollback: delete the two records (or the domains in Vercel); ClinForms is not affected.
4. **Vercel environment – Production only** (Settings → Environment Variables; values in a chmod 600 file on the
   Desktop as usual; then **Redeploy** the current production deployment, without the build cache):

   | Variable | Change | Value |
   |---|---|---|
   | `CLINFORMS_AUTH_ORIGINS` | **add** (Production only – never Preview) | `https://clindesk.co.uk` |
   | `BETTER_AUTH_URL` | keep | `https://clinforms.co.uk` (the primary origin and the fallback for any other host) |
   | `APP_ORIGIN` | check it is **not set** (if set to clinforms.co.uk, patient portal links stay on clinforms.co.uk) | – |
   | `MAILERSEND_FROM_EMAIL_CLINIC` | add **only after step 5** (domain verified in MailerSend) | `no-reply@clindesk.co.uk` |

   No other variable changes (secrets, cookies, database, `CLINFORMS_PLATFORM_ADMINS` stay). A bad
   `CLINFORMS_AUTH_ORIGINS` value (not https, a path, a host that is not a brand host) stops sign-in from starting on
   both hosts – to undo, remove the variable and redeploy. Also add `PRODUCTION_CLINFORMS_AUTH_ORIGINS=https://clindesk.co.uk`
   to `~/.config/appstackx/clinforms.secrets.env`, so `npm run admin:create-clinic -- --env production --brand clinic …`
   prints clindesk.co.uk links (without it the script prints clinforms.co.uk and says so).
   What it does (`docs/auth.md` §1a): sign-in, two-step set-up, invitations, resets and the app work on both hosts; one
   account per person; sessions are host-only (signing in on one host does not sign you in on the other); invitation
   and reset emails link to the **clinic's** brand host (clinic package → clindesk.co.uk, otherwise clinforms.co.uk) and
   are branded to match; the authenticator entry is "ClinDesk" when set up on clindesk.co.uk. Open invitations keep the
   link they were sent with – it works on either host.
5. **MailerSend – only if ClinDesk's emails should come from `@clindesk.co.uk`** (otherwise skip: they come from
   `MAILERSEND_FROM_EMAIL` as "ClinForms", as today):
   1. MailerSend → Domains → **Add domain** `clindesk.co.uk` (same account as clinforms.co.uk; check the plan allows a second sending domain).
   2. Add the records it shows in Cloudflare DNS, **DNS only**: SPF `TXT @ v=spf1 include:_spf.mailersend.net ~all`
      (merge into one SPF record if one exists), DKIM (the `mlsend2._domainkey` CNAME/TXT exactly as shown), the
      return-path CNAME (e.g. `mta` → as shown), and `TXT _dmarc v=DMARC1; p=none; rua=mailto:khuram@appstackx.co.uk`.
   3. Wait for "Verified"; Domains → clindesk.co.uk → Advanced settings: switch **click, open and content tracking
      off** (as for clinforms.co.uk); check the API key's domain access includes clindesk.co.uk.
   4. Vercel Production: add `MAILERSEND_FROM_EMAIL_CLINIC=no-reply@clindesk.co.uk`, Redeploy. A malformed value makes
      only the clinic brand's sends "failed" (the link is then shown to the administrator); remove it to go back.
   The demo-request notification keeps `MAILERSEND_FROM_EMAIL` (it goes to Khuram).
6. **Smoke checks** (read-only, no sign-in):
   ```bash
   for p in / /features /reports /pricing /switching /security /demo /demo/thanks /privacy /terms /cookies /accessibility /robots.txt /sitemap.xml /login /reset-password; do
     printf '%s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' https://clindesk.co.uk$p)"; done          # all 200
   curl -sI https://clindesk.co.uk/ | grep -i x-robots-tag                                                  # nothing (indexable)
   curl -sI https://www.clindesk.co.uk/pricing | grep -iE '^HTTP|^location'                                 # 308 → https://clindesk.co.uk/pricing
   curl -sI https://clindesk.co.uk/request-access | grep -iE '^HTTP|^location'                              # 308 → /demo
   curl -s -o /dev/null -w '%{http_code}\n' https://clindesk.co.uk/clindesk-site/features                 # 404
   curl -sI https://clindesk.co.uk/app | grep -iE '^HTTP|^location|x-robots'                               # 307 → /login, noindex
   curl -s https://clindesk.co.uk/login | grep -o '<title>[^<]*'                                            # Sign in · ClinDesk
   curl -s https://clindesk.co.uk/sitemap.xml | grep -c '<loc>'                                             # 11
   # origin check: our origin accepted (401 = wrong password), a foreign one refused (403)
   curl -s -o /dev/null -w '%{http_code}\n' -X POST https://clindesk.co.uk/api/auth/sign-in/email -H 'content-type: application/json' -H 'origin: https://clindesk.co.uk' -H 'cookie: x=1' -d '{"email":"nobody@example.com","password":"not-the-password"}'   # 401
   curl -s -o /dev/null -w '%{http_code}\n' -X POST https://clindesk.co.uk/api/auth/sign-in/email -H 'content-type: application/json' -H 'origin: https://evil.example' -H 'cookie: x=1' -d '{"email":"nobody@example.com","password":"not-the-password"}'      # 403
   # ClinForms unchanged:
   curl -s https://clinforms.co.uk/ | grep -ci clindesk                                                     # 0
   curl -s https://clinforms.co.uk/login | grep -o '<title>[^<]*'                                           # Sign in · ClinForms
   curl -s -o /dev/null -w '%{http_code}\n' https://clinforms.co.uk/features                               # 404
   curl -s https://clinforms.co.uk/sitemap.xml | grep -c '<loc>'                                            # 7
   curl -sI https://clinforms.co.uk/reports | grep -i x-robots-tag                                          # noindex, nofollow
   ```
   Then (Khuram, test clinic with the clinic package only): send one "Book a demo" with fictional details and mark it
   contacted on `/app/platform`; sign in on clindesk.co.uk with your own account (lands on `/app/clinic` for a clinic
   with the package, else `/app`); from that clinic invite a fictional address you control → the email links to
   clindesk.co.uk; "Forgotten your password?" on clindesk.co.uk → the link goes to the clinic's brand host.
   Never on Blue Heart's clinic (ClinForms only – its links stay on clinforms.co.uk).
7. **Rollback:** remove `CLINFORMS_AUTH_ORIGINS` (and `MAILERSEND_FROM_EMAIL_CLINIC`) and redeploy → one static base URL
   again; sign-in on clindesk.co.uk is then refused by the origin check, so also point the site's "Sign in" links to
   `https://clinforms.co.uk/login` or remove the two Vercel domains. Sessions made on clindesk.co.uk simply stop being
   used. ClinForms is never affected.

## 6. Smoke tests (production, read-only, no sign-in) and feature-flag checks

6a. As DEPLOY.md (c) step 4:
```bash
curl -s https://clinforms.co.uk/api/reports/v1/health; echo
curl -s https://clinforms-data.appstackx-demos.workers.dev/v1/health; echo        # preview gateway only (prod no longer uses it)
for p in / /login /reset-password /reports /security /demo /privacy /api/reports/v1/health; do printf '%-28s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' "https://clinforms.co.uk$p")"; done   # all 200
curl -s -o /dev/null -w "/app %{http_code}\n" https://clinforms.co.uk/app                        # 307 → /login
curl -s -o /dev/null -w "/app/clinic %{http_code}\n" https://clinforms.co.uk/app/clinic          # 307 → /login
curl -s -o /dev/null -w "snapshot %{http_code}\n" https://clinforms.co.uk/api/reports/v1/store/snapshot   # 401
curl -s -o /dev/null -w "cron %{http_code}\n" https://clinforms.co.uk/api/clinic-messages/cron   # 401 (CRON_SECRET set, no bearer)
curl -s -o /dev/null -w "sms %{http_code}\n" -X POST https://clinforms.co.uk/api/clinic-messages/sms   # 404 (provider not test)
curl -s -o /dev/null -w "clinics %{http_code}\n" https://clinforms.co.uk/clinics/blue-heart-clinics/book   # 404 (no clinic package)
curl -s -o /dev/null -w "device %{http_code}\n" https://clinforms.co.uk/clinics/blue-heart-clinics/device  # 404
curl -sI https://clinforms.co.uk/clinics/x/book | grep -i -E 'x-robots-tag|permissions-policy'
vc logs --environment production --since 30m --level error --cwd "$MAIN"; vc logs --environment production --since 30m --status-code 5xx --cwd "$MAIN"
```
6b. Feature flag: confirm every production clinic is Reports ON and clinic OFF:
```bash
pgq "select tenant_id, package, status from public.clinic_entitlements where package = 'clinic' or status <> 'active'"   # expect 0 rows (Supabase, not D1)
```
6c. **[K]** Signed in as a Reports-only test clinic (`appstackx-test`, NOT Blue Heart): `/app` nav = Overview, Studio,
Clinic, Members, Security, … with **no "Clinic system"** item; `/app/studio` has no product-switch bar; `/app/clinic`
gives 404; the Activity filter has no clinic-system group; complete and approve one fictional form, and the download
matches the pre-K2 one.
6d. **Only with Khuram's separate go, and only for a demo or test clinic:** switch the clinic package on.
`npm run admin:set-entitlement -- --env production --slug <demo-slug> --package clinic --on --status trial --confirm --yes`,
or the platform page → "Packages switched on". Walk `/app/clinic` once, then switch it off again unless it is meant to
stay on. While walking it:
- **Patient portal sign-in links are hidden in Messages → Outbox** (M10 C1): the stored copy shows "[Sign-in link – only
  in the email sent to the patient]", and a failed sign-in email has no Retry. To test the portal, give a fictional
  patient an email address **you** can read (and a real email provider) – the link only exists in that email. With the
  outbox-only default nothing is sent at all, so the portal cannot be signed into on production until email is set up.
- Online booking for new patients cannot be switched on until step 4b is done.
- **Never** switch Reports off for a live clinic. On the platform page Reports off now needs the clinic id **typed**
  ("Type the clinic id … to switch Reports off for …", checked on the server too); the CLI
  (`admin:set-entitlement … --package reports --off`) has no typed-id step but needs `--confirm --yes` on production –
  do not use it for a live clinic.

## 7. Rollback plan

| Situation | Action | Data |
|---|---|---|
| App problem after step 5 | **[K]** Vercel one-step rollback / promote `$RUN/shim-deployment.txt`. The shim build ignores the new tables and reads native reports. | Nothing lost. The K2 tables stay (unused). |
| Problem after step 4b (Turnstile redeploy) | Promote the deployment before the redeploy (the K2 one), or remove the two variables and redeploy. Public booking is refused again (safe). | none |
| Problem after step 1 (shim) | Promote `$RUN/prod-before-shim.txt` (cae0c3f). Safe while no native report exists, which holds before step 5. | none |
| Migration failed half-way (step 4b) | Stop; do not push the app. The failed file was rolled back (one transaction per file); main's code is unaffected by the K2 tables already made. Fix forward with new numbers. | none |
| A clinic-system bug in an enabled demo clinic | Switch its clinic package off (`admin:set-entitlement … --off`, nothing is deleted). | kept |
| Remove K2 schema entirely (only if Khuram decides) | A reviewed DROP script for the 76 new tables (children first, plus the 5 `pms_*` trigger functions) and `delete from public.schema_migrations where version between '20261024000100' and '20261024000213'`, in the Supabase SQL editor in one transaction. Not prepared yet. | K2 data lost |
| Supabase data damaged | Database → Backups: PITR to a time before step 4b (S1), or the daily backup. **Last resort: whole-database restore, it also discards every ClinForms write since then (Blue Heart trial data).** | ClinForms writes since then lost |
| Supabase unavailable for a long time | ClinForms' own rollback (move plan): `CLINFORMS_DB=d1` + redeploy goes back to the FROZEN D1 – only valid while nothing new was written on Supabase, and K2 then has no tables there. Khuram's call. | writes since 29/10 22:45 not on D1 |

There is no down-migration in the repo. None is needed for the app rollback, because the change is additive.

## 8. What Khuram must approve or run himself

1. The shim merge + push to `main` (step 1) and its deployment as the rollback point.
2. The Supabase pre-checks S1–S5 and the production migration apply on **Supabase** (step 4), with a backup/PITR point noted.
3. The K2 merge + push to `main` (step 5).
4. The Turnstile widget, the two Production variables and the redeploy (step 4b) – when online booking for new patients
   is wanted.
5. The signed-in check on a test clinic (6c).
6. Any switch of the clinic package to ON for any clinic (6d), and **every** change to a live clinic's Reports package.
7. The decisions list in HANDOVER §21.5 (defaults are built; change any).
8. Any rollback that is more than a Vercel one-step rollback (time-travel restore, DROP script).
9. ClinDesk domain (step 5b): the fill-ins (incl. the legal pages' [to confirm] items), the Cloudflare DNS records, the
   Production variable `CLINFORMS_AUTH_ORIGINS=https://clindesk.co.uk` + redeploy (sign-in on both hosts is built:
   `feat/clindesk-auth`, merged at `00faac8`) and, if wanted, the MailerSend domain + `MAILERSEND_FROM_EMAIL_CLINIC`.

## Evidence on Postgres (30/10/2026, local Docker Postgres 17.11, en_US.UTF-8 – HANDOVER §22)

- Migrations in production order (main's 7, then K2's 52) and from scratch: identical schema, 103 tables, all RLS on.
- Every `pms-*` / `clinic-system-*` e2e script and `tenant-studio FLOW=complete` green on Postgres (production build and
  `next dev` with the test clock); repo suites on a real Postgres via `CLINFORMS_TEST_PG_URL`; real two-writer tests of
  the no-double-booking trigger; 50k-patient perf (pages ≤ 81 ms; year reports 0.6–1.0 s; send-due job 848 ms with 1,787
  statements – ~2–4 s on Supabase from lhr1).
- Two Postgres-only bugs fixed (audit area filter under en_US collation; dialect detection across module instances).

## Evidence (final check, 29/10/2026, local only – HANDOVER §21.2)

- Chain on `24bc57b` (`332b2b8` differs only in one e2e script): typecheck, lint, build green; test:pms 782/0,
  test:medreport 1786/0/3, test:db 1187/0/3, test:auth 139/0, test:site 155/0, test:gateway 646/0/2. Same chain on the
  starting head `1d861d9`: all green. No timing-test failure.
- E2E on `332b2b8`, fresh demo seed each: production build – clinic-system-access 13/13, clinic-system-shell 11/11,
  pms-billing-screens 21/21 (after the test-drift fix), pms-design-system 14/14, pms-integration 14/14, pms-m10-ux 8/8,
  pms-polish-portal 9/9, pms-portal-screens 15/15, pms-prototype-b 6/6, pms-records-screens 17/17, pms-setup-reports
  13/13, **pms-human-check 3/3** (Turnstile test keys), tenant-studio `FLOW=complete` 15/15; `next dev` with the test
  clock at Wed 28/10/2026 10:30 London – pms-diary-screens 32/32, pms-prototype-a 10/10, pms-messages-screens 18/18,
  pms-polish 9/9, pms-polish-reports 8/8, pms-setup-reports 13/13.
- Forms regression, `cae0c3f` vs the candidate: **All 5 files match** (2 PDFs byte-identical, 3 Word files equivalent).
- Migrations: 52 files, 76 tables, 149 indexes, 9 triggers; ALTER/DROP only on the clinic system's own `pms_*` tables.

Earlier evidence (M10 on `842bb02`): all K2 migrations applied cleanly with wrangler local D1 on top of main's 0001–0008
with two seeded `clinic_profile` rows (backfill wrote `reports/active` for both; nothing existing changed). Bundles:
ClinForms routes' first-load JS within ±0.3 kB; the global CSS loaded on every page grows from 13.6 to 19.2 kB gzip
because Tailwind scans the clinic-system components (not split – contract §13).
