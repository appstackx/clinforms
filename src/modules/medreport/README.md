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
- **Fictional data only.** Organisations end with "(fictional)". HCPC numbers use the invalid demo
  format `PH-DEMO-01`. Reports are stored in the browser only (demo-grade).
- **Standalone app.** This module, the sandbox and their thin `src/app` routes are the whole app
  (`/` redirects to `/reports`). It was extracted from its original host repo (see the root
  `README.md`); the host design system is only `src/components/ui/*` and `src/lib/utils.ts` (reached
  through `ui/primitives.ts`).

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
                                      (prompt "form-analysis-3" in form-analysis.ts)
    form-analysis.ts form-analysis-schema.ts form-outline.ts form-classify.ts form-postvalidate.ts form-rules.ts
    recorded-forms.ts recorded/forms/*.json   recorded Claude analyses of the sample forms (by file SHA-256)
  templates/              built-in FALLBACK templates: registry.ts (+ extensions.ts), generated/*.docx.b64.ts
  docgen/                 server-only: built-in template rendering – view-model, docx, docx-validate, pdf, pdf/*
  forms/                  server-only: the referrer-form engine
    file.ts               decodeFormFile (type from bytes, size cap, SHA-256), assertFormFileMatches
    docx-dom.ts           one shared walk of the Word XML, so a block ID means the same place to outline and fill
    docx-outline.ts       buildDocxOutline(buf) → {blocks: OutlineBlock[], warnings}
    docx-fill.ts          fillDocx(buf, form, answers, opts) → Buffer (Word in → Word out; DRAFT banner, review markers)
    pdf-outline.ts        readPdfForm(buf) → PdfFormOutline + classification (acroform | flat) + warnings
    pdf-sections.ts       section heading + completedBy party for every PDF field and text item (hooked into readPdfForm)
    pdf-fill.ts           fillPdf(buf, form, answers, opts) → Promise<Uint8Array> (shrink to fit, continuation sheet, flatten)
    render-form.ts        shared rendering steps, review markers, the warnings header and file names
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
  ui/                     primitives.ts, store.ts, api-client.ts, host-hooks.tsx, preview-libs.ts, components/*, screens/*
src/sandbox/tm3-sim/      config, wire-types (duplicated wire format), fixtures/, handlers, client-store, ui/
src/app/api/_medreport-glue.ts      connector registry + in-process transport + route() binder
src/app/reports/medreport-host.tsx  client-side HostHooks (write-back into the sandbox's browser record)
src/app/api/reports/v1/**/route.ts  thin: runtime="nodejs", dynamic="force-dynamic", export METHOD = route(handler)
src/app/api/tm3-sim/v1/**/route.ts  thin: re-export the sandbox handler
src/app/reports/**  src/app/pms-sandbox/**   thin pages; each layout.tsx has its own metadata
scripts/medreport/        build-templates.mjs, build-demo-forms.mjs, record-demo-drafts.ts, record-form-analyses.ts,
                          render-form-samples.ts, form-sample-answers.ts, form-fixtures.ts,
                          gen-eslint-boundary.mjs, test-setup.mjs, dev-bundles.ts, stamp-demo-drafts.ts,
                          build-notes-pdf.ts, build-prewritten-drafts.ts
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
  `@/app/*`, or any relative path that leaves `src/modules/medreport`.
- **Browser-safe code** is everything in `core/`, `templates/` and `ui/`, plus `config.public.ts` and
  `api/contract.ts`. It may NOT import `server-only`, `node:*`, the Anthropic SDK, docx,
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
| GET | `/health` | – | health.ts | `{product, version, aiMode, liveAiAvailable, model, promptVersion}` |
| GET | `/connectors` | – | connectors-list.ts | Connector tiles |
| POST | `/launch` | `x-partner-key` | launch.ts | `{connectorId, patientId, episodeId, clinician}` → `{launchUrl, expiresAt}` |
| POST | `/launch/verify` | – | launch-verify.ts | `{token}` → `{claims, session}` |
| POST | `/sessions/demo` | – | sessions-demo.ts | Demo-tenant session for the picker, uploads and batch |
| GET | `/connectors/{id}/patients?search=` | session | patients.ts | `{patients, trace}` |
| GET | `/connectors/{id}/patients/{pid}/episodes/{eid}/bundle` | session (claims match path) | bundle.ts | `{bundle, computedFacts, dataChecks, trace, demoDrafts?}` |
| POST | `/connectors/file-import/bundle` | session | file-import-bundle.ts | Upload (ImportPayload) → bundle response |
| GET | `/templates` | – | templates-list.ts | `{templates}` |
| GET | `/templates/{id}` | – | template-get.ts | `{template}` |
| GET | `/templates/{id}/docx` | – | template-docx.ts | Tagged .docx download |
| POST | `/templates/validate` | – | templates-validate.ts | `{fileName, docxBase64}` → `{ok, tags, errors, unusedTags, unknownTags}` |
| POST | `/drafts` | passcode for live | drafts.ts | `{templateId, bundle, instructingParty, sectionKeys, prefer?, effort?, form?}` → `{sections, gaps, flags, generation}`; 1–2 keys, or 1–4 field IDs with `form`; `maxDuration = 60` |
| POST | `/validate` | – | validate.ts | `{report, form?}` → `{flags, canSign, blocking}` (`form` required for a form report) |
| POST | `/sign` | session | sign.ts | `{report, signer, typedSignature, statementAccepted, attestations, form?}` → `{receipt, flags}`; the session must cover the report's patient and episode (403 `SESSION_MISMATCH`), a launch session's clinician must be the signer (403 `SIGNER_MISMATCH`), a form must carry a valid server attestation; the receipt records `formMapSha256` and `approvedVia`; 409 `SIGNOFF_BLOCKED` |
| POST | `/render?format=docx\|pdf\|original` | – | render.ts | `{report, receipt?, templateDocxBase64?, reviewCopy?, requireFinal?, form?, fileBase64?}` → file; `x-medreport-render: final\|draft`; form reports: `original\|pdf`, 503 `PDF_CONVERSION_UNAVAILABLE`, 409 `FORM_MISMATCH`; `maxDuration = 60` |
| POST | `/connectors/{id}/documents` | session | documents.ts | Signed file + receipt + `fileToken` → `{attachReceipt, trace}`. The receipt MAC is verified and `fileToken` (from the final `/render`'s `x-medreport-file-token`) must match this exact file, receipt, tenant, patient and episode |
| POST | `/forms/analyse` | passcode for live | forms-analyse.ts | `{fileBase64, fileName, referrer?, title?, prefer?, effort?}` → `{form (proposed), outlineSummary, trace?}`; `maxDuration = 60` |
| GET | `/forms/samples` | – | forms-samples.ts | `{samples: FormSample[]}` – bundled fictional referrer forms, with pre-confirmed maps where recorded |
| GET | `/forms/samples/{id}/file` | – | forms-sample-file.ts | The sample's original .docx / .pdf |
| POST | `/forms/confirm` | session | forms-confirm.ts | `{form, confirmedBy}` → `{form}` confirmed, with `confirmed {by, at, mapSha256, mac}`: the server's attestation of exactly this map (`auth/attestations.ts`) |
| POST | `/ai/payload-preview` | – | ai-payload-preview.ts | `{templateId, bundle, instructingParty, form?}` → `{model, promptVersion, blocks, systemSummary, removed, withheld}`: exactly what a drafting call would send, minimised, with no AI call |
| POST | `/forms/fill-preview` | – | forms-fill-preview.ts | `{report, form, fileBase64, mode: "draft", reviewMarkers?}` → the original file filled, DRAFT; `x-medreport-fill-warnings`; `maxDuration = 60` |

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

## Simulated TM3 API `/api/tm3-sim/v1` (scaffolding)

Every call needs `Authorization: Bearer TM3_SIM_TOKEN` (401 otherwise). Every response carries
`X-Simulated: true` and `_simulated: true`. Lists are paged with `?page=&page_size=`. Payloads are
snake_case: see `connectors/tm3-sim/wire.ts` (the module side) and `src/sandbox/tm3-sim/wire-types.ts`
(the sandbox side). These shapes are our assumption, not TM3's schema.

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
over `src/modules/medreport/**/*.test.ts` and `scripts/medreport/**/*.test.ts`. The setup file maps
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
- **Finished slices (owned by the integrator stage from now on):** the simulated TM3 sandbox
  (`src/sandbox/**`, `src/app/pms-sandbox/**` except `layout.tsx`, `src/app/api/tm3-sim/**`,
  `connectors/tm3-sim/wire.ts`, `connectors/tm3-sim/mapper.ts`) and integration (`connectors/**`,
  `auth/hmac-token.ts`, `auth/launch-token.ts`, `auth/session-token.ts`, `auth/passcode.ts`,
  `core/computed-facts.ts`, `core/validation/data-checks.ts`, the handlers `launch.ts`,
  `launch-verify.ts`, `sessions-demo.ts`, `connectors-list.ts`, `patients.ts`, `bundle.ts`,
  `file-import-bundle.ts`, `documents.ts`, `src/app/api/_medreport-glue.ts` and
  `src/app/reports/medreport-host.tsx`).

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

**Loading a bundle in a test or script** (`scripts/medreport/dev-bundles.ts`; `scripts/` may import both
the sandbox and the module, module files may not):

```ts
import { getDemoBundle, getDemoEpisodeData, listDemoPatients, DEMO_FETCHED_AT } from "./dev-bundles";
const bundle = getDemoBundle("megan-hart"); // or "sim-pat-001" / "sim-ep-1001"; "daniel-brooks" for case B
```

Bundles are deterministic (tenant `demo`, `fetchedAt` `2026-10-06T09:00:00.000Z`) and each call returns a
fresh copy. Put such tests under `scripts/medreport/**/*.test.ts` so `npm run test:medreport` runs them
with the `server-only` shim. A module test that needs a full case without importing the sandbox should
use an inline bundle, or a JSON snapshot it owns.
