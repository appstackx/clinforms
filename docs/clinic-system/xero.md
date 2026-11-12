# Xero sync – internal notes and how to switch it on

Status 12/11/2026: **groundwork built, switched OFF** (branch `feat/xero-sync`). Trackers xe03 (connect), xe04
(mapping screen), xe05 (push + retry + error list), xe06 (tests against a fake Xero). Never run against a real Xero
organisation yet – the developer app does not exist. Scope and decisions: `decisions/xero-sync-scope.md`.
Clinic guide: `docs/clinic-guides/xero.md`.

## Switches (both off by default)

| Switch | Where | Off means |
|---|---|---|
| `CLINFORMS_XERO=on` | platform env (Vercel) | `/app/clinic/setup/xero` is the 404 page and not in the navigation; `/api/xero/callback` and `/api/xero/drain` answer 404; every server action refuses |
| `pms_xero_connections.enabled` | per clinic, owner/admin switch on Set-up → Xero | nothing queued or sent for that clinic; connect refused |

## What Khuram must do to switch it on (xe01)

1. **Xero developer account** at developer.xero.com, signed in as `khuram@appstackx.co.uk` (free).
2. **New app → "Web app"**, name **ClinDesk**, company URL `https://clindesk.co.uk` (or `https://appstackx.co.uk`).
   Redirect URIs (must match exactly – path `/api/xero/callback`, no query string):
   - `http://localhost:3000/api/xero/callback` (local testing; http is accepted for localhost only)
   - `https://<the production clinic app host>/api/xero/callback` – the host clinics sign in on. The session cookie
     is host-only, so the **connect button only works on that host**; on any other host the page says
     "Open ClinDesk at <host> to connect Xero".
3. **Scopes** (granular – apps created after 2 March 2026 cannot use `accounting.transactions`):
   `openid profile email offline_access accounting.invoices accounting.payments accounting.contacts accounting.settings.read`
   (in code: `XERO_SCOPES`, `src/modules/pms/integration/xero.ts`). Tick the same ones on the app if the portal asks.
4. **Env vars** (Vercel → Production; values never in git or app `.env` files – OpenNext/Next bundles `.env*`):
   | Name | Value |
   |---|---|
   | `XERO_CLIENT_ID` | the app's Client ID |
   | `XERO_CLIENT_SECRET` | the app's client secret (generate in the portal; shown once) |
   | `XERO_REDIRECT_URI` | exactly one of the redirect URIs above for that deployment, e.g. `https://<host>/api/xero/callback` |
   | `CLINFORMS_XERO` | `on` (leave unset until the Demo Company test passed) |
   | `CRON_SECRET` | already set (the drain uses the same `Authorization: Bearer` secret as the other cron routes) |
   `CLINFORMS_DATA_KEYS` / `CLINFORMS_DATA_KEY_ID` are already set – the tokens are sealed with them.
5. **Migration 0172** (`db/migrations/sqlite/0172_pms_xero_sync.sql` + `supabase/migrations/20261024000172_pms_xero_sync.sql`)
   on production Supabase – with Khuram's go, after merge (additive: 4 new tables, RLS on, Data API roles revoked).
6. **Scheduling** (Vercel Hobby crons run once a day): add a 5-minute cron trigger to a Cloudflare Worker that calls
   `POST https://<host>/api/xero/drain` with `Authorization: Bearer $CRON_SECRET`. Not built in this branch (no
   deploys). Until then the owner's **Send now** button sends on demand.
7. **Turn on the UK Demo Company** in Xero, connect the internal clinic `appstackx` (fictional data) on a preview/local
   run, and check (still to do, the "Still to check" list of the scope doc): the zero-rated UK TaxType name
   (`ZERORATEDOUTPUT` assumed), the refresh-token lifetime (60 days unused assumed), that payments to a "clearing"
   current-liability account with *Enable payments* work, the credit-note allocation date rule, and the 429 headers.
8. **Tier:** Starter (free, 5 connections, 1,000 calls per organisation per day) until the 6th clinic; then
   certification (xe07) and Core.
9. Add a line to the clinic DPA / privacy notice and the DPIA: patient names (and optionally contact details) go to the
   clinic's own Xero organisation; nothing clinical.

## How it works (code map)

| Piece | File |
|---|---|
| Rules, switch, scopes, back-off, Idempotency-Key, copy | `src/modules/pms/integration/xero.ts` |
| Mappers (pure): invoice, credit note, payment, contact | `src/modules/pms/integration/xero-mappers.ts` |
| Screen types | `src/modules/pms/integration/xero-view.ts` |
| HTTP client (identity + Accounting API, error classes) | `src/server/pms/integration/xero/client.ts` |
| Env config (names only) | `src/server/pms/integration/xero/config.ts` |
| Connect / callback / disconnect | `src/server/pms/integration/xero/connect.ts`, `src/app/api/xero/callback/route.ts` |
| Send run (queue, order, idempotency, retry, tokens) | `src/server/pms/integration/xero/sync.ts` |
| Drain endpoint | `src/server/pms/integration/xero/drain.ts`, `src/app/api/xero/drain/route.ts` |
| Repositories | `src/server/repos/pms/integration/xero.ts` |
| Set-up page, actions, component | `src/app/app/clinic/setup/xero/*`, `src/components/pms/integration/xero-setup.tsx` |
| Audit codes | `src/modules/pms/audit/xero.ts` (`pms.xero.*`) |
| Tests | `src/modules/pms/integration/xero.test.ts` (pure), `src/server/pms/integration/xero/testing/{fake-xero,xero-suite}.ts` on SQLite, PGlite and D1 via the gateway |

### Security rules

- **Tokens** are sealed with the data envelope (AES-256-GCM, per-clinic subkey, AAD
  `<tenant>:pms_xero_connections.tokens_sealed:<tenant>`), never logged, never returned to a screen. The column is
  deliberately not `_enc`: offboarding's export decrypts `_enc` columns, and a live refresh token must never land in an
  export file in clear.
- **Refresh-token rotation:** a refresh is claimed with the row's `token_rev` plus `refresh_lock_until` (30 s), the new
  pair stored only where the claim still holds (settings use `rev`, so a save never discards it). `invalid_grant` / 403 → status `paused`, the "Reconnect Xero" banner.
- **OAuth state:** 256 random bits, only its SHA-256 stored with the member's user id and session id, 10 minutes,
  consumed by the same conditional UPDATE that checks it (single use) – even for Xero's error answers.
- **One GBP organisation** per clinic, picked by the access token's `authentication_event_id`; anything else is
  disconnected at Xero again.
- **Who:** owner or admin with `settings.setup` (page, actions, callback, layout 404 and navigation).
- **Tenant isolation:** every statement names `tenant_id` (tenant-scope guard in the suite); the Xero organisation id
  comes only from the clinic's own row; the drain's one cross-clinic read returns clinic ids only.
- **Idempotency:** `pms_xero_links` (a linked record is never created again), a look-up by invoice / credit-note
  number before creating (a lost answer), and an `Idempotency-Key` per item + payload version (bumped by Retry).
- **Messages:** Xero's own text is never stored – fixed plain-English lines only (`xeroMessageText`).
- **One organisation, one clinic** (`xeroOrgInUseElsewhere` – the one cross-clinic yes/no read in a clinic's flow).

### Independent review fixes (12/11/2026)

| # | Finding | Fix |
|---|---|---|
| 1 | A credit note sent before an earlier payment blocked that payment | A credit note waits until every payment allocated to its invoice before it (by `created_at`) is linked, done or skipped |
| 2 | Find-by-number could link someone else's document / contact | A found invoice / credit note is linked only if type (ACCREC / ACCRECCREDIT), total and contact match; a `CD-P…` contact only if its name matches; otherwise "needs a fix". One Xero organisation per clinic: connecting an organisation another clinic uses is refused (`org_in_use`) and that clinic's connection is left alone |
| 3 | Unreadable 200 → blocked → new key → duplicate payment | Unreadable / id-less answers are TRANSIENT (same key). Each payment carries a marker `CD-A<10>` in its Reference; before creating, the invoice's payments are checked and a match is linked |
| 4 | Revoking could end another clinic's connection | Disconnect / failed connect delete only this sign-in's connections whose organisation no other clinic uses; the refresh token is revoked only when the Xero user has no connection left (`revokeIfAlone`); a token without `authentication_event_id` is refused and nothing is touched |
| 5 | Site-limited admins could run the clinic-wide sync | `mayManageXero` also needs `siteIds === null` |
| 6 | VAT treatment from today's setting | From the invoice's own lines (`invoiceUsesVat`); a "none" line is always `NONE` |
| 7 | Lease without owner; items could outlast it | `lease_token` per claim, only the holder records the outcome; lease 120 s; every Xero call (10 s timeout) checks the run's deadline first (`XeroDeferred` → back on the list, no try counted); drain: no item starts after 33 s, no call after 45 s |
| 8 | Drain starved later clinics | `last_run_at`, clinics taken oldest-run first |
| 9 | Dependents of a skipped / blocked invoice silently pending | Skipped invoice → dependents skipped with a reason; blocked / failed → dependents "waiting" with a reason, listed on the screen |
| 10 | Links export capped at 10,000 | `pms_xero_links` keyed `(tenant_id, id)` → keyset-paged by the export |
| 11 | A settings save discarded a fresh refresh | Separate `token_rev` for refresh claims |
| 12 | Lost credit-note allocation answer | Allocation capped by the credit note's remaining credit (0 = already allocated) and the invoice's amount due |
| 13 | Messages could keep patient names | Xero's text is never stored: known messages map to fixed lines (`xeroMessageText`), anything else to one generic line |

Also found while testing: invoice / credit-note numbers are now sent exactly as ClinDesk prints them
(`formatDocumentNumber`, e.g. `RIV00042`).

### Differences from the scope doc (deliberate, to review)

- **Queue by sweep, not in each billing action's batch:** each run queues what is due (`queueDueItems`, id =
  `<type>:<op>:<local id>` so it is idempotent) instead of adding an outbox row to every billing repository's batch.
  Same guarantee (nothing missed), no change to the billing code. Latency = the drain interval (or Send now).
- **Credit-note `transfer`** is sent as a plain credit note on the payer's invoice; the patient's new invoice goes on
  its own when issued (as the scope says).
- **Payers:** an existing Xero contact with exactly the payer's name is linked automatically (Xero keeps names unique,
  so creating would fail anyway) instead of an "offer to link" button.
- **Not built yet:** contact updates on a changed name/email (`sent_hash` is stored for it), refunds (negative
  allocations – shown nowhere, not queued), batching several invoices per call, the 80 % daily-cap stop, the daily
  failure email to owners, the Cloudflare cron Worker, the real Demo Company run (xe06 manual part), certification (xe07).

## Migration numbers

`0172` (integration range 0170–0179, reserved in `src/modules/pms/core/modules.ts`). 0173–0179 stay free. The four
tables cascade from `pms_billing_settings`, so offboarding names no new table (`offboard-batch.test.ts` headroom
unchanged).
