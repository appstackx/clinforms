# ClinForms

**ClinForms by AppStackX** – complete every referrer's own report form from your clinic notes.

| | |
|---|---|
| Product | ClinForms (vendor: AppStackX) |
| Repository | [`appstackx/clinforms`](https://github.com/appstackx/clinforms) (private) |
| Domains | `clinforms.co.uk` (primary, UK) and `clinforms.com` |
| Formerly | "AppStackX Reports" (renamed 09/10/2026; internal identifiers kept – see [Renaming the product](#renaming-the-product)) |

ClinForms completes each referrer's **own** report form – medico-legal company (MLC), insurer, solicitor, case
manager or employer – from a physiotherapy clinic's records, and has the treating physiotherapist
review and approve it before anything leaves the clinic.

- **In:** the referrer's form (Word `.docx` or fillable PDF; a flat PDF on a best-effort basis) and the
  patient's episode from the clinic system (registration details, treatment notes, appointments,
  outcome measures) – through the clinic-system API, an uploaded export or a printed-notes PDF.
- **Mapped once per form:** every question on the form, where its answer goes in the original file,
  and where the answer comes from (registration data, a calculated fact, the notes, a clinician's
  recorded opinion, the sign-off, or "leave blank"). Staff check and confirm the map once; it is reused
  for every patient.
- **Completed per patient:** facts are filled by code; narrative answers are drafted from the notes;
  every answer carries the IDs of the notes it came from. Missing information becomes a visible gap,
  never a guess, and opinions are only ever attributed to a clinician who recorded them.
- **Reviewed and approved:** the physiotherapist goes through the form question by question with the
  sources beside each answer, fills gaps, confirms or adds their opinion and approves it. Approval
  produces a signed receipt bound to the exact content.
- **Out:** the referrer's own Word file (or PDF) with the answers written into its original layout,
  plus a PDF copy, filed back to the patient's record in the clinic system.

Built-in report templates remain as the fallback when a referrer sends no form. The Report API
(`/api/reports/v1`) is the product; the Studio UI at `/reports` is the first app built on it.

> **Demo build – fictional data only.** Reports and the forms library are stored in the browser. The
> clinic system is a **Simulated TM3 sandbox** (`/pms-sandbox`, `/api/tm3-sim/v1`) with fictional
> patients, always labelled "Simulated TM3 sandbox – demo data, not affiliated with TM3".

The product name is set in exactly one place: `PRODUCT` in
[`src/modules/medreport/config.public.ts`](src/modules/medreport/config.public.ts) (see
[Renaming the product](#renaming-the-product)).

## Demo flow

| URL | What it is |
|---|---|
| `/` | Redirects to `/reports` |
| `/pms-sandbox` | The simulated clinic system: patient list (Megan Hart and Daniel Brooks have full episodes) |
| `/pms-sandbox/patients/sim-pat-001` | A patient record (registration, notes, appointments, outcome measures, filed documents). **Complete referrer's report form** launches the Studio with this episode, through the Report API's partner launch |
| `/reports` | Studio home: completed and in-progress forms, demo tools (import a case, reset) |
| `/reports/forms` | Referrer forms library: bundled fictional forms with confirmed maps; **Upload a referrer form** reads a new form and proposes its map |
| `/reports/forms/[formId]` | Check and confirm a form's map against the original layout |
| `/reports/new` | Complete a form: pick the patient (simulated TM3, an uploaded export or a printed-notes PDF), the form, then draft |
| `/reports/[id]` | Review question by question with sources, gaps and checks; preview the filled original; approve; download Word/PDF; save to the clinic record |
| `/reports/batch` | Complete one form for several patients |
| `/reports/security` | Security & data protection: roles, DPA/DPIA, data handling, approval, hosting, audit, retention |
| `/reports/templates` | Built-in fallback templates (and validating a tagged Word template) |
| `/api/reports/v1/health` | `{product, version, aiMode, liveAiAvailable, …}` |

A typical run: open `/pms-sandbox` → Megan Hart → **Complete referrer's report form** → pick
Harrow & Pike's form → the answers are drafted (demo mode replays prepared drafts, clearly badged) →
review, resolve the gaps, approve → download the completed form → **Save to clinic record** → the
sandbox's Documents tab shows the filed file. The full demo script and the planted gaps are in
[`docs/plan.md`](docs/plan.md) §9 and in the module README's "Demo data".

Customer-facing wording is neutral: screens, documents and exports describe what the product does and
never name the drafting technology or vendor (`src/modules/medreport/core/wording.ts`, guarded by
`scripts/medreport/neutral-wording.test.ts`).

## Repository layout

```
src/app/                    Next.js App Router – thin pages and route files only
  layout.tsx page.tsx       root layout (metadata from PRODUCT, Inter via next/font); "/" → /reports
  not-found.tsx icon.svg
  reports/**                Studio pages (+ medreport-host.tsx: write-back into the sandbox record)
  pms-sandbox/**            simulated clinic system pages (+ actions.ts: server-to-server launch)
  api/reports/v1/**         Report API route files → module handlers
  api/tm3-sim/v1/**         simulated TM3 API route files → sandbox handlers
  api/_medreport-glue.ts    the one place that wires the module to the sandbox (connector registry)
src/modules/medreport/      THE PRODUCT (core, connectors, auth, ai, forms, docgen, templates, api, ui)
                            – see its README.md for the folder map, contracts and conventions
src/sandbox/tm3-sim/        the simulated TM3 clinic system (demo scaffolding, not the product)
src/components/ui/*         generic UI primitives (button, card, dialog, …) – reached by the module
src/lib/utils.ts            only through src/modules/medreport/ui/primitives.ts
scripts/medreport/          tests, recorders, sample builders, ESLint boundary generator, video/
docs/plan.md                the product plan and its revision history
```

Import boundaries are enforced by ESLint (`.eslintrc.json`, generated by
`npm run medreport:eslint-boundary`): the module never imports the sandbox, the app or the UI
primitives directly; the sandbox never imports the module; browser-safe folders never import
server-only code. Only `src/app` touches both sides.

## Run locally

Requires **Node 22** (`.nvmrc`; Node 20.6+ works) and npm.

```bash
git clone git@github.com:appstackx/clinforms.git
cd clinforms
npm ci
cp .env.example .env.local     # optional – leave everything empty for demo mode
npm run dev                    # http://localhost:3000 → /reports
```

With no environment variables the app runs in **demo mode**: no AI calls, prepared drafts and form
maps for the fictional data (clearly badged), and fixed public demo secrets. That is enough for the
whole demo flow.

Production build:

```bash
npm run build
PORT=3000 MEDREPORT_AI_MODE=demo npm run start
```

Set `PORT` when you run `next start`: the server calls the simulated TM3 API on its own loopback port
(`http://127.0.0.1:$PORT`) and falls back to in-process calls when that is not possible.

**Word → PDF copies** of completed Word forms need LibreOffice (`soffice`) on the server. Without it
the app offers the Word file and `/render?format=pdf` answers 503 `PDF_CONVERSION_UNAVAILABLE`. On
macOS/Linux install LibreOffice, or point `MEDREPORT_SOFFICE_PATH` at the binary.

## Environment variables

All are server-side (never `NEXT_PUBLIC_`). The annotated list is [`.env.example`](.env.example);
copy it to `.env.local` (gitignored – never commit real values).

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Live drafting and live form analysis. Without it the app runs in demo mode |
| `MEDREPORT_MODEL` | Optional model override (allow-list in `config.server.ts`; default `claude-sonnet-5-5`) |
| `MEDREPORT_AI_MODE` | `auto` (default), `demo` or `live`. Live needs the key **and** the passcode |
| `MEDREPORT_LIVE_PASSCODE` | Presenter passcode that allows live calls (16+ random characters; rotate after demos) |
| `MEDREPORT_LAUNCH_SECRET` | HMAC secret for launch and session tokens |
| `MEDREPORT_SIGNING_SECRET` | HMAC secret for approval receipts, form-map confirmations and filed-document tokens |
| `MEDREPORT_ALLOW_DEMO_SECRETS` | `1` lets a production deployment use the public demo secrets. Not recommended |
| `MEDREPORT_PARTNER_KEY` | Partner key the clinic system sends on `POST /api/reports/v1/launch` |
| `TM3_SIM_TOKEN` | Bearer token for the simulated TM3 API |
| `TM3_SIM_BASE_URL` | Optional base URL of the simulated TM3 API (default: this server's own origin) |
| `MEDREPORT_SOFFICE_PATH` | Optional path to LibreOffice for Word → PDF |

In demo mode, unset secrets fall back to fixed public demo constants – except the launch and signing
secrets on a **Vercel production** deployment (`VERCEL_ENV=production`), where they are derived from a
server-only secret or the request fails. Details: `src/modules/medreport/README.md` → "Environment
variables".

## Tests and checks

```bash
npx tsc --noEmit          # or: npm run typecheck
npm run lint              # includes the import-boundary rules
npm run test:medreport    # node:test over src/modules/medreport/**/*.test.ts and scripts/medreport/**/*.test.ts
npm run build
```

`test:medreport` loads `scripts/medreport/test-setup.mjs` (maps `server-only` to an empty module) and
runs the TypeScript tests with `tsx` – 243 tests, no network, no API key needed.

Other scripts (run with `node --env-file=.env.local --import ./scripts/medreport/test-setup.mjs --import tsx <script>`
unless noted):

| Script | Purpose |
|---|---|
| `npm run medreport:templates` | Rebuild the built-in Word templates (`templates/generated/*.docx.b64.ts`) |
| `npm run medreport:forms` | Rebuild the bundled fictional referrer forms; then re-record analyses and drafts |
| `npm run medreport:eslint-boundary` | Regenerate the ESLint import boundary in `.eslintrc.json` |
| `scripts/medreport/record-form-analyses.ts` | Record live analyses of the sample forms (needs the API key) |
| `scripts/medreport/record-demo-drafts.ts` | Record the demo drafts (needs the API key) |
| `scripts/medreport/stamp-demo-drafts.ts` | Re-stamp demo drafts after a fixture change |
| `scripts/medreport/build-notes-pdf.ts`, `build-prewritten-drafts.ts`, `render-form-samples.ts` | Sample builders |
| `scripts/medreport/video/record-demo.mjs` | Records the walkthrough video against a running server (Playwright from `NODE_PATH=$(npm root -g)`, ffmpeg); see its README |

## Deploying

### Vercel (recommended for the app)

- **Project:** import `appstackx/clinforms` into Vercel (framework preset Next.js, default build
  command, Node 22). Production branch: `main`.
- **Domains:** add `clinforms.co.uk` as the production domain (and `www.clinforms.co.uk`), and point
  `clinforms.com` / `www.clinforms.com` at it as redirects, in the project's Domains settings; then set
  the DNS records Vercel shows at the registrar. `/` redirects to `/reports`, so
  `https://clinforms.co.uk` opens the Studio.
- **Region:** `vercel.json` pins functions to London (`"regions": ["lhr1"]`), so patient data is
  processed in the UK. Also choose a UK/EU region for anything else you attach.
- **Environment variables:** set them for Production (and Preview) in the project settings. For
  production set real, random values for `MEDREPORT_LAUNCH_SECRET`, `MEDREPORT_SIGNING_SECRET`,
  `MEDREPORT_PARTNER_KEY` and `TM3_SIM_TOKEN`; add `ANTHROPIC_API_KEY` (a spend-limited workspace) and
  `MEDREPORT_LIVE_PASSCODE` only if live drafting should be available. Never set
  `MEDREPORT_ALLOW_DEMO_SECRETS` in production.
- **Limits that are already designed in:** request bodies up to 4.5 MB (form files are capped at
  2.5 MB, form requests at 4.4 MB); the drafting, analysis, fill-preview and render routes declare
  `maxDuration = 60`; all API routes run on the Node.js runtime.
- **Deployment protection:** if it is on, enable "Protection Bypass for Automation" so the server can
  call its own simulated TM3 API (`VERCEL_AUTOMATION_BYPASS_SECRET`); otherwise it falls back to
  in-process calls automatically.
- **Word → PDF:** Vercel functions cannot run LibreOffice, so completed Word forms are offered as Word
  and the PDF copy answers 503 `PDF_CONVERSION_UNAVAILABLE` ("download Word"). For PDF copies, run a
  separate converter (LibreOffice in a container on a UK host, patched, without outbound network
  access) and call it from `src/modules/medreport/forms/convert.ts`. Fillable/flat PDF forms are
  filled in-process with pdf-lib and need no converter.

### Cloudflare (Workers via OpenNext) – possible, with constraints

A Next.js App Router app can run on Cloudflare Workers with the OpenNext adapter
(`@opennextjs/cloudflare`, `nodejs_compat`). It has not been tried with this app, and these points
need work or acceptance first (limits as known at the time of writing – check the current ones):

- **No LibreOffice / `child_process`.** Word → PDF degrades exactly as on Vercel (503, "download
  Word"); a separate converter is still needed.
- **Bundle size.** The whole server goes into one Worker (3 MB compressed on the free plan, 10 MB on
  paid). This app bundles pdfjs-dist (legacy build, server-side PDF reading), @react-pdf/renderer, the
  DejaVu fonts, the built-in templates and the sample forms as base64 – measure the OpenNext output
  before committing to it.
- **WebAssembly.** Workers refuse to compile WebAssembly from bytes at runtime. @react-pdf/renderer's
  layout engine (yoga-layout 3) does exactly that from an embedded base64 module, so PDF rendering of
  the built-in templates would need a patch or a different renderer.
- **Temp-file font registration.** `src/modules/medreport/docgen/pdf/fonts.ts` writes the DejaVu fonts
  to `os.tmpdir()` and registers them by path; Workers have no persistent writable disk, so fonts
  would have to be registered from memory.
- **CPU and memory.** Form filling and PDF rendering are CPU-heavy: the free plan's 10 ms CPU per
  request is not enough (paid plans allow 30 s by default); each isolate has 128 MB of memory.
- **Production secrets.** The "never use the public demo secrets in production" rule keys off
  `VERCEL_ENV=production`; on Cloudflare set `MEDREPORT_LAUNCH_SECRET` and `MEDREPORT_SIGNING_SECRET`
  explicitly (as Worker secrets).
- **Next.js version.** Check which Next.js versions the adapter currently supports; an upgrade from
  Next 14 may be required.
- In-memory limits (live-call rate, passcode guesses, single-use launch tokens) are per instance on
  any serverless host; on Workers that means per isolate.

**Recommendation:** host the app on Vercel in `lhr1` (or as a container – `next start` – on a UK
host, where LibreOffice can be installed alongside it). Cloudflare is a reasonable later option for the
API edge or static assets once the points above are addressed.

## Renaming the product

The product was renamed from "AppStackX Reports" to **ClinForms** on 09/10/2026. To rename it again,
change `PRODUCT` (`name`, `shortName`, `tagline`) in `src/modules/medreport/config.public.ts`; every
screen, page title and link preview, document property, download name, error message, the health
endpoint and the sandbox's "Connected apps" card read it from there. Then update this README,
`package.json` `name`, the repository name, and the literal `PRODUCT_NAME` / overlay text in
`scripts/medreport/video/record-demo.mjs` (the injected overlay cannot import the config).

Internal identifiers keep the earlier name on purpose, because changing them would break saved files,
tokens and browser data:

- import/export format IDs (`appstackx-reports.import`, `appstackx-reports.case`) and the recorded
  data formats (`appstackx-reports.demo-draft`, `appstackx-reports.form-analysis`);
- HMAC derivation labels (`appstackx-reports:<purpose>:v1`) and the public demo secret constants in
  `config.server.ts`;
- the `Bearer realm="appstackx-reports"` value of the Report API's `WWW-Authenticate` header;
- the font cache folder name (`appstackx-reports-fonts-v1` in the server's temp directory);
- storage keys (`medreport.`), the module folder name and the API paths (`/api/reports/v1`).

The bundled fictional referrer forms (`build-demo-forms.mjs`) still carry "AppStackX Reports" in their
hidden document properties: their recorded analyses and demo drafts are keyed to each file's SHA-256,
so rebuilding them means re-recording those. Leave them unless that is worth it. The built-in Word
templates and the sample printed-notes PDF were rebuilt with the new name (their bytes are not keyed).

## Provenance

Extracted from careconnect-mk at `ff05fab` (branch `claude/confident-noether-z6l7kr`), where it lived
as a module next to an unrelated patient-portal demo. Brought over: `src/modules/medreport`,
`src/sandbox/tm3-sim`, the `/reports`, `/pms-sandbox` and API routes, the UI primitives the module
re-exports, `scripts/medreport`, `.env.example` and the plan (`docs/plan.md`, history kept). Left
behind: the portal (landing page, login, dashboard, mock data, its components and assets) and its root
layout with the portfolio banner. Changes made on extraction: a new root layout, `/` redirect and
not-found page; the banner offset removed from the layouts, the Studio's sticky header and the sticky
side panels; Inter self-hosted through next/font instead of a Google Fonts import; the hard-coded
product name replaced by `PRODUCT.name`; dependencies trimmed to what the code imports (same versions
as the source lockfile for every direct dependency).
