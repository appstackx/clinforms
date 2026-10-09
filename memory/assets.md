# Assets – every deliverable and where it lives

## 1. In git (`appstackx/clinforms` `main`)
| Path | What | Notes |
|---|---|---|
| `assets/sales/blue-heart/AppStackX-Reports-demo-Blue-Heart-Clinics-voiceover-v2.mp4` | **Final Dell video (USE THIS)** | 6:15 (375.27 s), 1600×900, H.264 + AAC mono 96k, 17,732,637 B, faststart, burned-in captions. Voice Beth. Says "AppStackX Reports" (pre-rename). No AI/Claude wording. Added in `7f6fcf8` |
| `assets/sales/blue-heart/AppStackX-Reports-demo-Blue-Heart-Clinics.srt` | Subtitles, 62 entries | Same timings as burned-in captions; MP4 has no subtitle track (send alongside or mux) |
| `assets/sales/blue-heart/narration-script.md` | 48 timed narration lines, Dell's questions → scenes | Line at 3:46 marked ⚠ (tight) |
| `assets/sales/blue-heart/README.md` | Summary + rules + re-dub notes | Title says "(sent to Dell Baines, 9 Oct 2026)" – written by the agent; **sending not confirmed by Khuram**. Fix the heading ("prepared for … – sending unconfirmed") unless he confirms: `next-steps.md` 7.14 |
| `assets/sales/blue-heart/voiceover/build.py` | v2 voice-over builder (snap to SRT, ≤1.22×, ≤0.5 s early, −16 LUFS) | Hard-coded cloud paths; takes old scratchpad root as `argv[1]` – edit before reuse |
| `assets/sales/blue-heart/voiceover/placement.json` | Final per-line timings/tempo/source clip | |
| `assets/sales/blue-heart/voiceover/segments.json` | 48 lines (post-insertion; indices ≥30 offset from clip names) | |
| `assets/sales/blue-heart/voiceover/parse.py`, `dl.py`, `fit.py`, `fit2.py`, `mix.py` | v1 pipeline | `parse.py` has the ⚠-line bug |
| `scripts/medreport/video/record-demo.mjs` + `captions.json` + `README.md` | Video recorder (Playwright + ffmpeg) | Now outputs ClinForms branding (`clinforms-demo-blue-heart*`); not re-run since rename |
| `scripts/e2e/*.cjs` + `README.md` | Playwright browser scripts used during the build (forms, Megan, Daniel/other forms, misc, neutral-wording scan, live runs, screenshots) | Added in `32499de` (09/10 16:16 UTC); ad hoc, not in `npm test`; written for port 3107; outputs to gitignored `.e2e-out/` |
| `scripts/dev-tools/*.ts` + `README.md` | `probe-models.ts`, `credit-poll.ts`, `diff-recorded.ts`, `flagcheck.ts`, `outline.ts` | Added in `32499de`; run with `npx tsx` |
| `scripts/medreport/build-demo-forms.mjs` | Regenerates the fictional referrer forms byte-identically | Don't change casually (recordings keyed to bytes) |
| `src/modules/medreport/ai/demo-drafts/*.json`, `ai/recorded/forms/*.json` | Recorded Sonnet drafts/analyses | Regenerate final forms in demo mode from these |
| `docs/plan.md` | Plan + Revision 2 | |
| `memory/sources/*` | Briefing, original plan, RED task prompt, build notes, and the six build-stage agent reports (foundation/forms contract, integration, fixes, sandbox) | Verbatim copies from the cloud scratchpad; build reports are historical (test counts 13/13 → 50/50 → 90/90 → 173 → 214/214, the 14 security fixes, contract departures) – superseded by `src/modules/medreport/README.md` |

## 2. Sent to Khuram in the cloud chat (file cards; copies only in his chat history)
| When (UTC) | File | Status |
|---|---|---|
| 06/10 12:31 | `report-builder-plan.md` | = `memory/sources/report-builder-plan.md` |
| 06/10 16:21 | `blue-heart-briefing.md` | = `memory/sources/blue-heart-briefing.md` |
| 06/10 20:42 | `megan-hart_harrow-pike_FINAL.pdf`, `megan-hart_northfield_FINAL.pdf` | Opus-era outputs (superseded) |
| 06/10 21:35 | `appstackx-reports-demo-FIRST-CUT-20MB.mp4` | **Do not use** – mentions Claude, not addressed to Dell |
| 09/10 12:58 | `AppStackX-Reports-demo-Blue-Heart-Clinics.mp4` (silent, 16.6 MB) + `.srt` + `narration-script.md` | Final silent cut |
| 09/10 13:37 | `AppStackX-Reports-demo-Blue-Heart-Clinics-with-voice.mp4` (v1, 17.6 MB) | **Superseded** – missing 3:46 line, early starts |
| 09/10 13:51 | `AppStackX-Reports-demo-Blue-Heart-Clinics-voiceover-v2.mp4` (v2, 17.7 MB) | **Final** – also in git |
| 09/10 15:26 | `red-physio-demo-task.md` | = `memory/sources/red-physio-demo-task.md` |

## 3. External accounts
- **ElevenLabs** flow "AppStackX demo voice-over – Blue Heart Clinics", id `gfLay4qckJq49KVb4Ghd` (connector's own workspace, not "ElevenCreative"): 47 TTS nodes + test line + replacement line 30 (`Rx2BZVm7pKMgkUJjbgP2`, 11.92 s, text "Here's the final PDF as downloaded: their layout, TM3 details, answers from the notes, her own prognosis and approval – no draft mark.") + empty price-check node. Clips can be re-downloaded from there.
- **GitHub:** `appstackx/clinforms` (private), `appstackx/careconnect-mk` branch `claude/confident-noether-z6l7kr`.

## 4. NOT preserved (cloud container only – assume gone)
| Item | Size | Impact / how to recreate |
|---|---|---|
| `master.mp4` – 1080p silent master of the final video | 56.2 MB | Re-record with the recorder (~10 min, ~8 live calls) |
| `master-voiceover-v2.mp4` – 1080p voiced master | 64.9 MB | Re-record + re-dub (~$1 ElevenLabs) |
| `narration.wav` (36 MB), clip MP3s (47 + line30-short + new-226 + test-000), `gens.json`, `clips.json`, `onsets.json`, loudnorm JSON | ~50 MB | Regenerate from the ElevenLabs flow or anew |
| E2E runner shell scripts `run-all.sh`, `rebuild.sh` (the `.cjs` scripts themselves ARE in git, `scripts/e2e/`) | small | `rebuild.sh` = `npm run build` then `MEDREPORT_AI_MODE=$MODE npx next start -p 3107` + poll `/api/reports/v1/health`; `run-all.sh` ran a-forms, b-megan, c-d, e-misc, n-neutral |
| Model/effort sweep script `sweep.ts` (`diff-recorded.ts`, `flagcheck.ts` ARE in `scripts/dev-tools/`) | ~30 KB | Rebuild if a model change is considered; results tables are in the module README "Model and effort" |
| Final completed forms (`megan-hart_harrow-pike_FINAL.docx/.pdf`, `megan-hart_northfield_FINAL.pdf`, Ashcroft, Kingsway…) | 14–88 KB each | Regenerate in demo mode from recorded drafts |
| Video cards (title/intro/GDPR/recap/next-step HTML+PNG, `poster.png`) | ~2.5 MB | Recorder regenerates them |
| Screenshots (183 in `screens/`, `clinforms-screens/01–03`, `clinforms-verify/v01–v12`) | ~95 MB | Retake as needed |
| Workflow scripts/journals, task outputs, scratchpad logs, superseded video runs (~3.5 GB) | – | Not needed |
| The user's screenshots of real RED emails (`images/3–5.webp`) | – | Personal data – intentionally not kept; text transcribed in `projects/red-physiotherapy.md` |
| `careconnect-mk/.env.local`, the pasted API key file | – | **Secrets – never copied.** Recreate `.env.local` with new values |

## 5. Video facts (for reuse)
- Recorded live 09/10 12:29–12:36 UTC on Sonnet 5.5, `MEDREPORT_AI_MODE=auto`; viewport 1600×900 CSS × device scale 1.2 → native 1920×1080 frames (`record-demo.mjs` `VIEW`/`SCALE`); 48 captions; 62 SRT entries; banned-term guard 45 checks, 0 hits.
- Chapters: title 0:00 → intro 0:05 → Q1 0:20 → Q3 1:18 → Q2 1:52 → Q4 2:37 → Q1 again 4:02 (side by side 4:35) → Q3 again 4:54 → Q5 5:14 → GDPR card 5:39 → recap 5:52 → next step 6:06.
- Minor issues accepted: "Form approved" toast covers part of the right panel briefly; side-by-side labels cover a little text; SRT reads fast on chapter cards; cursor on "Security & GDPR" link ~1 s at 0:30; a caption lingers after the Northfield Approved screen. v2 was not independently re-QA'd (one line +0.54 s late; line-19 click fix unverified).
- Redo recipe: re-record with the recorder (ClinForms branding), regenerate lines with Beth/`eleven_v4` on a new flow, run `build.py` (edit paths), add 10–20 ms fades, QA with Scribe against the SRT.
