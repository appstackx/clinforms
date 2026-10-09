The contract update for the referrer-forms pivot is in place, and everything checks green: `tsc`, `npm run lint`, `npm run test:medreport` (90/90) and `npm run build`. The patient portal is untouched and its pages still build as static. Nothing is committed.

## Packages installed (exact versions)
| Package | Version | Checked |
|---|---|---|
| `@xmldom/xmldom` | 0.9.12 | Parses Word XML in Node |
| `pdf-lib` | 1.17.1 | Creates, fills and flattens a fillable PDF |
| `pdfjs-dist` | 6.4.299 | Server: legacy build reads text and form fields in Node 22 and inside the Next server bundle, including with the optional canvas package removed (as on Vercel). Browser: legacy build draws a page to canvas in Chromium |
| `docx-preview` | 0.4.1 | Renders a Word file in Chromium |

- **Commit note:** your commit `6272675` already holds `package.json` and the lockfile. `npm` reordered `package.json` alphabetically. pdfjs-dist 6 needs Node 22.13 or later.
- **Build trap for the Studio agents:** pointing pdfjs at its worker with `workerSrc = new URL(..., import.meta.url)` breaks `next build` in Next 14. A real worker started with `new Worker(new URL(...), {type: "module"})` builds and runs with no console messages. That recipe is in `ui/preview-libs.ts`; the Studio agents should use it.
- **Temporary test files:** the route and page I used to check this in a real browser have been deleted.

## Where I departed from the brief
1. **Render format is a query parameter, not a body field.** It is `?format=docx|pdf|original`. Form reports also send `form` and `fileBase64` in the body.
2. **`fillPdf` is async** and returns `Promise<Uint8Array>`, because pdf-lib's load and save are async.
3. **Two enums were widened rather than mapped.**
   - Instructing-party types now include `"mlc"` and `"other"`; referrer types use the same list.
   - Section keys now accept `lower_snake_case` or a form field ID like `F-07`, so a form report's section key is the field ID.
4. **A fourth analysis mode, `"rules"`,** for an uploaded form analysed in demo mode with no AI call.
5. **Form drafts take up to 4 fields per call** (built-in templates stay at 2), enforced in the drafts request schema only when `form` is sent.

## New and changed exports
- **`core/schemas.ts` and `core/types.ts`** (each with an inferred type):
  - Referrer and file: `ReferrerInfoSchema`, `FormFileSchema`, `FormKindSchema`, `FormMimeTypeSchema`.
  - Where answers go: `FormAnchorSchema` (Word anchor, PDF field, PDF overlay), `BlockIdSchema`, `OptionGlyphSchema`.
  - Where answers come from: `FillSourceSchema`, `RegistrationPathSchema`, `ComputedFactFormatSchema`, `SignoffPartSchema`.
  - Questions and the form map: `AnswerTypeSchema`, `FormFieldSchema`, `FormDefinitionSchema` (added optional `sampleId`, `usage`), `FormAnalysisSchema`, `FormStatusSchema`.
  - Reports: `FormAnswerSchema`, `ReportFormRefSchema`; `Report.form?`; `ReportSection.fieldId?` and `answer?`.
  - Analysis inputs: `OutlineBlockSchema`, `PdfFormOutlineSchema`.
- **`core/labels.ts`:** UI labels for every new enum.
- **`config.public.ts`:** `MAX_FORM_FIELDS_PER_DRAFT` (4), `MAX_FORM_FILE_BYTES` (3 MB), `MAX_FORM_REQUEST_BYTES` (4.4 MB), and two notices including the "download Word" message.
- **`core/forms.ts` (new, browser-safe):**
  - Form to template: `formToTemplate(form)`, `formTemplateId(formId)` (gives `"form:<id>"`), `formIdFromTemplateId`, `isFormReport(report)`, `formRefOf(form)`, `FORM_ATTESTATIONS`, `formScope(type)` (employer forms strip past and social history).
  - Fields: `sectionKindForFillSource`, `isAnswerableField`, `answerableFields`, `answerKindFor`, `fieldGuidance`.
  - Values filled by code: `resolveRegistrationValue(path, ctx, answerType?)`, `resolveComputedFactValue(factId, format, ctx, answerType?)`, `primaryTreatingClinician`, `matchOption`, `toFormAnswer`.
  - Answers: `answerToText(section)`, `isSectionAnswered(section)`, `buildFormAnswers(report, form, {receipt?})` (sign-off fields stay blank without a receipt), `signoffValuesFromReceipt`.
  - Block IDs: `parseBlockId`, `formatParagraphBlockId`, `formatCellBlockId`.
  - Checks: `checkFormDefinition(form): string[]` (plain-English problems).
- **`core/report-factory.ts`:**
  - `createFormReport({form, bundle, instructingParty, computedFacts, clinician?, id?, now?, actor?}): Report`. It fills registration and computed answers by code with sources (`REG`, `FACT-…`, `N-…`). A value the record lacks is left blank with a system gap.
  - `planDraftGroups` uses the form limit. `applyDraftResult` keeps `fieldId` and `answer`. Three new activity actions.
- **`api/contract.ts`:**
  - Paths: `formsAnalyse`, `formSamples`, `formSampleFile(id)`, `formsFillPreview`; four new entries in the endpoint table.
  - Headers: `fillWarnings`, `formKind`.
  - Problem codes: `FORM_INVALID`, `FORM_MISMATCH`, `FORM_NOT_CONFIRMED`, `NO_DEMO_ANALYSIS`, `PDF_CONVERSION_UNAVAILABLE`.
  - Optional `form` added to the drafts, validate and sign requests; `form` and `fileBase64` added to render.
  - New request/response schemas: forms-analyse (request, response, outline summary, analysis step), samples (`FormSampleSchema`, `FormSamplesResponseSchema`) and fill-preview.
- **`api/resolve-template.ts` (new, shared):** `resolveTemplate({templateId, form?, reportForm?, path?})`. One rule for which template a report uses: the registry, or `formToTemplate(form)`. Errors are 422, or 409 `FORM_MISMATCH`.
- **`ui/api-client.ts`:** `analyseForm`, `formSamples`, `formSampleFile(id)`, `fillPreview`; `render` accepts `"original"`. File downloads now carry `contentType` and `warnings`.
- **`ui/store.ts`:**
  - Constants: `FORMS_KEY`, `FORMS_SEEDED_KEY`, `FORMS_DB_NAME`, `FORMS_FILE_STORE`.
  - Form maps: `listForms`, `getForm`, `saveForm`, `deleteForm` (localStorage key `medreport.forms`).
  - Files, keyed by SHA-256 in IndexedDB with a memory fallback: `saveFormFile` (true means saved to IndexedDB, false means this tab only), `getFormFile(sha256)`, `deleteFormFile`, `clearFormFiles`, `loadFormFile(form)` (fetches a sample's file and checks its hash).
  - Samples and hooks: `fetchSampleForms`, `ensureSampleForms`, `useForms`, `useForm`. `resetDemo` also clears stored files.
- **`ui/preview-libs.ts` (new, shared):** `loadPdfjsBrowser()`, `loadDocxPreview()`, `DOCX_PREVIEW_OPTIONS`.
- **`forms/` (new, server-only):**
  - Working now:
    - `file.ts`: `decodeFormFile(base64, {maxBytes?})` detects type from the bytes, rejects old `.doc` files with a plain-English message, and gives 413 when too large. Also `sniffFormFile`, `sha256Hex`, `assertFormFileMatches`.
    - `pdfjs.ts`: `loadPdfjs()` and `pdfjsDocumentParams(bytes)`.
    - `convert.ts`: `docxToPdf(buf, {timeoutMs?}): Promise<Uint8Array|null>` via LibreOffice, tested here at about 2 seconds; returns null on Vercel. Also `findSoffice`, `pdfConversionAvailable`.
    - `types.ts`: `FillOptions` (`draft`, `reviewMarkers?`, `onWarning?`), `PdfFillOptions` (adds `flatten`).
  - Stubs with final signatures (return 501 until built):
    - `buildDocxOutline(buf): {blocks, warnings}`
    - `fillDocx(buf, form, answers, opts): Buffer`
    - `readPdfForm(buf): Promise<outline & {classification: "acroform"|"flat", warnings}>`
    - `fillPdf(buf, form, answers, opts): Promise<Uint8Array>`
  - Sample forms: `samples/registry.ts` has `SAMPLE_FORMS` (empty for now), `getSampleForm`, `listSampleForms()`.
- **Handlers and routes:**
  - Working: `handleFormSamples` (returns `[]` for now) and `handleFormSampleFile` (404 for an unknown ID).
  - Still 501 stubs: `handleFormsAnalyse` and `handleFormsFillPreview`.
  - Four thin route files added. `maxDuration = 60` is set on analyse, fill-preview and render.

## Small edits to other agents' files
- **`drafts.ts`, `validate.ts`:** both now use `resolveTemplate` so a form can be sent.
- **`placeholders.ts`:** a form section with a structured answer, or a sign-off field, no longer counts as empty.
- **`docgen/pdf.ts`:** fixed the type error (loads `@react-pdf/renderer` dynamically and uses `createReportPdf`). I also removed an `any` that was failing lint.
- **Owner comments:** files previously marked "docgen" now say "forms-engine".

## Also updated
- **ESLint boundary** (regenerated, 35 rules):
  - `docx-preview` and `pdfjs-dist` are allowed only in `ui/`; `forms/` may use only pdfjs's legacy build.
  - `pdf-lib` and `@xmldom/xmldom` are banned from browser code.
  - Checked with throwaway files.
- **README:** new folder map, import rules, endpoints, body limits, problem codes, `MEDREPORT_SOFFICE_PATH`, ownership for the new slices, and a "Revision 2 – referrer forms" section. That variable is also in `.env.example`.
- **`docs/medreport-plan.md`:** Revision 2 section answering each of Dell's 5 questions.
- **New tests:** `scripts/medreport/forms-contract.test.ts`, `src/modules/medreport/forms/file.test.ts` and `src/modules/medreport/ui/store.forms.test.ts`; the contract test now also checks the new routes.

## Handoffs to the next agents
- **ai:**
  - Demo-draft files are keyed `{patientId}__{templateId}`, and a form's template ID contains `:`. Key form drafts by form or sample ID instead.
  - The structured-output schema for form answers (including the yes/no and choice values) still needs adding to `core/schemas.ts`.
  - The analysis handler depends on the forms-engine's outline functions, which are still stubs.
- **forms-engine:** write `build-demo-forms.mjs` and fill `SAMPLE_FORMS`.
- **studio:** use `ui/preview-libs.ts` for previews.

This stage did not cover your question about Blue Heart Clinics' size and budget.