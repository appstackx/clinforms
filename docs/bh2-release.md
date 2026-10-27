# Blue Heart release (bh2) – what changed, decisions, release rule, deploy and rollback

Branch `release/bh-trial-2`, tag **`bh2-rc1`** (release candidate 1: the seven workstreams merged and integrated).
Internal document – fictional data only, no secrets, no vendor names customer-facing. (bh2 fix round 1, WA1 – an
ownership exception, the integrator's document: §3.4 check-issued for approvals made before the release, §4.1 shim 2
first, §5 rollback to shim 2.) The full plan (with the
production data steps P0–P3.7 and the verification protocol) is the approved bh-quality plan; this file is the
release's own summary and runbook. Production is `main` (Vercel production branch). **Nothing here is run against
production without Khuram's go at that step.**

## 1. What changed (by workstream, merged in this order)

| # | Workstream (branch @ commit) | In one line |
|---|---|---|
| 1 | WA1 issue state and receipt (`ws/bh2-issue` @ 7c482dd) | One hashed answer to "what does this box issue" (`core/issue-state.ts`), read from the attested map's own conditions; `/sign` approves only the clinic's stored revision, runs a dry-run FINAL fill and binds the issued document and the acknowledgements into the receipt; `/render` FINAL issues exactly that or refuses (409 `ISSUED_COPY_CHANGED`, audited `report.issue_refused`). |
| 2 | WA2 forms engine (`ws/bh2-engine` @ 5f2114b) | The fill reports what it did per box (`FillOutcome`); FINAL refuses a fatal outcome; uncertain Yes/No answers are never a definite tick; bounded work. |
| 3 | WB opinion guard and attribution (`ws/bh2-opinion` @ e7a1abd) | Production-strength opinion guard anchored to the cited notes; the approver is the voice owner; a colleague's finding names the colleague; one-click attribution fixes; "Accept as my note's words". |
| 4 | WC review roles and provenance (`ws/bh2-review` @ ac70740) | The approver chosen at creation; server-stamped provenance; staff entries in clinician boxes are proposals the approver adopts with one audited click; acknowledgement policies (never / approver / member); the store decides what a box is; amendments. |
| 5 | WD drafting and text edits (`ws/bh2-drafting` @ 8597519) | No silent rewording; the one-click engine (repeat removal, value only, dose not stated, printed lead, WB's generators), each checked by the engine's rules; held-back meta wording and choices; time points. |
| 6 | WE data and maps (`ws/bh2-data` @ 5d8a200) | `--replace-proposed` / `--restore-maps` with the map lint (L1–L12), printedLeads, session dates. The v2 maps stay gitignored. |
| 7 | WF copy, preview and guide (`ws/bh2-copy` @ 614f060) | Summary PDF intro from the approver and the note authors; activity labels with no raw codes; the guide-terms check. |

Integration (WI, commits "WI (bh2-rc1) …" between the merges): the cross-workstream fixes and tests are listed in
`scripts/medreport/bh2-integration.test.ts` (one `describe` per seam) and in each commit message. The review now
shows each flag's one-click corrections (`ui/components/review/one-click-offers.tsx`): the engine's text fixes with
their before/after preview, and – to the approving clinician only – "Accept as my note's words (“…”)" and "Remove
the note link".

## 2. Decisions this release rests on

- **DoC-1** (definition of clean, fixed when W0 landed; changing it needs Khuram's written approval): the plan's
  C1–C11. Release candidates are verified against it (V1, fix rounds, V2 with the 3-lens review).
- **Khuram, 26/10/2026 (binding):**
  - Opinions: the approving physio (may sign) may accept with ONE click a drafted return-to-work / work-status line
    that THEIR OWN note records – shown the note's words, recorded with by/at. Any other opinion must quote a
    physio's note or be written by the approver.
  - An optional sentence-opener box left blank: the issued form drops the printed lead words and dots.
  - Live drafting on the local mirror with fictional patients is approved (verification only).
  - Reuse-notes ships in this release, through the same report factory.
  - Allowlist: only `DIFF:OPN-ok-f1` and `DIFF:ISSUE-na-noprint-01` (both in `allowlist.json`). No other entry without
    his approval.
- **Ship rule (26/10 16:00):** ship when all 17 forms × 3 sample patients × 2 runs test clean and no remaining gap
  would show on Dell's forms or the test patients. Detector recall gaps for unusual wordings go on the KNOWN-LIMITS
  list (fixed during the trial; the physio still reviews and signs every line). Structural / server-trust problems,
  data loss, changed figures or findings, cross-clinic access, DoS, regressions against production and any gap the 17
  forms or 3 sample notes would hit must be fixed.

## 3. Release rule (before ANY deploy of this line)

1. The full chain is green: `npm run typecheck && npm run lint && npm run test:medreport && npm run test:db &&
   npm run test:auth && npm run test:site && npm run test:gateway && npm run build` (only the 3 LibreOffice skips).
2. The safety corpus: `node scripts/medreport/corpus-guard.mjs bh2-base2`, the lock check, and at the final release
   `CORPUS_STRICT_PENDING=1 npm run test:medreport` (pending.json empty, allowlist = Khuram's entries only).
3. The rollback shim still reads what this release writes: copy `scripts/medreport/forward-compat-fixture.ts` and
   `schema-forward-compat.test.ts` into a throwaway worktree of `origin/main` and run the test there (15/15 at
   bh2-rc1). Every new stored key or open-enum member goes into the fixture; a new member of an enum production keeps
   closed needs a new shim on `main`, deployed, first.
4. If any approved trial report exists: `npm run -s admin:check-issued -- --slug <clinic> --baseline-ref <production
   commit>` (read-only; `--env production` only with Khuram's go; the production commit is the one `main` runs –
   `c883ce5` until shim 2 is deployed, then shim 2's commit; the default is `origin/main`, refused once it holds this
   release). bh2 fix round 1 (R1T-WA1-01): an approval made BEFORE the release (a receipt production minted) is no
   longer `UNBOUND`: its FINAL copy is issued by this build and by production's own code and compared – `SAME`, or
   `CHANGED` with what differs (Word text lines, "layout only (same text)", the boxes whose answers differ by id, or
   "this build refuses the final copy"). Any `CHANGED`, `NOT_COMPARED` (no baseline) or `ERROR` stops the deploy until
   **Khuram has decided on each CHANGED report** (accept the new copy, or have the clinic re-approve it as an amended
   version). appstackx-test holds such approvals: run it there before the deploy.
5. The guide matches the screens: `CLINFORMS_WELCOME_DIR=<main checkout>/demo-assets/outputs/blue-heart/welcome node
   --import ./scripts/medreport/test-setup.mjs --import tsx scripts/medreport/guide-terms-check.mjs --pack`.

## 4. Deploy runbook (Khuram's go at each step)

1. **The shims first.** (a) The forward-compatibility shim is already on `main` and live (c883ce5 = e132057 + the
   shim, deployment `dq4nlrb96`). (b) **Shim 2** (bh2 fix round 1, R1T-WA1-02 / RG-3; branch
   `fix/schema-forward-compat-2`, from `origin/main`): production's `/render` FINAL refuses (409 `RECEIPT_INVALID`,
   "approved with a newer version") any receipt that carries the release's `issuedContentSha256` or
   `acknowledgementsSha256` – the portal question set's receipt has the acknowledgement hash only – instead of re-issuing
   it with production's engine (which would print boxes the release left out). Merge it into `main` on its own (full
   chain, push = deploy), wait for Ready, smoke-check, and confirm it is the current production deployment before
   step 3: **the shim-2 deployment is the release's rollback point** (Hobby rolls back one step only – deploy nothing
   in between). Then run the check in §3.4 with `--baseline-ref` = shim 2's merge commit.
2. **Verify the candidate** on the local mirror (plan: P2 rehearsal, V1 → fix rounds → V2 + 3-lens review). Tag
   `bh2-final` only when DoC-1 holds.
3. **The release as a separate deployment:** `git merge --no-ff release/bh-trial-2` into `main` (no squash), full
   chain on the merge, push = deploy.
4. **Smoke checks** (read-only): `curl -s https://clinforms.co.uk/api/reports/v1/health`; the gateway health; the
   public demo `/reports` opens a report and its review; a clinic Studio sign-in by Khuram's own account only.
5. **Data steps P3** (appstackx-test first, then blue-heart-clinics), exactly as the plan lists them – dry runs first,
   counts against the ids-only expectations file, stop on any LOAD / SKIP / REFUSED.

## 5. Rollback

1. **Code:** promote the **shim-2** deployment (§4.1(b) – the previous production deployment; Hobby rolls back one
   step only, so do not deploy anything in between). It reads every report, receipt and map the release wrote
   (section 3.3), and it **never issues a FINAL copy of an approval the release made**: such a download is refused (409
   `RECEIPT_INVALID`, "approved with a newer version of ClinForms"); a draft copy still renders, and every approval
   made before the release issues as before. To issue a release-approved report while rolled back, the clinic creates
   an amended version and approves it again on the rolled-back build. (Without shim 2 – the older shim, `dq4nlrb96` –
   production re-issues release-approved reports with its own engine: ruled-out text, cleared ticks and default session
   lengths print again (RG-3). **Open alternative, if shim 2 is not wanted:** Khuram accepts in writing that FINAL
   copies of release-approved reports are unavailable – or differ – after a rollback; record that decision here.)
2. **Maps:** restore the v1 maps with `admin:load-forms --replace-proposed --restore-maps` and the maps-v1 file set
   (P3.7). Only proposed, unedited maps are replaced; a map-level L1/L12 finding refuses the restore.
3. **Last resort:** D1 Time Travel on `clinforms-prod` to a point before the data step (it rewinds every clinic –
   Khuram's call, after the two steps above).

## 6. Open at bh2-rc1 (escalated – details in the integration report)

- 4 differential items awaiting Khuram's allowlist decision (`DIFF:ISSUE-merge-na-01`, `DIFF:ISSUE-na-person-02`,
  `DIFF:ROLE-ownanswer-settles`, `DIFF:ROLE-mark-na~actor-approver`): each is the release doing what an approved
  design says (content never issued; the approver's own words), where production blocks.
- 9 corpus rows that cannot hold as written (they contradict another locked case or an approved design, or lack the
  faithful fix they get) – cases are append-only, so their retirement is Khuram's / W0's call.
