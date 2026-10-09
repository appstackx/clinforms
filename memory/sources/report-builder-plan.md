# Plan: Medico-legal Report Builder demo module (CareConnect repo, TM3-ready)

## 1. Short answer: UI or API?

**We need both. The API is the product, and the UI is the first app built on it.** The API (`/api/reports/v1`) is what we sell separately and what TM3 connects to. It pulls the episode, drafts the report, checks it, has it signed and renders it. The API alone isn't enough, because the physio is the legal author. They have to check each statement against its source note, fill the gaps, write their opinion and sign. That needs a review-and-sign screen, and neither TM3 nor Dell will build one. Inside TM3 the only thing needed is a **launch point** (a button, link or widget, the way Heidi plugs in). It opens our screen with the patient already loaded.

## 2. What we'll build

This is a self-contained module, `src/modules/medreport`, served at `/reports` inside careconnect-mk. Its display name is one setting. Next to it sits a **simulated TM3 sandbox** at `/pms-sandbox`, labelled "Simulated TM3 sandbox – demo data, not affiliated with TM3".

**End-to-end flow:**
1. A physio opens a fictional patient in the sandbox and clicks "Create medico-legal report".
2. The sandbox's server asks our API for a signed launch token, and our Studio opens.
3. A connector pulls the whole episode over real HTTP: registration, all notes (with their authors), attendance and outcome measures.
4. Code computes every fact that can be checked. The AI writes only the narrative, and every paragraph must cite note or fact IDs. Without a key, a pre-written demo draft is loaded and clearly labelled as such.
5. Validators flag unsupported text, and the physio fixes the gaps.
6. The server issues a signed receipt, then renders a real .docx (from a tagged Word template, ours or the clinic's) and a real PDF.
7. The signed report is filed back to the sandbox record.

A second, real data route is available now: **upload an export**. Batch drafting covers several episodes at once. The server stores nothing, and the patient portal is not touched.

```
[Simulated TM3 sandbox /pms-sandbox]  record -> "Create medico-legal report"
   | sandbox server: POST /launch (x-partner-key) -> launch token (HMAC, 10 min)
   | browser -> /reports/new?lt=…  -> /launch/verify -> session token (claims: tenant, patient, episode)
   v
[Connector] tm3-sim: REST + Bearer to /api/tm3-sim/v1 (paged GETs)      file-import: upload export JSON/CSV
   |   both -> mapper -> EpisodeBundle (REG, N-001…, FACT-*)  [same ClinicSystemConnector interface]
   v
[Report API /api/reports/v1]  computed facts + data checks + scope rules (code, not AI)
   v
[AI draft]  Claude claude-opus-5-5 (live, passcode)  OR  pre-written / recorded draft (badged)
   |   -> validators: citations, figures, opinion language, scope -> flags + gaps
   v
[Review & sign UI /reports/[id]]  chip -> source note | resolve gaps | clinician opinion | POST /sign -> receipt
   v
[Render /render]  .docx (docxtemplater, our or clinic's template) + .pdf (@react-pdf, Unicode font); DRAFT unless receipt valid
   |
   +--> write-back: POST sandbox /documents (receipt) -> record kept in this browser -> sandbox Documents tab
```

## 3. Real vs simulated in the demo

| Area | In the demo | Status |
|---|---|---|
| TM3 server, data shapes, record screen | Our invented REST API with `snake_case` fields and neutral slate/blue styling. Labelled "Simulated TM3 sandbox – demo data, not affiliated with TM3". No TM3 logo, colours or copied screens | **Simulated** |
| Patients, clinic, solicitor, employer, clinicians | Fictional throughout; organisations marked "(fictional)"; HCPC numbers in a deliberately invalid format (`PH-DEMO-01`) | **Fictional** |
| HTTP integration: Bearer token, paged GETs, mapping, the `ClinicSystemConnector` interface | Real code, the same code a real TM3 connector will use | **Real** |
| Launch from the clinic system | The button is simulated. The partner key, HMAC launch token and session token that gates the bundle are real | **Mixed** |
| Export upload (`file-import`) | Real parser for **our documented import format** (JSON/CSV, or pasted anonymised notes). Mapping Dell's actual TM3 export waits for a sample | **Real (our format)** |
| AI drafting | Real Claude with a key and passcode. Otherwise a draft badged "Pre-written draft – no AI call", or "Recorded Claude output, {date}, {model}, prompt v{n}" | **Real or badged** |
| Citations, validators, gaps, sign blocking | Same code in both modes, on the server and in the browser | **Real** |
| Word output | Real docxtemplater, using our demo template or an uploaded tagged clinic template | **Real** |
| PDF output | Real @react-pdf in our house layout (not a pixel copy of the Word file) | **Real** |
| Sign-off | Server-HMAC'd receipt (`/sign`), checked by `/render` before a final copy | **Real (demo secret)** |
| Audit trail, report storage | Browser localStorage, labelled "demo-grade (browser)"; no login; one `demo` tenant | **Demo-grade** |
| Write-back | Real authenticated POST to the simulated API, which returns a receipt. The document itself is kept in **this browser** (`tm3sim.documents` + IndexedDB), labelled "stored in this browser – simulated record" | **Simulated target** |

## 4. Module boundary (so it can be sold separately)

```
src/modules/medreport/                     <- THE SELLABLE MODULE
  config.public.ts                         PRODUCT {name, version}; no env access
  config.server.ts                         "server-only"; resolveAiMode(), secrets, env parsing
  core/                                    pure TS + zod, no React/Next; shared by server and UI
    types.ts schemas.ts                    EpisodeBundle, Note{author{name,hcpc}}, ReportTemplate, Report, ReportFlag, SignReceipt
    computed-facts.ts                      FACT-attendance, FACT-age, FACT-episode, FACT-outcomes
    scope.ts                               per-template field stripping (e.g. employer: no PMH/social history)
    fingerprint.ts                         canonical JSON (signature excluded) + SHA-256 (WebCrypto)
    validation/ citations.ts figures.ts opinion-language.ts scope-terms.ts data-checks.ts index.ts
  connectors/  types.ts registry.ts
    tm3-sim/ wire.ts client.ts mapper.ts connector.ts
    file-import/ format.ts parser.ts connector.ts      documented JSON/CSV import format
    tm3/connector.ts                       stub: ConnectorNotConfigured + what TM3 must expose
  auth/ launch-token.ts session-token.ts sign-receipt.ts passcode.ts   (node:crypto, timingSafeEqual)
  ai/ prompts.ts draft-live.ts draft-demo.ts generate.ts demo-drafts/*.json
  templates/ registry.ts generated/*.docx.b64.ts
  docgen/ view-model.ts docx.ts docx-validate.ts pdf/ReportPdf.tsx pdf/fonts.ts pdf.ts
  api/ http.ts handlers/*.ts               framework-agnostic (req: Request) => Promise<Response>
  ui/ primitives.ts store.ts components/* screens/*
src/sandbox/tm3-sim/                       <- demo scaffolding, NOT the product
  wire-types.ts fixtures/*.ts handlers.ts client-store.ts (documents in browser) ui/*
src/app/api/_medreport-glue.ts             single place: connector registry + in-process transport + write-back hook
src/app/reports/** · src/app/pms-sandbox/**            thin pages + layout.tsx with own metadata
src/app/api/reports/v1/**/route.ts · src/app/api/tm3-sim/v1/**/route.ts   thin; runtime="nodejs"
scripts/medreport/build-templates.mjs      docx@9.8.1 -> tagged .docx -> base64 modules
scripts/medreport/record-demo-drafts.ts    with a key: freeze real Claude output (date/model/prompt version)
```

**Import rules** (ESLint `no-restricted-imports` in `.eslintrc.json`, with both alias and relative patterns such as `**/lib/*` and `**/sandbox/*`):
- **The module may import** its own files, zod, docxtemplater, pizzip, @react-pdf/renderer, @anthropic-ai/sdk, react/next, lucide, recharts, framer-motion and date-fns. It reaches `@/components/ui/*` and `@/lib/utils` **only through `ui/primitives.ts`**, which has its own override, so extracting the module means copying one file.
- **The module may NOT import** the rest of `@/lib/*`, `@/components/{dashboard,landing,layout}/*` or `src/sandbox/*`. The sandbox may NOT import module internals. The two talk over HTTP only. Only `src/app` glue (`_medreport-glue.ts` and a client-side write-back hook) touches both.
- **Server-only code:** `config.server.ts`, `connectors/`, `auth/`, `ai/`, `docgen/` and `api/` start with `import "server-only"`. The API key never reaches the browser. docx and react-pdf are never imported on the client, which would add about 640 kB to the first page load.

**Existing files touched:**
- `package.json` and its lockfile.
- `.eslintrc.json`.
- A new `.env.example` listing `ANTHROPIC_API_KEY`, `MEDREPORT_AI_MODE`, `MEDREPORT_LIVE_PASSCODE`, `MEDREPORT_LAUNCH_SECRET`, `MEDREPORT_SIGNING_SECRET`, `MEDREPORT_PARTNER_KEY`, `TM3_SIM_TOKEN` and `TM3_SIM_BASE_URL`.

`next.config.mjs`, the root layout and `DemoBanner` stay unchanged. The portal (`/`, `/login`, `/dashboard/*`, `src/lib`) is untouched.

**Branding and link preview:**
- `src/app/reports/layout.tsx` and `src/app/pms-sandbox/layout.tsx` export full `metadata`: a title template, description, openGraph and icons. The shared link then previews as "AppStackX Reports", not as the patient portal.
- The root portfolio banner stays, with the same 36px offset.
- The sandbox strip is slate/blue, not amber, so it doesn't merge with the banner.

**Connector interface** (what a real TM3 connector implements):
```ts
export interface ClinicSystemConnector {
  id: "tm3-sim" | "tm3" | "file-import";
  label: string; simulated: boolean; status: "connected" | "available" | "not_configured";
  capabilities: { patients: boolean; clinicalNotes: boolean; appointments: boolean;
                  outcomeMeasures: boolean; writeBackDocuments: boolean };
  searchPatients?(ctx: ConnectorContext, q: { search?: string }): Promise<PatientSummary[]>;
  getEpisodeBundle(ctx: ConnectorContext, ref: EpisodeRef | { upload: ImportPayload }): Promise<EpisodeBundle>;
  attachDocument?(ctx: ConnectorContext, input: AttachDocumentInput): Promise<AttachReceipt>; // {externalDocumentId, receivedAt, sha256}
}
// ConnectorContext = { tenantId, credentials: {kind:"bearer", token}, baseUrl, fetch, trace[] }
```

**Later extraction:** move the module into a workspace package `@appstackx/medreport` with its own Next app and domain. The handlers already take a `Request` and return a `Response`.

## 5. API

**Report API (the product), `/api/reports/v1`:**

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | `{product, version, aiMode, liveAiAvailable, model}`; drives the mode badge |
| GET | `/connectors` | Tiles: `tm3-sim` connected (simulated); `file-import` "TM3 export upload – available now"; `tm3` not configured (needs partner credentials and confirmed notes access) |
| POST | `/launch` | **Needs `x-partner-key`** (sent server-side by the sandbox). Takes `{connectorId, patientId, episodeId, clinician}` and returns `{launchUrl, expiresAt}` |
| POST | `/launch/verify` | `{token}` returns `LaunchClaims` plus a **session token** (1 h) bound to tenant, patient and episode |
| POST | `/sessions/demo` | Demo mode only. Session token for the manual picker or an upload |
| GET | `/connectors/{id}/patients?search=` | `PatientSummary[]` (session) |
| GET | `/connectors/{id}/patients/{pid}/episodes/{eid}/bundle` | **Bearer session token; the claims must match the path.** Returns `EpisodeBundle`, `computedFacts`, `dataChecks` and `trace[]` |
| POST | `/connectors/file-import/bundle` | Uploaded export or pasted notes, mapped to an `EpisodeBundle` |
| GET | `/templates` · `/templates/{id}` · `/templates/{id}/docx` | Template list, section spec, and download of the tagged Word template |
| POST | `/templates/validate` | Uploaded tagged .docx (base64, under 4 MB). Returns a tag list and plain-English `TemplateError`s |
| POST | `/drafts` | `{templateId, bundle, instructingParty, sections}`; one group of 1–2 sections. Returns `{sections, gaps, flags, generation:{mode, model, durationMs, usage}}` |
| POST | `/validate` | `{report, bundle}` returns `{flags, canSign}` |
| POST | `/sign` | Re-runs the validators, then returns `SignReceipt {contentSha256, signer, hcpc, signedAt, mac}`. Returns 409 `SIGNOFF_BLOCKED` if blocking issues remain |
| POST | `/render?format=docx\|pdf` | `{report, bundle, receipt?, templateDocx?}` returns a file. **Final** only with a valid mac and a matching recomputed hash; otherwise DRAFT |
| POST | `/connectors/{id}/documents` | Write-back of a signed file, with its receipt |

**Conventions:**
- The version is in the path. Every route sets `runtime="nodejs"` and `dynamic="force-dynamic"`.
- `/drafts` sets `maxDuration` to the project's actual limit (decision 2).
- Bodies are validated with zod; invalid input returns 422.
- Errors use `application/problem+json`.
- **Stateless:** the client sends the bundle and report on every call.
- Logs hold IDs, timings and token counts, never note text.

**Auth in the demo:**
- Session tokens gate patient data, even though it is fictional.
- Live AI also needs `x-medreport-passcode`. It is compared with `timingSafeEqual`, capped per instance (about 6 live calls/min), and the Anthropic workspace has a monthly spend limit. The passcode is rotated after the demo.
- `MEDREPORT_LAUNCH_SECRET` and `MEDREPORT_SIGNING_SECRET` are required. Only in demo mode do they fall back to a **fixed** constant (never a per-instance random one).
- `tenantId` (`"demo"`) is in every type and token from day one.

**Simulated TM3 API (`/api/tm3-sim/v1`, not the product):**
- Endpoints:
  - `GET /patients?search=`, `/patients/{id}`, `/patients/{id}/episodes`;
  - `GET /episodes/{id}/notes` (each note has `author{name,hcpc}`), `/appointments` (`ATT`/`DNA`/`LCN`), `/outcome-measures`;
  - `POST /patients/{id}/documents`: checks the token and payload and returns `{externalDocumentId, receivedAt, sha256}`. It does not store anything, because there is no DB.
- Bearer `TM3_SIM_TOKEN` is required (401 otherwise).
- Every response carries `X-Simulated: true` and `_simulated`. The shapes are our assumption, not TM3's schema.

**Launch-from-PMS flow:**
1. The sandbox button opens a blank tab **synchronously** on click. The sandbox's server action calls `POST /launch` with the partner key, then sets the tab's location. If popups are blocked, the same tab navigates instead, with a "Back to simulated TM3 record" link.
2. `/reports/new` reads `searchParams` in the **server page** and passes `lt` as a prop, so there's no `useSearchParams`/Suspense build failure. The client verifies the token, then calls `router.replace` to strip `lt` from the URL and history.
3. The bundle is fetched with the session token. The connector uses the request origin or `TM3_SIM_BASE_URL`, and falls back to in-process calls if preview protection blocks it. The trace then shows `transport:"in-process"`.
4. The template is preselected from the instructing-party type on the referral.

## 6. Screens

1. **`/pms-sandbox`** – Patient list in slate/blue with a permanent "Simulated TM3 sandbox – not affiliated with TM3" strip. Two complete cases and three with registration details only.
2. **`/pms-sandbox/patients/[id]`** – Tabs: Registration, Appointments, Clinical notes (SOAP, with author), Outcome measures, and Documents (filed reports, "stored in this browser – simulated record"). A "Connected apps" card holds **Create medico-legal report**.
3. **`/reports`** – Studio home:
   - mode badge with a passcode field;
   - the three connector tiles, including **Upload TM3 export**;
   - a reports table showing status;
   - notices: "Reports are stored in this browser only" and "Fictional data only";
   - "Export case JSON" and "Reset demo".
4. **`/reports/new`** – Three steps:
   - (a) Source: launch banner, picker or upload.
   - (b) Data preview: counts, data checks and an Integration Log of real calls with status and ms.
   - (c) Template and instructing party, then **Generate**. Progress shows per section group; in demo mode it reads "Loading pre-written draft (no AI call)".
5. **`/reports/[id]`** – Review workspace:
   - Outline on the left.
   - Editable paragraphs in the centre, with citation chips (`N-003 · 21/03`, `FACT-attendance`) and origin pills (AI / Edited / Clinician / From records).
   - Locked "From records – not AI" blocks: attendance, outcome table and Recharts chart.
   - Right tabs: Sources (a chip click highlights the note), Flags & Gaps (resolve or acknowledge with a reason), and Activity (a simple list, demo-grade).
   - Top bar: Download (DRAFT), Sign, Save to clinic record.
   - An unknown ID shows "This report is stored in another browser".
6. **Sign dialog** – Shows the declaration and statement-of-truth text ("confirm wording with instructing solicitor"), name, HCPC number and typed signature, plus three attestations. Disabled while blocking items remain. Signing calls `/sign`, locks the report and shows the fingerprint.
7. **`/reports/templates`** – Our two templates, each with its section kinds and a download. **Upload your tagged .docx** validates it, shows plain-English errors, then renders the current report into it.
8. **`/reports/batch`** – Pick episodes, queue drafts (concurrency 2) and watch per-episode status (Drafting / Needs input (n) / Ready to sign).

There's no developers page. The API and connector reference go in a README section, plus one slide.

## 7. AI drafting

**Who writes what:**
- **Code only, never AI:** claimant details, instructing party, dates, attendance, outcome tables and changes, the records-reviewed appendix and the statement of truth.
- **AI:** only the `ai_narrative` sections: history as reported, complaints, examination as recorded, treatment, progress and current status.
- **`clinician_opinion` sections** (prognosis, causation, fitness for work, adjustments): the AI may only *attribute* an opinion recorded in a note, with a citation ("On 07/07/2026 the treating clinician recorded…"). If none was recorded, the section becomes a placeholder plus a blocking gap, and the physio writes it.

**Input:**
- Notes are wrapped as `<note id="N-003" date="2026-03-21" author="S. Reid (PH-DEMO-01)">…</note>`, plus `<computed_facts>` with IDs `FACT-*` that may be quoted but not recalculated. The citable IDs are `REG`, `N-*` and `FACT-*`.
- **Scope runs in code:** the template's `scope` strips fields (for example PMH and social history for employer reports) before the call. The `SCOPE_TERM` validator checks the output for those terms.
- **Data minimisation, not anonymisation** (and the UI and DPIA notes say so): the name becomes `[CLAIMANT]`, age replaces DOB, and no address or contacts are sent. Free text can still identify the patient.
- Anything inside a note is content, never an instruction.
- The system prompt is frozen and versioned (`PROMPT_VERSION`):
  - use the record only;
  - attribute each statement (patient-reported vs clinician-observed, and which clinician);
  - never strengthen the clinician's hedging;
  - no new diagnosis, causation, prognosis or "balance of probabilities" wording;
  - emit a gap instead of guessing;
  - UK English, dates DD/MM/YYYY.

**Output schema (zod `DraftGroupOutput`):** `sections[{sectionKey, paragraphs[{text, sourceIds (min 1), basis}]}]`, `gaps[{sectionKey, issue, suggestedQuestion, relatedNoteIds}]`.

**Call** (`client.beta.messages.parse`, @anthropic-ai/sdk@0.131.0 + zod@4.6.5, `betaZodOutputFormat`):
- Model `claude-opus-5-5`; `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`.
- `output_config: { effort, format }`. Effort is set explicitly: "low" vs "medium" is tested on the two gold cases and chosen by latency and quality.
- **`max_tokens: 16000`**, because always-on thinking counts against the limit; this stays under the SDK's non-streaming guard.
- Block order (stable prefix first): system (cache_control) → template block → episode block (cache_control) → **final short block "Draft sections X, Y"**. Caching helps regeneration and later reports only. It doesn't help the first parallel calls, and the prompt may sit below the cacheable minimum, so we don't count on it.
- No `thinking` parameter, no forced tool_choice, no prefill, and no API Citations (they are incompatible with structured output; our `sourceIds` play that role).
- Check `stop_reason`: `refusal` or `max_tokens` becomes a clean error with **Retry** or **Use demo draft**. The serving model is recorded.

**Validators** (`core/validation`, same code on server and browser, run after drafting, after every edit, at `/sign` and at `/render`):
- **UNKNOWN_SOURCE_ID:** invalid IDs are dropped. **UNCITED_PARAGRAPH** blocks signing for origin AI or Edited only; `clinician` and `from_records` are exempt.
- **FIGURE_NOT_IN_SOURCE:** dates (DD/MM/YYYY, "March 2027", "within 6 weeks/months") and numbers, including spelled-out ones, must appear in the cited notes or the cited FACTs. Dates block signing; numbers warn.
- **OPINION_LANGUAGE:** "full recovery", "permanent", "caused by", "attributable to", "balance of probabilities", "within N months" and similar, when the cited note doesn't contain them. **Blocks on AI text, and on edited text until acknowledged with a reason.** Paragraphs written from scratch by the clinician are not flagged.
- **SCOPE_TERM:** out-of-scope history in a scoped template. Blocking.
- **Data checks:** no pre-incident history; DNA without a reason; episode still open or no discharge note; an outcome measure at only one time point; disclosure consent not recorded; incident date missing; notes by more than one clinician (signer reminded to distinguish their own knowledge).
- **Known limit, stated openly:** a paraphrase error that cites a valid note isn't caught. Click-to-source review and the attestation cover it.

**Modes:** `MEDREPORT_AI_MODE=auto|demo|live`.
- **For the Dell call, live is the default** (key + passcode). Demo mode is the fallback for the public link.
- Demo drafts are in `ai/demo-drafts/{patientId}__{templateId}.json`: same schema and validators, no fake "AI" delay, always badged.
- With a key, `record-demo-drafts.ts` replaces them with real output stamped with date, model and prompt version.

**Timeouts:**
- Narrative sections are drafted in **groups of 1–2 sections as parallel `POST /drafts` calls**, each with SDK `timeout` set about 10 s below `maxDuration` and `maxRetries: 0`.
- A failed group offers Retry or the demo draft.
- The live run is rehearsed end to end **three times** with timings recorded before the meeting.

## 8. Word & PDF

**Word (.docx), the main output.** docxtemplater@3.71.0 + pizzip@3.3.0, run on the server in `/render`, so the clinic's letterhead, styles, headers and footers are kept.
- **Options:** `{ paragraphLoop: true, linebreaks: true, nullGetter: (part) => part.module ? "" : "[MISSING]" }`. A plain `"[MISSING]"` string made `{#signed}` render on unsigned drafts. The view model always passes explicit booleans and arrays: `isDraft`, `signed`, `sections`, `attendance`, `outcomes`. Any `[MISSING]` in the output is raised as a flag.
- **Unit test:** a draft render has no signature text and no `[MISSING]` inside section blocks; a signed render has both the signature and the hash.
- **Tags:**
  - fields: `{patient.fullName}`, `{instructingParty.name}`, `{instructingParty.reference}`;
  - sections: `{#sections}{title}{#paragraphs}{text}{/paragraphs}{/sections}`;
  - table-row loops: `{#attendance}…{/attendance}`, `{#outcomes}…{/outcomes}`;
  - header: `{#isDraft}DRAFT – NOT SIGNED{/isDraft}`;
  - signature block: `{#signed}…{signature.hashShort}{/signed}`;
  - **Records reviewed** appendix: **all** notes and records with dates and authors ("notes by X"), with the cited ones marked.
- Note IDs are left out of the final document. An optional review copy adds `[18/03/2026]` markers.
- **Our templates:** `scripts/medreport/build-templates.mjs` (docx@9.8.1, dev dependency) builds two templates with a "Riverside Physiotherapy (fictional), Milton Keynes" letterhead and "Page X of Y". They are stored as base64 TS modules, so Vercel bundles them with no extra config.
- **Clinic's own template:**
  - In the demo: upload, then `/templates/validate`, then render. For the demo we prepare one fictional "clinic-style" template.
  - At setup: we tag Dell's real templates, one per instructing party. Each tag is typed in one go with track changes off, then checked with a validation render.
  - Tags split across runs in one paragraph merge fine. Tags crossing paragraphs, cells, text boxes or tracked changes fail, and the `TemplateError` explains where.

**PDF.** @react-pdf/renderer@4.9.0 `renderToBuffer` in the same route, from the same `ReportViewModel`. It takes about 60–100 ms and needs no `next.config` change, but needs one `as any` cast.
- **Unicode font:** Noto Sans TTF, bundled as a base64 module, written to `os.tmpdir()` once and registered with `Font.register` by path. There's no runtime URL fetch. Built-in Helvetica breaks `→ ✓ ≥`.
- A text normaliser is the fallback.
- A test PDF with `£ – → ≥ ‘’ “”` is checked in step 6.
- Pages carry a DRAFT watermark when unsigned, plus a footer with the hash and "Page x of y".
- We tell Dell plainly that the PDF uses our house layout. In production, the filled .docx is converted with Gotenberg/LibreOffice in a UK container, so the two match exactly. LibreOffice (about 300 MB) can't run in a Vercel function.

**Final-render rule (server):** a final copy needs a valid `SignReceipt.mac`, a recomputed hash equal to `contentSha256` (the hash excludes the signature), and no blocking flags. Otherwise the output is DRAFT, or 409 `SIGNOFF_BLOCKED` when a final copy is requested. Files are named like `Hart_M_Treating-Physio-Report_2026-10-06_SIGNED.docx`.

## 9. Demo script (about 12 min; live AI on the call, demo mode as fallback)

**Case A, Megan Hart** (34, office administrator):
- Rear-end shunt on 12/03/2026, WAD II.
- "Harrow & Pike Solicitors (fictional)", ref HP/RTA/2291.
- 11 appointments: 10 attended, 1 DNA on 15/04 with no reason recorded.
- 10 SOAP notes by two fictional physios.
- NDI 42% → 24% → 12%; NPRS 7 → 4 → 2.
- Planted gaps: no pre-accident history, missing DNA reason, no prognosis recorded.

**Case B, Daniel Okafor** (46, warehouse operative, "Northfield Logistics Ltd (fictional)"):
- Lifting injury on 02/06/2026.
- 7 appointments: 6 attended, 1 late cancellation.
- ODI 48% → 30% → 18%.
- The discharge note records the clinician's return-to-duties view.
- Unrelated past history sits in the notes. Planted gap: no lifting test.

**Steps:**
1. **Sandbox.** Open `/pms-sandbox` and point at the strip: "In your clinic this is your real TM3." Open Megan and show the registration, the DNA, the notes with their authors, and the NDI scores.
2. **Launch.** Click **Create medico-legal report**. The Studio shows "Imported from simulated TM3: 10 notes · 11 appointments · 6 scores". Open the Integration Log to show the real authenticated calls. The data checks are already amber.
3. **Generate.** The template and solicitor are prefilled. Enter the passcode and click Generate; section groups land over 20–60 s. Fallback: "Use pre-written draft".
4. **Traceability.** Click a sentence: N-001 is highlighted. Show `FACT-attendance` and the outcome table and chart marked "From records – not AI".
5. **Guardrails.** Edit a sentence to add "she will make a full recovery by March 2027". OPINION_LANGUAGE (blocking until acknowledged) and FIGURE_NOT_IN_SOURCE appear. Undo, and they clear.
6. **Gaps, not guesses.** Prognosis is a blocking placeholder. Type two sentences; they're tagged "Clinician" and not flagged. Resolve the DNA reason and acknowledge the pre-accident gap with a reason.
7. **Sign and export.** Download Word, which shows the DRAFT header. Sign with the statement, a fictional HCPC number and the attestations. The receipt and fingerprint appear. Open the final .docx and .pdf: letterhead, outcome table (arrows render), all records reviewed with authors, signature and hash.
8. **Close the loop.** Click **Save to clinic record**. The sandbox Documents tab lists the signed report, marked "stored in this browser – simulated record".
9. **Their template, another report.**
   - Daniel uses the employer template: past history is stripped by code; the clinician's return-to-work view is cited; the lifting-test gap is flagged.
   - On `/reports/templates`, upload the clinic-style .docx with one deliberately broken tag. The plain-English error appears. Fix it, re-upload, and the report renders into *their* layout.
10. **Scale and day one.**
    - `/reports/batch`: select both episodes and watch the statuses fill.
    - Connector tiles: "TM3 export upload – available now" and "TM3 live API – not connected: needs TM3 partner access".
    - Next steps: his templates, a TM3 export sample, UK hosting with DPA/DPIA, and the founding offer of £149/mo + £250 setup.

**Backup:** a recorded video of the full run, plus the exported files kept locally.

## 10. Build steps (one developer)

| # | Step | Effort |
|---|---|---|
| 1 | Scaffold: install `@anthropic-ai/sdk@0.131.0 zod@4.6.5 docxtemplater@3.71.0 pizzip@3.3.0 @react-pdf/renderer@4.9.0 server-only` (dev: `docx@9.8.1`); module folders; ESLint boundary (alias + relative + primitives override); `.env.example`; `/reports` and `/pms-sandbox` layouts with own metadata and 36px offset; **Vercel preview on day 1** | 0.5d |
| 2 | `core` types/schemas (note authors, FACT IDs), computed facts; fixtures (2 full cases + 3 fillers); simulated TM3 API; `tm3-sim` connector, mapper, trace, `_medreport-glue.ts`; launch/session tokens, partner key; patients/launch/bundle endpoints | 1.0d |
| 3 | Sandbox screens 1–2: launch button (sync tab), Documents tab from the browser store | 0.5d |
| 4 | **Thin slice:** `/reports/new` (server `searchParams`, strip `lt`), demo draft for case A, template build script, docx render (nullGetter + unit test). **Preview URL by end of day 3: sandbox → bundle → draft → .docx** | 1.0d |
| 5 | Grounding: all validators (month-year, FACT IDs, origin exemptions, scope), data checks, scope stripping, live draft path (16k tokens, small groups, passcode/rate cap), `/validate`, `/health`, case B demo draft | 1.0d |
| 6 | Review workspace (chips → source, flags/gaps, from-records blocks + chart, activity list), sign dialog + `/sign` receipt, PDF with Noto Sans + Unicode test, final-render rules, write-back | 1.5d |
| 7 | Differentiators: `file-import` connector + upload UI (0.5), template upload + `/templates/validate` (0.5), minimal `/reports/batch` (0.25) | 1.25d |
| 8 | Empty states ("stored in this browser"), mobile check, README API section, production deploy, **3 timed live rehearsals**, record demo drafts if a key exists, backup video | 0.5d |
| | **Total** | **about 7.25 days (core path, steps 1–6 + 8: about 6 days)** |

After every step: `npx tsc --noEmit` and `npm run build`. Confirm the existing routes still build as static and `/dashboard/*` works.

**Deferred from the draft:** developers page, a full Audit tab, Regenerate section, v2 versioning and passcode UI polish.

## 11. Later (not in this build)

- **Pilot-ready (about 3–5 weeks after Dell commits):**
  - Auth with MFA, roles, per-clinic tenancy.
  - Postgres in a UK region with server-side reports and an append-only audit log.
  - Encryption at rest plus field-level encryption; retention and deletion jobs.
  - Single-use launch tokens and per-clinic OAuth client credentials.
  - Template upload with a tag inspector, stored per tenant.
  - Gotenberg docx→PDF in the UK.
  - Streaming drafts and a background batch queue.
  - Usage metering and Stripe billing.
- **Data in:**
  - A `file-import` mapping for Dell's real TM3 export.
  - A real `Tm3Connector`, only once TM3 issues credentials and confirms partners can read notes and outcomes.
  - Other clinic systems through the same interface; real write-back where the clinic system allows it.
- **Compliance:**
  - DPA (we are processor, the clinic is controller), DPIA, ICO registration, sub-processor list.
  - Cyber Essentials (then Plus), pen test.
  - Anthropic zero-data-retention arrangement.
  - Data-residency review. We make no claim of UK-only AI processing until the valid `inference_geo` values are confirmed; until then the DPIA covers the transfer.
  - Legal review of the Part 35 wording and MedCo scope (this is not a MedCo initial-report tool).
  - Intended-purpose statement: a documentation tool, not clinical decision support.
- **Productisation:** its own package, app and domain; OpenAPI spec and partner keys; a gold-case regression set run on every prompt change.

## 12. Risks & how we handle them

| Risk | Handling |
|---|---|
| TM3 may never give new partners API access to notes | The export-upload connector works now. Ask Dell for an export sample and whether his account issues API tokens. Never imply a partnership |
| Overclaiming (canned draft, sandbox mistaken for TM3, fake signature) | Badges and provenance on every draft; live AI on the call; sandbox strip and neutral styling; server-MAC'd sign receipt; audit labelled demo-grade |
| AI accuracy and liability | Facts in code; citations validated; opinion only as recorded; scope enforced in code; signing blocked; attestations; DRAFT until signed. We say openly that paraphrase errors need human review |
| Live run is slow or truncated on Vercel | 16k max_tokens, 1–2 sections per call, effort tested, maxDuration matched to the plan, 3 timed rehearsals, demo draft one click away |
| Write-back not visible on stateless Vercel | Receipt from the simulated API, record kept in the browser and labelled as such |
| Build or render failures (Suspense, fonts, conditional tags) | Server `searchParams`, Noto Sans font, nullGetter fix + unit test, preview deploy on day 1 |
| Clinic Word templates break | Validation render with plain-English errors; we do the tagging at setup |
| Wrong Part 35 wording | Configurable per template; "confirm with instructing solicitor"; legal check before the pilot |
| Real patient data typed into the public demo | "Fictional data only" notices; no server storage; live AI behind passcode, rate cap and spend limit |
| Breaking the patient portal | Separate route trees, ESLint boundary, no portal edits, build and route check every step |
| Heidi already sits inside TM3 | Show whole-episode reports, their own template, citations, sign-ready output and batch |
| Report links fail on Dell's machine | Send only the `/pms-sandbox` URL; clear "stored in this browser" state; export case JSON |
| Fictional names clash with real firms | Check the names; add "(fictional)" |

## 13. Decisions I need from you

1. **Name and placement.** *Default:* "AppStackX Reports" (one value in `config.public.ts`), with its own metadata and link preview. It lives at `careconnect-mk.vercel.app/reports` and `/pms-sandbox`, with no link from the portal. The root portfolio banner stays as it is, so no portal edit.
2. **Live AI on the call.** *Default:* add `ANTHROPIC_API_KEY` (server-only) with a spend-limited workspace, plus `MEDREPORT_LIVE_PASSCODE`. The Dell meeting runs live; the public link runs in demo mode. Please tell me whether the Vercel project is on **Hobby or Pro**, and whether Fluid compute is on, so I can set the function time limit.
3. **Report types and Dell's material.** *Default:* a solicitor treating-physio report (RTA) and an employer fitness-for-work report, with the CPR 35 declaration as an optional block. Please ask Dell now for one anonymised past report or Word template, a sample TM3 export, and whether his account can issue API tokens.
4. **Scope and date.** *Default:* the full build, about 7.25 days, with a demoable preview by day 3. *Faster option:* the core path only, about 6 days, with the export upload, template upload and batch shown on slides. That weakens the pitch against Heidi. What date does the demo need to be ready?

This is the plan only. Nothing is built until you approve.