I've built the whole connectors, auth and data-endpoints slice; nothing is stubbed except the real TM3 connector, which is meant to be. tsc and ESLint are clean on my files, and `npm run test:medreport` passes 50/50, of which 25 are new. Case A raises the DNA-without-reason and no-pre-incident-history checks. I didn't commit, run `next build` or change any shared contract file.

**Implemented**
- **Simulated TM3 connector** (`connectors/tm3-sim/client.ts`, `connector.ts`):
  - It makes real HTTP calls with the Bearer token, follows paging and checks every response against the wire schemas.
  - Each call writes one log entry (method, path, status, ms, transport). Entries appear in the order the calls were made, and never contain the token or note text.
  - Errors come back as typed connector errors.
  - It covers patient search (with episode summaries), episode lists, bundles via the mapper, and filing a document back.
- **Real TM3 connector** (`connectors/tm3/connector.ts`): status "not configured", and every call throws NOT_CONFIGURED. The list of what TM3 must expose is in `tm3/requirements.ts`, which the Studio tile can import.
- **File import** (`connectors/file-import/`): our own JSON format (same shape as the simulated wire data), CSV, and pasted anonymised notes split on dated headings.
  - Problems come back in plain English with a location, e.g. "line 7, column 'time'".
  - The sample patient is Priya Nair (fictional, solicitor case, QuickDASH and NPRS scores). The same case is offered as JSON, CSV and text from `samples/index.ts` (`SAMPLE_IMPORT_FILES`).
  - `format.ts` and `samples/` contain no server-only code, so the Studio can import them.
  - Pasted notes never create appointments. Times would have to be invented, so attendance needs CSV or JSON.
- **Registry**: tiles in the order simulated TM3, file import, TM3.
- **Auth**:
  - `requireSession`, `assertSessionConnector` and `assertSessionEpisode` in `session-token.ts`.
  - `passcode.ts` now has `createRateLimiter`, `takeLiveCall()` (returns ok or a retry-after time) and `liveCallRetryAfterSeconds`. The existing `takeLiveCallSlot` and `checkLivePasscode` are kept for the AI agent.
- **Handlers**:
  - `launch`: checks the partner key in constant time; returns 201.
  - `launch-verify` and `sessions-demo` (201).
  - `connectors-list` and `patients`: a session opened from a launch link only ever sees its own patient.
  - `bundle`: also re-checks the bundle against the schema.
  - `file-import-bundle`: bad files get 422 IMPORT_INVALID with the problems listed.
  - `documents`: checks the file extension, magic bytes, SHA-256 and the sign receipt's MAC before filing, and rejects a mismatched checksum from the clinic system.
  - Connector errors become problem+json responses through the new `connectors/handler-support.ts`.
- **Computed facts and data checks**: every check code, each raised at most once per bundle, blocking first. Facts never include the patient's name, date of birth or contact details.
- **Glue** (`_medreport-glue.ts`): tries HTTP first with a 6 s timeout and forwards `VERCEL_AUTOMATION_BYPASS_SECRET` (same as the sandbox's launch action). It falls back to in-process calls when the response isn't from the simulated API. `MEDREPORT_SIM_TRANSPORT=in-process|http` forces either path.

**Tests**: 25 new tests in `parser.test.ts`, `session-token.test.ts`, `passcode.test.ts` and `scripts/medreport/integration.test.ts`. The integration tests run launch → verify → bundle, patients, file import and documents through the glue with the in-process fallback. I also checked the real HTTP path with a throwaway local server: all five calls returned 200 over HTTP.

**Known issues**
- The documents request carries the receipt but not the report, so only the receipt's MAC and tenant can be checked there, not its content hash.
- File-import uploads have no pre-written demo drafts, so in demo mode the drafts endpoint will have nothing to return for them; the Studio should handle that.
- FACT-age defaults to today's date. Callers should pass `asOf` as the report date.

**Requests for orchestrator**
1. Docgen: export a `verifyReceiptMac(receipt)` from `auth/sign-receipt.ts`. `documents.ts` currently has a local copy (`receiptMacValid`, marked TODO) that I'd swap for it.
2. README: add pointers to the import format, `SAMPLE_IMPORT_FILES` and `TM3_REQUIREMENTS`, and note that `connectors/file-import/format.ts`, `connectors/file-import/samples/**` and `connectors/tm3/requirements.ts` are deliberately browser-safe. Optionally have `gen-eslint-boundary.mjs` enforce that.
3. Studio-a: read import problems from `problem.issues` (`path` = where, `message`); the integration log for an upload is one PARSE entry.
4. AI agent: the new rate-limit helper is `takeLiveCall()`; use `retryAfterSeconds` for the 429 `retry-after` header.

Files are in `/home/user/careconnect-mk`:
- `src/modules/medreport/connectors/tm3-sim/client.ts`
- `src/modules/medreport/connectors/tm3-sim/connector.ts`
- `src/modules/medreport/connectors/tm3/connector.ts`
- `src/modules/medreport/connectors/tm3/requirements.ts`
- `src/modules/medreport/connectors/registry.ts`
- `src/modules/medreport/connectors/handler-support.ts`
- `src/modules/medreport/connectors/file-import/format.ts`
- `src/modules/medreport/connectors/file-import/parser.ts`
- `src/modules/medreport/connectors/file-import/connector.ts`
- `src/modules/medreport/connectors/file-import/samples/index.ts`
- `src/modules/medreport/connectors/file-import/samples/priya-nair.ts`
- `src/modules/medreport/connectors/file-import/parser.test.ts`
- `src/modules/medreport/auth/session-token.ts`
- `src/modules/medreport/auth/passcode.ts`
- `src/modules/medreport/auth/session-token.test.ts`
- `src/modules/medreport/auth/passcode.test.ts`
- `src/modules/medreport/core/computed-facts.ts`
- `src/modules/medreport/core/validation/data-checks.ts`
- `src/modules/medreport/api/handlers/launch.ts`
- `src/modules/medreport/api/handlers/launch-verify.ts`
- `src/modules/medreport/api/handlers/sessions-demo.ts`
- `src/modules/medreport/api/handlers/connectors-list.ts`
- `src/modules/medreport/api/handlers/patients.ts`
- `src/modules/medreport/api/handlers/bundle.ts`
- `src/modules/medreport/api/handlers/file-import-bundle.ts`
- `src/modules/medreport/api/handlers/documents.ts`
- `src/app/api/_medreport-glue.ts`
- `scripts/medreport/integration.test.ts`

`computed-facts.ts`, `data-checks.ts` and the simulated TM3 `connector.ts` were already in your WIP commit 382afe2.