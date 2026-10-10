# ClinForms (`src/modules/medreport`)

Completes each referrer's OWN report form (MLC, insurer, solicitor, case manager, employer) in its
ORIGINAL layout, from the clinic system's registration details and the physiotherapy notes. Every
answer carries the IDs of its sources. The treating physiotherapist reviews it question by question,
fills the gaps, adds or confirms their opinion and approves it. The output is the referrer's own Word
file (or fillable PDF) with the answers written in, plus a PDF copy. Our built-in report templates
remain as the fallback when a referrer sends no form. See "Revision 2 – referrer forms" below.

- **Product name:** set once in `config.public.ts` (`PRODUCT.name = "ClinForms"`).
- **The API is the product.** `/api/reports/v1` is what a clinic system (TM3) connects to. The Studio
  UI at `/reports` is the first app built on it.
- **Demo scaffolding, not the product:** the simulated clinic system at `/pms-sandbox` and
  `/api/tm3-sim/v1` (`src/sandbox/tm3-sim`). It is always labelled
  "Simulated TM3 sandbox – demo data, not affiliated with TM3".
- **Fictional data only.** Organisations end with "(fictional)" – the one exception is the insurer on the
  private medical insurance demo patient's record (Bupa), named only so its public form can be filled,
  with fake numbers (see "Demo data"). HCPC numbers use the invalid demo format `PH-DEMO-01`. Reports are
  stored in the browser only (demo-grade).
- **Standalone app.** This module, the sandbox and their thin `src/app` routes are the Studio and its
  demo (`/` is now the public website in `src/app/(marketing)`; the Studio demo stays at `/reports`).
  It was extracted from its original host repo (see the root `README.md`); the host design system is
  only `src/components/ui/*` and `src/lib/utils.ts` (reached through `ui/primitives.ts`).

The full plan is in [`docs/plan.md`](../../../docs/plan.md) (written while the module lived in its
original host repo; its history notes are kept as they were).

## Folder map

```
src/modules/medreport/
  config.public.ts        PRODUCT, DEMO_TENANT_ID, DEMO_CLINIC, NOTICES, limits (no env; browser-safe)
  config.server.ts        server-only: resolveAiMode(), liveAiAvailable(), getSecret(), aiModel() (MEDREPORT_MODEL)
  core/                   pure TS + zod; shared by server and browser
    schemas.ts types.ts   THE contract (zod v4 source of truth + inferred types)
    dates.ts ids.ts labels.ts                 shared helpers (DD/MM/YYYY, N-001, UI labels)
    fingerprint.ts        canonical JSON + SHA-256 (WebCrypto)
    report-factory.ts     createReport, createFormReport, planDraftGroups, applyDraftResult, appendActivity
    forms.ts              referrer forms: formToTemplate, answers, registration values, block IDs (pure)
    form-record-rules.ts  fixed answers, insurer-identifier and same-kind referral-reference rules (pure)
    form-tables.ts        table answers ("rows"): the appointments table filled by code, row helpers (pure)
    question-set.ts       portal question sets (FormKind "questions"): parse pasted questions, classify, placeholder file
    answer-copy.ts        "Copy answers" text (one answer, all answers, .txt) shared with the question-set summary PDF
    parties.ts            who completes which part of a form ("to be completed by the policyholder", "Therapist's declaration")
    voice.ts              first-person rewrite, note shorthand expansion, job-title casing (pure)
    computed-facts.ts     FACT-attendance / -age / -episode / -outcomes-*
    scope.ts              template scope: strip fields before drafting
    validation/           citations, figures, opinion-language, scope-terms, data-checks, index (canSign)
  connectors/             server-only
    types.ts registry.ts  ClinicSystemConnector, ConnectorContext, TraceEntry, ConnectorError
    tm3-sim/              wire.ts (sim wire schemas), client.ts, mapper.ts, connector.ts
    file-import/          format.ts, parser.ts, connector.ts   (our documented JSON/CSV/text format)
                          pdf-notes.ts                          (printed notes PDF → the text format)
                          general-notes.ts docx-notes.ts        (wave 3: ordinary clinic notes in any layout → NotesReview)
                          review-contract.ts review-bundle.ts   (wave 3: the review staff check; checked review → bundle)
    tm3/connector.ts      real TM3 placeholder: not_configured
  auth/                   server-only: hmac-token, launch-token, session-token, sign-receipt, passcode,
                          attestations (form-map confirmations, filed-document tokens)
  ai/                     server-only
    claude.ts live-gate.ts            Anthropic client + SDK error mapping; live/demo gate (passcode, rate cap)
    prompts.ts form-prompts.ts        frozen system prompts: built-in templates ("2") and referrer forms ("forms-7")
    form-redact.ts bundle-fingerprint.ts   patient details masked before form analysis; record fingerprint for demo drafts
    generate.ts draft-live.ts draft-demo.ts assemble.ts   drafting entry, live call, demo/recorded lookup, assembly
    demo-format.ts demo-drafts/*.json  recorded drafts: {patientId}__{templateId}.json, {patientId}__form-{sampleId}.json
    analyse-form.ts                   form analysis entry: stored map (recorded / pre-written) → live Claude → rules
                                      (prompt "form-analysis-4" in form-analysis.ts; rules reader "rules-2")
    form-analysis.ts form-analysis-schema.ts form-outline.ts form-classify.ts form-postvalidate.ts form-rules.ts
    pdf-groups.ts                     option-box groups and one-character date boxes for the analysis
    form-boxes.ts form-tables.ts      flat-PDF printed boxes → questions / snapping; table-of-fields → one table question
    recorded-forms.ts recorded/forms/*.json   recorded Claude analyses of the sample forms (by file SHA-256)
    demo-assets.ts                    DEV/DEMO ONLY: local demonstration forms' maps and answers (MEDREPORT_DEMO_ASSETS_DIR)
  templates/              built-in FALLBACK templates: registry.ts (+ extensions.ts), generated/*.docx.b64.ts
  docgen/                 server-only: built-in template rendering – view-model, docx, docx-validate, pdf, pdf/*
                          (+ question-summary.ts: the PDF summary of a portal question set)
  forms/                  server-only: the referrer-form engine
    file.ts               decodeFormFile (type from bytes, size cap, SHA-256), assertFormFileMatches
    docx-dom.ts           one shared walk of the Word XML, so a block ID means the same place to outline and fill
    docx-outline.ts       buildDocxOutline(buf) → {blocks: OutlineBlock[], warnings}
    docx-fill.ts          fillDocx(buf, form, answers, opts) → Buffer (Word in → Word out; DRAFT banner, review markers)
    pdf-outline.ts        readPdfForm(buf) → PdfFormOutline + classification (acroform | flat) + warnings
    pdf-sections.ts       section heading + completedBy party for every PDF field and text item (hooked into readPdfForm)
    pdf-widgets.ts        printed label beside each radio / tick-box widget; runs of one-character boxes
    pdf-boxes.ts          flat PDFs: printed answer boxes and tick boxes read from the page drawing
    pdf-fill.ts           fillPdf(buf, form, answers, opts) → Promise<Uint8Array> (shrink to fit, continuation sheet, flatten)
    pdf-acro-fill.ts      AcroForm answers: ticks per widget, radio labels, option fields, character limits, inherited /DA
    pdf-table.ts pdf-overlay-marks.ts   tables of fields / flat tables; X marks in flat tick boxes, date slots
    render-form.ts        shared rendering steps, review markers, the warnings header and file names
    demo-notice.ts        demonstration footer (FormDefinition.demoNotice) on every page: PDF bottom margin, Word footer
    pdfjs.ts              loadPdfjs() – pdfjs-dist legacy build for Node (fake worker)
    convert.ts            docxToPdf(buf) via LibreOffice where installed (hardened, max 2 at a time), else null
    zip-guard.ts          zip-bomb and PDF stream limits, checked before any file is opened
    pdf-blank.ts          blank a filled PDF form's values before analysis
    types.ts              FillOptions, PdfFillOptions
    samples/registry.ts   bundled fictional referrer forms, findSampleBySha256()
    samples/maps/*.ts     pre-confirmed maps of forms a–c (common, harrow-pike, northfield, kingsway);
                          ashcroft.ts = the flat PDF's pre-written map (offered on upload, not seeded)
    samples/generated/    *.b64.ts files + manifest.ts (SHA-256 of each file), from build-demo-forms.mjs
  api/                    contract.ts (browser-safe), http.ts, deps.ts, resolve-template.ts, handlers/*.ts (server-only)
                          store-contract.ts (browser-safe), store-port.ts (TenantStore), store-memory.ts (tests)
  ui/                     primitives.ts, store.ts, api-client.ts, host-hooks.tsx, preview-libs.ts, components/*, screens/*
                          store/* (browser backend, server cache + write queue + transport)
                          routes.ts (useStudioPaths: every Studio link from HostHooks.basePath), studio-copy.ts (tenant-only
                          production copy), studio-events.ts (non-identifying analytics properties for HostHooks.track)
src/sandbox/tm3-sim/      config, wire-types (duplicated wire format), fixtures/, handlers, client-store, ui/
src/app/api/_medreport-glue.ts      connector registry + in-process transport + route() binder
src/app/reports/medreport-host.tsx  client-side HostHooks (write-back into the sandbox's browser record)
src/app/app/studio/tenant-host.tsx  client-side HostHooks of a clinic's own Studio (tenant mode, wave 2)
src/app/api/reports/v1/**/route.ts  thin: runtime="nodejs", dynamic="force-dynamic", export METHOD = route(handler)
src/app/api/tm3-sim/v1/**/route.ts  thin: re-export the sandbox handler
src/app/reports/**  src/app/pms-sandbox/**   thin pages; each layout.tsx has its own metadata
scripts/medreport/        build-templates.mjs, build-demo-forms.mjs, record-demo-drafts.ts, record-form-analyses.ts,
                          render-form-samples.ts, form-sample-answers.ts, form-fixtures.ts,
                          gen-eslint-boundary.mjs, test-setup.mjs, dev-bundles.ts, stamp-demo-drafts.ts,
                          build-notes-pdf.ts, build-prewritten-drafts.ts,
                          check-demo-assets.ts + demo-assets-check.ts (npm run demo:check), demo-draft-checks.ts,
                          demo-red.mjs (npm run demo:red)
```

## Import rules (enforced by ESLint `no-restricted-imports` in `.eslintrc.json`)

The rules are generated by `node scripts/medreport/gen-eslint-boundary.mjs`. Overrides replace a rule's
options rather than merging them, so the script writes one full pattern list per file depth.

- **The module may import** its own files, zod, docxtemplater, pizzip, @react-pdf/renderer,
  @anthropic-ai/sdk, react, next and lucide-react, plus (Revision 2)
  @xmldom/xmldom@0.9.12, pdf-lib@1.17.1, pdfjs-dist@6.4.299 and docx-preview@0.4.1 under the rules below.
- **Form libraries:** @xmldom/xmldom and pdf-lib are server-side (forms are read and filled in `forms/`).
  docx-preview and pdfjs-dist are the browser previews and may be imported **only in `ui/`**: use
  `ui/preview-libs.ts` (`loadDocxPreview()`, `loadPdfjsBrowser()`), never a `workerSrc` built with
  `new URL(…, import.meta.url)` (Next 14's Terser step fails on it). `forms/` may import pdfjs-dist's
  **legacy** build only, through `forms/pdfjs.ts` `loadPdfjs()`.
- **Host UI only through `ui/primitives.ts`.** It re-exports Button, Card\*, Badge, Input, Tabs\*,
  Dialog\*, Tooltip\*, Separator, Skeleton and Avatar\* from `@/components/ui/*`, and `cn` from
  `@/lib/utils`. It is the only file allowed to import them.
- **The module may NOT import** `@/lib/*`, `@/components/*` (outside primitives), `@/sandbox/*`,
  `@/app/*`, `@/server/*`, `posthog-js` (product analytics is host code in `src/components/analytics`,
  passed in through `HostHooks`), or any relative path that leaves `src/modules/medreport`.
- **Browser-safe code** is everything in `core/`, `templates/` and `ui/`, plus `config.public.ts`,
  `api/contract.ts` and (wave 2) `api/store-contract.ts`. It may NOT import `server-only`, `node:*`, the Anthropic SDK, docx,
  docxtemplater, pizzip, react-pdf, @xmldom/xmldom or pdf-lib.
- **The sandbox may NOT import the module** (`@/modules/*`). It duplicates the wire types in
  `src/sandbox/tm3-sim/wire-types.ts`, and the two sides talk over HTTP.
- **Only `src/app` touches both.** That means `_medreport-glue.ts`, `reports/medreport-host.tsx`, and
  the route and page files.
- **Server-only folders start with `import "server-only"`.** These are `config.server.ts`,
  `connectors/`, `auth/`, `ai/`, `docgen/`, `forms/`, and `api/` except `contract.ts`. Import them
  from client code with `import type` only.

## Conventions and gotchas

- **TypeScript has no `target` here (ES5 downlevel).** Do not spread or `for…of` a `Set`, `Map` or
  typed array. Use `Array.from(...)`. tsc fails with TS2802 otherwise.
- **Dates:** ISO `YYYY-MM-DD` in data and `DD/MM/YYYY` on screen and in documents
  (`core/dates.ts`). UK English everywhere.
- **Citable IDs:** `REG`, `N-001`… (notes, assigned by the mapper in date and time order), and
  `FACT-attendance`, `FACT-age`, `FACT-episode`, `FACT-outcomes-<NDI|ODI|NPRS|PSFS|QuickDASH>`.
- **Paragraph origins:** `ai`, `edited`, `clinician` and `from_records`. Only `ai` and `edited` need
  citations.
- **Form field IDs** are `F-01`, `F-02`… (document order). In a form report they are also the section
  keys (`SectionKeySchema` accepts `lower_snake_case` or `F-\d{2,}`), so gaps and flags point at them.
- **Errors:** `application/problem+json` `{type, title, status, detail, code}` (`api/http.ts`
  `problem()`). Bodies are checked with `parseBody(req, Schema)`: invalid JSON returns 400 and a schema
  mismatch returns 422.
- **Logs:** use `logEvent()` with IDs, timings and token counts only. Never log note text, names or
  secrets.
- **Studio colour:** teal `#0D9488`. **Sandbox colours:** slate and blue, never amber, and no TM3
  branding.
- **Sticky offsets:** the Studio header is `sticky top-0` (57 px from `lg`); the review screen's side
  panels sit below it at `top-[4.25rem]` and the form-mapping preview at `lg:top-[96px]`. There is no
  banner above the app (the host repo's banner offset `pt-10 sm:pt-9` was removed on extraction).
- **Customer-facing wording (owner decision):** everything a clinic can see or download – Studio text,
  tooltips, aria-labels, toasts, problem titles/details shown in the UI, the activity log, the Security
  & GDPR page, generated documents, the case export and the demo video – describes what the product
  does, never the technology or the vendor ("drafted from the notes", "reads the form and identifies
  each question and answer space", origin pill "Draft", "Live drafting" / "Demo mode"). All of it comes
  from `core/wording.ts` (`WORDING`, re-exported by `ui/wording.ts`); switch `DISCLOSURE` there
  (`"neutral"` default, `"ai-assisted"` kept for later). API responses the Studio stores or renders
  name the engine `publicEngineName()` (`"drafting-service"` while neutral); the real model id stays in
  server logs. Internal identifiers, prompts, logs, docs, tests and API field names are not governed by
  it. `scripts/medreport/neutral-wording.test.ts` guards it.
- **Case export file ("Export case JSON", format version 2):** the downloaded file holds the report in
  the public encoding of `core/case-export.ts` – origin/raisedBy `"ai"` → `"draft"`, section kind
  `"ai_narrative"` → `"narrative"`, generation
  `model` → `engine` (always the neutral engine name), `promptVersion` → `draftingVersion`,
  `stopReason` → `finish` (renamed values), legacy activity text rewritten. Import decodes it back to
  the stored Report exactly, so an approved report still re-hashes to its receipt's content fingerprint;
  version 1 files (the stored Report as is) still import.

## Environment variables (all server-side; see `.env.example`)

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Live drafting and live form analysis. Without it the deployment runs in demo mode |
| `MEDREPORT_MODEL` | Optional Claude model for the live calls. Default `claude-sonnet-5-5`; allowed: the allow-list in `config.server.ts` (`claude-sonnet-5-5`, `claude-opus-5-5`, `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-5-5`, `claude-opus-4-8`). Anything else is ignored with a `config.model_rejected` warning in the server log. See "Model and effort" |
| `MEDREPORT_AI_MODE` | `auto` (default), `demo` or `live`. Live needs both the key and the passcode |
| `MEDREPORT_LIVE_PASSCODE` | `x-medreport-passcode` for live calls (timing-safe compare, about 6 per minute per instance; 5 wrong guesses per client or 30 per instance in 10 minutes → 429 with `Retry-After`). Use 16+ random characters |
| `MEDREPORT_LAUNCH_SECRET` | HMAC secret for launch tokens (single use, `jti`) and session tokens |
| `MEDREPORT_SIGNING_SECRET` | HMAC secret for `SignReceipt.mac`; purpose-bound keys for form-map confirmations and filed-document tokens are derived from it (`signingKey(purpose)`) |
| `MEDREPORT_ALLOW_DEMO_SECRETS` | `1` lets a production deployment use the public demo constants for the two secrets above. Not recommended |
| `MEDREPORT_PARTNER_KEY` | `x-partner-key` for `POST /launch` (sent server-to-server by the sandbox) |
| `TM3_SIM_TOKEN` | Bearer token for `/api/tm3-sim/v1` |
| `TM3_SIM_BASE_URL` | Optional base URL of the simulated API. The default is this server's own origin (`VERCEL_URL` on Vercel, else `http://127.0.0.1:$PORT`), never the request's Host header |
| `MEDREPORT_SOFFICE_PATH` | Optional LibreOffice binary for Word → PDF copies of completed forms (`forms/convert.ts`). Default: the usual install paths; never on Vercel |
| `MEDREPORT_DEMO_ASSETS_DIR` | **Dev/demo only.** Folder (absolute, or relative to the working directory) of local demonstration forms – e.g. `demo-assets/insurers`, gitignored – with prepared maps and answers (`ai/demo-assets.ts`, see "Local demonstration forms"). Unset = off |
| `MEDREPORT_DEMO_ASSETS_ALLOW_PROD` | `1` lets a **local** production build (`next start`, as `npm run demo:red` runs) use `MEDREPORT_DEMO_ASSETS_DIR`. Without it the folder is ignored whenever `NODE_ENV` or `VERCEL_ENV` is `production`. Never set it on a deployment |

In demo AI mode, a missing launch secret, signing secret, partner key or sim token falls back to a
**fixed** public demo constant (`config.server.ts`; the sandbox duplicates two of them in
`src/sandbox/tm3-sim/config.ts`). It never falls back to a per-instance random value. Outside demo
mode, a missing secret throws. **Exception – production:** on a production deployment
(`VERCEL_ENV=production`) the launch and signing secrets never use the public constants: an unset one
is derived from a server-only secret the deployment already holds
(HMAC-SHA256 of `ANTHROPIC_API_KEY` or `VERCEL_AUTOMATION_BYPASS_SECRET`), and with neither the request
fails, unless `MEDREPORT_ALLOW_DEMO_SECRETS=1`. Previews and local runs are unchanged.

## Model and effort

**Model (owner decision, 09/10/2026): Claude Sonnet 5.5, `claude-sonnet-5-5`** ($2 / $10 per million
input / output tokens, cache reads $0.20 – half Claude Opus 5.5's $4 / $20). `config.server.ts`
`aiModel()` reads `MEDREPORT_MODEL` at call time, accepts only the allow-list `AI_MODEL_ALLOW_LIST`
(each id checked against this app's exact request on 09/10/2026; Claude Fable 5.1 is left out – it needs
30-day data retention and costs five times as much) and otherwise uses `DEFAULT_AI_MODEL`. The id is
internal: the Studio, the API fields it stores, exports and documents show `publicEngineName()`.

**Request rules for Claude Sonnet 5.5** (`ai/claude.ts`): adaptive thinking is on by default – never
send `thinking: {type: "disabled"}` (400) or a thinking budget; never send `temperature` / `top_p` /
`top_k`; no forced `tool_choice` (400); effort is always explicit, because the levels are
recalibrated and the API default is `high`; structured output (`output_config.format`) carries over;
`fallbacks: "default"` (beta `server-side-fallback-2026-07-01`, Claude API only) re-runs only `cyber`
and `frontier_llm` declines on Claude Sonnet 5 – other declines come back as `stop_reason: "refusal"`
(`AI_REFUSAL`); the minimum cacheable prefix is 512 tokens; it has its own rate-limit pool.

**Effort sweep (09/10/2026, real calls).** Per completed form; "cold" prices every prompt token as a
cache write (a new patient's first call – the real cost; repeat calls within 5 minutes cost about a
third). Opus figures are the earlier recordings. Quality checks: every paragraph cites valid sources;
no date or figure outside the cited sources; opinions only attributed to a clinician who recorded
them; Megan's prognosis, maximum improvement and fitness questions blank with a gap on every form;
Daniel's qualified phased return cited to N-006 and never ticked Yes/No; no past or social history on
employer and case-manager forms; abbreviations written out; no source ids in answers; UK English and
DD/MM/YYYY; third person when no signer is named; every question of each sample form found, in a real
answer space.

| Step | Model · effort · prompt | Wall time | Output tokens | Cost (cold) | Quality checks |
|---|---|---|---|---|---|
| Drafting, 5 demo form pairs | Opus 5.5 · medium · `forms-5` (recorded) | 12.9–20.5 s | 3,717–4,643 | $0.23–0.26 | all pass |
| | Sonnet 5.5 · low · `forms-5` | 6.2–9.4 s | 2,063–2,921 | $0.10–0.11 | Kingsway: a date not in the cited note (blocking); "I recorded…" with no signer named in 5 of 5 |
| | Sonnet 5.5 · medium · `forms-5` | 6.1–9.7 s | 2,239–3,037 | $0.10–0.12 | "I recorded…" with no signer named in 4 of 5 (once "On 07/07/2026 I mean Sarah Reid recorded…") |
| | Sonnet 5.5 · low · `forms-6` | 6.0–12.0 s | 2,079–3,109 | $0.10–0.12 | 3 runs while `forms-6` was refined: (1) Megan → Northfield gave "between 18/03/2026 and 07/07/2026" without citing the 07/07 note (blocking) and Daniel → Northfield left the phased return only in a gap; (2) "No clinician recorded an opinion…" written into an answer box; (3) final prompt: all pass |
| | Sonnet 5.5 · medium · `forms-6` | 5.7–11.2 s | 2,122–3,524 | $0.10–0.12 | 4 runs: (1) the same two Northfield problems as low; (2) all pass; (3) first recording: "No further restrictions… were recorded" added to an answer (caught as opinion wording); final prompt (recording and sweep): all pass on these checks – review then found the problems fixed in `forms-7` (below) |
| | **Sonnet 5.5 · medium · `forms-7`** | **6.0–11.4 s** | **2,230–3,387** | **$0.10–0.13** | **3 runs (recording, sweep, sweep with the signer named): all pass, including the new checks** (no corrupted glossary term, no record ids or abbreviations in gap wording, every answer word in the record or a UK English dictionary). The recording once ticked Meridian's "Reason for discharge" as "Goals achieved" (the note says "episode of care complete"): code now leaves such a choice blank with a gap; both sweeps left it blank themselves |
| Built-in templates (2) | Opus 5.5 · medium (recorded) | 28.7–35.9 s | 6,557–11,334 | $0.25–0.38 | all pass |
| | Sonnet 5.5 · medium · `1` | 9.9–14.9 s | 3,829–4,970 | $0.10–0.13 | all pass on these checks; review found "whale-associated disorder" for WAD II in the solicitor draft |
| | **Sonnet 5.5 · medium · `2`** | **8.1–29.7 s** | **3,284–6,361** | **$0.10–0.15** | **2 runs: all pass.** The solicitor draft writes every abbreviation out and is longer (5,418–6,361 output tokens, its longest group 21.6–29.7 s; was 4,970 and 14.9 s) |
| Form analysis, 4 sample forms | Opus 5.5 · medium · `form-analysis-2` (recorded) | 15.5–28.0 s | 5,409–7,239 | $0.18–0.27 | all pass |
| | Sonnet 5.5 · low / medium · `form-analysis-2` | 9.4–25.6 s | 3,588–7,172 | $0.09–0.13 | Kingsway 14–15 of 22 questions; duplicate-question warnings on Harrow & Pike and Meridian; low once 20 of 22 on Harrow & Pike |
| | **Sonnet 5.5 · low · `form-analysis-3`** | **10.8–14.3 s** | **4,165–5,477** | **$0.08–0.14** | **2 runs: all pass** – every question found (22 / 23 / 22 / 17), in the same answer spaces as the Opus maps, nothing dropped; once mapped Northfield's diagnosis question as an opinion |
| | Sonnet 5.5 · medium · `form-analysis-3` | 11.4–17.8 s | 4,222–5,554 | $0.08–0.14 | 2 runs: first (before office-use boxes were asked for) left out Harrow & Pike's two office-use boxes; then pass, with Northfield's diagnosis as an opinion and four warnings where the prompt allows three |
| Form analysis, 6 insurer PDFs + 5 samples | **Sonnet 5.5 · low · `form-analysis-4` (S7 text, live, not recorded)** | 9.7–23.7 s | 3,657–16,418 | $0.10–0.64 | 4 rounds: Bupa and AXA every question, source and party right; no sign-off in another party's part on any form – see "Live form analysis on the RED engine (S7)" |

**Chosen:** `DEFAULT_ANALYSIS_EFFORT` = `low` (`ai/form-analysis.ts`) and `DEFAULT_LIVE_EFFORT` = `medium`
(`ai/draft-live.ts`). For drafting, low and medium cost the same within about 3 % and take the same
time; low made the only blocking figure error of the sweep, so medium stays (switching to low is a
one-line change and needs no re-recording). Against Claude Opus 5.5 a completed form costs about
55 % less ($0.10–0.12 instead of $0.23–0.26) and comes back about twice as fast.

**Prompt changes made for Claude Sonnet 5.5** (failures that appeared at every effort, so the prompt
was fixed rather than the effort raised):
- **`form-analysis-3`:** the outline lists every placeholder of a block (`placeholders=[…]`,
  `ai/form-outline.ts` `blockPlaceholders()`) – it showed only the first, and Sonnet (unlike Opus) then
  mapped only the first question on lines such as "Date first seen: ____ Date last seen: ____"; each
  chunk's instruction spells out its own blocks (`chunkParts()`) so a chunk no longer maps a
  neighbouring table (post-validation dropped those duplicates with a "pointed at the same answer
  space" warning); office-use boxes are mapped as `leave_blank`.
- **`forms-6`:** third person when no signer is named (the recordings; live drafts name the signer and
  stay in the first person); a span of dates cites the notes that hold both ends; a text question asking
  for the details of a qualified opinion (restrictions, adjustments, modified duties) is answered by
  attributing it; no "…was not recorded" sentence after a partial answer.

**Quality fixes after review (`forms-7`, template prompt `2`, 09/10/2026).** Reading the `forms-6`
recordings found what the checks could not: the solicitor draft said Sarah Reid "assessed
whale-associated disorder grade II" (the note says "WAD II"); gap wording showed note ids and shorthand
("…every 30–45 minutes in N-010", ">15 kg"); "SNAGs (sustained natural apophyseal glides)" was written
out twice. Fixed in the prompts and, so that it holds whatever a draft does, in code:
- **Prompts:** every abbreviation is written out, and the clinic's glossary
  (`core/voice.ts` `CLINICAL_ABBREVIATIONS`, `ai/prompts.ts` `GLOSSARY_ABBREVIATIONS`) is in both prompts
  so a full form is copied, not recalled. (Asking drafts to KEEP the glossary abbreviations for code to
  write out was tried first: they then also kept other shorthand – "L>R", "PAs", "P&N", "traps" – in 6
  of 7 recordings, so it was dropped.) Gap wording names a note by its date and clinician, never its
  id. A tick or choice is given only when a cited note states it, never "ticked, please confirm".
- **Code (`ai/assemble.ts`, `core/voice.ts`):** answers AND gap wording go through the same clean-up –
  record ids become the note's date ("in the note of 22/09/2026", "(22/09/2026)", `describeSourceIds`),
  shorthand and glossary abbreviations are written out, and "ABBR (full form)" is collapsed like
  "full form (ABBR)". A tick or choice the draft raised a gap about is left blank, without its
  paragraphs; a single choice whose words the cited notes do not use is left blank with a gap
  ("Goals achieved" for "episode of care complete").
- **Validator `TERM_NOT_IN_SOURCE`** (`core/validation/terms.ts`, blocking, can be acknowledged): a
  glossary term the record uses, written with one word swapped for a word the record never uses that
  starts like the expected one or sits in its hyphenated compound. Over 52 earlier drafts (584
  paragraphs) it flags exactly the "whale-associated disorder" paragraph and nothing else.
- **Regression test** `scripts/medreport/demo-draft-quality.test.ts`: every recorded demo draft,
  assembled as the demo replays it, has every paragraph cited, no blocking flag other than open gaps
  and missing answers, and no record ids, glossary abbreviations or "[CLAIMANT]" in answers or gaps.
- **Kingsway case no.:** the recorded map sends `referral.reference` to both "Employer / client
  reference" and "Kingsway case no."; code already copies the employer's AF-OH-0457 only into the
  employer's blank and leaves Kingsway's own number blank with a gap for staff – now pinned by a test.

**Recordings (09/10/2026, Claude Sonnet 5.5):** all four sample analyses (`form-analysis-3`, low) and all
seven demo drafts – the five form pairs (`forms-7`) and the two built-in templates (`2`) – at medium,
in the third person (the review offers "Write in my own voice"). The pre-written Ashcroft answers are
rebuilt from the new Harrow & Pike recording (`build-prewritten-drafts.ts`). The hand-confirmed maps of Harrow &
Pike, Northfield and Kingsway stay the pre-confirmed definitions (the recorded maps match them, except
Northfield's diagnosis mapped as an opinion and Kingsway's functional-capacity answer one line lower,
as the Opus map had it). Meridian has no hand map: its recorded map is equal to the Opus one (same 17
questions, answer spaces, sources and options) and replaces it.

**Live check (production build, `MEDREPORT_AI_MODE=auto`, 09/10/2026):** uploading Meridian took 12 s to
the mapping (Opus: 23–25 s) and found the same 17 questions; Megan → Harrow & Pike 12 s from click to
review (Opus: 18–22 s), every paragraph cited, prognosis and maximum improvement blank with gaps, in
Sarah Reid's first person; Megan → Northfield straight afterwards waited for the per-minute live limit
(30 s; about 7 s without the wait). No screen named a vendor or model. Repeated on `forms-7`: the same
17 questions in 12 s; Harrow & Pike and Northfield every paragraph cited, no abbreviation left,
prognosis, maximum improvement and fitness blank with gaps, no blocking flag other than gaps, gap
wording naming notes by date.

## Report API `/api/reports/v1`

The full table, with handler files, is `REPORT_API_ENDPOINTS` in `api/contract.ts`. Paths come from
`reportApiPaths`. Request and response schemas are `<Name>RequestSchema` and `<Name>ResponseSchema`.

| Method | Path | Auth | Handler | Purpose |
|---|---|---|---|---|
| GET | `/health` | – | health.ts | `{product, version, aiMode, liveAiAvailable, model, promptVersion}`; anonymous callers get the neutral engine name and an empty `promptVersion` |
| GET | `/connectors` | – | connectors-list.ts | Connector tiles |
| POST | `/launch` | `x-partner-key` | launch.ts | `{connectorId, patientId, episodeId, clinician}` → `{launchUrl, expiresAt}`; the demo key → tenant `demo`, a clinic's key (partner_keys) → that clinic |
| POST | `/launch/verify` | launch token (+ the clinic's member for a clinic launch) | launch-verify.ts | `{token}` → `{claims, session}` |
| POST | `/sessions/demo` | – | sessions-demo.ts | Demo-tenant session for the picker, uploads and batch |
| GET | `/connectors/{id}/patients?search=` | actor | patients.ts | `{patients, trace}` |
| GET | `/connectors/{id}/patients/{pid}/episodes/{eid}/bundle` | actor (launch scope matches path) | bundle.ts | `{bundle, computedFacts, dataChecks, trace, demoDrafts?}` |
| POST | `/connectors/file-import/bundle` | actor | file-import-bundle.ts | Upload (ImportPayload) → bundle response (a clinic's bundle carries `clinic`); documented format only |
| POST | `/connectors/file-import/read` | actor | file-import-read.ts | Wave 3: upload (ImportPayload, `format` json\|csv\|text\|pdf\|docx) → `{result: "bundle", data}` (documented format) or `{result: "review", review: NotesReview, trace}` (ordinary clinic notes to check) |
| POST | `/connectors/file-import/confirm` | actor | file-import-confirm.ts | Wave 3: `{review}` (checked by staff) → bundle response; 422 `IMPORT_INVALID` with plain-English issues |
| GET | `/templates` | – | templates-list.ts | `{templates}` |
| GET | `/templates/{id}` | – | template-get.ts | `{template}` |
| GET | `/templates/{id}/docx` | – | template-docx.ts | Tagged .docx download |
| POST | `/templates/validate` | actor | templates-validate.ts | `{fileName, docxBase64}` → `{ok, tags, errors, unusedTags, unknownTags}` |
| POST | `/drafts` | actor (+ passcode for live in the demo) | drafts.ts | `{templateId, bundle, instructingParty, sectionKeys, prefer?, effort?, form?}` → `{sections, gaps, flags, generation}`; 1–2 keys, or 1–4 field IDs with `form`; `maxDuration = 60` |
| POST | `/validate` | actor | validate.ts | `{report, form?}` → `{flags, canSign, blocking}` (`form` required for a form report) |
| POST | `/sign` | actor (signer = the member) | sign.ts | `{report, signer, typedSignature, statementAccepted, attestations, form?}` → `{receipt, flags}`; the session must cover the report's patient and episode (403 `SESSION_MISMATCH`), a launch session's clinician must be the signer (403 `SIGNER_MISMATCH`), a form must carry a valid server attestation; the receipt records `formMapSha256` and `approvedVia`; 409 `SIGNOFF_BLOCKED` |
| POST | `/render?format=docx\|pdf\|original` | actor | render.ts | `{report, receipt?, templateDocxBase64?, reviewCopy?, requireFinal?, form?, fileBase64?}` → file; `x-medreport-render: final\|draft`; form reports: `original\|pdf`, 503 `PDF_CONVERSION_UNAVAILABLE`, 409 `FORM_MISMATCH`; `maxDuration = 60` |
| POST | `/connectors/{id}/documents` | actor | documents.ts | Signed file + receipt + `fileToken` → `{attachReceipt, trace}`. The receipt MAC is verified and `fileToken` (from the final `/render`'s `x-medreport-file-token`) must match this exact file, receipt, tenant, patient and episode |
| POST | `/forms/analyse` | actor (+ passcode for live in the demo) | forms-analyse.ts | `{fileBase64, fileName, referrer?, title?, prefer?, effort?}` → `{form (proposed), outlineSummary, trace?}`; `maxDuration = 60` |
| GET | `/forms/samples` | – | forms-samples.ts | `{samples: FormSample[]}` – bundled fictional referrer forms, with pre-confirmed maps where recorded; with local demonstration forms on (any AI mode), also those as `uploadRequired` entries (no map, file not served), and a prepared portal question set as a seeded sample with its attested map |
| GET | `/forms/samples/{id}/file` | – | forms-sample-file.ts | The sample's original .docx / .pdf |
| POST | `/forms/confirm` | actor: owner/admin/clinician | forms-confirm.ts | `{form, confirmedBy}` → `{form}` confirmed, with `confirmed {by, at, mapSha256, mac}`: the server's attestation of exactly this map (`auth/attestations.ts`) |
| POST | `/ai/payload-preview` | actor | ai-payload-preview.ts | `{templateId, bundle, instructingParty, form?}` → `{model, promptVersion, blocks, systemSummary, removed, withheld}`: exactly what a drafting call would send, minimised, with no AI call |
| POST | `/forms/fill-preview` | actor | forms-fill-preview.ts | `{report, form, fileBase64, mode: "draft", reviewMarkers?}` → the original file filled, DRAFT; `x-medreport-fill-warnings`; `maxDuration = 60` |

**Stateless:** the bundle travels inside `report.bundleSnapshot`. `/validate`, `/sign` and `/render`
take the report alone, not a separate bundle. Form maps and the referrers' files live in the browser
(forms library), so form requests also carry `form` (and `fileBase64` where the file is written).
`api/resolve-template.ts` `resolveTemplate()` is the one rule for "which template does this report
use" (built-in registry, or `formToTemplate(form)` for `form:<id>`).

**Body size:** form files are capped at `MAX_FORM_FILE_BYTES` (3 MB decoded) and form request bodies
at `MAX_FORM_REQUEST_BYTES` (4.4 MB), under Vercel's 4.5 MB limit. **New problem codes:**
`FORM_INVALID` (422, not .docx/PDF or an old .doc), `FORM_MISMATCH` (409, file SHA-256 differs from the
map/report), `FORM_NOT_CONFIRMED`, `NO_DEMO_ANALYSIS`, `PDF_CONVERSION_UNAVAILABLE` (503, Word → PDF
needs LibreOffice: "download Word" – `NOTICES.pdfConversionUnavailable`). **New headers:**
`x-medreport-fill-warnings` (URI-encoded JSON array of plain-English warnings) and
`x-medreport-form-kind`.

## Production wave 2 – callers, clinics and hardening (API slice)

`auth/actor.ts` `requireActor(req, deps, {roles?, scope?, connectorId?})` → `Actor {tenantId, userId?, sid, via,
role, name?, clinician?, scope?, session?}` on every endpoint that touches patient data or drafting (table above:
"actor"). Public: `/health`, `/connectors`, the template GETs, `/forms/samples` (+ file), `/sessions/demo`, `/launch`
(partner key).

- **Two kinds of caller.** A clinic's signed-in member (`via "user"`): the host resolves it
  (`MedreportDeps.authenticate` → `src/server/auth/medreport-actor.ts`, Better Auth session read from the database,
  active clinic, role, member profile); 403 `TWO_FACTOR_REQUIRED` without two-step verification, 403 `NO_CLINIC`
  without an active clinic. A launch session of the same clinic sent alongside narrows it to that episode
  (`"user+launch"`); other session tokens are ignored. The public demo (`via "demo"`, tenant `demo`): ONLY the demo /
  launch session tokens, only while `CLINFORMS_PUBLIC_DEMO` is not `0` (403 `DEMO_DISABLED`). A request from the
  demo's own pages (`/reports`, `/pms-sandbox`, same-origin Referer) carrying a demo session is the demo even when
  the browser also holds a clinic sign-in; anywhere else a signed-in member is never the demo.
- **Tenant checks:** every report, bundle, form map and receipt in a request must be the actor's clinic's (403
  `TENANT_MISMATCH`). Form-map attestations and receipts already MAC the tenant; `verifyFormConfirmation(form,
  {tenantId})`, `verifyReceipt(…, {tenantId})` and `verifyReceiptMac(…, {tenantId})` refuse another clinic's.
  `/forms/analyse` and file import stamp the actor's tenant.
- **Roles:** confirm a map – owner/admin/clinician (403 `ROLE_NOT_ALLOWED`); approve – owner/admin/clinician with an
  HCPC number and "may sign" on the member profile (403 `SIGNER_NOT_ALLOWED`; staff never). Drafting, previews,
  renders: any role.
- **Signer = the member** (name from the account, HCPC and job title from `member_profile`); a body `signer` with
  another HCPC is 403 `SIGNER_MISMATCH`. `approvedVia {kind "user", sid, userId, launchSid?}` (additive). The demo
  keeps the body's fictional signer. A member cannot rename their account (Better Auth `/update-user` is off).
- **The signer's own voice (fix wave 2).** A clinic's new report is drafted in the first person of the member who
  will sign it (`new-report-screen.tsx` `tenantAuthor`: owner/admin/clinician with an HCPC number and "may sign"), or
  – when that member cannot sign – with no author, i.e. in the third person (`GenerateInput.author`,
  `CreateFormReportInput.author`, `null` = nobody). `/sign` refuses unedited drafted answers that speak in another
  clinician's "I" (`report.author` ≠ the signer by HCPC, else name): 409 `SIGNER_NOT_AUTHOR` naming the questions
  (`core/voice.ts` `otherClinicianVoice`, `speaksInFirstPerson`); the review shows the same reason before the
  click, and staff / members without signing details see why they cannot approve. "Write in my own voice" uses the
  signed-in member in a clinic's Studio. The demo is unchanged.
- **Clinic profile replaces DEMO_CLINIC** (`core/clinic.ts`): a clinic's bundle carries `bundle.clinic` (optional,
  from its profile); demo bundles carry none and keep DEMO_CLINIC; a clinic without a profile names no clinic.
- **Connectors:** the simulated TM3 sandbox is `demoOnly` (403 `CONNECTOR_NOT_AVAILABLE` for a clinic); clinics use
  file import; real TM3 stays not configured. `/launch` maps a clinic's own partner key (`partner_keys`, SHA-256) to
  that clinic and builds `launchUrl` from `APP_ORIGIN` / `BETTER_AUTH_URL` (`config.server.ts appOrigin()`), never
  the request's Host; a clinic's link opens `/app/studio/new` (the tenant Studio) and only that clinic's member can redeem it.
- **Shared state** (`MedreportDeps.sharedState`, `auth/shared-limits.ts`): launch-token replay → `launch_token_uses`,
  the demo's live cap and passcode guesses → `rate_limits` (429 + `Retry-After` unchanged). The host provides it
  when `CLINFORMS_DB` is set; a single local process keeps its in-memory counters. Clinics draft live WITHOUT the
  passcode while `clinic_profile.drafting_enabled` (fix wave 2: no profile, or a profile that cannot be read = OFF –
  fail closed; the host's `loadClinicProfile` passes read errors on): prefer "live" with it off → 403
  `DRAFTING_DISABLED`; per-clinic limits `CLINFORMS_TENANT_LIVE_CALLS_PER_MINUTE` (10) and `_PER_DAY` (400).
- **CSRF:** `bindHandler` refuses state-changing requests whose `Origin` is not an app origin (or that a browser
  marks cross-site) – 403 `ORIGIN_NOT_ALLOWED`; `parseBody` requires a JSON content type – 415
  `UNSUPPORTED_MEDIA_TYPE`.
- **Audit** (`MedreportDeps.audit`, clinics only, ids and counts only): `form.confirm`, `form.analyse_live`,
  `report.draft_live`, `report.sign`, `report.render_final`, `report.file_back`, `launch.issue`
  (`AUDIT_ACTIONS` also names `report.delete` / `report.export` for the server store). `report.render_final` carries
  `purpose` (`RenderRequest.purpose`, fix wave 2): `download` (default) and `file_back` are recorded; the review's
  on-screen `preview` of an approved report is not, and carries no file token. A clinic's Studio offers no case
  JSON download (an unrecorded copy of a patient's whole record).
- **Studio:** the default `api` client gets a demo session before a call that needs a caller when none is stored
  (`ensureSessionToken`); a clinic's sign-in cookie takes precedence on the server.
- Tests: `scripts/medreport/api-actor.test.ts` (per endpoint, two instances on one database) and
  `api-actor-auth.test.ts` (the glue's real Better Auth wiring).

## Clinic storage (wave 2): `/api/reports/v1/store/**` and the Studio's two store backends

A clinic's own Studio keeps its reports, form maps, form files and referrer links on the server
(docs/production-architecture.md §5); the public demo at `/reports` keeps browser storage, unchanged.

**Choosing the backend.** `HostHooks.storage?: "browser" | "server"` (default `"browser"`).
`<HostHooksProvider>` applies it (`ui/store/mode.ts` `setStoreMode`) before its children render, so every
store call of a screen uses the right backend. `ui/store.ts` keeps every export and signature:

| Folder / file | What |
|---|---|
| `ui/store/browser-backend.ts` | the pre-wave-2 code, moved unchanged: `medreport.report.<id>`, `medreport.forms`, `medreport.forms.seeded` in localStorage, files in IndexedDB `medreport-forms` |
| `ui/store/server-store.ts` | in-memory cache per clinic + hydration + cross-tab sync (BroadcastChannel `medreport-store`, refresh on focus/visibility, retry when back online) |
| `ui/store/write-queue.ts` | per-record coalescing write queue: one request per record in flight, newer saves replace the pending one, `If-Match` revisions, back-off, 401/403 kept until sign-in |
| `ui/store/server-api.ts` | same-origin fetches to `/store/**` (chunked, resumable file upload; downloads verified by SHA-256) |
| `ui/store/{events,mode,samples,types}.ts` | `STORE_EVENT`, the mode, `fetchSampleForms`, `StoredFormFile` |

Server mode: synchronous reads answer from the cache (the hooks report `ready` only after hydration: the
snapshot and every form map; one report when it opens, all reports for the home list); saves update the cache
and return `true` at once, then reach the server in order; a 409 loads the stored copy into the cache and
notifies (`use-review-state` already swaps in a newer stored copy); a record refused and never stored is
dropped from the cache. Nothing from a report or form map is written to localStorage or IndexedDB (pinned by
`scripts/medreport/store-client.test.ts`). Fictional sample forms are not seeded into a clinic. `resetDemo()`
never deletes a clinic's records (it clears this tab's session keys and the in-memory copies).

**Async extras** (`ui/store.ts`; in browser mode they resolve to the synchronous result):
`flushStore({keepalive})`, `saveReportDurable(report)`, `saveFormDurable(form)`, `useStoreSync()` /
`getStoreSyncState()` → `{pending, failed, error?}`, `retryStoreSync()`, and for referrer links
`getStoredReferrerLinks()` / `saveReferrerLinks()` (server mode; `ui/components/new/referrer-match.ts` uses
them). Used where a change must be stored before moving on: amendment (`review-screen.tsx`), approval
(`use-review-actions.ts`: `commit()` then `flushStore()`), form confirmation (`form-mapping-screen.tsx`),
form upload (`analyse.ts`) and portal question sets (`portal-questions-dialog.tsx`), after generation before
opening the review (`new-report-screen.tsx`), page hide (`use-review-state.ts`: `flushStore({keepalive})` plus a
`beforeunload` prompt while changes are pending, server mode only) and case import (`home-screen.tsx`). The
review's save indicator follows the server's answer in server mode.

**API** (`api/store-contract.ts`, browser-safe; `STORE_API_ENDPOINTS` + route coverage test; handlers
`api/handlers/store-*.ts`). Every endpoint: a signed-in clinic member with two-step verification, resolved by the
same `auth/actor.ts` `requireActor` as every other endpoint (`store-actor.ts` `requireTenantActor`: 501 without
`MedreportDeps.tenantStore`, 401, 403 `TWO_FACTOR_REQUIRED` / `NO_CLINIC`; a demo session is never accepted – 403
`TENANT_ONLY`); the clinic always comes from the sign-in; writes need this app's `Origin` (`bindHandler`: 403
`ORIGIN_NOT_ALLOWED`) and JSON (415; chunks may be `application/octet-stream`); every change writes an audit row
(ids, revision, status – never patient data).

| Method | Path | Purpose |
|---|---|---|
| GET | `/store/snapshot` | `{tenantId, reports, forms, settings, limits}` – summaries only |
| GET / PUT / DELETE | `/store/reports/{id}` | `{rev, updatedAt, report}`, `ETag: "<rev>"`; PUT without If-Match creates, with `If-Match: "<rev>"` updates; 409 `REV_CONFLICT` `{current}`; `signed` only with a receipt that verifies for this clinic and content (422 `RECEIPT_INVALID`); an approved report cannot become a draft (409 `REPORT_LOCKED`) |
| GET / PUT / DELETE | `/store/forms/{id}` | as reports; an unattested (or another clinic's) confirmation is stored as `proposed` (`downgraded: true`); delete removes the file with its last map |
| POST | `/store/files` | `{sha256, size, name, mime}` → `{complete, chunkCount, present}` (start / resume) |
| PUT | `/store/files/{sha256}/chunks/{idx}` | one 512 KiB chunk (raw with `?size=`, or JSON `{size, dataBase64}`) |
| POST | `/store/files/{sha256}/complete` | checks every chunk, size, SHA-256 (422 `UPLOAD_CORRUPT`, upload thrown away), form type (422 `FORM_INVALID`); 409 `UPLOAD_INCOMPLETE` `{missing}` |
| GET | `/store/files/{sha256}` | the decrypted file |
| GET / PUT | `/store/settings` | referrer → form links |

**Fix wave 2 (security review).**
- *Scope:* the server store's memory belongs to ONE clinic and member: `<HostHooksProvider>` passes
  `{tenantId: clinic.tenantId, userId: member.userId}` to `ui/store/mode.ts` `setStoreScope`; another scope (a new
  sign-in or clinic without a full page load) empties the cache and the write queue, and the Studio's screens
  remount (keyed by scope). Every store request sends `x-clinforms-tenant` / `x-clinforms-member`
  (`STORE_TENANT_HEADER` / `STORE_MEMBER_HEADER`); `requireTenantActor` refuses another sign-in's with 403
  `TENANT_MISMATCH` / `SIGN_IN_CHANGED`, which the client never retries (and a hydrate refused that way empties the
  cache). Focus reloads before retrying waiting writes. A PUT body naming another clinic (neither the member's nor
  `demo`) is 403 `TENANT_MISMATCH` – never re-filed. Sign-out, clinic switch and sign-in load the next page in full
  (`src/app/app/session-forms.tsx`, login `codeStep` → `{status: "done"}`).
- *Protected records:* an approved report is deleted only by owner/admin (409 `REPORT_LOCKED`), so no other role can
  delete and re-create it as a draft; a confirmed form map is turned back into a proposal or deleted only by a
  confirming role (403 `ROLE_NOT_ALLOWED`). The Studio hides those controls accordingly.
- *Limits:* writes per member (`STORE_WRITES_PER_MEMBER_PER_MINUTE` 120) and per clinic (`_PER_CLINIC_` 400) per
  minute, and new data per clinic per day (`STORE_NEW_KB_PER_CLINIC_PER_DAY` 250 000 KB: new reports/maps and
  uploaded chunks; updates do not count) → 429 `RATE_LIMITED` + `Retry-After` (shared `rate_limits` counters;
  `SharedStateStore.hit(key, windowMs, amount?)`).
- *No save on open:* the review stores a revision only after a change someone made (`use-review-state.ts`), so
  opening a report writes no "Report saved" row and does not restart its retention clock; the activity page hides
  routine saves (`report.update`, `form.update`) unless asked (`?saves=1`) and links rows to the Studio.
- *Neutral file names:* `form_files.file_name` is plaintext, so `POST /store/files` never stores the `name` it is
  sent: the record is `form.pdf` / `form.docx` (`storedFormFileName`), the client sends that too, and
  `ui/store.ts loadFormFile` names a downloaded copy from the (encrypted) form map. A retried completion still writes
  a second `file.upload` row (each completion is recorded).

`/render` and `/forms/fill-preview` read the clinic's stored copy of the form file by (tenant, SHA-256) and
prefer it to `fileBase64`, which becomes optional for `/forms/fill-preview` (`api/handlers/store-form-file.ts`).
The host builds `tenantStore` in `src/server/store/tenant-store.ts` (repositories; uploads in
`src/server/repos/form-file-uploads.ts`) and wires it in `src/app/api/_medreport-tenant.ts` (`authenticate` comes
from the glue's `hostCapabilities()`).
Tests: `scripts/medreport/store-api.test.ts` (handlers), `store-client.test.ts` (client against the real
handlers), `ui/store/write-queue.test.ts`, `ui/store.browser.test.ts`; `src/server/store/*.test.ts` (real
repositories on SQLite and PGlite, and behind a real Better Auth sign-in); the repository suite's upload cases
also run on local D1 (`npm run test:gateway`). In-memory `TenantStore` for tests: `api/store-memory.ts`.

## Local demonstration forms (dev/demo only)

Third-party forms – e.g. the public insurer PDFs for the RED Physiotherapy demo – are never committed
(`/demo-assets/` is gitignored) and must never be served from production. `ai/demo-assets.ts` reads them
from `MEDREPORT_DEMO_ASSETS_DIR` at run time (no cache, so edits show without a restart):

```
demo-assets/insurers/
  bupa-therapies-management-form.pdf …            the forms (only hashed, to recognise an upload; never served)
  maps/<sampleId>.json                             RecordedFormAnalysis (ai/recorded-forms.ts), mode "demo_prewritten",
                                                   fileSha256 = the form's SHA-256, form.sampleId = <sampleId>
  drafts/<patientId>__form-<sampleId>.json         DemoDraftFile (ai/demo-format.ts): formSha256, fields (answer spaces),
                                                   groups, bundleFingerprint of the simulated TM3 demo patient
```

- **Upload in demo mode** → the prepared map of exactly that file (`analyse-form.ts` keeps the stored
  map's own mode; trace "Pre-written demonstration map of this exact uploaded form",
  `WORDING.server.analysis.uploadedPrewrittenDetail`). A bundled recording of the same file wins, and a
  local map never stands in for a bundled sample's map. Live or rules readings of a local demonstration
  form are labelled too.
- **Answers:** `draft-demo.ts` merges the local drafts with the bundled ones (bundled wins on a name
  clash); the bundle response's `demoDrafts.formSha256s` advertises them, so the Studio sends the
  drafting calls. Same binding rules as the bundled drafts (patient, notes fingerprint, file SHA-256,
  answer spaces). Every planned group needs an answer, else its questions are left for the clinician.
- **Demonstration footer:** every local map carries `FormDefinition.demoNotice` – its own, else
  `core/wording.ts` `demoFormNotice(referrer)`: "Public form used for demonstration only – not
  affiliated with or endorsed by <insurer>. Fictional patient data." `forms/demo-notice.ts` prints it on
  every page of every draft preview and final render (PDF: small grey line in the bottom margin of each
  page and continuation sheet, inside the crop box, upright on rotated pages, below the red DRAFT line;
  Word: a footer paragraph on every footer the sections show), and the Studio shows it in the preview
  headers (`ui/components/shared/demo-notice.tsx`). It is part of `formMapSha256`, so an approved map
  cannot lose it before the final render; forms without it hash and render byte-for-byte as before.
- **Forms library:** with the demo assets on – whatever `MEDREPORT_AI_MODE` says (a request without the
  live passcode is demo, so an upload still gets its prepared map) – `GET /forms/samples` also lists each
  mapped local form as an `uploadRequired` entry ("Demonstration forms – Upload this form"); its file is
  never served. A map of kind `questions` (a portal question set we wrote ourselves; its `fileSha256` is the
  SHA-256 of its questions) is returned as a seeded sample with its map attested, so it appears in the
  library confirmed and nobody types the questions live; its answers file replays like any other.
- **Off in production:** ignored whenever `NODE_ENV` or `VERCEL_ENV` is `production`, unless
  `MEDREPORT_DEMO_ASSETS_ALLOW_PROD=1` (for a local `next start` only). On Vercel the folder does not
  exist anyway (gitignored).
- **Commands:** `npm run demo:check` (each map against its file: schema, SHA-256, `checkFormDefinition`,
  attestation, PDF fields / Word blocks, the upload really returning it – a question-set map against the
  SHA-256 of its questions instead; each answer file: patient,
  fingerprint, advertised, and exactly the checks of `demo-draft-quality.test.ts` – quiet when the folder
  is absent); `stamp-demo-drafts.ts --dir=demo-assets/insurers` after a fixture change; `npm run demo:red`
  = `next build` + `next start` on port 3000 with `MEDREPORT_DEMO_ASSETS_DIR=demo-assets/insurers` and
  `MEDREPORT_DEMO_ASSETS_ALLOW_PROD=1` unless `.env.local` (read the way Next reads it) or the shell says
  otherwise, and ALWAYS `MEDREPORT_AI_MODE=demo` unless `--live` is given (a live-ready `.env.local` would
  otherwise offer the passcode and turn uploads and drafts live – longer answers overflow the insurer forms'
  boxes). `npm run demo:red -- --live` keeps `.env.local`'s mode (e.g. `auto`: live once the passcode is typed).
- Tests: `scripts/medreport/demo-assets.test.ts` (synthetic folder in a temp dir) and
  `forms/demo-notice.test.ts`.

## Simulated TM3 API `/api/tm3-sim/v1` (scaffolding)

Every call needs `Authorization: Bearer TM3_SIM_TOKEN` (401 otherwise). Every response carries
`X-Simulated: true` and `_simulated: true`. Lists are paged with `?page=&page_size=`. Payloads are
snake_case: see `connectors/tm3-sim/wire.ts` (the module side) and `src/sandbox/tm3-sim/wire-types.ts`
(the sandbox side). These shapes are our assumption, not TM3's schema. Optional since 10/2026 (private
medical insurance): `referral.insurer_name`, `referral.membership_number`, `referral.authorisation_number`
and `appointment.charge {amount (pounds), currency "GBP", paid}`; absent on the earlier cases.

| Method | Path | Handler export |
|---|---|---|
| GET | `/patients?search=` | `simListPatients` |
| GET | `/patients/{id}` | `simGetPatient` |
| GET | `/patients/{id}/episodes` | `simListEpisodes` |
| GET | `/episodes/{id}/notes` | `simListNotes` |
| GET | `/episodes/{id}/appointments` | `simListAppointments` |
| GET | `/episodes/{id}/outcome-measures` | `simListOutcomeMeasures` |
| POST | `/patients/{id}/documents` | `simAttachDocument` (returns a receipt and stores nothing) |

## Connector interface (what a real TM3 connector implements)

The connector types live in `connectors/types.ts`: `ClinicSystemConnector`, `ConnectorContext`,
`ConnectorEpisodeRef`, `AttachDocumentInput` and `ConnectorError`. The handlers receive
`MedreportDeps` (`api/deps.ts`): a connector registry plus `createConnectorContext(req, connectorId,
tenantId)`. The app glue builds them, so the module never imports the sandbox.

## Testing

`npm run test:medreport` runs `node --import ./scripts/medreport/test-setup.mjs --import tsx --test`
over `src/modules/medreport/**/*.test.ts`, `scripts/medreport/**/*.test.ts` and (since 10/2026) the
simulated TM3 sandbox's own tests, `src/sandbox/**/*.test.ts`. The setup file maps
`server-only` to its empty module, so server files can be unit-tested with the full React build. After
every change, also run `npx tsc --noEmit`, `npm run lint` and `npm run build`.

## Ownership (parallel build agents)

**Shared contract files are owned by the orchestrator.** Later agents must not change their exported
shapes. Additive optional fields, new re-exports and new methods are allowed, and an agent that adds
one must say so in its report. The shared files are:

- `core/schemas.ts`, `core/types.ts`, `core/dates.ts`, `core/ids.ts`, `core/labels.ts`
- `api/contract.ts`, `api/http.ts`, `api/deps.ts`, `api/resolve-template.ts`, `connectors/types.ts`
- `ui/api-client.ts`, `ui/store.ts`, `ui/primitives.ts`, `ui/host-hooks.tsx`, `ui/preview-libs.ts`
- `config.public.ts`, `config.server.ts`
- `.eslintrc.json` and `scripts/medreport/gen-eslint-boundary.mjs`
- `scripts/medreport/test-setup.mjs`
- `src/app/reports/layout.tsx`, `src/app/pms-sandbox/layout.tsx`
- every thin `route.ts`

Exported signatures in `core/forms.ts`, `core/report-factory.ts` and `forms/*.ts` are final (contract
stage); their owners may change the implementation, not the signatures.

Each agent owns the following files (Revision 2 slices):

- **[forms-engine]**:
  - `forms/**` (the referrer-form engine: outline, fill, PDF, conversion, sample forms);
  - `docgen/**` and `templates/**` (built-in fallback templates);
  - `core/fingerprint.ts` and `auth/sign-receipt.ts`;
  - the handlers `sign.ts`, `render.ts`, `templates-list.ts`, `template-get.ts`, `template-docx.ts`,
    `templates-validate.ts`, `forms-samples.ts`, `forms-sample-file.ts` and `forms-fill-preview.ts`;
  - `scripts/medreport/build-templates.mjs` and `scripts/medreport/build-demo-forms.mjs`.
- **[ai]**:
  - `core/validation/**` (except `data-checks.ts`), `core/scope.ts`, `core/report-factory.ts` and
    `core/forms.ts`;
  - `ai/**`, `scripts/medreport/record-demo-drafts.ts` and `scripts/medreport/record-form-analyses.ts`;
  - the handlers `drafts.ts`, `validate.ts`, `health.ts` and `forms-analyse.ts`.
- **[studio-a]**:
  - `ui/screens/{home,new,forms,templates,batch}/**` and
    `ui/components/{shared,new,forms,templates,batch}/**`;
  - `src/app/reports/{page.tsx,new,forms,templates,batch}/**`.
- **[studio-b]**:
  - `ui/screens/review/**` and `ui/components/review/**`;
  - `src/app/reports/[id]/**`.
- **[store]** (wave 2): `ui/store.ts` (exports unchanged) and `ui/store/**`, `api/store-contract.ts`,
  `api/store-port.ts`, `api/store-memory.ts`, the handlers `store-*.ts`, `src/app/api/reports/v1/store/**`,
  `src/app/api/_medreport-tenant.ts`, `src/server/store/**` and `src/server/repos/form-file-uploads.ts`.
- **Finished slices (owned by the integrator stage from now on):** the simulated TM3 sandbox
  (`src/sandbox/**`, `src/app/pms-sandbox/**` except `layout.tsx`, `src/app/api/tm3-sim/**`,
  `connectors/tm3-sim/wire.ts`, `connectors/tm3-sim/mapper.ts`) and integration (`connectors/**`,
  `auth/hmac-token.ts`, `auth/launch-token.ts`, `auth/session-token.ts`, `auth/passcode.ts`,
  `core/computed-facts.ts`, `core/validation/data-checks.ts`, the handlers `launch.ts`,
  `launch-verify.ts`, `sessions-demo.ts`, `connectors-list.ts`, `patients.ts`, `bundle.ts`,
  `file-import-bundle.ts`, `documents.ts`, `src/app/api/_medreport-glue.ts` and
  `src/app/reports/medreport-host.tsx`).

## Two Studios: the public demo and a clinic's own (wave 2)

The same screens serve the public demo at `/reports` (`src/app/reports/medreport-host.tsx`) and a signed-in
clinic's Studio at `/app/studio` (`src/app/app/studio/layout.tsx` + `tenant-host.tsx`). The host decides through
additive optional `HostHooks` members (`ui/host-hooks.tsx`):

| Member | Demo (`/reports`) | Tenant (`/app/studio`) |
|---|---|---|
| `basePath` | unset → `/reports` | `/app/studio` |
| `mode` | unset → `"demo"` | `"tenant"` |
| `storage` | unset → `"browser"` | `"server"` (read by `ui/store.ts` – the server-store slice) |
| `clinic` `{tenantId, name, draftingEnabled?}` | – | the active clinic (header; drafting switch) |
| `member` `{name, userId?, role?, email?, roleLabel?, hcpc?, jobTitle?, canSign?}` | – | the signed-in member: default signer, activity actor, "confirmed by"; `userId` scopes the store (fix wave 2), `role` decides who may approve / delete |
| `track(event, props)` | – | host analytics (`form_uploaded`, `form_confirmed`, `draft_completed`, `report_approved`, `report_downloaded`) |
| `accountHref`, `onSignOut` | – | the clinic's pages (`/app`) and sign-out, in the header's account menu |
| `supportEmail` (fix wave 2) | – | where a clinic asks for help (the notes-upload panel) |

- **Paths:** no screen hard-codes `/reports`; links come from `ui/routes.ts` `useStudioPaths()` (pure
  `studioPaths(base, mode)` and `studioSection(pathname, base)` for the navigation, tested in `routes.test.ts`).
  `/pms-sandbox` links appear in demo-only branches. A clinic's Security link is the public `/security` page.
- **Tenant mode hides demo-only UI:** the drafting-mode badge and passcode, Demo tools (import case JSON, reset),
  Simulated TM3 tiles / source tab / sandbox launch hints, "Try the …" fictional samples, the forms library's
  sample and demonstration forms, PH-DEMO placeholders and hints, the Security page's "In this demo" table,
  "Use the prepared demo draft", and the batch screen (it reads a connected clinic system; tenant mode explains
  that instead and hides Batch from the navigation). The notes upload is the source. Production copy lives in
  `ui/studio-copy.ts` `TENANT_COPY`. Fix wave 2 (end-to-end review): no "TM3" anywhere in a clinic's Studio
  (`useFillSourceLabels`, `TENANT_COPY.sources`, no practice-system tile – pinned by `ui/tenant-mode.test.ts`), no
  "demo"/"live" analysis labels or request counts (`useAnalysisModeLabels`, `WORDING.server.analysis.clinic*` for a
  clinic's upload), a map is confirmed only once its referrer is named, a document with no questions is discarded
  rather than kept as a form, the notes-upload panel folds the format guide away and offers support instead of
  fictional samples, a "drafting is switched off" notice, no case JSON download, and no permanently disabled "Save
  to clinic record". Finish of fix wave 2: the **home is a work queue** (`screens/home/work-queue.ts` +
  `TenantHome`): no hero, badges or tiles; the clinic's forms with In progress (first) / Approved / All, a search over
  patient, referrer, form and approver, "Amended – vN", the next step and who approved; a new clinic sees a two-step
  first run (a confirmed referrer form, then the notes). **Word → PDF:** `/health` carries `pdfFromWord` (LibreOffice
  present – false on every hosted deployment), and the approved banner says up front "A PDF copy of a Word form is not
  available yet – download the completed Word file" instead of failing on the click; `NOTICES.pdfConversionUnavailable`
  is truthful in both Studios (no "production converter"). **Plain wording:** no fingerprint, request timings or
  "server-signed receipt" in a clinic's upload dialog, approve dialog, approved banner, list or activity entry
  (`markApproved(…, {plain})`, "Approval check code"); the approve dialog's name and HCPC are always read-only in a
  clinic. The compact navigation fades at the edge that has more to show (`scroll-fade.ts`). Drafting is attempted when the clinic has it switched on
  (`clinic.draftingEnabled`), not by passcode (`useAiMode().livePossible()`).
- **Analytics:** only in tenant mode, through `HostHooks.track`; `ui/studio-events.ts` builds the properties from
  enumerated values and counts only (no names, ids, file names or record text – pinned by `studio-events.test.ts`).
- **Both modes:** the site's mark (`components/shared/brand-mark.tsx`, the same glyph as `src/app/icon.svg`) and
  the legal links (privacy, cookies, terms, security) in the footer (`components/shared/legal-links.tsx`).
- **Render tests:** `ui/tenant-mode.test.ts` renders the shell and screens in both modes with `react-dom/server`.

## Revision 2 – referrer forms

Clinics receive a different report form from every MLC, insurer, solicitor, case manager or employer.
The product completes **that** form, in its original layout, rather than producing its own report.

**1. Forms library (once per referrer form).** Staff upload the referrer's form (.docx or fillable
PDF; flat PDF = best effort) → `POST /forms/analyse`: `forms/file.ts` checks the bytes, the forms
engine parses it (`buildDocxOutline` / `readPdfForm`) and Claude proposes a **form map**
(`FormDefinition`, status `proposed`): every question as a `FormField` with its label, the form's own
section heading, plain-English guidance, `answerType`, options, an **anchor** (where the answer goes in
the original file: `DocxAnchor` table_cell / after_paragraph / replace_placeholder / content_control /
checkbox_glyph / legacy_form_field by block ID; `PdfFieldAnchor` by AcroForm field name;
`PdfOverlayAnchor` by page box) and a **fill source** (`registration` path → code; `computed_fact` →
code; `notes_narrative` → Claude from the notes, cited; `clinician_opinion` → only an opinion a
clinician recorded, attributed, else blank + gap; `signoff` → the approval receipt; `leave_blank`).
Staff review and edit the map once and confirm it (`status: "confirmed"`, `confirmed {by, at}`). It is
bound to the file's SHA-256 (`form.file.sha256`) and reused for every patient. Bundled fictional
samples come from `GET /forms/samples` and are seeded into the library by `ui/store.ts`
`ensureSampleForms()`.

**2. Complete a form for a patient.** `core/report-factory.ts` `createFormReport({form, bundle,
instructingParty, computedFacts, clinician?})` → a `Report` with `report.form` (`ReportFormRef`:
formId, title, referrer, fileSha256, kind), `templateId = formTemplateId(form.id)` (`"form:<id>"`) and
one `ReportSection` per answerable field (`key = fieldId = "F-07"`, `title = label`). Registration and
computed answers are filled now by CODE (`origin: "from_records"`, sourceIds `REG` / `FACT-…` /
`N-…`); a value the record lacks is left blank with a system gap. Narrative and opinion fields are
drafted by `POST /drafts` with `form` (1–4 field IDs per call, `planDraftGroups`), validated with the
same validators against `formToTemplate(form)`.

**Answers.** Text answer types: the section's paragraphs ARE the answer. Yes/No, tick box, single
choice, date and number: `section.answer = {kind, value}` (boolean / option text / ISO date / digits /
null) and the paragraphs hold the cited support. `answerToText()` gives the text shown and written;
`buildFormAnswers(report, form, {receipt?})` gives the forms engine its `{[fieldId]: {text?, value?}}`
map – sign-off fields stay blank until a verified receipt is passed.

**3. Review and preview.** Question by question with citations; `POST /forms/fill-preview` returns
the original file filled and marked DRAFT, shown in its original layout with `ui/preview-libs.ts`
(docx-preview for Word, pdfjs-dist for PDF).

**4. Approve.** `POST /sign` with `form` (attestations = `FORM_ATTESTATIONS`) → receipt →
`POST /render?format=original|pdf` with `form` + `fileBase64` + `receipt` → the referrer's original file
with the answers and sign-off written in (Word in → Word out; PDF in → flattened PDF out). Word → PDF
uses LibreOffice (`forms/convert.ts`) where installed; elsewhere 503 `PDF_CONVERSION_UNAVAILABLE`.

**5. Save to the record** with `POST /connectors/{id}/documents` (unchanged). **6. Batch** uses the
same calls per patient.

**Fallback:** with no referrer form, the built-in templates (`templates/registry.ts`) and
`createReport()` work as before.

### Integration notes (integrator stage)

- **Unconfirmed maps:** `POST /drafts` with a form whose map is not confirmed returns 409
  `FORM_NOT_CONFIRMED`; `/sign` and a final `/render` refuse it too. "Confirmed" means attested by the
  server (`POST /forms/confirm`, see Revision 3): a client-set `status: "confirmed"` is not enough.
- **Required and optional questions:** a required question left unanswered blocks approval
  (`MISSING_PLACEHOLDER`, blocking); an optional one gives a warning that it will be left blank on the form.
- **Data scope:** employer AND case-manager forms withhold past medical and social history from the AI
  and flag it if it appears in an answer (`formScope()`), as the built-in employer template does.
- **References from another organisation:** when the form's referrer is not the organisation on the
  referral (`referrerNamesMatch()`, the same conservative rule as the form picker) and the question asks
  for the referrer's OWN reference (`asksForReferralPartyReference()`), the referral's reference is NOT
  copied in: the answer is left blank for staff to enter from the referrer's instruction letter (marked
  "Entered by staff"), with a system gap only when the question is required. The review offers "Use the
  referral's reference" for the case where the referrer asked for it. A question that names the referral
  party (e.g. "Instructing solicitor's reference") is still filled by code.
- **Demo drafts:** files are `{patientId}__{templateId}.json` (built-in templates) and
  `{patientId}__form-{sampleId}.json` (referrer forms, bound to the form file's SHA-256 and matched by
  answer space, so a re-confirmed map of the same file still gets its answers). Recorded with
  `record-demo-drafts.ts`; re-record after a sample file changes. Every file carries a
  `bundleFingerprint` (`ai/bundle-fingerprint.ts`) and is used only for the simulated-TM3 record it was
  made from (an upload reusing the patient ID, or changed notes, gets none); `stamp-demo-drafts.ts`
  re-stamps the files after a fixture change. The bundle response lists what exists
  (`demoDrafts: {templateIds, formSha256s}`); without a live passcode the Studio skips drafting calls
  that would return `NO_DEMO_DRAFT` and leaves those questions for the clinician.
- **Live failures degrade honestly:** a live analysis that fails uses the stored map of that exact file
  (recorded analysis or pre-written sample map), else rules; a live draft that fails with
  `AI_ERROR`/`AI_TIMEOUT` returns the recorded answers for that exact patient and form when they exist.
  Both are badged as recorded/pre-written, never as live.
- **Tailwind:** `tailwind.config.ts` scans `src/modules/**` and `src/sandbox/**` (adds classes only).
- **Rebuild the sample forms:** `npm run medreport:forms` (= `node scripts/medreport/build-demo-forms.mjs`);
  then re-record analyses and drafts (`record-form-analyses.ts`, `record-demo-drafts.ts`).

## Revision 3 – review fixes (security and product)

**Security**
- **Trusted sandbox origin:** the connector calls the simulated TM3 API only at `simTrustedBaseUrl()`
  (`src/app/api/_medreport-glue.ts`), never at a Host-header origin, so the bearer token cannot be sent
  to an attacker's host (SSRF). The Vercel bypass header goes only to the deployment's own URL; the
  sandbox's server actions trust a loopback host only on this server's own `PORT`.
- **Attestations** (`auth/attestations.ts`): `POST /forms/confirm` returns the map with
  `confirmed.mapSha256` (`formMapSha256()` over id, kind, file and fields) and `confirmed.mac`.
  `/drafts`, `/sign` and a final `/render` accept only an attested map (`requireAttestedForm()`:
  409 `FORM_NOT_CONFIRMED`, detail from `formConfirmationProblem()` for `NOT_CONFIRMED`,
  `NOT_ATTESTED`, `MAP_CHANGED` or `BAD_MAC`), and the receipt records `formMapSha256`, so a final
  file is always written with the map that was approved. A final render never takes a client
  `templateDocxBase64`. Bundled sample maps are attested by `GET /forms/samples`; the browser store
  moves unattested maps back to "proposed" so they are confirmed again.
- **Approval bound to a sign-in:** `/sign` needs a session for the report's patient and episode;
  `approvedVia {kind, sid, clinician?}` is in the receipt. Launch tokens are single use (`jti`).
- **Filed documents:** the final `/render` issues `x-medreport-file-token` (HMAC over receipt MAC, file
  SHA-256, tenant, connector, patient, episode); `/documents` verifies the receipt MAC and the token, so
  only the exact final file for that approval can be filed.
- **Zip bombs and PDF streams** (`forms/zip-guard.ts`): every Word file is checked before it is opened
  (500 entries, 20 MB per entry and 60 MB in total, measured by inflating with a cap) and every PDF's
  Flate streams (40 MB each, 120 MB in total) → 422 `FORM_INVALID` with a plain-English message.
- **LibreOffice** (`forms/convert.ts`): a minimal environment (PATH, HOME, LANG, TMPDIR only), a hardened
  per-run profile (macros never run, no active content, no linked updates), at most 2 conversions at a
  time (30 s queue), detached process group killed on timeout.
- **Previews:** `ui/preview-libs.ts` `renderDocxPreview()` sanitises docx-preview output (no scripts,
  frames, form controls, `href`, `on*` or non-image `src`), so a `javascript:` link in a referrer's form
  is inert.
- **Form analysis minimisation** (`ai/form-redact.ts`): a referrer form that arrives filled in has its
  patient details masked before analysis (and the PDF is sent blank), with a warning asking staff for
  the blank form. The drafting minimiser also removes dates of birth in note text.
- **Passcode:** wrong guesses are limited per client and per instance; a multi-call analysis reserves
  its live calls up front.

**Product**
- **Gaps:** a gap a person answered is one click ("Mark resolved", recorded as "Answered on the form by
  …"); an opinion gap can only be resolved by writing the opinion or acknowledged with a reason;
  status "Answered – confirm the gap". When the clinician's answer supersedes the draft's "not
  recorded" sentence, the card offers "Remove it".
- **First person:** answers that describe the signer's own notes in the third person can be rewritten
  with "Write in my own voice" (`core/voice.ts` `rewriteInFirstPerson`, deterministic; dates, figures
  and citations unchanged; "Revert to AI draft" keeps the AI wording). Drafts get the author
  (`report.author`, defaulting to the primary treating clinician) and the form prompt (from `forms-4`)
  asks for the author's own notes in the first person; note shorthand ("2x/wk", ">15 kg", "HR/OH") and
  clinical abbreviations ("NPRS", "AROM", "HEP", "LBP", "WAD II" – a fixed list; references such as
  "HP/RTA/2291", spinal levels and GP/HR are left alone) are written out and job titles take the
  record's casing in every drafted paragraph (`expandNoteShorthand`, `expandClinicalAbbreviations`,
  `normaliseJobTitles`).
- **Form prompt `forms-5`:** words that firm up a finding ("diagnosed", "confirmed", "resolved",
  "chronic"…) only when the cited note uses them (the opinion-language check blocks them otherwise – a
  GP's "mechanical LBP" was being reported as "diagnosed"); and a qualified opinion ("fit for a phased
  return … avoid lifting … for 4 weeks") is never turned into a plain Yes/No or an option that does not
  match its words – the answer is left empty with a gap that quotes the opinion. Since 09/10/2026 the
  prompt is `forms-6` and all five recorded form drafts are Claude Sonnet 5.5 output on it (see "Model
  and effort"; now `forms-7`). Recorded drafts are made WITHOUT an author, so they are in the third
  person (which `forms-6` now states explicitly) and offer "Write in my own voice"; live drafts are
  written in the signer's first person.
- **Live per-minute limit in the Studio:** a drafting group that gets 429 `RATE_LIMITED` (about 6 live
  calls a minute per instance) waits and tries again (`ui/components/new/generate.ts`:
  `RATE_LIMIT_ATTEMPTS` 5, `RATE_LIMIT_WAIT_MS` 12 s; the progress list says "Live drafting is at its
  limit for this minute – waiting…"), so a second form or a batch straight after the first still drafts
  live. The review screen's "Draft them now" does not retry automatically.
- **Printed notes PDF:** "Upload the notes" accepts a PDF printed or saved from the clinic system
  (`connectors/file-import/pdf-notes.ts`: text layer → the pasted-notes format; scans are refused with
  a plain-English message). Sample: `SAMPLE_PRINTED_NOTES_PDF` (Priya Nair, fictional;
  `scripts/medreport/build-notes-pdf.ts`).
- **"See exactly what is sent to the AI"** on the data step (`ui/components/new/ai-payload-panel.tsx`,
  `POST /ai/payload-preview`).
- **Security & data protection page** at `/reports/security` (controller/processor roles, DPA, DPIA, AI
  data handling, approval, access, hosting, audit, retention, rights; "this demo" versus "before real
  patient data").
- **Flat PDF sample:** Ashcroft Medical Reporting (fictional) – Physiotherapy Update Report
  (`ashcroft-update-report`, a non-fillable PDF). It is not seeded into the library: uploading it returns
  its pre-written map (`maps/ashcroft.ts`, `loadPrewrittenAnalysis`) to check and confirm, and case A
  has pre-written answers for it (`build-prewritten-drafts.ts`, labelled "Pre-written draft – no AI
  call"). Answers are written at the answer lines, at least 8 pt, with continuation sheets.
- **PDF fill:** minimum font 8 pt; characters the form's font cannot print are reported, not silently
  dropped; filled PDFs are flattened, drafts included (the DRAFT watermark sits on top of the answers).
- **Amendments:** "Create amended version" on an approved form starts version 2 (`report.version`,
  `report.amends`); files are named `…_AMENDED-v2`; the earlier approval is marked superseded.
- **Filing:** the Word original and its PDF copy are both filed; the header shows "Filed …" and "File
  again".
- **Demo tools** (import case JSON, reset) are in one menu on the home screen.

**Scripts:** `stamp-demo-drafts.ts` (bundle fingerprints), `build-notes-pdf.ts` (printed-notes sample),
`build-prewritten-drafts.ts` (Ashcroft answers). Run with
`node --env-file=.env.local --import ./scripts/medreport/test-setup.mjs --import tsx <script>`.

**Deliberately not done here:** a Content-Security-Policy (Next's inline scripts need nonces and dynamic
rendering; the preview sanitiser covers the uploaded-file risk), enforcing a passcode length (the
current demo passcode would stop working; documented instead), embedding a Unicode font in PDF fills
(`@pdf-lib/fontkit` is not installed; unprintable characters are reported), OCR for scanned notes, and
the converter host's patching and egress blocking (operational).

## Insurer (PMI) record fields (10/2026)

Additive contract changes for private medical insurance forms (Bupa, AXA, Aviva…):
- **Registration paths** (`RegistrationPathSchema`, filled by code in `core/forms.ts`
  `resolveRegistrationValue`): `patient.title`, `patient.phone`, `patient.email` (registration contact),
  `clinic.phone`, `clinic.email` (`DEMO_CLINIC`), `referral.insurerName` (the referral's insurer, else the
  referring insurer itself – `insurerNameOnRecord`), `referral.membershipNumber`,
  `referral.authorisationNumber`. `ReferralSchema` gained `insurerName?`, `membershipNumber?`,
  `authorisationNumber?`; `AppointmentSchema` gained `charge? {amount (pounds), currency "GBP", paid?}`.
- **Insurer identifiers go only onto that insurer's own form** (`core/form-record-rules.ts`
  `withheldInsurerIdentifier`): a membership or authorisation number is copied in only when the form's
  referrer matches the insurer on record (`referrerNamesMatch`). On any other organisation's form – another
  insurer, an MLC – it is left blank for staff with a `-referrer` gap (required questions), so the review
  shows the referrer notice and "Use the referral's reference" for a form that does belong to that insurer
  under another name. A record that does not say which insurer issued the number never copies it.
- **Same kind of organisation:** the referral's own reference / name on a form from a different
  organisation of the SAME type (a Bupa authorisation number on another insurer's "Policy number") is copied
  only when the question names the referral party or says "instructing" (`mayCopyReferralPartyReference`);
  the generic words ("policy", "insurer") fit the form's own issuer too. Different types are unchanged.
- **Fill source `fixed`** (`{kind: "fixed", value}`): the same answer for every patient, set in the map by
  staff ("Physiotherapist", "United Kingdom"); filled by code (`from_records`, no source IDs). A value that
  does not fit the question (an unprinted option, "maybe" for Yes/No) is left blank with a `-fixed` gap, and
  `checkFormDefinition` refuses to confirm a map with a missing or misfitting fixed answer. The live
  analysis never proposes it (`ai/form-analysis-schema.ts` `FILL_KINDS` has no `fixed`).
- **Live analysis:** the form-analysis prompt text lists the eight paths (see "Live form analysis on the RED
  engine (S7)" below). **Not done here:** the file-import format has no insurer fields or charges. The rules classifier now maps
  membership / authorisation / phone / e-mail / title labels to the new paths (S3 + integration).

## Demo data

Fictional fixtures served by the simulated TM3 sandbox (`src/sandbox/tm3-sim/fixtures/`). Clinic:
Riverside Physiotherapy (fictional), Milton Keynes. Clinicians: **Sarah Reid** (`PH-DEMO-01`, Senior
Physiotherapist, MCSP) and **Tom Ellis** (`PH-DEMO-02`, Physiotherapist, MCSP). Wire IDs below are the
simulated TM3's; the mapper assigns the citable `N-001`… note IDs, `A-001`… appointment IDs and
`OM-<instrument>` series IDs in date/time order.

| Slug | Patient ID | Episode ID | Patient | Instructing party | Notes | Appts | Scores |
|---|---|---|---|---|---|---|---|
| `megan-hart` | `sim-pat-001` | `sim-ep-1001` | Megan Hart, DOB 22/11/1991 (34), office administrator | solicitor – Harrow & Pike Solicitors (fictional), `HP/RTA/2291` | 10 | 11 (10 ATT, 1 DNA) | NDI 42→24→12 %, NPRS 7→4→2 |
| `daniel-brooks` | `sim-pat-002` | `sim-ep-1002` | Daniel Brooks, DOB 19/01/1980 (46), warehouse operative | employer – Ashby Freight Ltd (fictional), `AF-OH-0457` | 6 | 7 (6 ATT, 1 LCN) | ODI 48→30→18 % |
| – | `sim-pat-003` | – | Aisha Rahman (registration only) | – | – | – | – |
| – | `sim-pat-004` | – | George Whitfield (registration only) | – | – | – | – |
| – | `sim-pat-005` | – | Chloe Bennett (registration only) | – | – | – | – |
| `rebecca-lane` | `sim-pat-006` | `sim-ep-1006` | Mrs Rebecca Lane, DOB 23/07/1981 (45), primary school teacher | insurer – Bupa (insurer on record; fake membership `DEMO-POL-0001`, authorisation `DEMO-AUTH-0001`); GP referral, Kents Hill Medical Practice (fictional) | 5 | 7 (5 ATT, 1 CNC, 1 BOOKED) | NPRS 7→5→4, QuickDASH 52.3→38.6→29.5, PSFS 2.7→4.3→5.3 |

**Case A, Megan Hart** (RTA 12/03/2026, WAD II; episode 18/03/2026–07/07/2026, discharged). Scores
are on N-001 (18/03), N-006 (06/05) and N-010 (07/07). Planted gaps:
1. No pre-accident history: no note has `pastMedicalHistory`/`socialHistory`, and no text mentions
   previous neck problems (→ `NO_PRE_INCIDENT_HISTORY`).
2. DNA on 15/04/2026 (`A-005`) with no reason, and no later note explains it (→ `DNA_WITHOUT_REASON`).
3. No prognosis recorded by any clinician: the discharge note N-010 gives status and the HEP only
   (→ the prognosis section is a placeholder plus a blocking gap).
Both clinicians wrote notes (→ `MULTIPLE_CLINICIANS`). Disclosure consent recorded 18/03/2026.

**Case B, Daniel Brooks** (lifting injury at work 02/06/2026, mechanical LBP, no red flags; episode
09/06/2026–22/09/2026, discharged). Scores are on N-001 (09/06), N-004 (14/07) and N-006 (22/09).
- LCN on 23/06/2026 (`A-003`) with a reason recorded.
- N-001 holds unrelated past history (right knee arthroscopy 2015, mild asthma) and a social history
  **only** in `pastMedicalHistory`/`socialHistory`. The employer template's scope strips both, and no
  other note text uses an excluded term.
- The discharge note N-006 records the clinician's view: "fit for a phased return to normal duties over 2
  weeks; … avoid repetitive lifting >15 kg for 4 weeks; review in 6 weeks" (the opinion the AI may
  attribute, with a citation).
- Planted gap: no formal lifting / functional capacity test is documented.
- Disclosure consent recorded 09/06/2026. Both clinicians wrote notes (Sarah Reid saw him once, N-004).

**Case C, Rebecca Lane** (private medical insurance; lifting her cabin case into an aircraft's overhead
locker on 22/08/2026; right rotator cuff related shoulder pain (subacromial pain), no red flags; episode
OPEN since 01/09/2026). All notes by Sarah Reid; scores on N-001 (01/09), N-003 (15/09) and N-005 (01/10).
- The insurer on record is **Bupa** – the one real organisation in the fixtures, named so the demo can fill
  Bupa's PUBLIC further-treatment form. Never imply a partnership; the membership and authorisation numbers
  are obviously fake (`DEMO-POL-0001`, `DEMO-AUTH-0001`); `referral.reference` is the authorisation number.
  Identifiers, phone and email are never in the referral reason or the notes, so they never reach drafting.
- 6 sessions pre-authorised (initial assessment + 5); 5 used; the 6th is BOOKED for 15/10/2026. The latest
  note (N-005, 01/10/2026) records the further-treatment request (4 sessions, fortnightly over 8 weeks), the
  clinical reason, the guideline followed and the goals. CNC on 22/09/2026 with a reason.
- Charges: initial assessment £70, follow-ups £55; all paid except the latest (01/10/2026).
- Structured past medical history (no previous shoulder problems; hypothyroidism) in N-001.
- Planted gap: **no prognosis recorded by any clinician** (progress, goals and plan only).
- Data checks: `EPISODE_STILL_OPEN` (info) only. Disclosure consent recorded 01/09/2026.

**Loading a bundle in a test or script** (`scripts/medreport/dev-bundles.ts`; `scripts/` may import both
the sandbox and the module, module files may not):

```ts
import { getDemoBundle, getDemoEpisodeData, listDemoPatients, DEMO_FETCHED_AT } from "./dev-bundles";
const bundle = getDemoBundle("megan-hart"); // or "sim-pat-001" / "sim-ep-1001"; "daniel-brooks" for case B, "rebecca-lane" for case C
```

Bundles are deterministic (tenant `demo`, `fetchedAt` `2026-10-06T09:00:00.000Z`) and each call returns a
fresh copy. Put such tests under `scripts/medreport/**/*.test.ts` so `npm run test:medreport` runs them
with the `server-only` shim. A module test that needs a full case without importing the sandbox should
use an inline bundle, or a JSON snapshot it owns.

## Tables and flat-PDF boxes (S2, RED demo)

- **Table questions** (`answerType: "table"`, answer kind `"rows"`: `[{<column key>: <cell text>}, …]`).
  Anchors: `pdf_table` (fillable PDF – `columns: [{key, header}]`, `rows: [{<key>: <field name>}]`, top to
  bottom) and `pdf_overlay_table` (flat PDF – `page`, `columns: [{key, header, x, width}]`, `rowTops`,
  `rowHeight`). Fill source `appointments_table` (`columns: {<key>: date|clinician|service|clinic|amount|paid}`)
  is resolved by code from the attended appointments (`core/form-tables.ts`; amount/paid from
  `appointment.charge` when the clinic system sends one, else blank). Rows beyond the printed table, and rows
  too long for its cells, are printed on the continuation sheet as a table; a cell with its choices printed in
  it ("Yes / No") gets the chosen word circled (`forms/pdf-table.ts`). The review shows the rows under the
  printed headers; staff can edit cells and add or remove rows (`ui/components/review/table-answer*.ts*`).
- **Detection:** `forms/pdf-table.ts` `detectPdfFieldTables()` – two or more columns of row-numbered fields
  (`…Row1`, `…_2`), same left edge and width, plus numbered columns that line up with every row beside them
  (Freedom's `YESNO7…1`, numbered bottom to top); rows always by position. Post-validation
  (`ai/form-tables.ts`) turns the cell questions of a detected table into one table question, whatever
  proposed the map.
- **Flat PDFs:** `forms/pdf-boxes.ts` reads the printed answer boxes and tick boxes from the page drawing
  (`PdfFormOutline.boxes`, kind `box` / `tick` – squares up to 18 pt; `slots` between printed slashes or comb
  cells). Rules mode proposes one question per box / tick row (`ai/form-boxes.ts`); post-validation snaps any
  overlay onto its printed box (inset 2 pt), adds `dateSlots` (DD / MM / YYYY between the slashes) and turns
  yes/no and choices on tick boxes into `pdf_overlay_ticks` (an X in the chosen box,
  `forms/pdf-overlay-marks.ts`). `FormDefinition.uppercase` (set when a flat form asks for BLOCK CAPITALS)
  prints overlay text in capitals and is part of the attested map hash when set. The live outline lists the
  boxes ("answer boxes: …", "tick boxes: …"); on a fillable PDF it lists a table of fields (3+ rows) once
  ("table of fields … rows=N columns=[…]") and a printed signature box no field covers (S7).
- **Snapping (S7):** an overlay is snapped onto a printed box only when at least half of the smaller of the
  two AND at least 40 % of the overlay lie on it – a region over unprinted lines that merely clips a box (Aviva
  CM016's address over the e-mail line, GEN030's history table over the doctor's signature) stays where it
  was proposed instead of taking another question's box.

## RED wave 1 integration (09/10/2026)

Six slices built in parallel off `demo/red-physio` and merged in this order (`git merge --no-ff`):
S4 data/patient → S1 fillable PDFs → S2 tables + flat boxes → S3 sections + parties → S5 demo assets +
footer → S6 copy answers + portal questions. Every exhaustive switch now covers every new anchor
(`pdf_char_fields`, `pdf_table`, `pdf_overlay_table`, `pdf_overlay_ticks`), fill source (`fixed`,
`appointments_table`), answer type (`table`) and form kind (`questions`). Cross-slice regression tests:
`scripts/medreport/red-integration.test.ts`.

**Integration fixes (each with a test):**
- `formAnchorPdfFieldNames` includes a fillable table's cells: the preview highlights them, post-validation
  orders the table by its first cell, and picking one of the table's own cells keeps the table anchor.
- A table filled from the appointments counts as "from records" in the question breakdown; a `fixed`
  answer on a table gives one problem, not two; `resolveFixedValue` never returns rows.
- `core/form-tables.ts` reads the typed `AppointmentSchema.charge` (S4) – fee and paid columns fill.
- Sections and parties (S3) reach the new answer spaces: rules mode gives flat-PDF box questions and
  character / option groups the section printed above them; post-validation looks up `pdf_char_fields`,
  `pdf_table`, `pdf_overlay_ticks` and `pdf_overlay_table` too.
- `ai/form-classify.ts`: "Title (please tick)" → `patient.title` (Bupa's radio now ticks Mrs for Case C).
- Portal question sets: "Membership number" / "Authorisation code" → `referral.membershipNumber` /
  `referral.authorisationNumber` (withheld on another insurer's questions, as on forms).
- `forms/pdf-acro-fill.ts` `ensureTextFieldDA`: a text field whose `/DA` sits on its widget, parent or the
  AcroForm (Allianz Care's pre-authorisation form) no longer crashes the fill (pdf-lib's `setFontSize`
  reads only the field's own `/DA`).
- `fitText` never starts below 8 pt: a field asking for 6–7 pt took every answer as "too long" and sent it
  to the continuation sheet.
- The red DRAFT line and watermark are placed in the VISIBLE page (crop box and `/Rotate`), like the demo
  notice: on Aviva CM016 (media box larger than the crop box) the line used to fall outside the page.

**Prompt versions (decision).** The live analysis request changed with the wave 1 engine (a required
`completedBy`, eight registration paths, new outline markers), so `FORM_ANALYSIS_PROMPT_VERSION` was bumped
to **`form-analysis-4`** and the rules reader to **`rules-2`**. The prompt text was then rewritten for it
(S7, below) under the same label: `form-analysis-4` was never recorded with the earlier text. Nothing recorded
breaks: the four recorded analyses keep their own `"form-analysis-3"` stamp and are stored
`FormDefinition`s, matched by file SHA-256 and validated by `FormDefinitionSchema`, where every new member is
optional (pinned by a test). `forms-7` (drafting) is unchanged.

**What post-validation builds whatever proposed the map** (pinned by the fake-client tests in
`red-integration.test.ts` and `live-prompt.test.ts`): `optionLabels` (from the outline's printed labels),
`optionFields` (from `optionAnchors` on PDF tick boxes – and from the whole tick-box group when only one of its
boxes was proposed), `pdf_char_fields` (any box of a character group), `pdf_table` (any cell of a detected
table), `pdf_overlay_ticks`, `dateSlots` and `ruledRows` (overlays snapped onto printed boxes) and
`completedBy` (the outline's party wins over the proposal's). `demoNotice`, `uppercase` and `fixed` are set by
code or staff, never by the model.

### Live form analysis on the RED engine (S7, 09/10/2026, branch `red/s7-live-prompt`)

**Prompt text (`ai/form-analysis.ts`, still `form-analysis-4`).** "## The input" describes every outline
marker: `printed=[…]` option labels, `character-boxes=N`, tick-box groups, tables of fields, printed boxes with
no field (fillable PDFs), `answer boxes:` with `slots=` / `lines=` and `tick boxes:` (flat PDFs), `section=` /
`completedBy=`. Under fillSource: the eight new registration paths, `first_score` / `latest_score` for
"Initial" / "Current" score boxes (never a computed figure for a choice), `appointments_table` for a table that
lists treatments and fees, and `signoff` only in the clinic's own declaration or signature block. A new
section 5 says who completes each part (clinic / patient or policyholder / doctor / insurer) and that another
party's part is ALWAYS `leave_blank` – never registration, notes, opinion or sign-off; a form the clinic does
not complete (a patient's claim form, a GP's report) is all `leave_blank` except the treatments-and-fees table.
One question per tick-box group with EVERY box in `optionAnchors` (replaces "map the question to the 'Yes'
box"); flat overlays are the printed box itself, a tick row one rectangle over its boxes; a table mapped once
at its first cell; BLOCK CAPITALS needs no question; the "Other – please specify" box, the clinic's provider
number and a scheme's number are `leave_blank`; notes and warnings never mention other readers.

**Outline (`ai/form-outline.ts` `pdfOutlineSpaces`).** A fillable PDF's tick-box group (`detectOptionGroups`)
and table of fields (`detectPdfFieldTables`, 3+ rows) are ONE line each and never split across chunks (AXA's
therapist type was split across two chunks and mapped box by box); printed signature boxes no field covers
(`printedSignatureBoxesOf`, the same boxes rules mode maps) are listed in reading order and named in their
chunk's instruction ("…and in the printed box with no field at page 4 box x=… y=…"). Freedom's outline shrank
from 14.9k to 9.5k characters (6 chunks → 4).

**Schema and post-validation.** `FILL_KINDS` gained `appointments_table` (a table of fields → the table
question filled from the appointments; anywhere else drafted from the notes, low confidence, with a note).
Post-validation also: widens a lone box of a tick-box group to the group (a second box of the same group merges
silently); sets `first_score` / `latest_score` from an "Initial" / "Current" label; turns a computed figure on a
choice into `notes_narrative` (AXA's 0–10 VAS drop-down); drops a drop-down's "Please select" from the options;
leaves blank a planned count proposed as sessions attended ("Number of sessions" under "Treatment Plan"), the
"Other – please specify" box and numbers the record does not hold (`LabelClass.notHeld` / `plannedCount` in
`form-classify.ts`); says "Printed box with no fillable field" (not "Flat PDF") for a fillable form's box.
Rules mode gives the same maps as before on all 11 forms (diffed).

**Live sweep (`claude-sonnet-5-5`, effort low, 09/10/2026; scratch scripts, Case C fills rendered and read for
Bupa, AXA, Freedom and Aviva CM016).** Before = the form-analysis-3 text on the wave 1 request; after = the
final prompt (4 rounds). "Cold" prices every prompt token as a cache write. Wrong-party sign-off: **0 on every
form in all 5 rounds**.

| Form | Before | After | Wall time | Prompt / output tokens (cold cost) |
|---|---|---|---|---|
| Bupa further-treatment (26 answer spaces) | 26/26, every source and party right | 26/26, every source and party right, in all 4 rounds | 18.6 → 14.1 s | 40.9k / 6.0k ($0.16) → 47.1k / 6.0k ($0.18) |
| AXA treatment plan (32) | 31/32 – signature box missing (no field); therapist type and contact method mapped box by box (2 extra questions, 1 dropped); ADL Yes/No as opinion | 32/32, every source and party right in the last 2 rounds (before: ADL Yes/No as an opinion; once "Other – specify" from the record and the plan's "Number of sessions" as attended – both now caught in code); signature written in the printed box; one question per tick-box group | 17.2 → 15.0 s | 65.1k / 8.7k ($0.25) → 72.6k / 8.1k ($0.26) |
| Freedom claim form (35) | every space blank, the expenses table too (the policyholder's) | expenses table filled from the appointments (fees, paid circled); the rest blank (policyholder / patient); no sign-off | 17.9 → 15.8 s | 129.1k / 17.7k ($0.50) → 85.7k / 8.9k ($0.30) |
| Aviva CM016 (flat, 8 pages) | 55, all blank (patient / GP parts) | 54–55, all blank in 3 of 4 rounds (once patient details as the clinic's); no sign-off | 24.8 → 23.7 s | 193.1k / 13.0k ($0.61) → 203.3k / 12.7k ($0.64) |
| Aviva GEN030 (flat, GP report) | 15; the medical attendant's questions answered as the clinic's | 14–16; all blank (the doctor's form) in the last 2 rounds, before that the patient's identity at the top as the clinic's; no sign-off | 14.1 → 14.2 s | 22.1k / 3.7k ($0.09) → 26.2k / 3.9k ($0.10) |
| Allianz Care pre-authorisation | 68; section 2 mixed clinic / doctor | 56–60; section 2 mostly the doctor's, a few boxes the clinic's; no sign-off | 18.1 → 16.4 s | 109.6k / 18.6k ($0.46) → 121.9k / 16.4k ($0.47) |
| Harrow & Pike / Northfield / Kingsway / Meridian / Ashcroft (samples) | 22/22, 23/23, 21/22, 17/17, 15/16 same answer spaces as the pre-confirmed maps | 22/22, 23/23, 21/22, 17/17, 14–16/16 | 9.5–12.3 → 9.7–12.4 s | about +5k prompt tokens each, same output |

Remaining differences on the samples are the known ones (Kingsway's functional capacity one dotted line lower,
as in the recordings; Northfield's diagnosis or discharge tick as an opinion in some runs; office-use boxes now
`completedBy: insurer`; Meridian's declaration cells sometimes as their content controls; Ashcroft's estimated
overlays a few points off where no box is printed). **Gaps:** Allianz Care still needs a hand map (split
Day / Month / Year and phone parts read as 2-row "tables", section 2's party inconsistent); Aviva CM016's
address rows are not detected as printed boxes, so their overlay is estimated (it now no longer takes the
e-mail box); who completes CM016's and GEN030's patient details varies between runs (hand maps decide);
`forms-7` (drafting) still does not describe table questions for question sets (S6).

**Real insurer PDFs (rules mode, scratch smoke run, Case C):** Bupa 26 questions (title Mrs, DOB and
declaration date in the comb boxes, membership DEMO-POL-0001, sign-off only in the therapist's
declaration); AXA 31 (5 character-box dates, option groups, referred Yes ticked visibly); Aviva CM016 50
box questions (section 4 is "medical practitioner" → left blank in rules mode; the hand map decides);
GEN030 15; Freedom 35 with one 7 × 5 appointments table (fees £70 / £55, paid circled, last unpaid);
Allianz Care 68, fills now, but its split Day / Month / Year boxes and phone parts are not grouped (S2
reads two of them as small leave-blank "tables") and most of its fields get no party in rules mode
(section 1 is the patient's, section 2 the doctor's) – a hand map is needed before it is shown. Rules maps still need staff checking (or the hand-made demo maps) before the call.


## RED wave 2 integration (09/10/2026)

`red/s7-live-prompt` (live form analysis, above) merged into `demo/red-physio` (`--no-ff`, no conflicts). The
demonstration answers for Case C were prepared in parallel, in the gitignored demo-assets folder only (never
in git): maps for all six insurer PDFs (`maps/<sampleId>.json`, `demo_prewritten`), and answers
(`drafts/sim-pat-006__form-<sampleId>.json`, `demo_recorded`, `forms-7`, medium effort, stamped) for the three
forms the clinic drafts on – Bupa's further-treatment form (10 drafted answers, 5 shortened or reworded by
hand), AXA's treatment plan (12, 6 by hand) and Allianz Care's pre-authorisation (10, 3 by hand; 5 left blank
with a gap: the notes do not hold them). Every hand edit is listed in the file's `note`. Aviva CM016, Aviva
GEN030 and Freedom's claim form need no answers file: their maps give `planDraftGroups` nothing to draft
(record values, the appointments table, or another party's blanks). `npm run demo:check`: 6 maps, 3 answer
files, 6 form files, no problems. Replayed through the real demo path, every DRAFT renders with 0 fill warnings.

**Assembly fixes from the live recordings (`ai/assemble.ts`, each with a test; they change no prepared answer
for the insurer forms – only Daniel Brooks's built-in fitness-for-work report now prints "Ashby Freight Ltd
(fictional)"):**
- **Another insurer's name** (`core/form-record-rules.ts` `otherInsurerOnForm`, `withoutOtherInsurerName`):
  on a form from a DIFFERENT insurer than the one on record, drafted wording says "the insurer" instead of its
  name – the notes' "Further treatment request to Bupa" came back as "…request to Bupa…" on AXA's and Allianz
  Care's forms in every live run. A bracketed name is dropped ("with the insurer (Bupa)"). The insurer's own
  form, and other referrer types (solicitor, MLC), keep the name; a question that asks for the patient's
  insurer is still answered by code (`referral.insurerName`).
- **"(fictional)" labels** (`core/voice.ts` `fictionalNames`, `keepFictionalLabels`): a name the record itself
  labels "(fictional)" ("Kents Hill Medical Practice (fictional)") gets the label back when a draft drops it
  (both live AXA and Allianz Care runs did). A real record holds no such label, so nothing changes for it.
- **Repeated bracket** (`core/voice.ts` `collapseRepeatedBrackets`, inside `expandNoteShorthand`): "8 wks (8
  weeks)" was written out as "8 weeks (8 weeks)"; a bracket that only repeats the words before it is dropped.
- Checked on the saved RAW live output of all wave-2 recordings (26 groups, 97 answers and gaps), re-assembled
  with the new code: no other insurer named, no "(fictional)" missing, no repeated bracket.

**Known limits of LIVE drafting on the insurer forms (the prepared answers are not affected):**
- **Box size:** `forms-7` allows a long answer up to about 200 words and is not told how big each box is, so
  live answers overflow on Bupa (subjective / objective / treatment boxes, 3 of 3 runs), AXA (treatment plan,
  daily-living details) and Allianz Care (two-line boxes) and continue on the continuation sheet (the fill
  warns). For the call, draft these forms in demo mode. Fix later: give each answer space's capacity to the
  drafting prompt (a `forms-8` change with a live sweep).
- Not caught by code: an event's date taken from the note that records it ("carried bags on 24/09/2026" for
  a flare recorded then), current medication listed under "other conditions", "cuff" for rotator cuff and
  BESS/BOA left abbreviated (not in the glossary – adding it changes both prompts' versions).
- Replayed answers are written in the person recorded: Bupa's in the third person (no signer sent), AXA's and
  Allianz Care's in Sarah Reid's first person (she is the default signer).


## RED call fixes (10/10/2026, from the prospect's-eye and rules reviews)

**Wording on the form.**
- **Plain clinical wording** (`core/voice.ts` `plainClinicalWording`, `inOwnClinicalWording`): the signer's own
  record is written as a clinician writes a form, not as record-keeping – "On 01/10/2026 I recorded that X" →
  "On 01/10/2026, X"; "I recorded an assessment of X" → "Assessment on 01/09/2026: X"; "a further treatment
  request to Bupa for 4 sessions" → "Further treatment requested on 01/10/2026: 4 sessions"; "the goals …
  as:" → "Goals for …:"; "the guideline followed as" → "Guideline followed:"; "in the past medical history"
  → "Past medical history:". Applied on assembly to first-person drafts, and by "Write in my own voice",
  which now also takes a paragraph that only says "she recorded" when it cites the author's own notes. No
  date, figure or citation changes (the lead date of a reason or goals line is dropped). Other clinicians'
  attributions are untouched.
- **Whose box is blank** (`core/parties.ts` `blankFor`, `blankForWording`, `blankForSummary`): "For the
  patient to complete", "For the patient's GP or doctor", "For <referrer>'s office", "Left blank – not
  needed"; form cards and the mapping screen count them by party ("50 for the patient or their GP").
- **Prefill-only forms** (`prefillSigners`): a form with no sign-off box of the clinic's own and another
  party's signature box left blank (a patient's claim form, a GP report) is approved as a checked prefill –
  `PREFILL_ATTESTATIONS`, its own declaration note and dialog wording ("Approve the prefill"), "Prefill
  approved – ready for … to complete and sign", filed as "prefilled for … to sign", files `_PREFILLED`,
  never `_SIGNED`.

**Record values.** `ComputedFactFormat` `first_scores` / `latest_scores` (every outcome measure with its first
or latest score: Bupa's "Outcome measures" box); `RegistrationPath` `patient.addressLines` /
`patient.postcode` (`splitUkAddress`; a ruled box with fewer rows than lines puts the extra lines on its last
row – `forms/pdf-fill.ts` `joinExtraLines`). A date or number question can be answered "N/A" (written on the
form – the first character boxes of a DDMMYYYY date – and copied as N/A).

**Review.** A value typed by staff for a missing record value shows "Entered by staff" / "Typed in by staff –
not from the clinic record" and supersedes an earlier "left blank" acknowledgement of its gap
(`supersedeAcknowledgedGaps`). Copied answers are numbered as on the form (F-07 → 7) and count the same
questions as the progress summary. Citation chips read "Registration", "Attendance record", "QuickDASH
scores". The upload dialog collapses repeated "no fillable fields" notes.

**PDF fill.** Multi-line boxes get a 2.5 / 2 pt inner margin (unless it would overflow); boxes in one printed row
share one font size; a print-ready file (trim box inside the crop box) is completed at its trimmed size, without
crop marks.

**Hygiene.** Prompt examples, test fixtures and comments use wording of our own – no insurer's question text
in git. `demo:red` stays in demo mode unless `--live`; replayed drafts log the neutral engine name.

## Production wave 3 – ordinary clinic notes (notes import, 10/10/2026, branch `prod/w3-notes`)

A clinic can now upload the notes its own system prints, in whatever layout, and check what was read before the
record is built. Before this, only our documented layout (JSON / CSV / text, or a PDF printed in that layout) was
accepted and ordinary notes PDFs were refused (end-to-end review e2e#3).

**Flow.** The Studio's source step (both Studios) posts the upload to `POST /connectors/file-import/read`
(`api/handlers/file-import-read.ts` → `connectors/file-import/connector.ts` `readNotesUpload`):
1. **Documented format first** – JSON, CSV, text, and a PDF or Word document whose text is in the documented layout
   (`parser.ts`). If it parses and every note has an author, the bundle comes back straight away (as before). A CSV
   whose header row names every documented column reports its mistakes as before; a Word document with a table of
   three or more columns is never tried as the documented layout (a table row is not a heading).
2. **Otherwise the general notes reader** (`general-notes.ts`) reads the upload as clinic notes and returns a
   **NotesReview** (`review-contract.ts`, browser-safe zod): registration fields (editable), one entry per dated
   block (date, time, clinician name / HCPC, type, attendance status, the heading lines and the note's text exactly
   as written, where it was found, included or not), outcome scores, an attendance flag and plain-English warnings.
   Nothing is built, stored or drafted.
3. Staff check it in the **review panel** (`ui/components/new/notes-review.tsx`, state helpers in
   `notes-review-model.ts`): registration table with "From the notes" / "Not found" / "Required" tags; entries with
   editable date, time, clinician (known clinicians, "Someone else…", "Not recorded") and type, "Include" tick box,
   the first lines and "Show the full text"; a bulk "Clinician for these entries → Apply"; live counts
   ("4 entries · 1 clinician · 5 outcome scores") and blockers ("3 entries without a clinician – choose one", "no date
   found for 1 block …", "enter the date of birth"). "Use these notes" stays disabled until nothing blocks.
4. `POST /connectors/file-import/confirm` (`file-import-confirm.ts` → `review-bundle.ts` `bundleFromReview`) checks
   everything again and builds the bundle **exactly as for any import**: the review becomes an ImportDocument and
   goes through `parser.ts` `bundleFromImportDocument` → the sim mapper (N-001… in date and time order, A-001…,
   OM-<instrument>, clinicians once each, computed facts, data checks). Labelled `S:`/`O:`/`A:`/`P:` (or the words,
   `PMH:`, `SH:`) lines fill those fields; other text is the note's other text; an entry with no text keeps its
   heading. With an attendance record each status is an appointment (attended → linked to its note; a missed or
   cancelled appointment without text is an appointment only, with its reason). Added afterwards (no import-format
   field): a medico-legal company / "other" as the instructing party's type, the insurer's membership and
   authorisation numbers, `referral.referredBy` and `registration.gpPractice` (new optional bundle fields, never in
   the drafting payload – `core/validation/sources.ts` `registrationLines` is a whitelist).

**What the reader recognises** (all conservative – unclear values are left blank, with a warning where useful):
- **Inputs** – PDF text layer (`pdf-notes.ts` `readPrintedNotes` / `pdfPagesToBlocks`: lines kept as printed; page
  numbers and lines at the top or bottom of every page dropped, a repeated "Label: value" header line kept once;
  scans refused: "scanned notes cannot be read"), Word (`docx-notes.ts`: paragraphs and tables through the forms
  engine's Word helpers), text, CSV (header row found below title lines; `Key,value` rows above it are header
  lines) and pasted text.
- **Entries** – a line that starts with a date: `18/03/2026`, `8/3/26` (notes only; a two-digit year more than a
  year ahead is not a date), `18 March 2026`, `18-Mar-2026`, `Mar 18 2026`, `March 18, 2026`, `2026-03-18`; after an
  optional bullet, markdown, `Date:` / `Appointment:` / `Session date:` …, or a weekday; with an optional time
  (`09:00`, `9.30am`, `2pm`, ranges). A date alone on a line with nothing under it is ignored (warning); a date line
  followed by "Dear …" is a letter's date. Text before the first note that is not a registration or title line
  becomes a block without a date (left out until staff date it). Tables with a date column and a notes, SOAP,
  treatment or clinician column give one entry per row (date, time, clinician, HCPC, type, status, reason, NPRS /
  ODI / NDI / PSFS / QuickDASH columns; patient, DOB, insurer, policy and claim columns used when every row agrees).
- **Heading text** – type (initial assessment / IA / new patient, follow-up / FU / review / treatment, discharge,
  telephone), clinician (`Name (HCPC)`, `Name, Physiotherapist, HCPC …`, or a bare name between separators,
  checked against a list of clinical words), status (attended, DNA / did not attend, late cancellation, cancelled,
  booked) and `Key: value` details on or under the heading (`Practitioner:`, `Time:`, `Type:`, `Status:`, `HCPC:`).
  Any other heading text is part of the note. A clinician not in the heading comes from a signature at the end
  (`Signed:`, `Seen by`, `— Name (HCPC)`, "Kind regards" + name, the HCPC number on the next line). The same name
  with and without a number in different entries gets the number.
- **Registration** – `Label: value` lines before the first note, several per line: patient / name / re (title,
  first and last name, "Surname, First" too), first name, surname, title, date of birth / DOB / D.O.B. (also inline:
  "Re: …, DOB 03/02/1979"; a two-digit year is never completed), sex, address (with continuation lines; a trailing
  postcode is split off), postcode, phone / mobile, email, occupation, employer, insurer, membership / policy number,
  authorisation number, their reference / claim number ("Our ref" ignored), instructing party / solicitor / case
  manager / medico-legal company, referred by, GP practice, date of accident, how it happened, consent (yes / no and
  its date). Identifiers must contain a digit; phones need 10–13 digits; emails a proper address. When no
  instructing party is written, the insurer (or a "referred by" naming a solicitor, insurer, case manager or
  medico-legal company) is offered as who the form is for, with "Taken from the insurer line – check it".
- **Outcome scores** – `NPRS 7/10`, `QuickDASH 52.3`, `PSFS 2.7`, `ODI 48%`, `NDI 42%` (`NDI 21/50` → 42), with the
  entry's date or a date written after the score; lists ("7/10 (18/03/2026), 3/10 (15/04/2026)"). Ranges
  ("3-4/10"), a pain score as a percentage, and one instrument with two different undated values in one note
  ("from 6/10 to 3/10") are left out with a warning.

**Audit.** `notes.imported` (`AUDIT_ACTIONS.notesImported`, `api/handlers/file-import-response.ts`) for a clinic's
member on every import that gives a bundle – `/bundle`, `/read` with the documented format, `/confirm` – detail
`{format, layout: "documented"|"general", notes, appointments, outcomeScores, clinicians}` plus, on confirm,
`entriesLeftOut`, `detailsFound`, `detailsFilled`. Never names, notes, file names or clinicians. Activity page label
"Patient notes imported" (`src/lib/activity-copy.ts`), e.g. "4 notes, 4 appointments, 7 outcome scores · from a PDF ·
checked before use". Reading the notes (a review) records nothing. Logs: `notes_read`, `notes_confirmed` (counts).

**Copy.** Review copy lives in `review-contract.ts` `NOTES_REVIEW_COPY` / `NOTES_REVIEW_FIELD_LABELS` (neutral;
`notesReviewCopyStrings()` is checked against the banned terms). The format guide, the clinic's notes help and the
upload hints now say notes in any layout are read and checked before use.

**Tests.** `scripts/medreport/notes-import.test.ts` (26) with FICTIONAL fixtures in `scripts/medreport/notes-fixtures.ts`:
a practice-system printout (text, and a two-page PDF built with pdf-lib with a running header and page numbers), a
letter-style Word document (letter date, Re: line, details table, undated opening paragraph, signature with the HCPC
on the next line), a Word notes table, a CSV appointment export (DNA and cancelled rows, NPRS column), email-style
pasted notes (weekday, 12-hour time, three date styles, sign-off), a diary with uncertain details, and the documented
format (still read first: pasted text, the JSON / CSV / text samples and the Priya Nair PDF). Also the review → bundle
build, both endpoints (401, demo, a clinic member's audit row holding counts only, 422 issues), the review model, a
render of the panel in both Studios, and the wording.

**Browser check.** `scripts/e2e/notes-import-check.cjs` (tenant mode, LOCAL SQLite only): owner invitation → account
→ two-step; uploads the PDF, both Word documents, the CSV and the email text, pastes the printout, the uncertain
notes (nothing guessed; confirm blocked until staff fill them in) and the documented layout (no review); browser
storage holds nothing from the notes; the review fits 375 px; the activity lists the imports. Set-up:
`node --import ./scripts/medreport/test-setup.mjs --import tsx scripts/medreport/write-notes-fixtures.ts <dir>`; an env
file with `CLINFORMS_DB=sqlite`, `CLINFORMS_SQLITE_PATH`, test-only `BETTER_AUTH_SECRET`, `CLINFORMS_DATA_KEYS` /
`CLINFORMS_DATA_KEY_ID`, `BETTER_AUTH_URL=http://localhost:3141`; `node --env-file=<env> … scripts/admin/create-clinic.ts
… --app-url http://localhost:3141 > invite.txt`; `node --env-file=<env> node_modules/next/dist/bin/next start -p 3141`;
then `INVITE_FILE=… INPUTS=… BASE=http://localhost:3141 RUN_ID=… NODE_PATH=<playwright> node scripts/e2e/notes-import-check.cjs`.

**Not built – assisted structuring ("Organise these notes"), a scoped follow-up.** Deliberately left out of this
wave rather than shipped half-done: it sends a patient's notes to the drafting service, which the clinic must have
switched on (and, for a real clinic, a signed DPA covers). Design when it is built:
- `POST /connectors/file-import/organise` (actor): the same upload body; allowed only when the clinic has drafting
  on (`clinic_profile.drafting_enabled`) or, in the public demo, with the live passcode; counted with the drafting
  limits (`ai/live-gate.ts`, shared counters).
- Input: the upload's lines numbered (`L001: …`), minimised with `ai/prompts.ts` `createMinimiser` built from the
  registration the reader found, every date of birth removed (labelled and inline, `dobPatterns`), phone numbers,
  emails, postcodes and NHS-style numbers replaced as in drafting; registration lines are not sent at all.
- Output: a strict JSON schema (structured output, as the drafting call) – entries as LINE RANGES with date, time,
  clinician index, type and status; no text. The server maps the ranges back onto the original lines, so every
  note's text stays verbatim; registration and scores still come from the reader's own patterns.
- Shown in the same review step as "Organised structure – check it", never accepted automatically; staff confirm
  as today. Audit `notes.organised` with counts only (lines sent, entries proposed); a neutral button label and no
  vendor names. Tests with a stubbed client (schema, range validation, minimisation of every DOB form).


## Fix wave 3 – notes import on real exports, linear time, consent for uploads (10/10/2026)

From the wave 3 security and end-to-end reviews (a practice-system "Clinical Notes Report" PDF, a booking-system CSV
and a Word progress letter, all fictional). Tests: `scripts/medreport/notes-import-realistic.test.ts` (fixtures in
`notes-fixtures.ts` §8) plus the updated `notes-import.test.ts`; browser check `scripts/e2e/notes-import-check.cjs`
(now 15 steps, the three realistic exports included; local SQLite only).

**Security.**
- *Linear time.* Every reader step walks a line once: trailing runs are trimmed by `connectors/file-import/text-runs.ts`
  (no `/\s+$/`-style regexes), heading separators are split in one pass (`splitHeadingSegments`), a heading is matched
  on the first 300 characters of a line, "Label: value" lines and signatures only on lines up to
  `STRUCTURE_LINE_CHARS` (1,000), scores with sticky patterns; the documented-format parser collapses a heading's
  whitespace before splitting it, and the confirm-side section split (`review-bundle.ts splitNoteText`) is linear.
  Regression: 200,000-character padded lines in every format and on confirm finish in well under 1.5 s.
- *Limits.* `/connectors/file-import/read`, `/confirm` and `/bundle` take one slot of
  `FILE_IMPORT_PER_ACTOR_PER_MINUTE` (30, per sign-in or demo session) and `FILE_IMPORT_PER_CLIENT_PER_MINUTE` (90, per
  address) – `api/handlers/file-import-response.ts takeFileImportSlot`, shared `rate_limits` counters, keys are keyed
  hashes → 429 `RATE_LIMITED` + `Retry-After` (wording `WORDING.server.access.importLimit*`).
- *Store growth.* An update with If-Match that makes a report or form map larger counts the growth through
  `takeNewData` (report: `StoredReportMeta.storedBytes` from `length(payload_enc)`; form map: the stored copy's size).

**Reader (`general-notes.ts`).**
- Numeric dates use ONE separator (`2-3/10` is a pain range, never 02/03/2010). A line that starts like a date with no
  other note date within 400 days (and at least two others) is kept as text of the note above, with `DATE_OUTLIER`.
- Headings: durations ("Follow Up (30 min)") come off before the type; "Name (Physiotherapist)" / "Name, Role" are
  clinicians; "Admin Note", "Reception", SMS, e-mail, letter entries are left out by default (`ADMIN_LEFT_OUT`); a
  status in brackets ("(attended)", "did not attend (unwell, …)" → DNA with that reason); commas inside brackets do not
  split.
- Signatures: "Electronically signed by Name MCSP, HCPC … on <date> <time>" (post-nominals and the date ignored); the
  HCPC number from a signature completes the heading's clinician of the same name; a closing "Name, Physiotherapist" on
  a note's last line. A LETTER (a date line above "Dear"/"Re:"/"Our ref") gives its signer to every entry that names
  no clinician (`SIGNATURE_APPLIED`), offers its addressee (an insurer, solicitor…) as who the form is for, and returns
  `letterDate` – the review offers "Use the letter's date" on undated blocks.
- Attendance: statuses at the start of a note ("Status" heading line, "Did Not Attend. …", "Pt DNA"), in CSV words
  ("Did not arrive", "Cancelled < 24 hrs" → LCN). `review-contract.ts reviewAttendance`: attendance is counted only
  when EVERY included dated entry has a status and a time (server and Studio alike); a part-record is never counted.
- Registration: "Funding:" / "Payer:" = insurer; "Policy:", "Auth:"; identifiers with a trailing note ("AUTH-55120 (6
  sessions)"); policy / authorisation / claim numbers inside a "Re:" line; a two-column patient box whose address
  carries on beside "Employer:"; a referrer line without the claims handler ("Org – J. Barker, Claims Handler");
  unrecognised "Label: value" header lines come back as `otherDetails` ("other details in the notes (not used)").
- Tables: date columns by more names ("Appointment start", "Date/Time", "Start date", "Patient DOB" is the date of birth)
  and by content (most cells are dates); with no named notes column, the longest text column; a CSV with no dates is
  refused in plain English naming its columns (never one undated block). A table whose header cells carry dates
  ("Initial (01/07/2026) | Latest (12/08/2026)") gives one score per cell with its column's date (`SCORE_TABLE`), never
  read again from the text. A bulleted entry (Word list paragraphs, "•" lines) ends with its list.
- PDF (`pdf-notes.ts`): running header/footer lines are matched with page numbers normalised ("Page 1 of 3") and dropped
  only at a page's edge; a repeated "Label: value" line is kept once only from page 1's HEADER – a footer naming the
  patient and their number is never note text.

**Review step and record.**
- `notes-review.tsx`: an Attendance select on every entry, "Mark the others as attended", plain notices for partial
  attendance and missing times (not blockers), consent tagged "Needed for approval" with one line of explanation, the
  admin hint, other details, and the clinic's own clinicians (`HostHooks.clinic.clinicians`, from
  `src/server/auth/studio-access.ts`: members other than staff, name + HCPC) in every clinician list; a member named in
  the notes without a number gets the member's number (`withMemberNumbers`).
- `review-bundle.ts`: a missed or cancelled appointment is an appointment with its reason (the entry's reason, else
  its text without the "Status" line or the e-signature), not a clinical note (unless the text is too long for a
  reason); bare section headings ("Subjective", "Objective", "Plan", "Clinical Impression"…) fill their fields, other
  known headings go back to the other text; commuting ("cycling to work") is not a workplace injury; blocker wording
  `missingFieldText` ("enter who the form is for", "choose what kind of organisation the form is for").
- Consent: `CONSENT_NOT_RECORDED` for a `file-import` bundle says to record it on the report; the Flags tab offers
  "Record consent" (date given, not in the future) to a member who may approve (anyone in the public demo) –
  `review-model.ts recordConsent` sets `bundleSnapshot.consent` and adds a `consent_recorded` activity entry.
- Figures: a cited note's short dates ("26/08", two-digit "07/10") support the drafted full date in the note's year
  (`core/validation/text.ts addShortDatesToIndex`); pain scores ("7/10") and shorthand ("3/12", "6/52") never do.
- Minimiser (`ai/prompts.ts`): every part of a multi-word first name and "First Last" are masked; patient numbers
  ("Patient no.: AP-004127", "(AP-004127)") and letter+digit references become `[ID]`.
- Copy: "Policy or membership number", "Their reference (claim or case number)"; the review offers the policy number
  for a referrer's own reference when the record holds none; no integration log in a clinic's Studio; "HCPC number not
  recorded"; the appointment-figures gap says "Count the attended and missed appointments in the notes"; upload copy
  says "as your clinic system prints or exports them" instead of "any layout".
- PDF fill: multi-line answers are written with the line breaks the fill chose (inside the box less border and
  padding), so no viewer runs a word past the right edge; a cut never ends "word.…"; continuation pages print
  "Claimant: … · Reference: …" and "Continuation sheet – page n of m" (`FillOptions.continuationLabel`, set by
  `/render`). The form preview retries a failed load once and logs why; the Studio footer says "Security (website)".

**Not changed (reviewed):** drafted-wording slips (a patient as the subject of "recommended", verbless sentences) are
drafting variance – the existing validators and the clinician's review stand; a dedicated check is a follow-up.
