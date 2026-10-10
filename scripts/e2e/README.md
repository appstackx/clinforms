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
| `notes-import-check.cjs` | Wave 3 notes import in a clinic's Studio (LOCAL SQLite only): owner account + two-step; uploads a printout PDF, a letter and a table as Word documents, a CSV export and email-style notes, pastes notes (incl. uncertain details and the documented layout); checks the review step, confirming, browser storage, 375 px and the activity entries. Needs `INVITE_FILE`, `INPUTS` (from `scripts/medreport/write-notes-fixtures.ts`), `RUN_ID`; see the module README "Production wave 3" |
| `demo-video.cjs` | The product demo video at `/demo` (no database, any local `next start`): nothing reaches `media.clinforms.co.uk` before play or from a `?t=` link; play makes an anonymous CORS request with no cookies (with a credentialed control request that does carry a cookie); with the media host stubbed to 404 the fallback panel offers the transcript; keyboard (play button, chapters, focus into the panel); a request that hangs (mouse play hands focus to the video; the panel after the stall time); the end panel (call, replay, interactive demo; also at 375 px); 375 px (no sideways scroll, the pill in the poster's lower band, the 720p file and its download); the header from 375 px to desktop ("Demo video" / "Interactive demo", `aria-current` on `/demo`). `REAL_MEDIA=1` also plays the real file in Google Chrome with the page served as `https://clinforms.co.uk/demo` (end card under the end panel, "Watch again", a held-back response that recovers). `ANALYTICS=1` needs a build with a dummy `NEXT_PUBLIC_POSTHOG_KEY` (`/ingest` is answered in the browser; the contexts hide automation, which the library would drop as a bot): nothing before consent, the two video events with `area` only, nothing after withdrawal |
| `tenant-full-flow.cjs` | A clinic's whole day (wave 2): owner account + two-step, clinic details and drafting switched on, clinician invited and given HCPC + "may sign"; clinician uploads the Northfield fillable PDF, confirms the map, uploads printed notes, drafts with the clinic's drafting (no passcode or demo session), answers and resolves, approves as themself, downloads the final PDF; reload + second browser read it from the server with nothing in browser storage; the public demo still works while signed in; activity pages; another clinic gets 404/403. Needs `RUN_ID`, `INVITE_A_FILE`, `INVITE_B_FILE`; preview or local only |

They were written for the original host repo (on port 3107), and only their paths were adjusted when they were copied here, so expect to fix selectors or ports if they fail.
