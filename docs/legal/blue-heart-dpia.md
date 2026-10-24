# Data protection impact assessment – ClinForms at Blue Heart Clinics

**Draft v0.1 – 24 October 2026 – for review.** This is not legal advice. A solicitor should review it, and Blue
Heart's data protection lead [TO CONFIRM who] should review and sign it off. Placeholders are marked **[TO CONFIRM]**.

**Who owns this document.** Blue Heart is the controller, so the DPIA is Blue Heart's. AppstackX Ltd, as its
processor, drafted it to help (UK GDPR Article 28(3)(f)) from what is built and live on clinforms.co.uk today and what
is planned. The structure follows the ICO's sample DPIA template.

| | |
|---|---|
| Controller | [TO CONFIRM – legal name of the Blue Heart Clinics entity; Blue Heart Clinics Ltd (09158709) files dormant accounts] |
| Processor | AppstackX Ltd (ClinForms), khuram@appstackx.co.uk |
| Processing | Completing referrers' report forms from patient notes in ClinForms, with clinician review and approval |
| Related documents | Data processing agreement (`blue-heart-dpa.md`), sub-processor list (`sub-processors.md`), trial terms (`blue-heart-trial-terms.md`) |
| Status | Draft. **No real patient information may be processed until this DPIA is signed off and the measures marked "before real data" in Step 6 are done** |

---

## Step 1 – Identify the need for a DPIA

Blue Heart wants to use ClinForms to complete the report forms its referrers send (medico-legal companies,
rehabilitation and case-management providers, insurers, solicitors and employers) from its physiotherapy notes. Its
clinicians would review, change and approve each form before Blue Heart sends it.

A DPIA is needed because the processing:
- involves **health data** (special category data) on a large scale: about 400–500 reports a month across 11 sites
  [TO CONFIRM];
- uses a **new technology**: automated drafting of answers from notes, by a sub-processor;
- involves a **transfer outside the UK** (the drafting service, in the USA [TO CONFIRM]) and storage in the EU;
- concerns people who may be **vulnerable** (injured people, personal-injury claimants, possibly children
  [TO CONFIRM]), and produces documents used in insurance and legal claims.

## Step 2 – Describe the processing

### Nature of the processing

**How the data flows today (built and live):**

```
Blue Heart's practice-management system (TM3)
   │  staff print or export a patient's registration details and notes
   ▼
ClinForms clinic account "blue-heart" (clinforms.co.uk, application in London)
   1. Upload notes (PDF with text, Word, CSV, text, or pasted text)
   2. ClinForms reads them; staff check and correct the result      ← nothing stored before staff confirm
   3. Confirmed record stored, encrypted with Blue Heart's own key   → database (EU today; London planned)
   4. Choose the referrer's form (Blue Heart's templates, set up once)
   5. Drafting (only if Blue Heart has switched it on):
        minimised extract (no name, no date of birth, no address)  → drafting service (USA) → draft answers
      Identifiers on the form (name, date of birth, references, clinician) are filled in by ClinForms itself
   6. Clinician reviews, edits and approves                          ← approval bound to the exact content
   7. Completed form downloaded (Word or PDF)
   ▼
Blue Heart sends the form to the referrer through its own channel (email or the referrer's portal)
and keeps its own copy in TM3. ClinForms does not send forms and is not connected to TM3.
```

**Setting up a referrer form.** Staff upload a template (Word, PDF, or RTF, which is converted to Word at upload).
ClinForms reads its questions (with the drafting service once Blue Heart has switched drafting on, otherwise with
its own layout rules) and staff confirm where each answer goes. Templates are blank; if a filled-in form is uploaded,
its patient details are masked before reading. Mail-merge fields left in a template become answer spaces, and
approval is blocked while any remains unfilled.

**Collection and source.** The data comes from Blue Heart's own records. ClinForms collects nothing from patients
directly.

**Storage.** Reports, form set-ups and form files are encrypted in the application (AES-256-GCM, a key specific to
Blue Heart) and stored in a database shared with other clinics, separated by clinic id and by key. The database is
**in the EU today** (Cloudflare D1, EU jurisdiction). A move to **London** (Supabase) is planned [TO CONFIRM: before
real data]. Uploaded notes are not stored as uploaded; only the record built after staff confirm it, inside the
encrypted report.

**Deletion.** Blue Heart sets a retention period (30 to 3,650 days); a daily job deletes reports not changed for
that period. The job is built and scheduled; **its first run on the live service has not been verified yet**
[TO CONFIRM before real data]. At the end of the contract, data is exported on request and then deleted (DPA
clause 9).

**Who has access.** Blue Heart's invited users, by role (owner, administrator, clinician, staff), all with two-step
verification. At AppstackX, one administrator (Khuram Masood) [TO CONFIRM], who can technically decrypt clinic data
because he holds the keys, and uses that only to provide the service (for example the offboarding export).

**Sub-processors.** Vercel (application hosting, London), Cloudflare (database, EU), Anthropic (drafting service,
USA); planned: Supabase (database, London), MailerSend (account emails only), a UK document converter. See the
sub-processor list.

**High-risk features.** Free-text health data; automated drafting; a transfer to the USA; a small supplier with one
administrator; one database shared by several clinics.

### Scope of the processing

| Item | Details |
|---|---|
| Data | Identity and contact details (title, first name, surname, date of birth or age, address, postcode); referral and claim details (referrer, claim and case references, incident or accident date and circumstances, GP practice, consultant name, clinic location); appointment dates and attendance; clinicians' names, job titles and HCPC numbers |
| Special category | Health data: history, symptoms, examination findings, clinical impression, treatment, progress, outcome scores, prognosis, work capability and restrictions as recorded, past medical and social history where a form asks. Notes may mention mental health. No criminal offence data expected [TO CONFIRM] |
| Volume | About 400–500 completed reports a month across 11 sites [TO CONFIRM]; [TO CONFIRM] patients a year; [TO CONFIRM] users |
| Retention | Reports: Blue Heart's retention period [TO CONFIRM – suggested: long enough to answer referrer queries on a report, since the clinical record and the sent copy stay in TM3]; form set-ups: until deleted or the contract ends |
| Geography | Patients mainly in Bedfordshire, Buckinghamshire, Hertfordshire, Northamptonshire and London (Blue Heart's sites); data processed in the UK, stored in the EU, drafting in the USA |

### Context of the processing

- **Relationship.** Patients are treated by Blue Heart, often on referral from a medico-legal company, a
  rehabilitation provider or an insurer that has asked for a report. Patients expect their physiotherapist to write
  that report; they may not expect a supplier, or automated drafting, to be involved [TO CONFIRM what Blue Heart's
  privacy notice says today].
- **Control.** Patients have no direct control over ClinForms. They exercise their rights through Blue Heart.
- **Vulnerable people.** Injured people and personal-injury claimants; possibly children [TO CONFIRM].
- **Prior concerns.** Automated drafting can produce plausible but wrong text. In a report used in a legal or
  insurance claim, an error could harm the patient (a claim undervalued or refused) or the clinician (a statement they
  did not mean). This is why every form needs a clinician's approval.
- **Novelty.** Clinic software that drafts from notes is now common, but ClinForms is new (live since 10 October
  2026) and Blue Heart would be its first clinic with real patient information.
- **Security standards.** AppstackX holds no security certification yet; Cyber Essentials is planned [TO CONFIRM].
  No independent penetration test has been done [TO CONFIRM decision].
- **Referrers' terms.** Some referrers' terms control where data may go. One was found in HCML's published supplier
  terms (clause 5.4: notice before data leaves the UK) [TO CONFIRM by Blue Heart for each referrer].
- **Professional context.** Medico-legal reports may carry professional and court duties (for example CPR Part 35 and
  statements of truth) [TO CONFIRM with the solicitor]. ClinForms is a documentation tool, not clinical decision
  support, and is not a MedCo initial medical report tool [TO CONFIRM: a written intended-purpose statement].

### Purposes of the processing

- **For Blue Heart:** complete referrers' forms in each referrer's own layout, faster and more consistently, with the
  clinician reviewing and approving every form; less retyping of notes into templates.
- **For patients:** reports sent sooner after assessment, so treatment can be authorised and claims progressed;
  answers that cite the notes they came from.
- **For referrers:** forms completed in their own layout.
- **Not a purpose:** marketing, profiling, research, training the drafting service, or any decision about a patient
  made without a clinician.

## Step 3 – Consultation process

| Who | How | Status |
|---|---|---|
| Blue Heart's owner (Dell Baines) | Demo on fictional data (23 October 2026); this draft | Done / to review [TO CONFIRM] |
| A Blue Heart physiotherapist | Review of the drafts from the trial and proof of concept (fictional or anonymised notes) | [TO CONFIRM] |
| Blue Heart's data protection lead or DPO | Review of this DPIA and the DPA | [TO CONFIRM whether Blue Heart has one] |
| AppstackX (processor) | Drafted this DPIA from the live system | Done |
| Solicitor | Review of the DPA, the DPIA and the transfer assessment | [TO CONFIRM] |
| Referrers | Blue Heart checks its referrer contracts (e.g. HCML clause 5.4) and gives any notice they require | [TO CONFIRM] |
| Patients | Not consulted directly; Blue Heart updates its privacy notice [TO CONFIRM whether Blue Heart wants to ask a few patients] | [TO CONFIRM] |
| Information Commissioner | Only if a high residual risk remains after Step 6 (Article 36) | Not expected |

## Step 4 – Assess necessity and proportionality

| Question | Answer |
|---|---|
| Lawful basis (Article 6) | [TO CONFIRM by Blue Heart – likely the basis it already relies on for writing referrer reports, e.g. Article 6(1)(b) or 6(1)(f)] |
| Health data condition (Article 9) | [TO CONFIRM by Blue Heart – likely Article 9(2)(h) (provision of health care, with Data Protection Act 2018 Schedule 1, paragraph 2, and the duty of confidentiality of a health professional) and, for medico-legal reports, Article 9(2)(f) (legal claims)] |
| Does it achieve the purpose? | Yes: the referrer's own form is completed from the notes, and a clinician approves it |
| Is there a less intrusive way? | Typing by hand (today's process) uses less technology but is slower. Within ClinForms, the intrusive parts are optional and minimised: drafting is off until Blue Heart switches it on; the drafting service never receives names, dates of birth, addresses or contact details; identifiers are filled in by ClinForms itself |
| Data minimisation | Staff check imported notes before anything is stored; only the confirmed record is kept; drafting extracts are minimised (Annex 2, section D of the DPA); for employer and case-manager forms, past medical and social history are held back; logs hold no note text or names. Known gap: free-text notes may still mention third parties or rare details that identify a patient indirectly |
| Accuracy | Clinician review and approval of every form; each answer cites its notes; gaps are flagged, not guessed; opinions only when a clinician recorded them; checks for figures and dates that do not match the record; approval blocked while a mail-merge field is unfilled. Known gaps: a copied prognosis once changed tense ("I expect" became "I expected") [fix planned]; some answers have shown the wrong source label [fix planned] |
| Retention | Set by Blue Heart; daily deletion job (first live run to be verified); TM3 remains the clinical record, so ClinForms' copies can be short-lived |
| Transparency | Blue Heart's privacy notice to say that a supplier prepares referrer reports, that a drafting service is used, and where data is processed (UK, EU, USA) [TO CONFIRM] |
| Individuals' rights | Through Blue Heart; AppstackX passes on requests and helps (DPA clause 7). Owners and administrators can find, download, correct and delete reports |
| Processor compliance | Article 28 DPA; sub-processors bound by written contracts (DPA clause 5) |
| International transfers | EU: UK adequacy regulations. USA (drafting service): IDTA or UK Addendum plus a transfer risk assessment [TO CONFIRM] (DPA Annex 4) |
| Automated decisions | None. ClinForms drafts text; a clinician decides and approves. No decision with legal or similar effect is made solely by automated means |

## Step 5 – Identify and assess risks

Likelihood: remote, possible, probable. Severity: minimal, significant, severe. Assessed **before** the measures in
Step 6.

| # | Source of risk and potential impact on individuals | Likelihood | Severity | Overall risk |
|---|---|---|---|---|
| R1 | A user's account is taken over (phishing, reused password) and an attacker reads or downloads patients' reports | Possible | Severe | High |
| R2 | A software fault shows one clinic's records to another clinic in the shared database | Possible | Severe | High |
| R3 | A breach at the hosting or database provider exposes stored data | Remote | Severe | Medium |
| R4 | A secret (data key, database gateway secret, drafting service key) leaks, for example in a screenshot or a shared chat, and exposes data or lets someone run up activity | Possible | Severe | High |
| R5 | Health data sent to the drafting service in the USA is accessed by others, kept longer than expected, or used beyond the contract; patients and referrers did not expect it to leave the UK | Possible | Significant | Medium |
| R6 | Data is stored in the EU, not the UK, contrary to what patients or referrers expect | Probable (until the move) | Minimal | Low |
| R7 | A drafted answer is wrong or overstated, the clinician misses it, and an inaccurate report reaches a referrer or court, harming the patient's claim or treatment | Possible | Severe | High |
| R8 | The wrong patient's details end up on a form (mix-up between patients or reports) | Possible | Significant | Medium |
| R9 | More information than the referrer needs is shared (e.g. past medical history on an employer's form) | Possible | Significant | Medium |
| R10 | Real patient information is uploaded during the trial or proof of concept, before the DPA and this DPIA are signed off, or "anonymised" notes can still identify a patient | Possible | Significant | Medium |
| R11 | Reports are kept longer than needed, or deleted before a referrer query or claim needs them | Possible | Significant | Medium |
| R12 | Data is lost or unavailable (provider outage, bad change, no off-site backup, lost key) | Possible | Significant | Medium |
| R13 | Insider access: AppstackX's administrator can decrypt clinic data | Remote | Severe | Medium |
| R14 | A breach is not noticed or not reported in time (small supplier, one administrator, support outside clinic hours [TO CONFIRM support hours]), so Blue Heart misses its own 72-hour and referrer deadlines | Possible | Significant | Medium |
| R15 | Invitation or reset links passed on by hand reach the wrong person, or patient information is sent by email for support | Possible | Significant | Medium |
| R16 | Patients are not told about the supplier, the drafting service or the transfer, so they cannot exercise their rights | Probable (until the privacy notice is updated) | Significant | Medium |
| R17 | Usage analytics reveal information about patients or users | Remote | Minimal | Low |
| R18 | AppstackX stops trading or cannot run the service, and reports in progress are lost | Remote | Significant | Low |

## Step 6 – Identify measures to reduce risk

"Built" = live on clinforms.co.uk since 10 October 2026. "Before real data" = to be done before Blue Heart uploads
real patient information. "Approved" is for Blue Heart to complete.

| # | Measures | Effect | Residual risk | Approved |
|---|---|---|---|---|
| R1 | **Built:** two-step verification required for every user (cannot be switched off, no trusted devices, lockout after 10 wrong codes); invitation only; passwords of 12+ characters; sign-in rate limits; 12-hour sessions, revoked at once when a user or session is removed; activity log of sign-ins and downloads, visible to owners and administrators. **Blue Heart:** remove leavers promptly; one account per person; review the activity log monthly [TO CONFIRM] | Reduced | Low | [ ] |
| R2 | **Built:** every request checked against the user's clinic; every query limited to that clinic; a separate encryption key per clinic, with each value bound to its clinic and record, so data moved across clinics does not decrypt; automated tests for these checks. **Before real data:** [TO CONFIRM decision on an independent penetration test] | Reduced | Low | [ ] |
| R3 | **Built:** reports, form set-ups and form files encrypted in the application before storage, so the database provider holds only encrypted contents for them; keys held outside the database; HTTPS everywhere. **Before real data:** paid hosting plans | Reduced | Low | [ ] |
| R4 | **Built:** secrets only in the hosting provider's encrypted settings and an owner-only secrets file, never in source code; the data key has been rotated once, before any clinic data existed; signed gateway requests valid for 60 seconds. **Before real data:** [TO CONFIRM: confirm that only one current drafting-service key exists and older keys are revoked]; a spend limit on the drafting service account [TO CONFIRM] | Reduced | Low | [ ] |
| R5 | **Built:** drafting off until Blue Heart switches it on (the same switch controls reading forms, so nothing is sent while it is off); minimised extracts only (no name, date of birth, address or contact details; identifiers filled in by ClinForms); staff can see exactly what is sent; nothing from other clinics in the same request. **Before real data:** IDTA or UK Addendum plus a transfer risk assessment [TO CONFIRM]; confirm the provider's terms on training and retention, and whether a zero-data-retention arrangement or a UK or EU processing location is available [TO CONFIRM]; Blue Heart gives referrers any notice their terms require (e.g. HCML clause 5.4) and updates its privacy notice | Reduced | Medium [TO CONFIRM after the transfer assessment] | [ ] |
| R6 | **Built:** EU storage (covered by UK adequacy regulations), stated truthfully in the privacy policy and the DPA. **Before real data [TO CONFIRM]:** move the database to London (Supabase); the EU database is kept read-only for about 30 days, then deleted | Reduced | Low | [ ] |
| R7 | **Built:** a form can be downloaded as final only after a clinician approves it, and the approval is bound to the exact content; each answer cites its notes; gaps flagged, not guessed; opinions only when a clinician recorded them; checks for mismatched figures and dates and unrecorded opinion wording; approval blocked while a mail-merge field is unfilled. **Before real data:** fix the known prognosis-tense and source-label issues [TO CONFIRM]; trial and proof of concept reviewed by a Blue Heart physiotherapist; short guidance for clinicians on reviewing drafts [TO CONFIRM]. **Blue Heart:** clinicians stay responsible for every approved form | Reduced | Medium | [ ] |
| R8 | **Built:** identifiers filled in by ClinForms from the confirmed record, not drafted; staff check imported notes before the record is built; clinician approval. **Blue Heart:** check the patient's name and date of birth on the final form before sending | Reduced | Low | [ ] |
| R9 | **Built:** past medical and social history held back for employer and case-manager forms; the clinician reviews every answer. **Before real data:** agree with Blue Heart which referrer type each provider is set up as (personal-injury providers as "medico-legal"; employer-funded providers as "case manager" or "employer") [TO CONFIRM] | Reduced | Low | [ ] |
| R10 | **Trial terms:** made-up or anonymised notes only until the DPA is signed and both parties confirm in writing that the account is ready for real patient information; a list of what to remove (names, including those in the notes, dates of birth, addresses and postcodes, phone numbers, emails, NHS and hospital numbers, claim and case references, exact accident and appointment dates – replaced with XXXX); if in doubt, use a made-up patient; real data uploaded by mistake is deleted at once. [TO CONFIRM: drafting switched on during the trial only for made-up or anonymised notes] | Reduced | Low | [ ] |
| R11 | **Built:** retention set by Blue Heart; daily deletion of reports not changed for that period; owners and administrators can delete sooner; TM3 keeps the clinical record and the sent copy. **Before real data:** verify the first live run of the deletion job [TO CONFIRM]; Blue Heart chooses a period [TO CONFIRM] | Reduced | Low | [ ] |
| R12 | **Built:** the database provider's 7-day point-in-time recovery; encrypted offline copy of the keys; ClinForms is not the record, so a loss means redoing forms, not losing notes. **Before real data:** paid database plan (30-day recovery); scheduled encrypted off-site backup [TO CONFIRM]; a restore test [TO CONFIRM] | Reduced | Low | [ ] |
| R13 | **Built:** one administrator; platform actions (creating clinics, handling access requests) recorded in the activity log; offboarding recorded. **Policy:** no access to clinic data except to provide the service or at Blue Heart's request; confidentiality duty (DPA clause 4.3). Remaining gap: use of the keys outside the application is not logged by the application | Reduced | Low | [ ] |
| R14 | **DPA:** notice to Blue Heart within [24] hours [TO CONFIRM] with the Article 33(3) details; named contacts and phone numbers. **Built:** error logging on the application and gateway. **Before real data [TO CONFIRM]:** alerting on errors and unusual activity; a written breach procedure; support hours and cover stated in the order | Reduced | Medium | [ ] |
| R15 | **Built:** links work once and expire (invitations 7 days, resets 2 hours); a reset link for someone in another clinic is never shown to an administrator; two-step verification still needed after a reset. **Policy:** no patient information by email (DPA clause 3.2(f)). **Later:** email service so links go straight to the user | Reduced | Low | [ ] |
| R16 | **Blue Heart:** update its privacy notice (supplier, drafting service, UK, EU and USA locations) before real data [TO CONFIRM]; AppstackX supplies wording on request | Reduced | Low | [ ] |
| R17 | **Built:** analytics only with consent; a fixed list of events with coded values and counts, no names, free text or ids; page views on public pages only; EU provider | Eliminated (for patient data) | Low | [ ] |
| R18 | **DPA:** export on request at the end of the contract; completed forms can be downloaded at any time; TM3 holds the record. [TO CONFIRM: a continuity plan, e.g. a named person who can export data if Khuram cannot] | Reduced | Low | [ ] |

## Step 7 – Sign off and record outcomes

| Item | Name / date | Notes |
|---|---|---|
| Measures approved by | [TO CONFIRM] | Integrate actions back into the project plan, with dates and responsibility |
| Residual risks approved by | [TO CONFIRM] | If accepting any residual high risk, consult the ICO before going ahead |
| DPO advice provided | [TO CONFIRM] | DPO should advise on compliance, Step 6 measures and whether processing can proceed |
| Summary of DPO advice | [TO CONFIRM] | |
| DPO advice accepted or overruled by | [TO CONFIRM] | If overruled, you must explain your reasons |
| Consultation responses reviewed by | [TO CONFIRM] | If your decision departs from individuals' views, you must explain your reasons |
| This DPIA will be kept under review by | [TO CONFIRM] | Review when the database moves to London, when a sub-processor changes, when drafting is switched on, after any breach, and at least every 12 months |

**Open actions before real patient information (summary)** [TO CONFIRM owner and date for each]
1. DPA signed; contracting entity confirmed.
2. Transfer documents and transfer risk assessment for the drafting service; provider terms on training and retention
   confirmed.
3. Database moved to London; paid hosting plans.
4. First live run of the deletion job verified; scheduled encrypted off-site backup; restore test.
5. Drafting-service keys confirmed (one current key, older ones revoked).
6. Prognosis-tense and source-label fixes.
7. AppstackX registered with the ICO; Cyber Essentials; decision on a penetration test.
8. Blue Heart: privacy notice updated; referrer notices (e.g. HCML); retention period chosen; data protection lead
   named.
9. Breach procedure, alerting and support hours written down.
