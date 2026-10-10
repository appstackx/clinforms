# ClinForms – production architecture (contract for the build)

Status: **design contract, 2026-10-09**. Owner decisions in brackets [K] (Khuram) or [A] (assistant, accepted by K
saying "get this done as production ready"). Every agent building `feat/production` follows this file; changing a
contract here needs the orchestrator.

## 0. Ground rules (unchanged from CLAUDE.md)
- No "AI", "Claude", model or vendor names in anything customer-facing; neutral copy lives in
  `src/modules/medreport/core/wording.ts` (extend it, or add a sibling wording object that the
  neutral-wording test also scans).
- Fictional data only in demo areas. Never commit secrets or third-party insurer PDFs.
- Keep internal IDs (`appstackx-reports.*`, `medreport.` keys, `/api/reports/v1`, HMAC labels).
- TypeScript has no `target`: never spread/for-of a Set/Map/typed array – use `Array.from`.
- The module (`src/modules/medreport`) may not import `src/lib`, `src/server`, `src/app`, `src/sandbox`.
  Host code injects capabilities through `MedreportDeps` / `HostHooks` (additive optional members).
- `.eslintrc.json` is generated: edit `scripts/medreport/gen-eslint-boundary.mjs`, run
  `npm run medreport:eslint-boundary`.
- Pin exact dependency versions, each published at least 14 days before today (check
  `npm view <pkg> time --json`).

## 1. Hosting [K]
| Piece | Where |
|---|---|
| Next.js app | Vercel project `clinforms` (team khuram99gmailcoms-projects), region `lhr1`, domain **clinforms.co.uk** (www → 308 apex). Production = branch `main` |
| Database now | **Cloudflare D1**, account `appstackx-demos` (`a04ab546d0f1be2aa339bafebcdb3ffa`), jurisdiction **eu**: `clinforms-prod` (`c1a631fe-9cf0-414d-ab2f-28f7291282e3`), `clinforms-preview` (`3a548cc6-45d9-4dc5-b308-23a75534dcc9`) |
| Database later | **Supabase Postgres, London (eu-west-2)** once a real paying clinic signs [K]. Same schema, same code, switch by env |
| DB access from Vercel | Worker **`clinforms-data`** (and `clinforms-data-preview`) with a D1 binding – an authenticated SQL gateway. D1's REST API is admin-only (global API rate limit), so it is NOT used at runtime |
| Files | Stored **in the database**, AES-GCM encrypted, split into ≤ 512 KiB chunks (R2 is not enabled on the account; D1 rows ≤ 2 MB) |
| Email | Abstraction (`src/server/email/`) with providers **`mailersend`** [K, 09/10: same service as the owner's other apps; `MAILERSEND_API_KEY`, `MAILERSEND_FROM_EMAIL`], `log` (dev) and `none` (default until the key exists). With `none`, invite/reset links are shown to the admin to copy. *(Built: the `cloudflare` provider and the gateway's `/v1/email` were dropped – Cloudflare Email Sending needs a paid plan.)* |
| Analytics | PostHog **EU** cloud, consent-gated, proxied via `/ingest`; key `NEXT_PUBLIC_POSTHOG_KEY` (unset = disabled). No request batching (each event leaves when captured, so nothing queued before a withdrawal leaves after it). URLs keep only campaign-level UTM (`utm_source`/`utm_medium`/`utm_campaign`; `utm_content`/`utm_term` are dropped) – outreach links must never carry per-prospect values |

## 2. Data layer
**Query builder: Kysely** (dialect-agnostic). Host code in `src/server/db/` (server-only):
- `schema.ts` – the `Database` interface (one TS source for both dialects).
- `dialects/d1-http.ts` – Kysely `Dialect` = `SqliteAdapter` + `SqliteIntrospector` + `SqliteQueryCompiler` + a
  custom `Driver` that sends compiled `{sql, parameters}` to the gateway. D1 has **no interactive transactions**:
  the driver's `beginTransaction` throws a clear error; multi-statement atomic writes use
  `runBatch(db, queries)` (compiled queries sent as one `batch` → `env.DB.batch`, atomic).
- `dialects/postgres.ts` – `PostgresDialect` over `pg.Pool` (`DATABASE_URL`, SSL), type parsers so
  `timestamptz` → ISO string, `int8` → number, `jsonb`/`json` → raw string (code parses).
- `dialects/sqlite-local.ts` – a Kysely driver over Node 22's built-in `node:sqlite` `DatabaseSync` for local
  dev (`CLINFORMS_DB=sqlite`, `CLINFORMS_SQLITE_PATH=.data/clinforms.db`) and tests.
- `index.ts` – `getDb()` picks the dialect from `CLINFORMS_DB` = `d1` | `postgres` | `sqlite`
  (default: `sqlite` locally, required explicitly on Vercel). `runBatch()` works on all three (Postgres/SQLite:
  a real transaction).
- Portable column conventions: ids `TEXT`; timestamps ISO-8601 `TEXT` in SQLite / `timestamptz` in Postgres
  (parsed to ISO strings); booleans `INTEGER 0/1` in our own tables (Better Auth's tables use what its schema
  generator emits per dialect); JSON and ciphertext as `TEXT`.

**Gateway Worker** `workers/data-gateway/` (own `package.json`, `wrangler.jsonc`, TS, vitest or node:test):
- `POST /v1/query` body `{statements: [{sql: string, params: unknown[]}], mode: "single" | "batch"}` →
  `{results: [{rows: object[], changes: number, lastRowId: number | null}]}`; `batch` uses `env.DB.batch()`.
- `POST /v1/email` (only when the `EMAIL` send_email binding exists; else 501).
- `GET /v1/health` (no auth; returns `{ok: true}` only).
- Auth: headers `x-clinforms-ts` (unix ms) and `x-clinforms-sig` = hex HMAC-SHA256(`GATEWAY_SECRET`,
  `ts + "\n" + method + "\n" + path + "\n" + sha256hex(body)`), ±60 s window, constant-time compare.
  Reject: bodies > 8 MiB, > 100 statements, SQL containing `ATTACH`, `DETACH`, `PRAGMA`, `VACUUM`,
  `sqlite_master` writes. Errors as `{error: {code, message}}` without echoing SQL params. *Built (security review):*
  an allowlist on the first keyword (`SELECT`/`INSERT`/`UPDATE`/`DELETE`/`WITH`), no SQL comments, no `REPLACE`
  conflict resolution, internal-table checks on every statement with a write keyword (docs/database.md §4).
- Envs: default → `clinforms-prod` as `DB`, worker name `clinforms-data`; `preview` → `clinforms-preview`,
  name `clinforms-data-preview`. workers.dev URLs. Secret `GATEWAY_SECRET` per env.
- `migrations_dir` points at `../../db/migrations/sqlite` so `wrangler d1 migrations apply` works.

**Migrations (both, kept in step)**:
- SQLite/D1: `db/migrations/sqlite/0001_init.sql`, `0002_…` (wrangler format).
- Postgres/Supabase: `supabase/migrations/20261010000001_init.sql`, … (Supabase CLI format), with
  **RLS enabled on every table and no policies for `anon`/`authenticated`** (the Data API cannot read them; the
  app connects as the table owner through the pooler). Audit table: `REVOKE UPDATE, DELETE` + trigger raising.
- Parity test (`db/parity.test.ts`, run by `npm run test:db`): applies all SQLite migrations to `node:sqlite`
  and all Postgres migrations to **PGlite** (`@electric-sql/pglite`), then asserts the same tables and column
  names exist on both. The repository test suite runs against both SQLite and PGlite.

**Tables (our own; Better Auth adds `user`, `session`, `account`, `verification`, `twoFactor`, `organization`,
`member`, `invitation` and `rateLimit` – *built:* generated per dialect by Better Auth's own schema generator from the
app's configuration (`scripts/db/gen-auth-migrations.ts`, the code its CLI uses) into migration `0002_auth` of both
sets, made idempotent, RLS on in Postgres)**:
| Table | Columns (PK first) | Notes |
|---|---|---|
| `clinic_profile` | `tenant_id` (= organization slug), `organization_id`, `display_name`, `legal_name`, `address_json`, `postcode`, `phone`, `email`, `retention_days` (default 365), `drafting_enabled` (0/1), `created_at`, `updated_at` | Replaces `DEMO_CLINIC` in tenant mode |
| `member_profile` | (`organization_id`, `user_id`), `job_title`, `hcpc_number`, `can_sign` (0/1), `updated_at` | Signer identity on approvals |
| `forms` | (`tenant_id`, `id`), `rev`, `file_sha256`, `status`, `title`, `referrer`, `kind`, `sample_id`, `payload_enc`, `created_at`, `updated_at` | `payload_enc` = encrypted FormDefinition JSON |
| `form_files` | (`tenant_id`, `sha256`), `file_name`, `mime_type`, `size_bytes`, `chunk_count`, `created_at` | |
| `form_file_chunks` | (`tenant_id`, `sha256`, `idx`), `data_enc` | ≤ 512 KiB plaintext per chunk |
| `reports` | (`tenant_id`, `id`), `rev`, `status`, `form_id`, `template_id`, `payload_enc`, `created_at`, `updated_at`, `delete_after` | index (`tenant_id`, `updated_at`) |
| `tenant_settings` | `tenant_id`, `referrer_links_json`, `updated_at` | |
| `audit_log` | `id` (ULID), `tenant_id`, `user_id`, `session_id`, `action`, `target_type`, `target_id`, `detail_json`, `at` | **Append-only** (SQLite: `BEFORE UPDATE/DELETE` triggers `RAISE(ABORT)`, plus *built* `audit_log_no_replace` – migration 0003 – refusing an insert over an existing id, since REPLACE skips DELETE triggers; Postgres: revoke + trigger). Never PHI |
| `partner_keys` | `id`, `tenant_id`, `name`, `key_hash` (sha256), `last4`, `created_by`, `created_at`, `revoked_at` | Shown once on creation |
| `launch_token_uses` | `jti`, `expires_at` | Replaces the in-memory replay cache |
| `rate_limits` | (`key`, `window_start`), `count` | Atomic `INSERT … ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count` |
| `access_requests` | `id`, `clinic_name`, `contact_name`, `email`, `phone`, `message`, `created_at` | Landing-page "Request access" |

**Encryption at rest** (`src/server/crypto/`): AES-256-GCM via WebCrypto/`node:crypto`. Master keys from
`CLINFORMS_DATA_KEYS` = JSON `{"k1": "<base64 32 bytes>", …}` and `CLINFORMS_DATA_KEY_ID` = active kid. Per-tenant
subkey = HKDF-SHA256(master, salt = tenantId, info = `clinforms:data:v1`). Ciphertext string
`v1.<kid>.<iv b64url>.<ciphertext+tag b64url>`; AAD = `<tenantId>:<table>:<rowId>` so a ciphertext cannot be
moved to another row or tenant. Decrypt picks the key by kid (rotation = add a kid, switch the active one,
re-encrypt in the background).

## 3. Identity and tenancy
- **Better Auth** (`src/server/auth/auth.ts` → `create-auth.ts`; *built with 1.7.6*), Kysely adapter on `getDb()` with the
  matching `type` (`sqlite` for D1/SQLite, `postgres` for Postgres plus a Kysely plugin that hands Better Auth `Date`s
  for its timestamptz columns, because our Postgres dialect returns ISO strings). *Built:* `transaction: false` on
  **every** dialect (D1 has none; on SQLite/Postgres our hooks query through the shared instance and would deadlock a
  single connection inside a Better Auth transaction); Better Auth's start-up schema check is off on D1 only (D1 refuses
  `pragma_table_info` on its internal `_cf_KV` table, the gateway refuses `PRAGMA`; tests prove the migrations complete).
  Email + password (min 12 chars, breached-password check off-line not required), **TOTP 2FA required** for every
  member before any patient data (enforced server-side: `TWO_FACTOR_REQUIRED` 403), organization plugin
  (organization = clinic; roles `owner`, `admin`, `clinician`, `staff`), invitations, password reset,
  `rateLimit.storage = "database"`, session cookie cache 5 min, secure cookies, cookie prefix `clinforms`.
  `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=https://clinforms.co.uk`. *Built details:* invite-only is enforced by a
  database hook (no user row without an open invitation) and the HTTP sign-up path is switched off; two-step cannot be
  disabled and devices cannot be trusted; clinic-management endpoints refuse sessions without two-step
  (`TWO_FACTOR_REQUIRED`); turning two-step on revokes every older session; sessions 12 h; new sessions open the
  member's most recent clinic. **Previews leave `BETTER_AUTH_URL` unset:** the base URL comes from the request,
  restricted to the deployment's own Vercel hostnames (`VERCEL_URL`, `VERCEL_BRANCH_URL`). Runbook: `docs/auth.md`.
  *Built (security review):* invitation links carry `<invitation id>.<HMAC>` (key derived from `BETTER_AUTH_SECRET`),
  never the bare id; Better Auth's `list-invitations` and `get-full-organization` endpoints are off; `/app` and the
  module seam read the session past the cookie cache.
- **Invite-only** [A]: clinics are created by the platform (`scripts/admin/create-clinic.ts` or a platform-admin
  page restricted to `CLINFORMS_PLATFORM_ADMINS` emails) after the DPA is signed; the owner gets an invite link.
  *Built:* the scripts (`create-clinic`, `list-clinics`, `offboard-clinic`, `reset-two-factor`, `provision-auth`,
  `with-env`); *wave 2:* the platform page `/app/platform` (docs/auth.md §5). Platform invitations name a system user `clinforms-platform`
  (`platform@clinforms.invalid`, no password) as the inviter of record, because Better Auth requires one.
  The landing page has "Request access" (stored in `access_requests`).
- **tenantId = organization slug** (`^[a-z0-9][a-z0-9-]*$`, immutable; `demo` reserved). *Built:* 3–63 characters, no
  trailing/double hyphen, more reserved words (`app`, `api`, `admin`, `www`…); offboarded clinics keep their
  organization row as a tombstone so an id is never reused.
- Module seam: `MedreportDeps.authenticate?(req): Promise<AuthContext | null>` with
  `AuthContext = {userId, authSessionId, tenantId, role, clinician?: {name, hcpc?, jobTitle?}, twoFactorVerified}`
  and `MedreportDeps.clinicProfile?(tenantId): Promise<ClinicProfile | null>`. *Built (types + host builder
  `src/server/auth/medreport-actor.ts`, not wired into handlers):* `clinician` also carries `canSign: boolean`;
  `ClinicProfile = {tenantId, displayName, legalName?, addressLines, postcode?, phone?, email?, retentionDays,
  draftingEnabled}`. Wave 2: new `auth/actor.ts`
  `requireActor(req, deps, opts)`. Demo actor = tenant `demo` via the existing demo/launch session tokens, only when
  `CLINFORMS_PUBLIC_DEMO=1`. *Built (wave 2, integrated):* the demo is **on unless `CLINFORMS_PUBLIC_DEMO=0`**; the glue
  wires `authenticate` (Better Auth session read from the database, only when a sign-in cookie is present), and every
  Report API endpoint – the `/store/**` ones included (`store-actor.ts` on top of `requireActor`, demo sessions
  refused) – resolves its caller through `requireActor`. A demo session sent from the demo's own pages (`/reports`,
  `/pms-sandbox`, same-origin Referer) is the demo even when the browser also holds a clinic sign-in. A clinic's
  Studio never mints or sends a demo session. Detail: `src/modules/medreport/README.md` "Production wave 2".
- Every endpoint that touches patient data or drafting requires an actor; tenant checks on every
  report/form/bundle (`tenantId === actor.tenantId`); signer = the signed-in clinician (HCPC from
  `member_profile`), not the request body. Audit rows for sign, confirm, final render, file-back, live
  drafting/analysis, member/role changes, key creation/revocation, data export/deletion.
- Shared state (replay cache, live-call limits, passcode guesses) moves to `launch_token_uses` / `rate_limits`.
- CSRF: `route()` rejects state-changing requests whose `Origin` is not the app origin; JSON content type required.

## 4. Areas and routes
| Path | Who | Notes |
|---|---|---|
| `/` `(marketing)` | public | Landing page; `/demo` (product demo video, below), `/privacy`, `/cookies`, `/terms`, `/security` (public trust page), `/request-access` |
| `/demo` `(marketing)` | public | *Added 10/10:* the 1:30 product demo video (outreach video v1 without its burned-in captions; a WebVTT track instead), chapters with `?t=` deep links, a transcript with the material on-screen-only facts, VideoObject/Clip markup, its own share image; linked from the header and footer ("Demo video"; the sandbox at `/reports` is "Interactive demo" there since the 10/10 review), the hero and the landing page's final call to action ("Watch the demo", next to "Request access"); in the sitemap. Everything about the cut lives in `src/lib/site/demo-video.ts`. The MP4s are in Cloudflare R2, bucket `clinforms-media` (EU jurisdiction, appstackx-demos), served from `media.clinforms.co.uk` (CORS GET/HEAD from the apex and www only – so the video does NOT play on preview or local origins; `scripts/e2e/demo-video.cjs` `REAL_MEDIA=1` serves the page as the apex to check it). Each cut has its own dated folder (`demo/2026-10-10/`), never overwritten (immutable, a year's cache): a new cut = new folder + new `publishedOn`. Privacy promises, pinned by `src/lib/site/demo-video.test.ts` and the e2e script: `preload="none"` with a same-origin poster and captions (nothing reaches the media host until play), `crossOrigin="anonymous"` (no cookies), `?t=` sets the start without fetching; privacy policy §3 "The demo video", §5 and §6 (categories only). Analytics after consent: `demo_video_played` / `demo_video_completed` (`area` only). The old `/demo` → `/reports` redirect is gone. *Review fixes 10/10:* when the video ends it goes back to the end card (`endCardAt`, the cut fades to black) under a panel with "Book a 15-minute call" (→ `/request-access`), "Watch again" and the interactive demo; a request that hangs shows the fallback panel after 12 s (loading carries on; the panel goes if the video starts); the fallback's download link names its size and gives phones the 720p file; the page's main button is "Book a 15-minute call", as the video says; every app cookie must stay host-only (`src/server/auth/host-only-cookies.test.ts`; the test cookie jar refuses a `Domain`), because the download link is an ordinary request that would carry `.clinforms.co.uk` cookies. **Media host (zone `clinforms.co.uk`, Free plan): Network Error Logging is OFF since 10/10** (owner decision at go-live; `PATCH /zones/<zone id>/settings/nel` `{"value":{"enabled":false}}`, dashboard: clinforms.co.uk → Network → Network Error Logging), so responses carry no `nel` / `report-to` headers – check with `curl -sI https://media.clinforms.co.uk/demo/2026-10-10/clinforms-demo-720p.mp4 | grep -i -E "^(nel|report-to):"` (nothing). The privacy policy therefore no longer mentions error reports (pinned by `demo-video.test.ts`); switching NEL back on needs that disclosure back in §3 and §6 first |
| `/login`, `/two-factor`, `/accept-invite`, `/reset-password` `(auth)` | public | noindex. *Integrated:* no cookie banner here (task pages for invited members – a fixed banner covered the form; a choice made on the public site still applies); the public site's header and footer link to `/login` |
| `/app/**` | signed-in member with 2FA | The Studio in tenant mode (server storage) + `/app/settings/{clinic,members,security,api-keys}`. *Built:* overview + the four settings pages (route group `(clinic)`), `/app/select-clinic` (several clinics / none / open invitations). *Wave 2:* the tenant Studio at `/app/studio/**`
(`HostHooks` `basePath`/`mode: "tenant"`/`storage: "server"`; layout checks session, two-step and clinic on the server);
Settings → Clinic has the owner/admin switch for drafting from the notes (`clinic_profile.drafting_enabled`, off for a
new clinic – owner decision 10/10: a clinic opts in to sending notes to the drafting service once its DPA is signed;
the switch and the overview's set-up checklist say so in plain words, `src/lib/account-copy.ts` `DRAFTING_COPY`); a clinic's launch link opens `/app/studio/new`; `/app/settings/activity` (audit trail: owners/admins the whole clinic, clinicians/staff their own entries; CSV of the page, ids only) and `/app/platform` (emails in `CLINFORMS_PLATFORM_ADMINS` with two-step on, 404 for everyone else) |
| `/reports/**`, `/pms-sandbox/**` | public demo | Unchanged demo-tenant Studio, browser storage, fictional data. On while `CLINFORMS_PUBLIC_DEMO=1` (*built:* on unless `CLINFORMS_PUBLIC_DEMO=0`) |
| `/api/auth/[...all]` | – | Better Auth |
| `/api/reports/v1/**` | demo or tenant actor | + `/store/**` endpoints (tenant only). *Wave 3:* `/connectors/file-import/read` and `/confirm` – notes as the clinic system prints or exports them, checked by staff before the record is built (§8); per-minute limits per sign-in or session and per address (fix wave 3) |
| `/api/cron/retention` | Vercel cron (`CRON_SECRET`) | Deletes reports past `delete_after`, expired rate-limit/jti rows. *Built:* daily (vercel.json, 03:17 UTC); also deletes reports unchanged for their clinic's `retention_days` (read at run time) and access requests older than 24 months; *wave 2:* also form-file uploads started over a day ago and never completed; refuses every call while `CRON_SECRET` is unset |
| `/api/ops/key-fingerprint` | operator (`CRON_SECRET`) | *Added 10/10:* `{activeKid, keys: [{kid, fingerprint}]}` – first 16 hex of HMAC-SHA256(raw key, `clinforms:key-fingerprint:v1`) for each data key the deployment loads; never key bytes. Same auth helper as the retention cron (503 unset, 401 wrong). Compared with the secrets file by `npm run ops:key-fingerprint` (go-live.md §7.6, database.md §5) |

Edge middleware (Next 14.2) only does optimistic cookie redirects for `/app` and the auth pages; real checks are
in Node layouts and `route()`.

## 5. Storage swap in the Studio
`ui/store.ts` keeps every export and signature; implementation behind `StoreBackend` (`browser` = today's code,
`server` = fetch to `/api/reports/v1/store/**`), an in-memory per-tenant cache hydrated by the hooks, a per-record
coalescing write queue with `rev`/`If-Match` (409 → refetch), and async extras `flushStore`,
`saveReportDurable`, `saveFormDurable`, `useStoreSync`, used at the 6 must-persist call sites. The backend comes
from `HostHooks` (`/app` → server, `/reports` → browser). Server mode never persists patient data in
localStorage/IndexedDB.
*Built (wave 2 store slice; detail in `src/modules/medreport/README.md` "Clinic storage"):* `HostHooks.storage`,
`MedreportDeps.tenantStore` (host: `src/server/store/tenant-store.ts`, wired with `authenticate` in
`src/app/api/_medreport-tenant.ts`); endpoints `/store/snapshot`, `/store/reports/{id}`, `/store/forms/{id}`
(GET/PUT/DELETE, `ETag`/`If-Match` revisions, 409 `REV_CONFLICT` with the stored copy), chunked uploads
`/store/files` → `/store/files/{sha256}/chunks/{n}` → `/store/files/{sha256}/complete`, `GET /store/files/{sha256}`,
`/store/settings`. Uploads use the existing `form_files` + `form_file_chunks` tables (no migration): a file counts as
held once every chunk is present and reads verify size and SHA-256. Extras also include `getStoreSyncState`,
`retryStoreSync` and the referrer-link helpers; the 6 call sites plus portal question sets and case import use them.
`/render` and `/forms/fill-preview` prefer the clinic's stored form file (`fileBase64` optional for the preview).
*Fix wave 2 (security and end-to-end reviews):* the in-memory store is scoped to the page's clinic and member
(`HostHooks.member.userId`; a new scope empties it), every store request names that scope and the server refuses
another sign-in's (403 `TENANT_MISMATCH` / `SIGN_IN_CHANGED`); a body naming another clinic is refused, never
re-filed; sign-out / clinic switch / sign-in are full page loads; approved reports are deleted only by owner/admin,
confirmed maps un-confirmed or deleted only by confirming roles; store writes and new data per clinic are limited
(429); opening a report saves nothing; a clinic's Studio offers no case JSON download; a stored form file's
(plaintext) name is always neutral (`form.pdf` / `form.docx`). The clinic Studio's home is a work queue. Detail:
`src/modules/medreport/README.md` "Clinic storage" and "Two Studios".

## 6. Security headers
`next.config.mjs` `headers()`: HSTS (2 years, includeSubDomains), nosniff, Referrer-Policy
strict-origin-when-cross-origin, X-Frame-Options DENY, Permissions-Policy (camera/mic/geo/payment/usb off),
COOP same-origin, **CSP Report-Only** first (enforce after the review/mapping/preview screens run clean;
`media-src 'self' https://media.clinforms.co.uk` for the demo video since 10/10; the policy has no `report-to` /
`report-uri` yet, so real visitors' violations are not collected – add a same-origin report endpoint before relying
on Report-Only to decide when to enforce, and keep query strings out of what it logs: reset and invitation links
carry tokens),
`X-Robots-Tag: noindex` on `/api`, `/app`, `/reports`, `/pms-sandbox`.

## 7. Env vars (names only; values in Vercel / `.env.local` / `~/.config/appstackx/clinforms.secrets.env`)
Existing `MEDREPORT_*`, `TM3_SIM_*`, `ANTHROPIC_API_KEY`, plus: `CLINFORMS_DB`, `CLINFORMS_D1_GATEWAY_URL`,
`CLINFORMS_D1_GATEWAY_SECRET`, `DATABASE_URL` (Postgres), `CLINFORMS_SQLITE_PATH`, `CLINFORMS_DATA_KEYS`,
`CLINFORMS_DATA_KEY_ID`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CLINFORMS_EMAIL_PROVIDER`,
`MAILERSEND_API_KEY`, `MAILERSEND_FROM_EMAIL` (*built:* replace `CLINFORMS_EMAIL_FROM`, still read as a fallback),
`CLINFORMS_PLATFORM_ADMINS`, `CLINFORMS_PUBLIC_DEMO`, `CRON_SECRET`,
`NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` (default `/ingest`).

## 8. Notes import (wave 3, branch `prod/w3-notes`)
A clinic's notes come in as its own system prints them. `POST /api/reports/v1/connectors/file-import/read` tries our
documented import format first (JSON / CSV / text, or a PDF or Word document in that layout → the bundle at once);
anything else – a PDF's text layer (scans refused), a Word document, a CSV export, a text file or pasted text – is read
by the general notes reader into a **NotesReview**: registration details found with conservative patterns (unclear
values left blank, never guessed), one entry per dated block with its text exactly as written, clinicians from
headings or signatures, outcome scores, warnings. Staff check and correct it in the Studio (both Studios) and confirm;
`POST …/confirm` re-checks it and builds the bundle exactly as for any import. Nothing is stored or drafted before
confirming; audit `notes.imported` holds format and counts only. Detail: `src/modules/medreport/README.md`
"Production wave 3". **Not built:** assisted structuring ("Organise these notes" through the drafting service) – a
scoped follow-up described there; it needs drafting switched on for the clinic.

*Fix wave 3 (from the wave 3 security and end-to-end reviews):* the readers take linear time on any input (padded
lines no longer keep a server busy), and `/connectors/file-import/*` is limited per minute per sign-in or demo session
and per address (shared `rate_limits`; 429 `RATE_LIMITED`). The reader handles the exports clinics actually have
(practice-system PDF reports with running footers, booking CSVs with an "Appointment start" column, Word letters with
bulleted attendance and dated outcome tables); attendance is set per entry and counted only when complete; a missed or
cancelled appointment is an appointment with its reason; the clinic's own clinicians are offered; consent is asked for
in the review and, for uploaded notes, can be recorded on the report by the approver (kept in its activity). The
store's daily new-data allowance also counts the growth of updates. Detail: module README "Fix wave 3".

