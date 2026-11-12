# Clinic system – public clinic API v1 (tracker xt03)

**Internal.** 12/11/2026. Branch `feat/clinic-api`. Ships **dark**: behind the platform switch
`CLINFORMS_CLINIC_API=on` **and** a per-clinic setting that is off by default. Module: integration (migration `0171`).

A read-mostly JSON API so another system a clinic uses (its website, a booking widget, a reporting tool) can read the
clinic's appointments, patients and invoices and book appointments into free times. It is separate from the ClinForms
Report API (`/api/reports/v1`, partner keys `cfk_…` in `partner_keys`) – it borrows that system's patterns (key shown
once, SHA-256 stored, the clinic inside the key, revocable, audited) but has its own keys, tables, routes and screen.

## 1. Switches

| Switch | Off | On |
|---|---|---|
| `CLINFORMS_CLINIC_API` (env, platform) | every `/api/clinic/v1/**` route and method answers **404** (`{"error":{"code":"NOT_FOUND"}}`), `openapi.json` too; Set-up → API keys is the 404 page and has no navigation entry | the routes exist; the owner sees Set-up → API keys |
| Clinic setting (`pms_api_settings.enabled`, owner, Set-up → API keys) | no key of the clinic works (**403 `API_OFF`**) | keys work |
| Clinic package `clinic` | keys answer 403 `API_OFF` | – |

Values other than `on` (any case) mean off. Production: not set.

## 2. Keys

- Created, replaced and revoked by the clinic's **owner only** (permission `settings.owner`, which no other role can
  get; every clinic member already has two-step verification – the clinic actor refuses a session without it).
- Format `cdk_<clinic id>_<lookup: 16 × a-z0-9>_<secret: 43 base64url = 256 bits>`. The clinic id and lookup let the
  server read **one** row by `(tenant_id, lookup)`; it then compares the SHA-256 of the presented key with the stored
  `key_hash` using `timingSafeEqual` (a dummy compare when the row does not exist). Only `key_hash`, `lookup` and
  `last4` are stored; the key is shown once (`SecretBox`) and never again.
- Each key: name, scopes (`appointments:read`, `appointments:write`, `patients:read`, `invoices:read`), optional site
  restriction (`site_ids_json`, null = every site), expiry (30/90/180/365 days or none), `last_used_at`, `use_count`,
  revoked, `replaced_by_id`. At most 20 working keys per clinic.
- **Rotation** ("Replace"): a new key with the same name, scopes, sites and expiry length; the old one keeps working
  for 24 hours (its expiry is brought forward, never pushed back). One atomic batch, conditional on the old key not
  being replaced yet. A key and its replacements form a **family** (`family_id` = the first key's id): Idempotency-Keys
  belong to the family, so a booking retried with the new key after a rotation returns the original appointment.
- **Revoke** is one atomic batch with its audit row: the conditional update stamps a fresh `write_id` and the audit row
  is inserted only where it is found (never a revocation without its row, nor a second row for a second revoke).
- **Audit:** `pms.api_settings.update`, `pms.api_key.create|revoke|rotate` (owner as actor). **Use is counted, not
  audited per call:** every authenticated call increments `pms_api_key_days.calls` (per key per UK day) and the key's
  `use_count` / `last_used_at`; the first call of a UK day writes one `pms.api_key.use` row.
- Activity pages: rows written through a key (user id null, `detail.apiKeyId`) show **API key “name”** as who did it
  (`src/server/admin/activity.ts`).

## 3. Request pipeline (`src/server/pms/integration/api/http.ts`)

1. switch → 404; 2. method (only those the route has; **OPTIONS → 405, no CORS headers ever** – the API cannot be
called from another site's pages); 3. **HTTPS** (`x-forwarded-proto`/URL; plain HTTP only to localhost) → 403
`HTTPS_REQUIRED`; 4. query ≤ 2 KiB; 5. **`Authorization: Bearer <key>` only** – cookies are never read (no session, no
CSRF surface), keys in the URL are ignored; every refusal is 401 `UNAUTHENTICATED` + `WWW-Authenticate: Bearer` (one
answer for missing, malformed, wrong, revoked, expired):
   - **no header, or not a well-formed key** (`parseApiKey` fails): refused with **no database read or write**. An
     in-memory, per-instance token bucket per network (60/min, IPv6 by /64) is the pre-filter: past it, 429 – still
     no write. It never applies to a well-formed key.
   - **a well-formed key is verified FIRST.** A right key is never refused because of failures – only its own
     per-key limit can stop it. A wrong one (unknown, wrong secret, revoked, expired) counts in `rate_limits`
     against its **presented lookup** (`capi:fail:key:<clinic>:<lookup>`, 20 per 10 min, from any network) and its
     **network** (`capi:fail:ip:<ip>`, 20 per 10 min); once either is over, wrong keys get 429 with no further
     write. These are the only writes before authentication.

6. clinic package + clinic setting → 403 `API_OFF`; 7. **per-key limit** 120/min (`capi:key:…`) → 429 +
`Retry-After`; scope → 403 `INSUFFICIENT_SCOPE`; 8. POST: `application/json` only (415), ≤ 8 KiB (413, also streamed
bodies); 9. the use counter; 10. the endpoint. Answers: `cache-control: no-store`, never `Set-Cookie`. The security
headers (Referrer-Policy, X-Content-Type-Options, HSTS …) come **once**, from `next.config.mjs` – the API does not set
them again (`API_RESPONSE_HEADERS`). Errors: `{"error":{"code","message"}}` – 401/403/404/405/413/415/422/429/500
(codes in `src/modules/pms/integration/api.ts` `API_ERRORS`). Validation: zod, strict (unknown or repeated parameters
→ 422).

Security review 12/11/2026 (fixed on this branch): a valid key is no longer refused by a network's failed-key lockout;
unauthenticated junk causes no database writes; `openapi.json` writes nothing.

## 4. Endpoints (`/api/clinic/v1`, `src/server/pms/integration/api/endpoints.ts`)

| Method + path | Scope | Notes |
|---|---|---|
| `GET /appointments?from&to[&siteId&practitionerId&status&limit&cursor]` | appointments:read | UK dates, ≤ 31 days, by start then id; appointments only (no blocked time); status `in_treatment` derived (arrived + treatment started) |
| `GET /appointments/{id}` | appointments:read | |
| `GET /slots?siteId&serviceId&from[&days≤14&practitionerId&limit]` | appointments:write | the diary's free online-bookable times (what POST accepts) |
| `POST /appointments` + `Idempotency-Key` | appointments:write | see §5 |
| `GET /patients[?name&dateOfBirth&email&status&limit≤50&cursor]` | patients:read | minimal fields (id, number, names, DOB, status); merged records never |
| `GET /patients/{id}` | patients:read | + title, email, mobile, postcode, reminder flags |
| `GET /invoices[?from&to&status&patientId&limit&cursor]` | invoices:read | issued between UK dates (≤ 366 days); pence; `balancePence` |
| `GET /invoices/{id}` | invoices:read | + lines (codes, amounts – **no descriptions**) |
| `GET /openapi.json` | none | OpenAPI 3.1 (`src/modules/pms/integration/api-openapi.ts`); same switch and HTTPS rule, the in-memory pre-filter only – **no database read or write**, `cache-control: public, max-age=3600` |

Lists: `{"data":[…],"nextCursor":"…"|null}` (opaque base64url keyset, validated); one record: `{"data":{…}}`. Ids are
the stable record ids; instants ISO UTC (`…Z`), calendar dates `YYYY-MM-DD` (UK); money in pence. **Never returned:**
any `_enc` column (booking/cancel notes, patient alerts and notes, invoice descriptions, diagnosis, bill-to text),
clinical notes, GP or emergency contacts, `tenant_id`.

**Scoping.** Every statement names the key's `tenant_id` (tenant-scope guard in the suite). Site restriction as for
staff: appointments by their site; patients by `patientSiteFilter` (a case or appointment at a key site, or nothing
anywhere yet); invoices by their site (no site = needs every site) **and** a visible patient. A record of another
clinic or another site, or that does not exist, answers the same **404**. Naming a site outside the key's sites →
403 `SITE_NOT_ALLOWED`.

**Patient reads → the patient's history.** Each patient returned by `/patients` or `/patients/{id}` writes one
`pms.api.patient_read` audit row targeting the patient (the History tab shows "Patient record read through the API"
by "API key “…”"), in one batch with the key's `patient_reads` counter. Staff reads of a patient record are not
logged today (only note opens, `pms.note.view`) – the API is stricter. Appointments and invoices return only patient
ids, so they are not logged as patient reads.

## 5. Booking

`POST /appointments` body (strict): `patientId, serviceId, practitionerId, siteId, date (YYYY-MM-DD), startTime (HH:MM
UK)`, optional `caseId` (must be an **open** case of this patient in this clinic and – for a site-limited key – at
one of its sites or without a site; a case that does not exist, is another clinic's or patient's, is closed or is at
another site all get the SAME 422 answer, so nothing is revealed), `note` (≤ 500, for reception, stored encrypted, never returned), `sendConfirmation` (default
false). Rules – **the same as online booking** (`src/server/pms/diary/portal-adapter.ts`, `portal/availability.ts`):
site, service and practitioner active and online-bookable; the patient visible to the key and active; the time in the
future and **one of `findFreeSlots`** (rota window marked for online booking, minus appointments, blocked time, held
waiting-list slots, and the patient's own appointments); then the diary's `bookAppointment` books it (its clash check
and the database's clash triggers decide again) with source `online`, then `syncDiaryMessages` (confirmation only if
asked). The `pms_api_idempotency` row and a `pms.api.appointment_book` audit row (naming the key) are in the **same
atomic batch** as the appointment. `Idempotency-Key` (8–100 of `A-Za-z0-9._:-`) is required: the same key + same body
→ 200 with the same appointment and `Idempotent-Replayed: true`; same key + different body → 422
`IDEMPOTENCY_MISMATCH`; a concurrent duplicate loses on the clash trigger or the unique index and is answered as a
replay. Idempotency-Keys are unique per clinic and key **family** (`pms_api_idempotency.family_id`): unrelated keys do
not share them; a key and its replacement do. Not free → 422 `SLOT_NOT_FREE`.

## 6. Data (migration 0171, `db/migrations/sqlite/0171_pms_clinic_api.sql` + `supabase/migrations/20261024000171_pms_clinic_api.sql`)

`pms_api_settings` (PK tenant_id) ← `pms_api_keys` (unique `(tenant_id, lookup)`, `family_id`, `write_id`) ←
`pms_api_key_days` (PK tenant, key, day) and `pms_api_idempotency` (unique `(tenant_id, family_id, idem_key)`, also FK
to the appointment), all **ON DELETE CASCADE**. Postgres: RLS on, no policies, `anon`/`authenticated` revoked. Offboarding names only
`pms_api_settings` (`INTEGRATION_CASCADE_DELETED_TABLES`); the headroom test (`src/server/auth/offboard-batch.test.ts`)
dropped from 360 to 270 member accounts in one batch (one more named table) – flagged; the next per-clinic table
should hang off an existing parent row. Number reserved in `src/modules/pms/core/modules.ts` (integration 0171;
0172–0179 free). **Deploy order:** apply 0171 before switching `CLINFORMS_CLINIC_API=on` (with the switch off nothing
reads the tables, except the activity page's fail-safe key names).

## 7. Screen

Set-up → **API keys** (`/app/clinic/setup/api`, nav id `integration.api`, last in `SETUP_ORDER`, page permission
`settings.owner`; the clinic layout 404s it while the switch is off or for anyone but the owner; the navigation, and
the Set-up landing page's choice of first page, leave it out while the switch is off): the clinic API
on/off, create (name, scopes, sites, expiry), shown-once key, list (prefix…last4, state, scopes, sites, created by,
ends, last used, calls today / 30 days, patient records read), Replace, Revoke, and **For developers** – base URL,
curl examples for every endpoint, Idempotency-Key, limits and errors, link to `openapi.json`. No vendor or
technology names.

## 8. Tests

- Pure: `src/modules/pms/integration/api.test.ts` (key format, Bearer, cursors, schemas, OpenAPI ↔ route files, no
  vendor names, every route file exports every method).
- Integration (HTTP pipeline + repositories): `src/server/pms/integration/api/testing/api-suite.ts`, run on node:sqlite
  + PGlite (`api.test.ts`, `npm run test:pms` / `test:db`) and on D1 through the gateway – stand-in and local workerd
  (`workers/data-gateway/test/pms-integration-api-stack.test.ts`, `npm run test:gateway`). Switch off, auth failures,
  HTTPS, clinic setting/package, scopes, site restriction, tenant isolation, pagination, patient search + history,
  invoices, slots, booking (validation, free-slot rule, idempotent replay, mismatch, concurrent duplicate, replay after
  rotation, cases), per-key limit, no-write rejection of junk + the in-memory bucket, failed-key lockout that never
  refuses a right key (per lookup and per network), openapi.json without writes, no duplicate security headers, use
  counting, revoke/expiry, atomic revoke + audit, rotation, hashes only, offboarding by cascade, tenant-scope guard.
- e2e (local): `scripts/e2e/pms-integration-api.cjs` (port 3190/3192) – switch off 404s, owner creates a key in the
  screen, curl + fetch calls, booking + replay, history row, revoke → 401, 375 px, admin/reception 404.

## 9. Not in v1 / follow-ups

Writes other than booking (cancel, move, patients, invoices); webhooks; per-key IP allow-lists; a step-up two-step
code at key creation (no step-up mechanism exists in the app yet – the owner's session is already two-step); OAuth
for third-party apps; staff patient-record views are not logged (the API logs its reads).
