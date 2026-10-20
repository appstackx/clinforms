# Blue Heart Clinics – call pack (internal)

> **Internal – for Khuram only. Never send this file or have it on screen during the call.** It names our drafting
> provider and internal limits. Dell only ever sees the app, the completed forms and the email in §email.
> Run sheet for the call itself (one page): `docs/blue-heart-runsheet.md`.

| | |
|---|---|
| **Call** | **Dell Baines**, owner and director, **Blue Heart Clinics** (11 sites, main base Dunstable; uses **TM3**). 15 minutes: he asks questions, you show a demo. Date and time: one of the slots in §email, once he picks |
| **His words (email pasted Tue 20 Oct)** | "exactly what I have been looking for to help us complete the different MLC and insurer forms we receive, while allowing our clinicians to review and approve the information before it is sent" · "seeing ClinForms in action and discussing how it could fit into Blue Heart Clinics' reporting workflow" |
| **His five questions (06 Oct)** | Q1 different MLC/insurer forms · Q2 original layout · Q3 TM3 details and notes without retyping · Q4 clinician review, amendment and approval · Q5 secure and GDPR compliant. Plus his example: prognosis, functional restrictions and treatment recommendations asked in different structures by different referrers |
| **Product name** | **ClinForms** – he used it himself. The 6:15 video called it "AppStackX Reports"; if he mentions it: "that was the working name" |
| **Demo** | The frozen local demo you already know: `~/Projects/Appstackx/clinforms-demo`, `npm run demo:red -- --skip-build`, demo mode, no internet needed. Fictional patient **Ms Megan Hart** (road traffic accident, whiplash, solicitor referral). **Harrow & Pike** (made-up MLC, Word) end to end with approval; **Meridian** (made-up insurer/claims handler, Word) uploaded live for his example |
| **Checked 20 Oct (headless Chromium, 1440×900)** | Folder at tag `red-demo-2026-10-13`, clean, built; `npm run demo:check` passes; 22 steps passed (Megan on Harrow & Pike end to end; Meridian upload, map and completion; Northfield; Daniel Brooks on Kingsway; portal questions; Reset demo); every wait under 1.2 s. No "AI", vendor or model words on any screen visited. The public site clinforms.co.uk ran the same story read-only (fallback) |
| **Not yet done** | **Your own rehearsal** in the "ClinForms demo" Chrome profile (run sheet B). The old demo server from 13 Oct was still running on port 3000 at 18:00 on 20 Oct – restart it (run sheet A.2) |
| **Never mention** | Any other clinic or prospect. Never say "AI" unprompted. Never claim a TM3 link or partnership |

## The one-line answer

> "Yes. ClinForms completes each MLC's or insurer's own form – Word or PDF – in its own layout, from the patient's
> registration details and notes. Every answer shows the note it came from, opinions are left for the clinician, and
> nothing is issued until a clinician approves it. Which MLCs send you the most forms?"

---

## 0. Decide before the call (Khuram)

| # | Decision | Why it matters | Suggestion (yours to change) |
|---|---|---|---|
| 1 | **What did you last send Dell?** (the 6:15 video? the `/demo` link? any price?) | His email says "Thank you for getting in touch" and names ClinForms – so he has seen something recent. Memory has no record of what | Check Sent mail; tell Claude so memory is right |
| 2 | **Year-2 price at ~125 forms/month** | Founding price covers 12 months and up to 150/month. List price at 100+/month is Group "from £349" | "After 12 months, the plan that fits your actual volume – agreed from the pilot numbers." Don't promise £149 or £199 for ever unless you mean it |
| 3 | **VAT** | AppstackX Ltd's VAT status is not recorded. Physio clinics usually can't reclaim VAT: £149 would cost him about £179 | Say "ex VAT" only if registered |
| 4 | **Proof of concept: free? how fast?** | Earlier drafts offered completed drafts from his anonymised forms at no cost, "within 7–10 days" (whether sent is unconfirmed). You have a full-time day job | Free; "within [X] working days of receiving them" – pick X (§10) |
| 5 | **His blank forms before the call?** (optional paragraph in §email) | Showing his own form on the call needs live reading and live drafting on your laptop – not rehearsed on 20 Oct | Leave it out unless you have an evening free before the call (§10.4) |
| 6 | **DPA** | No data processing agreement or impact assessment is drafted yet, but the live `/security` page says they are "available to clinics on request" | If he asks: "I'll send it with the pilot proposal." Get one drafted before promising a date |

UK clocks go back on **Sun 25 Oct**: a Monday 26 Oct slot is GMT (memory times are UTC; BST = UTC+1 until then).

---

## 1. Support matrix for Blue Heart's referrers

### 1.1 By referrer type

Blue Heart's referrers, from its public website (research 06 Oct): PMI **AXA Health, Aviva, Vitality, WPA**;
personal-injury rehab and case-management networks **10 Bridge Physio, 3D Rehabilitation, HCML, Physio-Link,
PhysioMed, Speed Medical, The Physio Network, The Treatment Network**. Which of these send their own forms, and in
what format, is **unknown – ask him** (run sheet D).

| Referrer type | How their forms probably arrive | What ClinForms does today | Shown on the call |
|---|---|---|---|
| **MLCs / medico-legal companies** (his main ask) | Their own Word or PDF form; some networks take reports through their own websites [unverified] | Completes the referrer's own form in its own layout; opinions only from the clinician; approval before issue | **Harrow & Pike** (Word), end to end |
| **Case managers / rehab networks** | Word or PDF forms (return-to-work, progress, discharge) [unverified] | Same | **Kingsway** Return to Work Assessment – backup (b) |
| **Insurers and claims handlers** | Their own Word or PDF form | Same | **Meridian** Physiotherapy Discharge Report (Word) for his example; **Northfield** (fillable PDF) – backup (a) |
| **PMI: AXA Health, Vitality, WPA** | No public physio form found – provider portals [our research] | **Portal question set:** the portal's questions set up once, answers drafted and copied out ("Copy all answers"). No login, no submission | Example portal questions – backup (c) |
| **PMI: Aviva** | Its public claim form CM016 is the **patient's and GP's** form, not the physio's [our research] | Patient details only, approved as a checked prefill; the clinic never signs it | Not shown (only if he asks) |
| **Solicitors direct** | Letters or their own forms | Same as MLCs | Megan's record is a solicitor referral |

### 1.2 By file type

| Form or notes | Today (live product) |
|---|---|
| **Word (.docx)** | Fully supported: answers go into the form's own tables, placeholders, content controls and tick boxes, original layout. **Comes back as Word only** – no PDF copy of a Word form yet (no converter on the live service; none on your Mac either) |
| **Fillable PDF** | Fully supported: filled in its own fields and flattened to PDF on approval |
| **Flat PDF** (no fields) | Best effort: text placed at the mapped positions (continuation sheet if long). Checked once |
| **Scanned PDF** | **Not supported yet** (the live site says so). Biggest risk if his MLCs send scans – "send one and we'll try" |
| Old Word .doc / password-protected PDF | Refused with a fix: "Save As .docx" or send an unprotected copy |
| Form size | Up to 2.5 MB per form file |
| **Notes in** | Upload the notes as the clinic system prints or exports them: PDF with a text layer, Word, CSV, text or pasted text. Staff check what was read before the record is built. Scanned notes are refused. Up to 2.5 MB |
| **TM3** | **No direct link.** No public TM3 API or partner programme found. A TM3 admin screen for API tokens exists (Settings › Integrations › API, per a university guide), but what it gives access to is unconfirmed – it may not include clinical notes. Whether TM3 can print or save one patient's notes as a PDF is **not confirmed** by any public source – ask Dell |
| **Back into TM3** | Download the completed form and attach it to the record by hand. "Save to clinic record" in the demo only works on the **simulated** TM3 |
| Set-up per form | Uploaded once, read in about 15–25 s, checked once by staff, reused for every patient; a new version sits alongside the old one |

---

## 2. What the demo can show

All forms are made-up look-alikes marked "(fictional)". Prepared answers exist **only** for these pairs – don't mix
them: **Megan Hart** with Harrow & Pike, Meridian, Northfield or Ashcroft · **Daniel Brooks** with Kingsway or
Northfield · **Rebecca Lane** with the portal questions or Bupa.

| Referrer (fictional) | Form | Type | Where | Use on the call |
|---|---|---|---|---|
| Harrow & Pike Medico-Legal | Treating Physiotherapist Report (16 questions) | Word | Library | **Main:** Megan end to end – review, sources, flags, clinician opinions, own voice, approval, Word download (don't click "Save to clinic record" on the call – §5) |
| Meridian Claims Services | Physiotherapy Discharge Report (17 found, 14 to answer) | Word with content controls and tick boxes | "Try a new form" | **His example:** uploaded live, map checked, Megan completed to preview. Don't approve (claim reference and reason for discharge need staff/clinician) |
| Northfield Assurance | Rehabilitation Progress Report (17) | Fillable PDF | Library | Backup (a) if he asks about PDF. Long answers end "(continued on the continuation sheet)" – looks clunky. Don't approve locally |
| Kingsway Case Management | Return to Work Assessment (18) | Word, case manager | Library | Backup (b) with Daniel Brooks (launched by Tom Ellis) – 14 of 18 |
| Example insurer portal | Example portal questions (illustrative) (8) | Portal | Library | Backup (c) with Rebecca Lane: 7 of 8, prognosis left for the clinician, "Copy all answers" |
| Ashcroft Medical Reporting | Physiotherapy Update Report | Flat PDF | "Try a new form" | **Not verified to the end on 20 Oct – don't use** |
| Bupa (public form) | Therapies management form | Fillable PDF | "Demonstration forms" (upload from `clinforms/demo-assets/insurers/`) | Backup (d) only. Bupa isn't one of his insurers – prefer the portal questions for PMI |

Click paths for the backups (a)–(c): run sheet E.2.

There is no employer form. Don't scroll down to "Demonstration forms" unless he asks about PMI: those cards are public
insurer forms (Aviva, Allianz…), not his.

---

## 3. Before the call

Full steps: run sheet A (10 min) and B (15 min). Key points:

- **Restart the demo server** (the 13 Oct one was still on port 3000 at 18:00 on 20 Oct), from
  `~/Projects/Appstackx/clinforms-demo`, with `npm run demo:red -- --skip-build`. Don't `git pull`, rebuild or move
  the tag there – the RED freeze is over, but the folder stays as rehearsed.
- **Same Chrome profile and the same address** (`http://localhost:3000`) for rehearsal and call – maps and reports
  live in that browser's storage for that address.
- **Reset demo** after rehearsal, so no old reports or uploaded insurer forms show. Don't pre-upload Meridian.
- **TextEdit note** with the three clinician opinions to paste (run sheet A.6) – typing them live takes 1–2 minutes.
- **Public site backup:** visit `https://clinforms.co.uk` once in the demo profile and click **Reject** on the cookie
  bar, so it doesn't cover the screen if you need the fallback.
- **Fallback files** (made 20 Oct, gitignored, not in git): `~/Projects/Appstackx/clinforms/demo-assets/outputs/blue-heart/`
  – the approved Harrow & Pike Word file (opens in Pages) and 10 numbered screenshots (data check → review → source →
  flags → clinician opinion → preview → approve dialog → approved → Meridian map → Meridian preview).

---

## 4. Machine times (measured 20 Oct, Mac load 3.4–5.0)

| Step | Time |
|---|---|
| Launch from the simulated TM3 → data check | 0.4–0.9 s |
| "Complete this form" → review | 1.0–1.1 s |
| "Analyse form" (Meridian, prepared reading) | 0.15 s |
| "Confirm mapping" | ~1.2 s |
| Larger preview | 0.1 s |
| "Approve and sign" | 0.08 s |
| Word download | 0.07 s |
| "Save to clinic record" | 0.3–0.6 s |
| "Copy all answers" | 0.5 s |

The core path took 34.5 s of script time (about 12 s of it deliberate pauses). The ~9 minutes of demo on the call is
talking and typing, not waiting. Talking times in the run sheet are estimates.

---

## 5. Labels on screen – how to frame them

| On screen | What it is | Say if asked |
|---|---|---|
| "Prepared demo draft (09/10/2026)" (every review) | The answers were drafted from these notes earlier and saved, so the demo runs offline | "These were drafted from her notes earlier and saved so the demo runs offline. Live, a form like this takes about 20 seconds to draft." (Measured live: 15–30 s per form, `memory/sources/cv-live.md`) |
| "Prepared demo reading" + "How it was analysed: Prepared demo reading · <today> · 11.1 s" (Meridian map) | The reading was prepared earlier; the timestamp is today's but the 11.1 s is the recorded one, so it looks live | Say up front: "I prepared this reading earlier; a new form takes about 15–25 seconds to read live." |
| "Simulated TM3 sandbox – demo data, not affiliated with TM3" | The made-up clinic system | "We simulate TM3 for demos; we're not connected to TM3." |
| "Direct TM3 connection – subject to TM3 providing access" (home card) | Honest status | "Exactly – it depends on TM3." |
| "Demo mode" (header) | No live drafting | "It's running on my laptop in demo mode." |
| "FACT-attendance", chips like "N-010" / "A-005", "sim-pat-001", an "Integration log" on the data step | Internal record IDs | "Those are record IDs – each note and appointment has one." |
| After "Save to clinic record": "PDF conversion runs on the production converter…" / "The PDF copy is made on the production converter; the Word file was filed." | **Misleading:** there is no Word→PDF converter anywhere yet, and filing only works into the simulated TM3 | **Don't click "Save to clinic record" on the call** (run sheet step 7). If clicked by mistake: "Ignore the converter note – a PDF copy of a Word form isn't switched on yet, and in your clinic you'd attach the file in TM3 yourself." |
| "Completed form (PDF)" button after approving a Word form | Looks enabled; clicking hangs ~16 s then says no PDF copy is available | **Never click it** |
| Own-voice banner example "On 01/10/2026 Sarah Reid recorded that loading needs progressing…" | The example sentence comes from a different made-up case | Ignore |
| A few stiff own-voice sentences (B2 "On 18/03/2026: forward head posture…", B3 mixes "I explained" with "treatment recorded by Sarah Reid and Tom Ellis") | Cosmetic | "The clinician edits any line before approving." |
| "Blocked – check required" for about half a second after typing an opinion | Checks catching up | Wait a moment before "Mark resolved" |
| "Page  of " in the Word preview footer | The page numbers don't render in the browser preview; the real file has them | Ignore |
| "Security & GDPR" page / "Security & data protection" card – on the laptop **and** on clinforms.co.uk (`/reports/security`) | Both still say "launch from TM3 in the patient's context" under live (main `src/modules/medreport/ui/screens/security/security-screen.tsx:70`); the laptop one also says "UK hosting" in the present tense | **Don't open "Security & GDPR" on the laptop or on clinforms.co.uk.** Answer security out loud (§8). If Dell raises it: "That describes the goal once TM3 gives access; today it's an upload." |

---

## 6. Caveats – say them before he finds them

- The forms are **made-up look-alikes**, not his MLCs' forms; the patient and clinic are fictional.
- The TM3 shown is **simulated**. Today it works from an upload of the notes (PDF, Word or CSV); a real TM3 export
  hasn't been tested yet, and there is no TM3 link.
- The form reading and the answers were **prepared earlier** and replayed so the demo runs offline – say it at the
  start (run sheet step 0): live, a form takes about 20 seconds.
- **Word forms come back as Word**; a PDF copy of a Word form isn't switched on yet. PDF forms come back as PDF.
- **Scanned paper forms aren't supported yet**; flat PDFs are best effort.
- In the demo, reports live in the browser and anyone could type a clinician's name to approve. The live version has
  sign-in with two-step, roles, and only clinicians with signing rights and an HCPC number can approve.
- Approval in the **live** clinic workspace can't be shown yet – show approval in the laptop demo only.
- Time saved and review time with real clinicians **have not been measured**.

---

## 7. Likely questions – honest answers

| He asks | Answer |
|---|---|
| **Different MLC forms? (Q1)** | Yes. Each form is uploaded once, read, checked once by your staff, and reused for every patient from that referrer. Versions sit side by side |
| **Original layout? (Q2)** | Word and fillable PDF: yes, in their own layout. Flat PDF: best effort. Scanned: not yet. Word comes back as Word for now |
| **TM3 without retyping? (Q3)** | "Today you'd upload the notes as PDF, Word or CSV, however TM3 lets you save them. We haven't tested a real TM3 export yet; that's the first thing the pilot checks. Staff check what was read before it's used. A direct link depends on TM3 giving access to clinical notes – I've seen TM3 has an API-token screen for approved integrations, and I'd want to confirm with them what it allows before promising anything." |
| **Review and approval? (Q4)** | Every answer shows its note; dates and figures the note doesn't support block approval; gaps are flagged, not guessed; opinions only from the clinician; the clinician can edit or revert any answer. It stays DRAFT until a clinician approves with name, HCPC number, typed signature and attestations; a signed receipt locks the content. On the live version every approval and final download is logged |
| **Secure / GDPR? (Q5)** | §8 |
| **Is it live?** | Yes – clinforms.co.uk since 10 October, clinic accounts with two-step sign-in. No clinic uses it with real patients yet |
| **Can we start with real patients?** | After the data processing agreement and impact assessment are signed and the database is in London. A proof of concept on anonymised data can start now |
| **Who else uses it?** | "You'd be one of our first five founding clinics." Name no one |
| **What does the drafting? (only if asked)** | "Anthropic, under their commercial terms: they don't train on it, and I'll set out their exact retention terms in the data processing agreement. It only gets a minimised extract: no patient name, date of birth, address or contact details. Anthropic will be named as a sub-processor in the agreement." (No source for any retention period; the zero-data-retention arrangement is not done – `memory/context/compliance.md`. Clinician names are sent.) If he asks whether data leaves the UK: "The drafting service is a US company; I'll set out exactly where it's processed in the agreement rather than guess." (Its processing location is not confirmed as UK/EU – don't claim UK-only) |
| **Time saved?** | Not measured – the pilot measures it. Machine time: about 15–30 s to draft a form, 15–25 s to read a new form. Don't quote savings |
| **Does it file back to TM3?** | Download it and attach it to the record, as with letters |
| **Online portals?** | Answers ready to paste. It doesn't log in or submit |
| **Several sites and users?** | All included: owner, administrator, clinician and staff roles |
| **Does it do MedCo initial reports / legal sign-off wording?** | It isn't a MedCo initial-report tool. It completes the forms clinics receive. The statement-of-truth wording hasn't been legally reviewed – don't claim it |
| **Is it clinical decision support?** | No – it's a documentation tool; the clinician makes every clinical judgement |

---

## 8. Data protection – built today vs before real data

Say: "Built now" for the first table; "before any real patient data" for the second. **No dates.**

**Built and live on clinforms.co.uk (since 10 Oct):**

| Measure | Detail |
|---|---|
| Invite-only accounts | A clinic is created after its data processing agreement is signed; no public sign-up |
| Two-step sign-in, required | Password plus an authenticator code; can't be switched off |
| Roles | Owner, administrator, clinician, staff; only an owner, administrator or clinician with signing rights and an HCPC number can approve (the number is format-checked, not checked against the HCPC register) |
| Encryption | HTTPS everywhere; reports, form maps and files encrypted at rest (AES-256-GCM) with a separate key per clinic |
| Audit log | Sign-ins, user and role changes, each approval and final download; can't be edited or deleted; holds no patient data |
| Retention | The clinic sets how long reports are kept (30 days to 10 years). **Automatic deletion is "being switched on"** (live site wording) – don't say it's running |
| Data minimisation | Before drafting: name replaced, age instead of date of birth, no address or contacts. Names, dates of birth and references are put on the form by code, never drafted |
| Drafting off by default | A new clinic can't send notes for drafting until its owner switches it on, after the agreement |
| Where | The app runs in **London**; the database and files are in the **EU** (Cloudflare, EU jurisdiction) |

**Before real Blue Heart patient data (not done yet):**

| Item | Status |
|---|---|
| Data processing agreement (Blue Heart = controller, AppstackX Ltd = processor; sub-processors named, incl. Anthropic) | **Not drafted** |
| Data protection impact assessment | **Not started** |
| Database moved to **London** | Planned ("before real patient data") |
| ICO registration shown on the site | Not yet |
| Cyber Essentials, penetration test | Planned – **we hold no security certification yet** (the site says so) |
| Paid hosting plans, scheduled off-site backups | Planned before a paying clinic / real data |

Never say "UK hosting" as if it's done. Say: "App in London, data stored in the EU today; the database moves to
London before any real patient data."

---

## 9. Price (official list agreed 10 Oct – `memory/context/pricing.md` §0)

Per clinic, **all sites and all users included**, by completed forms per month. Ex VAT (VAT status to confirm).

| Plan | Price | Includes |
|---|---|---|
| Starter | £99/mo | Up to 25 forms/month, 3 referrer forms set up |
| Practice | £199/mo | Up to 100 forms/month, 10 referrer forms set up, portal question sets, priority support |
| Group | from £349/mo | 100+/month or large groups, dedicated onboarding |
| Set-up | £250 one-off | Top forms set up, data-protection paperwork, a training session |
| **Founding (first 5 clinics)** | **Practice at £149/mo fixed for 12 months + £250 set-up**, fair use up to **150 forms/month** | Monthly, cancel any time; in return for feedback and a case study. Year 1 = £2,038 |

**For Blue Heart** (our estimate ~125 forms/month, low confidence, range 50–300 – ask him first):

| His volume | Quote |
|---|---|
| Up to 100/month | Founding £149/mo × 12 + £250 (list would be Practice £199) |
| 100–150/month | Founding £149/mo still fits (fair use 150) |
| Over 150/month | "We'd size the plan after the pilot" (Group, from £349) |

Say line: "We price per clinic, not per user – all 11 sites and all your clinicians are included. As one of our first
clinics it's £149 a month, fixed for 12 months, covering up to 150 forms a month, plus a one-off £250 to set up your
main MLC forms and the data-protection paperwork. Monthly, cancel any time. Before any of that: send me two or three
blank MLC forms with anonymised notes and I'll return them completed, so you can judge it on your own forms."

- He may have seen "typically £99–£199 depending on volume" (06 Oct draft – sent? unconfirmed). Consistent with this.
- Don't offer Starter (undersells 11 sites). Don't quote per seat, discount below founding, promise portal
  submission or a TM3 link, or claim time savings.
- Earlier Blue Heart memo ("5 forms included, up to 10 extra for £300") is **superseded** – Practice includes 10 forms.
- Before taking money: paid hosting plan, a ClinForms Stripe account, terms and DPA reviewed, VAT confirmed.

---

## 10. Next step – the proof of concept

### 10.1 What to ask for (end of the call, and in the follow-up)

"Could you send two or three blank forms you get most, plus anonymised notes for one case as TM3 exports them?"

- **2–3 blank forms** from different MLCs or insurers, exactly as received (Word or PDF; a scanned one too, if
  common – it tells us the real risk).
- **Anonymised notes for one case**, as TM3 prints or exports them (PDF, Word or CSV), plus registration details.
- Optional: the completed form actually sent for that case, so we can compare.
- He must **remove names, dates of birth, addresses, NHS numbers, phone numbers and claim references** first.
- Also ask: which TM3 export or print options he has (run sheet D.4).

### 10.2 How we handle his files

- Kept out of git (gitignored `demo-assets/`), on your Mac only; deleted after the proof of concept unless he agrees
  otherwise.
- Never uploaded to clinforms.co.uk or any clinic account before a data processing agreement.
- Before any drafting, his anonymised notes become a **made-up patient** (fictional names and dates), so the drafting
  service only ever sees fictional data.

### 10.3 What we return

- Each of his forms **completed in its own layout** for that made-up patient: the draft and the clinician-approved
  version (Word forms as Word, PDF forms as PDF).
- A short list per form: what came from the record, what was drafted from which note, what was left for the
  clinician, and anything we couldn't do (e.g. a scanned form).
- How well his TM3 export was read (what the import picked up, what it missed).
- A short call or screen recording walking him through it, then the pilot proposal (price §9, data processing
  agreement).

### 10.4 When – **your call**

- Turnaround: "within **[X] working days** of receiving them" – fill in X. (Earlier drafts said 7–10 days; whether
  sent is unconfirmed.)
- Workload (rough estimate, not measured): about 1–3 hours per form for reading, checking the map, building the
  made-up patient and checking the output; more if a form is scanned or flat. Live reading and live drafting on your
  laptop were **not re-checked on 20 Oct** – plan the exact set-up with Claude when the files arrive.
- Showing his forms **on the call itself** (optional email paragraph) needs that same work done before the call.
  Only offer it if you have an evening free beforehand.

---

## 11. If something breaks

Run sheet F. In short:

1. **Laptop demo problems:** restart the server; Reset demo; use Megan Hart from the simulated TM3 tab only.
2. **Laptop demo dies:** the **public site** – `https://clinforms.co.uk` → header **Interactive demo** (`/reports`,
   header "Demo mode · passcode for live") and `https://clinforms.co.uk/pms-sandbox` → **Hart, Megan (Ms)**. Checked
   20 Oct, read-only: the same Harrow & Pike story (review, sources, flags, opinions, own voice, approve, Word
   download, save to record), Meridian analysed (about 2 s) and confirmed, Northfield approved with a 3-page signed
   PDF. Every step 0.3–3 s; needs the internet. **Never** enter a passcode, use Request access, or open Rebecca
   Lane there (no matching form). On Northfield, skip "Write in my own voice" (it leaves an ungrammatical sentence in
   section 3).
3. **Nothing works:** share the Finder folder `demo-assets/outputs/blue-heart/` (signed Word file in Pages + numbered
   screenshots), or the 1:30 video at `https://clinforms.co.uk/demo`.

---

## 12. After the call

- Tell Claude Dell's answers: referrers and volumes, Word/PDF/scanned/portal split, TM3 web or desktop and export
  options, who writes and signs, data rules, price reaction, next step and date. They go into
  `memory/projects/blue-heart-clinics.md` §7 and `memory/people/dell-baines.md`.
- Claude drafts the follow-up email (no "AI" or vendor words): thanks, his referrers in his words, the agreed next
  step and turnaround.
- If he sends forms: §10.

---

## §email – reply to Dell (customer-facing)

Reply in his thread. **Before sending:**

1. **Choose the three slots** and type them over the `[SLOT …]` placeholders – nothing is offered until you do.
   Suggestions (yours to change): Thu 22 Oct 12:30 · Fri 23 Oct 12:30 · Mon 26 Oct 17:30 (UK clocks go back Sun 25 Oct,
   so the Monday slot is GMT). A lunchtime slot only works if you have **your own Mac** (the demo runs on it) and a
   quiet room; otherwise offer after-work times.
2. Keep or delete the optional paragraph (§0.5, §10.4).

No "AI" or vendor words – checked.

**Subject:** leave Gmail's "Re: <his subject>" as it is (his subject line isn't recorded – don't retype it).

> Dear Dell,
>
> Thank you for coming back to me – I'm really pleased ClinForms sounds like what you've been looking for.
>
> I'd be glad to show you. Here are three 15-minute slots (UK time) that would suit me – they're only suggestions, so
> please say if another time works better:
>
> - [SLOT 1 – Khuram to choose; suggestion: Thursday 22 October, 12:30]
> - [SLOT 2 – Khuram to choose; suggestion: Friday 23 October, 12:30]
> - [SLOT 3 – Khuram to choose; suggestion: Monday 26 October, 17:30]
>
> It will be a short on-screen walkthrough using fictional data. I'll show a medico-legal company's form and an insurer's form,
> each completed in its own layout from a patient's clinic notes, and how your clinician reviews, amends and approves
> the information before anything is sent. That will leave time for your questions, including how it would fit into
> your reporting workflow alongside TM3.
>
> *[Optional – keep only if you will prepare his forms before the call:]* If you're able to send one or two of the
> blank MLC forms you receive most often beforehand (blank forms only, please – no patient details), I'll aim to show
> you those completed for a made-up patient as well (Word or PDF files work best; scanned copies aren't supported
> yet).
>
> Once you've chosen a time, I'll send a calendar invitation with a video link.
>
> Kind regards,
>
> Khuram Masood
> AppstackX Ltd
> khuram@appstackx.co.uk
> https://appstackx.co.uk
