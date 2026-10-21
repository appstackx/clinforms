# Blue Heart call – run sheet (15 min) · internal, never share this window

**Call: Fri 23 Oct 2026, 11:30** (start set-up at 11:00).

Dell Baines, owner, Blue Heart Clinics (11 sites, uses TM3). He wants to see ClinForms complete "the different MLC
and insurer forms we receive", with clinicians reviewing and approving before anything is sent, and to ask questions.
**His email of 21 Oct describes his process.** Each provider's template is kept as RTF in TM3. TM3 mail-merges the
name, address, date of birth and physio. The physio then types the clinical part from the Initial Assessment ("the
time-consuming part"). He wants that part filled from the notes, with the physio reviewing, amending and approving.
His providers: Speed Medical, HCML, 3D Rehab, Physio Link, Physio Med, The Physio Network, Bodycare Clinic and The
Treatment Network. Coverage, providers and the 21 Oct test: call pack "Dell's process".
Checked Tue 20 Oct: the frozen demo folder passes its check, and the whole story below ran end to end on a test
browser (every step under 1.2 s). Not tested there: where Chrome puts each new tab, and going back to the approved
Harrow & Pike tab after Bodycare – check both in your rehearsal (B.1). **Added 21 Oct: Bodycare's public Initial
Assessment Report** (one of Dell's providers) as a prepared demonstration form – checked end to end the same evening,
and the rehearsed steps re-checked unchanged. The public site clinforms.co.uk runs the same
story (fallback). Full detail, prices and the reply email: `docs/demo-blue-heart.md`.

**Before the day:** check your Sent mail for what you last sent Dell (video? prices?). Decide the year-2 price,
VAT and the proof-of-concept turnaround (`docs/demo-blue-heart.md` §0).

---

## A. Set up (10 min)

1. **Quiet Mac:** Do Not Disturb on; quit Slack, Mail, WhatsApp, Messages; phone on silent.
2. **Restart the demo.** The old server from 13 Oct may still be running on port 3000: press **Ctrl+C** in its
   Terminal window. If you can't find it: `lsof -nP -iTCP:3000 -sTCP:LISTEN`, then check it's the old demo
   (`ps -o command= -p <PID>` shows `next-server`) before `kill <PID>` – if it's anything else, leave it. Then:
   ```bash
   cd ~/Projects/Appstackx/clinforms-demo
   npm run demo:check                  # "Demo assets OK: 8 maps, 5 answer files, 7 form files …"
   npm run demo:red -- --skip-build
   ```
   Wait for `ClinForms demo (local only): http://localhost:3000/reports · drafting mode demo`. Minimise Terminal.
3. **Chrome, "ClinForms demo" profile.** One window about 1440 px wide, **Cmd+0**, **Cmd+Shift+B** (hide bookmarks).
4. Open `http://localhost:3000/reports`. Header must say **Demo mode**. Then **Demo tools → Reset demo → Reset
   demo**. You should see "Demo reset." and "No forms completed yet". (This clears the old shoulder-patient reports
   and insurer uploads.) **Don't** pre-upload Bodycare – that's done live (about 5 s).
5. **Two tabs:** Tab 1 `http://localhost:3000/reports` · Tab 2 `http://localhost:3000/pms-sandbox` → **Hart, Megan (Ms)**.
6. **TextEdit note (not shared)** with the clinician's three opinions, to paste in step 5:
   - B7: `In my opinion Ms Hart has made a good recovery. I expect the remaining intermittent neck ache to settle over the next three to six months with her home exercise programme.`
   - B8: `In my opinion there are no restrictions on work or daily activities. She may need short breaks from prolonged sitting or driving while the ache settles.`
   - B9: `In my opinion no further physiotherapy is needed. She should continue her home exercise programme and seek a review if symptoms worsen.`
   - Bodycare Our Ref (only if he asks to see Bodycare approved): `DEMO-BC-0001`
7. **Backup ready:** in the same Chrome profile open `https://clinforms.co.uk` once, click **Reject** on the cookie
   bar, close the tab. Finder window (not shared) on `~/Projects/Appstackx/clinforms/demo-assets/outputs/blue-heart/`.

## B. Rehearse (15 min)

1. Run section C once **out loud with a timer**. Aim for about 8–9 minutes of demo. In step 9, note where Chrome
   puts the Bodycare tab and check you can find the approved Harrow & Pike tab again (green **Approved** badge).
2. After **Write in my own voice**, read B2, B3 and B5 once – a few sentences are stiff ("On 18/03/2026: forward head
   posture…"). That's fine: the clinician can edit any line.
3. **Reset for the call:** Tab 1 → **Demo tools → Reset demo**, close extra tabs, put the two tabs back as in A.5.
   Keep the server running.

## C. In the meeting (15 min)

Share **only the Chrome window**. Say "completed from your notes", "shows the note it came from", "your clinician
approves" – never "AI". Each **Complete referrer's report form** opens a new report tab, and Chrome usually puts
each one right after Tab 2. Report tabs all have the same title – tell them apart by the page: Harrow & Pike shows the green
**Approved** badge and "Harrow & Pike Medico-Legal (fictional)" under "Megan Hart"; Bodycare shows **Draft** and
"Bodycare".

| # | Time | Do (exact labels) | Say |
|---|---|---|---|
| 0 | 0:00–1:30 | Not sharing | "Thanks Dell, and thanks for your email – it helped. As I understand it, TM3 mail-merges the patient's details into each provider's template, and then your physio types the clinical part from the Initial Assessment. That's the slow part, and that's the part we do. ClinForms completes each provider's **own** form, in its own layout, and nothing goes out until the treating physio has reviewed, amended and approved it. First: of the providers you listed, which send you the most, and roughly how many a month?" *(= D1. Listen, write it down. If he says PDF or scanned, see E.2.)* "Everything I'll show is fictional – a made-up patient, made-up MLC and insurer forms, and a simulated TM3, running on my laptop. The answers you'll see were drafted from these notes earlier and replayed so the demo runs offline; live, a form takes about 20 seconds." |
| 1 | 1:30–2:15 | **Share Chrome.** Tab 1 home: **Demo mode**; cards "Simulated TM3 connected", "Notes upload – available now", "Direct TM3 connection – subject to TM3 providing access". Tab 2: banner "Simulated TM3 sandbox – demo data, not affiliated with TM3"; Ms Megan Hart, solicitor referral, ref HP/RTA/2291 | *(TM3)* "This is a **simulated** TM3 – we're not connected to TM3. Today you'd upload the notes as PDF, Word or CSV, however TM3 lets you save them – we haven't tested a real TM3 export yet. A direct link depends on TM3 giving access, and we won't claim it until they do." Ask D4: "Do you use TM3 on the web or desktop, and can you save a patient's notes as a PDF?" |
| 2 | 2:15–3:00 | Right panel: Report author **Sarah Reid (PH-DEMO-01)** → **Complete referrer's report form** → "Imported from Simulated TM3: 10 notes · 11 appointments · 6 scores"; "Calculated by code from the record" (attendance 10 of 11; NDI 42% → 24% → 12%); "Data checks". *(Don't read the "authenticated API" caption under the button.)* | "In your clinic, this step is the TM3 notes you upload once – here the simulated TM3 plays that part. Megan's notes cover a full course. For an Initial Assessment report it drafts from the IA note alone – you'll see that on Bodycare's form in a minute. Nobody retypes anything, and anything counted – dates, attendance, scores – is counted by code, not written." *(Attendance here comes from the simulated record; with an upload it needs the appointment list in the export, otherwise staff fill it in. Don't promise attendance from printed notes until D4 is answered.)* |
| 3 | 3:00–3:45 | **Choose the referrer form** → Harrow & Pike Medico-Legal · Treating Physiotherapist Report · Word is already selected ("Matches the referrer on the referral") → **Complete this form** → "12 of 16 answered", red "8 items to resolve before approval"; left panel: **From records 8 · Drafted 4 · Needs input 4**; right panel **Preview**: "DRAFT – awaiting clinician approval" | *(Different forms, original layout)* "This is a made-up MLC's own Word form. The answers go into its own table cells – the layout doesn't change." *(Point at the left panel.)* "'From records' does your mail-merge's job: name, date of birth, reference and dates, put in by code. 'Drafted' is the part your physios type today, drafted from the notes. 'Needs input' is the physio's own opinions." If he asks about the "Prepared demo draft" badge: "These were drafted from her notes earlier and saved so the demo runs offline. Live, a form like this takes about 20 seconds to draft." |
| 4 | 3:45–4:30 | Scroll to **F-12 B5. Current symptoms and progress** → click chip **N-010 · 07/07** → **Sources** tab shows the note → **Flags 8** tab: F-13 to F-16 "Gap – not in the record" | *(Review)* "It also flags things an MLC will ask about that aren't in the notes, like pre-accident history. Every paragraph shows the notes it came from, and your clinician checks each one. Prognosis, restrictions and recommendations are opinions – nobody recorded them, so they're left for the clinician, never guessed." *Optional (30 s):* in F-12 type ` She was reviewed again on 14/08/2026.`, click away → "Blocked – check required" → **Revert to the draft**. "Add a date the notes don't support and approval is blocked." |
| 5 | 4:30–5:45 | **F-13 B6** (maximum medical improvement): tick **No**. Paste the three opinions into **F-14 B7**, **F-15 B8**, **F-16 B9** (badge "Clinician – Your own words"). Wait 1 s → orange **Mark resolved** on each of the 4 → "Ready for your approval", 16 of 16 | *(Amend)* "This is the clinician's part. Opinions only ever come from the clinician, and the record shows who wrote what." |
| 6 | 5:45–6:15 | Top banner → **Write in my own voice** | "It's the treating physio's report, so it reads in her voice. She can edit or revert any line." |
| 7 | 6:15–7:15 | **Approve…** → tick "I confirm…" → Typed signature **Sarah Reid** → tick the 4 **Attestations** → **Approve and sign** → "Approved – the completed form is final" → **Completed form (Word)** → point (don't click) at the small **Copy** button at the top right of the first question card, just under the **Copy answers** box. Stop there: **don't click "Save to clinic record"** (it files into the simulated TM3 and shows a misleading "production converter" note) and **never click "Completed form (PDF)"**. | *(Approve)* "Nothing is issued until she approves. Her name, HCPC number and date go into the form's own declaration, and it's locked with a signed receipt. That's their Word form, completed and approved. You download it and attach it to the patient's TM3 record, as you do with letters. Word forms come back as Word. Or, if you'd rather keep your TM3 letters, every answer has its own Copy button, so the physio pastes each approved section into your TM3 template." |
| 8 | 7:15–8:15 | *One of his providers.* Tab 1 → **Referrer forms** → **Demonstration forms** → card **BODYCARE · Initial Assessment Report** → **Upload this form** → in the file dialog **Cmd+Shift+G** → `~/Projects/Appstackx/clinforms/demo-assets/insurers/` → `bodycare-initial-assessment-report.docx` → **Analyse form** ("16 questions found", "Pre-written demonstration map") → **Review the mapping** → click **Our Ref** and "factors that may delay recovery" ("Clinician opinion") – each highlights its box → **Confirm mapping** → Your name `Practice manager`, tick → **Confirm mapping** | "This is **Bodycare's own Initial Assessment template** – one of the providers you mentioned. They publish it on their website, so I've used it for this demo only; we're not affiliated with Bodycare, and the patient is made up. Their Word form is uploaded once: it finds all 16 boxes and where each answer goes, and your team checks that once. I set this one up before the call – a new form takes about 15–25 seconds to read." |
| 9 | 8:15–9:45 | Tab 2 → **Complete referrer's report form** → **Choose the referrer form** → **BODYCARE · Initial Assessment Report** → **Complete this form** ("9 of 14 answered", Flags 7) → click chip **N-001 · 18/03** (Sources shows the 18 March assessment note) → **Flags**: Our Ref held back; factors delaying recovery, restrictions on hours and number of sessions left for the clinician → **Preview** → ⤢ (Bodycare's layout, DRAFT). Then the tab with the green **Approved** badge (Harrow & Pike) → **Preview** → ⤢ → point at B7, B8, B9. **Don't approve Bodycare** unless he asks (then: Our Ref `DEMO-BC-0001`, answer the opinions, **Mark resolved**, approve as in 7) | "This is your Initial Assessment step. Name, address, date of injury, assessment date and practitioner come from the record – that's your mail-merge. History of injury, physical findings and daily-living restrictions are drafted **only from her assessment note of 18 March** – every paragraph shows that note. Our Ref is Bodycare's own number, so it won't copy the solicitor's reference. Factors delaying recovery, restrictions on hours and the number of sessions weren't written down, so they're left for the physio, never guessed – and her registration number and the date go in only when she approves." Then, on Harrow & Pike: "Same patient, two providers, two structures – each answer goes into that form's own box." |
| 10 | 9:45–10:15 | **Stop sharing** | "Four honest points: the TM3 here is simulated – today it works from an upload of the notes, and a real TM3 export still has to be tested; apart from Bodycare's public template, these are made-up look-alike forms, not your providers'; your RTF templates won't upload as they are – the provider's original blank form is best, or the RTF opened in Word and saved as a Word document; and scanned paper forms aren't supported yet." |
| 11 | 10:15–13:30 | Not sharing | His questions → section E. Answer security out loud. **Don't open "Security & GDPR" on the laptop or on clinforms.co.uk** – both still say "launch from TM3 in the patient's context" under live. If Dell raises it: "That describes the goal once TM3 gives access; today it's an upload." |
| 12 | 13:30–15:00 | Not sharing | **The ask:** "Could you send blank templates for two or three of the providers you mentioned – the original Word or PDF if you still have it, otherwise the RTF opened in Word and saved as a Word document, merge fields and all – I'll take those out – plus one anonymised Initial Assessment note as TM3 prints or exports it? Please put XXXX in place of names, dates of birth, addresses and claim references, rather than deleting the lines, so I can see where TM3 puts them. I'll return them completed for a made-up patient, and we can talk about a short pilot." Agree the next date. (D7) |

**Short of time?** Skip 4's optional part, all of 6, and the Harrow & Pike preview at the end of 9. Never skip 7
(approval is his main point). 9 (Bodycare) needs 8 first – in a hurry do 8 without clicking any question in the
mapping (about 30 s).

## D. Ask Dell (write his answers down)

There is no time slot for all eight. D1 is asked in step 0, D4 at step 1, D7 at step 12 (D2 there too if time). Ask D3, D5, D6 only if
time is left at the end; otherwise put them and D8 in the follow-up email.

1. *(step 0)* Of the providers he listed, which send the most? Roughly how many forms a month across the 11 sites?
2. *(step 12 if time, else follow-up email)* Which go back by email or upload as a document, and which are typed into the provider's website
   (Speed Medical, HCML, 3D Rehab)? Any Word, PDF or scanned forms?
3. *(follow-up email)* Who writes them today, who signs, and does anyone check before they go?
4. *(step 1)* TM3 on the web or desktop? Can you print or save a patient's notes as a PDF? Does the export include
   the appointment list (attendance)? Do you see Settings › Integrations › API?
5. *(follow-up email)* How long does a form take now – and do late reports hold up authorisations or payment?
6. *(follow-up email)* Do any MLCs set data-handling rules for you? Do you have a data protection lead?
7. *(step 12)* Do you still have the original Word or PDF templates, from before they became RTF?
8. *(follow-up email)* Is "Bodycare" Bodycare Clinics in North Tyneside, and "The Physio Network" TPN in London?
   How does Physio Link take reports?

## E. If he asks…

| Question | Answer |
|---|---|
| **Is it live?** | "Yes – on clinforms.co.uk since 10 October, with clinic accounts and two-step sign-in. No clinic uses it with real patients yet; you'd be one of our first five founding clinics." Name no one. |
| **Connect to TM3?** | "Not directly. Today you'd upload the notes as PDF, Word or CSV, however TM3 lets you save them. We haven't tested a real TM3 export yet; that's the first thing the pilot checks. Staff check what was read before it's used. A direct link depends on TM3 giving access – I'd confirm with them before promising anything." Never say "integrated" or "partner". |
| **Scanned or PDF forms?** | "Word and fillable PDF forms fully, in their own layout. Flat PDFs best effort, checked once. Scanned paper forms aren't supported yet – send one and we'll try." |
| **Word in, PDF out?** | "A Word form comes back as Word, a PDF form as PDF. A PDF copy of a Word form isn't available yet – if you need it, tell me." |
| **Where is the data? GDPR?** | "The app runs in London; the database is in the EU today, and we move it to London before any real Blue Heart patient data. Built now: two-step sign-in, invite-only accounts, roles, encryption with a separate key per clinic, an audit log nobody can edit, and you set how long reports are kept. Before real data we sign a data processing agreement – you're the controller, we're the processor – and do the impact assessment." No dates. No certifications (none yet). Automatic deletion: "being switched on". |
| **Who writes the text?** *(only if asked)* | "It's drafted from the notes and every answer cites its note; names, numbers and scores are copied, not drafted; opinions come only from the clinician." If he asks what does the drafting: "Anthropic, under their commercial terms: they don't train on it, and I'll set out their exact retention terms in the data processing agreement. It only gets a minimised extract: no patient name, date of birth, address or contact details. Anthropic will be named as a sub-processor in the agreement." Data leaving the UK: "I'll confirm that in writing with the agreement rather than guess." |
| **Price?** | Ask volume first. "We price per clinic, not per user – all 11 sites and all your clinicians are included. As one of our first clinics it's **£149 a month, fixed for 12 months**, covering up to 150 forms a month, plus a one-off **£250** to set up your main MLC forms and the data-protection paperwork. Monthly, cancel any time." Over ~150 a month: "At that volume it's our Group plan, from £349 a month – we'd agree a founding price after the pilot." Before any payment: "First a free proof of concept – send two or three blank forms and anonymised notes, and I'll return them completed. You'd only pay once you use it with real patients, after the data agreement and UK hosting are in place." Ex VAT (check your VAT status first). Don't discount further. |
| **Time saved?** | "Not measured yet – the pilot measures it. The machine part is about 20 seconds a form; the clinician still reviews." |
| **Files back into TM3?** | "You download it and attach it to the record, as with letters. No automatic filing yet." |
| **"Our templates are RTF in TM3"** | "ClinForms takes Word and PDF forms, so the RTF won't upload as it is. The best start is the blank form each provider sends you. If you only have the RTF, open it in Word and save it as a Word document – once per template. We take the TM3 merge fields out when we set it up. I'd like to test two or three of yours first." |
| **"Can it fill our TM3 templates?"** | "Not inside TM3. There are two ways. ClinForms completes the provider's own form – name, date of birth and therapist from the details in your notes, and the clinical part from the notes. The physio adds her opinions, and staff add the address if your notes don't have it. You attach it to TM3 as now. Or you keep your TM3 merge and paste in each approved section: every answer has a Copy button." Never say it fills the TM3 merge fields. |
| **Initial Assessment reports?** | "Yes. From the IA note it fills the history and mechanism, the presenting complaint, examination findings, outcome scores, diagnosis, plan and number of sessions. It only uses a prognosis if the physio wrote one. Anything else that needs her opinion is flagged for her, and the form can't be approved until she answers it. You've just seen it on Bodycare's form, from Megan's assessment note only." |
| **"Do you have Speed Medical / HCML forms?"** | "No. Bodycare publishes its templates, which is why I could show that one. The others come through their own websites or with your referrals, so we don't have them. Send me the ones you use, and I'll set them up and return them completed for a made-up patient." Never suggest we have or have copied any other provider's form. |
| **Provider websites (3D Rehab, HCML, Physio Med)?** | "From what I can see publicly, some of them take reports through their own website. For those, the questions are set up once and ClinForms gives the answers ready to paste. It doesn't log in or submit. Where they ask you to upload the finished report, as Speed Medical does, you download the approved form and upload it, the same as now." |
| **Address?** | "If your TM3 print shows the address, it comes in with the other details and staff check it. If it isn't there, staff add it. I'd check that in the pilot." |
| **Referrer changes its form?** | "Upload the new version and check it once; versions sit side by side." |

**Don't:** say "AI" unprompted, mention any other clinic, claim a TM3 link, promise dates, or claim time savings.

### E.2 If he asks to see… (checked 20 Oct on the laptop demo; each opens a new report tab)

| He asks | Do (exact labels) | Say |
|---|---|---|
| **A PDF form** | Tab 2 (Megan, Report author **Sarah Reid (PH-DEMO-01)**) → **Complete referrer's report form** → **Choose the referrer form** → **NORTHFIELD ASSURANCE (FICTIONAL)** · Rehabilitation Progress Report · Fillable PDF → **Complete this form** ("12 of 17") → **Preview** → ⤢. **Don't approve** | "A made-up insurer's fillable PDF: the answers go into its own fields, and it's flattened to PDF when approved." Long answers end "(continued on the continuation sheet)" – if he notices: "Long answers carry over to a continuation sheet." |
| **A case manager's form** | Tab 2 → **All patients** → **Brooks, Daniel (Mr)** → **Complete referrer's report form** (launched as Tom Ellis) → **Choose the referrer form** → **KINGSWAY CASE MANAGEMENT (FICTIONAL)** · Return to Work Assessment → **Complete this form** ("14 of 18") | "A made-up case manager's return-to-work form, a different patient – same flow: from the notes, opinions left for the clinician." |
| **A provider or insurer website (portal)** | Tab 2 → **All patients** → **Lane, Rebecca (Mrs)** → Report author **Sarah Reid** → **Complete referrer's report form** → **Choose the referrer form** → **Example portal questions (illustrative)** → **Complete this form** ("7 of 8") → **Copy all answers** | "Example questions we wrote ourselves, not an insurer's. The questions are set up once, the answers are ready to paste, and prognosis is left for the clinician. It doesn't log in or submit." |
| **The IA test** | Don't run it live (no prepared answers, demo mode). If he insists: **Stop sharing** Chrome → share a Finder window on `~/Projects/Appstackx/clinforms/demo-assets/outputs/blue-heart/ia-test/` (that folder only) → open the Word file | "That's from this week's test: a made-up provider's Initial Assessment form and a made-up patient, completed from one IA note and approved. I'll send it with my follow-up." |
| **Another MLC's form (made up)** | Tab 1 → **Referrer forms** → "Try a new form" → Meridian Claims Services · Physiotherapy Discharge Report · Word → **Analyse this form** → **Analyse form** → **Review the mapping** → **Confirm mapping** → name `Practice manager`, tick → **Confirm mapping** → Tab 2 → **Complete referrer's report form** → **Choose the referrer form** → **Meridian …** → **Complete this form** ("9 of 14") → **Preview**. **Don't approve** | "A made-up MLC's discharge report: prognosis and restrictions asked as tick boxes and questions in its own structure; opinions wait for the clinician again." |
| **A scanned form** | Nothing to show | "Scanned paper forms aren't supported yet – send one and we'll try." |

## F. If something breaks

| Problem | Do this |
|---|---|
| Port in use | `lsof -nP -iTCP:3000 -sTCP:LISTEN`, check it's the old demo (`ps -o command= -p <PID>` shows `next-server`), stop it, then `cd ~/Projects/Appstackx/clinforms-demo && npm run demo:red -- --skip-build` |
| A passcode box or "live" wording appears | *(Laptop only.)* On localhost: Ctrl+C in Terminal, `cd ~/Projects/Appstackx/clinforms-demo && npm run demo:red -- --skip-build`. On clinforms.co.uk the header always says "Demo mode · passcode for live" – ignore it and never type a passcode |
| Answers blank | Use Megan Hart opened from Tab 2 only (prepared answers: Harrow & Pike, Bodycare, Meridian, Northfield, Ashcroft) |
| Clicked "Completed form (PDF)" by mistake | It hangs ~16 s then says a PDF copy isn't available. Say: "Word forms come back as Word today." |
| Laptop demo dies | Use **clinforms.co.uk** (checked 20 Oct, same story): header **Interactive demo** → `/reports`; `https://clinforms.co.uk/pms-sandbox` → **Hart, Megan (Ms)** → same clicks as C. **Never** enter a passcode or use Request access; don't open Rebecca Lane there. |
| Internet drops | The laptop demo needs no internet – just re-join the call |
| Anything else | Stop sharing Chrome; share the Finder folder `demo-assets/outputs/blue-heart/`: the signed Harrow & Pike Word file (opens in Pages) and the numbered screenshots. "Let me show you the output from the run I did earlier." |

## G. After the call

Tell Claude Dell's answers (referrers, volumes, Word/PDF/scanned/portals, TM3 export, who signs, next step and
date). They go into `memory/projects/blue-heart-clinics.md` §7, and Claude drafts the follow-up email.
