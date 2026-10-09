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
| Email | Abstraction with providers `cloudflare` (Worker `send_email` binding through the gateway – needs Workers Paid $5/mo, not enabled yet), `log` (dev) and `none`. With `none`, invite/reset links are shown to the admin to copy |
| Analytics | PostHog **EU** cloud, consent-gated, proxied via `/ingest`; key `NEXT_PUBLIC_POSTHOG_KEY` (unset = disabled) |

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
  `sqlite_master` writes. Errors as `{error: {code, message}}` without echoing SQL params.
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
`member`, `invitation` – generated per dialect with its CLI and committed into the same migration files)**:
| Table | Columns (PK first) | Notes |
|---|---|---|
| `clinic_profile` | `tenant_id` (= organization slug), `organization_id`, `display_name`, `legal_name`, `address_json`, `postcode`, `phone`, `email`, `retention_days` (default 365), `drafting_enabled` (0/1), `created_at`, `updated_at` | Replaces `DEMO_CLINIC` in tenant mode |
| `member_profile` | (`organization_id`, `user_id`), `job_title`, `hcpc_number`, `can_sign` (0/1), `updated_at` | Signer identity on approvals |
| `forms` | (`tenant_id`, `id`), `rev`, `file_sha256`, `status`, `title`, `referrer`, `kind`, `sample_id`, `payload_enc`, `created_at`, `updated_at` | `payload_enc` = encrypted FormDefinition JSON |
| `form_files` | (`tenant_id`, `sha256`), `file_name`, `mime_type`, `size_bytes`, `chunk_count`, `created_at` | |
| `form_file_chunks` | (`tenant_id`, `sha256`, `idx`), `data_enc` | ≤ 512 KiB plaintext per chunk |
| `reports` | (`tenant_id`, `id`), `rev`, `status`, `form_id`, `template_id`, `payload_enc`, `created_at`, `updated_at`, `delete_after` | index (`tenant_id`, `updated_at`) |
| `tenant_settings` | `tenant_id`, `referrer_links_json`, `updated_at` | |
| `audit_log` | `id` (ULID), `tenant_id`, `user_id`, `session_id`, `action`, `target_type`, `target_id`, `detail_json`, `at` | **Append-only** (SQLite: `BEFORE UPDATE/DELETE` triggers `RAISE(ABORT)`; Postgres: revoke + trigger). Never PHI |
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
- **Better Auth** (`src/server/auth/auth.ts`), Kysely adapter on `getDb()` with the matching `type`.
  Email + password (min 12 chars, breached-password check off-line not required), **TOTP 2FA required** for every
  member before any patient data (enforced server-side: `TWO_FACTOR_REQUIRED` 403), organization plugin
  (organization = clinic; roles `owner`, `admin`, `clinician`, `staff`), invitations, password reset,
  `rateLimit.storage = "database"`, session cookie cache 5 min, secure cookies, cookie prefix `clinforms`.
  `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=https://clinforms.co.uk`.
- **Invite-only** [A]: clinics are created by the platform (`scripts/admin/create-clinic.ts` or a platform-admin
  page restricted to `CLINFORMS_PLATFORM_ADMINS` emails) after the DPA is signed; the owner gets an invite link.
  The landing page has "Request access" (stored in `access_requests`).
- **tenantId = organization slug** (`^[a-z0-9][a-z0-9-]*$`, immutable; `demo` reserved).
- Module seam: `MedreportDeps.authenticate?(req): Promise<AuthContext | null>` with
  `AuthContext = {userId, authSessionId, tenantId, role, clinician?: {name, hcpc?, jobTitle?}, twoFactorVerified}`
  and `MedreportDeps.clinicProfile?(tenantId): Promise<ClinicProfile | null>`; new `auth/actor.ts`
  `requireActor(req, deps, opts)`. Demo actor = tenant `demo` via the existing demo/launch session tokens, only when
  `CLINFORMS_PUBLIC_DEMO=1`.
- Every endpoint that touches patient data or drafting requires an actor; tenant checks on every
  report/form/bundle (`tenantId === actor.tenantId`); signer = the signed-in clinician (HCPC from
  `member_profile`), not the request body. Audit rows for sign, confirm, final render, file-back, live
  drafting/analysis, member/role changes, key creation/revocation, data export/deletion.
- Shared state (replay cache, live-call limits, passcode guesses) moves to `launch_token_uses` / `rate_limits`.
- CSRF: `route()` rejects state-changing requests whose `Origin` is not the app origin; JSON content type required.

## 4. Areas and routes
| Path | Who | Notes |
|---|---|---|
| `/` `(marketing)` | public | Landing page; `/privacy`, `/cookies`, `/terms`, `/security` (public trust page), `/request-access` |
| `/login`, `/two-factor`, `/accept-invite`, `/reset-password` `(auth)` | public | noindex |
| `/app/**` | signed-in member with 2FA | The Studio in tenant mode (server storage) + `/app/settings/{clinic,members,security,api-keys}` |
| `/reports/**`, `/pms-sandbox/**` | public demo | Unchanged demo-tenant Studio, browser storage, fictional data. On while `CLINFORMS_PUBLIC_DEMO=1` |
| `/api/auth/[...all]` | – | Better Auth |
| `/api/reports/v1/**` | demo or tenant actor | + `/store/**` endpoints (tenant only) |
| `/api/cron/retention` | Vercel cron (`CRON_SECRET`) | Deletes reports past `delete_after`, expired rate-limit/jti rows |

Edge middleware (Next 14.2) only does optimistic cookie redirects for `/app` and the auth pages; real checks are
in Node layouts and `route()`.

## 5. Storage swap in the Studio
`ui/store.ts` keeps every export and signature; implementation behind `StoreBackend` (`browser` = today's code,
`server` = fetch to `/api/reports/v1/store/**`), an in-memory per-tenant cache hydrated by the hooks, a per-record
coalescing write queue with `rev`/`If-Match` (409 → refetch), and async extras `flushStore`,
`saveReportDurable`, `saveFormDurable`, `useStoreSync`, used at the 6 must-persist call sites. The backend comes
from `HostHooks` (`/app` → server, `/reports` → browser). Server mode never persists patient data in
localStorage/IndexedDB.

## 6. Security headers
`next.config.mjs` `headers()`: HSTS (2 years, includeSubDomains), nosniff, Referrer-Policy
strict-origin-when-cross-origin, X-Frame-Options DENY, Permissions-Policy (camera/mic/geo/payment/usb off),
COOP same-origin, **CSP Report-Only** first (enforce after the review/mapping/preview screens run clean),
`X-Robots-Tag: noindex` on `/api`, `/app`, `/reports`, `/pms-sandbox`.

## 7. Env vars (names only; values in Vercel / `.env.local` / `~/.config/appstackx/clinforms.secrets.env`)
Existing `MEDREPORT_*`, `TM3_SIM_*`, `ANTHROPIC_API_KEY`, plus: `CLINFORMS_DB`, `CLINFORMS_D1_GATEWAY_URL`,
`CLINFORMS_D1_GATEWAY_SECRET`, `DATABASE_URL` (Postgres), `CLINFORMS_SQLITE_PATH`, `CLINFORMS_DATA_KEYS`,
`CLINFORMS_DATA_KEY_ID`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CLINFORMS_EMAIL_PROVIDER`,
`CLINFORMS_EMAIL_FROM`, `CLINFORMS_PLATFORM_ADMINS`, `CLINFORMS_PUBLIC_DEMO`, `CRON_SECRET`,
`NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` (default `/ingest`).
