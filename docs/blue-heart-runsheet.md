# Blue Heart call – run sheet (15 min) · internal, never share this window

Dell Baines, owner, Blue Heart Clinics (11 sites, uses TM3). He wants to see ClinForms complete "the different MLC
and insurer forms we receive", with clinicians reviewing and approving before anything is sent, and to ask questions.
Checked Tue 20 Oct: the frozen demo folder passes its check, and the whole story below ran end to end on a test
browser (every step under 1.2 s). The public site clinforms.co.uk runs the same story (fallback). Full detail,
prices and the reply email: `docs/demo-blue-heart.md`.

**Before the day:** check your Sent mail for what you last sent Dell (video? prices?). Decide the year-2 price,
VAT and the proof-of-concept turnaround (`docs/demo-blue-heart.md` §0).

---

## A. Set up (10 min)

1. **Quiet Mac:** Do Not Disturb on; quit Slack, Mail, WhatsApp, Messages; phone on silent.
2. **Restart the demo.** The old server from 13 Oct may still be running on port 3000: press **Ctrl+C** in its
   Terminal window. If you can't find it: `lsof -nP -iTCP:3000 -sTCP:LISTEN`, then `kill <PID>`. Then:
   ```bash
   cd ~/Projects/Appstackx/clinforms-demo
   npm run demo:check                  # "Demo assets OK: 7 maps, 4 answer files, 6 form files …"
   npm run demo:red -- --skip-build
   ```
   Wait for `ClinForms demo (local only): http://localhost:3000/reports · drafting mode demo`. Minimise Terminal.
3. **Chrome, "ClinForms demo" profile.** One window about 1440 px wide, **Cmd+0**, **Cmd+Shift+B** (hide bookmarks).
4. Open `http://localhost:3000/reports`. Header must say **Demo mode**. Then **Demo tools → Reset demo → Reset
   demo**. You should see "Demo reset." and "No forms completed yet". (This clears the old shoulder-patient reports
   and insurer uploads.) **Don't** pre-upload Meridian – that's done live.
5. **Two tabs:** Tab 1 `http://localhost:3000/reports` · Tab 2 `http://localhost:3000/pms-sandbox` → **Hart, Megan (Ms)**.
6. **TextEdit note (not shared)** with the clinician's three opinions, to paste in step 5:
   - B7: `In my opinion Ms Hart has made a good recovery. I expect the remaining intermittent neck ache to settle over the next three to six months with her home exercise programme.`
   - B8: `In my opinion there are no restrictions on work or daily activities. She may need short breaks from prolonged sitting or driving while the ache settles.`
   - B9: `In my opinion no further physiotherapy is needed. She should continue her home exercise programme and seek a review if symptoms worsen.`
7. **Backup ready:** in the same Chrome profile open `https://clinforms.co.uk` once, click **Reject** on the cookie
   bar, close the tab. Finder window (not shared) on `~/Projects/Appstackx/clinforms/demo-assets/outputs/blue-heart/`.

## B. Rehearse (15 min)

1. Run section C once **out loud with a timer**. Aim for about 8–9 minutes of demo.
2. After **Write in my own voice**, read B2, B3 and B5 once – a few sentences are stiff ("On 18/03/2026: forward head
   posture…"). That's fine: the clinician can edit any line.
3. **Reset for the call:** Tab 1 → **Demo tools → Reset demo**, close extra tabs, put the two tabs back as in A.5.
   Keep the server running.

## C. In the meeting (15 min)

Share **only the Chrome window**. Say "completed from your notes", "shows the note it came from", "your clinician
approves" – never "AI". Each **Complete referrer's report form** opens a new tab: Tab 3 = Harrow & Pike, Tab 4 = Meridian.

| # | Time | Do (exact labels) | Say |
|---|---|---|---|
| 0 | 0:00–1:30 | Not sharing | "Thanks Dell. In one line: ClinForms completes each MLC's or insurer's **own** form, in its own layout, from the TM3 registration details and notes – and nothing goes out until your clinician approves it. First: which MLCs send you the most forms, roughly how many a month, and do they come as Word or PDF?" *(Listen, write it down.)* "Everything I'll show is fictional – a made-up patient, made-up MLC and insurer forms, and a simulated TM3, running on my laptop." |
| 1 | 1:30–2:15 | **Share Chrome.** Tab 1 home: **Demo mode**; cards "Simulated TM3 connected", "Notes upload – available now", "Direct TM3 connection – subject to TM3 providing access". Tab 2: banner "Simulated TM3 sandbox – demo data, not affiliated with TM3"; Ms Megan Hart, solicitor referral, ref HP/RTA/2291 | *(TM3)* "This is a **simulated** TM3 – we're not connected to TM3. Today you'd upload the notes as TM3 prints or exports them. A direct link depends on TM3 giving access, and we won't claim it until they do." |
| 2 | 2:15–3:00 | Right panel: Report author **Sarah Reid (PH-DEMO-01)** → **Complete referrer's report form** → "Imported from Simulated TM3: 10 notes · 11 appointments · 6 scores"; "Calculated by code from the record" (attendance 10 of 11; NDI 42% → 24% → 12%); "Data checks" | "Nobody retypes anything – it reads her registration details and notes. Dates, attendance and scores are counted, not written. And it flags things an MLC will ask about that aren't in the notes, like pre-accident history." |
| 3 | 3:00–3:45 | **Choose the referrer form** → Harrow & Pike Medico-Legal · Treating Physiotherapist Report · Word is already selected ("Matches the referrer on the referral") → **Complete this form** → "12 of 16 answered", red "8 items to resolve before approval"; right panel **Preview**: "DRAFT – awaiting clinician approval" | *(Different forms, original layout)* "This is a made-up MLC's own Word form. The answers go into its own table cells – the layout doesn't change." If he asks about the "Prepared demo draft" badge: "These were drafted from her notes earlier and saved so the demo runs offline. Live, it takes a few seconds." |
| 4 | 3:45–4:30 | Scroll to **F-12 B5. Current symptoms and progress** → click chip **N-010 · 07/07** → **Sources** tab shows the note → **Flags 8** tab: F-13 to F-16 "Gap – not in the record" | *(Review)* "Every sentence shows the note it came from. Prognosis, restrictions and recommendations are opinions – nobody recorded them, so they're left for the clinician, never guessed." *Optional (30 s):* in F-12 type ` She was reviewed again on 14/08/2026.`, click away → "Blocked – check required" → **Revert to the draft**. "Add a date the notes don't support and approval is blocked." |
| 5 | 4:30–5:45 | **F-13 B6** (maximum medical improvement): tick **No**. Paste the three opinions into **F-14 B7**, **F-15 B8**, **F-16 B9** (badge "Clinician – Your own words"). Wait 1 s → orange **Mark resolved** on each of the 4 → "Ready for your approval", 16 of 16 | *(Amend)* "This is the clinician's part. Opinions only ever come from the clinician, and the record shows who wrote what." |
| 6 | 5:45–6:15 | Top banner → **Write in my own voice** | "It's the treating physio's report, so it reads in her voice. She can edit or revert any line." |
| 7 | 6:15–7:15 | **Approve…** → tick "I confirm…" → Typed signature **Sarah Reid** → tick the 4 **Attestations** → **Approve and sign** → "Approved – the completed form is final" → **Completed form (Word)** → **Save to clinic record** | *(Approve)* "Nothing is issued until she approves. Her name, HCPC number and date go into the form's own declaration, and it's locked with a signed receipt. That's their Word form, completed and approved, saved back to the record." **Never click "Completed form (PDF)".** |
| 8 | 7:15–8:30 | *His example.* Tab 1 → **Referrer forms** → "Try a new form" → Meridian Claims Services · Physiotherapy Discharge Report · Word → **Analyse this form** → **Analyse form** ("17 questions found") → **Review the mapping** → click "In your opinion, what is the likely long-term outcome for this claimant?" (highlighted in the form, "Clinician opinion") → **Confirm mapping** → Your name `Practice manager`, tick "I have checked…" → **Confirm mapping** | "Each referrer's form is uploaded once. It finds every question and where the answer goes, and your team checks that once. I prepared this reading earlier – a new form takes about 15–25 seconds to read. After that it's reused for every patient from that referrer." |
| 9 | 8:30–9:45 | Tab 2 → **Complete referrer's report form** → **Choose the referrer form** → **Meridian … Physiotherapy Discharge Report** → **Complete this form** ("9 of 14") → **Preview** → ⤢. Then Tab 3 (Harrow & Pike) → **Preview** → ⤢ → point at B7, B8, B9. **Don't approve Meridian** | "Your example: same patient, same notes, two structures. Harrow & Pike asks prognosis, functional restrictions and treatment recommendations as B7, B8 and B9 in a table. Meridian asks about 'ability to carry out normal daily activities', 'Is any further treatment or investigation recommended?' with Yes/No tick boxes, and 'the likely long-term outcome'. Each answer goes into that form's own box, and the opinion questions wait for the clinician again. It also won't copy the solicitor's reference into Meridian's claim number." |
| 10 | 9:45–10:15 | **Stop sharing** | "Three honest points: the TM3 here is simulated – today it works from an export or upload; these are made-up look-alike forms, not your MLCs'; and scanned paper forms aren't supported yet." |
| 11 | 10:15–13:30 | Not sharing | His questions → section E. Answer security out loud; **don't open the "Security & GDPR" page** (its wording is older than the live site). |
| 12 | 13:30–15:00 | Not sharing | **The ask:** "Could you send two or three blank forms you get most, plus anonymised notes for one case as TM3 exports them – no names, dates of birth, addresses or claim references? I'll return them completed for a made-up patient, and we can talk about a short pilot." Agree the next date. |

**Short of time?** Skip the optional part of 4 and all of 6. Never skip 7 (approval is his main point) or 9 (his example).

## D. Ask Dell (write his answers down)

1. Roughly how many MLC and insurer forms a month across the 11 sites? Which 3–5 referrers send the most?
2. Do they come as Word, PDF, scanned, or through the referrer's website?
3. Who writes them today, who signs, and does anyone check before they go?
4. TM3 on the web or desktop? Can you print or save a patient's notes as a PDF? Do you see Settings › Integrations › API?
5. How long does a form take now – and do late reports hold up authorisations or payment?
6. Do any MLCs set data-handling rules for you? Do you have a data protection lead?

## E. If he asks…

| Question | Answer |
|---|---|
| **Is it live?** | "Yes – on clinforms.co.uk since 10 October, with clinic accounts and two-step sign-in. No clinic uses it with real patients yet; you'd be one of our first five founding clinics." Name no one. |
| **Connect to TM3?** | "Not directly. Today you upload the notes as TM3 prints or exports them, staff check what was read, and that's the record the form is built from. A direct link depends on TM3 giving access – I'd confirm with them before promising anything." Never say "integrated" or "partner". |
| **Scanned or PDF forms?** | "Word and fillable PDF forms fully, in their own layout. Flat PDFs best effort, checked once. Scanned paper forms aren't supported yet – send one and we'll try." |
| **Word in, PDF out?** | "A Word form comes back as Word, a PDF form as PDF. A PDF copy of Word forms is coming." |
| **Where is the data? GDPR?** | "The app runs in London; the database is in the EU today, and we move it to London before any real Blue Heart patient data. Built now: two-step sign-in, invite-only accounts, roles, encryption with a separate key per clinic, an audit log nobody can edit, and you set how long reports are kept. Before real data we sign a data processing agreement – you're the controller, we're the processor – and do the impact assessment." No dates. No certifications (none yet). Automatic deletion: "being switched on". |
| **Who writes the text?** *(only if asked)* | "It's drafted from the notes and every answer cites its note; names, numbers and scores are copied, not drafted; opinions come only from the clinician." If he asks what does the drafting: "Anthropic's model, under their commercial terms – they don't train on the data and delete it within 30 days. It only gets a minimised extract – no name, date of birth or address – and Anthropic will be named as a sub-processor in the data processing agreement." Data leaving the UK: "I'll confirm that in writing with the agreement rather than guess." |
| **Price?** | Ask volume first. "We price per clinic, not per user – all 11 sites and all your clinicians are included. As one of our first clinics it's **£149 a month, fixed for 12 months**, covering up to 150 forms a month, plus a one-off **£250** to set up your main MLC forms and the data-protection paperwork. Monthly, cancel any time." Over ~150 a month: "we'd size the plan after the pilot." Ex VAT (check your VAT status first). Don't discount further. |
| **Time saved?** | "Not measured yet – the pilot measures it. The machine part is seconds; the clinician still reviews." |
| **Files back into TM3?** | "You download it and attach it to the record, as with letters. No automatic filing yet." |
| **Insurer websites?** | "For portals it gives answers ready to paste. It doesn't log in or submit." |
| **Referrer changes its form?** | "Upload the new version and check it once; versions sit side by side." |

**Don't:** say "AI" unprompted, mention any other clinic, claim a TM3 link, promise dates, or claim time savings.

## F. If something breaks

| Problem | Do this |
|---|---|
| Port in use | `lsof -nP -iTCP:3000 -sTCP:LISTEN`, stop it, `npm run demo:red -- --skip-build` again |
| A passcode box or "live" wording appears | Ctrl+C in Terminal, `npm run demo:red -- --skip-build` |
| Answers blank | Use Megan Hart opened from Tab 2 only (prepared answers: Harrow & Pike, Meridian, Northfield, Ashcroft) |
| Clicked "Completed form (PDF)" by mistake | It hangs ~16 s then says a PDF copy isn't available. Say: "Word forms come back as Word today." |
| Laptop demo dies | Use **clinforms.co.uk** (checked 20 Oct, same story): header **Interactive demo** → `/reports`; `https://clinforms.co.uk/pms-sandbox` → **Hart, Megan (Ms)** → same clicks as C. **Never** enter a passcode or use Request access; don't open Rebecca Lane there. |
| Internet drops | The laptop demo needs no internet – just re-join the call |
| Anything else | Stop sharing Chrome; share the Finder folder `demo-assets/outputs/blue-heart/`: the signed Harrow & Pike Word file (opens in Pages) and the numbered screenshots. "Let me show you the output from the run I did earlier." |

## G. After the call

Tell Claude Dell's answers (referrers, volumes, Word/PDF/scanned/portals, TM3 export, who signs, next step and
date). They go into `memory/projects/blue-heart-clinics.md` §7, and Claude drafts the follow-up email.
