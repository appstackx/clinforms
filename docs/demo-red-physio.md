# RED Physiotherapy – call pack (internal)

> **Internal – for Khuram only. Never send this file or have it on screen during the call.** It names insurers
> and our drafting provider; Daniel only ever sees the app and the PDFs it produces. No insurer form wording is
> quoted here beyond short form titles.

| | |
|---|---|
| **Call** | Daniel Vatamanu, co-founder, RED Physiotherapy (Milton Keynes, Towcester, Northampton). **Tue 13 Oct 2026, morning** – check the exact time in the calendar invite |
| **His question** | "Which insurers do you support?" (email, Wed 7 Oct) |
| **Product name** | **ClinForms**. Your 7 Oct email said "CareConnect" – say once: "we've since named it ClinForms" |
| **Demo** | Branch `demo/red-physio`, run on your Mac with `npm run demo:red` – demo mode, no internet or API key needed. One fictional patient: **Mrs Rebecca Lane** (`sim-pat-006`), right shoulder, insurer on record Bupa |
| **Checked 09/10/2026** | typecheck, lint, 448 tests (445 pass, 3 skipped – no LibreOffice), build, `demo:check`, two full browser rehearsals (headless Chromium) |
| **Not yet done** | One rehearsal in **your own Chrome** (§2.2) – form maps live in the browser that confirmed them |

## The one-line answer

> "There's no fixed list. ClinForms completes each insurer's own form – Word or PDF – in its own layout, from your
> notes, and your physio approves it before it goes anywhere. Bupa's further-treatment form is the one clinics fill
> routinely; AXA Health, Vitality and WPA mostly work through their own portals, so for those it drafts the answers
> ready to paste in. Which forms and portals do you get most?"

---

## 1. Insurer support matrix

What the demo can show on 13 Oct. Every insurer form below is a **public form used for demonstration only, with
fictional patient data – never RED's own forms**. Each demo output carries the footer "Public form used for
demonstration only – not affiliated with or endorsed by <insurer>. Fictional patient data."

| Insurer | Form (short title) | Type | What ClinForms completes | Status on 13 Oct |
|---|---|---|---|---|
| **Bupa** | Therapies management form – further physiotherapy treatment request (3 pp) | Fillable PDF, 26 fields | **The therapist's form, fully.** 26 questions: 8 from registration, 3 calculated from the record (every outcome measure with its date; sessions attended), 7 drafted from the notes with citations, 3 clinician opinions only as recorded (further sessions, plan, clinical reason – Sarah Reid, 01/10/2026), 3 sign-off fields in the therapist's declaration (filled on approval), 1 fixed answer, 1 left blank (not needed) | **Ready – lead with it.** Prepared answers fit every box; final file `_SIGNED` |
| **AXA Global Healthcare** (international plan – *not* AXA Health UK) | Therapy treatment plan (4 pp) | Fillable PDF, 73 fields (32 questions) | **The therapist's form.** 8 from registration (2 held back, see status), 7 drafted, 5 opinions as recorded, 1 calculated, 4 fixed, 3 sign-off in the printed signature box, 4 blank | **Show up to the identifier block only.** The membership and authorisation numbers on the record are Bupa's, so they are not copied – approval stays blocked until staff enter AXA's own. The specialist-review date is a gap (not recorded). Don't type numbers, don't approve |
| **Aviva** | Private medical insurance claim form CM016 (8 pp) | Flat PDF (no fields; print-ready file, completed at trim size) | **Recognised as the patient's and GP's form.** Only section 1 identity prefilled (name, address lines, postcode, email, date of birth, mobile); policy number left for staff (the record's is Bupa's); 49 boxes left for the patient or GP. Approved as a checked **prefill**, file `_PREFILLED`, never signed | Ready – 30 s on the call |
| Aviva | Medical report request GEN030 (2 pp) | Flat PDF | A doctor's report: only the patient's details (3 boxes); the rest left for the doctor or insurer | Map ready; only if asked (format example) |
| Freedom Health Insurance | Freedom Worldwide outpatient medical treatment claim form (4 pp) | Fillable PDF, 73 fields (35 questions) | The policyholder's claim form: the clinic fills **only the treatments-and-fees table** from the appointments (£70, then £55 × 4; paid circled, last unpaid); 34 left for the policyholder or patient; prefill | Ready; skip unless asked |
| Allianz Care | Pre-authorisation form (3 pp) | Fillable PDF, 80 fields (55 questions) | The medical-provider section: 6 from the record, 10 drafted from the notes (5 of them left as gaps – the notes don't hold them), 1 fixed; the doctor's name, signature and date and the patient's section left blank; prefill | Ready; skip unless asked |
| **AXA Health** (UK domestic) | No public form found – provider portal | Portal | Copy-ready answers from a portal question set; **no portal login, no automatic submission** | Shown with our own "Example portal questions (illustrative)" |
| **Vitality** | No public form found – therapist portal | Portal | Same | Same |
| **WPA** | No public form found – provider portal | Portal | Same | Same |
| Any other insurer or MLC | Their own Word or PDF form | Word / fillable PDF: full; flat PDF: best effort; scanned: not shown yet | Uploaded once, read in about 15–25 s, checked once by staff, reused for every patient | Ask Daniel for 2–3 blank forms |

Notes:
- **The six insurer maps were prepared and checked by hand for this demo** (the map screen says "Pre-written
  demonstration map"). A live reading of a new form took 14–24 s in the 09/10 sweep and still needs one staff check.
- None of the six PDFs is a scan. A scanned form (no text layer) has not been demonstrated – mapping would be
  largely manual.
- Rebecca Lane's record names **Bupa**, so Bupa's numbers are deliberately kept off every other insurer's form.
- Detail per form (classification, parties, handling): `memory/context/insurer-forms.md`.

---

## 2. Before the call

### 2.1 Where to run it

Use the **frozen demo folder `~/Projects/Appstackx/clinforms-demo`**. It is pinned to the exact version that was
rehearsed (git tag `red-demo-2026-10-13`), has `npm ci` done, and its `.env.local` points at the insurer PDFs and
prepared answers in `~/Projects/Appstackx/clinforms/demo-assets/insurers`. Production work continues on `main`,
so **don't run the demo from `~/Projects/Appstackx/clinforms`** and **don't `git pull` in the demo folder** before
the call.

On the production line (`feat/production`, and on `main` once it is merged) `http://localhost:3000/` is the public
marketing page (with the cookie banner when analytics is configured); the demo always starts at **`/reports`** –
open that address directly.

Use the **same Chrome profile and the same address (`http://localhost:3000`, start page `/reports`)** on Monday and Tuesday – confirmed
form maps and reports live only in that browser's storage for that address.

### 2.2 Monday evening – rehearsal (about 60 min)

```bash
cd ~/Projects/Appstackx/clinforms-demo
git describe --tags                 # red-demo-2026-10-13 (frozen – do not pull)
node -v                             # v22.x
npm ci
npm run demo:check                  # → "Demo assets OK: 7 maps, 4 answer files, 6 form files in …/clinforms/demo-assets/insurers."
lsof -nP -iTCP:3000 -sTCP:LISTEN    # must print nothing – stop whatever is listening
npm run demo:red                    # next build (1–3 min), then:
                                    # "ClinForms demo (local only): http://localhost:3000/reports · drafting mode demo · …"
```

Then, in the demo Chrome profile (§2.4):
1. Open `http://localhost:3000/reports`. The header button must read **Demo mode**. If a passcode field appears
   anywhere, the server was started with `--live`: stop it and start again without.
2. Do the pre-uploads of §2.3 step 4, then run the whole script in §3 once, out loud, with a timer.
3. After "Write in my own voice", **read every Bupa answer once**, so no sentence surprises you on the call (the
   rewrite is rule-based; one or two sentences read slightly stiffly, e.g. "On 01/10/2026, loading needs
   progressing…").
4. Open the downloaded Bupa PDF in Preview: 3 pages, demo footer on each page, name/date/HCPC only in the
   therapist's declaration.
5. Reports page → **Demo tools → Reset demo**. This removes every report, form map and uploaded form from this
   browser and the documents saved to the simulated record; the sample forms and the portal question set come back.
6. Stop the server (Ctrl+C).

### 2.3 Tuesday morning (start 30 min before the call)

1. Quit everything heavy: other dev servers, Docker, and **any agent workflows or builds on the Mac** (the 09/10
   rehearsal ran at load ~60: a 0.3 s step took 8 s, one upload 160 s).
2. Start the demo and minimise the terminal (it is never shared):
   ```bash
   cd ~/Projects/Appstackx/clinforms-demo
   npm run demo:check
   lsof -nP -iTCP:3000 -sTCP:LISTEN
   npm run demo:red -- --skip-build    # Monday's build; leave out --skip-build if you pulled anything since
   ```
3. Chrome (demo profile) → `http://localhost:3000/reports`. If anything is left from Monday: **Demo tools → Reset
   demo**.
4. **Pre-upload and confirm** (Referrer forms → section "Demonstration forms" → the form's **Upload this form** →
   choose the file → **Analyse form** → map screen → **Confirm mapping** → tick "I have checked…" → **Confirm
   mapping**):
   - AXA Global Healthcare – Therapy treatment plan: `axa-global-therapy-treatment-plan.pdf`
   - Aviva – CM016: `aviva-cm016.pdf`
   - optional, only if you might be asked: Freedom `freedom-worldwide-claim-form.pdf`

   **Leave Bupa for the call** (uploaded live, about 45 s). If you'd rather not, pre-upload it too and on the call
   just open its mapping ("View mapping").
   The files are in `~/Projects/Appstackx/clinforms/demo-assets/insurers/` (in the file dialog: Cmd+Shift+G, paste
   the path). Always use the card's **Upload this form**: it pre-fills referrer type "Insurer" (the generic
   "Upload a referrer form" dialog defaults to "Medico-legal company").
   The "Example portal questions (illustrative)" set is already in the library, confirmed – nothing to do.
5. Leave exactly two tabs open:
   - **Tab 1:** `http://localhost:3000/reports/forms` (Referrer forms)
   - **Tab 2:** `http://localhost:3000/pms-sandbox` → **Rebecca Lane** (Registration tab; Documents shows 0)
6. Open a Finder window (not shared) on the fallback folder `~/Projects/Appstackx/clinforms/demo-assets/outputs/`.

### 2.4 Browser setup

- A separate Chrome profile just for demos (Chrome → profile icon → **Add** → **Continue without an account** →
  name it "ClinForms demo"): no extensions, bookmarks, autofill or history on show. Same profile Monday and Tuesday.
- One window about 1440 px wide; zoom 100% (Cmd+0); bookmarks bar hidden (Cmd+Shift+B).
- macOS **Do Not Disturb** on; quit Slack, Mail, Messages, WhatsApp; phone on silent.
- In the meeting app share **only the Chrome window**, never the whole screen (the terminal shows paths and server
  logs; this document names our drafting provider).
- Don't open DevTools. Don't click the header's "Demo mode" button, "Built-in templates" or "Batch" – they lead away
  from the story.

### 2.5 Live drafting – optional, not recommended for this call

Demo mode needs no internet, key or credit. Live drafting writes longer answers than the insurer boxes hold (they
spill onto a continuation sheet – a known limit, fix planned), so keep the call in demo mode. Only if you
deliberately want to show live drafting (e.g. the portal questions):
- **Check Anthropic credit first:** sign in at console.anthropic.com → Billing yourself; never paste keys anywhere.
- Start with `npm run demo:red -- --live` (uses `.env.local`'s `MEDREPORT_AI_MODE=auto`).
- **Passcode:** `MEDREPORT_LIVE_PASSCODE` in the checkout's `.env.local`
  (`~/Projects/Appstackx/clinforms-demo/.env.local` – same value as `~/Projects/Appstackx/clinforms/.env.local`);
  the deployed environments' passcodes are in `~/.config/appstackx/clinforms.secrets.env`. Open the file yourself,
  off-screen, and type the passcode; never paste it into chat or a shared window.
- Timings measured by script on 09/10: Bupa draft 5.7–6.9 s, portal questions 7.4 s, reading a new form 14–24 s.

### 2.6 Fallback material (open only if needed)

- Finals from the 09/10 rehearsal, `~/Projects/Appstackx/clinforms/demo-assets/outputs/`:
  - `Lane_R_Therapies-management-form-further-physiotherapy-treatment-request_2026-10-09_SIGNED.pdf` – Bupa, approved, 3 pp
  - `Lane_R_Therapy-treatment-plan_2026-10-09_DRAFT.pdf` – AXA, draft only (watermarked), 4 pp
  - `Lane_R_Private-medical-insurance-claim-form-CM016_2026-10-09_PREFILLED.pdf` – Aviva, 8 pp
  - `Lane_R_Freedom-Worldwide-outpatient-medical-treatment-claim-form_2026-10-09_PREFILLED.pdf` – Freedom, 4 pp
  - `bupa-copied-answers.txt`, `portal-demo-copied-answers.txt` – the copy-ready text
  - `png/` – page images of those PDFs
- Screenshots of every step: `~/Projects/Appstackx/clinforms/demo-assets/rehearsal/` (numbered; the key ones are
  listed in §5).
- **Never open `_wave2-before/`** in either folder: older, superseded output (`_SIGNED` on prefill forms; one file
  carries internal labels).

### 2.7 Live backup on clinforms.co.uk (only if the laptop demo cannot run)

A clearly fictional clinic on the live site holds the same demonstration: **"Riverside Physiotherapy (fictional)"**
(`riverside-demo`), the six insurer forms + the portal set confirmed, and Rebecca Lane's four **draft** reports (Bupa
22 of 22 answered, AXA with Bupa's numbers held back, Allianz, portal set) – the same answers as the laptop demo.

**Set it up once, yourself** (production write = your call; not on Monday evening – do it before the rehearsal), from the
branch `ops/red-live-backup` (worktree `~/Projects/Appstackx/clinforms-wt/red-backup`):
```bash
cd ~/Projects/Appstackx/clinforms-wt/red-backup && A=~/Projects/Appstackx/clinforms/demo-assets/insurers
npm run admin:seed-demo-clinic -- --env production --owner-email khuram@appstackx.co.uk --maps-dir $A/maps --pdf-dir $A
#   dry run (checked 10/10: signing secret MATCH, your account found, nothing written) – then write:
npm run admin:seed-demo-clinic -- --env production --owner-email khuram@appstackx.co.uk --maps-dir $A/maps --pdf-dir $A --confirm --yes
#   after a rehearsal, put the drafts back:  … --refresh-reports --confirm --yes
```
On the call: sign in at clinforms.co.uk (your own account and authenticator) → **Choose a clinic → Riverside
Physiotherapy (fictional)** → Reports (4 drafts) / Referrer forms (7 confirmed). Use the **seeded drafts**; for "Upload
the notes" the file is `~/Projects/Appstackx/marketing/clinforms/red-backup/rebecca-lane-notes.json` (fictional).

Differences from the laptop demo – know them before you share:
- You are signed in as yourself, so answers read "Sarah Reid recorded…" and **"Write in my own voice" does not
  appear** (it is offered only to the clinician who wrote the notes).
- **No approval**: your account has no HCPC number / "may sign" – show the preview (DRAFT watermark, demo footer), the
  Flags and "Copy all answers" instead; the signed Bupa PDF is in the fallback folder (§2.6).
- No simulated TM3 on the live site: the patient comes from the uploaded notes. A **new** report from an upload drafts
  live (drafting is on for this clinic – real calls, credit needed, longer answers than the boxes): prefer the seeded drafts.
- Afterwards: remove it with `npm run admin:offboard-clinic -- --env production --slug riverside-demo` (dry run first;
  your account stays – it is also in `appstackx`), or keep it for the next demo (drafts untouched for 30 days are deleted).

---

## 3. The 10-minute call script

Times are cumulative and include talking (estimate). Machine times per step are in §3.2. Say "drafted from your
notes", "every answer shows where it came from", "the physio approves" – no technical or vendor words.

### 3.1 Click path and what to say

| # | When | Screen and clicks | Say |
|---|---|---|---|
| 0 | 0:00–1:00 | Not sharing yet (or Tab 1) | "Thanks for making time. In one line: ClinForms completes the insurer's own form, in its own layout, from your clinic notes – and nothing goes out until your physio approves it. Before I show you: which insurers send you the most forms, and do they come as PDFs or through their websites?" *(Listen; note the answers.)* Then: "What I'll show uses **public** insurer forms and one **made-up patient** – they're not your forms, and there's no real patient data here." |
| 1 | 1:00–2:00 | **Tab 1 – Referrer forms** → scroll to "Demonstration forms" → Bupa card → **Upload this form** → choose `bupa-therapies-management-form.pdf` → **Analyse form** → map screen: the form in its original layout on the left, the questions on the right with their source chips (registration, calculated, drafted from notes, clinician opinion, sign-off, leave blank) → **Confirm mapping** → tick → **Confirm mapping** | "Each insurer's form is uploaded once. It works out what every box needs and where the answer comes from – the registration record, a calculation, the notes, or the clinician's own opinion – and someone at the clinic checks that once. I set this one up and checked it before the call; a new form takes about 15 to 25 seconds to read, then that one check. After that it's reused for every patient." |
| 2 | 2:00–5:00 | **Tab 2 – Simulated TM3**, Rebecca Lane: point at insurer Bupa and the membership number → Report author **Sarah Reid** → **Complete referrer's report form** (opens a new tab) → "Check the data" (5 notes, 7 appointments, 9 scores) → **Choose the referrer form** → Bupa is pre-selected, "This referrer's own form" → **Complete this form** → review: "22 of 22 answered" → **Write in my own voice** → open the diagnosis and assessment answers: each shows its note chip (e.g. N-001 · 01/09) → **Sources** tab → **Flags** tab (nothing blocking) → **Preview** tab → expand (⤢): Bupa's form filled in its own boxes, DRAFT watermark, demo footer → close → **Approve…** → dialog: tick the confirmation; Full name **Sarah Reid**; HCPC **PH-DEMO-01**; typed signature **Sarah Reid**; tick the 4 attestations → **Approve and sign** → **Completed form (PDF)** → open it (page 2 assessment table, page 3 declaration) → **Save to clinic record** → optional: Tab 2 → Documents tab shows the PDF → back → **Copy all answers** | "This is the patient's record in a clinic system – here a simulated one." · "One click from the record: it reads her registration details, notes, appointments and outcome scores." · "Her details, numbers and scores are copied exactly from the record into their boxes. The clinical answers are drafted from the notes; every answer shows which note it came from, and the figures in it are checked against that note." · On *Write in my own voice*: "It's the treating physio's form, so this turns 'Sarah Reid recorded…' into the way she'd write it. She can edit any answer." · On the plan and reason: "The extra sessions, the plan and the clinical reason are only there because Sarah recorded them on 1 October. If she hadn't, they'd be left blank for her." · On approve: "Nothing is issued until the physio approves. Her name, the date and her HCPC number go only into the therapist's declaration." · On the PDF: "That's Bupa's form, completed in its own boxes – the file you'd send today – and it's saved back to her record." · On copy: "If they want it in a website or an email instead, the same answers copy out as text." |
| 3 | 5:00–6:15 | **Tab 2** → **Complete referrer's report form** → **Choose the referrer form** → **AXA Global Healthcare – Therapy treatment plan** → **Complete this form** → **Flags** tab: items must be resolved before approval → open **F-04** (membership number): the record's number is Bupa's, so it was not copied → **F-28** (specialist review date): not recorded, so it asks the clinician → **Preview** → expand: AXA's form in its layout, DRAFT | "Same patient, AXA's layout – this is AXA's international plan form, not the AXA Health UK one. Notice what it won't do: her membership number is Bupa's, so it refuses to put it on AXA's form – staff type AXA's number from the authorisation letter. And where the notes don't say when she'd go back to a specialist, it asks Sarah rather than guessing." **Don't** click "Use the referral's reference…", don't type numbers, don't approve. |
| 4 | 6:15–7:45 | **Tab 2** → **Complete referrer's report form** → **Choose the referrer form** → **Example portal questions (illustrative)** → **Complete this form** → 7 of 8 drafted with note chips → scroll to **F-08 Prognosis**: "Needs clinician input" – no clinician recorded one → **Copy all answers** | "AXA Health, Vitality and WPA mostly take updates through their own websites. These are example questions we wrote ourselves – not copied from any insurer – but it's the same idea: the questions are set up once, the answers are drafted from the notes, and your team pastes them in. It doesn't log in or submit anything. And look at prognosis: nobody recorded one, so it's left for Sarah – never invented." |
| 5 | 7:45–8:30 | **Tab 2** → **Complete referrer's report form** → **Choose the referrer form** → **Aviva – Private medical insurance claim form (CM016)** (card: "46 for the patient or their GP") → **Complete this form** → section 1 filled from the record; later sections "For the patient to complete" / "For the patient's GP or doctor" → **Preview**: address lines and postcode in their own boxes → **Approve…** → the dialog says nobody at the clinic signs this form → **Cancel** (or **Approve the prefill** → file `_PREFILLED`) | "Some insurer forms aren't the physio's to fill. This is Aviva's claim form for the patient and their GP: it fills in her details and leaves the rest for them. It's approved as a checked prefill – the clinic never signs it." |
| 6 | 8:30–10:00 | Stop sharing (or stay on the reports list) | "So, to your question: no fixed list. Bupa's form – ready today. The portal insurers – answers ready to paste. Anything else that comes as Word or PDF – set up once and checked. Two honest limits: it isn't connected to your clinic system yet – today it works from an export or upload of the notes – and before any real patient data we'd have the data processing agreement, the impact assessment and UK hosting in place." Then the questions in §4.3. **Next step to ask for:** "Could you send me two or three of the blank forms you get most – no patient details? I'll set them up and show you them completed for a made-up patient, and we can talk about a short pilot." |

Skip Freedom, Allianz and Aviva GEN030 unless Daniel asks. If RED is not on TM3, never open the ClinForms home page
(its cards say "Simulated TM3 connected" and "Direct TM3 connection – subject to TM3 providing access"); start on
Referrer forms and say "here it reads a simulated clinic system; with yours it would read an export or upload".

### 3.2 Machine times from the 09/10 rehearsals

| Step | Rehearsal 1 (quiet Mac) | Rehearsal 2 (load ~60) |
|---|---|---|
| Analyse a prepared form | 0.2–0.3 s | 7.9–8.2 s (Freedom once 160 s) |
| Open the map screen | 1.4 s | 2.1–3.7 s |
| Confirm the map | 0.9–1.7 s | 1.8–6.4 s |
| Open the patient | 0.9 s | 1.2 s |
| Complete referrer's report form → data step | 2.4 s | 1.3–3.2 s |
| Complete this form → review (prepared answers) | 2.5–2.6 s | 2.5–4.7 s |
| Open the large preview | – | 4.1 s (AXA 14.7 s) |
| Approve → approved | 2.2 s | 3.0–10.7 s |
| Download the final PDF | 0.2 s | 0.5–1.5 s |
| Save to clinic record | 1.4 s | – |
| Copy all answers | 0.9 s | 1.0–1.1 s |

Human pace with talking (estimate, not measured): Bupa upload ~45 s, Bupa end to end 2.5–3 min, AXA ~1 min, portal
1–1.5 min, Aviva 30–45 s – about 9–10 minutes in all. Uploading all four forms live would add 2–3 minutes.

### 3.3 Labels on screen and how to frame them

| On screen | What it is | Say if asked |
|---|---|---|
| "Pre-written demonstration map" (map screen) | The map was prepared and checked before the call | "I set this one up in advance. A new form takes 15–25 seconds to read, then one check by your team." |
| "Prepared demo draft (09/10/2026)" (review header) | Answers drafted from these notes on Friday through the real drafting path, checked, a few shortened by hand to fit Bupa's boxes, then saved so the demo needs no connection | "These were drafted from her notes on Friday, then checked and tidied to fit Bupa's boxes – exactly what the physio's review step is for – and saved for the demo. Drafting live takes about 7 seconds." |
| "Simulated TM3 sandbox – demo data, not affiliated with TM3" | The fake clinic system | "We simulate a clinic system for demos; we're not connected to TM3." |
| "Demo mode" (header) | No live drafting | "It's running on my laptop in demo mode." |
| "From TM3 registration" chips | Source label | "From the clinic system's registration record." |
| `sim-pat-006` | The made-up patient's ID | – |
| "Filled from the record – nothing drafted yet" (Aviva) | Nothing on this form needs drafting | "There's nothing on this form for the physio to write." |
| AXA progress "…answered and clear88%" | Cosmetic: text runs together at this width | Ignore |

Other small glitches you may see (cosmetic, ignore): a sandbox file size wrapping onto two lines; a word broken
inside Freedom's fees table; truncated text on a few stat tiles.

### 3.4 Don't

- Don't claim these are RED's forms, or say "watch it read Bupa's form" (the maps were prepared – say so).
- Don't type AXA numbers or approve AXA (one Bupa-insured patient on AXA's form would look staged).
- Don't open the terminal, this document, `_wave2-before/`, or anything in `memory/` while sharing.
- Don't say "AI", or name the drafting provider, unprompted. If Daniel asks directly what powers it, answer
  truthfully (§4.1, Q3).
- Don't promise dates, prices, a clinic-system connection or portal submission.

---

## 4. Questions, caveats and what to ask

### 4.1 Likely questions – honest answers

1. **"Which insurers do you actually support? Ours are AXA Health, Vitality, WPA, Bupa…"**
   No fixed list. Any insurer that sends a Word or PDF form: uploaded once, checked once by staff, reused for every
   patient. So far it has been tried on 6 public insurer PDFs with fictional data. Of those, Bupa's further-treatment
   form is the one UK physio clinics fill routinely; AXA Global Healthcare, Freedom and Allianz Care are
   international plans. AXA Health UK, Vitality and WPA publish no physio PDF and appear to use provider portals –
   for those ClinForms drafts copy-ready answers and your team pastes them in; there's no portal login or
   submission. "Which forms and portals do you get, and how many a month?"
2. **"Does it plug into our clinic system?"**
   Not yet. The demo reads a simulated TM3. There's no live connection to TM3 or any other system; a direct TM3 link
   depends on TM3 granting access. What works today: upload the patient's notes as a PDF printout or an export
   (JSON/CSV) from any system. Ask which system RED uses.
3. **"Who writes the clinical text? What if it gets something wrong – who's responsible?"**
   An automated drafting service drafts each answer from the notes and cites the note it used. Identifiers and
   record values (names, numbers, dates of birth, outcome scores in their own boxes) are copied by code, not
   drafted; figures inside a drafted answer are checked against the note it cites. Opinions (prognosis, plan, reasons) are only filled if a clinician
   recorded them; otherwise they're left blank and flagged (AXA's specialist-review date, the portal's prognosis).
   The checks cannot catch a wrong paraphrase that cites a real note, so the treating physio reads every answer
   before approving – the approval dialog makes her confirm exactly that. The physio approves with her name, HCPC
   number and attestations, and the server signs a receipt over the exact content. *If asked what powers it:* say
   truthfully which provider processes it (Anthropic); it is named as a sub-processor in the data processing
   agreement.
4. **"Where does patient data go? Can we pilot with real patients now?"**
   Not yet. In this demo everything stays in the browser; it's fictional data on a laptop. The production version
   (clinic accounts with two-step sign-in, encrypted storage) is being built but is not live. Real patient data
   needs a data processing agreement, a data protection impact assessment, UK hosting and access controls first –
   give a date only after scoping.
5. **"How much time does it save? What does it cost?"**
   Machine time is seconds (about 7 s to draft a form live, 15–25 s to read a new form – script measurements). The
   physio still reviews; how long that takes with real clinicians hasn't been measured – my guess is a few minutes
   per form, and a pilot would measure it. No price has been set for RED: "it depends on volume and the number of
   forms; we'd confirm after a short pilot". (Any figure is your call – proposals only in
   `memory/context/pricing.md`.)
6. **"Is that our Bupa form?"** It's Bupa's public form, used for the demo. Send yours (blank) and we'll set it up.
7. **"Can it submit to Bupa's or AXA's provider site for us?"** No. It produces the completed form, or answers
   ready to paste; your team submits them as today.
8. **"Does it do billing, claims or invoicing?"** No – it completes the clinical forms (reports, further-treatment
   requests, treatment plans). On a claim form it can fill the treatments-and-fees table from the appointments
   (shown on Freedom's form if he asks). Ask what "support" meant in his email.
9. **"What about scanned or old forms?"** Word and fillable PDFs: fully. Flat PDFs: answers written into the printed
   boxes, best effort, checked once. Scanned forms: not shown yet – the mapping would be largely manual; send one
   and we'll try it.
10. **"What if an insurer changes its form?"** The new version is uploaded and checked once; versions sit side by
    side.
11. **"Does it do medico-legal reports too?"** Yes – solicitor, case-manager and employer forms (Word with tables
    and tick boxes, PDFs) are the other half of the product.
12. **"Who else uses it?"** Nobody with real patients yet – it's new. RED would be one of the first clinics, which
    is why we'd start with a measured pilot. Don't name other prospects.

### 4.2 Caveats – say them before he finds them

- Public insurer forms, used for demonstration only – not RED's forms, not endorsed by the insurers.
- One fictional Bupa-insured patient shown on several insurers' layouts – that's why AXA holds Bupa's numbers back.
- The insurer maps were prepared and checked in advance; the answers were drafted from the notes beforehand,
  checked and partly shortened by hand to fit the boxes, and replayed.
- Live drafts can run longer than an insurer's boxes (continuation sheet) – a fix is planned.
- The clinic system shown is a simulation; today it works from an upload or export of the notes.
- No logins in this demo; reports live in the browser. Anyone could type a clinician's name to approve.
- No portal submission; portals get copy-ready answers.
- Whether AXA accepts an approval line typed into its signature box is not known.
- Review time with real clinicians and the time saved have not been measured. No price set.

### 4.3 Questions to ask Daniel (note his answers)

1. Which insurers and MLCs send you the most forms, and roughly how many a month?
2. Do they come as Word/PDF forms, or through the insurers' portals? Which portals?
3. How long does one take today, who writes it, and who signs it?
4. Which practice-management system do you use (TM3, Cliniko, WriteUpp, Jane, other)? Can it export notes?
5. When you asked "which insurers do you support", did you mean these forms – or billing, authorisations and
   claims?
6. Do you get medico-legal or case-manager reports as well?
7. Could you send 2–3 blank forms you get most (no patient details)?
8. (Only if he raises it) What would you expect to pay for something like this?

---

## 5. If something breaks on the call

| Symptom | Do this |
|---|---|
| `demo:red` won't start: port in use | `lsof -nP -iTCP:3000 -sTCP:LISTEN`, stop that process, then `npm run demo:red -- --skip-build` |
| `demo:red` refuses: demo assets folder or maps missing | Run from `~/Projects/Appstackx/clinforms-demo` (its `.env.local` points at the files); `npm run demo:check` names the problem |
| Upload says the questions were found by layout rules (no prepared map) | Wrong file or folder: use the exact file from `clinforms/demo-assets/insurers/` via the card's **Upload this form**; otherwise switch to a pre-uploaded form |
| Answers come back blank ("no prepared demo answers") | Use Rebecca Lane only, launched from her record; if it persists, switch to the fallback PDFs |
| A passcode field or "live" wording appears | The server runs with `--live`: Ctrl+C, `npm run demo:red -- --skip-build` |
| Browser misbehaves or storage full | Reports → Demo tools → Reset demo, then re-upload (≈ 1 min per form) – or go to the fallback |
| Anything else, or time runs short | Stop sharing Chrome, open the fallback in Preview and share that window: Bupa `_SIGNED` PDF first, then the AXA `_DRAFT` and Aviva `_PREFILLED`; then screenshots from `demo-assets/rehearsal/` in this order: `05-c-map.png`, `12-d-review.png`, `12-k-approve-filled.png`, `12-l-approved.png`, `14-i-card-f04-block.png`, `18-e-portal-prognosis-gap.png`, `16-d-review.png`, `16-k-approve-filled.png`. Say: "Let me show you the output from the run I did earlier." |
| Internet drops | The demo is local and needs no internet – only the call itself does. Re-join and carry on |

---

## 6. After the call

- Record Daniel's answers (insurers, volumes, portals, system, signers, what "support" means, next step) in
  `memory/projects/red-physiotherapy.md` §7 and update the support matrix there and here.
- Follow-up email (draft only when you ask): thanks, the one-line answer, the agreed next step (blank forms).
- Decide: a RED-specific short video, a second fictional patient insured with AXA (makes AXA approvable without
  typed numbers), and the live-drafting box-size fix (`forms-8`) if live drafting will be shown later.
- Do not send Daniel `clinforms.co.uk` as "the demo": it currently runs an older, pre-RED build (no insurer forms).
