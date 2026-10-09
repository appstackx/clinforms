# Browser end-to-end scripts (Playwright, ad hoc)

These scripts were used during the build to drive the Studio UI and the simulated TM3 through every flow, and to take screenshots. They are plain Node scripts, not part of `npm test`.

**Setup:**
- Install Playwright once: `npm i -D playwright && npx playwright install chromium`.
- Alternatively, point `PW_CHROMIUM` at an existing Chromium.

**Running:**
1. Start the app (`npm run dev`, or `npm run build && npm start`).
2. Run a script, e.g. `BASE=http://localhost:3000 node scripts/e2e/a-forms.cjs`.
   - Screenshots and downloads go to `.e2e-out/` (gitignored), or to `E2E_OUT`.
   - Set `LIVE=1` for live drafting. The scripts then read `MEDREPORT_LIVE_PASSCODE` from `.env.local` and never print it.

| Script | Flow |
|---|---|
| `lib.cjs` | Shared helpers: browser profile, console/network error capture, downloads |
| `a-forms.cjs` | Forms library: upload, analyse, confirm mapping |
| `b-megan.cjs` | Megan Hart (RTA) report on her solicitor's form, end to end |
| `c-d.cjs`, `c-only.cjs` | Daniel Brooks (employer) and the other demo forms |
| `e-misc.cjs`, `ovf.cjs`, `vp.cjs` | Edge cases: overflow and continuation sheets, viewport checks |
| `n-neutral.cjs` | Checks that customer-facing text uses neutral wording |
| `m-shots.cjs`, `peek*.cjs` | Screenshots |
| `flows.cjs` | All flows in sequence |
| `live.cjs`, `live2.cjs` | Live (real model) drafting runs |
| `pdfcheck.mjs` | Inspects a filled PDF's fields |
| `auth-flow.cjs` | Sign-in and clinic area: invitation → account → two-step set-up → settings pages → sign out/in with a code and a backup code. Needs `INVITE_LINK_FILE` (the output of `npm run admin:create-clinic`); see `docs/auth.md` §7 |
| `tenant-studio.cjs` | A clinic's own Studio (`/app/studio`): guard (no session → `/login`, no two-step → `/two-factor`), no demo chrome or links, notes upload only, forms library without samples, batch notice, public security page, missing report, no analytics without consent, sign out from the account menu, the public demo unchanged. `FLOW=complete` also completes a built-in report from pasted fictional notes. Needs `INVITE_LINK_FILE` (+ optional `CLINIC_NAME`); preview or local only |
| `tenant-full-flow.cjs` | A clinic's whole day (wave 2): owner account + two-step, clinic details and drafting switched on, clinician invited and given HCPC + "may sign"; clinician uploads the Northfield fillable PDF, confirms the map, uploads printed notes, drafts with the clinic's drafting (no passcode or demo session), answers and resolves, approves as themself, downloads the final PDF; reload + second browser read it from the server with nothing in browser storage; the public demo still works while signed in; activity pages; another clinic gets 404/403. Needs `RUN_ID`, `INVITE_A_FILE`, `INVITE_B_FILE`; preview or local only |

They were written for the original host repo (on port 3107), and only their paths were adjusted when they were copied here, so expect to fix selectors or ports if they fail.
