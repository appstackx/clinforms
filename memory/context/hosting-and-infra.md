# Hosting and infrastructure

## Decision
**Update 09/10 (desktop, evening; see `decisions.md` D39–D41):** `https://clinforms.co.uk` is **live** on Vercel (project `clinforms`, team `khuram99gmailcoms-projects`, `lhr1`, **Hobby for now** – non-commercial, move to Pro before a paying clinic) with a pre-RED build. Database: **Cloudflare D1 now** (EU, via the gateway Worker `clinforms-data`), **Supabase Postgres London later**; Better Auth, MailerSend, PostHog EU (project 300254). Contract: `docs/production-architecture.md` on branch `feat/production`. The text below is the earlier (pre-deployment) state.

**Vercel**, functions pinned to **London (`lhr1`)** – Khuram, 2026-10-09 15:39 UTC: "**1- stick to vercel, push to vercel**". Plan: **Pro** (Hobby is non-commercial only). **Not deployed yet** – the cloud container had no Vercel access; Khuram must import the repo (or provide a `VERCEL_TOKEN` + team scope as an env var). The Vercel plan he is on was asked 06/10 12:31 & 12:49 UTC and **never answered**.

Recommended full stack (assistant 09/10 14:17 & 15:26 UTC):
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

**Open question (Khuram 15:39 UTC):** "for demos and base account, can we use cloudFlare but have supabase scripts ready to create new db plus onboard new client ?" – assistant's interim answer (15:43): on Vercel Pro a demo/base project costs nothing extra; Cloudflare = ~$5/mo + 1–2 days porting. Planned an evidence-gathering Cloudflare feasibility spike (OpenNext build, measure bundle/WASM/fonts). **Awaiting Khuram's choice.**

## Supabase architecture (recommendation 09/10 14:10 UTC; never explicitly confirmed)
- **One app, one Supabase project in London** (AWS `eu-west-2`), pooled multi-tenant.
- **Row-level security keyed by clinic** (tenant membership); separate encrypted file storage per clinic; append-only audit log; automatic deletion after an agreed period; server-side reports.
- One **shared insurer-form library** + each clinic's own forms.
- **Dedicated project per client = premium option** for large groups (~£20+/month each + upkeep doesn't pay at £149/mo).
- The app has **no DB code today**; tenantId `demo` is already in every type/token.
- Planned tables (assistant's working plan, not approved): `tenants`, `memberships` (user↔tenant, role), `forms` (tenant-owned + shared library), `reports`, append-only `audit_log`, `api_keys` (hashed partner keys); storage buckets/paths per tenant; retention job.
- Planned scripts: **provision** (create London project via Management API or CLI + apply migrations), **onboard** (tenant, admin invite, partner key, seed shared insurer forms), **offboard** (export, delete tenant data, revoke keys). Test against local Postgres with stubs for `auth.uid()` / `storage` schema.
- Supabase Management API notes (15:43 search; partly unverified): `POST https://api.supabase.com/v1/projects` with `name` + `organization_slug`; auth = **personal access token** as Bearer; beta, **60 requests/min per user**; regions via `GET /v1/projects/available-regions` ("smart region" codes `americas`/`emea`/`apac` mentioned) – whether `eu-west-2` can be passed directly and the exact field names are **unverified** (check the OpenAPI reference); DB password set at creation and reportedly can't be changed programmatically afterwards; SQL execution endpoint not confirmed → alternatives: `supabase db push` with migrations, or `psql` with the connection string.
- Needs from Khuram: Supabase account/org, a personal access token **as an env var** (never pasted), London region confirmation, and the answer "project per client or tenant in the shared DB?".

## Word → PDF converter (not built)
- `forms/convert.ts` `docxToPdf()` spawns local `soffice` (hardened: minimal env, fresh profile, macros off, max 2 concurrent, 30 s queue, process-group kill on timeout). Candidates include `MEDREPORT_SOFFICE_PATH`, `/usr/bin/soffice`, `/usr/local/bin/soffice`, `/usr/lib/libreoffice/program/soffice`, `/opt/libreoffice/program/soffice`, `/Applications/LibreOffice.app/Contents/MacOS/soffice`. Disabled when `process.env.VERCEL` is set.
- Production: a separate **Gotenberg/LibreOffice container on a UK host** (Fly.io London / Railway / ~£5 VPS), patched, **no outbound network**, called over HTTP. Needs a new env var (e.g. `MEDREPORT_CONVERTER_URL`) and auth – **no code for this exists yet**.
- Fillable/flat PDF forms need no converter (pdf-lib in-process).

## Regions and data location
- Vercel functions: London `lhr1`. Supabase: London. Converter: UK.
- AI calls go to Anthropic – make **no UK-only AI processing claim** until `inference_geo` options are confirmed; the DPIA covers the transfer.

## Cloud-session environment lessons (for reference)
- Cloud egress proxy blocked: `api.vercel.com`, `api.supabase.com`, `www.bupa.co.uk`, `www.axaglobalhealthcare.com`, `static.aviva.io`, `www.freedomhealthinsurance.co.uk`, `www.allianzcare.com`, Companies House, blueheartclinics.co.uk, keele.ac.uk, motics.ai. Reachable: `api.anthropic.com`, `registry.npmjs.org`, `storage.googleapis.com`, GitHub via git proxy. **The desktop app uses Khuram's own network – verify with `curl -I`.**
- Cloud container had Node v22.22.0, LibreOffice, Postgres 16 binaries, Docker CLI (daemon off), ffmpeg, poppler, Playwright (global); no `vercel`/`supabase`/`wrangler` CLIs. **Check what the Mac has**: Node 22, LibreOffice, ffmpeg/poppler (`brew install ffmpeg poppler`), Postgres or Docker, `npx playwright install chromium`.
