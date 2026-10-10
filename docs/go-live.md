# ClinForms – go-live runbook (`feat/production` → clinforms.co.uk)

Status: **written 10/10/2026, not executed.** Nothing in this file has been run against production. The orchestrator
runs it after review, step by step, in order. Steps marked **[Khuram]** need the owner himself (his passwords, his
authenticator, his offline media) – an agent never types them.

Read first: [`production-architecture.md`](production-architecture.md) (contract), [`database.md`](database.md) (D1,
gateway, keys, backups), [`auth.md`](auth.md) (sign-in, clinics, admin scripts).

State when this was written (re-check on the day, §1):

| Thing | State on 10/10/2026 |
|---|---|
| `main` | `26cd447` – the RED-era demo build, live on clinforms.co.uk (`/` → 307 → `/reports`, no database, no sign-in) |
| Current production deployment | `https://clinforms-b8guhpqyz-khuram99gmailcoms-projects.vercel.app` (rollback target – record it again in §1) |
| `feat/production` | worktree `~/Projects/Appstackx/clinforms-wt/p-integrate`; merges into `main` without conflicts (`git merge-tree`) |
| D1 `clinforms-prod` | empty: no tables; migrations `0001`–`0005` all "to be applied" |
| Worker `clinforms-data` | not deployed (`/v1/health` → 404) |
| Vercel **production** env | only `ANTHROPIC_API_KEY`, `MEDREPORT_AI_MODE`, `MEDREPORT_LAUNCH_SECRET`, `MEDREPORT_LIVE_PASSCODE`, `MEDREPORT_PARTNER_KEY`, `MEDREPORT_SIGNING_SECRET`, `NEXT_PUBLIC_POSTHOG_KEY`, `TM3_SIM_TOKEN` |
| Secrets file | `~/.config/appstackx/clinforms.secrets.env` (chmod 600) has `PREVIEW_*` values and `PRODUCTION_MEDREPORT_*` / `PRODUCTION_TM3_SIM_TOKEN`, **no** `PRODUCTION_CLINFORMS_*`, `PRODUCTION_BETTER_AUTH_*` or `PRODUCTION_CRON_SECRET` – so §3/§4 generate fresh values |

Estimated time (estimate, not measured): pre-flight 45–60 min (mostly the preview E2E), §2–§4 20 min, §5 15–20 min,
§6 10 min, §7 30–45 min.

---

## 0. Conventions

**Never print a secret.** Values go from the secrets file (or a generator) straight into `wrangler secret put` /
`vercel env add` on stdin. To look at the secrets file, list **names only**:
`cut -d= -f1 ~/.config/appstackx/clinforms.secrets.env`. Never `cat` it, never `echo` a value, never paste one into
chat. Production Vercel values marked sensitive cannot be read back from Vercel – the secrets file and its offline copy
(§4.3) are the only readable copies.

**Never touch** the RED demo: worktree `~/Projects/Appstackx/clinforms-demo`, tag `red-demo-2026-10-13` (= `3521401`),
branch `demo/red-physio`. Nothing below runs there, and merging into `main` moves neither the tag nor that worktree.

**Preamble.** Every block below assumes these lines ran in the same shell. Shells that do not keep state between
commands (agent tools) must prepend them to every block. In an interactive **zsh**, first run
`setopt interactive_comments` on its own line – the blocks contain `#` comments.

```bash
REPO=~/Projects/Appstackx/clinforms-wt/p-integrate
MAIN=~/Projects/Appstackx/clinforms
RUN=~/clinforms-go-live
SECRETS=~/.config/appstackx/clinforms.secrets.env
export CLOUDFLARE_ACCOUNT_ID=a04ab546d0f1be2aa339bafebcdb3ffa
vc() { npx --yes vercel@63.1.0 "$@"; }
wr() { (cd "$REPO/workers/data-gateway" && CI=1 WRANGLER_SEND_METRICS=false ./node_modules/.bin/wrangler "$@"); }
mkdir -p "$RUN"
[ ! -f "$RUN/release.sha" ] || [ "$(git -C "$REPO" rev-parse HEAD)" = "$(cat "$RUN/release.sha")" ] || echo "WARNING: $REPO is not at the release commit"
```

- `$REPO` = `feat/production` (installed; scripts and the pinned wrangler 4.139.0 live here).
- `$MAIN` = the `main` checkout, linked to the Vercel project `clinforms` (team `khuram99gmailcoms-projects`).
  Run `vc curl` from inside `$MAIN` (it passes unknown flags such as `--cwd` on to curl); other `vc` commands take
  `--cwd "$MAIN"`.
- `$RUN` = a run folder outside every repository: release SHA, deployment URLs, smoke-test inputs (fictional).
  Preview invitation files written there are chmod 600 and deleted at the end of §1.

---

## 1. Pre-flight (go / no-go)

### 1.1 Go / no-go checklist

| # | Check | How |
|---|---|---|
| 1 | Khuram said go, and when | **Not** on Tuesday 13/10 before the RED call. The RED demo runs locally from the frozen worktree, not from clinforms.co.uk, but do not change the public site in the hours before the call. Suggested: after the call, or a quiet evening |
| 2 | `feat/production` clean, pushed, release SHA recorded | §1.4 a |
| 3 | Full check chain green on the release SHA | §1.4 a |
| 4 | Vercel preview of that SHA is Ready and answers | §1.4 b |
| 5 | Tenant end-to-end run on the **preview** database passed on that SHA; test clinics offboarded | §1.4 c (last full run: wave 2 integration `ec76a0a`; the tip adds the wave-2 fixes and wave 3) |
| 6 | `main` merges cleanly | §1.4 a (`git merge-tree`) |
| 7 | **[Khuram]** Production `ANTHROPIC_API_KEY` is a rotated key in a spend-limited workspace, and `MEDREPORT_LIVE_PASSCODE` is a fresh value (CLAUDE.md "Rotate every Anthropic key…") | Khuram confirms; if not, replace them with `vc env add … production --sensitive --force` on stdin before §5 |
| 8 | **[Khuram]** PostHog EU project **300254**: "Discard client IP data" on, data retention 12 months (as the privacy policy says) | PostHog → Project settings |
| 9 | Production env has none of `MEDREPORT_DEMO_ASSETS_DIR`, `MEDREPORT_DEMO_ASSETS_ALLOW_PROD`, `MEDREPORT_ALLOW_DEMO_SECRETS` | §1.4 d |
| 10 | Secrets file has no `PRODUCTION_CLINFORMS_*` / `PRODUCTION_BETTER_AUTH_*` yet (fresh values will be generated) | §1.4 d |
| 11 | Tools signed in: wrangler (account `appstackx-demos`), vercel; Node 22 | §1.4 d |
| 12 | Rollback target recorded | §1.4 d |

Any "no" → stop. Before §5 nothing public has changed: the live build does not read the database, the Worker or any of
the new variables, so stopping half-way through §2–§4 is harmless.

### 1.2 What changes on clinforms.co.uk

| Path / thing | Today (`main` `26cd447`) | After go-live |
|---|---|---|
| `/` | 307 → `/reports` | **200: the public marketing page** (header with Sign in, Request access, footer with legal links) |
| `/privacy`, `/cookies`, `/terms`, `/security`, `/request-access` | – | Public pages (legal pages are drafts – §8). Request access stores a row in D1 |
| Cookie banner | – | On public pages only ("Accept analytics" / "Reject" / manage); PostHog loads **only after** "Accept analytics", through `/ingest` |
| `/login`, `/two-factor`, `/accept-invite`, `/reset-password` | – | Sign-in pages (noindex, no cookie banner). **Invite-only**, two-step verification required |
| `/app/**` | – | The clinic area: overview, settings, activity, the clinic's own Studio `/app/studio` (server storage, encrypted in D1). `/app/platform` for `CLINFORMS_PLATFORM_ADMINS` only (404 for everyone else) |
| `/reports/**`, `/pms-sandbox/**` | Public demo (pre-production engine) | **Public demo stays** (`CLINFORMS_PUBLIC_DEMO=1`), browser storage, fictional data, now the production line's engine. No insurer PDFs (demo assets are never on a deployment) |
| `/api/reports/v1/health` | shows prompt versions | anonymous callers get `model: "drafting-service"`, empty `promptVersion`, plus `pdfFromWord: false` |
| New APIs | – | `/api/auth/*`, `/api/access-requests`, `/api/reports/v1/store/**`, `/api/reports/v1/connectors/file-import/{read,confirm}`, `/api/cron/retention` (daily 03:17 UTC, `vercel.json`) |
| Headers | – | HSTS 2 years **with includeSubDomains**, CSP **Report-Only**, `X-Frame-Options: DENY`, nosniff, COOP, Permissions-Policy; `X-Robots-Tag: noindex` on `/api`, `/app`, `/reports`, `/pms-sandbox`, sign-in pages; `robots.txt`, `sitemap.xml` |
| Data | none | D1 `clinforms-prod` (EU) via Worker `clinforms-data`; reports, forms and files AES-256-GCM encrypted per clinic |

Unchanged: the domain and `www` → apex redirect, Vercel project/region (`lhr1`), Hobby plan, the existing `MEDREPORT_*`
secrets, `NEXT_PUBLIC_POSTHOG_KEY`. HSTS includeSubDomains: make sure no subdomain of clinforms.co.uk is served over
plain http (none known).

### 1.3 The RED demo is unaffected

The RED call runs `npm run demo:red` from `~/Projects/Appstackx/clinforms-demo` (detached at tag
`red-demo-2026-10-13` = `3521401`, its own `node_modules`, `.next` and `.env.local`) on Khuram's Mac. The call pack
already says not to send Daniel clinforms.co.uk as the demo. This runbook changes `main`, `$MAIN`'s working files and
`node_modules` (§5), Cloudflare and Vercel – never that worktree, its tag or `demo/red-physio`. The gitignored
`clinforms/demo-assets/` folder the frozen demo reads is not touched by a merge or `npm ci`.

### 1.4 Pre-flight commands

**a) Release commit, check chain, merge test**

```bash
cd "$REPO"
git fetch origin
git status --porcelain                     # must print nothing
git rev-parse --abbrev-ref HEAD            # feat/production
git push origin feat/production            # orchestrator: only with Khuram's go-ahead (builds a Vercel PREVIEW only)
git rev-parse HEAD > "$RUN/release.sha"
[ "$(git rev-parse origin/feat/production)" = "$(cat "$RUN/release.sha")" ] && echo "release pushed: $(cat "$RUN/release.sha")"
# npm ci / (cd workers/data-gateway && npm ci) only if package-lock.json changed since the last install
npm run typecheck && npm run lint && npm run test:medreport && npm run test:db && npm run test:auth \
  && npm run test:site && npm run test:gateway && npm run build && echo "CHECK CHAIN GREEN"
git merge-tree --write-tree --name-only origin/main "$(cat "$RUN/release.sha")"; echo "merge-tree exit $?"
```

`merge-tree` must exit 0 and print one line (a tree id); conflicted file names mean the merge in §5 needs work first.

**b) Preview of the release commit**

```bash
cd "$MAIN"
PREVIEW=$(vc ls clinforms -m githubCommitSha="$(cat "$RUN/release.sha")" --limit 1 2>/dev/null); echo "$PREVIEW"
vc inspect "$PREVIEW" --wait --timeout 15m
for p in / /privacy /cookies /terms /security /request-access /login /reports /pms-sandbox /api/reports/v1/health; do
  printf '%-26s %s\n' "$p" "$(vc curl "$p" --deployment "$PREVIEW" -- -s -o /dev/null -w '%{http_code}' 2>/dev/null)"
done
printf '%-26s %s\n' "/api/reports/v1/store/snapshot" "$(vc curl /api/reports/v1/store/snapshot --deployment "$PREVIEW" -- -s -o /dev/null -w '%{http_code}' 2>/dev/null)"
```

Expected: every listed page 200; the store snapshot 401. (An empty `$PREVIEW` = the build is not created yet: run the
first line again a minute later.)

**c) Tenant end-to-end run on the PREVIEW database (never production)**

Terminal 1 – the release build locally against the preview D1, with live drafting (the key is read from `$MAIN/.env.local`
into the environment, never printed or put on a command line):

```bash
cd "$REPO" && ( export ANTHROPIC_API_KEY="$(grep '^ANTHROPIC_API_KEY=' "$MAIN/.env.local" | cut -d= -f2-)"; \
  npm run admin:with-env -- --env preview --port 3111 -- npx next start -p 3111 )
```

Terminal 2:

```bash
cd "$REPO"
N=$(date +%m%d%H%M); echo "$N" > "$RUN/e2e-run-id"
( umask 077
  npm run -s admin:create-clinic -- --env preview --app-url http://localhost:3111 \
    --name "Go-live Check A (fictional)" --slug "zz-w2-e2e-$N" --owner-email "zz-w2-owner-a-$N@example.com" > "$RUN/invite-a.txt"
  npm run -s admin:create-clinic -- --env preview --app-url http://localhost:3111 \
    --name "Go-live Check B (fictional)" --slug "zz-w2-e2e-b-$N" --owner-email "zz-w2-owner-b-$N@example.com" > "$RUN/invite-b.txt" )
RUN_ID=$N INVITE_A_FILE="$RUN/invite-a.txt" INVITE_B_FILE="$RUN/invite-b.txt" BASE=http://localhost:3111 \
  E2E_OUT="$REPO/.e2e-out/tenant-full-flow" NODE_PATH=/Users/khuram/Projects/Appstackx/pigeon-web/node_modules \
  node scripts/e2e/tenant-full-flow.cjs
RUN_ID=$N BASE=http://localhost:3111 E2E_OUT="$REPO/.e2e-out/tenant-full-flow" \
  NODE_PATH=/Users/khuram/Projects/Appstackx/pigeon-web/node_modules node scripts/e2e/tenant-fix-checks.cjs
```

Both must pass every step. Then offboard the two fictional clinics and remove the local files (the exports hold only
fictional data):

```bash
cd "$REPO"; N=$(cat "$RUN/e2e-run-id")
npm run admin:offboard-clinic -- --env preview --slug "zz-w2-e2e-$N" --confirm --export-dir "$RUN/export-a"
npm run admin:offboard-clinic -- --env preview --slug "zz-w2-e2e-b-$N" --confirm --export-dir "$RUN/export-b"
rm -rf "$RUN/export-a" "$RUN/export-b" "$RUN/invite-a.txt" "$RUN/invite-b.txt" "$REPO/.e2e-out/tenant-full-flow/state.json"
```

Stop the Terminal 1 server (Ctrl-C).

**d) Environment, tools, rollback target**

```bash
vc whoami
(cd "$REPO/workers/data-gateway" && npx wrangler whoami | grep -E "appstackx-demos|a04ab546d0f1be2aa339bafebcdb3ffa")
node --version                                                # v22.x
vc env ls production --cwd "$MAIN" 2>/dev/null | awk '$1 ~ /^[A-Z][A-Z0-9_]+$/ {print $1}' | sort
#   must NOT list MEDREPORT_DEMO_ASSETS_DIR, MEDREPORT_DEMO_ASSETS_ALLOW_PROD, MEDREPORT_ALLOW_DEMO_SECRETS
cut -d= -f1 "$SECRETS" | grep -E '^PRODUCTION_(CLINFORMS_|BETTER_AUTH_|CRON_)' || echo "no PRODUCTION data/auth values yet: fresh ones will be generated"
wr d1 migrations list clinforms-prod --remote                 # 0001–0005 "to be applied"
curl -s -o /dev/null -w "prod gateway health: %{http_code} (404 = not deployed yet)\n" https://clinforms-data.appstackx-demos.workers.dev/v1/health
vc ls clinforms --environment production --status READY --limit 1 --cwd "$MAIN" 2>/dev/null | tee "$RUN/previous-production.txt"
```

If `PRODUCTION_CLINFORMS_DATA_KEYS` already exists, **stop and ask**: the scripts keep an existing key (they never
regenerate one), so find out where it came from before any data is written with it.

---

## 2. Production database (D1 `clinforms-prod`)

Applies **all** SQLite migrations (`db/migrations/sqlite/0001_init.sql` … `0005_audit_log_user_index.sql`) with the
repo's migrate script, which runs the pinned wrangler in `workers/data-gateway`
(`wrangler d1 migrations apply clinforms-prod --remote`, default environment = production).

```bash
cd "$REPO"
CLINFORMS_DB=d1 npm run db:migrate -- --d1-env production --yes
wr d1 migrations list clinforms-prod --remote        # "No migrations to apply!"
wr d1 execute clinforms-prod --remote --json --command "SELECT type, count(*) AS n FROM sqlite_master WHERE type IN ('table','trigger') AND substr(name,1,4) <> '_cf_' AND name NOT IN ('d1_migrations','sqlite_sequence') GROUP BY type"
wr d1 execute clinforms-prod --remote --json --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

Expected: `table` **21**, `trigger` **3** (the same counts as `clinforms-preview` today). The 21 tables:
`access_requests account audit_log clinic_profile form_file_chunks form_files forms invitation launch_token_uses member
member_profile organization partner_keys rateLimit rate_limits reports session tenant_settings twoFactor user
verification`; the triggers: `audit_log_no_update`, `audit_log_no_delete`, `audit_log_no_replace`.

If the apply fails part-way (a transient Cloudflare error happened once on preview), run the same command again:
every file is idempotent and wrangler records each applied file in `d1_migrations`.

---

## 3. Production gateway Worker (`clinforms-data`)

### 3.1 Deploy

```bash
cd "$REPO/workers/data-gateway"
npx wrangler deploy                                  # default env: name clinforms-data, D1 binding DB = clinforms-prod
curl -s https://clinforms-data.appstackx-demos.workers.dev/v1/health; echo           # {"ok":true}
curl -s -o /dev/null -w "unsigned query: %{http_code}\n" -X POST -H 'content-type: application/json' -d '{}' \
  https://clinforms-data.appstackx-demos.workers.dev/v1/query                         # 503 = no GATEWAY_SECRET yet (closed)
```

Check the deploy output names `clinforms-data`, the binding `DB (clinforms-prod)` and the URL
`https://clinforms-data.appstackx-demos.workers.dev`.

### 3.2 Secrets: gateway secret and data keys (generated, never printed)

```bash
cd "$REPO"
npm run db:provision-gateway -- --env production --yes
```

What it does (`scripts/db/provision-gateway-secrets.ts`): generates `GATEWAY_SECRET` (48 random bytes, base64url) and
`CLINFORMS_DATA_KEYS` = `{"k1":"<base64 of 32 random bytes>"}` with `CLINFORMS_DATA_KEY_ID=k1` (only because none exist
yet), **saves them first** as `PRODUCTION_*` lines in the secrets file (chmod 600), then pipes on stdin:
`wrangler secret put GATEWAY_SECRET` (production Worker) and `vercel env add … production --force` for
`CLINFORMS_DB=d1`, `CLINFORMS_D1_GATEWAY_URL=https://clinforms-data.appstackx-demos.workers.dev`, and the sensitive
`CLINFORMS_D1_GATEWAY_SECRET`, `CLINFORMS_DATA_KEYS`, `CLINFORMS_DATA_KEY_ID`. Expected output: seven `ok  …` lines.
A failure part-way is safe to re-run (it keeps the saved values).

```bash
curl -s -o /dev/null -w "unsigned query: %{http_code}\n" -X POST -H 'content-type: application/json' -d '{}' \
  https://clinforms-data.appstackx-demos.workers.dev/v1/query                         # now 401 (secret set, signature missing)
(cd "$REPO/workers/data-gateway" && npx wrangler secret list)                         # [{"name":"GATEWAY_SECRET",…}] – names only
```

### 3.3 Self-test against production

```bash
cd "$REPO"
npm run db:selftest -- --env production             # … ALL CHECKS PASSED
npm run -s admin:list-clinics -- --env production    # No clinics.
```

Why the full (writing) self-test is right **now**: the database is empty and nothing uses it yet. It works only in
the self-test tenant `zz-selftest` (a valid id that is not a clinic, has no organisation and never shows in the
platform page), signs with the secrets-file copy of the gateway secret, encrypts and decrypts with the secrets-file data
key, and deletes everything it wrote except **one** append-only audit row (`selftest.run` under `zz-selftest`) – by
design, and harmless (`create-clinic` will never hand out that id because it has audit history). It proves health,
signed queries, the denylist, batch atomicity, a 2.4 MB encrypted file round-trip, the append-only audit triggers, the
rate-limit and launch-token tables, and refusal of bad signatures and old timestamps.

**Later re-checks (once real clinics exist) use the read-only check instead** – no rows, no audit entries:

```bash
curl -s https://clinforms-data.appstackx-demos.workers.dev/v1/health; echo                        # {"ok":true}
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H 'content-type: application/json' -d '{}' \
  https://clinforms-data.appstackx-demos.workers.dev/v1/query                                      # 401
cd "$REPO" && npm run -s admin:list-clinics -- --env production                                    # a signed SELECT
```

---

## 4. Vercel PRODUCTION environment

### 4.1 The variables

| Name | Value | How it is made / set | If lost |
|---|---|---|---|
| `CLINFORMS_DB` | `d1` | §3.2 (`db:provision-gateway`) | – |
| `CLINFORMS_D1_GATEWAY_URL` | `https://clinforms-data.appstackx-demos.workers.dev` | §3.2 | – |
| `CLINFORMS_D1_GATEWAY_SECRET` (sensitive) | = the Worker's `GATEWAY_SECRET`, 48 random bytes base64url | §3.2: generated, file first, then `wrangler secret put` + Vercel | rotate: `npm run db:provision-gateway -- --env production --yes --rotate-gateway-secret`, redeploy |
| `CLINFORMS_DATA_KEYS` (sensitive) | `{"k1":"<base64 32 bytes>"}` – **fresh** | §3.2: generated once, file first, then Vercel. **Backed up offline in §4.3** | **every report, form map and file becomes unreadable for good** |
| `CLINFORMS_DATA_KEY_ID` (sensitive) | `k1` | §3.2 | – |
| `BETTER_AUTH_SECRET` (sensitive) | 48 random bytes base64url – fresh | §4.2 `admin:provision-auth` (file first) | everyone signed out, two-step set up again, open invitations void |
| `BETTER_AUTH_URL` | `https://clinforms.co.uk` | §4.2 `admin:provision-auth` (production only) | – |
| `CLINFORMS_EMAIL_PROVIDER` | `none` | §4.2 `admin:provision-auth` (until a MailerSend key exists) | – |
| `CLINFORMS_PLATFORM_ADMINS` | `khuram@appstackx.co.uk` | §4.2 by hand | – |
| `CRON_SECRET` (sensitive) | 48 random bytes base64url (16+ chars required) | §4.2: generated into the secrets file, then piped | rotate any time (same commands) |
| `CLINFORMS_PUBLIC_DEMO` | `1` | §4.2 by hand (the demo is on unless exactly `0`; set explicitly for the record) | – |
| `ANTHROPIC_API_KEY`, `MEDREPORT_AI_MODE`, `MEDREPORT_LIVE_PASSCODE`, `MEDREPORT_LAUNCH_SECRET`, `MEDREPORT_SIGNING_SECRET`, `MEDREPORT_PARTNER_KEY`, `TM3_SIM_TOKEN`, `NEXT_PUBLIC_POSTHOG_KEY` | existing | already set – do not touch (rotating `MEDREPORT_SIGNING_SECRET` voids approval receipts and confirmed form maps) | – |

Not set on purpose: `NEXT_PUBLIC_POSTHOG_HOST` (default `/ingest`), `APP_ORIGIN` (defaults to `BETTER_AUTH_URL`),
`MAILERSEND_*` (email off), `DATABASE_*` (Supabase later), `CLINFORMS_SQLITE_PATH`, and never on a deployment:
`MEDREPORT_DEMO_ASSETS_DIR`, `MEDREPORT_DEMO_ASSETS_ALLOW_PROD`, `MEDREPORT_ALLOW_DEMO_SECRETS`.

`CLINFORMS_PLATFORM_ADMINS` before the account exists is deliberate and safe on a fresh database: no account exists for
that address, the bootstrap invitation in §6 is a **platform** invitation (allowed), and while the address is listed no
clinic can invite it (`PLATFORM_ADMIN_ADDRESS`) – the stricter order of docs/auth.md §5, and no extra redeploy.

### 4.2 Commands

```bash
cd "$REPO"
npm run admin:provision-auth -- --env production --yes
#   ok  generated and saved PRODUCTION_BETTER_AUTH_SECRET …; ok vercel env add BETTER_AUTH_SECRET / CLINFORMS_EMAIL_PROVIDER / BETTER_AUTH_URL

node --import tsx -e '
const { randomBytes } = require("node:crypto");
const { readSecretsFile, upsertSecrets } = require("./scripts/db/provision-gateway-secrets.ts");
const name = "PRODUCTION_CRON_SECRET";
if (readSecretsFile().get(name)) console.log("kept " + name);
else { upsertSecrets({ [name]: randomBytes(48).toString("base64url") }); console.log("generated and saved " + name); }'
grep '^PRODUCTION_CRON_SECRET=' "$SECRETS" | cut -d= -f2- | tr -d '\n' \
  | vc env add CRON_SECRET production --sensitive --force --yes --cwd "$MAIN"
printf '%s' 'khuram@appstackx.co.uk' | vc env add CLINFORMS_PLATFORM_ADMINS production --no-sensitive --force --yes --cwd "$MAIN"
printf '%s' '1' | vc env add CLINFORMS_PUBLIC_DEMO production --no-sensitive --force --yes --cwd "$MAIN"
```

Verify the names (exactly 19, nothing else):

```bash
vc env ls production --cwd "$MAIN" 2>/dev/null | awk '$1 ~ /^[A-Z][A-Z0-9_]+$/ {print $1}' | sort > "$RUN/prod-env-names.txt"
printf '%s\n' ANTHROPIC_API_KEY BETTER_AUTH_SECRET BETTER_AUTH_URL CLINFORMS_D1_GATEWAY_SECRET CLINFORMS_D1_GATEWAY_URL \
  CLINFORMS_DATA_KEYS CLINFORMS_DATA_KEY_ID CLINFORMS_DB CLINFORMS_EMAIL_PROVIDER CLINFORMS_PLATFORM_ADMINS \
  CLINFORMS_PUBLIC_DEMO CRON_SECRET MEDREPORT_AI_MODE MEDREPORT_LAUNCH_SECRET MEDREPORT_LIVE_PASSCODE \
  MEDREPORT_PARTNER_KEY MEDREPORT_SIGNING_SECRET NEXT_PUBLIC_POSTHOG_KEY TM3_SIM_TOKEN \
  | sort | diff - "$RUN/prod-env-names.txt" && echo "production env: the expected 19 names"
cut -d= -f1 "$SECRETS" | grep '^PRODUCTION_' | sort
#   PRODUCTION_BETTER_AUTH_SECRET/_URL, PRODUCTION_CLINFORMS_D1_GATEWAY_SECRET/_URL, PRODUCTION_CLINFORMS_DATA_KEYS/_KEY_ID,
#   PRODUCTION_CLINFORMS_DB, PRODUCTION_CLINFORMS_EMAIL_PROVIDER, PRODUCTION_CRON_SECRET, + the existing PRODUCTION_MEDREPORT_* / _TM3_SIM_TOKEN
```

### 4.3 [Khuram] Two copies of the secrets file – GATE before §5

The data key exists in exactly two readable places: Vercel (sensitive – cannot be read back) and
`~/.config/appstackx/clinforms.secrets.env`. Make **two more, offline** copies now, before any clinic data exists. Do
not start §5 until Khuram confirms both.

1. **Password manager** (secure note "ClinForms production data keys – <date>"): copy the two lines to the clipboard
   without showing them in the terminal, paste into the note, then clear the clipboard:
   ```bash
   grep -E '^PRODUCTION_CLINFORMS_DATA_KEY' "$SECRETS" | pbcopy      # DATA_KEYS and DATA_KEY_ID
   pbcopy < /dev/null
   ```
2. **Encrypted disk image on a USB stick kept away from the Mac** (hdiutil asks for a passphrase – store it in the
   password manager; replace `<USB>` with the stick's volume name):
   ```bash
   hdiutil create -size 20m -fs APFS -encryption AES-256 -volname ClinFormsKeys "/Volumes/<USB>/clinforms-keys.dmg"
   hdiutil attach "/Volumes/<USB>/clinforms-keys.dmg"
   cp -p "$SECRETS" /Volumes/ClinFormsKeys/clinforms.secrets.env
   cmp -s "$SECRETS" /Volumes/ClinFormsKeys/clinforms.secrets.env && echo "offline copy identical"
   hdiutil detach /Volumes/ClinFormsKeys
   ```

Repeat the USB copy whenever the file changes (key rotation, new secrets). §7.6 later proves the file's key really
decrypts what production wrote.

---

## 5. Merge into `main` and push (= the production deploy)

### 5.1 Merge, check, push

```bash
cd "$MAIN"
git status --porcelain                                   # must print nothing
git switch main && git fetch origin && git merge --ff-only origin/main
[ "$(git rev-parse origin/feat/production)" = "$(cat "$RUN/release.sha")" ] && echo "feat/production unchanged since pre-flight"
git merge --no-ff "$(cat "$RUN/release.sha")" \
  -m "Go live: the production line on clinforms.co.uk (public site, clinic sign-in, clinic Studio, database)" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
npm ci && (cd workers/data-gateway && npm ci)
npm run typecheck && npm run lint && npm run test:medreport && npm run test:db && npm run test:auth \
  && npm run test:site && npm run test:gateway && npm run build && echo "CHECK CHAIN GREEN ON THE MERGE"
git push origin main
```

If the merge stops on conflicts or the chain fails: `git merge --abort` (or, after a finished merge that was not
pushed, `git reset --hard origin/main`), fix on `feat/production`, start §5 again. Nothing public has changed until
`git push`.

### 5.2 Watch the build

```bash
cd "$MAIN"
SHA=$(git rev-parse HEAD)
PROD=$(vc ls clinforms --environment production -m githubCommitSha="$SHA" --limit 1 2>/dev/null); echo "$PROD" | tee "$RUN/production-deployment.txt"
#   empty = Vercel has not created it yet: run the line again in ~10 s
vc inspect "$PROD" --wait --timeout 15m
vc inspect "$PROD" --logs | tail -40
curl -s -o /dev/null -w "/ -> %{http_code}\n" https://clinforms.co.uk/                 # 200 (was 307 -> /reports)
curl -s https://clinforms.co.uk/api/reports/v1/health; echo
#   {"product":"ClinForms","version":"0.1.0","aiMode":"live","liveAiAvailable":true,"model":"drafting-service","promptVersion":"","pdfFromWord":false}
```

A failed build changes nothing: clinforms.co.uk keeps serving the previous deployment. Fix on `feat/production` and
merge again.

### 5.3 Rollback

```bash
cd "$MAIN"
vc rollback "$(cat "$RUN/previous-production.txt")" --yes
vc rollback status clinforms
curl -s -o /dev/null -w "/ -> %{http_code} %{redirect_url}\n" https://clinforms.co.uk/   # 307 -> /reports again
```

- Hobby allows a rollback to the **previous** production deployment only – which is the recorded one.
- After a rollback Vercel stops assigning the domain to new production deployments until one is promoted: when the fix
  is merged and built, `vc promote <new deployment URL> --yes --cwd "$MAIN"`. To make `main` match what is live in the
  meantime: `git revert -m 1 <merge sha>` on `main` and push.
- **The database side needs no rollback.** Migrations are additive and the old build does not read D1, the Worker or any
  of the new variables; they stay in place, unused, until the next attempt. Accounts and rows created meanwhile stay.

---

## 6. [Khuram] Bootstrap the platform administrator

The invitation link is a one-time credential: it goes to a chmod-600 file, never to the screen or chat, and Khuram
opens it himself. The name typed when creating the account is permanent (members cannot rename themselves – it is the
signer's name on approvals): **Khuram Masood**.

```bash
cd "$REPO"
( umask 077; npm run -s admin:create-clinic -- --env production --yes \
    --name "AppStackX (internal)" --slug appstackx --owner-email khuram@appstackx.co.uk --retention-days 30 \
    > ~/.config/appstackx/clinforms-appstackx-invite.txt )
grep -v accept-invite ~/.config/appstackx/clinforms-appstackx-invite.txt       # clinic id appstackx, email: not_sent (none)
open "$(grep -o 'https://clinforms.co.uk/accept-invite?token=[^[:space:]]*' ~/.config/appstackx/clinforms-appstackx-invite.txt)"
```

In the browser:
1. Create the account: name **Khuram Masood**, a new password (12–128 characters) saved in the password manager.
2. Two-step set-up (`/two-factor`): confirm the password → scan the QR code with the authenticator app → save the 10
   backup codes in the password manager, tick "I have saved them" → enter a code → `/app`.
3. Open **`https://clinforms.co.uk/app/platform`** (typed – there is no link). Expect the platform page: clinic
   `appstackx` (1 member, 1 owner, 0 open invitations), the recent platform actions, access requests. A 404 means the
   address is not in `CLINFORMS_PLATFORM_ADMINS` on this deployment or two-step is not on.

```bash
rm ~/.config/appstackx/clinforms-appstackx-invite.txt
cd "$REPO" && npm run -s admin:list-clinics -- --env production                  # appstackx  1  1  0  30 … active  AppStackX (internal)
```

`appstackx` is the internal clinic for smoke tests and support from now on – fictional data only, 30-day retention.

---

## 7. Smoke tests on clinforms.co.uk

### 7.1 Pages, redirects, headers (no sign-in)

```bash
for p in / /privacy /cookies /terms /security /request-access /login /reset-password /reports /reports/new /pms-sandbox /robots.txt /sitemap.xml /api/reports/v1/health; do
  printf '%-32s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' "https://clinforms.co.uk$p")"
done                                                                                  # all 200
curl -s -o /dev/null -w "/app           %{http_code} %{redirect_url}\n" https://clinforms.co.uk/app          # 307 -> /login?next=…
curl -s -o /dev/null -w "/app/platform  %{http_code} %{redirect_url}\n" https://clinforms.co.uk/app/platform # 307 -> /login?next=…
curl -s -o /dev/null -w "store snapshot %{http_code}\n" https://clinforms.co.uk/api/reports/v1/store/snapshot # 401
curl -s -o /dev/null -w "cron, no auth  %{http_code}\n" https://clinforms.co.uk/api/cron/retention           # 401 (503 = CRON_SECRET missing)
curl -s -o /dev/null -w "www            %{http_code} %{redirect_url}\n" https://www.clinforms.co.uk/          # 308 -> https://clinforms.co.uk/
curl -sI https://clinforms.co.uk/ | grep -iE '^(strict-transport-security|x-frame-options|content-security-policy-report-only|referrer-policy|permissions-policy):'
curl -sI https://clinforms.co.uk/reports | grep -i '^x-robots-tag'                    # noindex, nofollow
curl -sI https://clinforms.co.uk/ | grep -i '^x-robots-tag' || echo "landing page indexable (correct)"
```

Open `/`, `/privacy`, `/cookies`, `/terms`, `/security` in a browser at desktop width and at 375 px: header, footer,
legal links, no "AI" / vendor names, no company number or ICO line (hidden until set – §8).

### 7.2 Request access stores a row

Browser → `https://clinforms.co.uk/request-access`, fictional values only: clinic **Go-live Check Physio (fictional)**,
name **Test Person (fictional)**, email **go-live-check@example.com**, phone **07700 900123**, 1 site, message
"Go-live check – please ignore." → success message. Then (signed in, §6) `/app/platform` → Access requests shows it →
"Mark as contacted" → undo works. In the logs: `access_request.stored` (§7.8). Remove the test row afterwards (optional):

```bash
wr d1 execute clinforms-prod --remote --command "DELETE FROM access_requests WHERE email = 'go-live-check@example.com'"
```

### 7.3 [Khuram] Consent banner; PostHog only after consent

In a fresh Chrome profile or a private window with DevTools → Network, filter `ingest`:
1. Open `https://clinforms.co.uk/` → the "Cookie choices" banner (Accept analytics / Reject / manage). **No** `/ingest`
   request yet.
2. **Reject** → still no `/ingest` request; Application → Cookies: `clinforms_consent` = `v1.a0.<date>`; reload → no banner.
3. Clear site data, reload, **Accept analytics** → `/ingest/…` requests start; cookie `v1.a1.<date>`. PostHog EU project
   300254 → Activity shows the `$pageview` from clinforms.co.uk within a minute or two.
4. `/reports`, `/login` and `/app` get no pageviews; the cookie settings link in the footer reopens the choice.
5. With Global Privacy Control / Do Not Track on, the choice counts as a refusal.

### 7.4 Public demo – the Megan Hart flow (signed out, then signed in)

Do **not** type the live passcode (prepared drafts only, no spend). `https://clinforms.co.uk/pms-sandbox` → Megan Hart
(`sim-pat-001`) → **Complete referrer's report form** → the new tab shows "Imported from Simulated TM3" → **Choose the
referrer form** → Harrow & Pike → **Complete this form** → prepared draft → Flags tab: resolve the flags, add a paragraph
in your own words → Preview (DRAFT) → **Approve** → dialog prefilled Sarah Reid / PH-DEMO-01 → **Approve and sign** →
**Completed form (Word)** downloads (in the public demo, **Completed form (PDF)** answers that a PDF copy of a Word form
is not available yet – a 503 in the network log is expected; a clinic's Studio says so up front – §8) → **Save to
clinic record** → "Filed to the Simulated TM3 record". The label "Simulated TM3 sandbox – demo data, not affiliated with
TM3" is visible. Repeat the start of the flow in the browser signed in to `appstackx`: the demo still works there.

### 7.5 [Khuram] The clinic Studio end to end (internal clinic, fictional patient)

Inputs (fictional – a bundled demonstration form and the generated "Priya Nair" notes printout):

```bash
mkdir -p "$RUN/smoke"
curl -fsS -o "$RUN/smoke/northfield-rehab-progress.pdf" https://clinforms.co.uk/api/reports/v1/forms/samples/northfield-rehab-progress/file
cd "$REPO" && OUT="$RUN/smoke" node -e 'const fs=require("fs");const s=fs.readFileSync("src/modules/medreport/connectors/file-import/samples/generated/priya-nair-notes.pdf.b64.ts","utf8");const m=s.match(/"([A-Za-z0-9+\/=]{1000,})"/);fs.writeFileSync(process.env.OUT+"/priya-nair-notes-fictional.pdf",Buffer.from(m[1],"base64"))'
ls -l "$RUN/smoke"
```

Signed in as Khuram (owner of `appstackx`):
1. `/app` → the set-up checklist. **Settings → Clinic**: switch on **"Draft answers from the notes"** (fictional notes
   only ever go into this clinic) → save.
2. **Settings → Members** → your row → signing details: job title **Internal test account (not a clinician)**, HCPC
   number **ZZ0001** (valid format, not a real HCPC profession prefix), tick **may sign** → save. Do this before step 4:
   a report is drafted in the voice of the member who will sign it.
3. **Open the Studio** → Forms → upload `northfield-rehab-progress.pdf` → the questions are read → name the referrer →
   confirm the mapping.
4. `/app/studio/new` → upload `priya-nair-notes-fictional.pdf` → check the notes review (registration details, dated
   entries, clinicians, consent "Needed for approval") → confirm → pick the Northfield form → answers are drafted.
5. Review: answer the required questions, resolve the gaps, record consent (uploaded notes) → **Approve** (name and HCPC
   read-only: Khuram Masood / ZZ0001) → download the completed **PDF** (a fillable PDF needs no converter) → open it and
   check the answers sit in the form's boxes.
6. Reload `/app/studio`: the report is in the work queue as Approved (from the server). DevTools → Application: no report
   or form data in Local Storage / IndexedDB for clinforms.co.uk.
7. **Settings → Activity**: "Clinic account opened", "Invitation accepted", "Two-step verification set up", "Clinic
   details updated", "Signing details updated", "Form added to the library", "Form questions read from the file", "Form
   mapping confirmed", "Patient notes imported", "Report started", "Answers drafted from the notes", "Report approved",
   "Final document produced". **Download these entries (CSV)** works (ids only).
8. Afterwards: switch drafting off again unless more tests follow (it spends on the production key); the report goes by
   itself after 30 days (or delete it now – owners may delete approved reports).

### 7.6 The offline key really decrypts production data

After §7.5 (a report exists). Uses the **secrets-file** key against production through the gateway, reads the newest
report, prints only OK / FAIL:

```bash
cd "$REPO"
npm run -s admin:with-env -- --env production -- node --disable-warning=ExperimentalWarning --import ./scripts/medreport/test-setup.mjs --import tsx -e '
const { getDb, closeDb } = require("./src/server/db");
const { getDataCipher } = require("./src/server/crypto");
const { getReport } = require("./src/server/repos/reports");
(async () => {
  const ctx = { db: getDb(), cipher: getDataCipher() };
  const row = await ctx.db.selectFrom("reports").select(["tenant_id", "id"]).orderBy("updated_at", "desc").limit(1).executeTakeFirst();
  if (!row) console.log("No report stored yet – run this after the Studio smoke test.");
  else console.log((await getReport(ctx, row.tenant_id, row.id)) ? "OK: the key in the secrets file decrypts the newest report" : "FAIL: report not found");
})().catch((e) => { console.log("FAIL:", e && (e.code || e.name)); process.exitCode = 1; }).finally(() => closeDb());'
```

`FAIL: DECRYPT_FAILED` = the file and Vercel hold different keys: **stop**, do not onboard anyone, investigate (the
offline copies are copies of the file). Tested on local SQLite (same key → OK, other key → `DECRYPT_FAILED`) and against
preview (empty table → the "No report" line).

### 7.7 The retention cron

```bash
curl -s -o /dev/null -w "no auth: %{http_code}\n" https://clinforms.co.uk/api/cron/retention               # 401
curl -s -H @<(printf 'Authorization: Bearer %s\n' "$(grep '^PRODUCTION_CRON_SECRET=' "$SECRETS" | cut -d= -f2-)") \
  https://clinforms.co.uk/api/cron/retention; echo                                                          # {"ok":true,"deleted":{…counts…}}
```

The header is built from the secrets file inside a process substitution: the secret is never on the command line or
the screen. Vercel → project → Settings → Cron Jobs lists `/api/cron/retention`, `17 3 * * *`. Next morning:
`cron.retention.done` in the logs (Hobby runs it at some point in the 03:00 UTC hour). Once the first scheduled run is
confirmed, the security/privacy pages' "automatic deletion is planned" wording can be updated (§8).

### 7.8 What to watch on the first day

```bash
vc logs --environment production --since 1h --level error --cwd "$MAIN"
vc logs --environment production --since 1h --status-code 5xx --cwd "$MAIN"
vc logs --environment production --follow --cwd "$MAIN"                       # live, Ctrl-C to stop
(cd "$REPO/workers/data-gateway" && npx wrangler tail clinforms-data --format pretty)
wr d1 info clinforms-prod                                                      # size (500 MB cap on Workers Free)
```

| Where | Look for | Meaning |
|---|---|---|
| Vercel | any 5xx; `NOT_CONFIGURED`, `UNAVAILABLE` (database) | env or gateway problem – check §4 names, the gateway health, `wrangler tail` |
| Vercel | `audit.write_failed`, `auth.action_error`, `platform.create_clinic_failed`, `access_request.failed` / `.unavailable` | a write path failing – investigate the same day |
| Vercel | `cron.retention.done` (next morning), `cron.retention.failed` / `.refused` | retention ran / failed; `refused` with `unauthorized` = someone probing the endpoint (fine) |
| Vercel | `auth.sign_up_refused`, 429 `RATE_LIMITED` bursts | sign-up attempts without an invitation / limits doing their job; watch for volume |
| Vercel | `config.model_rejected` | `MEDREPORT_MODEL` set to something outside the allow-list |
| Cloudflare `clinforms-data` | `query_error`, `unhandled`; Observability → errors, CPU time near 10 ms, requests per day (Free: 100 000) | gateway health and Free-plan headroom |
| Cloudflare D1 | database size, rows written | Free-plan caps (§8) |
| PostHog 300254 | events only after consent; no events from `/app` without consent | consent gate working |
| `/app/platform` | access requests | email is off: nobody is notified – look daily |

### After go-live (housekeeping)

- Update `CLAUDE.md` (status snapshot: `main` = the merge, live on clinforms.co.uk), `memory/next-steps.md`,
  `memory/decisions.md`, `memory/history.md`; fill in the run log below.
- Optional: tag the release – `git -C "$MAIN" tag -a go-live-$(date +%F) -m "ClinForms production go-live" && git -C "$MAIN" push origin go-live-$(date +%F)`.

---

## 8. Known limits at go-live

| Limit | Consequence | Next step |
|---|---|---|
| **No Word → PDF converter** on Vercel (LibreOffice absent) | A Word form comes back as Word only; the Studio says so up front (`pdfFromWord: false`). Fillable/flat PDF forms produce PDFs | A converter service before clinics that need PDF copies of Word forms |
| **No real TM3 (or other practice-system) connector** | Clinics upload their notes (PDF, Word, CSV, text, pasted) and staff check them before the record is built. Partner API keys can be created but nothing uses them; a launch from a clinic system ends in 503 `CONNECTOR_NOT_CONFIGURED` | Connector work when a clinic's system and terms are known |
| **Email off** (`CLINFORMS_EMAIL_PROVIDER=none`) | Invitation and reset links are shown to the owner/administrator (or printed by the admin script) and passed on by hand; access requests send no notification | MailerSend key + verified sender → `mailersend` |
| **Vercel Hobby = non-commercial use only** | Fine for the internal clinic and pilots without payment; also: rollback only to the previous deployment, cron timing within the hour | **Move to Pro before a paying clinic** |
| **Cloudflare Workers Free** (if still on it) | 10 ms CPU per gateway request, 100 000 requests per day, D1 500 MB per database, Time Travel 7 days. One clinic may add up to 250 MB of new data a day under the app's own limits | Workers Paid ($5/month: 10 GB, 30-day Time Travel) before real patient data; check `wrangler d1 info` daily |
| **Supabase later** | D1 now, by owner decision; switch runbook in database.md §8 (no maintenance mode yet – freeze by hand) | When a paying clinic signs |
| **Backups** | D1 Time Travel only, plus manual `wrangler d1 export` (database.md §7); no scheduled off-site export | Weekly export to encrypted storage once real data exists |
| **Legal pages are drafts** (privacy, cookies, terms, security; "last updated" 9 October 2026) | Owner review needed; the security/privacy pages still call automatic deletion "planned" (true until `CRON_SECRET` runs in production) | Khuram (ideally with legal advice) reviews; update the deletion wording after §7.7 |
| **Company number, registered office and ICO registration missing** | `src/lib/site.ts` `COMPANY` leaves them unset, so the footer and legal pages omit those lines | Fill them in once confirmed; ICO data-protection fee registration before processing real patient data |
| **No real patient data yet** | CLAUDE.md hard rule: only after DPA + DPIA + safeguards. A clinic is created only after its DPA is signed; drafting from notes is off for every new clinic until its owner switches it on | DPA/DPIA templates, first pilot |
| Other known limits | CSP is Report-Only; HCPC numbers are format-checked only; Better Auth's multi-step sign-up is not atomic (a half-created account blocks that invitation – delete the `user` row by hand, auth.md §8); offboarding and two-step resets are script-only; assisted structuring of notes ("Organise these notes") is not built | See the module README and auth.md §8 |

---

## Run log (fill in on the day)

| Item | Value |
|---|---|
| Date / operator | |
| Khuram's go-ahead (time) | |
| Release SHA (`$RUN/release.sha`) | |
| Previous production deployment (`$RUN/previous-production.txt`) | |
| Preview E2E run id / result | |
| §2 migrations applied (21 tables / 3 triggers) | |
| §3 self-test result | |
| §4.3 offline copies confirmed by Khuram | |
| Merge commit on `main` | |
| Production deployment URL (`$RUN/production-deployment.txt`) | |
| §6 platform page OK | |
| §7 smoke tests (7.1–7.7) | |
| Issues seen / follow-ups | |
