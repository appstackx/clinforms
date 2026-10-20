# RED call – run sheet (Tue 13 Oct 2026) · internal, never share this window

Checked 08:59 today: the demo folder is at the frozen version, already built, demo assets OK (7 maps, 4 answer
files, 6 forms), port 3000 free, Mac quiet. Fallback PDFs and screenshots are in place. The live backup clinic
exists on clinforms.co.uk. Full detail: `docs/demo-red-physio.md`.

---

## A. Set up (10 min) – do this now

1. **Quiet Mac:** Do Not Disturb on; quit Slack, Mail, WhatsApp, Messages; phone on silent.
2. **Start the demo** in Terminal, then minimise Terminal (never share it):
   ```bash
   cd ~/Projects/Appstackx/clinforms-demo
   npm run demo:red -- --skip-build
   ```
   Wait for: `ClinForms demo (local only): http://localhost:3000/reports · drafting mode demo`.
   Leave it running until after the call.
3. **Chrome, "ClinForms demo" profile** (if you don't have one: profile icon → Add → Continue without an
   account → name it "ClinForms demo"). One window about 1440 px wide, **Cmd+0**, **Cmd+Shift+B** (hide bookmarks).
4. Open **`http://localhost:3000/reports`**. The header must say **Demo mode**. If anything is left over from
   earlier: **Demo tools → Reset demo**.
5. **Pre-upload 2 forms** (not Bupa – Bupa is done live on the call):
   Referrer forms → section **"Demonstration forms"** → the form's card → **Upload this form** → in the file
   dialog press **Cmd+Shift+G**, paste `~/Projects/Appstackx/clinforms/demo-assets/insurers/`, choose the file
   → **Analyse form** → **Confirm mapping** → tick **"I have checked…"** → **Confirm mapping**.
   - AXA Global Healthcare – Therapy treatment plan: `axa-global-therapy-treatment-plan.pdf`
   - Aviva – CM016: `aviva-cm016.pdf`
   - (optional) Freedom: `freedom-worldwide-claim-form.pdf`
   Always use the card's **Upload this form** button (it sets "Insurer").
6. **Two tabs only:**
   - Tab 1: `http://localhost:3000/reports/forms` (Referrer forms)
   - Tab 2: `http://localhost:3000/pms-sandbox` → click **Rebecca Lane**
7. **Finder window** (not shared) on `~/Projects/Appstackx/clinforms/demo-assets/outputs/` – your fallback.

## B. Rehearse (15 min)

1. Run section C once **out loud with a timer**. Aim for 10 minutes.
2. After **Write in my own voice**, read every Bupa answer once so nothing surprises you.
3. Open the downloaded Bupa PDF: 3 pages, demo footer on each, name/date/HCPC only in the declaration.
4. **Reset for the call:** Tab 1 → Reports → **Demo tools → Reset demo** → redo **A.5** (AXA + Aviva).
   Put the tabs back as in **A.6**. Keep the server running.

## C. In the meeting (10 min)

Share **only the Chrome window**, never the whole screen. Say "drafted from your notes", "shows where it came
from", "the physio approves" – never "AI".

| # | Time | Do | Say |
|---|---|---|---|
| 0 | 0:00–1:00 | Not sharing yet | "Thanks for making time. You emailed about CareConnect – we've since named it **ClinForms**. In one line: it fills in each insurer's **own** form, in its own layout, from your clinic notes, and nothing goes out until your physio approves it. First – which insurers send you the most forms, and do they come as PDFs or through their websites?" *(Listen, note it.)* "What I'll show uses **public** insurer forms and one **made-up patient** – not your forms, no real patient data." |
| 1 | 1:00–2:00 | **Share Chrome.** Tab 1 → "Demonstration forms" → Bupa card → **Upload this form** → `bupa-therapies-management-form.pdf` → **Analyse form** → map screen (form on the left, questions with their source on the right) → **Confirm mapping** → tick → **Confirm mapping** | "Each insurer's form is uploaded once. It works out what every box needs and where the answer comes from – registration, a calculation, the notes, or the clinician's own opinion – and someone at the clinic checks that once. I set this one up before the call; a new form takes about 15–25 seconds to read, then that one check. After that it's reused for every patient." |
| 2 | 2:00–5:00 | Tab 2 Rebecca Lane: point at insurer **Bupa** + membership number → Report author **Sarah Reid** → **Complete referrer's report form** (new tab) → data check (5 notes, 7 appointments, 9 scores) → **Choose the referrer form** → Bupa → **Complete this form** → "22 of 22 answered" → **Write in my own voice** → open the diagnosis answer (note chip, e.g. N-001) → **Sources** → **Flags** → **Preview** → ⤢ → close → **Approve…** → tick; name **Sarah Reid**; HCPC **PH-DEMO-01**; signature **Sarah Reid**; tick the 4 boxes → **Approve and sign** → **Completed form (PDF)** → open it → **Save to clinic record** → **Copy all answers** | "This is a patient record in a clinic system – a **simulated** one. With Cliniko you'd upload the notes it exports." · "Her details, numbers and scores are copied exactly into their boxes. The clinical answers are drafted from the notes – each one shows which note it came from." · *Own voice:* "It's the physio's form, so this puts it in her voice. She can edit any answer." · *Plan/reason:* "Extra sessions, plan and reason are only there because Sarah recorded them on 1 October – otherwise they'd be left for her." · *Approve:* "Nothing is issued until the physio approves. Her name, date and HCPC number go only into the declaration." · *PDF:* "That's Bupa's form, completed in its own boxes – the file you'd send today – saved back to her record." · *Copy:* "If it goes into a website or email instead, the same answers copy out as text." |
| 3 | 5:00–6:15 | Tab 2 → **Complete referrer's report form** → **Choose the referrer form** → **AXA Global Healthcare – Therapy treatment plan** → **Complete this form** → **Flags** → **F-04** (membership no.) → **F-28** (specialist review date) → **Preview** ⤢ | "Same patient, AXA's layout – this is AXA's **international** plan form, not AXA Health UK. Notice what it won't do: her membership number is Bupa's, so it won't put it on AXA's form – staff type AXA's own number. And the notes don't say when she'd see a specialist, so it asks Sarah instead of guessing." **Don't type numbers, don't approve.** |
| 4 | 6:15–7:45 | Tab 2 → **Complete referrer's report form** → **Choose** → **Example portal questions (illustrative)** → **Complete this form** → 7 of 8 drafted → scroll to **F-08 Prognosis** ("Needs clinician input") → **Copy all answers** | "AXA Health and Vitality mostly take updates through their own websites. These are example questions we wrote ourselves, not copied from any insurer – but same idea: set up once, answers drafted from the notes, your team pastes them in. It doesn't log in or submit anything. And prognosis – nobody recorded one, so it's left for Sarah, never invented." |
| 5 | 7:45–8:30 | Tab 2 → **Complete referrer's report form** → **Choose** → **Aviva – Private medical insurance claim form (CM016)** → **Complete this form** → section 1 filled, rest "For the patient / GP" → **Preview** → **Approve…** → dialog says nobody at the clinic signs → **Cancel** | "Some insurer forms aren't the physio's. Aviva's claim form is for the patient and GP – it fills her details and leaves the rest for them. It's approved as a checked prefill; the clinic never signs it." |
| 6 | 8:30–10:00 | **Stop sharing** | "So, to your question: no fixed list. Bupa's form – ready today. Portal insurers – answers ready to paste. Anything else that comes as Word or PDF – set up once and checked. Two honest limits: it isn't connected to Cliniko yet – today it works from an export or upload of the notes – and before any real patient data we'd sign a data processing agreement and do the impact assessment." → questions in D → **ask:** "Could you send me two or three of the blank forms you get most – no patient details? I'll set them up and show you them completed for a made-up patient, and we can talk about a short pilot." |

Skip Freedom, Allianz and Aviva GEN030 unless he asks. **Don't open the ClinForms home page** (it says
"Simulated TM3 connected" – RED uses Cliniko).

## C3. If he asks "show me uploading exported notes" (laptop demo, 1 min)

Header **Complete a form** → tab **Upload the notes** → **Try the printed notes PDF (Priya Nair, fictional)** →
it reads the PDF into a patient record → show the data check (notes, appointments, scores) → **stop there**
(prepared answers exist only for Rebecca Lane). Optional: **Download** the sample PDF first to show what the file
looks like. Say: "This is notes printed to PDF from a clinic system – a made-up one. Cliniko's export will look a
bit different, so in a pilot we'd test it with an export of a test patient first."

## D. Ask Daniel (write his answers down)

1. Which insurers send the most forms, and roughly how many a month across the 3 sites?
2. PDF/Word forms, or portals? Which portals?
3. How long does one take today, who writes it, who signs it?
4. Can Cliniko export the notes for a patient (PDF or CSV)?
5. When you asked "which insurers do you support" – did you mean these forms, or billing/claims?
6. Any medico-legal or case-manager reports too?
7. Can you send 2–3 blank forms (no patient details)?

## E. If he asks…

| Question | Answer |
|---|---|
| **Price?** | Ask first: "Roughly how many insurer reports a month?" Then: "We price per clinic, not per user – all three sites and all staff included. Practice is £199 a month; as one of our first clinics it's **£149 a month fixed for 12 months**, plus a one-off **£250** to set up your main forms and the data-protection paperwork. Monthly, cancel any time. Best next step is a short pilot on two or three of your own forms." Under ~25 forms a month → **Starter £99**. Prices ex VAT. Don't discount further. |
| Plug into Cliniko? | "Not yet. Today you upload the notes Cliniko exports. Cliniko has an API, so a direct connection is something we can look at with you." No dates. |
| Who writes the text? Who's responsible? | "It's drafted from the notes and every answer cites the note it used. Names, numbers and scores are copied, not drafted. Opinions only appear if a clinician recorded them. The physio reads and approves every form – that's her sign-off." If asked what powers it: say truthfully it's Anthropic, named as a sub-processor in the data processing agreement. |
| Where does data go? Real patients now? | "The clinic version is live – clinic accounts with two-step sign-in, data encrypted per clinic. Before any real patient data we sign a data processing agreement, do the impact assessment and host it in the UK." No dates. |
| Is that our Bupa form? | "It's Bupa's public form, used for the demo. Send yours blank and we'll set it up." |
| Submit to Bupa/AXA portals? | "No – it produces the completed form or answers ready to paste; your team submits as today." |
| Billing, claims, invoicing? | "No – it completes the clinical forms. On a claim form it can fill the treatments-and-fees table." |
| Scanned/old forms? | "Word and fillable PDFs fully; flat PDFs best effort, checked once; scanned – not shown yet, send one and we'll try." |
| Who else uses it? | "Nobody with real patients yet – it's new. You'd be one of the first clinics, which is why we'd start with a short pilot." Don't name other clinics. |

**Don't:** say "AI" unprompted, claim these are RED's forms, type AXA numbers or approve AXA, promise dates,
portal submission or a Cliniko connection, quote per-user prices.

## F. If something breaks

| Problem | Do this |
|---|---|
| Server won't start (port in use) | `lsof -nP -iTCP:3000 -sTCP:LISTEN`, stop that process, `npm run demo:red -- --skip-build` again |
| A passcode box or "live" wording appears | Ctrl+C in Terminal, `npm run demo:red -- --skip-build` |
| Answers blank / page stuck | Use Rebecca Lane opened from Tab 2 only; otherwise **Demo tools → Reset demo** and re-upload (≈ 1 min per form) |
| Anything else, or short of time | Stop sharing Chrome. Share a **Preview** window instead with the fallback PDFs from the Finder window: **Bupa `_SIGNED`** first, then AXA `_DRAFT`, then Aviva `_PREFILLED`. Say: "Let me show you the output from the run I did earlier." |
| Internet drops | The demo needs no internet – just re-join the call |

**Live backup (only if the laptop demo dies):** use the live site as in C2, then show the Bupa `_SIGNED` PDF for
the approval part.

## C2. Optional 1-minute closer on the live site (after step 5, before you stop sharing)

**Before the call:** in the demo Chrome window, open a 3rd tab → `https://clinforms.co.uk` → sign in (password +
authenticator, off-screen) → **Riverside Physiotherapy (fictional)** → Studio. Check that Reports shows Rebecca
Lane's 4 drafts.

**On the call:** switch to that tab → **Reports** → Rebecca Lane's **Bupa** draft → **Preview** → back →
**Upload the notes** → `~/Projects/Appstackx/marketing/clinforms/red-backup/rebecca-lane-notes.json` → stop at
**"Check what was imported"**.

Say: "What you've just seen ran on my laptop. This is the product itself, live: each clinic signs in with two-step,
has its own encrypted space and its own forms. With Cliniko you'd upload the notes it exports, like this, and it
shows you what it read before it builds anything."

**Don't do these on the live site today:**
- Approve or sign. It isn't possible there yet; the laptop demo is where you approve.
- Look for "Write in my own voice". It doesn't appear for your account.
- Upload a new form, or go past the import check step. Either one makes real drafting calls, and those answers
  come out too long for the boxes.

## G. After the call

Tell Claude Daniel's answers (insurers, volumes, portals, Cliniko export, who signs, next step) – they go into
`memory/projects/red-physiotherapy.md` and the follow-up email draft.
