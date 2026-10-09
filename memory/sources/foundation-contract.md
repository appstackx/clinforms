The foundation and contract are in place. `npx tsc --noEmit`, `npm run lint` and `npm run build` all pass with zero errors, and `npm run test:medreport` passes 13 of 13 tests. Nothing was committed. Your commit 785b0b0 already holds the dependencies (exact versions: sdk 0.131.0, zod 4.6.5, docxtemplater 3.71.0, pizzip 3.3.0, react-pdf 4.9.0, server-only 0.0.1, docx 9.8.1, tsx 4.23.15). Since then only `package.json` (the test script) and `.eslintrc.json` changed; everything else is new. No portal file was touched, and no secret value was printed or written anywhere.

## Verification
- **`npx tsc --noEmit`:** exit 0.
- **`npm run lint`:** "No ESLint warnings or errors".
- **Boundary probes:** throwaway files that broke the rules all raised errors: `@/lib`, `@/components/*`, `@/sandbox`, `@/app`, relative paths out of the module, the SDK, `server-only` and `node:*` in browser folders, and the sandbox importing the module. The module's own relative imports and the SDK in `ai/` were allowed.
- **`npm run build`:** compiled successfully. `/`, `/login` and all eight `/dashboard/*` routes are still static (○). The 24 API routes and the dynamic pages are ƒ; `/reports`, `/reports/templates`, `/reports/batch` and `/pms-sandbox` are static.
- **Smoke test with `next start`:**
  - `/health` returns `{"product":"AppStackX Reports","version":"0.1.0","aiMode":"live","liveAiAvailable":true,"model":"claude-opus-5-5","promptVersion":"1"}`.
  - `/connectors` and `/templates` return real data (12 and 9 sections). An unknown template returns 404 `application/problem+json`, and stub endpoints return 501 with `code: NOT_IMPLEMENTED`.
  - Simulated TM3 stubs return 501 with `x-simulated: true`.
  - All pages return 200. Titles render as "New report · AppStackX Reports", with og:title "AppStackX Reports".
- **`npm run test:medreport`:** 13 of 13 pass. Fingerprint and canonical JSON, launch token round trip, expiry, tampering, wrong secret and wrong token type, session token, receipt verify/tamper/forged MAC, createReport/planDraftGroups/applyDraftResult/canSign, and a check that every endpoint has its route and handler file.

## Deviations from the spec, and why
1. **Test script.** It is `node --import ./scripts/medreport/test-setup.mjs --import tsx --test …`. Without the setup file, any test importing a server-only file throws. `--conditions=react-server` would also fix that, but it swaps React for its server subset and would break react-pdf tests. Both test globs were confirmed to find tests on Node 22.
2. **`api/contract.ts` has no `server-only` import.** The browser API client needs it. The simulated TM3 types are re-exported from it as type-only.
3. **No separate bundle in `/validate`, `/sign` or `/render`.** The bundle already travels inside `report.bundleSnapshot`. `/drafts` still takes `bundle`, and its section list is named `sectionKeys` (the spec says `sections`).
4. **Handler shape.** Each handler is a `MedreportHandler (req, ctx, deps)`. Route files do `export const GET = route(handler)`, where `route()` comes from the glue file and returns the `HandlerFn` you specified. This lets the module use the connector registry without importing the sandbox.
5. **Employer "treatment & attendance".** It is one `ai_narrative` section with `blocks: ["attendance"]`. A new optional `TemplateSection.blocks` field marks the locked "From records – not AI" tables a section shows.
6. **Additions beyond the specified type lists.**
   - `ClinicSystemConnector.note`, `ReportTemplate.documentTitle`, `declarationNote` and `attestations`.
   - `SignReceipt.tenantId`, and `GenerationMeta.sectionKeys`, `at`, `effort` and `stopReason`.
   - Optional `Note.pastMedicalHistory` and `Note.socialHistory`, which the employer scope strips.
   - `PatientSummary.episodes`, so the picker needs no extra endpoint.
   - A `CaseExport` schema.
7. **"Confirm exact wording with the instructing solicitor"** is held in `declarationNote`, shown in the UI and never printed in the document.
8. **Upload limit.** `MAX_TEMPLATE_DOCX_BYTES` is 3 MB decoded, so the base64 body stays under Vercel's 4.5 MB request limit (the spec says "under 4 MB").
9. **Banner offset.** Layouts use `pt-10 sm:pt-9`. The banner is 40px tall on mobile and 36px from `sm`, so a flat 36px would hide 4px on phones.
10. **Icons** are inline SVG data URIs, because `public/` is off limits.
11. **The sandbox imports nothing from the module.** Wire types are defined in `connectors/tm3-sim/wire.ts` and duplicated in `src/sandbox/tm3-sim/wire-types.ts`.
12. **`tsconfig` has no `target`.** Spreading or iterating a Set, Map or typed array fails tsc (TS2802), so the code uses `Array.from`. This is noted in the README for the other agents.
13. **Implemented now as working baselines rather than stubs:** health, connectors-list, templates-list and template-get handlers; `canSign`, `applyScope`, the report factory, registry and real-TM3 placeholder connector; `passcode.ts`; the glue (HTTP first, falling back to in-process calls); and the client host hooks.
14. **Extra contract files:** `core/{dates,ids,labels,report-factory}.ts`, `api/deps.ts`, `ui/host-hooks.tsx`, `auth/hmac-token.ts`, `src/app/reports/medreport-host.tsx`, `scripts/medreport/gen-eslint-boundary.mjs`. The ESLint config is generated by that script (29 overrides, one per folder depth). It is about 1,770 lines; regenerate it rather than editing by hand.
15. **Ownership adjustments.** I assigned `auth/hmac-token.ts` and `medreport-host.tsx` to integration, and `report-factory.ts`, `record-demo-drafts.ts` and `health.ts` to ai. I read "the fixtures agent" as the sandbox agent, so it owns `connectors/tm3-sim/wire.ts` and `mapper.ts`.
16. **`/sessions/demo`** is documented as available for the demo tenant whatever the AI mode, because batch and upload need it during a live demo.

## Key exported names
- **`core/schemas.ts`:** `<Name>Schema` for every type, e.g. `EpisodeBundleSchema`, `ReportSchema`, `DraftGroupOutputSchema`, `SignReceiptSchema`, `LaunchClaimsSchema`, `SessionClaimsSchema`, `FactIdSchema`, `REGISTRATION_SOURCE_ID`, `NOTE_ID_PATTERN`.
- **`core/types.ts`:** `TenantId`, `PatientRegistration`, `Clinician`, `InstructingParty`, `Referral`, `Incident`, `Note`, `Appointment`, `OutcomeMeasureSeries`, `EpisodeBundle`, `EpisodeRef`, `ComputedFact`, `DataCheck`, `ReportTemplate`, `TemplateSection`, `Paragraph`, `ReportSection`, `Gap`, `ReportFlag`, `GenerationMeta`, `ActivityEntry`, `Report`, `SignReceipt`, `LaunchClaims`, `SessionClaims`, `SessionToken`, `PatientSummary`, `ConnectorInfo`, `TraceEntry`, `AttachReceipt`, `ImportPayload`, `DraftGroupOutput`.
- **`api/contract.ts`:**
  - Bases and headers: `REPORT_API_BASE`, `TM3_SIM_API_BASE`, `HEADERS`, `CONTENT_TYPES`.
  - Paths and endpoint tables: `reportApiPaths`, `tm3SimPaths`, `REPORT_API_ENDPOINTS`, `TM3_SIM_ENDPOINTS`.
  - Errors: `ProblemSchema`, `PROBLEM_CODES`.
  - Request/response schemas: Health, Connectors, Launch, LaunchVerify, DemoSession, Patients, Bundle, FileImportBundle, TemplatesList, TemplateGet, TemplatesValidate, Drafts, Validate, Sign, Render, Documents.
- **`api/http.ts`:** `json`, `problem`, `notImplemented`, `HttpError`, `parseBody`, `parseQuery`, `getBearerToken`, `timingSafeEqualString`, `fileResponse`, `requestOrigin`, `logEvent`, `bindHandler`, `HandlerFn`, `MedreportHandler`. `api/deps.ts` exports `MedreportDeps`.
- **`connectors/types.ts`:** `ClinicSystemConnector`, `ConnectorContext`, `ConnectorRegistry`, `ConnectorFetch`, `AttachDocumentInput`, `ConnectorError`, `TRANSPORT_HEADER`.
- **Function signatures:**
  - Core: `computeFacts(bundle, {asOf?})`, `runDataChecks(bundle)`, `runValidators({report, bundle, template, computedFacts})`, `canSign(flags, gaps)`, `applyScope(bundle, template)`, `canonicalJson`, `sha256Hex`, `reportFingerprint`.
  - Auth: `createReceipt` / `verifyReceipt`, `createLaunchToken` / `verifyLaunchToken`, `createSessionToken` / `verifySessionToken`.
  - Docgen and AI: `buildViewModel(report, bundle, template, {receipt?})` returning `ReportViewModel`, and `generateDraftGroup(input)`.
- **`templates/registry.ts`:** `SOLICITOR_RTA_TEMPLATE` (`solicitor-rta-treating-physio`), `EMPLOYER_FFW_TEMPLATE` (`employer-fitness-for-work`), `listTemplates`, `getTemplate`, `defaultTemplateFor`. The extension point is `templates/extensions.ts`.
- **UI:** `api` / `createApiClient` / `ApiError` (`ui/api-client.ts`); `listReports`, `getReport`, `saveReport`, `deleteReport`, `resetDemo`, `exportCase`, `useReports`, `useReport`, `getSession` / `setSession`, `getPasscode` / `setPasscode` (`ui/store.ts`).
- **Glue:** `route` and `getMedreportDeps` (`src/app/api/_medreport-glue.ts`). Sandbox handlers export `simListPatients` etc. plus `dispatchSimRequest`.

The ownership map, import rules, endpoint tables and environment variables are in `src/modules/medreport/README.md`. The spec copy is at `docs/medreport-plan.md` and the variable list at `.env.example`.

Files are in /home/user/careconnect-mk:
- src/modules/medreport/README.md
- src/modules/medreport/core/schemas.ts
- src/modules/medreport/api/contract.ts
- src/app/api/_medreport-glue.ts
- .eslintrc.json
- docs/medreport-plan.md
- .env.example