# ClinForms – database, data gateway and encryption at rest

Status: built on `prod/data` (09/10/2026). Contract: [`production-architecture.md`](production-architecture.md) §2.
Code: `src/server/db/`, `src/server/crypto/`, `src/server/repos/`, `workers/data-gateway/`, `db/`, `supabase/`,
`scripts/db/`.

## 1. Architecture

```
Next.js on Vercel (lhr1)                         Cloudflare (account appstackx-demos, D1 jurisdiction eu)
┌───────────────────────────────┐   HTTPS POST   ┌──────────────────────────────┐   binding DB   ┌───────────────┐
│ src/server/repos/*            │  /v1/query     │ Worker clinforms-data        │ ─────────────▶ │ D1             │
│   ↓ Kysely<Database>          │ ─────────────▶ │  (workers/data-gateway)      │                │ clinforms-prod │
│ src/server/db getDb()         │  HMAC-signed   │  HMAC ±60 s, limits, denylist│                └───────────────┘
│   CLINFORMS_DB=d1 → D1 dialect│                └──────────────────────────────┘
│   CLINFORMS_DB=postgres → pg  │ ─────────────────────────────────────────────▶ Supabase Postgres (eu-west-2), later
│   CLINFORMS_DB=sqlite → local │ ──▶ .data/clinforms.db (node:sqlite, development only)
└───────────────────────────────┘
```

- **One schema, one code path.** `src/server/db/schema.ts` is the Kysely `Database` interface; the repositories
  are written once and run unchanged on D1, Postgres and SQLite (the same test suite runs on all of them).
- **D1 is reached through our own Worker**, not D1's REST API (that one is admin-only and rate-limited). The
  Worker is a thin, authenticated SQL gateway; all logic stays in the app.
- **No interactive transactions on D1.** `db.transaction()` throws `TRANSACTIONS_UNSUPPORTED` there. Writes that
  must succeed or fail together use `runBatch(db, queries)` (one `batch` request → `env.DB.batch()`, atomic; a real
  transaction on Postgres and SQLite). Put conditions in SQL (`WHERE rev = ?`, `ON CONFLICT …`), not in reads
  between statements.
- **Files live in the database** (`form_files` + `form_file_chunks`): ≤ 512 KiB plaintext per chunk, each
  chunk encrypted. R2 is not enabled on the account and D1 rows hold at most 2 MB. *Fix wave 2:* `form_files.file_name`
  is not encrypted, so it always holds a neutral name (`form.pdf` / `form.docx`, `store-contract.ts`
  `storedFormFileName`) whatever the upload sends – an insurer's file is often named after the patient or the claim;
  the real name is inside the encrypted form map (`forms.payload_enc`). `forms.title` / `forms.referrer` stay plaintext
  (the form's own title and the referrer's name, not patient data). Rows stored before this change keep their name.

## 2. Environment variables (names only – values in Vercel, `.env.local`, `~/.config/appstackx/*.env`)

| Variable | Used when | Meaning |
|---|---|---|
| `CLINFORMS_DB` | always | `d1`, `postgres` or `sqlite`. Default `sqlite` locally; **required on Vercel** (sqlite refused there) |
| `CLINFORMS_SQLITE_PATH` | sqlite | Default `.data/clinforms.db` (gitignored). Created and migrated on first use |
| `CLINFORMS_D1_GATEWAY_URL` | d1 | `https://clinforms-data.appstackx-demos.workers.dev` (preview: `clinforms-data-preview…`). https only |
| `CLINFORMS_D1_GATEWAY_SECRET` | d1 | Same value as the Worker's `GATEWAY_SECRET` (≥ 32 chars) |
| `DATABASE_URL` | postgres | App: Supabase **transaction** pooler (port 6543). Migrations/copy: **session** pooler (5432) |
| `DATABASE_SSL` | postgres | `verify-full` (default when `DATABASE_CA_CERT` is set), `require` (default otherwise), `disable` (local) |
| `DATABASE_CA_CERT` | postgres | PEM of Supabase's CA (Dashboard → Database → SSL) for `verify-full` |
| `DATABASE_POOL_MAX` | postgres | Pool size per instance (default 3) |
| `CLINFORMS_DATA_KEYS` | always | JSON `{"k1": "<base64 32 bytes>", …}` – every key that may still decrypt data |
| `CLINFORMS_DATA_KEY_ID` | always | The active kid for new ciphertext (`k1`) |

Preview values are set in Vercel (`preview`) and saved as `PREVIEW_*` lines in
`~/.config/appstackx/clinforms.secrets.env` (chmod 600). Production values are set by the orchestrator after
review (`PRODUCTION_*`).

Local development: `CLINFORMS_DB` can stay unset (sqlite). Create a local data key once (never reuse it
anywhere else):

```bash
echo "CLINFORMS_DATA_KEYS={\"dev\":\"$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64"))')\"}" >> .env.local
echo "CLINFORMS_DATA_KEY_ID=dev" >> .env.local
```

## 3. Migrations

Two sets, kept in step (same tables, same column names – `npm run test:db` fails otherwise):

| Set | Folder | Format | Applied by |
|---|---|---|---|
| SQLite / D1 | `db/migrations/sqlite/NNNN_name.sql` | wrangler | local: in-process (`_migrations` table); D1: `wrangler d1 migrations apply` (`d1_migrations`) |
| Postgres / Supabase | `supabase/migrations/YYYYMMDDHHMMSS_name.sql` | Supabase CLI | `scripts/db/migrate.ts` via pg (`public.schema_migrations`, one transaction per file, advisory lock) |

```bash
npm run db:migrate                                              # local SQLite (CLINFORMS_SQLITE_PATH)
CLINFORMS_DB=d1 npm run db:migrate -- --d1-env preview          # D1 clinforms-preview (remote)
CLINFORMS_DB=d1 npm run db:migrate -- --d1-env production --yes # D1 clinforms-prod (orchestrator only)
CLINFORMS_DB=postgres DATABASE_URL=<session pooler URL> npm run db:migrate
```

Rules for new migrations:
- write both files in the same commit; keep every statement idempotent (`IF NOT EXISTS`, `OR REPLACE`);
- SQLite file: no `BEGIN`/`COMMIT`, **no semicolons inside comments** (wrangler splits on them);
- Postgres file: `alter table … enable row level security` for every new table, no policies for
  `anon`/`authenticated`, and add the table to the revoke block;
- add the table to `schema.ts` (`Database`, `TABLES_IN_FK_ORDER`, `PRIMARY_KEYS`) – the parity test checks it.
- **adding a column:** SQLite has no `ADD COLUMN IF NOT EXISTS`, so put each `ALTER TABLE … ADD COLUMN` **alone in its
  own SQLite file** (comments allowed, nothing else – e.g. `0004_access_requests_contacted.sql`); the runners apply it
  once and the parity test accepts exactly "duplicate column name" when it re-applies such a file. Postgres: `add column
  if not exists`. Add the column to `schema.ts` and, for a timestamp, to `TIMESTAMP_COLUMNS` in the copy script.
- *Wave 2:* `0004` adds `access_requests.contacted_at` (platform page), `0005` the index `audit_log (tenant_id, user_id, id)`
  (the activity page's own-entries view); Postgres `20261010000004` / `…05` match.
- **`0002_auth`** (both sets) holds Better Auth's tables (`user`, `session`, `account`, `verification`, `twoFactor`,
  `organization`, `member`, `invitation`, `rateLimit`), generated by Better Auth's own schema generator from the app's
  configuration: `npm run db:gen-auth-migrations` (prints; `-- --write` writes). Never regenerate a migration that
  has run: after a Better Auth upgrade, add a new one – `src/server/auth/auth.test.ts` fails while Better Auth still
  wants schema changes. Their columns are camelCase; booleans are 0/1 in SQLite/D1 and `boolean` in Postgres; dates
  ISO TEXT / `timestamptz`. They are in `schema.ts` (`AUTH_TABLES_IN_FK_ORDER`) and the copy script (§8) copies them
  (booleans compared as 0/1, their dates as ISO in the checksums – tested: an account with two-step verification
  copied from SQLite to Postgres still signs in).

Use `npm run db:migrate` for Supabase, not `supabase db push`: the CLI keeps its own history table
(`supabase_migrations.schema_migrations`). Both are idempotent, so a mix does no harm, but stick to one.

## 4. The data gateway Worker (`workers/data-gateway/`)

| Endpoint | Auth | Behaviour |
|---|---|---|
| `GET /v1/health` | none | `{ok: true}` |
| `POST /v1/query` | HMAC | `{statements: [{sql, params}], mode: "single" \| "batch"}` → `{results: [{rows, changes, lastRowId}]}`; `batch` = `env.DB.batch()` (atomic) |
| anything else | – | 404 / 405. There is no `/v1/email`: the app sends email itself (MailerSend) |

- **Auth:** `x-clinforms-ts` (unix ms, ±60 s) and `x-clinforms-sig` = hex HMAC-SHA256(`GATEWAY_SECRET`,
  `ts + "\n" + method + "\n" + path + "\n" + sha256hex(body)`), checked with `crypto.subtle.verify` (constant time).
  Missing / short `GATEWAY_SECRET` → 503 `NOT_CONFIGURED` (closed, never open).
- **Limits:** body ≤ 8 MiB (413), ≤ 100 statements (400 `TOO_MANY_STATEMENTS`), ≤ 100 parameters and ≤ 100 000
  characters per statement (D1's own limits), parameters only `null | string | number | boolean`.
- **SQL rules (400 `SQL_DENIED`):** allowlist – the first keyword must be `SELECT`, `INSERT`, `UPDATE`, `DELETE` or
  `WITH`; **no SQL comments** (`--`, `/*`: the query builder never writes them, and one could hide the real first
  keyword); no `REPLACE` conflict resolution (`REPLACE INTO`, `INSERT/UPDATE OR REPLACE` – it would overwrite
  append-only rows without firing DELETE triggers; use `ON CONFLICT … DO UPDATE`); never `ATTACH`, `DETACH`,
  `PRAGMA`, `VACUUM`, `load_extension`; DDL and transaction statements refused with their own messages; any
  statement containing a write keyword that touches `sqlite_master`/`sqlite_schema`/`sqlite_sequence`/
  `d1_migrations`/`_cf_*` (whatever it starts with, e.g. `WITH … DELETE`); stacked statements. Read-only
  `pragma_table_info(…)` stays allowed. Schema changes go through migrations (wrangler) only.
- **Errors:** `{error: {code, message}}` – `CONSTRAINT_UNIQUE|FOREIGN_KEY|CHECK|NOT_NULL` and `APPEND_ONLY` (409),
  `SQL_ERROR` (400), `UNAVAILABLE` (503, no detail). SQL parameters are never echoed or logged; the Worker logs
  only `{event, code, mode, statements, message}`. The app maps codes to `DbError` (`src/server/db/errors.ts`).
- **Environments:** default → `clinforms-data` + D1 `clinforms-prod`; `--env preview` → `clinforms-data-preview` +
  D1 `clinforms-preview`. `workers_dev` on, preview URLs off, observability on. `migrations_dir` =
  `../../db/migrations/sqlite`.

```bash
cd workers/data-gateway && npm ci                    # own package.json (wrangler 4.139.0, pinned)
export CLOUDFLARE_ACCOUNT_ID=a04ab546d0f1be2aa339bafebcdb3ffa
npx wrangler deploy --env preview                    # preview Worker
npx wrangler deploy                                  # production Worker (orchestrator only)
cd ../.. && npm run db:provision-gateway -- --env preview   # GATEWAY_SECRET → wrangler + Vercel, keys → Vercel
npm run db:selftest -- --env preview                 # live checks against the deployed gateway
```

`db:provision-gateway` keeps existing values from the secrets file (re-runs are harmless; `--rotate-gateway-secret`
makes a new gateway secret), never regenerates the data keys, writes the file first, and pipes every value on
stdin. `db:selftest` uses tenant `zz-selftest` and cleans up after itself (its audit rows stay: append-only).

The Next app never imports `workers/` (ESLint rule + root `tsconfig` exclude); the HMAC protocol is implemented
twice on purpose and the tests check both sides agree.

## 5. Encryption at rest (`src/server/crypto/`)

- AES-256-GCM (Node `crypto`), 96-bit random IV, 128-bit tag.
- Per-tenant key: HKDF-SHA256(master, salt = tenantId, info = `clinforms:data:v1`).
- Ciphertext text: `v1.<kid>.<iv b64url>.<ciphertext+tag b64url>`.
- AAD = `<tenantId>:<table>:<rowId>` (`reports:<id>`, `forms:<id>`, `form_file_chunks:<sha256>:<idx>`): a
  ciphertext moved to another row, table or tenant does not decrypt.
- Encrypted: `forms.payload_enc`, `reports.payload_enc`, `form_file_chunks.data_enc`. Not encrypted (no patient
  data): ids, statuses, titles, referrer names, file names, settings, clinic and member profiles, audit rows.
- *Wave 3 (notes import):* uploaded notes and the review staff check are never stored – only the bundle built when
  they confirm, inside the report's encrypted payload (it may now carry `registration.gpPractice` and
  `referral.referredBy`). The `notes.imported` audit row holds the format and counts only. No migration.

**Key rotation:** (1) add `"k2"` to `CLINFORMS_DATA_KEYS` everywhere (both keys present), deploy; (2) set
`CLINFORMS_DATA_KEY_ID=k2`, deploy – new writes use k2, old rows still decrypt with k1; (3) re-encrypt in the
background with `DataCipher.rotate()` (a job reading rows where `kidOf(ciphertext) !== activeKid`); (4) remove k1
only when no row uses it. Losing a key = losing that data: the keys live in Vercel and the secrets file only.

## 6. Repositories (`src/server/repos/`)

Every function takes the tenant (`tenantId` = organization slug, `^[a-z0-9][a-z0-9-]*$`) – or, for member
profiles, the `organizationId` – explicitly and uses it in every WHERE clause and key. `repoContext()` gives the
app's `{db, cipher}`.

| Module | Notes |
|---|---|
| `forms`, `reports` | `create` (rev 1, `exists` on a duplicate) / `update(expectedRev)` → `{ok, rev}` or `{reason: "conflict", currentRev}` / `not_found`; payloads encrypted; lists newest first, **at most 20 rows with payloads per call** (on D1 a list travels in one gateway response – list metadata and read payloads by id for more); report `deleteAfter`: omitted on update = unchanged, `null` = clear |
| `form-files` | content-addressed by SHA-256; chunks ≤ 512 KiB, 2 per request; complete only when every chunk exists; reads verify size + SHA-256 (`FileIntegrityError`); re-put repairs |
| `tenant-settings`, `clinic-profile`, `member-profile` | upserts |
| `audit` | append-only insert + list (ULID ids, newest first; *wave 2:* optional `action`, `userId` filters and `afterId` for paging back); the database refuses UPDATE, DELETE and overwriting an id (SQLite/D1: triggers in 0001 + `audit_log_no_replace` in 0003; Postgres: revoke + trigger; the gateway also refuses REPLACE) |
| `partner-keys` | `cfk_<tenant>_<43 chars>`, shown once; SHA-256 stored; `partnerKeyTenant()` + `verifyPartnerKey(tenant, key)`; revoke |
| `launch-tokens` | `claimLaunchToken(jti, expiresAt)` – true exactly once (INSERT … ON CONFLICT DO NOTHING RETURNING) |
| `rate-limits` | `hitRateLimit(key, windowMs, amount = 1)` – one atomic upsert, returns the window count (*fix wave 2:* `amount` counts e.g. kilobytes of new data per clinic per day); `peek`, `reset`, `purge` |
| `access-requests` | landing-page requests (not tenant data); *wave 2:* `contactedAt` + `setAccessRequestContacted()` (platform page) |
| `maintenance` | `runRetention()` for `/api/cron/retention` (the only cross-tenant functions): reports not changed for their clinic's `retention_days` (read at run time, so a changed setting applies to existing reports) or past an explicit `delete_after`; used launch tokens; rate-limit windows older than a day; access requests older than 24 months |

**Retention cron:** `GET /api/cron/retention` (`src/app/api/cron/retention/route.ts`, logic + tests in
`src/server/cron/retention.ts`), scheduled daily at 03:17 UTC in `vercel.json` (Vercel runs crons on production
deployments only). Vercel sends `Authorization: Bearer $CRON_SECRET` when `CRON_SECRET` (16+ characters) is set on
the project; without it the endpoint refuses every call (503), so set `CRON_SECRET` in production before relying on
automatic deletion. Counts only in the logs.

## 7. Backups and restore

**D1 (now)**
- **Time Travel** (built in, no setup): point-in-time restore of the whole database (7 days on the Workers Free
  plan, 30 days on Paid):
  ```bash
  cd workers/data-gateway && export CLOUDFLARE_ACCOUNT_ID=a04ab546d0f1be2aa339bafebcdb3ffa   # pinned wrangler lives here
  npx wrangler d1 time-travel info clinforms-prod --timestamp=2026-10-10T09:00:00Z
  npx wrangler d1 time-travel restore clinforms-prod --timestamp=2026-10-10T09:00:00Z   # overwrites current state
  ```
  Note the bookmark `info` prints before restoring, so the restore can be undone.
- **Exports** (off-site copies; they contain ciphertext and metadata, still store them encrypted – and outside the
  repository):
  ```bash
  cd workers/data-gateway && export CLOUDFLARE_ACCOUNT_ID=a04ab546d0f1be2aa339bafebcdb3ffa   # pinned wrangler lives here
  npx wrangler d1 export clinforms-prod --remote --output ~/clinforms-backups/clinforms-prod-$(date +%F).sql
  ```
  Restore an export into a fresh database: `wrangler d1 create …`, then `wrangler d1 execute <db> --remote --file …`.
  An export blocks the database while it runs: schedule it out of hours.

**Supabase (later):** daily backups on Pro; enable **PITR** (add-on) before real patient data, and keep a weekly
logical dump (`pg_dump` over the session pooler) in encrypted storage.

## 8. Runbook – switching from D1 to Supabase Postgres

Trigger: the first paying clinic signs (owner decision). Auth stays Better Auth (same tables, now in Postgres).

1. **Create the project:** `SUPABASE_ACCESS_TOKEN=… SUPABASE_ORG_ID=<org slug> npm run db:provision-supabase`
   (try `-- --dry-run` first). It creates `clinforms-prod` in eu-west-2, saves the generated password and the
   pooler URLs to `~/.config/appstackx/clinforms.supabase.env` and prints the URLs without the password.
2. **Harden the project** (dashboard): SSL enforcement on, network restrictions if used, Data API exposed schemas
   reviewed (our tables have RLS on and no policies), PITR enabled, download the CA certificate.
3. **Migrate the schema:** `CLINFORMS_DB=postgres DATABASE_URL_SESSION=<session URL> npm run db:migrate`
   (migrations and the copy need one session: they prefer `DATABASE_URL_SESSION` and refuse the transaction pooler,
   port 6543).
4. **Rehearse the copy on preview data:** create a scratch project, migrate it first
   (`CLINFORMS_DB=postgres DATABASE_URL_SESSION=<scratch session URL> npm run db:migrate`), then
   `DATABASE_URL_SESSION=<scratch session URL> npm run db:copy-to-postgres -- --from gateway --env preview`.
5. **Freeze writes. NOT BUILT YET – there is no maintenance mode or read-only switch.** Until one exists, freeze by
   hand: tell the clinics, then remove `CLINFORMS_D1_GATEWAY_SECRET` from the production Vercel environment and
   redeploy (the app can then neither read nor write D1 – sign-ins, the request-access form and `/app` fail
   closed), and run the copy with the secret from the secrets file. The copy checks the target against its first
   read of the source only: anything written to D1 after that is not detected, so the freeze must be in place first.
6. **Copy production:** `DATABASE_URL=<session URL> npm run db:copy-to-postgres -- --from gateway --env production`
   (`--dry-run` first). One transaction, FK order, ciphertext as-is; row counts and per-table SHA-256 checksums
   must match or it rolls back. The target must be empty.
7. **Switch the app:** in Vercel (production) set `CLINFORMS_DB=postgres`, `DATABASE_URL=<transaction pooler URL>`,
   `DATABASE_SSL=verify-full`, `DATABASE_CA_CERT=<PEM>`; keep `CLINFORMS_DATA_KEYS`/`_ID` unchanged (same keys
   decrypt the copied rows). Redeploy.
8. **Verify:** sign in, open reports and form files (decryption + file SHA-256 checks run on read), run the
   retention cron once, check the audit trail.
9. **Retire D1 after a grace period:** keep the gateway and D1 read-only for ~30 days (remove
   `CLINFORMS_D1_GATEWAY_*` from Vercel, rotate `GATEWAY_SECRET`), take a final `wrangler d1 export`, then delete.

Rollback before step 9: set `CLINFORMS_DB=d1` again and redeploy (D1 was frozen, so nothing is lost unless
writes happened on Postgres – copy those back by hand).

## 9. Tests

| Command | What |
|---|---|
| `npm run test:db` | migration parity (node:sqlite vs PGlite, RLS on every Postgres table, idempotent files); crypto (tamper, wrong tenant/row/table, unknown kid, rotation); dialect/driver units; the repository suite on SQLite and PGlite; the copy script (SQLite → PGlite) and Supabase helpers |
| `npm run test:gateway` | Worker handler units (HMAC, window, limits, denylist, error mapping), the repository suite through the D1 dialect → in-process Worker → node:sqlite stand-in, and against **real local D1** (workerd via `getPlatformProxy`, migrations applied by `wrangler d1 migrations apply --local`). The last one needs `npm ci` in `workers/data-gateway` (skipped otherwise) |
| `npm run db:selftest -- --env preview` | live checks against the deployed preview gateway |
| `cd workers/data-gateway && npm run typecheck` / `npx tsc -p test/tsconfig.json` | Worker types |

## 10. Known limits and notes for the next slices

- **Workers Free plan:** 10 ms CPU per request. The gateway does little CPU work (HMAC + JSON); file chunks go 2
  per request (~1.4 MB) to stay well inside it. A 2.4 MB file took ~4 s to write and ~1.5 s to read from the UK
  in the preview self-test. Workers Paid ($5/month) raises the CPU limit and Time Travel to 30 days.
- **D1 limits:** 2 MB per row/string, 100 bound parameters and 100 KB per statement, few terms per compound
  SELECT, and **500 MB per database on Workers Free (10 GB on Paid)** – storing form files in D1 reaches the size
  cap first: check it with `cd workers/data-gateway && CLOUDFLARE_ACCOUNT_ID=… npx wrangler d1 info clinforms-prod`.
  Payloads above 1.4 MB JSON are refused by the repositories (`RepoInputError`).
- **Postgres roles (before real data on Supabase):** the app currently connects as the table owner, which could
  disable or drop the audit triggers. Before the switch, create a login role that does not own the tables (SELECT/
  INSERT/UPDATE/DELETE on the tables, only SELECT and INSERT on `audit_log`) for the app, and keep the owner (session
  URL) for migrations and the copy.
- **Better Auth** (built, `docs/auth.md`): Kysely adapter on `getDb()` with `type: "sqlite"` for d1/sqlite and
  `"postgres"` for Postgres, `transaction: false` on every dialect, start-up schema check off on D1 only (real D1
  refuses `pragma_table_info` on `_cf_KV`, and the gateway refuses `PRAGMA`). Its tables are in migration 0002.
- **Repositories without patient payloads** (audit, profiles, partner keys, rate limits, launch tokens, settings,
  access requests, maintenance) take a `DbContext` (`{db, now?}`), so identity code can use them without the data keys.
- **Rate limits** are fixed windows keyed by free text: namespace keys (`live:<tenant>`, `passcode:<ip>`…).
