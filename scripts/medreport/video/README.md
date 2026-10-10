# Walkthrough video recorder (`scripts/medreport/video`)

Records the proof-of-concept walkthrough of ClinForms prepared for Dell Baines, Blue Heart Clinics:
completing each MLC and insurer's own report form from TM3 registration details and physiotherapy notes.

The video is written as a point-by-point reply to Dell's e-mail. Every chapter opens with a card quoting
his own question ("You asked: …") and ends with a one-line plain answer. The chapter chip reads
"Your question n of 5 · …". Screen order: 1 → 3 → 2 → 4 → 1 again (his "different structure" example,
side by side) → 3 again (filing back to TM3, with its own question card and answer) → 5, then a recap of
the five answers (with the times they were shown) and the next step, which takes up his offer of
anonymised examples.

The copy already rendered and sent was made before the product was renamed, so it shows the earlier
name ("AppStackX Reports") and the earlier file names. Re-running the recorder produces ClinForms output.

| File | Purpose |
|---|---|
| `record-demo.mjs` | Drives the Studio and the Simulated TM3 sandbox with Playwright, captures frames, assembles the MP4s and the other outputs |
| `captions.json` | Every caption, chapter chip, question card, answer line, card and suggested voice-over line. Edit the wording here, not in the script |
| `video-kit.mjs` | Shared machinery for both recorders: overlay (cursor, ripple, heartbeat, optional chapter bar and captions), screencast `Cast`, `BaseDirector` (cursor moves, scrolling, clicks, typing, cuts), banned-term patterns, ffmpeg frame concat, SRT helpers, card styles |
| `record-outreach.mjs` | The generic 89 s outreach video for UK private physiotherapy clinics (see below) |
| `outreach-captions.json` | Its lines (caption + voice-over, timed), shots (actions, locators), cards and teaser. Edit the wording and timings here |
| `check-outreach-captions.mjs` | Self-check of `outreach-captions.json` (banned terms, caption length, narration fit, continuity) |
| `mix-outreach.mjs` | Puts the narration clips under the outreach picture (holds/trims at still frames, small speed-ups, -16 LUFS) and builds the outreach deliverables (master, e-mail MP4, SRT, poster, teaser, README) |

## What it produces

All files go to `--out DIR`, or `$VIDEO_OUT`, or `$TMPDIR/clinforms-video` if neither is set.
Outputs are never written into the repo.

- `clinforms-demo-blue-heart.mp4`: the master. 1920×1080, H.264 (libx264 `-crf 18 -preset slow`,
  yuv420p, 30 fps, `+faststart`), with no audio track.
- `clinforms-demo-blue-heart-email.mp4`: the same video at 24 MB or less for e-mail
  (`-preset slow -tune stillimage`, CRF 27 and up until it is under 23 MB, decimal).
- `clinforms-demo-blue-heart.srt`: subtitles using the same timings as the burned-in captions.
- `narration-script.md`: a voice-over script timed to the video, with honesty notes for the narrator.
- `poster.png` (also `clinforms-demo-blue-heart-poster.png`): the title card.
- `frames/`: one review frame every 8 s, one 2.5 s into each chapter, and one inside each sped-up wait.
- `cards/`: the title, intro, GDPR, recap and next-step cards (HTML and PNG).
- `work/`: raw screencast frames, `timeline.json` (frames, captions, cuts, sped-up waits, chapters, guard
  results), `summary.json`, clips, downloads, badges and the viewer pages. This folder can be deleted.

## Running it

```bash
npm run build                                       # if the build is stale
MEDREPORT_AI_MODE=auto PORT=3110 npm run start &    # live drafting must be available (checked via /health)
NODE_PATH=$(npm root -g) node scripts/medreport/video/record-demo.mjs --out /path/to/video
# Re-assemble only (after editing the assembly code; captions are burned in at record time):
NODE_PATH=$(npm root -g) node scripts/medreport/video/record-demo.mjs --out /path/to/video --assemble-only [--cards]
# Rewrite only the SRT and narration script (after editing captions.json "vo"/"srt" wording; no re-encoding):
NODE_PATH=$(npm root -g) node scripts/medreport/video/record-demo.mjs --out /path/to/video --docs-only
# Prepared demo outputs instead of live (server in MEDREPORT_AI_MODE=demo; captions must then say so):
NODE_PATH=$(npm root -g) node scripts/medreport/video/record-demo.mjs --out /path/to/video --demo
# Dry run of the whole flow without live calls or the slow e-mail encode (timings ≈ the live video's):
NODE_PATH=$(npm root -g) node scripts/medreport/video/record-demo.mjs --out /tmp/dry --demo --no-email
# Check the final-PDF viewer and the side-by-side page against two downloaded final PDFs:
NODE_PATH=$(npm root -g) node scripts/medreport/video/record-demo.mjs --out /tmp/x --viewer-test HP.pdf NF.pdf
```

Environment variables:

- `BASE`: the app URL. Defaults to `http://localhost:3110`.
- `CHROMIUM_PATH`: the browser to use. Defaults to the newest `/opt/pw-browsers/chromium-*`, then
  Playwright's own browser.

The live passcode is read from `MEDREPORT_LIVE_PASSCODE` in `.env.local` and put straight into the tab's
sessionStorage by an init script. It is never printed, logged or shown: the mode dialog is never opened.

You also need `ffmpeg`/`ffprobe`, `unzip`, plus `pdftoppm` and `pdftotext` (poppler) to render and scan
the final PDFs. A full run takes about 10 minutes and makes 8 live calls (2 for the form reading, 3 for
each of the two drafts).

## How it works

- **State.** The run starts from a fresh browser context, and the app's own *Demo tools → Reset demo*
  is pressed before recording. The new form uploaded on screen is the bundled Meridian sample, fetched
  from `/api/reports/v1/forms/samples/meridian-discharge-report/file`; staff type the referrer's name in
  the upload dialog, because it is only in the form's page header.
- **Capture.** Frames come from the Chrome DevTools screencast (JPEG quality 92, every frame). The
  1600×900 CSS viewport is rendered at device scale 1.2 (`--force-device-scale-factor`,
  `viewport: null`), so each frame is native 1920×1080 and needs no upscaling. This was tested against
  Playwright's `recordVideo`, which upscales a 1600×900 VP8 stream and gave visibly softer text.
  Frames are assembled with the ffmpeg concat demuxer, using each frame's real timestamp as its duration.
- **Overlay.** `addInitScript` injects the chapter bar, the question card, the caption bar (answer lines
  in green with a tick) and the cursor dot with its click ripple, all inside a shadow root. The chapter
  bar sits in a 36 px strip that the recorder reserves at the top of the page with CSS (body padding,
  and the Studio's sticky header and sticky side panels moved down by the same amount). The Studio's toasts are lifted above the caption bar with CSS, so a caption never covers one.
  A 2 px "heartbeat" repaint runs every 100 ms. Without it the screencast can drop the last frame of
  a transition. No app code is changed by the recorder.
- **Pacing.** Each caption stays on screen for at least 0.35 s per word, and never less than 2.5 s.
  Question cards stay for 0.3 s per word (at least 3.2 s). Cursor moves are eased and typing runs at a
  human pace. Before each caption the recorder closes any open tooltip (blurs its trigger and moves the
  cursor off it), so none is left over the content.
- **Live waits.** The form reading and the two drafts run live. Each wait is recorded in full, then sped
  up in post to about 3 s (`spedDuration`), with an amber "Sped up – real time about N s" badge over it
  and the same label in the SRT (one entry, not repeated without it). N is the measured wall time from the
  click to the result on screen, so it can be a second or two more than the app's own "Drafted from the
  notes in N s" chip, which times the drafting alone – hence "about".
- **Live checks.** After each live draft the recorder reads the stored report and aborts the run if a
  group was not drafted live, a drafted paragraph is uncited, the prognosis was answered instead of left
  for the clinician, or there is a blocking flag other than gaps. Re-run the recording if that happens.
- **Cuts.** Other waits (page loads, downloads, the PDF copy) are hard cuts once they pass 0.5 s.
  Opening a new tab is cut from the click (`clickNewTab`): while the new tab starts, Chrome briefly shows
  a "Debugger paused in another tab" infobar on the opener, which must never be in the video. Stretches
  of repetitive clinician clicks are also cut, and the caption on screen says so: the remaining Harrow &
  Pike answers and resolutions; the Northfield opinions, claim number and checks; and the Northfield
  approval dialog. On Northfield the questions that don't apply ("If modified duties…", "Estimated number
  of further sessions") are answered on screen ("Not applicable", 0), and the recorder aborts unless the
  progress panel reads N of N answered and clear before approval – no form is approved with open items.
- **Final PDFs.** The recorder downloads the final PDFs, renders their pages to PNG with `pdftoppm`, and
  shows them in local viewer pages: Harrow & Pike full screen, then both forms side by side with the
  matching questions (prognosis, functional restrictions, treatment recommendations) highlighted pair by
  pair. Highlight boxes are positioned from `pdftotext -bbox-layout` word coordinates. In the viewer the
  cursor points at each highlight from the page margin, never over the document's text.
- **Subtitles for cards.** A card's `srt` in `captions.json` can be a list of short entries; they are
  shown one after another over the card (a static card is not chopped into fast fragments).
- **Returning to a tab.** A review page that sat behind the viewer pages may still be drawing its
  preview; the recorder waits for it (and refreshes it if needed) inside the cut, so "Drawing the form…"
  or "Preview unavailable" is never on screen.
- **Recap times.** The recap card shows where each answer was given, from the chapter times computed
  from the recording's cuts and sped-up waits.

## Banned-term guard (keep it)

Customer-facing wording is neutral: no "AI", vendor, model or technology terms anywhere a customer can
see or download (`src/modules/medreport/core/wording.ts`). The recorder enforces it:

- Before every caption, question card and chapter, it scans the page's visible text, title, aria-labels,
  titles, placeholders and alt text, and **aborts the recording** on a hit, naming the scene.
- It scans `captions.json` before recording, every card page, the badges, the SRT, the narration script
  and the downloaded final Word and PDF files before writing them. The results are in `summary.json`.

## Honesty rules (built in, keep them)

- Live by default. With `--demo`, the analysis and drafts are the prepared demo outputs and the
  captions must say so ("prepared earlier from the same notes").
- Sped-up waits always carry their real time. Nothing else is sped up.
- Counts such as "12 of 16 answered and clear" and "10 notes · 11 appointments · 6 scores" are read
  from the UI during the recording.
- The TM3 shown is always the *Simulated TM3 sandbox – demo data, not affiliated with TM3*. All
  patients and referrers are fictional. A direct TM3 connection is "subject to TM3 providing access";
  today's route is a TM3 export.
- Make no time-saving claims, and do not use real MLC or insurer branding.

## Outreach video (`record-outreach.mjs`)

A generic 89 s video for cold outreach to UK private physiotherapy clinics: title card, 74 s of the Studio
(Megan Hart on the Harrow & Pike form, the Meridian form uploaded once), end card. Storyboard and narration
live outside the repo (`marketing/clinforms/outreach-video-v1/`). Demo mode only: the server must report
`aiMode: "demo"`; no keys are needed.

```bash
npm run build && PORT=3310 MEDREPORT_AI_MODE=demo npm run start &      # .env.local with only MEDREPORT_AI_MODE=demo
NODE_PATH=<node_modules with playwright> node scripts/medreport/video/record-outreach.mjs \
  --out ~/Projects/Appstackx/marketing/clinforms/outreach-video-v1 [--review /tmp/frames]
# Re-render cards and captions and re-encode from work/timeline.json (no recording):
NODE_PATH=... node scripts/medreport/video/record-outreach.mjs --out ... --assemble-only
```

How it differs from the walkthrough recorder:

- **Clock.** Every action is scheduled at its time in the final cut (`shots[].actions` in the JSON); holds pad
  the gaps. Video time is wall time minus cut time, so each voice line lands at its planned start; an action
  that runs late is logged as `drift` in `work/timeline.json`.
- **Hard cuts only.** Page loads, the drafting, the remaining clinician answers and filling the approval
  dialog happen inside cuts. Nothing is sped up and no wait is labelled or timed.
- **Captions in post.** Caption pills are rendered as PNGs (the Studio's own Inter font) and overlaid by ffmpeg
  at the recorded line times, so `work/picture-clean.mp4` has no captions (teaser source) and captions can be
  re-timed with `--assemble-only`. A small "Fictional data" tag sits top left on the app screens.
- **Framing guard.** A sampler in the page (every 150 ms) aborts the recording, naming the shot, if a frame
  outside a cut shows legible "TM3" without a readable "Simulated TM3" label (a label half under a caption pill
  does not count), or a real insurer's name. The Studio names TM3 on its registration answers, so S05c and S06b
  are punched in (about 1.27×) to a 16:9 crop of the full content width; the first registration card is pushed
  below the crop with a presentation-only margin and the toast stack is moved into the crop. Other
  presentation-only CSS: dialogs sit higher and end above the caption band, and S04b gets 120 px of bottom
  padding so the page intro that names TM3 can go under the header. The banned-term guard of the walkthrough
  recorder runs at every shot and caption, on the cards, captions, SRT and the downloaded final Word file.
- **Busy machine.** The take waits until the 1-minute load is below `MAX_LOAD` (default 12) and aborts with
  "MACHINE BUSY" if it rises above `ABORT_LOAD` (default 30) mid-take: a loaded machine gives late actions and
  dropped frames. Late actions are listed as `drift` in the timeline.
- **Headless** at a 1600×900 window and device scale 1.2 (native 1920×1080 frames); the browser context grants
  clipboard read/write so the "Copy" toasts work.

Outputs (under `--out`, not in git): `work/picture.mp4` (silent master with captions), `work/picture-clean.mp4`,
`work/picture.srt`, `work/timeline.json` (recorded line, shot and punch-in times in `final`), `work/teaser-source.mp4`
+ `work/teaser-source.json` (caption-free T1–T5 cut, 19.2 s), `work/teaser.mp4` / `work/teaser.gif` /
`work/teaser-poster.png` (the teaser with its big captions; GIF 800×450), `work/cards/`, `work/captions/`, `work/poster.png`.

## Narration mix and outreach deliverables (`mix-outreach.mjs`)

Runs after `record-outreach.mjs` and the narration step (one levelled clip per line in `voice/trimmed/`,
described by `voice/lines.json`). It writes the files that are sent or hosted into `--out` itself:
`ClinForms-demo.mp4` (master, 1920×1080, narration + burned-in captions), `ClinForms-demo-email.mp4` (≤ 18 MB, CRF 26
`-tune stillimage`, AAC mono 96 kb/s; steps to CRF 28 / 1600×900 if it is too big), `ClinForms-demo.srt` (the narration
word for word at its real times, ≤ 2 × 42 characters per cue), `ClinForms-demo-poster.png` (title card + play button +
length, 1280×720), `ClinForms-teaser.gif` / `.mp4` (from the recorder's teaser) and `README.md` (files, outreach use,
narration, checks; a reviewer's notes in `work/mix/review.md` are included verbatim).

```bash
NODE_PATH=<node_modules with playwright> node scripts/medreport/video/mix-outreach.mjs \
  --out ~/Projects/Appstackx/marketing/clinforms/outreach-video-v1 [--frames /tmp/check] [--plan-only] [--target 90] [--title 5.4]
```

- **Placement.** Each clip starts at its caption's recorded start (`work/timeline.json` → `final.lines`) and ends at
  least 0.22 s before the next line (0.35 s before the call to action). An over-long line first gets a speed-up of at
  most ×1.08. Any remaining overrun becomes a **picture hold**: a frame is repeated in the middle of the longest run of
  identical frames inside that line's slot, which is found on `work/picture-clean.mp4`, so nothing visibly stops. On
  the end card, the card simply stays up longer. Only a slot with no still run gets more speed, and never beyond ×1.15.
- **Length.** If the result is over `--target` (default 90 s), still frames are taken out of the slots with the most
  spare time. The title card is shortened to `--title` seconds.
- **Picture.** Re-composed from the recorder's sources (title card, `work/clips/app-clean.mp4`, end card, caption PNGs
  with their times moved by the edits) and encoded once at CRF 18. It is converted to limited-range BT.709, while the
  recorder's own files are full-range BT.601. The master muxes this picture with `-c:v copy`.
  `work/mix/picture-mixed.mp4` is reused when the edits have not changed.
- **Sound.** Clips are placed with 12 ms fades in and 15 ms fades out. A static gain brings them to -16 LUFS, a
  look-ahead limiter at -2.3 dBFS catches the few transients, and a two-pass loudnorm then runs in **linear** mode (the
  script fails if loudnorm falls back to dynamic mode). The master's audio is AAC stereo 160 kb/s.
- **Checks.** Silence detection confirms every line starts where it was planned. ffprobe confirms the streams and
  sizes, and the metadata, SRT, poster and README are scanned for banned terms. Verification frames are written every
  3 s and 0.35 s after each line starts, with 2×2 contact sheets, to `--frames` (default `work/mix/frames`). Read them.
  Everything is recorded in `work/mix/plan.json`.
