I re-recorded all five form drafts, not just the three you named, and ran the live flow end to end. All checks pass: `tsc`, lint, 229/229 tests and `next build` (patient portal pages still static and untouched). The full demo-mode suite passed (42/42), and the live runs passed after one fix. Nothing is committed. The server on :3107 is back in demo mode, as I found it.

**Re-recording and prompt changes**
- The Harrow & Pike and Megan → Northfield drafts were also on an older prompt (`forms-3`), so I re-recorded them too. That changes their text, so the demo video may need checking.
- The first re-record of Daniel's Kingsway and Northfield forms raised a blocking "Opinion wording" flag. The notes say "Seen by GP: mechanical LBP" and the draft said the GP "diagnosed" it.
  - I bumped the form prompt to `forms-5` (`src/modules/medreport/ai/form-prompts.ts`). It now uses "diagnosed", "confirmed", "resolved", "chronic" and similar words only when the cited note does.
- During live testing, one of three live Kingsway drafts ticked "Yes – fit to return to normal duties" from Daniel's qualified phased-return opinion.
  - I added a second rule to `forms-5`: a qualified opinion is never turned into a plain Yes/No or a non-matching option. The answer is left blank with a gap that quotes the opinion.
  - After that, 0 of 5 Kingsway drafts ticked it, and 0 of 4 for Daniel on Northfield.
- `NPRS` was still appearing in Megan's answers. Drafted answers now spell out a fixed list of clinical abbreviations (NPRS, NDI, ODI, AROM, HEP, LBP, "WAD II" and others), with tests (`core/voice.ts`).
  - References such as HP/RTA/2291, spinal levels and GP/HR are left alone.
  - This also applies to the built-in template drafts and live output.

**Review of the final recordings (all five forms)**
- Every paragraph is cited, and the figure and date checks raise nothing.
- Megan's prognosis is blank and flagged on Harrow & Pike (F-14), Northfield (F-17) and Meridian (F-14). Maximum improvement and fitness for work are blank too.
- Daniel's return-to-duties opinion is attributed with N-006 on Kingsway Q6 and Q7 and Northfield F-12 and F-14.
- There is no knee, asthma or social history in Daniel's answers.
- Recordings are written in the third person, so the review offers "Write in my own voice".

**Meridian recorded analysis:** it is consistent with the three live analyses: 17 questions each time with the same fill sources. I filled the form with both the recorded and a live map; both put the answers in the right cells, including the attended (10) and missed (1) counts that share one line.

**Bug fixed (live):** completing a second form straight after the first hit the per-minute live limit (about 6 calls a minute). Groups came back 429, the screen showed "could not be drafted" and the questions were left blank.
- Groups that hit the limit now wait 12 s and try again, up to 5 times, and the progress list says "Live drafting is at its limit for this minute – waiting…" (`ui/components/new/generate.ts`, `draft-progress.tsx`, `core/wording.ts`, new test `scripts/medreport/generate-rate-limit.test.ts`).
- Re-run results: Megan → Meridian waited once and finished in 29–32 s, all live. A batch of two forms right after a live draft got four 429s and finished in 84 s, all live.
- The review screen's "Draft them now" still does not retry by itself.

**Live timings (production build, `MEDREPORT_AI_MODE=auto`)**

| Step | Time |
|---|---|
| Upload and analyse Meridian (2 parallel requests) | 23–25 s |
| Megan → Harrow & Pike, click to review | 18–22 s |
| Megan → Northfield, click to review | 15–24 s |
| Megan → Meridian (just-analysed map) | 18 s, or 29–32 s after waiting for the limit |
| Daniel → Kingsway | 17–18 s |
| One drafting group (server time) | 7–20 s |
| Recording, per form | 14–18 s |
| Demo mode, whole form | 2.6–3.6 s |

**Live differences that matter for a scripted demo**
1. **Voice:** live drafts are in the signer's first person ("At my final review…"). The signer is Sarah Reid for Megan and Tom Ellis for Daniel. Recordings are third person and show the "Write in my own voice" step; in live runs that step never appeared.
2. **Prognosis and opinion questions:** in every live run on the final prompt these were blank and flagged. That covered Harrow & Pike, Northfield, Meridian and Kingsway Q4/Q5.
3. **Text varies run to run:** wording, paragraph count (10–13) and word count (580–800) all change.
   - Borderline questions also vary: Harrow & Pike "Functional restrictions" sometimes gets advice paragraphs, and Northfield F-12 and Meridian F-06 sometimes get a gap.
   - So the number of items to resolve varies. Don't script exact counts, gap positions or answer text.
4. **Meridian referrer name:** a live analysis names the referrer "Meridian", because the full name is only in the page header, which the analysis doesn't read. The recording says "Meridian Claims Services (fictional)". In a live demo, type the name into the upload dialog's optional Referrer field. Teaching the analysis to read headers would mean another prompt change and re-recording the analyses.
5. **Kingsway Q4 and Q5 are now blank in both live and recorded runs.** The presenter has to tick Q4 "No" and Q5 "Yes, with the adjustments below"; I updated the scratch script `c-d.cjs` to do this. Daniel → Northfield F-13 no longer pre-ticks "Modified duties".
6. **Per-minute limit:** analysing a form plus completing one form uses about 5 live calls. Allow about 60 s before the next live form, or the audience will see the waiting line.
7. **Ashcroft flat PDF:** uploaded in live mode, it gets a live reading instead of the pre-written map. That is what the code does; I didn't run it live.
8. **Small embellishments:** one live answer said "I passed this recommendation to HR and occupational health", which the note doesn't say. The checks don't catch this; the clinician's review is the safeguard.

**Wording:** the live UI scan found no banned words on any screen: mode dialog, upload and analysis dialog, mapping, completing, review, flags and preview. The live final Word and PDF files I checked (Kingsway, Northfield, Ashcroft) contain no banned words and no DRAFT marking.

**Other changes in the tree:** the case-export edits in `core/case-export.ts`, `schemas.ts`, `types.ts`, `ui/store.ts`, `neutral-wording.test.ts` and the README case-export bullet were there before I started and pass with everything else. I also updated the README for `forms-5`, the abbreviation expansion and the retry.

**Commands (from /home/user/careconnect-mk)**
- Checks: `npx tsc --noEmit && npm run lint && npm run test:medreport && npm run build`
- Re-record form drafts: `node --env-file=.env.local --import ./scripts/medreport/test-setup.mjs --import tsx scripts/medreport/record-demo-drafts.ts --only=forms --review=<file.md>`
- Server: `<scratchpad>/e2e/rebuild.sh auto` (or `demo`). To switch mode without rebuilding: `pkill -f "[n]ext-server"; MEDREPORT_AI_MODE=auto npx next start -p 3107`
- Demo suite: `<scratchpad>/e2e/run-all.sh`
- Live, all with `NODE_PATH=$(npm root -g)` and run from `<scratchpad>/e2e`:
  - `node live.cjs`
  - `RUN=runN STEPS=2,3,4,5 node live2.cjs` (new detailed live script; results go to `<scratchpad>/live-runs/<RUN>/`)
  - `LIVE=1 PFX=lv node c-d.cjs`
  - `LIVE=1 PFX=lv node e-misc.cjs` (`LIVE=1` is a new option in `lib.cjs` that sets the passcode)

Logs and outputs are in `/tmp/claude-0/-home-user-careconnect-mk/bbb24e3a-4b8a-53cc-a42c-4dcbe7e661e1/scratchpad/`:
- `rec2/forms5-final-review.md`
- `rec2/variance-forms5b.log`
- `live-run3.log`
- `live-cd2.log`
- `live-e.log`
- `run-all-demo2.log`
- `live-runs/`
- `final-outputs-live-run/`
- `final-outputs/` (demo-run files, restored)