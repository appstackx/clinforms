# ClinForms – product and technical deep dive

**Also called:** AppStackX Reports (old name, 06–09/10/2026), "the module", `medreport` (code).
**Repo:** `github.com/appstackx/clinforms` (private), branch `main`. Head at hand-off: `7f6fcf8` (2026-10-09 15:48 UTC) on top of `e799c51` (15:07 UTC, 363 files).
**Status (2026-10-09):** demo-grade, fully verified, **not deployed**. Tagline: "Complete every referrer's own report form from your clinic notes".

Authoritative technical references in the repo (don't duplicate – read them):
- `src/modules/medreport/README.md` – folder map, import rules, conventions/gotchas, env vars, "Model and effort" sweep tables, Report API, sim API, connector interface, Revision 2 (forms), Revision 3 (security/product fixes), demo data.
- `docs/plan.md` – the original approved plan (06/10) + "Revision 2 – referrer forms" (Dell's five questions → answers). Original also in `memory/sources/report-builder-plan.md`.
- Root `README.md` – demo flow URLs, run locally, env vars, Vercel + Cloudflare deploy notes, renaming.

## 1. What it does (one paragraph)
Completes each referrer's **own** report form – MLC, insurer, solicitor, case manager, employer – **in its original layout** (Word in → Word out; fillable PDF in → filled, flattened PDF out; flat PDF best effort) from a physio clinic's registration details and treatment notes (TM3 for Blue Heart; simulated in the demo). Facts are filled by code; narrative answers are drafted from the notes with note citations; opinions (prognosis, restrictions, fitness for work) are only used if a clinician recorded them, otherwise left blank as a gap. Validators block approval on unsupported text. The treating physio reviews question by question and approves (server HMAC-signed `SignReceipt`); the final file is filed back to the (simulated) clinic record. **The Report API (`/api/reports/v1`) is the product; the Studio (`/reports`) is the first app on it; inside TM3 only a launch button is needed** (how Heidi plugs in).

## 2. Why it exists (origin)
- 06/10 09:21 UTC – Dell Baines asked for Word/PDF medico-legal/company reports from TM3 data. CareConnect couldn't do it → new build.
- 06/10 12:02 – Khuram: build it inside careconnect "so we can sell it as seperate module", TM3 end-to-end, UI or API? Plan first.
- 06/10 12:31 – plan: both UI and API (approved 13:58 "yes build").
- 06/10 15:21 – Dell's second email: complete **each referrer's own form** → pivot approved 16:10 ("yes restart"); rebuilt 16:16–20:39 (commit `08a0aac` in careconnect-mk).
- 09/10 – switched AI to Sonnet 5.5, made Dell's video, extracted to own repo, renamed ClinForms (14:34), pushed.
- Second prospect RED Physiotherapy (insurer forms) on 09/10 → "one product, two sets of forms: MLC/medico-legal and insurer".

## 3. Flow as built
1. **Forms library** (`/reports/forms`; `POST /forms/analyse`): upload .docx/PDF → outline by code → Claude proposes a `FormDefinition` (each question: label, section, answer type, **anchor** = where the answer goes, **fill source** = `registration` | `computed_fact` | `notes_narrative` | `clinician_opinion` | `signoff` | `leave_blank`). Staff check/confirm at `/reports/forms/[formId]` → `POST /forms/confirm` → server attests the map (HMAC, bound to the file SHA-256). Reused for every patient. Filled forms get patient details masked before analysis. Demo mode with an unknown upload uses `rules-1` (no AI, low confidence).
2. **Create** (`/reports/new`): source = launch from simulated TM3, patient picker, uploaded export (JSON/CSV/pasted text in our documented format) or printed-notes PDF; pick the referrer form. Registration/computed answers filled by code.
3. **Draft** (`POST /drafts`): groups of ≤4 fields per call (forms) / ≤2 sections (built-in templates), concurrency 2. Every paragraph cites `REG` / `N-…` / `FACT-…`. Abbreviations written out; `[CLAIMANT]` swapped back by code.
4. **Validators** (same code server + browser): `UNCITED_PARAGRAPH`, `FIGURE_NOT_IN_SOURCE`, `OPINION_LANGUAGE`, `TERM_NOT_IN_SOURCE`, `SCOPE_TERM`, `MISSING_PLACEHOLDER`, `OPEN_GAP`, data checks (no pre-incident history, DNA without reason, multiple clinicians…). Known limit: a paraphrase error citing a valid note is not caught – clinician review is the safeguard.
5. **Review/approve** (`/reports/[id]`): citation chips → source note, gaps, live DRAFT preview in the original layout, "Write in my own voice", approval with name + HCPC + typed signature + 4 attestations → `POST /sign` → `SignReceipt`. "Create amended version" → v2.
6. **Render** (`POST /render?format=original|pdf`): final only with a valid receipt, matching content hash, no blocking flags and the approved map; else DRAFT.
7. **File back** (`POST /connectors/{id}/documents`): sim returns 201 and stores nothing; document kept in the browser (sandbox Documents tab).
8. **Batch** (`/reports/batch`).

UI routes: `/` (307 → `/reports`), `/reports`, `/reports/forms`, `/reports/forms/[formId]`, `/reports/new`, `/reports/[id]`, `/reports/batch`, `/reports/security`, `/reports/templates`, `/pms-sandbox`, `/pms-sandbox/patients/[id]`. API: 30 route files (23 Report API + 7 simulated TM3). Full tables: module README.

## 4. Stack (verified 09/10)
Node **22** (`.nvmrc`; pdfjs-dist 6 needs ≥22.13), next **14.2.35** (App Router), react 18.3.1, TypeScript 5.9, Tailwind 3.4, shadcn-style Radix primitives, zod **4.6.5**, `@anthropic-ai/sdk` **0.131.0**, docxtemplater 3.71.0 + pizzip 3.3.0, `@react-pdf/renderer` 4.9.0 (DejaVu fonts written to tmp), `@xmldom/xmldom` 0.9.12, `pdf-lib` 1.17.1, `pdfjs-dist` 6.4.299, `docx-preview` 0.4.1; dev `docx` 9.8.1, `tsx` 4.23.15. `vercel.json` = `{"regions":["lhr1"]}`. Studio colour teal `#0D9488`.
**Gotcha:** `tsconfig.json` has no `target` → never spread / `for…of` a Set/Map/typed array (TS2802); use `Array.from`.
**Gotcha:** never `workerSrc = new URL(…, import.meta.url)` for pdfjs (breaks Next 14 build); use the recipe in `ui/preview-libs.ts`.

## 5. Where state lives (demo-grade)
Server is **stateless, no database**. Browser: reports `medreport.report.<id>` (localStorage), forms maps `medreport.forms`, form files in IndexedDB `medreport-forms`, passcode in sessionStorage, sandbox filed documents `tm3sim.documents` + IndexedDB. Single tenant `demo` (`tenantId` already in every type/token). In-memory per instance: live-call rate limiter (6/min), passcode-failure counters (5/client, 30/instance per 10 min), launch-token `jti`s.

## 6. AI configuration
- Default model **`claude-sonnet-5-5`** (`DEFAULT_AI_MODEL`, `config.server.ts`); override `MEDREPORT_MODEL` from `AI_MODEL_ALLOW_LIST`: `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-5-5`, `claude-opus-4-8`. Fable 5.1 excluded (30-day retention, ~5× price). Re-run the effort sweep before switching.
- Effort: analysis **low** (`DEFAULT_ANALYSIS_EFFORT`), drafting **medium** (`DEFAULT_LIVE_EFFORT`) – always explicit (Sonnet 5.5 API default is high).
- Prompt versions (code is authoritative): drafting forms **`forms-7`**, form analysis **`form-analysis-3`**, built-in templates **`"2"`**, rules analysis `rules-1`. (The in-chat summary said forms-6 – stale.) Bump the version on any prompt/input change, then re-record demo data.
- Request: `client.beta.messages.parse` + `betaZodOutputFormat`; `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`; `max_tokens` 16000; **no `thinking` param**, no temperature, no prefill, no API Citations (our own `sourceIds` instead); `cache_control` on system / episode / outline blocks; SDK timeout 50 s (`LIVE_TIMEOUT_MS`), routes `maxDuration = 60`; `maxRetries: 0`. `ai/claude.ts` is the only file that calls Claude.
- Cost measured 09/10: completed form **$0.10–0.12** on Sonnet (Opus was $0.23–0.26), ~2× faster; reading a new form **$0.08–0.14** once; ~**$15/month** at 125 forms. Testing spend ~$6 reported (closer to ~$10 on 09/10 – unverified).
- Customer-visible engine name is `publicEngineName()` = `"drafting-service"`; real model only in server logs.

## 7. Demo data (all fictional)
- Clinic **Riverside Physiotherapy (fictional)**, Milton Keynes. Clinicians **Sarah Reid** `PH-DEMO-01`, **Tom Ellis** `PH-DEMO-02`.
- **Megan Hart** `sim-pat-001` (RTA/WAD II, solicitor Harrow & Pike ref `HP/RTA/2291`; prognosis not recorded = planted gap). **Daniel Brooks** `sim-pat-002` (lifting injury, employer Ashby Freight ref `AF-OH-0457`; qualified phased-return opinion). `sim-pat-003…005` registration only. **Priya Nair** = file-import sample.
- Bundled referrer forms (`forms/samples/registry.ts`): (a) Harrow & Pike MLC Word (22 q), (b) Northfield Assurance fillable PDF (23 q), (c) Kingsway case-manager Word (22 q), (d) Meridian Claims Word (17 q, the live "new form" upload), flat-PDF Ashcroft (pre-written map). File SHA-256s in `forms/samples/generated/manifest.ts`; **maps, recorded analyses and drafts are keyed to these bytes**.
- Recorded data: `ai/recorded/forms/*.json` (4 Sonnet analyses), `ai/demo-drafts/*.json` (5 form pairs + 2 built-in templates on Sonnet + Ashcroft pre-written). Recordings are third person ("Write in my own voice" offered); live drafts are first person.

## 8. Live-demo gotchas (from live tests)
- Wording, paragraph counts and number of items to resolve vary run to run – never script exact text/counts.
- A live Meridian analysis names the referrer just "Meridian" and classes it MLC – type the referrer in the upload dialog's optional Referrer field.
- Analysing a form + completing one ≈ 5 live calls → allow ~60 s before the next live form (6 calls/min/instance). The Studio auto-retries 429s (5 × 12 s); the review screen's "Draft them now" does not.
- Kingsway Q4/Q5 are left blank → presenter ticks Q4 "No", Q5 "Yes, with the adjustments below".
- Sonnet is stricter on opinion questions (Northfield ~10 items to resolve, H&P ~6).
- Timings (Sonnet live): Meridian analysis ~12 s; Megan → H&P ~12 s click-to-review; demo mode whole form 2.6–3.6 s.
- A Word→PDF copy needs LibreOffice locally (`brew install --cask libreoffice` on Mac; path `/Applications/LibreOffice.app/Contents/MacOS/soffice` is already a candidate). On Vercel it returns 503 `PDF_CONVERSION_UNAVAILABLE` ("download Word").

## 9. Limits and caveats (state openly to prospects)
1. Forms are fictional look-alikes; no real MLC/insurer form tested yet.
2. Flat/scanned PDFs are best effort; scanned forms are the biggest risk; scanned notes PDFs are refused (no OCR).
3. TM3 is simulated; "no duplication" today = TM3 export + one upload. A direct link depends on TM3 granting partner access to clinical notes (unconfirmed).
4. GDPR measures are commitments, not built (see `memory/context/compliance.md`).
5. No login; single `demo` tenant; audit trail in the browser.
6. Word→PDF needs a converter service in production.
7. Portal-based insurers (Vitality, WPA, domestic AXA Health likely) – ClinForms fills documents; it does not submit into portals (offer copy-ready answers).
8. PDF fills use standard Helvetica (WinAnsi) – characters like "→", "≥" are reported, not printed (`@pdf-lib/fontkit` not installed).
Size caps: `MAX_FORM_FILE_BYTES` = **2.5 MB** (module README says 3 MB – stale), `MAX_FORM_REQUEST_BYTES` 4,400,000, `MAX_TEMPLATE_DOCX_BYTES` 3 MB.

## 10. Known code/doc gaps
- Sandbox tests (26) are not in the `test:medreport` glob (run separately).
- The 42-step Playwright E2E suite and the model/effort sweep script lived only in the cloud scratchpad – **not in git** (lost). Rebuild an E2E suite under `scripts/medreport/e2e/` when needed.
- No CSP (needs nonces), passcode length not enforced, no Unicode font in PDF fills, no OCR.
- Production-secret rule only recognises Vercel (`VERCEL_ENV=production`).
- `LIVE_TIMEOUT_MS` 50 s assumes `maxDuration` 60.
- No remote converter support (`MEDREPORT_CONVERTER_URL` does not exist yet).
- Video recorder (`scripts/medreport/video/record-demo.mjs`) now outputs ClinForms branding but has not been re-run since the rename.

## 11. Roadmap (agreed direction, not started)
Hosting on Vercel Pro London; Supabase London pooled multi-tenant with RLS; auth + 2FA + roles; Word→PDF converter (Gotenberg/LibreOffice, UK); shared library of ready-mapped insurer forms ("a Bupa or Aviva form mapped once works for every clinic" – the moat); Stripe billing + usage metering; mapping Dell's real TM3 export; real TM3 connector only if TM3 allows; other PMS (Cliniko); OpenAPI spec; gold-case regression set on every prompt change; compliance pack. Estimate: **~3–5 weeks** to pilot-ready once a clinic commits (assistant, 09/10 13:52). Prompts in `memory/next-steps.md`.
