# History – dated timeline and lessons learned

All times **UTC** (UK BST = UTC+1). Cloud session ran Tue 06/10 – Fri 09/10/2026; Thu 08/10 had no activity. From 09/10 ~16:00 the work moves to the Claude desktop app; production go-live Sat 10/10 17:13.
Add new dated entries at the bottom of §1 (chronological) as work continues.

## 1. Timeline

### Tue 2026-10-06
| Time | Event |
|---|---|
| 09:21 | Khuram pastes **Dell Baines' first email** (Blue Heart uses TM3; wants Word/PDF medico-legal/company reports from registration + notes). Asks: does CareConnect do it? solution? monthly price? |
| 09:24 | Assistant: CareConnect can't (portal demo; "PDF" buttons dead at `src/app/dashboard/records/page.tsx:191`). Proposes a report builder alongside TM3; pricing Starter £99 / Practice £199 / £4 extra / £750 setup / Dell £149×12 + £250; **draft reply 1**. Source pages blocked by proxy → search snippets. |
| 12:02 | Khuram: build it in careconnect as a separate sellable module, TM3 end to end; UI or API?; **plan first**. |
| 12:05–12:30 | Planning workflow (3 planners + spike + merge + critic + fix; 7 agents, 653,801 tokens). |
| 12:18 | Khuram pastes an Anthropic API key in chat → validated (`claude-opus-5-5` lookup); told to rotate it; stored only in `.env.local`. |
| 12:31 | Plan delivered (`memory/sources/report-builder-plan.md`): both UI and API; ~7.25 dev-days; defaults: "AppStackX Reports", solicitor + employer reports, full build. Asked Vercel Hobby or Pro (never answered). |
| 12:49 | "do we need real T3 account and pateint ?" → No: simulated TM3 + fictional patients. |
| 13:58 | **"yes build"** + make a demo video for Dell. |
| 14:03–14:46 | Foundation (`785b0b0` deps, `72ce8e1` foundation, 25/25 tests). Parallel 6-slice build launched. 4 CPUs → 2 agents at a time. |
| 15:21 | Khuram pastes **Dell's second email** (MLCs/insurers send their own forms; 5 questions; offers anonymised examples). |
| 15:23–15:24 | Build paused (`8ba2775`). Assistant: genuinely possible (Word yes, fillable PDF yes, scanned less reliable); **draft reply 2**; pivot plan; ~£50/extra form. |
| 16:10 | Khuram: **"yes restart"**; video "100% addressing their use case"; company size + affordability. |
| 16:12–16:21 | Research workflow (Blue Heart briefing, `memory/sources/blue-heart-briefing.md`); rebuild workflow launched; `6272675` form libraries. |
| ~19:00–20:39 | Anthropic credit ran out during the integration stage ("credit balance is too low"; window approx.) → recorded drafts used. Reported to Khuram at 20:42. |
| 20:39–20:42 | Rebuild done (9 agents, ~4.4 h, 3.3M tokens): `08a0aac`, 214/214 tests, E2E 34/34, 14 security findings fixed. Two completed demo PDFs sent. |
| 21:15–21:35 | First video cut (45 MB too big for SendUserFile → 20.5 MB copy sent as "FIRST CUT"). WIP commits `9027640`, `de40876`. |
| 21:31 | Khuram added Anthropic credit. |
| 21:39 | **Khuram: no AI/Claude in the video – customer-ready.** First cut withdrawn. |
| ~21:41 | Khuram (queued): address every point of the customer's email. |
| 21:42 | Neutral-wording + Dell-addressed video workflow launched. |
| 22:02 | **Container restarted** → workflow lost mid-run (~38 files edited); WIP `e399b4c`; relaunched. |
| 22:19 | `d059618` neutral wording (224/224). |

### Wed 2026-10-07
| Time | Event |
|---|---|
| 00:35 | Workflow ended: wording, audit, live re-record + E2E done (`forms-5`, 229/229, demo 42/42, live pass, rate-limit retry). **Record + QA agents failed: Claude weekly usage limit ("resets Oct 9, 6am (UTC)")**. ~31 h lost. |
| 09:23–11:05 (UK) | **RED Physiotherapy email thread** (Daniel: "Which insurers do you support?"; Khuram 09:54 reply calling the product "CareConnect"; Daniel 11:05 "Let's book a call"). Shared with the assistant only on 09/10. |
| 18:10 | "Try again" / "continue" – still limited. |

### Fri 2026-10-09
| Time | Event |
|---|---|
| 07:20–07:22 | Resumed after reset; `a33786c` (re-recorded drafts, forms-5, retry). **Khuram: "for ai model use the chapest one, like sonnet"** (API calls). |
| 07:24 | Workflow: Sonnet switch → verify → tune → record video → QA → polish. |
| 07:36–07:52 | Anthropic credit ran out mid-sweep; restored by ~07:52 (Khuram topped up; he mentioned it at 08:10: "i have reloaded api with money"). |
| 08:11 | WIP `060a3a6`. |
| 10:17 | **`21518e7`** Sonnet 5.5 final (243/243, E2E 42/42, live pass; prompts forms-7 / form-analysis-3 / templates 2). `530be25` WIP recorder. |
| 12:29–12:36 | Final video recorded **live** on Sonnet. |
| 12:46–12:50 | Khuram: "now it has been 4 hours…"; **disk full** → deleted stale runs (~20 GB). |
| 12:58 | **Silent final video** sent (`AppStackX-Reports-demo-Blue-Heart-Clinics.mp4`, 6:15, 16.6 MB) + SRT + narration. `ff05fab`. |
| 13:04 | Workflow done (QA round 2 PASS). Cost: $0.10–0.12/form on Sonnet vs $0.23–0.26 Opus. |
| 13:18 | Khuram: covers everything? + **add ElevenLabs voice-over**. |
| 13:19–13:21 | Flow created (`gfLay4qckJq49KVb4Ghd`), voice Beth chosen, test line OK; coverage table given. |
| 13:25 | Khuram can't see the flow (different workspace) → switch-workspace link sent. |
| 13:36 | **Deadline: email the video to Dell "before 3:15 pm"** (15:15 BST = 14:15 UTC). |
| 13:37 | Voiced v1 sent + covering email draft (claimed "within 0.4 s" – wrong). |
| 13:47–13:52 | QA found v1 bugs → **v2 built by hand and sent** (13:51) – "USE THIS ONE". Deployability answer (demo yes; pilot needs ~3–5 weeks). |
| 13:56 | How it relates to CareConnect: separate product, same repo; banner issue; options. |
| 14:04 | Khuram shares RED email screenshots. Assistant: product covers it, video doesn't (Dell-specific). |
| 14:08 | **Khuram: "i have replied and a meeting is booked"** (no day given; "Tuesday" appears only in the research text he pasted – date 13 Oct inferred) + pasted public insurer-form research + 6 strategy questions. |
| 14:10 | Answers: same core functionality; SaaS yes; shared Supabase (not per client); new domain; independent app; **name ClinForms** suggested. Insurer PDFs blocked (403). |
| 14:15–14:17 | "push it to its own repo first and then use desktop app?" + Cloudflare? → `create_repository` 403; extraction workflow launched; Khuram asked to create the repo. |
| 14:34 | **Khuram: "now call it clinForms right ? I will reserve the domain"**. Repo name → `clinforms`. |
| 14:54 | Extraction verified (243/243, 42/42 E2E, no CareConnect code). |
| 15:07 | Rebrand verified; local commit **`e799c51`** (363 files). Repo didn't exist yet. |
| 15:22 | Khuram: repo created; "cloudflare would be cheaper no?" |
| 15:23 | `add_repo` OK; **pushed `main` = `e799c51`**. `spawn_task` failed. |
| 15:25 | Context compaction. |
| 15:26 | Vercel recommended over Cloudflare; `red-physio-demo-task.md` sent as a file. |
| ~15:38 | Working directory moved to `/home/user`. |
| 15:39 | **Khuram: "1- stick to vercel, push to vercel 2- prepare for RED physio 3- for demos and base account, can we use cloudFlare but have supabase scripts ready to create new db plus onboard new client ?"** |
| 15:40–15:43 | Reachability checks: Vercel, Supabase and the insurer hosts all blocked; a local Postgres server is installed (LibreOffice was confirmed earlier, at extraction 14:54). (npm/Docker details came from tool output not in the transcript – unverified.) |
| 15:43 | Khuram: **"wait"** – nothing changed or pushed. |
| 15:44 | Khuram: push memory to the repo; continue in the Claude desktop app. |
| 15:48 | `7f6fcf8` pushed: Dell video + SRT + narration + voice-over scripts under `assets/sales/blue-heart/`; `/demo-assets/` gitignored. |
| 16:16 | `32499de` pushed: Playwright e2e scripts (`scripts/e2e/`) and dev tools (`scripts/dev-tools/`) copied from the cloud container with repo-relative paths; `.e2e-out/` gitignored. |
| ~16:00–16:30 | This memory pack written (`CLAUDE.md`, `memory/`); WIP snapshot `cba79dc` pushed at 16:16, final commit follows. |

### Fri 2026-10-09 (evening, desktop – RED demo and production line)
Times corrected to UTC from the commits (an earlier write-up of this section used BST).
| Time | Event |
|---|---|
| ~17:10 | Six public insurer PDFs downloaded into gitignored `clinforms/demo-assets/insurers/`. |
| 17:32 | `a51bd9c` (`feat/production`): production architecture contract – owner decisions D1 now / Supabase later, Better Auth (D39–D40). |
| 17:58–19:27 | RED wave 1: six slices (PMI patient `sim-pat-006`, fillable PDFs, tables + flat boxes, sections + parties, demo assets + footer, copy answers + portal questions) merged into `demo/red-physio` (`de6862a` … `574d65b`); review fixes. |
| 19:19–20:21 | Production wave 1 merged into `feat/production` (data layer, identity, public site; review fixes `8cec4ea`). |
| 20:01–20:14 | RED wave 2: live form analysis prompt `form-analysis-4` merged (`23311b2`); prepared maps for all six PDFs and answers for Bupa, AXA, Allianz recorded through the real drafting path (`3b34017` assembly fixes). |
| ~20:15–21:05 | Headless browser rehearsal + prospect's-eye review + rules review (findings: "I recorded…" wording, portal step failing in demo mode, SIGNED on patients' claim forms, party labels, insurer wording in git, demo:red going live). |
| 21:10–22:51 | Fix wave (`44696b3` … `cb8b15f`): plain clinical wording, party labels, prefill-only forms, staff-entry provenance, every outcome measure in Bupa's box, address lines + postcode, N/A dates, PDF margins/row font sizes/trim box, seeded portal question set with demo answers, demo:red demo-only, wording hygiene; rehearsal re-run (machine at load ~60); 448 tests (445 pass, 3 skipped). |
| 21:21–22:41 | Production wave 2 merged into `feat/production` (`ec76a0a`: tenant Studio, clinic storage, actors/tenancy on the API, admin pages). |
| 22:53 | Checked: `https://clinforms.co.uk` live on Vercel with a pre-RED build (health: ClinForms, `form-analysis-3`, live available). |
| ~22:55–23:20 | **Call pack** `docs/demo-red-physio.md` (support matrix, Monday/Tuesday checklist, 10-minute script with click path and rehearsal timings, labels to frame, honest answers, questions for Daniel, fallbacks) + memory update (D39–D46, insurer classification, production pointer). `demo:check` OK (7 maps, 4 answer files, 6 form files). |

### Sat 2026-10-10 (desktop – production line, outreach video, go-live)
Times UTC from commits, file times, the production audit log and Vercel. Workflow ids are desktop workflow runs.
| Time | Event |
|---|---|
| 23:36 (09/10) | `demo/red-physio` merged into the wave-2 line (`62b8fba`, `342cd7e`) – demo regression check. |
| 08:09–10:03 | **Wave 2b fixes** on `feat/production` (workflow `production-wave2b`, `wf_d7a62c19-583`): clinic records stay with their clinic and member, approved records protected, signer's own voice (`f6ee008`); first run, wording, phone set-up (`1743971`); neutral file names, work-queue home, truthful PDF copy, **drafting opt-in** (`9ed9460` 09:46); gap wording (`3bc73d9`); work-queue copy (`7ca20f3`). |
| 09:29 | `26cd447` on `main` (deployed as `b8guhpqyz`): the RED call runs from the **frozen folder** `~/Projects/Appstackx/clinforms-demo` (tag `red-demo-2026-10-13` = `3521401`). |
| ~09:45 | Claude restarted; session resumed from memory. |
| ~09:55 | **Outreach video** workflow started (`wf_93c356a2-a97`, worktree `clinforms-wt/video`, branch `sales/outreach-video`). |
| 10:43–10:47 | **Wave 3 – notes import** merged (`ecf1f74`, `a33804e`, `05c5b31`): notes in any layout, staff check before the record is built. |
| 12:45–12:57 | Fix wave 3 (`15dba09`, `7cf6f24`): notes reader on realistic clinic exports, linear time and upload limits, consent for uploads, store growth counted. |
| 13:23 | `b475e25` **go-live runbook** `docs/go-live.md`. 13:26 pre-go-live production recorded (`b8guhpqyz`). |
| 13:37–13:39 | `8992d04` pre-flight fix; tenant E2E on the **preview** database (run id `10101439`) → **pre-flight GO on `8992d04`**. |
| before 14:52 | R2 bucket `clinforms-media` (EU) + custom domain `media.clinforms.co.uk` set up (CORS from the apex/www only). |
| 14:52 | **`/demo` page** merged (`4745fc0`, `858bdfd`; workflow `wf_f696f1e7-947`). |
| ~15:40 | **Outreach video FINAL** (1:30; first cut superseded – it implied a TM3 link) in `marketing/clinforms/outreach-video-v1/`. |
| 15:45 | `ef3ecc1` `/demo` review fixes (end panel over the end card, stall fallback, focus, privacy wording, host-only cookies, no analytics batching). |
| ≤16:53 | **Khuram: go live today**; no generated-voice label; "TM3" in the sandbox label OK in the video; NEL off; CTA "Book a 15-minute call" OK (D53–D57). |
| 16:53 | `29c0b39` NEL off + privacy wording = **release SHA**; preview `ay3kyh8cr`. |
| ≤16:58 | **Go-live part 1** (`wf_ef34aabc-f59`; also made `29c0b39`): §2 prod D1 migrations (21 tables / 3 triggers), §3 gateway `clinforms-data` deployed + secrets, **self-test passed 16:57:32**, §4 Vercel production env (the expected 19 names, 16:58). Stopped at the §4.3 backup gate. |
| ~17:02 | Data key **k1 seen in a screenshot → rotated to k2** (no encrypted data existed). 17:08 encrypted backup `ClinForms-keys-backup-20261010.dmg` in iCloud Drive (passphrase in Apple Passwords). |
| 17:10 | **Go-live part 2** (`wf_355748bd-515`): merge `02ddfb5` (= `feat/production` `29c0b39`), check chain, push `main`. |
| **17:13** | **Production deployment `d4drhu49m` → clinforms.co.uk LIVE** (public site, sign-in, clinic Studio, database). Rollback target `b8guhpqyz`. |
| 17:17–17:32 | Internal clinic **`appstackx`** created (17:17:46, 30-day retention); Khuram accepted the invitation (17:30:46) and set up two-step (17:32:14); `/app/platform` works; invite file deleted. Smoke tests passed; a fictional request-access row stored (go-live §7.2). |
| 17:15–17:43 | **Passcode server check** (`wf_c2984ddf-5d2`, branch `fix/passcode-check`): `a09c556`, review fixes `b31f15d`, merge `04c18d0`; deployment `c3lbxtxy3` 17:45; verified on prod later (no/wrong passcode 401, cross-site 403). |
| 18:38–18:43 | **Polish** (`wf_f9fab229-eb3`, branch `fix/polish-1`): no caption behind the `/demo` end panel, Studio tabs wrap at 375 px (`e93c287`, merge `8def25b`); deployment `kg5bz9ny7` 18:43. |
| ~18:50 | **Always Use HTTPS** on for zone `clinforms.co.uk` (Khuram OK). Khuram declined a test upload → key-fingerprint endpoint workflow `wf_c9f57175-279` (branch `ops/key-fingerprint`, in progress). Anthropic key: told to keep the new key and delete older ones (not a blocker). |
| 18:58 | Read-only check: prod D1 has 1 clinic, 0 reports, 0 form files, 1 (fictional) access request; health OK. |
| ~19:00 | End-of-session memory update (CLAUDE.md, `memory/`, `docs/go-live.md` run log). |
| ~20:30–22:00 | Price list agreed (D64, `e5cd283`). **Live-site backup of the RED demo** (D65): branch `ops/red-live-backup` (worktree `clinforms-wt/red-backup`) – `admin:seed-demo-clinic` + `src/server/admin/demo-clinic.ts`, documented JSON import gains insurer numbers + charges; tests (SQLite/PGlite; seeded answers = the local demo's for all 4 forms); full check chain green; local E2E (Playwright, local SQLite, test owner "Sarah Reid") green. Read-only production checks: seed dry run (signing secret MATCH, nothing written), `ops:key-fingerprint` MATCH (k2). Not merged; production seed not run. |

## 2. Workflow runs (cloud; journals not preserved)
| Run | Window | Purpose | Outcome |
|---|---|---|---|
| `wlrple27w` | 06/10 12:05–12:30 | Plan | Plan delivered |
| `wuu36wj9g` | 06/10 14:01–14:44 | Foundation | `72ce8e1` |
| `wbt0eybc1` | 06/10 14:46–15:23 | 6-slice build | Stopped for pivot (`8ba2775`) |
| `w61du3mse` | 06/10 16:12–16:20 | Blue Heart research | Briefing |
| `wlyznsko8` | 06/10 16:15–20:39 | Referrer-forms rebuild | `08a0aac` |
| `wvmi48o4i` | 06/10 20:42–21:40 | First video | Stopped (AI wording) |
| `w4v8g4y8i` | 06/10 21:42–22:02 | Neutral wording + video | Lost to container restart |
| `w5zl1rmf3` | 06/10 22:03 – 07/10 00:35 | Same, relaunched | Wording/live done; record/QA hit weekly limit |
| `wu3st2lyy` | 09/10 07:24–13:04 | Sonnet switch + video + QA | Final silent video |
| `wwgng3om1` | 09/10 13:21–13:48 | Voice-over | v1; QA fail; v2 by hand |
| `wumy1kkzg` | 09/10 14:16–14:54 | Extract standalone app | Verified |
| `wk7ledeyk` | 09/10 14:55–15:07 | Rebrand to ClinForms | `e799c51` |

Desktop workflow runs, 10/10 (journals in the desktop app, not in git): `wf_d7a62c19-583` production wave 2b + wave 3 +
runbook; `wf_93c356a2-a97` outreach video; `wf_f696f1e7-947` `/demo` page; `wf_ef34aabc-f59` go-live part 1 (§1–§4);
`wf_355748bd-515` go-live part 2 (§5–§7); `wf_c2984ddf-5d2` passcode check; `wf_c9f57175-279` key fingerprint;
`wf_f9fab229-eb3` polish + this memory update.

## 3. Lessons learned / gotchas
1. **Re-read the prospect's exact words and stop early when the requirement changes.** Dell's second email made the generic-report build wrong; pausing immediately (and keeping the reusable slices) saved hours.
2. **Customer material is neutral by default** – no AI/Claude/model names anywhere (frames, captions, SRT, narration, file names, downloads). The recorder's banned-term guard aborts on any hit; keep it.
3. **Never pass on a sub-agent's numbers without checking.** The "every line within 0.4 s" voice-sync claim was measured against rounded script times; the real SRT showed 19 early lines and a missing line. Check against the real source (the SRT), not a derived one.
4. Parsers must handle annotated lines (the ⚠ marker in `narration-script.md` made `parse.py` skip a line). Don't insert into an indexed list without renaming the files it maps to (`segments.json` indices ≥30 are offset from clip names; `build.py` remaps).
5. **Keep recorded demo data** so demos never depend on live API credit; set Anthropic spend alerts; use a spend-limited workspace.
6. **Commit after each verified stage.** Background workflows don't survive container restarts or usage limits. (Cloud stop hook forced labelled "WIP:" snapshots; desktop has no such hook – commit when green.)
7. **Scan staged diffs for secrets before every commit** (`sk-ant-`, passcode patterns).
8. Long multi-agent workflows burn the weekly Claude allowance fast (one rebuild used 3.3M subagent tokens). Give estimates with buffers – several ETAs were too optimistic.
9. Each video recorder run leaves ~3 GB of raw frames in `work/`; delete after assembling.
10. **Email copies of videos must be ≤ ~18.5 MB** (Gmail 25 MB limit after +33% base64). Recipe: `ffmpeg -i master.mp4 -vf scale=1600:900:flags=lanczos -c:v libx264 -preset slow -crf 30 -tune stillimage -pix_fmt yuv420p -movflags +faststart -an out.mp4` (16.6 MB for 6:15). Add narration without re-encoding: `ffmpeg -i video.mp4 -i narration.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 96k -ac 1 -ar 48000 -movflags +faststart out.mp4`.
11. ElevenLabs connector works in **its own workspace** – always give the flow name + link and say which workspace. Poll run status ~every 3 s; downloads come from `storage.googleapis.com`; generations reported 0 credits but transcription was charged.
12. The Claude GitHub App can't create repos – ask Khuram; `add_repo` only works after the repo exists.
13. `spawn_task` (desktop task cards) failed in the cloud session – always have a file/prompt fallback.
14. Live demos: allow ~60 s between a form analysis and the next live form (6 calls/min); don't script exact text/counts; type the referrer name in the upload dialog.
15. Recording artefacts to avoid (rules in `scripts/medreport/video/README.md`): tooltips over content, Chrome "Debugger paused" infobar on new tabs (hard-cut from the click), toasts under captions, "Preview unavailable" in background tabs.
16. Proxy-blocked research = search snippets only; mark such facts [C]/[I]/unverified and re-check at source before quoting to customers.
17. `tsconfig` has no `target` → `Array.from` instead of spreading Sets/Maps. pdfjs worker: use the `ui/preview-libs.ts` recipe.
18. **Screenshots leak secrets.** A data key appeared in a screenshot on go-live day → rotated before any data used it.
    Never show a secret value in a terminal or browser (pipe values on stdin, `pbcopy` without printing, list names only).
19. **Push to `main` = production deploy** since 10/10. Run the full check chain on the merge first; Vercel Hobby rolls
    back only to the immediately previous production deployment.
20. The `/demo` media are CORS-limited to the apex/www, so the video does not play on preview or local origins – test
    with `scripts/e2e/demo-video.cjs` `REAL_MEDIA=1`.
21. Freeze a sales demo as a tag + its own worktree (`clinforms-demo`) before shipping risky changes to `main`; the
    go-live then could not disturb the RED call.
