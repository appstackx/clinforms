# TM3 vs Clinic system at the end of the sprint: feature comparison (checked)

Label: check (final) · Sat 24 Oct 2026 · For Khuram (internal).

**Do not send this to Dell as it is.** It names TM3 and other vendors, it includes [U] items, and the right-hand column is planned scope, not tested software. For Dell, use §5 and a cut-down table once the sprint has been verified.

## What this check changed

- **Fact-check.** I re-opened 55 TM3 claims at their sources on 24 Oct: 103 help-centre articles fetched again live, plus the pricing and feature pages, the status page, the MSA, the HMDG survey and Heidi's pages. 37 were confirmed as written. 18 were corrected, re-cited or downgraded. The biggest fix was a Web-vs-Desktop mis-attribution on templates. Full log in Appendix A.
- **Honesty check of the Clinic-system column.** Nine rows were downgraded:
  - 7 from In sprint to Basic;
  - 1 from Only us to Basic;
  - 1 from Only us to In sprint (existing).

  "Only us" falls from 4 rows to 2, and "In sprint" from 49 to 43. Log in Appendix B.
- **Customer-facing text (§5, §6).**
  - Removed one overclaim: "existing Word and RTF templates work as they are".
  - Removed one implied timeline ("yet").
  - Removed vendor names from the questions Khuram will ask aloud.
  - No AI wording and no dates remain.

## How to read this

**TM3 column.** Built from public sources only:
- tm3app.com feature and pricing pages;
- about 260 TM3 help-centre articles and release notes (help.tm3app.com);
- TM3's UK MSA v5.3;
- review-site snippets (Capterra and similar block direct reading, so those snippets are not re-verified).

Many key help articles were last updated in 2020–2023, and some (the diary ones) in June 2025. That is before TM3's August 2025 interface redesign, so the help centre can lag the product.

**Clinic system column.** Taken only from the sprint's module briefs and rules (the workflow script), plus ClinForms features already live on `main` (marked "existing").
- When I checked on 24 Oct, the foundation contract (`cs-base/docs/clinic-system/contract.md`) had not been written yet.
- The foundation work was in progress and not yet committed: migrations 0100–0102 for entitlements, sites, rooms, practitioners, services, price lists, patients, cases, authorisations and referrers.
- **Before showing any of this, replace the column with the has/partial/missing table from the integrate, verify and demo reports.**

**Status values**, written as text labels:

| Status | Meaning |
|---|---|
| **In sprint** | Explicitly in a module brief and realistic in one week, at roughly TM3's level |
| **Basic in sprint** | In a brief but simpler than TM3, or only implied by a brief or rule. The cell says how |
| **After sprint** | Not in any brief, or too much for one week |
| **External** | Needs an outside account, approval or contract that a week can't deliver: Healthcode, live SMS/email/payment accounts, card terminals, ISO 27001 / Cyber Essentials, network agreements. **Never shown as done** |
| **Only us** | We have it (in the sprint or already in ClinForms) and TM3's public documentation shows it doesn't |

**Tags.**
- **[C]** confirmed at the cited source;
- **[I]** inference;
- **[U]** unknown;
- **claim**: the only source is a TM3 marketing page.

**Source keys** (H + article id, P, FD and so on) are listed with full URLs at the end. Brief keys in the Clinic-system column ([diary], [billing] and so on) point to the MODULES briefs and CTX rules in the workflow script.

**TM3 tiers:** Good £39, Better £55, Best £70 per user per month, ex VAT [C P, re-checked 24 Oct]. The pricing-page footer names the trading entity as Clearcourse Business Services Limited T/A TM3 [C P].

---

## 1. One-screen summary

**129 feature rows across 8 areas.** These are planned statuses, not tested ones.

| Area | In sprint | Basic in sprint | After sprint | External | Only us | Rows |
|---|---:|---:|---:|---:|---:|---:|
| Diary & booking | 8 | 14 | 10 | 1 | 0 | 33 |
| Patients & clinical | 8 | 5 | 10 | 0 | 0 | 23 |
| Letters & reports | 3 | 0 | 0 | 1 | 2 | 6 |
| Billing & payments | 7 | 3 | 7 | 4 | 0 | 21 |
| Communications | 5 | 0 | 6 | 2 | 0 | 13 |
| Reporting & admin | 8 | 2 | 4 | 0 | 0 | 14 |
| Platform & security | 4 | 3 | 3 | 1 | 0 | 11 |
| Integrations & migration | 0 | 1 | 6 | 1 | 0 | 8 |
| **Total** | **43** | **28** | **46** | **10** | **2** | **129** |

**How to read the counts** [I]:

- **73 of 129 rows (57%) will exist in some form at the end of the sprint.**
  - 43 are In sprint.
  - 2 are Only us.
  - 28 are Basic, meaning simpler than TM3 or only implied by the briefs.
  - The everyday chain is all in scope, and the integrate step walks it end to end: book, arrive, note, sign, invoice, record payment, reminder (outbox only), online booking, portal, report, Complete referrer form, letter, TM3 import.
- **The 10 External rows are where money or messages leave the building, or where an outside body has to say yes:**
  - Healthcode;
  - live SMS and email, including two-way replies;
  - payment links, card terminals, saved cards and deposits;
  - ISO 27001 and Cyber Essentials;
  - the Pronto networks, which appear in three rows: third-party booking, reports to networks and incoming referrals.

  None of these can be finished in a week, however much is coded. Several In-sprint and Basic rows depend on them before real patients can use them. For example, reminders and confirmations go only to the outbox, and so do patient sign-in links.
- **The 46 After-sprint rows are mostly TM3's long tail:**
  - classes and video;
  - packages, stock and Xero;
  - automation and marketing: recalls, bulk messages, Journeys, NPS;
  - clinical extras: flags, an assessment library, goals, reusable text;
  - the newest online-booking features: deposits at booking, insured self-booking, add-on and companion bookings.
- **The 2 Only-us rows are:**
  - completing each referrer's own form from the course of treatment;
  - using uploaded Word, RTF and PDF forms in their own layout. This is compared with TM3 Web; TM3 Desktop has its own RTF letter templates.

  Several In-sprint rows also go beyond TM3: rooms built in, double bookings blocked by the database, expiring-authorisation alerts, scored questionnaires, and audit and two-step sign-in on every clinic. Two more are possible edges where we can't yet be sure: a week view across several resources, and per-clinic encryption keys. See §4.
- **Row counts are not a parity score.** TM3 has more than 20 years of depth inside each row, and a Basic row may hide a lot of missing detail. The question for Dell is whether his team's daily work is covered, whether the referrer-form work disappears, and which External items must be in place before one site could move.

---

## 2. Comparison by area

### 2.1 Diary & booking

| Area | Feature | TM3 (detail + source) | Clinic system at end of sprint | Notes |
|---|---|---|---|---|
| Diary & booking | Multi-site diary | Each location has its own address, cancellation/DNA charges and reminder templates. The diary switches location from a drop-down. Marketing says appointments, rooms and clinics are coordinated "in one view" [C H4448621, H4448488; claim FD] | **In sprint**: sites come from the shared record; day and week views per site [foundation, diary] | TM3's help shows one location at a time [I] |
| Diary & booking | Day view, several practitioners side by side | Pick several practitioners. Also privacy mode (hides names and treatment), diary summary stats, slot interval, and an auto-refresh every 30 seconds, restored in Aug 2025 [C H4448488, H11906413] | **In sprint**: one column per practitioner or room [diary] | Privacy mode and diary stats aren't in the brief |
| Diary & booking | Week view across several practitioners or rooms | "Only able to view the diary by week if you are viewing the diary for one practitioner" [C H4448488]. The article is dated 17 Jun 2025, before the Aug 2025 redesign, so current behaviour is [U] | **Basic in sprint**: the brief asks for "day/week resource views (columns per practitioner/room)". Whether the week view shows several resources side by side isn't stated [diary; I] | Possible edge, [U] on both sides. Check the demo build, and ask Dell what his week view shows. *Was Only us* |
| Diary & booking | Room diary | Rooms is "an additional module" bought through TM3 sales and isn't on the pricing page. A setting can make room selection mandatory on every booking [C H4448494, H4448630, H4582725, P] | **In sprint**: rooms built in, with room columns and room clashes blocked [foundation, diary] | Selling point: no add-on. Our own pricing isn't set [I] |
| Diary & booking | Equipment / other resources | Marketing says diaries for "any resource - rooms, equipment or staff". The help centre documents rooms only [claim FD; U] | **Basic in sprint**: the brief says rooms/resources; expect equipment to be set up as a room-type resource [diary; I] | |
| Diary & booking | Double-booking prevention (practitioner and room) | Marketing says the system "ensures resources aren't double-booked". Whether it blocks or only warns isn't documented [claim FD; U] | **In sprint**: blocked by the database (SQLite trigger, Postgres exclusion constraint; cancelled appointments excluded) and in the screen [diary] | The strongest guarantee we can give, once it's verified |
| Diary & booking | Practitioner working times / rotas per site | Click-and-drag working hours per practitioner. Each block sets the appointment types allowed and an online-bookable flag, and repeats daily, weekly, fortnightly, monthly or on a custom pattern. Also clinic working days, holiday dates and closure days [C H4448628, H4582725, H4582750, H4448498] | **Basic in sprint**: rotas and availability per site, plus opening hours [diary, reporting]. Closure dates and per-session type limits aren't stated [U] | |
| Diary & booking | Diary block-outs (meeting, holiday, other) | Events with a type, notes and repeats; they block booking [C H4448497, H13572225] | **After sprint**: not in the brief | May be workable through rota changes [I] |
| Diary & booking | Skills / specialisms | Skills limit which services a practitioner can be booked for, in the diary and online. Jun 2026 (4.2.045) extended them to stock items, working times and practitioners; a skills fix already appears in Aug 2025. Specialisms guide third-party bookers [C H15520284, H15520312, H11906413, H4560279] | **After sprint** | |
| Diary & booking | Appointment types / services | Stock items with price, VAT, ledger code, per-site price and a video flag. A first appointment picks up the assessment charge. Colours; buffer times are claimed [C H4582616, H4448476; claim FD] | **In sprint**: services and appointment types with durations and price lists [foundation, diary, reporting] | Buffers and ledger codes aren't in the brief |
| Diary & booking | Reception books from a slot | Click a slot, then find or create the patient and choose the body site, which creates the case. Then choose self-pay or business, with policy number, authorisation code and sessions. Repeats, waiting list and prepayment request are optional [C H4448470, H4448446, H4448475] | **Basic in sprint**: booking a patient into a slot is in the brief. Choosing the case, payer and authorisation at booking, and drawing the authorisation down, is implied by the shared record and the billing brief but not stated [foundation, diary, billing; I] | *Was In sprint* |
| Diary & booking | Recurring appointments | Repeats are set on the appointment form. Since Jun 2026 (4.2.035), one edit can apply to all linked block-booked appointments that are still "Booked" [C H4448470, H15326915] | **Basic in sprint**: recurring appointments are in the brief; editing a whole series is [U] | |
| Diary & booking | Move / reschedule | Drag-and-drop to move and extend, restored in Aug 2025 after the redesign. Reschedule shows the previous time [C H11906413, H12658947] | **Basic in sprint**: the brief says drag-and-drop **or** click-to-move, with a keyboard alternative; click-to-move is the safe bet [diary] | Don't promise drag-and-drop |
| Diary & booking | Appointment statuses and info icons | Booked, Arrived, In Progress, Finished, Completed, Did Not Attend, Cancelled. Icons for pay at appointment, alerts, first appointment of a case, new client, SMS/email reminder sent and authorisations remaining [C H13572225, updated 1 Oct 2026] | **Basic in sprint**: book, arrive, cancel, DNA and late-cancel, with colour by status [diary]. Info icons are [U] | |
| Diary & booking | Cancellations, late-cancel and DNA fees | Cancel or DNA opens Quick Bill with the charge. Cancellation reasons are split into Client Cancelled and Clinic Cancelled. A setting gives the notice window in days, and each location has its own charges [C H4448477, H4448483, H4582725, H4448621] | **Basic in sprint**: cancel, DNA and late-cancel carry a fee flag that billing invoices [diary, billing]. Reason lists are [U] | Charging a saved card is External (see Billing) |
| Diary & booking | Waiting list | Patients on the list are "notified" when a suitable slot opens and have a set time to respond to the invitation. Waiting-list templates carry a link and a "valid for" field. Marketing says the team is notified and offers the slot "with a click". "Smart automated waiting lists" are a Better-tier item [C H4769222, H4585166, P; claim FD]. The channel and the accept/decline flow are shown only in a video [U] | **Basic in sprint**: waiting list in the diary; no automatic offers, since messages only go to the outbox [diary, comms] | |
| Diary & booking | Two users editing the same appointment | The diary auto-refreshes every 30 seconds. Until Jun 2026 (4.2.047), rescheduling or deleting an appointment that another user had already moved or deleted, without a page refresh, caused a crash. No version check is documented [C H11906413, H15588496; I] | **In sprint**: an optimistic version check stops one user overwriting another [diary] | The brief also covers UK clock changes (Europe/London) [diary] |
| Diary & booking | Quick patient search | Diary search, advanced search, saved smart lists and a command bar [C H4448491, H8425433] | **In sprint**: quick search [diary, records] | Saved lists come after the sprint |
| Diary & booking | List view with bulk actions | A day/week table across chosen practitioners, with bulk reminders and messages, CSV export and print [C H8922215] | **After sprint**: not in the brief; reporting CSV exports cover part of it | |
| Diary & booking | Print the diary | Practitioner day and week printouts [C H4448489] | **After sprint** | Only the browser's own print [I] |
| Diary & booking | Calendar sync (Google / Apple / Outlook) | Marketing claim only; no help article [claim FD; U how] | **After sprint** | |
| Diary & booking | Group classes and courses | Class types with capacity, packages and attendance; a class diary; online class booking. Good tier ("Class management module"); classes are billed per session [C H4522869, H4522927, H4522970, H6913222, H4552543, P] | **After sprint** | Matters only if Blue Heart runs classes [U] |
| Diary & booking | Video appointments | Built-in video, Zoom (needs Zoom Pro) or another provider's link, which goes into reminders. Since Jun 2026 the provider is chosen per booking. Good tier [C H4573123, H4582725, H15326915, P] | **After sprint** | |
| Diary & booking | Online booking page | A branded booking site per clinic ("Connect") that the clinic switches on or off. Marketing says it "integrates smoothly into your website or app". Good tier [C H5554301, P; claim FD, FB] | **Basic in sprint**: a public booking page per clinic and site, showing appointment types marked bookable online. Rate-limited; a bot check is ready but switched off [portal] | Branding and embedding are [U] |
| Diary & booking | Online booking rules | Earliest and latest booking days, a cap on bookings per patient, and self-registration on or off. Provisional new patients are accepted by staff or linked to an existing record. Policies are accepted at booking. Minimum notice per service in the 2026 flow [C H5554301, H4560207, H15886814] | **Basic in sprint**: availability comes from the diary rules; cancel and rebook within policy [portal]. Matching provisional patients is [U] | |
| Diary & booking | Pay or leave a deposit when booking online | Deposits can be none, full price, fixed or a percentage. They can apply to online bookings, in-app bookings or both (Sep 2025). Since Mar 2026 a failed deposit payment blocks the booking, and full payment online can be enforced. Apple Pay [C H12427075, H14320730, H14594695, H12426855] | **After sprint**: not in the portal brief; going live would also need a payments account (External) | |
| Diary & booking | Forms, add-ons and companion bookings while booking | New booking flow, Jul–Sep 2026: a guided selector, forms during booking, add-on services and a linked companion appointment [C H15886814, H15870031] | **After sprint** | |
| Diary & booking | Insured patients booking online | Connect for Insurance: the patient picks the insurer and enters a policy number and pre-authorisation code. The code is saved as a note on the appointment, not as an authorisation [C H14033968, H14033747]. Marketing says pre-authorised card details help collect excesses [claim FCI]. Price: "£10 per licence" on the pricing page, and "for a limited time … £10 per practitioner per month" on the feature page [C P; claim FCI] | **After sprint**: staff enter the insurer and authorisations [foundation] | TM3 still needs reception to set up the authorisation |
| Diary & booking | Patient cancels or rebooks online | Within the clinic's rules and cancellation policy [C FB, H4561380] | **In sprint**: cancel and rebook within policy [portal] | Patients reach it through the magic-link sign-in (see below) |
| Diary & booking | Patient portal contents | Upcoming and past appointments, payments, outstanding balance, online payment, class credits, packages, insurance details, consent preferences and saved card. No clinical notes [C FB, H12426855, H6913222] | **Basic in sprint**: upcoming appointments, cancel/rebook and forms. No notes unless explicitly shared [portal] | Balance, payments and history aren't in the brief |
| Diary & booking | Patient sign-in | Magic links replaced passwords in Mar 2026 (4.2.008). Optional two-step sign-in for online-booking patients [C H14320730, H7258453] | **Basic in sprint**: magic-link portal, with patient accounts kept separate from staff accounts. The links are emails, so in the sprint they land in the outbox: real patients can't sign in until a live email account is connected (External) [portal, comms, rules] | *Was In sprint.* In the demo, open the link from the outbox |
| Diary & booking | Patient "app" | A home-screen shortcut to the booking site; no native app [C H4720209] | **Basic in sprint**: mobile web down to 375 px; no home-screen shortcut set up [rules; U] | |
| Diary & booking | Third-party booking (networks, outsourced reception) | Pronto networks and a 24/7 reception company book into sessions marked available online [C H4532319, H4548852] | **External**: needs network or partner agreements | |

Neither side has these:
- a self check-in kiosk (nothing found in 563 TM3 article titles [U]);
- native review requests (TM3 has none of its own [C absence, FM]);
- WhatsApp messages [U].

### 2.2 Patients & clinical

| Area | Feature | TM3 (detail + source) | Clinic system at end of sprint | Notes |
|---|---|---|---|---|
| Patients & clinical | Demographics and contacts | Title, names, gender, date of birth (can be made mandatory), address, phones, email, GP and emergency contacts. Also employer and renamable labels such as "NI Number" and "Hospital Code". A Hospital Number/ID field was added in 2026. No NHS number field is documented [C H4552565, H4448599, H16053641, H4585166] | **In sprint**: demographics, contacts and GP [foundation, records] | Extra numbers and renamable labels are [U] |
| Patients & clinical | Consent and marketing preferences | Consent level and marketing-contact preferences on the record; patients can edit them in the portal [C H4553480] | **In sprint**: consent flags and PECR marketing consent, with opt-out [foundation, comms] | Patients editing their own consent in the portal is [U] |
| Patients & clinical | Patient status (current, non-current, deceased) | Yes [C H6456590, H4553432] | **After sprint**: not in the brief [U] | |
| Patients & clinical | Alerts and clinical flags | Admin notes on the record can be set to require acknowledgement, and can be limited to certain viewers. Five configurable flag categories, such as red and black flags; a flag set to require acknowledgement alerts every time the case opens [C H4553140, H4448438] | **After sprint** | Worth bringing forward: it's a safety feature |
| Patients & clinical | Tags | Coloured tags on patients, stock and tasks, used in filters [C H6970787] | **After sprint** | |
| Patients & clinical | Merging duplicate patients | No real merge. The workaround moves the duplicate's billing items, deletes and rebooks its appointments by hand, then sets the duplicate to non-current [C H4553432] | **After sprint** | Both weak |
| Patients & clinical | Cases / episodes | Referral date and reason, diagnosis (with a code), body site, injury cause and pain scales. Statuses: Awaiting First Appointment, In Treatment, On Hold, Discharged, Incomplete. A finance summary [C H4448442, H4448436, H4448459, H4585166] | **In sprint**: each case has a payer: self-pay, insurer + membership number, or MLC/solicitor + reference [foundation, records] | The diagnosis code list and status set are [U] |
| Patients & clinical | Treatment authorisations | Code, start date, business, total appointments and/or value, expiry and linked case, with the amount remaining. The number remaining shows on the appointment [C H4553166, H13572225] | **In sprint**: code, sessions or value, expiry and remaining [foundation, records] | |
| Patients & clinical | Warning before authorisations expire | An "Auth Remaining" column in Appointment Analysis and an authorisations-remaining icon on the appointment. No expiry alert is documented [C H8570745, H13572225; U] | **In sprint**: a dashboard of authorisations about to expire [reporting] | A probable edge; confirm TM3 really has no alert |
| Patients & clinical | Referrers directory | Medical contacts (GP and others) and Businesses/Groups for insurers, MLCs and employers [C H4448464, H4538658] | **In sprint**: referrers directory [foundation] | |
| Patients & clinical | Clinical note templates | Five types: Consultation (first and follow-up), Assessment (one per body area if wanted), Modality, Discharge and Previous Medical History. 16 field types, including PSFS, slider, table and signature [C H4448427, H6241144, H4448444] | **Basic in sprint**: initial assessment (SOAP), follow-up and discharge templates, plus a template editor [records] | Fewer field types and no assessment library |
| Patients & clinical | Note-writing aids | Snippets (reusable text), highlights on the case summary, and consultation comparison for SOAP and templated consultations (restored Aug 2025) [C H4448426, H4448453, H11906413] | **After sprint**: not in the brief | A reviewer complained about not seeing old notes while writing [CAP snippet, not re-verified; may predate the comparison view] |
| Patients & clinical | Medical history across cases | A Previous Medical History template that follows the patient [C H4448457, H4448427] | **After sprint**: not in the brief [U] | |
| Patients & clinical | Body chart | Sketchpad: built-in or uploaded images, webcam photos, pencil, shapes, symbols and labels [C H4448454, H4448445] | **Basic in sprint**: front and back outlines with markers saved as data [records] | Markers can be searched and reported on; drawings can't [I] |
| Patients & clinical | Outcome measures | Scores & Goals: preset or custom scores with a min/max, recorded per case with a progress graph. A PSFS field type. VAS, NPRS and GROC in the MSKPN templates. Admission and discharge pain-scale fields on the case. No scored ODI, NDI or QuickDASH questionnaires are documented [C H4448440, H4448452, H6241144, H5450902, H4585166; U] | **In sprint**: NDI, ODI, NPRS, PSFS and QuickDASH, scored automatically [records] | Possible edge on scoring; ask Dell what TM3 shows him. **Licence check before real use:** the ODI is licensed through the Mapi Research Trust, and commercial and IT users must request a licence [C MAPI; PT-LIC]. NDI and QuickDASH terms are [U]. Goals and graphs aren't in the brief |
| Patients & clinical | Goals | Goal progress with notes, shown as a pie chart or graph [C H4448451] | **After sprint** | |
| Patients & clinical | Sign, lock and amend | Lock a consultation, after which "no further changes can be made", with "Post Close Notes" added afterwards. Case auto-lock became configurable in Feb 2026 (4.1.075). No change history is documented [C H4448455, H13601379; U] | **In sprint**: sign and lock; amendments with a visible history [records] | An edge if TM3 really has no history [U] |
| Patients & clinical | Incomplete-notes warning | A case shows as "Incomplete" when a consultation isn't linked to an appointment, is complete but not locked, or the case is discharged but not locked [C H4448459] | **After sprint** [U] | |
| Patients & clinical | Restrict a case to its own practitioner | Only the case owner (by default the admitting practitioner) and system administrators can view it [C H4769240] | **After sprint**: roles and site scoping only [reporting] | |
| Patients & clinical | Attachments | A Documents area with folders and sub-folders, drag-and-drop upload and many file types. Patients can upload through forms (10 MB, 2026) [C H4553291, H5926153, H15292176] | **Basic in sprint**: encrypted attachments with size limits; no folders and no patient uploads [records] | |
| Patients & clinical | Intake and consent forms | A drag-and-drop builder with 16 tools (including formula, BMI and signature) plus a file-upload box (2026). Answers can update record or clinical fields through a "reporting field". Forms can go out automatically on registration. Connect licences only [C H4529257, H4553508, H15292176] | **Basic in sprint**: fixed new-patient intake and consent forms with a typed e-signature, saved on the record [portal] | No builder and no field mapping |
| Patients & clinical | Forms on a clinic tablet | A security PIN locks later forms when the patient completes them on the clinic's device (3.6.52, Jul 2024) [C H9550936, H4553508] | **After sprint** | |
| Patients & clinical | Writing notes on a phone | Browser only: Chrome, or Safari on Mac and iOS. An iPhone calendar bug was fixed Jan 2026. One reviewer said note-writing on mobile was unusable [C H4448555, H13343784; claim FC; CAP snippet, not re-verified] | **Basic in sprint**: layouts down to 375 px are a sprint rule, not a tested feature [rules] | *Was In sprint.* Test on a real phone before claiming anything |

### 2.3 Letters & reports

| Area | Feature | TM3 (detail + source) | Clinic system at end of sprint | Notes |
|---|---|---|---|---|
| Letters & reports | Letter templates with merge fields | An in-app editor (bold, underline, bullets, images) with merge fields clicked in. Templates exist for 11 sections (appointments, businesses, cases, classes, contacts, forms, invoices, clients, payments, practitioners, waiting lists), as SMS, email, letter or print-out. Letters are filed to Documents [C H4448646, H4448649, H4585166, H4553210] | **In sprint**: letters with merge fields from patient, case, appointment and invoice, using the existing Word/RTF engine [integration, existing] | Templates are designed in Word, not in an in-app editor [I]. The integration module is the heaviest brief, so this may land Basic |
| Letters & reports | Use uploaded Word/RTF/PDF forms and templates in their own layout | **TM3 Web:** templates are built in the in-app editor; no Word/RTF upload is documented [C H4448646]. **TM3 Desktop:** uses its own .rtf letter templates (e.g. "Letter to Patient.rtf") with Desktop merge fields. Moving them to Web means pasting the text through Notepad and re-inserting every merge field by hand. TM3 says the two template sets are separate and use different merge fields [C H4448652, H4519454] | **Only us (vs TM3 Web)**: ClinForms already reads uploaded RTF, Word and PDF forms and keeps their layout. Desktop-style `<<…>>` codes become answer boxes today [existing R-rtf] | Filling TM3 merge codes from the record is on the separate onboarding branch, not this sprint [I]. Against TM3 Desktop's own templates this is parity, not an edge |
| Letters & reports | **Complete each referrer's own report form (MLC, insurer, solicitor) from the course of treatment** | Not built in. The merge-field list (last updated Nov 2023) covers case-level fields: diagnosis, referral reason, admission and discharge pain scale, patient outcome, number of appointments and one free-text "clinic notes" field. It has nothing from consultation or assessment notes, Scores & Goals or questionnaires [C H4585166]. With Heidi (an included integration on Better, plus a separate Heidi subscription), Heidi says it produces "insurer reports" from the same session [C P, HEIDI-TM3]. TM3 says field auto-fill needs Heidi's Practice plan [C H12684160]; Heidi says the TM3 integration is for its Practice and Enterprise plans [C HEIDI-TM3]. Heidi Forms fills PDFs only (Word must be saved as PDF) from a session [C HEIDI-FORMS] | **Only us**: "Complete referrer form" on a case reads the patient's registration, notes, appointments and outcome scores directly, with no upload. The clinician checks and approves, and the approved form is filed to the record. Works in the referrer's own Word, RTF or PDF layout [integration, existing ClinForms flow] | **The headline.** The native connector is new sprint work; the form engine is already live |
| Letters & reports | Discharge summary | The discharge template holds the discharge date, discharge pain scale and outcome; it can auto-lock. The letter is built from case fields. An NPS survey can go out by automation (Better tier) [C H4448427, H4448448, H7911835] | **In sprint**: discharge template plus letters [records, integration] | The NPS automation comes after the sprint |
| Letters & reports | Correspondence history | The Documents area logs letters, emails, SMS and uploads with timestamps [C H4553232] | **In sprint**: a message log per patient, and approved forms filed to the record [comms, integration] | Whether ordinary letters are filed automatically is [U] |
| Letters & reports | Reports to referral networks (Pronto) | Initial-assessment confirmation, interim and discharge reports sent to networks, with submitted/accepted/queried statuses [C H5661278, H5649498] | **External**: needs network agreements | |

### 2.4 Billing & payments

| Area | Feature | TM3 (detail + source) | Clinic system at end of sprint | Notes |
|---|---|---|---|---|
| Billing & payments | Invoices from appointments | Quick Bill on completion. Paid, part-paid and unpaid. Branded invoice and receipt, editable number, and a bespoke layout through support [C H4448527, H4549520, H4549009, FBI] | **In sprint**: invoices from appointments, as PDF, with sequential numbers per clinic [billing] | Fixed layout [I] |
| Billing & payments | VAT | On/off, rate and VAT number [C H4448612, H4448609] | **In sprint**: configurable; exempt by default for physio services [billing] | |
| Billing & payments | Insurer / MLC / solicitor accounts | An invoice can move to a business in full or in part, and back to the patient. Corporate billing [C H4549159, H4549112] | **In sprint**: insurer on account and MLC/solicitor on account [billing] | Our payer types are explicit; TM3 treats them all as businesses [I] |
| Billing & payments | Excess / shortfall | Part of an invoice moves to the business and the shortfall to the patient. No dedicated excess field [C H4448609; I] | **In sprint**: the excess is split between patient and insurer on the invoice [billing] | |
| Billing & payments | Price per payer | Pricing profiles per business (Apr 2026); "Custom payment rates" on Better and Best [C H14484180, P] | **In sprint**: price lists per service and payer [foundation, billing] | |
| Billing & payments | Credit notes, discounts, write-offs, refunds | All supported, with ledger codes [C H4448509, H4448510, H4448517, H4448521] | **Basic in sprint**: credit notes only [billing] | |
| Billing & payments | Record and allocate payments | Automatic matching to invoices, manual reconciliation, and payments from a business [C H4549423, H4557496] | **Basic in sprint**: cash, card and bank-transfer payments recorded. Automatic matching, and spreading one insurer payment over many invoices, aren't in the brief [billing; U] | *Was In sprint* |
| Billing & payments | Statements | Not documented [U] | **In sprint**: statements [billing] | |
| Billing & payments | Aged debt | Aged Debtors (0–30, 31–60, 61–90 and 91+ days) and debtors by account [C H8570786, H8570644] | **In sprint**: debtors / aged-debt report [billing, reporting] | |
| Billing & payments | Chasing unpaid invoices | "Chase now" on one or many invoices sends a payment link, followed by two reminders [C H6563773, H6364372] | **After sprint** | |
| Billing & payments | Online payment links | TM3Pay, run with its sister company ClearAccept (FCA-regulated): prepayment, card machines, payment links, online payment with saved cards and a phone (MOTO) virtual terminal. Apple Pay and Google Pay. Good tier [C H7266680, FP, P] | **External**: payment links in test mode only; going live needs an activated payments account [billing] | |
| Billing & payments | Card terminals and virtual terminal | Terminals are paired to a location; paying on the terminal marks the invoice paid; virtual terminal for phone payments [C H7266680] | **External**: needs a card-terminal provider | |
| Billing & payments | Saved cards, fees charged automatically, deposits | A card saved at booking can be charged a DNA fee. Deposits since Sep 2025. Since May 2026 there is a confirm prompt, and a two-day delay on invoice autopay, which ClearAccept asked for to comply with FCA guidelines [C H15068381, H4448483, H12427075, H6208692] | **External**: needs a live payments account, and the build itself comes after the sprint | |
| Billing & payments | Healthcode insurer e-billing | Export to VEDA with validation; web-service submission; procedure and diagnosis code mapping; remittance import (documented for TM3 Desktop, 2020); Membership Enquiry API lookup from the patient record (settings split Sep 2026). In every tier [C H4532399, H4890880, H4700000, H4701316, H16963704, H16963657, P] | **External**: an export interface clearly labelled "not connected yet"; needs Healthcode registration for the system [billing] | Registration is per practice system, so earlier ones don't carry over [C, Pabau guide]. Lead time est. 2–6 months [I] |
| Billing & payments | Packages, subscriptions, memberships | Bundles with usage and expiry, and subscriptions. Better tier [C H8173646, H8571066, P] | **After sprint** | |
| Billing & payments | Gift vouchers, discount codes | Yes [C H4448523, H9100043] | **After sprint** | |
| Billing & payments | Stock and retail | Physical stock, point of sale, low-stock alerts, barcodes/batches/expiry (Jun 2026) and transfers between sites [C FST, H15693535, H15693909] | **After sprint** | |
| Billing & payments | Expenditure | Expense forms, categories and a report [C H4448503, H8571040] | **After sprint** | |
| Billing & payments | Accounts export and ledger codes | CSV per ledger code and payment type; exporting locks the period. A financial lock date was added in 2024 [C H4548976, H4448611, H9550936] | **Basic in sprint**: CSV exports, without ledger codes or a period lock [billing, reporting] | |
| Billing & payments | Xero | Syncs new transactions only; invoices arrive as drafts. Needs the £30 Integration hub on Better [C H11703343, H16109210, P] | **After sprint** | |
| Billing & payments | Class (group) invoicing | Yes [C H5554110] | **After sprint** | |

### 2.5 Communications

| Area | Feature | TM3 (detail + source) | Clinic system at end of sprint | Notes |
|---|---|---|---|---|
| Communications | Booking and cancellation confirmations | Automatic, by text, email or both, with an optional copy to the clinic [C H4574944] | **In sprint**: templates and triggers. Messages are written to the outbox, not sent [comms] | Sending is External (see below) |
| Communications | Scheduled reminders | Any number of days before, at a set time (TM3 says the average is 2 days, around 09:30). Email is free. SMS costs 10.2p per 160 characters (article last updated Nov 2023) and must be activated on the licence [C H4574944] | **In sprint**: schedules (e.g. 24 h before) run by a cron route; messages go to the outbox, not sent [comms] | Sending is External |
| Communications | Messages actually reaching patients | SMS from a Blue Zinc number (replies go to an email address), a sender name (replies not supported) or the clinic's own verified mobile (replies go to that mobile). Email with sender-domain verification [C H4574944, H9036907] | **External**: needs SMS and email provider accounts and sender verification. No real messages are sent in the sprint [rules, comms] | The demo must say messages are recorded, not sent |
| Communications | Templates and merge fields | SMS, email, letter and print-out templates for 11 record types; reminder templates per location [C H4448649, H4448621, H4574928] | **In sprint**: templates with merge fields [comms] | Per-site templates are [U] |
| Communications | Two-way SMS (confirm or cancel by reply) | Marketing describes a dedicated practice number, conversations managed in TM3, and patients confirming from the message, with the diary updated [claim FS, re-checked 24 Oct]. The help centre (Nov 2023) documents only replies forwarded to an email address or a mobile [C H4574944] | **External**: reply handling (confirm/cancel) is modelled through a webhook interface but not live; needs an SMS number [comms] | Can't be demonstrated with a real phone |
| Communications | One-off messages from an appointment or record | Text, email or letter from an appointment; a manual reminder replaces the automatic one [C H4448485, H4448481, H4553181] | **After sprint**: not in the brief [U] | |
| Communications | Consent and opt-out | Bulk sends respect SMS and marketing consent [C H8425433, H4553480] | **In sprint**: PECR consent respected, with unsubscribe and opt-out [comms] | |
| Communications | Message log per patient | Yes [C H4553232] | **In sprint** [comms] | |
| Communications | Bulk messages and smart lists | Saved filters with bulk email, SMS, forms and tags; birthday lists [C H8425433, H8443276] | **After sprint** | |
| Communications | Automatic recall | 1–100 hours after a completed, cancelled or DNA appointment with nothing booked [C H6397509] | **After sprint** | |
| Communications | Automations | Triggers (appointment, case, invoice, form, authorisation threshold, package and others) that create tasks, tags, messages or forms. £0.05 ex VAT per action; 500 included on Better. A patient-source condition was added Jul 2026 [C H6975846, H15948152, P] | **After sprint** | |
| Communications | Journeys (multi-step workflows) | A Better add-on; sending forms became a journey action in Jul 2026 [C H14486313, H14288763, H15948152, P] | **After sprint** | |
| Communications | NPS / feedback surveys | An NPS form, sent automatically on discharge, with an NPS report. Custom questions need a paid bespoke report [C H7911835] | **After sprint** | |

### 2.6 Reporting & admin

| Area | Feature | TM3 (detail + source) | Clinic system at end of sprint | Notes |
|---|---|---|---|---|
| Reporting & admin | Dashboard | Home dashboard with the agenda and dynamic figures; financial and reporting figures only for permitted roles [C H4448556] | **In sprint**: dashboards [reporting] | |
| Reporting & admin | Utilisation | Weekly utilisation % per practitioner per location (Practitioner Availability report) [C H8570759] | **In sprint**: by practitioner, site **and room** [reporting] | Room utilisation in TM3 is [U] |
| Reporting & admin | DNA and late-cancel rates | Appointment Analysis and Non Actioned Appointments reports [C H8570745, H8570644] | **In sprint** [reporting] | |
| Reporting & admin | New vs returning patients | Marketed KPI; Patient Analysis and Non Returning Patients reports [claim FR; C H8570644] | **In sprint** [reporting] | |
| Reporting & admin | Revenue and outstanding debt | Income Analysis, Aged Debtors and Debtors by Account [C H8571047, H8570786] | **In sprint** [reporting, billing] | |
| Reporting & admin | Standard report library | 27 reports: 3 client, 6 clinical, 7 diary and 11 finance, with filters, grouping, CSV/Excel export and saved presets [C H8570644, H8571047] | **Basic in sprint**: a smaller fixed set plus CSV exports [reporting] | Saved presets are [U] |
| Reporting & admin | Clinical reports | Admissions Analysis, Average Treatments, Cases Due for Review, Current Case Load, Discharge Analysis and Lapsed Patients [C H4548728, H8570644] | **After sprint**: not in the brief | |
| Reporting & admin | Outcome exports (Physio First DFI, MSKPN) | Yes [C H6211834, H5450902] | **After sprint** | |
| Reporting & admin | Custom and bespoke reports, data warehouse | Saved layouts of existing reports. Bespoke reports are a paid Better add-on; the data warehouse is a Best add-on [C H4548784, P] | **After sprint**: CSV only | |
| Reporting & admin | Settings: sites, rooms, services, prices, practitioners, opening hours | Yes [C H4448621, H4448630, H4582616, H4448628] | **In sprint** [reporting] | |
| Reporting & admin | Staff roles | A user level on each user decides what they can access; a role manager is on Best [C H4574721, H4448645, P] | **In sprint**: owner, admin, reception and practitioner [reporting] | Fixed roles; no custom role builder |
| Reporting & admin | Staff limited to their own sites | "The user can only see the diary for the locations they have assigned to them" [C H4448645] | **In sprint**: site scoping [reporting] | |
| Reporting & admin | Audit search | The audit tool logs update, create, delete **and view** actions, by user and patient, with search. "Audit" is listed on the Best tier [C H4448597, H4448598, P] | **Basic in sprint**: every change is audited, with a per-patient view and a clinic-wide search, on every clinic. Logging who viewed a record isn't in the brief [records, reporting, rules; I] | *Was In sprint.* Ours is standard on every clinic; TM3's also covers views |
| Reporting & admin | Tasks and teams | A Tasks page (mine, all, overdue, priority; linked records) and teams with a shared email (2026) [C H14283369, H4448557, H14287235] | **After sprint** | |

### 2.7 Platform & security

| Area | Feature | TM3 (detail + source) | Clinic system at end of sprint | Notes |
|---|---|---|---|---|
| Platform & security | Two-step sign-in for staff | Authenticator app, or an SMS code if a mobile is on the account, plus passkeys. An admin can enable or enforce it, and it can be offered to online-booking patients [C H7258453] | **In sprint (existing)**: required for every user and can't be switched off; authenticator app plus backup codes [existing R-auth] | No passkeys or SMS codes |
| Platform & security | SSO and IP allow-list | Best tier [C P] | **After sprint** | |
| Platform & security | Encryption of clinical data | Encrypted "in transit … and at rest"; marketing also says "end-to-end encryption" [claim FSC] | **In sprint (existing)**: clinical free text and files encrypted with a key derived for each clinic and bound to each record (AES-256-GCM) [existing R-crypto, rules] | *Was Only us.* TM3 doesn't describe its key model [U], so present this as our design, not as a TM3 weakness |
| Platform & security | Subject access request | "Download Patient Details" lets staff choose what to include, runs in the background and emails when ready; the format isn't documented [C H4553499] | **In sprint**: export as PDF or JSON [records] | |
| Platform & security | Anonymise a patient | Removes the patient; can't be undone, even by TM3. No retention checks are documented [C H4552757] | **In sprint**: an anonymise action [records] | Must be refused inside the retention period [I]; the build should state this |
| Platform & security | Retention of clinical records | No retention settings published [U FAQ]. After an exit export, TM3 permanently deletes the data [C H4585360] | **Basic in sprint**: no automatic deletion of clinical records is a sprint rule. An 8-year adult default is stated as configurable, but no module brief owns a retention setting [rules; I] | *Was In sprint* |
| Platform & security | Hosting and backups | UK data centres (provider not named) and "continuous, real-time backups" [claim FSC] | **Basic in sprint**: database in the EU jurisdiction and the app in a London region today; a London Postgres database is planned before any real clinic data [existing R-arch] | Not UK-only yet |
| Platform & security | ISO 27001 / Cyber Essentials | ISO 27001 certification is claimed, without naming the certifier or scope; a Cyber Essentials badge is shown [claim FSC, HOME, P] | **External**: needs an accredited assessment | Neither side claims the NHS DSPT [U] |
| Platform & security | Status page and uptime | A public status page. On 24 Oct it showed TM3 at 100%, 99.993% and 99.987% over its windows [C ST, point in time] | **After sprint** | |
| Platform & security | Support and SLA | UK live chat and email, Mon–Fri 08:00–17:30. Marketing gives an average response under five minutes and remote-desktop help. The SLA schedule isn't published. Only older articles (2023) give a support phone number [C H4536442, H4574944, MSA; claim FSU] | **After sprint**: needs a support-cover arrangement; today cover is evenings and weekends [I] | Together with Healthcode, the biggest risk for a buyer |
| Platform & security | Phones, tablets and accessibility | Browser only: Chrome, or Safari on Mac and iOS. iPhone diary bugs were fixed Nov 2025–Jan 2026. Accessibility isn't documented [C H4448555, H13343784; U] | **Basic in sprint**: responsive to 375 px, keyboard use, labels and contrast are sprint rules; no formal accessibility audit is planned [rules; I] | *Was In sprint* |

### 2.8 Integrations & migration

| Area | Feature | TM3 (detail + source) | Clinic system at end of sprint | Notes |
|---|---|---|---|---|
| Integrations & migration | Import from TM3 | TM3's exit export has four parts [C H4585360]:<br>• CSV files of the raw tables;<br>• a Letters folder;<br>• clinical notes as a PDF per patient and case (cases created in TM3 Desktop come as CSV data only, with no PDF);<br>• SARs.<br>The account manager may have to enable it. Access ends once extraction starts, and TM3 later deletes the data. TM3's own import service names 11 source systems [C FMG] | **Basic in sprint**: CSV import of patients, cases, appointments and invoices, with column mapping, a dry run, a staff check and rollback per batch. Built against fictional TM3-like files [integration] | Must be proven on a real TM3 export before anything is promised |
| Integrations & migration | TM3 clinical notes (PDF) and documents | Exported as PDFs and files, except Desktop cases [C H4585360] | **After sprint**: not imported into the new record. ClinForms can already read these PDFs when completing reports [existing] | |
| Integrations & migration | Exercise prescription | Physitrack, Physiotools, Salaso, Exercise Prescriber and PhysioTec. Good tier ("Exercise software integration") [C H4448434, H4448433, H4448435, H4448431, FI, P] | **After sprint** | Clinicians can keep using their exercise app on its own |
| Integrations & migration | Note-writing scribe | The Heidi integration (included on Better). Free/Pro Heidi plans copy and paste notes; the Practice plan fills fields automatically [C H12684160, H12684118, P] | **After sprint**: not in scope | Don't raise this with Dell (no AI wording) |
| Integrations & migration | Marketing tools (Mailchimp, HubSpot, Pipedrive) | Mailchimp on Better; HubSpot and Pipedrive through the £30 Integration hub [C H4550238, P] | **After sprint** | |
| Integrations & migration | Booking analytics (GA4 / Tag Manager) | Yes [C H5279740] | **After sprint** | |
| Integrations & migration | Referral networks (Pronto) and referral portal | Pronto Direct receives referrals and treatment authorisations in real time. The current sources named (2021 article) are Vita Health Group and Physio First. The referral portal for businesses is a Better add-on [C H4560121, H4560126, H14486960, P] | **External**: needs network agreements; our own portal would come after the sprint | |
| Integrations & migration | Public API, data warehouse | Best-tier add-ons; no public developer docs [C P] | **After sprint** | |

---

## 3. Top 10 things TM3 has that we won't have at the end of the sprint

Ranked by how much they matter to an 11-site physio group with a mix of MLC, PMI and self-pay patients [I].

1. **Healthcode insurer e-billing** (External). TM3 submits to VEDA, imports remittances and looks up membership [C H4890880, H16963704]. Insurers such as Vitality accept invoices only through Healthcode. Registration is per practice system, and the lead time is estimated at 2–6 months [I].
2. **Messages that actually reach patients** (External). This covers live SMS and email reminders, confirmations, two-way replies and patient sign-in links. We record messages in an outbox; nothing is sent [C H4574944; comms, portal].
3. **Live card payments** (External). Terminals in clinic, payment links, a phone virtual terminal, saved cards, automatic DNA fees and deposits. Ours are test mode only [C H7266680, H12427075].
4. **Trust signals and support.**
   - ISO 27001 and Cyber Essentials (External).
   - A public status page, UK business-hours chat and email support, and a UK-only database (all After sprint).
   - An audit trail that also records who viewed a record (After sprint).
   - Sources: [C FSC, ST, H4536442, H4448597].
5. **A full online-booking flow** (After sprint). Paying or leaving a deposit at booking, insured patients booking themselves, booking rules per service, forms inside booking, and add-on and companion bookings [C H12427075, H14033968, H15886814].
6. **A form builder that writes answers into the record** (After sprint). Answers mapped to fields, file uploads, and a clinic-tablet mode. Ours are fixed intake and consent forms [C H4529257, H9550936].
7. **Depth in clinical notes** (Basic or After sprint).
   - An assessment library per body area, 16 field types, snippets, highlights, consultation comparison, and medical history carried across cases.
   - A full drawing body chart and goals.
   - **Red/black flags and alerts that can be set to require acknowledgement.**
   - Sources: [C H4448427, H6241144, H4448438, H4553140, H4448454, H11906413].
8. **Automation and marketing** (After sprint). Bulk messages, recalls, automations, Journeys, NPS surveys, Mailchimp, and tasks and teams [C H6975846, H6397509, H7911835, H14283369].
9. **Reporting breadth** (Basic or After sprint).
   - 27 standard reports with saved presets.
   - Clinical case-load and discharge reports.
   - Physio First DFI and MSKPN outcome exports.
   - Sources: [C H8570644, H4548728, H6211834].
10. **The long tail** (After sprint). Classes and courses, video appointments, packages, subscriptions and vouchers, stock and retail, expenditure, Xero sync and ledger codes, exercise-prescription integrations, and calendar sync [C P, H4522869, H4573123, H8173646, H11703343; claim FD].

**Not a TM3 feature, but needed before anyone switches:**
- Our TM3 import is tested only on fictional files.
- Clinical-note PDFs and documents are not imported.
- TM3 cuts off access when its exit export starts, and cases created in TM3 Desktop come out as CSV data only, with no PDF [C H4585360].

## 4. Where we are ahead

**These depend on what the sprint actually delivers, so verify each one in the demo build.**

1. **The referrer's own report form, completed from the course of treatment.**
   - Registration, notes, appointments and outcome scores are read straight from the record, with no upload.
   - The form keeps the MLC's, insurer's or solicitor's own Word, RTF or PDF layout.
   - The clinician signs off, and the approved form is filed back to the record.
   - TM3 has no merge field for note content or scores beyond case-level pain scales [C H4585166].
   - TM3's nearest route is a separate scribe subscription that produces "insurer reports" from the same session in its own format [C HEIDI-TM3]. That scribe's form filler takes PDFs only [C HEIDI-FORMS].
   - Competitor research found none of Cliniko, WriteUpp, Jane or Semble doing this natively [C in competitors.md, not re-checked here].
2. **Uploaded Word, RTF and PDF forms work in their own layout**, including TM3 Desktop-style `<<…>>` codes, which become answer boxes. In TM3 Web, Desktop templates must be rebuilt by hand [C H4448652]. Compared with TM3 Desktop's own templates this is parity, so say "your referrers' forms", not "your letter templates".
3. **Rooms are built in, and room clashes are blocked by the database.** TM3 sells Rooms as a separate module, and its double-booking rule is a marketing claim with no documented mechanism [C H4448494; claim FD].
4. **Funded-work tracking.**
   - Explicit payer types: insurer with membership number, MLC or solicitor with reference.
   - Authorisations with the amount remaining, and a dashboard of those about to expire.
   - The excess split on the invoice.
   - TM3 shows the authorisations remaining but documents no expiry alert [C H13572225; U].
5. **Outcome questionnaires scored automatically** (NDI, ODI, QuickDASH, NPRS, PSFS). They feed referrer forms. TM3 documents single-number scores with a graph [C H4448440, H4448452; U for scored questionnaires]. Licences need checking before real use [C MAPI; U].
6. **Security basics on every clinic, not a premium tier.**
   - Every change is audited on every clinic; TM3 lists Audit, SSO and the role manager on Best [C P]. TM3's audit also records views, and ours doesn't (see 2.6).
   - Two-step sign-in is required for everyone [existing].
   - Amendments to signed notes have a visible history [records; TM3 history U].
7. **Concurrent-edit safety and UK clock changes** handled by design. TM3 crashed on some concurrent reschedules or deletes until Jun 2026 [C H15588496].
8. **Per-clinic pricing, without per-message or per-action charges** [I: pricing not set]. This is a proposition, not a sprint deliverable. TM3 charges per user plus per-use costs:
   - SMS;
   - £0.05 per automation action;
   - Connect for Insurance at £10 per licence;
   - £1 ex VAT per appointment for pay-as-you-go practitioners.

   Sources: [C P, H6975846, H6890818].

**Possible edges, not to be claimed yet:**
- a week view with several practitioners or rooms side by side (our brief doesn't say so explicitly, and TM3's limit is documented only before its 2025 redesign [C H4448488, dated Jun 2025]);
- per-clinic encryption keys (our design; TM3's key model is [U]).

## 5. What to say to Dell

This is customer-safe. It has no AI or vendor wording and no dates, it doesn't call the clinic system a replacement for anything, and it doesn't promise anything outside the briefs.

> The clinic system is built around the work your team does every day. It has a diary across all your sites, with rooms built in and double bookings blocked. Patient records hold insurer and medico-legal cases with their authorisations. Clinical notes have sign-off and a visible amendment history, and outcome questionnaires are scored for you. Invoicing covers patients, insurers and medico-legal companies, including excess splits. Appointment confirmations and reminders, online booking with intake and consent forms, a patient portal, and reports by site, practitioner and room are all part of it. What it adds is the part your physios do by hand today. Each referrer's own report form is completed from the patient's notes, appointments and scores, in that referrer's own Word, RTF or PDF layout, for the physio to check and sign, and it is filed back to the record. In the demo, some things are deliberately not switched on. Messages, including patient sign-in links, are recorded rather than sent. Card payments are in test mode, and insurer e-billing isn't connected. Those need accounts and approvals from outside providers, which we would set up with you before any site moved. Classes, video consultations, packages and stock aren't part of this version. It would help us to know which parts of your current system your team relies on most, so we can show you those first.

Before saying "double bookings blocked", "scored for you" or "amendment history", confirm that each one works in the verified demo build.

## 6. Questions for Dell

These are spoken questions, so they contain no vendor names. Ask only what he is free to share. TM3's pricing and contract terms are confidential under the MSA (cl. 1.4, 10), so **don't ask for his invoice, his contract or screenshots of his current system**.

1. Does the team use the browser version of your current system, the installed desktop version, or both?
   *Internal:* his `<<P_…>>` RTF templates suggest Desktop letters. Cases created in Desktop export as CSV only, not PDF [C H4585360].
2. Which of these do you use day to day?
   - Insurer e-billing, and who handles remittances?
   - Card machines or payment links?
   - Online booking?
   - Text reminders, and who reads the replies?
   - Waiting list, recalls, automations or feedback surveys?
3. Do you run classes or video appointments? Do you sell packages or stock? Do you sync to accounting software?
4. Does reception book across sites centrally, or one site at a time? Do they need a room view, or a week view across practitioners?
5. Which note templates do clinicians use (assessments per body area?), and do they record PSFS or other scores? Do they use red/black-flag alerts?
6. For insurer and medico-legal patients, who enters authorisations, and how do you know when one is about to run out?
7. Which reports do you run every week or month? Do you pay for bespoke reports?
8. Roughly how many patients and cases are there, and how far back does the history go?

## 7. Internal cautions (Khuram)

- **Statuses are plans, not results.** Seven modules built in parallel in a week is ambitious. Expect more "In sprint" rows to land as Basic, especially in records (the longest brief) and integration (connector, letters and import together). The conservative calls already made:
  - drag-and-drop is Basic;
  - two-way SMS is External;
  - the portal, patient sign-in, online booking and import are Basic;
  - the week view across resources, booking against case and authorisation, payment allocation, audit search, retention, mobile note-writing and accessibility are all Basic;
  - encryption is no longer Only us.
- **The outbox caveat applies wherever messages are involved:** confirmations, reminders, waiting-list offers, unsubscribe links and patient magic links. None reaches a real patient until a live provider is connected (External).
- **Our claims that rest on TM3 "not documented" are [U]:**
  - expiry alerts;
  - scored questionnaires;
  - change history on notes;
  - the key model;
  - statements;
  - the week-view limit after the 2025 redesign.

  Present them as what we do, not as what TM3 can't do.
- **Help-centre dates.** Several key TM3 articles were last updated in 2020–2023, and some diary ones in June 2025, before TM3's August 2025 redesign. The product may be ahead of its documentation.
- **Licences for outcome measures.** The ODI is licensed through the Mapi Research Trust, and commercial and IT users must request a licence [C MAPI; PT-LIC]. Check ODI, NDI and QuickDASH terms before any real clinic uses the scored versions. The sprint rule "never commit third-party templates" may also apply to their item wording [I].
- **TM3 moves fast.** It releases every 1–3 weeks. Since Sep 2025 it has added deposits, Connect for Insurance, magic links, skills on stock and working times, a new booking flow and Journeys actions [C release notes; H12427075, H14033747, H14320730, H15520284, H15886814, H15948152]. Any parity claim dates quickly.
- **Commercial context.**
  - The MSA gives TM3 a perpetual, irrevocable licence to use cleansed (anonymised) client data [C MSA cl. 11.3].
  - Fees rise 5% a year, or by up to 8% if the supplier notifies [C MSA cl. 6.7].
  - 90 days' notice is needed before the end of the minimum or renewal term [C MSA cl. 8.1].
  - TM3 is traded by Clearcourse Business Services Ltd, and TM3Pay runs with its sister company ClearAccept [C P, H7266680].

  These are useful background, but let Dell raise his own terms.
- **Market satisfaction.**
  - In a survey of 715 UK clinic owners (Aug–Nov 2025), TM3 scored 6.00/10 from 30 mentions. That is joint lowest with a system that had a single mention; Cliniko led with 8.41 [C HMDG].
  - The survey says large clinics stay on legacy systems "because the switching cost is high" [C HMDG].
  - That cost is the real barrier: data migration, Healthcode re-registration, card machines and retraining across 11 sites.

## 8. Competitor context (key rows only)

Competitor cells come from `competitors.md` (24 Oct). Only the TM3 and Heidi cells were re-checked in this pass.

| Row | TM3 | Cliniko | WriteUpp | Jane | Semble | Clinic system (sprint end) |
|---|---|---|---|---|---|---|
| List price, 10 clinicians | £390 / £550 / £700 + add-ons [C P] | $195 flat; admin users free [C CLK-P] | about £166 (Group plan); 50% off until Jan 2027 [C WU-P] | £44 + extra licences (UK price [U]) [C JANE-P] | Quote only [C SEM] | Per clinic, not set [I] |
| Healthcode | Most mature [C] | None native; third-party Effra [C CLK-EFFRA] | Native [C WU-HC] | Open beta; batch file uploaded by hand [C JANE-HC] | Native, 15 insurers [C SEM-HC] | External |
| Built-in scribe | Via Heidi [C H12684160] | Third-party apps only [C CLK-AI] | Native, £23.95 per user [C WU-P] | Native, £15 per practitioner [C JANE-AI] | Via Heidi [C SEM-HEIDI] | None |
| Rooms | Paid module [C H4448494] | [U] | Workaround that doesn't stop double booking [C WU-ROOMS] | Thrive tier [C JANE-P] | [U] | Built in, clashes blocked |
| Referrer's own form from notes | No. Heidi produces insurer reports from one session in its own format, and Heidi Forms is PDF-only (Word must be saved as PDF), from a session, on a separate subscription [C HEIDI-TM3, HEIDI-FORMS] | No [C CLK-HR] | No [C WU-F] | Fillable PDF from admin data only [C JANE-FF] | No [C SEM-LT] | **Yes** (Word, RTF, PDF; whole course of treatment) |

---

## Appendix A. Fact-check log (55 TM3 claims re-opened on 24 Oct 2026)

Result: **37 confirmed as written; 18 corrected, re-cited or downgraded** (marked ✗).

| # | Claim in the draft | Source re-opened | Result | Change |
|---|---|---|---|---|
| 1 | Week view only with one practitioner | H4448488 | Confirmed, but the article is dated 17 Jun 2025, before the Aug 2025 redesign | ✗ Date added; Only us downgraded (Appendix B) |
| 2 | Rooms is a separate module sold through sales | H4448494, P | Confirmed; Rooms isn't on the pricing page | – |
| 3 | Room selection can be mandatory; cancellation notice in days | H4582725 | Confirmed | – |
| 4 | Drag-and-drop and 30-second auto-refresh restored Aug 2025 | H11906413 | Confirmed; the same note restored consultation comparison | Added to note-writing aids |
| 5 | Merge fields "from 13 object groups" | H4448646, H4585166 | Templates cover 11 sections | ✗ Now "11 sections" |
| 6 | "TM3 Desktop: RTF templates have to be copied in as text and every merge field re-inserted" | H4448652, H4519454 | **Mis-attributed.** Desktop uses its own .rtf templates; copy-and-re-insert applies when moving them to Web | ✗ Row rewritten; Only us narrowed to "vs TM3 Web" |
| 7 | "TM3 says the two template sets are unrelated" | H4519454 | TM3 says they are separate, with different merge fields | ✗ Wording fixed |
| 8 | No merge field brings in notes, scores or goals | H4585166 | Notes, Scores & Goals: confirmed (list updated Nov 2023). But the case has admission/discharge pain-scale and patient-outcome fields | ✗ Qualified |
| 9 | Heidi field auto-fill needs the Practice plan; otherwise copy and paste | H12684160, HEIDI-TM3 | Confirmed. Heidi's own page says Practice/Enterprise | Added |
| 10 | Heidi drafts insurer reports from a session | HEIDI-TM3 | Confirmed ("insurer reports … from the same session") | – |
| 11 | Heidi Forms is PDF-only, from one session | HEIDI-FORMS | Confirmed; Word must be saved as PDF. The cited Sep 2026 Heidi changelog says nothing about forms | ✗ Changelog removed as a source |
| 12 | Tiers £39/£55/£70 and tier contents | P | Confirmed 24 Oct; the footer names Clearcourse Business Services Ltd T/A TM3 | Entity note added |
| 13 | Connect for Insurance "£10 per practitioner per month" | P, FCI | Pricing page: "£10 per licence". Feature page: £10 per practitioner per month "for a limited time" | ✗ Both quoted |
| 14 | Connect for Insurance saves the authorisation code as a note | H14033968 | Confirmed | – |
| 15 | Connect for Insurance: "a card covers the excess" | H14033968, H14033747, FCI | Not in the help articles; marketing only | ✗ Tagged claim FCI |
| 16 | Waiting list sends a text with an accept/decline link and a timed offer | H4769222, H4585166, FD | The text says patients are "notified", with a response window; the channel and accept/decline are only in a video. Marketing says the team offers the slot "with a click" | ✗ Detail downgraded to [U] |
| 17 | Skills (Jun 2026) | H15520312, H15520284, H11906413 | Jun 2026 extended skills; a skills fix appears Aug 2025, so skills existed earlier | ✗ Date fixed in 2.1 and §7 |
| 18 | One edit applies to all linked bookings (Jun 2026) | H15326915 | Confirmed; only "Booked" appointments | Condition added |
| 19 | Concurrent-move crash fixed Jun 2026 | H15588496 | Confirmed (reschedule/delete after another user's change, without refresh) | Wording sharpened |
| 20 | Magic links replaced passwords Mar 2026 | H14320730 | Confirmed (30 Mar 2026) | – |
| 21 | Deposit options; a failed payment blocks the booking | H12427075, H14320730 | Confirmed; deposits also scope to online, in-app or all bookings | Detail added |
| 22 | Patient "app" is a home-screen shortcut | H4720209 | Confirmed | – |
| 23 | SMS 10.2p per 160 characters; replies to email; sender name blocks replies | H4574944 | Confirmed (Nov 2023) | – |
| 24 | Two-way SMS with diary update (marketing) | FS | Confirmed as a marketing claim | – |
| 25 | Audit logs creates, updates, deletes and views | H4448597, H4448598 | Confirmed | Used in Appendix B (ours logs writes only) |
| 26 | Two-step sign-in by app or SMS, plus passkeys; can be enforced | H7258453 | Confirmed; also optional for online-booking patients | Detail added |
| 27 | SAR download runs in the background and emails when ready | H4553499 | Confirmed | – |
| 28 | Anonymise can't be undone | H4552757 | Confirmed | – |
| 29 | Exit export is "raw CSV/JSON tables" plus PDFs; access ends | H4585360 | CSV only, no JSON; also Letters and SAR folders; Desktop cases aren't exported to PDF | ✗ Fixed |
| 30 | Aged-debt buckets 0–30/31–60/61–90/91+ | H8570786 | Confirmed | – |
| 31 | Utilisation as weekly % per practitioner per site | H8570759 | Confirmed | – |
| 32 | Users see only their own locations' diaries | H4448645 | Confirmed | – |
| 33 | About 27 standard reports | H8570644 | Confirmed: 3 + 6 + 7 + 11 = 27 | "About" removed |
| 34 | Automations £0.05 per action; 500 included on Better | H6975846, P | Confirmed | – |
| 35 | Healthcode Membership Enquiry API (Sep 2026) | H16963704, H16963657 | Confirmed | – |
| 36 | Remittance import documented for Desktop | H4701316 | Confirmed (2020 article) | – |
| 37 | Pay-as-you-go £1 per appointment, cited to H4552543 | H4552543, H6890818 | H4552543 gives no price; the £1 ex VAT figure is in H6890818 | ✗ Citation fixed |
| 38 | Form builder with 17 field types and field mapping | H4529257, H15292176 | 16 tools plus an upload box = 17; Connect licences only | Detail added |
| 39 | Clinic-tablet PIN | H9550936 | Confirmed (Jul 2024) | – |
| 40 | Five clinical template types; 16 field types including PSFS | H4448427, H6241144 | Confirmed | – |
| 41 | Admin notes "must be acknowledged each time the record opens" | H4553140, H4448438 | Acknowledgement is optional on admin notes and flags | ✗ Wording fixed |
| 42 | Lock with no unlock; post-close notes; auto-lock timers | H4448455, H13601379 | Confirmed; auto-lock became configurable Feb 2026 | – |
| 43 | Incomplete notes shown as "a red bar counting consultations" | H4448459 | Not in the text; the article describes an "Incomplete" case status with three causes | ✗ Rewritten |
| 44 | Saved-card confirm prompt and two-day autopay delay at the provider's request | H15068381 | Confirmed (ClearAccept, FCA guidelines) | – |
| 45 | Appointment statuses and icons | H13572225 | Confirmed (updated 1 Oct 2026) | – |
| 46 | "One terminal per site" | H7266680 | Terminals are paired to a location; "one per site" isn't stated | ✗ Wording fixed |
| 47 | Support by "UK chat … plus email and phone" | H4536442, FSU | Current pages give live chat and email only; a phone number appears only in 2023 articles | ✗ Wording fixed |
| 48 | Status page shows 99.987% | ST | Confirmed on 24 Oct (100% / 99.993% / 99.987%) | Marked point in time |
| 49 | UK data centres, ISO 27001, real-time backups | FSC | Confirmed as marketing claims | Tagged claim |
| 50 | MSA: fees rise "5–8% a year"; 90 days' notice; perpetual data licence | MSA v5.3 | Confirmed; cl. 6.7 is 5% a year, or up to 8% if notified; cl. 11.3 covers cleansed data | ✗ Wording fixed |
| 51 | HMDG: TM3 6.0/10, "the lowest of the named systems" | HMDG | 6.00 from only 30 TM3 mentions; joint lowest with a system that had 1 mention | ✗ Wording fixed |
| 52 | Calendar sync, buffers, equipment diaries, no double booking | FD | Confirmed as marketing claims | – |
| 53 | Pronto sources are Vita Health Group and Physio First | H4560126 | Confirmed (2021 article) | Date noted |
| 54 | TM3's import service names 11 systems | FMG | Confirmed | – |
| 55 | Attachments in folders; 10 MB patient uploads | H5926153, H15292176 | Confirmed | – |

## Appendix B. Honesty check of the Clinic-system column

Each status was checked against the MODULES briefs and the CTX rules in the workflow script.

| Row | Draft | Final | Why |
|---|---|---|---|
| Week view across several practitioners or rooms | Only us | Basic in sprint | The brief says "day/week resource views (columns per practitioner/room)" but doesn't say several resources in week view. TM3's limit is documented only before its redesign |
| Reception books from a slot (case, payer, authorisation) | In sprint | Basic in sprint | Choosing the case, payer and authorisation at booking, and drawing it down, is implied, not stated |
| Patient sign-in (magic link) | In sprint | Basic in sprint | Links are emails, and the sprint sends nothing (outbox only). Real patients need a live email account (External) |
| Writing notes on a phone | In sprint | Basic in sprint | 375 px is a layout rule, not a tested feature |
| Record and allocate payments | In sprint | Basic in sprint | The brief records payments only; matching and allocation aren't in it |
| Audit search | In sprint | Basic in sprint | The brief audits writes; TM3 also logs views |
| Encryption of clinical data | Only us | In sprint (existing) | "Only us" rested on TM3 not describing its key model [U] |
| Retention of clinical records | In sprint | Basic in sprint | A rule ("no auto-delete"), with no module owning a retention setting |
| Phones, tablets and accessibility | In sprint | Basic in sprint | Sprint rules, with no accessibility audit |

**Kept as In sprint, with a caution in the cell:**
- outcome measures (licences);
- letters (the integration module is the heaviest);
- confirmations and reminders (outbox only);
- patient cancel/rebook (depends on sign-in);
- room diary (our pricing isn't set).

**External rows.** All 10 say plainly that they are not live:
- Healthcode: "not connected yet";
- payment links: test mode;
- terminals and saved cards: not built or not connected;
- SMS and email: outbox only;
- two-way SMS: modelled, not live;
- ISO 27001 and Cyber Essentials;
- Pronto, in three rows.

None is counted as available in §1, claimed in §4 or implied as working in §5.

**Customer-facing text.**
- §5:
  - removed "Your existing Word and RTF templates work as they are" (TM3 merge codes in letter templates aren't filled from the record in this sprint);
  - "rooms included" became "rooms built in" (pricing isn't set);
  - "aren't included yet" became "aren't part of this version" (no implied timeline);
  - added that sign-in links are recorded, not sent.
- §6: vendor names removed from the spoken questions.
- Neither section has any AI wording, product-vendor names, dates or "replacement" wording.

---

## Sources

**TM3 website and contract** (all re-fetched 24 Oct 2026 unless noted)

- P: https://tm3app.com/pricing/
- HOME: https://tm3app.com/
- FD: https://tm3app.com/features/appointments-and-diaries/
- FB: https://tm3app.com/features/online-booking-patient-portal/
- FS: https://tm3app.com/features/email-and-sms/
- FM: https://tm3app.com/features/marketing/
- FI: https://tm3app.com/features/integrations/
- FCI: https://tm3app.com/features/connect-for-insurance/
- FC: https://tm3app.com/features/clinical-records/
- FBI: https://tm3app.com/features/billing-and-invoicing/
- FP: https://tm3app.com/features/integrated-payments/
- FR: https://tm3app.com/features/reporting-and-analytics/
- FSC: https://tm3app.com/features/security-and-compliance/
- FST: https://tm3app.com/features/stock-and-retail/ (not re-fetched)
- FSU: https://tm3app.com/features/customer-support/
- FMG: https://tm3app.com/migrating-to-tm3/
- FAQ: https://tm3app.com/faqs/ (not re-fetched)
- MSA: https://tm3app.com/wordpress_tm3/wp-content/uploads/2025/11/MS-UK.pdf (UK MSA v5.3, 21 Nov 2025; local copy re-read)
- ST: https://status.blue-zinc.com/
- Release notes: https://help.tm3app.com/en/collections/17756461-tm3-2026-release-build-notes ; https://help.tm3app.com/en/collections/14346417-tm3-2025-release-build-notes

**Reviews, third parties and competitors**

- CAP: https://www.capterra.com/p/27328/TM2/reviews/ (search snippets only; direct fetch blocked; not re-verified)
- HMDG: https://hmdg.co.uk/private-practice-barometer/ai-software-tools-physiotherapy-clinics-uk-2026/ (re-checked 24 Oct)
- HEIDI-TM3: https://www.heidihealth.com/en-gb/integrations/tm3 (re-checked 24 Oct)
- HEIDI-FORMS: https://support.heidihealth.com/en/articles/11668834-form-filling (re-checked 24 Oct; the Sep 2026 changelog was removed as a source)
- MAPI: https://www.mapi-trust.org/news-events/news/the-oswestry-disability-i (ODI licensed through the Mapi Research Trust)
- PT-LIC: https://support.physitrack.com/article/769-licensing-outcome-measures (an exercise-software vendor's note on licensing third-party outcome measures; secondary)
- Pabau guide: https://support.pabau.com/en/pabau2/how-to-integrate-with-healthcode (Healthcode registration is per PMS)
- CLK-P: https://www.cliniko.com/pricing/
- CLK-EFFRA: https://www.cliniko.com/connected-apps/effra
- CLK-AI: https://www.cliniko.com/connected-apps/artificial-intelligence/ ; https://www.cliniko.com/blog/news/our-current-stance-on-ai-at-cliniko/
- CLK-HR: https://www.cliniko.com/features/health-records/
- WU-P: https://www.writeupp.com/pricing
- WU-HC: https://knowledge.writeupp.com/en/en/article/guide-to-setting-up-healthcode-integration-1ldf1p8
- WU-ROOMS: https://help.writeupp.com/en/article/how-do-i-schedule-rooms-1e5kfwi/
- WU-F: https://www.writeupp.com/features
- JANE-P: https://jane.app/pricing
- JANE-HC: https://jane.app/guide/submitting-to-healthcode-beta
- JANE-AI: https://jane.app/guide/ai-scribe-for-the-uk-faq
- JANE-FF: https://jane.app/guide/setting-up-a-fillable-pdf-form ; https://jane.app/guide/how-to-populate-a-fillable-pdf-file
- SEM: https://www.semble.io/
- SEM-HC: https://help.semble.io/integrating-healthcode-with
- SEM-HEIDI: https://blog.semble.io/semble-heidi-integration
- SEM-LT: https://help.semble.io/en/articles/4344861-letter-templates

**Internal (Clinic-system column)**

- Briefs [diary] [records] [billing] [comms] [portal] [reporting] [integration] [foundation] [rules]: /Users/khuram/.claude/projects/-Users-khuram-Projects-Appstackx-clinforms/b7653163-bb9e-4e0d-8520-80682f931a5b/workflows/scripts/clinic-system-sprint-wf_12ae1ae4-b57.js (MODULES, CTX)
- Contract: /Users/khuram/Projects/Appstackx/clinforms-wt/cs-base/docs/clinic-system/contract.md (not present on 24 Oct ~11:00; foundation in progress, migrations 0100–0102 uncommitted in the working tree)
- R-auth: /Users/khuram/Projects/Appstackx/clinforms/docs/auth.md (two-step required; TOTP + backup codes; re-checked)
- R-arch: /Users/khuram/Projects/Appstackx/clinforms/docs/production-architecture.md (D1 eu jurisdiction, Vercel lhr1, London Postgres later; re-checked)
- R-crypto: clinforms origin/main src/server/crypto/envelope.ts (AES-256-GCM, HKDF per tenant, AAD tenant:table:row)
- R-rtf: clinforms origin/main src/modules/medreport/core/rtf/reader.ts (typed «Name» / <<Name>> merge fields become answer spaces); PDF/Word fill in src/modules/medreport/forms/
- Research inputs: scratchpad/tm3cmp/comparison.md (draft), tm3-front.md, tm3-clinical.md, tm3-business.md, competitors.md; scratchpad/pms/tm3.md, market.md. Raw article text: scratchpad/tm3cmp/txt/ and the re-fetch for this check in scratchpad/tm3cmp/check/ (txt/ and web/)

**TM3 help-centre articles** (H + article id; read 24 Oct 2026; the 103 re-fetched for this check are in check/txt/)

- H4448426: https://help.tm3app.com/en/articles/4448426-how-to-use-snippets
- H4448427: https://help.tm3app.com/en/articles/4448427-clinical-template-types
- H4448431: https://help.tm3app.com/en/articles/4448431-exercise-prescriber
- H4448433: https://help.tm3app.com/en/articles/4448433-physiotools
- H4448434: https://help.tm3app.com/en/articles/4448434-physitrack
- H4448435: https://help.tm3app.com/en/articles/4448435-salaso
- H4448436: https://help.tm3app.com/en/articles/4448436-case-settings
- H4448438: https://help.tm3app.com/en/articles/4448438-flags
- H4448440: https://help.tm3app.com/en/articles/4448440-scores-goals
- H4448442: https://help.tm3app.com/en/articles/4448442-case-top-bar
- H4448444: https://help.tm3app.com/en/articles/4448444-how-to-add-an-assessment-to-a-consultation
- H4448445: https://help.tm3app.com/en/articles/4448445-how-to-add-an-image-to-a-case
- H4448446: https://help.tm3app.com/en/articles/4448446-how-to-correctly-book-an-appointment
- H4448448: https://help.tm3app.com/en/articles/4448448-how-to-record-a-discharge
- H4448451: https://help.tm3app.com/en/articles/4448451-how-to-record-goals
- H4448452: https://help.tm3app.com/en/articles/4448452-how-to-record-scores
- H4448453: https://help.tm3app.com/en/articles/4448453-how-to-use-highlights
- H4448454: https://help.tm3app.com/en/articles/4448454-how-to-use-sketchpad
- H4448455: https://help.tm3app.com/en/articles/4448455-locking-consultations
- H4448457: https://help.tm3app.com/en/articles/4448457-previous-medical-history
- H4448459: https://help.tm3app.com/en/articles/4448459-clinical-dashboard
- H4448464: https://help.tm3app.com/en/articles/4448464-contact-record-in-detail
- H4448470: https://help.tm3app.com/en/articles/4448470-appointment-form
- H4448475: https://help.tm3app.com/en/articles/4448475-how-to-book-appointments-for-new-business-patients
- H4448476: https://help.tm3app.com/en/articles/4448476-how-to-book-appointments-for-new-self-funding-patients
- H4448477: https://help.tm3app.com/en/articles/4448477-how-to-cancel-an-appointment
- H4448481: https://help.tm3app.com/en/articles/4448481-how-to-manually-send-reminders
- H4448483: https://help.tm3app.com/en/articles/4448483-how-to-record-a-dna
- H4448485: https://help.tm3app.com/en/articles/4448485-sending-a-sms-from-an-appointment
- H4448488: https://help.tm3app.com/en/articles/4448488-diary-view-options
- H4448489: https://help.tm3app.com/en/articles/4448489-how-to-print-the-diary
- H4448491: https://help.tm3app.com/en/articles/4448491-how-to-search-for-clients
- H4448494: https://help.tm3app.com/en/articles/4448494-how-to-view-the-diary-by-rooms
- H4448497: https://help.tm3app.com/en/articles/4448497-how-to-create-and-edit-other-diary-events
- H4448498: https://help.tm3app.com/en/articles/4448498-how-to-record-closure-days
- H4448503: https://help.tm3app.com/en/articles/4448503-explaining-expenditure-in-tm3
- H4448509: https://help.tm3app.com/en/articles/4448509-how-to-apply-credit-to-an-invoice
- H4448510: https://help.tm3app.com/en/articles/4448510-how-to-apply-discount-to-an-invoice
- H4448517: https://help.tm3app.com/en/articles/4448517-how-to-write-off-an-invoice
- H4448521: https://help.tm3app.com/en/articles/4448521-how-to-refund-a-payment
- H4448523: https://help.tm3app.com/en/articles/4448523-how-to-sell-and-redeem-gift-vouchers
- H4448527: https://help.tm3app.com/en/articles/4448527-quick-bill-screen-in-detail
- H4448555: https://help.tm3app.com/en/articles/4448555-system-requirements
- H4448556: https://help.tm3app.com/en/articles/4448556-dashboard-overview
- H4448557: https://help.tm3app.com/en/articles/4448557-how-to-add-a-task
- H4448597: https://help.tm3app.com/en/articles/4448597-audit-dashboard-overview
- H4448598: https://help.tm3app.com/en/articles/4448598-how-to-search-the-system-s-audit
- H4448599: https://help.tm3app.com/en/articles/4448599-full-list-of-configuration-settings
- H4448609: https://help.tm3app.com/en/articles/4448609-full-list-of-general-finance-settings
- H4448611: https://help.tm3app.com/en/articles/4448611-how-to-set-additional-ledger-codes
- H4448612: https://help.tm3app.com/en/articles/4448612-how-to-turn-vat-on-or-off
- H4448621: https://help.tm3app.com/en/articles/4448621-individual-location-screen-in-detail
- H4448628: https://help.tm3app.com/en/articles/4448628-how-to-set-up-practitioner-working-times
- H4448630: https://help.tm3app.com/en/articles/4448630-how-to-create-rooms-within-the-system
- H4448645: https://help.tm3app.com/en/articles/4448645-user-record
- H4448646: https://help.tm3app.com/en/articles/4448646-how-to-create-a-letter-template
- H4448649: https://help.tm3app.com/en/articles/4448649-how-to-create-sms-templates
- H4448652: https://help.tm3app.com/en/articles/4448652-how-to-replicate-your-old-desktop-templates-to-your-new-system
- H4448654: https://help.tm3app.com/en/articles/4448654-templates-overview
- H4519454: https://help.tm3app.com/en/articles/4519454-tm2-tm3-upgrade
- H4522869: https://help.tm3app.com/en/articles/4522869-what-is-the-difference-between-a-class-type-and-a-course-type
- H4522927: https://help.tm3app.com/en/articles/4522927-how-to-schedule-a-class-into-the-diary
- H4522970: https://help.tm3app.com/en/articles/4522970-how-to-mark-class-attendance
- H4529257: https://help.tm3app.com/en/articles/4529257-forms
- H4532319: https://help.tm3app.com/en/articles/4532319-24-7-reception-setting-up-practitioner-sessions
- H4532399: https://help.tm3app.com/en/articles/4532399-what-is-healthcode
- H4536442: https://help.tm3app.com/en/articles/4536442-how-to-contact-us
- H4538658: https://help.tm3app.com/en/articles/4538658-business-group-record-in-detail
- H4548728: https://help.tm3app.com/en/articles/4548728-report-descriptions
- H4548784: https://help.tm3app.com/en/articles/4548784-how-to-create-a-custom-report
- H4548852: https://help.tm3app.com/en/articles/4548852-24-7-reception-setting-up-practitioner-specialisms
- H4548976: https://help.tm3app.com/en/articles/4548976-accounts-export
- H4549009: https://help.tm3app.com/en/articles/4549009-custom-bespoke-invoice-receipt-requests
- H4549112: https://help.tm3app.com/en/articles/4549112-how-to-transfer-an-invoice-from-a-group-business-to-a-patient
- H4549159: https://help.tm3app.com/en/articles/4549159-how-to-transfer-an-invoice-to-a-client-s-business-group
- H4549423: https://help.tm3app.com/en/articles/4549423-how-to-reconcile-payment-with-outstanding-invoices
- H4549520: https://help.tm3app.com/en/articles/4549520-individual-invoice-screen-in-detail
- H4550238: https://help.tm3app.com/en/articles/4550238-setting-up-mailchimp
- H4552543: https://help.tm3app.com/en/articles/4552543-pay-as-you-go-appointments-and-classes-faq
- H4552565: https://help.tm3app.com/en/articles/4552565-client-record-in-detail
- H4552757: https://help.tm3app.com/en/articles/4552757-anonymise-delete-patient
- H4553140: https://help.tm3app.com/en/articles/4553140-recording-administrative-notes-log-on-client-record
- H4553166: https://help.tm3app.com/en/articles/4553166-how-to-record-client-treatment-authorisation
- H4553181: https://help.tm3app.com/en/articles/4553181-sending-an-email-from-a-patient-client-record
- H4553210: https://help.tm3app.com/en/articles/4553210-printing-a-letter-from-a-patient-record
- H4553232: https://help.tm3app.com/en/articles/4553232-how-to-view-patient-correspondence-history
- H4553291: https://help.tm3app.com/en/articles/4553291-how-to-upload-a-document-to-a-patient-record
- H4553432: https://help.tm3app.com/en/articles/4553432-how-do-i-merge-patient-records
- H4553480: https://help.tm3app.com/en/articles/4553480-patient-consent
- H4553499: https://help.tm3app.com/en/articles/4553499-subject-access-request
- H4553508: https://help.tm3app.com/en/articles/4553508-patient-forms
- H4557496: https://help.tm3app.com/en/articles/4557496-how-to-accept-payment-from-group-business
- H4560121: https://help.tm3app.com/en/articles/4560121-what-is-pronto
- H4560126: https://help.tm3app.com/en/articles/4560126-current-referral-sources
- H4560207: https://help.tm3app.com/en/articles/4560207-provisional-appointments-from-online-bookings
- H4560279: https://help.tm3app.com/en/articles/4560279-setting-up-practitioner-specialisms
- H4561380: https://help.tm3app.com/en/articles/4561380-how-to-cancel-an-appointment-made-online-for-patients-users
- H4573123: https://help.tm3app.com/en/articles/4573123-choose-your-telehealth-mode
- H4573169: https://help.tm3app.com/en/articles/4573169-telehealth-appointments
- H4574721: https://help.tm3app.com/en/articles/4574721-user-levels
- H4574928: https://help.tm3app.com/en/articles/4574928-how-to-edit-email-sms-reminders-and-confirmations
- H4574944: https://help.tm3app.com/en/articles/4574944-how-to-set-up-scheduled-email-and-sms-reminders
- H4582616: https://help.tm3app.com/en/articles/4582616-how-to-add-a-new-cancellation-dna-item
- H4582725: https://help.tm3app.com/en/articles/4582725-full-list-of-diary-general-settings
- H4582750: https://help.tm3app.com/en/articles/4582750-how-to-set-up-certain-working-days
- H4585166: https://help.tm3app.com/en/articles/4585166-full-list-of-merge-fields
- H4585360: https://help.tm3app.com/en/articles/4585360-cancelling-the-subscription-and-extracting-your-data
- H4700000: https://help.tm3app.com/en/articles/4700000-exporting-invoices-to-healthcode
- H4701316: https://help.tm3app.com/en/articles/4701316-importing-remittance-files-from-healthcode
- H4720209: https://help.tm3app.com/en/articles/4720209-setup-your-connect-mobile-app
- H4769222: https://help.tm3app.com/en/articles/4769222-waiting-lists
- H4769240: https://help.tm3app.com/en/articles/4769240-restrict-clinical-case-to-admitting-practitioner
- H4890880: https://help.tm3app.com/en/articles/4890880-healthcode-setup
- H5279740: https://help.tm3app.com/en/articles/5279740-google-tag-manager-and-google-analytics-4
- H5450902: https://help.tm3app.com/en/articles/5450902-mskpn-templates-for-patient-outcomes
- H5554110: https://help.tm3app.com/en/articles/5554110-how-to-invoice-group-patients
- H5554301: https://help.tm3app.com/en/articles/5554301-connect-general
- H5649498: https://help.tm3app.com/en/articles/5649498-discharging-a-referral
- H5661278: https://help.tm3app.com/en/articles/5661278-how-to-send-a-report
- H5926153: https://help.tm3app.com/en/articles/5926153-document-history
- H6208692: https://help.tm3app.com/en/articles/6208692-appointment-prepayment
- H6211834: https://help.tm3app.com/en/articles/6211834-physiofirst-data-for-impact-report
- H6241144: https://help.tm3app.com/en/articles/6241144-clinical-templates-glossary
- H6364372: https://help.tm3app.com/en/articles/6364372-features-that-help-you-manage-your-practice-better
- H6397509: https://help.tm3app.com/en/articles/6397509-automatic-client-recall
- H6456590: https://help.tm3app.com/en/articles/6456590-mark-patient-as-deceased
- H6563773: https://help.tm3app.com/en/articles/6563773-how-to-chase-a-client-s-unpaid-invoice-s
- H6890818: https://help.tm3app.com/en/articles/6890818-practitioner-status
- H6913222: https://help.tm3app.com/en/articles/6913222-new-class-layouts-and-functionality-on-connect-for-your-clients
- H6970787: https://help.tm3app.com/en/articles/6970787-tags
- H6975846: https://help.tm3app.com/en/articles/6975846-automation-rules-and-jobs
- H7258453: https://help.tm3app.com/en/articles/7258453-mult-factor-authentication-and-passkey
- H7266680: https://help.tm3app.com/en/articles/7266680-tm3-pay
- H7911835: https://help.tm3app.com/en/articles/7911835-nps-survey-forms
- H8173646: https://help.tm3app.com/en/articles/8173646-package-management
- H8425433: https://help.tm3app.com/en/articles/8425433-smart-lists-and-bulk-actions
- H8443276: https://help.tm3app.com/en/articles/8443276-the-power-of-smart-lists-and-bulk-actions
- H8570644: https://help.tm3app.com/en/articles/8570644-new-reports-glossary
- H8570745: https://help.tm3app.com/en/articles/8570745-appointment-analysis
- H8570759: https://help.tm3app.com/en/articles/8570759-practitioner-availability
- H8570786: https://help.tm3app.com/en/articles/8570786-aged-debtors
- H8571040: https://help.tm3app.com/en/articles/8571040-expenditure-analysis
- H8571047: https://help.tm3app.com/en/articles/8571047-income-analysis
- H8571066: https://help.tm3app.com/en/articles/8571066-upcoming-payments
- H8922215: https://help.tm3app.com/en/articles/8922215-diary-list-view
- H9036907: https://help.tm3app.com/en/articles/9036907-email-domain-verification
- H9100043: https://help.tm3app.com/en/articles/9100043-how-to-create-a-discount-codes
- H9550936: https://help.tm3app.com/en/articles/9550936-update-bug-fixes-and-features-3-6-52
- H11703343: https://help.tm3app.com/en/articles/11703343-client-tm3-setup-instructions-for-xero
- H11906413: https://help.tm3app.com/en/articles/11906413-new-ui-enhancements-released-week-of-august-1st-2025
- H12426855: https://help.tm3app.com/en/articles/12426855-update-fixes-and-features-4-1-024-and-4-1-025
- H12427075: https://help.tm3app.com/en/articles/12427075-how-to-set-up-deposits
- H12658947: https://help.tm3app.com/en/articles/12658947-update-fixes-4-1-038
- H12684118: https://help.tm3app.com/en/articles/12684118-update-fixes-and-features-4-1-040
- H12684160: https://help.tm3app.com/en/articles/12684160-heidi-ai
- H13343784: https://help.tm3app.com/en/articles/13343784-update-fixes-4-1-063
- H13549076: https://help.tm3app.com/en/articles/13549076-update-fixes-and-features-4-1-073-4
- H13572225: https://help.tm3app.com/en/articles/13572225-what-do-the-appointment-icons-mean
- H13601379: https://help.tm3app.com/en/articles/13601379-update-fixes-and-features-4-1-075
- H14033747: https://help.tm3app.com/en/articles/14033747-how-to-set-up-a-connect-service-for-insurance
- H14033968: https://help.tm3app.com/en/articles/14033968-connect-for-insurance-patient-journey
- H14283369: https://help.tm3app.com/en/articles/14283369-how-to-use-the-tasks-page
- H14287235: https://help.tm3app.com/en/articles/14287235-how-to-create-a-team
- H14288763: https://help.tm3app.com/en/articles/14288763-action-step-trigger-types
- H14320730: https://help.tm3app.com/en/articles/14320730-update-fixes-and-features-4-2-008
- H14484180: https://help.tm3app.com/en/articles/14484180-pricing-profiles
- H14486313: https://help.tm3app.com/en/articles/14486313-how-to-create-a-journey
- H14486960: https://help.tm3app.com/en/articles/14486960-how-to-enable-the-referral-portal-for-a-business
- H14594695: https://help.tm3app.com/en/articles/14594695-how-to-enforce-online-payments-on-connect
- H15068381: https://help.tm3app.com/en/articles/15068381-changes-to-saved-card-when-billing-in-clinic
- H15292176: https://help.tm3app.com/en/articles/15292176-how-to-allow-a-form-to-accept-uploaded-documents
- H15326915: https://help.tm3app.com/en/articles/15326915-update-features-4-2-035
- H15520284: https://help.tm3app.com/en/articles/15520284-update-fixes-and-features-4-2-045
- H15520312: https://help.tm3app.com/en/articles/15520312-how-to-create-and-assign-skills
- H15588496: https://help.tm3app.com/en/articles/15588496-update-fixes-and-features-4-2-047
- H15693535: https://help.tm3app.com/en/articles/15693535-update-fixes-features-4-2-050-049
- H15693909: https://help.tm3app.com/en/articles/15693909-stock-management-multi-location-stock-management
- H15870031: https://help.tm3app.com/en/articles/15870031-new-connect-booking-flow-what-s-changed
- H15886814: https://help.tm3app.com/en/articles/15886814-connect-updated-booking-flow
- H15948152: https://help.tm3app.com/en/articles/15948152-update-fixes-4-2-059
- H16053641: https://help.tm3app.com/en/articles/16053641-update-fixes-features-4-2-061-4
- H16109210: https://help.tm3app.com/en/articles/16109210-xero-faq
- H16963657: https://help.tm3app.com/en/articles/16963657-update-features-4-2-092
- H16963704: https://help.tm3app.com/en/articles/16963704-healthcode-settings-glossary
