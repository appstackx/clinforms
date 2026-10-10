# Hosting and infrastructure

## Current architecture – LIVE since 2026-10-10 17:13 UTC
Contract: `docs/production-architecture.md`; database/gateway/keys/backups: `docs/database.md`; sign-in/clinics:
`docs/auth.md`; runbook + run log + known limits: `docs/go-live.md`. Decisions D39–D41, D47–D63.

| Piece | What / where | Ids (no secrets) |
|---|---|---|
| App + API | Next.js 14.2 on **Vercel**, functions `lhr1` (London), **Hobby** (non-commercial – Pro before a paying clinic). Production branch `main`; every push deploys | project `clinforms`, team `khuram99gmailcoms-projects`; prod deployments 10/10: `d4drhu49m` (go-live, `02ddfb5`), `c3lbxtxy3` (`04c18d0`), `kg5bz9ny7` (`8def25b`); pre-go-live `b8guhpqyz` (`26cd447`) |
| Domain | `clinforms.co.uk` (+ `www` → 308 apex); DNS zone on **Cloudflare** (Free plan; Domain Connect to Vercel); **NEL off**, **Always Use HTTPS on** (10/10) | zone `clinforms.co.uk` |
| Database | **Cloudflare D1**, jurisdiction **EU** (primary served from EEUR/FRA in a 10/10 query), migrations `0001`–`0005` applied 10/10 (21 tables, 3 append-only audit triggers) | account `appstackx-demos` `a04ab546d0f1be2aa339bafebcdb3ffa`; `clinforms-prod` `c1a631fe-9cf0-414d-ab2f-28f7291282e3`; `clinforms-preview` `3a548cc6-45d9-4dc5-b308-23a75534dcc9` |
| DB access | Worker **`clinforms-data`** (prod) / `clinforms-data-preview`: HMAC-signed SQL gateway with a D1 binding and a denylist; Vercel signs with `CLINFORMS_D1_GATEWAY_SECRET` (= Worker secret `GATEWAY_SECRET`); D1's REST API is not used at runtime | `https://clinforms-data.appstackx-demos.workers.dev` (`/v1/health` → `{"ok":true}`); plan Workers Free per runbook §8 (verify) |
| Encryption at rest | Reports, form maps and files **AES-256-GCM per clinic** in the app; files split into ≤ 512 KiB encrypted chunks in D1 (R2 not used for clinic data) | `CLINFORMS_DATA_KEYS` / `CLINFORMS_DATA_KEY_ID` = **`k2`** (k1 retired 10/10 before any data) |
| Media | **R2** bucket `clinforms-media` (EU) at **`media.clinforms.co.uk`** – the `/demo` video only (dated folders, e.g. `demo/2026-10-10/`, never overwritten; CORS GET/HEAD from apex/www only) | – |
| Identity | **Better Auth** on the same database: invite-only clinics, required TOTP two-step, roles owner/admin/clinician/staff; platform admin = `CLINFORMS_PLATFORM_ADMINS` (`khuram@appstackx.co.uk`) | internal clinic `appstackx` (Khuram owner, two-step on, 30-day retention) |
| Email | **MailerSend** chosen (D40), **not set up**: `CLINFORMS_EMAIL_PROVIDER=none` → invite/reset links handed over by hand; access requests notify nobody | – |
| Analytics | **PostHog EU** cloud, org "ClinForms", project **300254**; loads only after "Accept analytics", via `/ingest`; campaign-level UTM only | `NEXT_PUBLIC_POSTHOG_KEY` |
| Cron | Vercel cron `/api/cron/retention`, daily `17 3 * * *` UTC, `CRON_SECRET` bearer; deletes reports past retention, stale uploads, rate-limit/jti rows, access requests > 24 months | first scheduled run 11/10 (unverified) |
| Drafting | Anthropic API, `claude-sonnet-5-5`; public demo live mode behind a **server-verified passcode**; clinics only once drafting is switched on | `ANTHROPIC_API_KEY` (rotation confirmation open) |
| Secrets | Values only in Vercel (sensitive, unreadable), the Worker, `~/.config/appstackx/clinforms.secrets.env` (chmod 600; `PREVIEW_*`/`PRODUCTION_*`) and its offline copy (encrypted dmg in iCloud Drive, passphrase in Apple Passwords) | names only in git |
| Later | **Supabase Postgres London** when a clinic pays (D39; `supabase/migrations/`, `db:provision-supabase`, `db:copy-to-postgres`, switch runbook `docs/database.md` §8); Word→PDF converter (UK); Vercel Pro; Workers Paid | – |

Free-plan caps to watch (runbook §8): gateway 10 ms CPU/request and 100 000 requests/day (Workers Free), D1 500 MB
per database, Time Travel 7 days, no scheduled off-site export yet (`wrangler d1 export` by hand).

## History of the hosting decision (before go-live)
**Update 09/10 (desktop, evening; D39–D41):** `https://clinforms.co.uk` went live on Vercel Hobby with a pre-RED build;
database D1 now / Supabase later; Better Auth, MailerSend, PostHog EU. The text below is the earlier (pre-deployment)
state.

**Vercel**, functions pinned to **London (`lhr1`)** – Khuram, 2026-10-09 15:39 UTC: "**1- stick to vercel, push to vercel**". Plan then recommended: **Pro** (Hobby is non-commercial only); Khuram chose Hobby for now (D41).

Recommended full stack (assistant 09/10 14:17 & 15:26 UTC – partly superseded by D39):
- **Vercel Pro** in London (`lhr1`) – app + API.
- **Supabase** in **London**, one shared project, each clinic walled off (RLS).
- A small **UK Word→PDF container** (LibreOffice/Gotenberg on Railway, Fly.io London, or a ~£5 VPS).
- Revisit Cloudflare at ~**20 clinics**.

## Vercel facts (third-party sources, 09/10 – verify at vercel.com/pricing)
- Pro ≈ **$20/member/month**; Hobby = non-commercial only.
- **Pro has unlimited projects** (Hobby 200; a Pro trial caps at 200) → separate "demo" and "base" projects cost nothing extra beyond seats/usage (assistant 15:43 UTC).
- Request body limit 4.5 MB (app caps form files at 2.5 MB, form requests at 4.4 MB). Routes for drafting, analysis, fill-preview, render declare `maxDuration = 60` (assumed Hobby limits; Pro allows more). SDK timeout 50 s.
- `vercel.json`: `{"$schema": "https://openapi.vercel.sh/vercel.json", "regions": ["lhr1"]}`.
- Deployment Protection: enable "Protection Bypass for Automation" (`VERCEL_AUTOMATION_BYPASS_SECRET`) so the server can call its own simulated TM3 API; otherwise it falls back to in-process calls automatically.
- Production-secret rule: on `VERCEL_ENV=production` the launch/signing secrets never use the public demo constants; if unset they are derived from `ANTHROPIC_API_KEY` or `VERCEL_AUTOMATION_BYPASS_SECRET`, else requests fail (unless `MEDREPORT_ALLOW_DEMO_SECRETS=1` – never set in prod). Set real random values anyway.
- LibreOffice can't run on Vercel → Word forms download as Word only; `/render?format=pdf` → 503 `PDF_CONVERSION_UNAVAILABLE`.
- Domains: `clinforms.co.uk` (+ `www`) production; `clinforms.com` (+ `www`) redirect – once Khuram registers them; set DNS at the registrar.
- Sources used: deploycloud-shopify.devcloudsoftware.com/blog/vercel-pricing; modelence.com/compare/vercel-pricing; Vercel docs search (15:43 UTC).

## Cloudflare analysis (assistant 09/10 14:17, 15:26, 15:43 UTC; root README "Cloudflare" section)
Workers Paid ≈ **$5/month** vs Vercel Pro ≈ $20 → saving ~$15/month ≈ 10% of one £149 clinic subscription – shouldn't decide hosting. **Blockers today (≈1–2 days of porting):**
1. `@react-pdf/renderer`'s layout engine (yoga-layout 3) **compiles WebAssembly at runtime** from embedded base64 – Workers refuse → built-in-template PDF render breaks.
2. **No LibreOffice / `child_process`** (same as Vercel) – converter needed either way.
3. **Bundle size:** 3 MB compressed (free) / 10 MB (paid); app bundles pdfjs-dist, react-pdf, DejaVu fonts, templates, sample forms as base64 – near the 10 MB limit (measure).
4. **Temp-file fonts:** `docgen/pdf/fonts.ts` writes fonts to `os.tmpdir()`; Workers have no writable disk → register from memory.
5. CPU/memory: free 10 ms CPU/request (too little); paid 30 s default; 128 MB per isolate.
6. Production-secret rule keys off `VERCEL_ENV` only → set `MEDREPORT_LAUNCH_SECRET`/`MEDREPORT_SIGNING_SECRET` as Worker secrets by hand.
7. Data location: Workers run globally by default; UK-pinned processing "mainly an enterprise feature" (unverified). Vercel pins to London.
8. Next 14 support in the adapter must be checked; Cloudflare now reportedly recommends **vinext** over OpenNext for new Next.js apps (unverified).
9. In-memory limits become per isolate.
Sources: makerkit.dev/pricing-calculator/cloudflare; costbench.com (Cloudflare Pages + Workers pricing 2026); Cloudflare OpenNext guide (developers.cloudflare.com, workers/framework-guides/web-apps/opennext).
`.gitignore` already ignores `.open-next/`, `.wrangler/`, `.dev.vars`.

**Open question (Khuram 15:39 UTC) – RESOLVED by D39:** "for demos and base account, can we use cloudFlare but have supabase scripts ready to create new db plus onboard new client ?" → the app stays on Vercel; Cloudflare hosts the database (D1 + gateway Worker) and the demo media (R2); no Workers port of the app.

## Supabase architecture (recommendation 09/10 14:10 UTC – the LATER database; tenancy/schema now built on D1 with Postgres twins)
- **One app, one Supabase project in London** (AWS `eu-west-2`), pooled multi-tenant.
- **Row-level security keyed by clinic** (tenant membership); separate encrypted file storage per clinic; append-only audit log; automatic deletion after an agreed period; server-side reports.
- One **shared insurer-form library** + each clinic's own forms.
- **Dedicated project per client = premium option** for large groups (~£20+/month each + upkeep doesn't pay at £149/mo).
- *(09/10)* The app had no DB code; since 10/10 the Kysely data layer runs on D1 (gateway), SQLite (local) or Postgres (parity-tested).
- Planned tables (assistant's working plan, not approved): `tenants`, `memberships` (user↔tenant, role), `forms` (tenant-owned + shared library), `reports`, append-only `audit_log`, `api_keys` (hashed partner keys); storage buckets/paths per tenant; retention job.
- Planned scripts: **provision** (create London project via Management API or CLI + apply migrations), **onboard** (tenant, admin invite, partner key, seed shared insurer forms), **offboard** (export, delete tenant data, revoke keys). Test against local Postgres with stubs for `auth.uid()` / `storage` schema.
- Supabase Management API notes (15:43 search; partly unverified): `POST https://api.supabase.com/v1/projects` with `name` + `organization_slug`; auth = **personal access token** as Bearer; beta, **60 requests/min per user**; regions via `GET /v1/projects/available-regions` ("smart region" codes `americas`/`emea`/`apac` mentioned) – whether `eu-west-2` can be passed directly and the exact field names are **unverified** (check the OpenAPI reference); DB password set at creation and reportedly can't be changed programmatically afterwards; SQL execution endpoint not confirmed → alternatives: `supabase db push` with migrations, or `psql` with the connection string.
- Needs from Khuram: Supabase account/org, a personal access token **as an env var** (never pasted), London region confirmation, and the answer "project per client or tenant in the shared DB?".

## Word → PDF converter (not built – still true at go-live; `pdfFromWord: false`)
- `forms/convert.ts` `docxToPdf()` spawns local `soffice` (hardened: minimal env, fresh profile, macros off, max 2 concurrent, 30 s queue, process-group kill on timeout). Candidates include `MEDREPORT_SOFFICE_PATH`, `/usr/bin/soffice`, `/usr/local/bin/soffice`, `/usr/lib/libreoffice/program/soffice`, `/opt/libreoffice/program/soffice`, `/Applications/LibreOffice.app/Contents/MacOS/soffice`. Disabled when `process.env.VERCEL` is set.
- Production: a separate **Gotenberg/LibreOffice container on a UK host** (Fly.io London / Railway / ~£5 VPS), patched, **no outbound network**, called over HTTP. Needs a new env var (e.g. `MEDREPORT_CONVERTER_URL`) and auth – **no code for this exists yet**.
- Fillable/flat PDF forms need no converter (pdf-lib in-process).

## Regions and data location
- Vercel functions: London `lhr1`. D1 + R2: **EU jurisdiction** (not UK). Supabase (later): London. Converter (later): UK.
- Don't claim UK-only hosting of clinic data while it is in D1 (EU); the privacy policy states what is true.
- AI calls go to Anthropic – make **no UK-only AI processing claim** until `inference_geo` options are confirmed; the DPIA covers the transfer.

## Cloud-session environment lessons (for reference)
- Cloud egress proxy blocked: `api.vercel.com`, `api.supabase.com`, `www.bupa.co.uk`, `www.axaglobalhealthcare.com`, `static.aviva.io`, `www.freedomhealthinsurance.co.uk`, `www.allianzcare.com`, Companies House, blueheartclinics.co.uk, keele.ac.uk, motics.ai. Reachable: `api.anthropic.com`, `registry.npmjs.org`, `storage.googleapis.com`, GitHub via git proxy. **The desktop app uses Khuram's own network – verify with `curl -I`.**
- Cloud container had Node v22.22.0, LibreOffice, Postgres 16 binaries, Docker CLI (daemon off), ffmpeg, poppler, Playwright (global); no `vercel`/`supabase`/`wrangler` CLIs. **Check what the Mac has**: Node 22, LibreOffice, ffmpeg/poppler (`brew install ffmpeg poppler`), Postgres or Docker, `npx playwright install chromium`.
