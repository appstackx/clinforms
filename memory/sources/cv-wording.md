I fixed the audit leftover: the "Export case JSON" file now writes `"kind": "narrative"` where it used to write `"ai_narrative"`. Type-check, lint, tests and the build pass, but I couldn't run the browser E2E demo pass. Rebuilding also left the orchestrator's :3107 server serving a missing file, so it needs a restart.

**What changed**
- `/home/user/careconnect-mk/src/modules/medreport/core/case-export.ts`: `encodeCaseReport` maps section kind `ai_narrative` to `narrative`, and `decodeCaseReport` maps it back on import. Imported reports match the stored ones exactly, so an approved report still re-hashes to its receipt. No existing kind uses `narrative`, so nothing clashes. The internal kind and its schema enum are unchanged. The file header documents the new mapping. The format stays at version 2, because `case-export.ts` has never been committed.
- `/home/user/careconnect-mk/scripts/medreport/neutral-wording.test.ts`: the Harrow & Pike export test now checks that the report has `ai_narrative` sections and that the export holds no `"ai_*"` or `"*_ai"` values. The round-trip test now checks that `ai_narrative` is gone from the file and `narrative` is there, as well as the existing fingerprint match after import.
- `/home/user/careconnect-mk/src/modules/medreport/README.md`: the case export bullet lists the new mapping.

**Checks**
- **tsc** (`npx tsc --noEmit`): clean.
- **lint** (`npm run lint`): no warnings or errors.
- **Tests** (`npm run test:medreport`): 226 passed, 0 failed.
- **Build** (`npm run build`): passed.
- **In-process export check** (`/tmp/claude-0/-home-user-careconnect-mk/bbb24e3a-4b8a-53cc-a42c-4dcbe7e661e1/scratchpad/kindcheck/check.mts`): I built exports for the three mapped sample forms (Harrow & Pike, Northfield, Kingsway) with both demo patients (Hart and Brooks), six exports in all.
  - Every `ai_narrative` section came out as `narrative`; Northfield and Kingsway had 3 each, Harrow & Pike had 4.
  - None of the exports matched the banned terms or a lowercase `ai` token.
  - All six imported back with the same fingerprint.

**Not done: E2E demo run.** Both attempts to start a server were denied by the permission system: restarting :3107 and starting a separate demo server on :3112. As a result, `run-all.sh` has not been run against this change.

**:3107 needs a restart.** It is the old `next start` process (PID 9004, started with `MEDREPORT_AI_MODE=demo`) and I rebuilt `.next` underneath it. `/reports` and `/pms-sandbox` still return 200, but the old pages ask for `/_next/static/chunks/2591-ba186fff0dbdbd1d.js`, which the new build no longer has, and that request returns 400. To fix it, restart the server with `MEDREPORT_AI_MODE=demo npx next start -p 3107` from the repo root, then run `run-all.sh`. I did not commit or push anything.