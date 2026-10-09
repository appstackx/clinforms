The integrator stage passes end to end in demo mode, but I could not test live mode properly: the Anthropic account ran out of credit partway through recording. Every live call now fails with "Your credit balance is too low". Typecheck, lint, all 173 tests and `next build` pass. No browser console errors appeared and no request returned 4xx or 5xx in any demo run. The patient portal is untouched and its pages still build as static. Nothing is committed. The server on :3107 is stopped.

## Recording real AI output
- **Form analyses:** all four sample forms recorded, in 17–28 s each, with no answer locations dropped. Claude's maps for forms (a)–(c) differ slightly from the hand maps (for example, on Kingsway question 3 Claude chose the dotted line and "clinician opinion"). I kept the hand maps as the pre-confirmed ones. Claude's map of the Meridian form (d) is clean and is what an upload returns in demo mode.
- **Drafts recorded:** both built-in templates; Megan on forms (a), (b) and (d); Daniel on form (c), plus Daniel on form (b), which I added.
- **Groundedness checks passed:**
  - Megan: the prognosis, maximum-improvement, restrictions and treatment-recommendation questions are left blank with gaps.
  - Daniel: the recorded discharge opinion ("phased return to normal duties over 2 weeks; avoid repetitive lifting >15 kg for 4 weeks", N-006) is attributed and cited in answers 5–7. Question 4 (fit for normal duties, yes/no) is left blank with a gap, because the note gives no plain yes or no.
  - No past medical or social history appears in Daniel's answers.
- **Prompt change:** one recording wrote "FACT-attendance records 10 of 11" in an answer. I added a rule that source IDs never go in answer text and bumped the form prompt to `forms-3`.
  - Megan's (a) and (b) drafts were re-recorded with `forms-3` and are clean.
  - The re-record of Megan (d), Daniel (b) and Daniel (c) failed on the credit error, so those keep their `forms-2` recordings. None of them has the ID problem.

## Results per step
| Step | Demo mode | Live mode |
|---|---|---|
| a. Forms library: 3 confirmed samples with previews; upload Meridian, analyse, review with highlight, confirm | Pass (analysis 0.3 s, recorded) | Passcode typed in the UI and accepted; the call reached Anthropic and failed on credit; the stored Claude analysis took over and said so |
| b. Megan, Harrow & Pike (Word) | Pass | Live drafting failed on credit; recorded answers took over, labelled "Recorded Claude draft" |
| c. Megan, Northfield fillable PDF | Pass | Not run (no credit) |
| d. Daniel, Kingsway (Word) | Pass | Not run (no credit) |
| e. Save to record, export upload, batch, mobile screens | Pass | Not run (no credit) |

Details:
- **Megan on Harrow & Pike (b):**
  - The launch from the simulated TM3 imported "10 notes · 11 appointments · 6 scores".
  - Clicking a citation opens note N-010.
  - Adding "She will make a full recovery by March 2027" raises both the opinion-wording and the date checks; "Revert to AI draft" clears them.
  - Prognosis is left blank and flagged. The did-not-attend count is 1, and the missing reason is flagged.
  - After the clinician answers and resolves the gaps, the preview shows the Harrow & Pike layout with the DRAFT banner. Approval gives the final Word and PDF.
  - I opened both files: answers are in the right cells, ☒ Yes / ☐ No is ticked correctly, there is no DRAFT text, and the name, HCPC number, signature line and date are filled. The office-use boxes stay blank.
- **Megan on Northfield (c):** the final PDF has no form fields left (flattened). Answers, the ticked Yes, 10 attended and 1 missed all read back correctly.
- **Daniel on Kingsway (d):** the recorded opinion is cited, nothing from his past history appears, and the Word and PDF copies are signed by Tom Ellis, PH-DEMO-02.
- **(e):**
  - The sandbox Documents tab lists the filed files for both patients.
  - The sample export (Priya Nair) works.
  - Batch completes both pairs.
  - At 390 px there is no sideways scrolling on any of 11 screens.

## Timings
| What | Live (recording runs) | Demo |
|---|---|---|
| Form analysis | 17–28 s per form, 2–3 calls in parallel | about 0.3 s |
| Drafting, per group | 6–36 s | – |
| Drafting, whole form | 15–23 s, groups in parallel | – |
| Launch to imported | – | about 1 s |
| Complete form to review | – | 1–3 s |

## Fixes made
- **Styling:** Tailwind now scans the module and sandbox folders, so both are styled in the real build.
- **Case-manager forms:** they now withhold past and social history from the AI, as employer forms do.
- **Northfield map:** every question now has its section, so the grouping no longer shows stray "Other questions" headings.
- **Sandbox wording:** the launch button and app card now say "Complete referrer's report form".
- **References from another organisation (new behaviour):** when the form comes from a different organisation than the referral, the reference is still filled but needs one-click confirmation. Example: Megan's solicitor reference on the Northfield "Policy / claim no." box. This adds one click to the Daniel and Kingsway demo.
- **No failed calls in demo mode:** the bundle response now lists which recorded drafts exist. Without a passcode, the Studio skips drafting calls that would fail and shows a neutral "left for the clinician" message.
- **Live failures fall back honestly:**
  - A failed live analysis uses the stored map of that exact file.
  - A failed live draft uses the recorded answers for that exact patient and form.
  - Both are labelled as recorded, never as live.
- **Other:**
  - New tests for each change above.
  - The README is updated with every request from the slice reports.
  - New `npm run medreport:forms`; rebuilding the sample forms is byte-identical.
  - The shared name-matching rule moved into `core/forms.ts`.

## Remaining rough edges
- **Live mode is untested end to end.** Add credit, then run `live.cjs`, and the c/d/e scripts with a passcode, against `rebuild.sh auto`.
- **Three drafts are on the old prompt.** Megan (d), Daniel (b) and Daniel (c) should be re-recorded with `forms-3` once there is credit.
- **No drafts for uploaded patients in demo mode.** A patient from an export upload gets no drafted answers in demo mode; this is by design and labelled.
- **Watermark partly hidden on PDF previews.** On the DRAFT preview of a PDF form the diagonal watermark sits under the filled boxes; the "DRAFT" footer is always visible.
- **Abbreviations kept in some answers.** Recorded answers still contain a few, such as "2x/wk" and "1 hr".
- **"Draft them now" can fail in demo mode.** In review, on a patient with no recorded answers, it still makes a failing call when clicked.

## Run commands
- **Checks:** `npx tsc --noEmit && npm run lint && npm run test:medreport && npm run build`
- **Record (needs credit, about $5):**
  - `node --env-file=.env.local --import ./scripts/medreport/test-setup.mjs --import tsx scripts/medreport/record-form-analyses.ts --review=<md>`
  - then the same command with `record-demo-drafts.ts`; add `--only=forms` to re-record only the form drafts.
- **App:** `<scratchpad>/e2e/rebuild.sh demo|auto` builds and starts on :3107. To stop it use `pkill -f "[n]ext-server"`; a plain `pkill -f "next start"` also kills the calling shell.
- **End-to-end:** `<scratchpad>/e2e/run-all.sh` runs parts a–e. Then `NODE_PATH=$(npm root -g) node <scratchpad>/e2e/m-shots.cjs` for mobile, or `.../live.cjs` for live.

Your relayed request also asked for a demo video and Blue Heart Clinics' size and budget; neither was part of this stage. The scripts in `e2e/` drive the full flow and can be reused to record the video.

Files are in `/tmp/claude-0/-home-user-careconnect-mk/bbb24e3a-4b8a-53cc-a42c-4dcbe7e661e1/scratchpad/`:
- `final-outputs/`: `megan-hart_harrow-pike_FINAL.docx`, `megan-hart_harrow-pike_FINAL.pdf`, `megan-hart_northfield_FINAL.pdf`, `daniel-brooks_kingsway_FINAL.docx`, `daniel-brooks_kingsway_FINAL.pdf`
- `screens/`: 60 screenshots (desktop and mobile)
- `rec/`: recording reviews
- `e2e/`: test scripts