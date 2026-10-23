# Blue Heart Clinics deal (Dell Baines)

**Status (2026-10-23 ~14:30 UTC):** **Demo held Fri 23 Oct 11:30 BST and "went really well"** (Khuram, 23/10). Dell said there is no tool like this at the moment. Khuram's words, verbatim: "Dell mentnioed that here is tool like this at the moment"; we read it as "no tool" from context [I] – confirm. **Dell raised a bigger opportunity: an ALL-IN-ONE product so Blue Heart can REPLACE TM3** – everything TM3 does, plus ClinForms. Khuram asked "is it doable?". This reverses Dell's first email (6/10: "happy with TM3 … not currently looking to move"). **Feasibility report:** `docs/strategy/all-in-one-pms-feasibility.md` (branch `strategy/pms-feasibility`, not merged). Short answer: technically yes; not as a TM3 rebuild for AppstackX today. Est. 20–40 months solo to a one-site MVP and 4–9 years to switch off TM3 [I], and nobody covers the diary in clinic hours. **Recommendation (A, PROPOSED – Khuram decides; D68):** paid ClinForms pilot first; then a staged path (reports → funded-work admin/notes/letters → diary → billing), each stage gated on money or a signed commitment. The reply email draft and the questions for Dell are in report §8. Nothing else from the call is recorded yet (§7).
**Earlier status (2026-10-21 ~19:45 UTC):** **Call Fri 23 Oct 2026 11:30 BST (10:30 UTC), booked.** Khuram sent a calendar invite. Its content is unrecorded, but it apparently asked which MLCs Blue Heart works with. **Dell's fourth email (21/10, verbatim §2.7)** names his 8 most common providers (§1) and describes his process. Each provider's report template is converted to **RTF** and kept in **TM3**. TM3 mail-merges name, address, DOB and treating physio. Physios then **type the clinical part from the Initial Assessment**, "the time-consuming part". He wants those clinical sections filled from the assessment notes, with the treating physio reviewing, amending and approving before sending. **Checked the same day:** (a) public research on each provider (how the treating physio's report goes back); (b) a live engine test on `main` with a fictional RTF IA form and a fictional one-page IA note. **Verdict:** covered with steps, except RTF upload (not today; workaround untested on a real Word file or TM3 template). RTF can't be uploaded (use the original blank form, or Dell saves the RTF from Word as .docx and we delete the merge fields before "Analyse form"). Address: read from an "Address:" line in the notes, except in ClinForms' own printed/pasted layout; if TM3's print lacks it, staff type it. The IA clinical part drafts correctly from the IA note, and review/amend/approve works. Two ways to fit his workflow: (A) ClinForms completes the whole provider form (recommended); (B) keep the TM3 mail-merge and paste each approved answer (per-answer Copy). **Material updated on branch `sales/blue-heart-fit`** (worktree `clinforms-wt/blue-heart-fit`, docs/memory only, **not merged** – until it is, rehearse from the worktree's run sheet; review fixes ~19:55 UTC): call pack `docs/demo-blue-heart.md` gains a new section "Dell's process (email 21 Oct) – coverage" (coverage table, ways A/B, provider routes, what went wrong in the test), plus §1.2 RTF row, §2 IA note, §6, §10. Run sheet `docs/blue-heart-runsheet.md` changes: step 0 opener on his process, step 2 IA line, step 3 "From records / Drafted / Needs input", step 7 Copy answers, step 10, step 12 ask, D1–D2 and D7–D8, and 6 new E rows. The earlier material branch `sales/blue-heart-call` was merged to `main` on 20/10 (`fcbe01d`). Product gaps found → `memory/next-steps.md` "TOP-b" (proposals, not built).
**Earlier status (2026-10-20 ~17:35 UTC; material first written ~17:15 UTC):** **Dell replied** (email pasted by Khuram Tue 20/10, verbatim §2.6): ClinForms is "exactly what I have been looking for"; he wants **a 15-minute session** to see it in action and discuss how it fits Blue Heart's reporting workflow, and asks Khuram for "a few dates and times". He names **ClinForms**, so he has seen the new name (probably via clinforms.co.uk/demo, whose button says "Book a 15-minute call", or Khuram's latest email – what Khuram last sent him is **unrecorded**; his email opens "Thank you for getting in touch"). **Call material ready on branch `sales/blue-heart-call` (not merged):** run sheet `docs/blue-heart-runsheet.md`, call pack `docs/demo-blue-heart.md` (incl. §email = the reply with 3 `[SLOT …]` placeholders for Khuram to fill). Review fixes applied ~17:35 UTC (live times ~20 s a form; TM3 export untested; no "Save to clinic record" click; no retention-period claim; backup click paths in run sheet E.2). Demo = frozen local folder `~/Projects/Appstackx/clinforms-demo` (Megan Hart on Harrow & Pike end to end + Meridian uploaded live for his prognosis/restrictions/recommendations example), verified 20/10 (22 steps, every wait < 1.2 s); public site clinforms.co.uk verified as fallback. **UPDATE 20/10 ~17:00 UTC: Khuram replied himself (his text not recorded) and the call is BOOKED for Fri 23 Oct 2026, 11:30 BST (10:30 UTC). §email in the call pack is superseded.** Price line given to Khuram 20/10 (the agreed list, no change after RED's no): ask volume first; founding £149/mo fixed 12 months (fair use 150 forms/mo) + £250 set-up, all 11 sites and staff, monthly, ex VAT; over ~150/mo → Group from £349, founding price agreed after the pilot; free proof of concept on 2–3 blank forms + anonymised notes before any payment; paid use starts with real patients after DPA + UK hosting.
**Earlier status (2026-10-09):** Voiced demo video (v2) ready since 13:51 UTC; Khuram planned to email it to Dell before 15:15 BST. Whether it was sent is still unverified. Next step we asked for: Dell sends 1–2 anonymised MLC forms + matching anonymised notes; we return completed drafts.
**Contact:** Dell Baines – `memory/people/dell-baines.md`. Research briefing (06/10): `memory/sources/blue-heart-briefing.md`.

## 1. The company (search-snippet research, 06/10; [C] public, [I] inference, [U] unknown)
- **BLUE HEART CLINICS LTD, company 09158709**, incorporated 04/08/2014 as **PHYSIO ASSURED LTD**, renamed 10/01/2023 [C]. **Filed as dormant (SIC 99999)**; dormant accounts to 31/08/2024 filed 29/05/2025; latest accounts to 31/08/2025; next due 31/05/2027 [C]. **The 11-clinic business probably trades through another entity** [I] → confirm who we contract with and invoice.
- Director: Mr Dell David HENSON-BAINES [C]. PSC and charges [U].
- Registered office/main base: 48 High Street South, Dunstable LU6 3HD (a working clinic, ground floor) [C/I]. Old Physio Assured HQ: 67 Marlowes, Hemel Hempstead HP1 1LE (old).
- Freephone 0800 093 1899; www.blueheartclinics.co.uk; Instagram @blueheartclinics; old physioassured.com / @PhysioAssured.
- Started 2010 as Physio Assured ("one clinic, one therapist"). Services: MSK physio + acupuncture, massage, kinesiology, psychotherapy, counselling, podiatry, PT [C]. Senior physios only (3+ years), HCPC, CSP, enhanced DBS [C].
- **11 locations** [C]: Aylesbury, Buckingham, Daventry, **Dunstable (main)**, Ealing (312 Northfield Ave), Hackney, Hemel Hempstead, Hornchurch, Milton Keynes, Northampton, Shoreditch. ~8 are rented rooms in other businesses [I].
- **People:** ~16 names on team page (physios Alina (Balog), Anna, Maria, Soumya, Vikas; Dean massage/PT; Raman Kaur acupuncture; Zeenia, Katrina, Kristina roles unknown); ZoomInfo <25 employees; estimate 10–13 clinical, **6–9 FTE** [I]. Hiring MSK physios at £37–45k in 2026 → growing [C/I].
- **Who pays:** self-pay; PMI (**AXA Health, Aviva, Vitality, WPA**; Bupa not named); personal-injury rehab/case-management networks: **10 Bridge Physio, 3D Rehabilitation, HCML, Physio-Link, PhysioMed, Speed Medical (OPM), The Physio Network, The Treatment Network** [C].
- **Providers Dell named himself (email 21/10, "to name a few of the more common ones"):** **Speed Medical, HCML, 3D Rehab, Physio Link, Physio Med, The Physio Network, Bodycare Clinic, The Treatment Network**. Compared with the website list: Bodycare Clinic is new; 10 Bridge Physio and the PMI insurers are not mentioned. Public research 21/10 ([C] stated, [I] inference, [?] not found; no templates downloaded):
  - **Speed Medical** (Chorley; FL360 group): "Physiotherapy Portal", where panel physios **upload completed reports** [C]. Template format not public [?]. Sources: https://www.speedmedical.com/service-delivery/technology · https://www.speedmedical.com/clinical-governance/join-our-panel · https://www.speedmedical.com/our-services/rehabilitation-services/physiotherapy/
  - **The Treatment Network** (Ltd 03638331; sister of Corporé; FL360 since 2016; registered office Speed Medical House): its physio login is hosted on Speed Medical's online services [C], so it probably uses the same upload [I]. Sources: https://www.corpore.co.uk/the-treatment-network/ · https://onlineservices.speedmedical.com/TTNLogin.aspx · https://www.corpore.co.uk/faq/the-treatment-network/
  - **3D Rehab** (Premex Services Ltd, Horwich): **Unity** supplier portal with an "automated report writing facility" [C]. Sources: https://www.3drehab.co.uk/suppliers/unity-supplier-panel · https://www.3drehab.co.uk/suppliers
  - **HCML**: Supplier Portal (supplier terms cl. 1.4.11) [C]; an initial and a discharge report are due within the times in each clinic's Letter of Agreement [C]; typed fields vs upload not stated, typed likely [I]. Sources: https://hcml.co.uk/hcml-supplier-terms-and-conditions/ · https://suppliers.hcml.co.uk/supplierportal/
  - **Physio Med** (Leeds, ~780 practices): Physio Med Portal with a physio login [C]; initial, interim and discharge reports covering pain, ROM, work ability, modified duties, diagnosis and prognosis, ~2-day return target [C]; reports written in the portal: likely [I]. Sources: https://www.physiomed.co.uk/pages/secure-online-portal · https://www.physiomed.co.uk/pages/our-physio-network · https://www.physiomed.co.uk/services/physiotherapy-f2f-15d7468b-b04b-4536-9dde-171715adadfb
  - **Bodycare Clinic** = probably **Bodycare Clinics Ltd (05011409, North Tyneside)**, a MedCo Tier 1 provider with a rehab panel; not the Lochgelly clinic [I]. It publishes physio "Initial Assessment Report Template" and "Final Assessment Report Template" as **old Word .doc** files [C]. Return by email likely [I]. Sources: https://www.bodycareclinics.com/suppliers/downloads/index.html · https://www.bodycareclinics.com/suppliers/index.html
  - **Physio Link**: route unknown; its site was down on 21/10 [?]. Sources: https://physio-link.co.uk/ (unreachable 21/10) · https://uk.linkedin.com/company/physio-link-treatment-rehabilitation
  - **The Physio Network** = probably "The Physiotherapy & Psychological Network" (TPN, 04476520, London) [I, medium confidence]; route not public [?]. Sources: http://www.thephysionetwork.com/aboutus.html · https://find-and-update.company-information.service.gov.uk/company/04476520
  - Sources inline above (checked 21/10). The summary table is in the call pack, "Dell's process".
- Reviews 4.9★ (88, Dunstable) [C]. Historic prices £40/30 min, £50/45, £60/60 [C]; now ~£50–65/30 min [I].
- **Turnover estimate £450k–£700k** (range £350k–£900k) [I, low confidence]. **Form volume 50–300/month, working figure ~125** [I].
- **Verdict:** small, owner-managed, multi-site; no procurement; Dell decides alone.
- Do NOT confuse with Blue Heart Care Group (Wales), Blue Heart Healthcare Solutions Ltd (16922767), Blueheart Ltd (03721906) etc.
- Manual checks still worth doing from the desktop: Companies House `/officers`, `/persons-with-significant-control`, `/filing-history` (2025 accounts PDF), `/charges`; officer search "HENSON-BAINES"; ICO register "Blue Heart Clinics"; website footer/privacy policy (operating entity); full team page; Google review counts.

## 2. Emails (verbatim)

### 2.1 Dell → Khuram, first email (pasted by Khuram 06/10 09:21 UTC)
> Dear Khuram Masood,
>
> Thank you for your email.
>
> At present, we already use TM3 as our clinic management software and we are happy with this for now, so we are not currently looking to move to another booking or patient management system.
>
> The only area that may be of interest to us in the future would be software that can use the patient's clinical registration details and physiotherapy notes to generate individual medico-legal/company reports automatically in Word or PDF format.
>
> If this is something your platform can genuinely support, please feel free to send over further information. Otherwise, we are not looking to explore a new clinic software system at this stage.
>
> Kindest Regards,
>
> Dell Baines.

(Khuram's earlier outreach that Dell answers is not in our records; it apparently pitched CareConnect/clinic software – unverified.)

### 2.2 Our draft reply 1 (assistant, 06/10 09:24 UTC) – sent as written? **unverified**
> **Subject:** Re: Automated medico-legal and company reports alongside TM3
>
> Dear Dell,
>
> Thank you for your reply, and for being clear about what would be useful.
>
> To be straightforward: we don't currently have an off-the-shelf product that does this. It is, however, a well-defined problem we can build for, and it wouldn't require any change to how you use TM3.
>
> What we have in mind:
> - Your clinician exports the patient's registration details and notes from TM3. There's no need to switch systems.
> - The tool drafts the report in your own Word template, with your letterhead, headings and wording. It uses only what is in the notes and highlights anything missing rather than filling gaps.
> - The physiotherapist reviews, edits and signs off the report, then downloads it as Word or PDF.
> - Data is held in the UK, encrypted, and deleted on a schedule you set. A data processing agreement would be in place before any real patient data is used.
>
> If helpful, we could do a no-obligation trial. Send us a blank copy of a report template you currently use, and within 7–10 days we'll show you a completed draft generated from a fictional patient case. No real patient data is needed.
>
> It would also help to know roughly how many reports you produce each month and who they usually go to (solicitors, insurers, case managers or employers). Pricing would be a simple monthly fee for the whole clinic, typically £99–£199 depending on volume.
>
> Kind regards,
> Khuram Masood
> AppStackX

Dell's second email opens "Thank you for your reply", so Khuram replied in some form between 09:24 and 15:21 UTC on 06/10.

### 2.3 Dell → Khuram, second email (pasted 06/10 15:21 UTC) – the real requirement
> Dear Khuram,
>
> Thank you for your reply.
>
> Just to clarify, what we would need is not a system that creates a generic medico-legal or company report using one standard Blue Heart Clinics template.
>
> The main issue is that the MLCs/insurers we work with usually send us their own report forms. These all have different layouts, questions, headings and formats. We would need any reporting module to be able to complete the specific report form provided by that MLC, using the patient's registration details and the physiotherapy clinical notes, rather than producing a separate generic report.
>
> For example, one referrer may ask for prognosis, functional restrictions and treatment recommendations in one format, while another may ask similar clinical questions in a completely different structure. The software would need to identify and complete the correct sections within the referrer's own document, ideally producing the completed version in Word or PDF for clinician review and final approval.
>
> Is this something your programme could genuinely support?
>
> If so, please could you confirm:
>
> * Whether the system can work from different MLC/insurer report templates.
> * Whether it can complete the report in the original format/layout sent to us.
> * Whether it can use TM3 registration details and physiotherapy notes without us duplicating data manually.
> * How clinician review, amendment and approval would work before the final report is issued.
> * Whether patient data would remain secure and GDPR compliant.
>
> If this is possible, I would be happy to consider sending anonymised examples of an MLC report form and corresponding anonymised clinical notes so you can assess whether a proof of concept is realistic.

**Dell's five questions (numbered as used everywhere, incl. the video):** Q1 different templates; Q2 original layout; Q3 TM3 data without duplication; Q4 clinician review/amend/approve; Q5 secure + GDPR.

### 2.4 Our draft reply 2 (assistant, 06/10 15:24 UTC) – sent? **unverified**
> **Subject:** Re: Completing MLC/insurer report forms from TM3 notes
>
> Dear Dell,
>
> Thank you, that's a really helpful clarification. Completing each referrer's own form, rather than producing a generic report, is exactly what we would build.
>
> To answer your questions:
>
> **1. Different MLC/insurer templates.** Yes. Each referrer's form is uploaded once. The system reads it and identifies the questions and sections, such as prognosis, functional restrictions and treatment recommendations, however they are worded or ordered. A member of your team confirms this once, and it is then reused for every patient from that referrer.
>
> **2. Original format and layout.** Yes for Word documents and fillable PDFs. Answers are written into the referrer's own document, so the layout and headings stay exactly as sent, and you receive the completed version in Word and/or PDF. Scanned or non-fillable PDFs can also be completed, but less reliably, so we would want to test those with your examples before promising anything.
>
> **3. TM3 data without duplication.** No retyping is needed. To start, the patient's registration details and notes are exported from TM3 and uploaded in one step; it would help to know which export options your TM3 account offers. A direct link to TM3 depends on TM3 allowing third-party access to clinical notes. We would need to confirm that with them and won't claim it until we have.
>
> **4. Clinician review and approval.** The draft is shown question by question, and every answer shows the note it came from, so it can be checked with one click. Anything not documented is left blank and flagged rather than guessed. Clinical opinions are used only where a clinician has recorded them; otherwise the clinician writes them. The clinician amends as needed and approves with their name and HCPC number. Until then the document is marked as a draft, and all edits and the approval are logged.
>
> **5. Security and GDPR.** Before any real patient data is used, we would put in place:
> - a data processing agreement, with your clinic as controller and us as processor, and a data protection impact assessment;
> - UK hosting, encryption in transit and at rest, two-factor login, and automatic deletion after an agreed period;
> - an AI service used under terms that exclude training on your data, with only the information needed for the form sent to it.
>
> The proof of concept would use anonymised data only.
>
> We'd be glad to receive anonymised examples. Ideally:
> - 2–3 report forms from different MLCs/insurers, in the original Word or PDF format you receive them;
> - the anonymised registration details and notes for one or two cases, ideally as TM3 exports them;
> - if possible, the completed report you actually sent for one of those cases, so we can compare.
>
> Please remove or replace names, dates of birth, addresses, NHS numbers and claim references. We will return completed draft forms for your review, with a short walkthrough video, within [7–10] days of receiving them.
>
> Kind regards,
> Khuram Masood
> AppStackX

Notes: Khuram must choose the "[7–10] days" commitment himself. This draft says "an AI service" – written **before** the 21:39 UTC rule banning AI mentions in customer material; reword ("a contracted drafting service") if reused.

### 2.5 Covering email for the video (assistant, 09/10 13:37 UTC) – sent? **unverified**
> **Subject:** Re: Completing your referrers' report forms – short walkthrough
>
> Dear Dell,
>
> Thank you for the clarification – it was very helpful. I've attached a short walkthrough (about 6 minutes) showing how our module would handle exactly what you described: completing each MLC or insurer's own report form, in its original layout, from TM3 registration details and physiotherapy notes, with clinician review and approval before anything is issued. It takes your five questions in turn.
>
> All patients, referrers and forms in the video are fictional, and the TM3 shown is a simulated environment for demonstration.
>
> If it looks useful, the best next step would be for you to send one or two anonymised MLC report forms with matching anonymised clinical notes. We'll return the completed drafts for your review.
>
> Kind regards,
> Khuram Masood
> AppStackX

### 2.6 Dell → Khuram, third email (pasted by Khuram Tue 20/10, ~16:41 UTC) – wants a 15-minute session
> Dear Khuram,
>
> Thank you for getting in touch. This is exactly what I have been looking for to help us complete the different MLC and insurer forms we receive, while allowing our clinicians to review and approve the information before it is sent.
>
> I'd be very interested in seeing ClinForms in action and discussing how it could fit into Blue Heart Clinics' reporting workflow. A 15-minute session would be useful. Please send me a few dates and times that work for you.
>
> Kindest Regards,
> Dell Baines.
> Company Owner.

Khuram's message that this answers is **not in our records** (he names ClinForms, so it post-dates the rename). Khuram asked the same day: "are we ready for them?" (15-min call: Dell asks questions, Khuram demos).

### 2.6a Our reply 3 (assistant draft, 20/10) – **superseded, never sent** (Khuram replied himself and booked the call; this was §2.7 until 21/10)
In `docs/demo-blue-heart.md` §email (branch `sales/blue-heart-call`): thanks; three 15-minute slots as `[SLOT …]` **placeholders for Khuram to fill**, "(UK time)" (suggestions in the placeholders: Thu 22 Oct 12:30, Fri 23 Oct 12:30, Mon 26 Oct 17:30 – UK clocks go back Sun 25 Oct, so the Monday slot is GMT; lunchtime only works with his own Mac and a quiet room); subject = leave Gmail's "Re: <his subject>" (his subject is not recorded); live walkthrough on fictional data – an MLC form and an insurer form completed in their own layout from clinic notes, clinician review/amend/approve; optional paragraph asking for 1–2 blank MLC forms beforehand ("I'll aim to show…", scanned not supported; only if Khuram will do that prep); signed Khuram Masood, AppstackX Ltd, khuram@appstackx.co.uk, https://appstackx.co.uk.

### 2.7 Dell → Khuram, fourth email (pasted by Khuram Wed 21/10, before ~18:50 UTC) – his process
It answers Khuram's calendar invite (content unrecorded). "If you mean the medico-legal companies…" suggests the invite asked which MLCs they work with. Verbatim as pasted (no sign-off in the paste):
> Hi Khuram,
>
> Thank you for sending the calendar invite.
>
> If you mean the medico-legal companies and rehabilitation providers we receive referrals from, we work with a wide range, including Speed Medical, HCML, 3D Rehab, Physio Link, Physio Med, The Physio Network, Bodycare Clinic and The Treatment Network, to name a few of the more common ones.
>
> Our current process involves converting each provider’s report template into Rich Text Format (RTF) and adding it to TM3. When we open the template within the patient’s record, it automatically “mail-merges” details such as the patient’s name, address, date of birth and treating physiotherapist’s name into the relevant fields.
>
> We then manually add the clinical information gathered during the Initial Assessment. This is the time-consuming part, particularly as each provider has its own format and reporting requirements.
>
> What we would like is a way to populate these clinical sections from our assessment notes, while allowing the treating physiotherapist to review, amend and approve the completed report before it is sent.
>
> I look forward to discussing how ClinForms could support this on Friday.

Khuram asked: "see if we are covered with all these bits?" Answer: call pack `docs/demo-blue-heart.md` "Dell's process (email 21 Oct) – coverage" (branch `sales/blue-heart-fit`).

## 3. How each of Dell's points is answered (product + video v2, 6:15)
| Dell's point | Answer | Video time |
|---|---|---|
| "Not a generic … Blue Heart Clinics template" | We complete the referrer's own form; built-in templates only a fallback | 0:05 intro card ("You told us…") |
| Q1 different templates | Uploaded once, questions/answer spaces identified, staff confirm once, reused | 0:20–1:18 (Meridian read live, 17 questions, 1 flagged; real time ~23 s, sped up & labelled) + 4:02–4:54 |
| "Identify and complete the correct sections within the referrer's own document" | Each question's answer space is located and highlighted in the original layout, then confirmed once | 0:39–1:12 |
| Q2 original layout | Word + fillable PDF yes; flat/scanned best effort | 1:52–2:37 (Harrow & Pike Word form, 16 questions: 8 from TM3 records, 4 drafted, 4 for clinician) |
| Q3 TM3 without duplication | TM3 export + one upload today; direct link subject to TM3 access | 1:18–1:52 (simulated TM3: 10 notes, 11 appts, 6 scores) + 4:54–5:14 (filed back) |
| Q4 review/amend/approve | Click-to-source; unsupported date flagged and blocks approval; prognosis left for the physio; name + HCPC + signature + attestations; DRAFT until approved; nothing issued automatically | 2:37–4:02 (final PDF at 3:46) |
| His example (prognosis / restrictions / treatment recs in different structures) | Same notes complete each form in its own structure | 4:35–4:54 side by side, H&P vs Northfield |
| Q5 secure & GDPR | Commitments before real data: DPA/DPIA, UK hosting, encryption, 2FA, minimised data, audit, clinician approval, agreed deletion. `[CLAIMANT]`, no DOB/address | 5:14–5:51 + GDPR card 5:39 |
| His offer of anonymised examples | "Send us an anonymised MLC form with matching notes; we'll send the completed draft" | 6:06 next-step card; recap 5:52 |

**Honest gaps if Dell presses:** forms are fictional look-alikes; scanned/non-fillable PDFs not shown (biggest risk if common); TM3 simulated (export+upload today); GDPR measures are commitments not built (demo stores in browser); PDF copy of a Word form needs a converter server in production.
**Update 21/10 (his process email, §2.7):**
| His point | Covered today? | Key fact |
|---|---|---|
| His 8 providers, each with its own format | Yes, with a step | Word/PDF form: uploaded once, checked once. Website: answers ready to paste. Routes per provider in §1 |
| Templates as RTF in TM3 | Not today; workaround untested | RTF is refused. Use the original blank form, or Dell saves the RTF from Word as .docx and we delete the merge fields before "Analyse form" – neither tried on a real Word file or TM3 template (a template with merge fields left in gave a **wrong approved form** in the test) |
| Mail-merge of name/address/DOB/physio | Yes, with a step | Way A: from the patient lines at the top of the uploaded notes ("From records"; tested only with ClinForms' own layout). Address: read from an "Address:" line except in ClinForms' own layout; staff type it if TM3's print lacks it. Way B: TM3 keeps doing it |
| Clinical part from the IA (the slow part) | Yes | Drafted from the IA note, cited. Opinions not in the note are flagged and block approval until the physio answers (left blank in 2 of 3 runs; run 2 drafted a factual sentence into C2, still blocked). Run 1: 17 of 22 in 11 s, nothing invented |
| Fill from assessment notes | Yes, with a step | PDF/Word/CSV/text/pasted notes. **TM3's print/export not tested** |
| Physio reviews/amends/approves before sending | Yes | Edited / Revert, opinion gaps block approval, Approve and sign. ClinForms sends nothing: staff send or upload |

**Update 20/10:** since go-live (10/10) much of Q5 is **built and live** (invite-only accounts, required two-step sign-in, roles, per-clinic AES-256-GCM encryption, append-only audit log, clinic-set retention). Still NOT done: DPA, DPIA, UK (London) database – the app runs in London but the database is in the **EU** today; automatic deletion "being switched on"; no security certification. Word→PDF still not built (Word forms come back as Word). Call wording: `docs/demo-blue-heart.md` §8.

## 4. Pricing for Blue Heart (internal; nothing formally quoted)
- **20/10: superseded by the official price list agreed 10/10 (D64, `memory/context/pricing.md` §0):** founding Practice £149/mo fixed 12 months (fair use 150 forms/month) + £250 set-up; Practice includes 10 referrer forms (so the "5 forms / 10 extra for £300" idea below is dead). At ~125 forms/month the list price would be Group "from £349" – **year-2 price is Khuram's open decision**. Call wording: `docs/demo-blue-heart.md` §9. The rest of this section is the 06/10 reasoning, kept for history.
- Recommended quote: **Practice £199/mo list; founding offer £149/mo fixed for 12 months + £250 setup**, monthly, cancel any time. 5 included forms = their Blue Heart template + top 4 referrers. Extra forms capped (e.g. **up to 10 extra forms for £300**). Year 1 ≈ £2,040. State whether prices include VAT (they likely can't reclaim: £149 ≈ £179).
- Don't offer Starter £99 (undersells 11 sites). Avoid per-seat, annual lock-in, piling form fees.
- Comfort zone £100–300/mo + setup ≤ ~£500; five-figure build fee is a stretch.
- **What Dell may have seen:** only "typically £99–£199 depending on volume" (draft 1, if sent). Video has no pricing.
- ROI (assumptions, unproven): central 125 forms × 0.75 h × £40 = £3,750/month of clinician time; saving £1,900–2,600 (47–66 h) at 50–70% time cut. Each hour saved ≈ two half-hour appointments (£90–120). **Claim no time savings** until measured.
Full pricing reasoning: `memory/context/pricing.md`.

## 5. Commitments made (conditional on what was sent)
- Return completed draft forms once he sends anonymised forms + notes (video + covering email).
- Draft 2: walkthrough "within [7–10] days" of receiving examples (Khuram to fix the number). Draft 1: no-obligation trial in 7–10 days.
- No real patient data before DPA (clinic controller, AppStackX processor), DPIA, UK hosting, encryption, 2FA, minimisation under contract, audit trail, clinician approval, agreed deletion.
- Never claim a direct TM3 link until TM3 confirms access; test scanned/flat PDFs with his examples before promising.
- Data to request (updated 21/10): blank templates for 2–3 of the providers he named, the originals in Word/PDF if they still exist, otherwise the RTF opened in Word and saved as .docx, merge fields left in (we delete them); one anonymised **Initial Assessment** note + registration as TM3 prints/exports it; one actually-sent completed report; which TM3 export formats exist; whether his TM3 can issue API keys. He replaces names, DOBs, addresses, NHS numbers and claim refs with XXXX (not deleting the lines, so we see where TM3 puts them).

## 6. Next actions (updated 21/10)
0. **Khuram: re-read the updated run sheet before rehearsing.** Changes are in step 0 (opener on his process), step 3 (point at "From records 8 · Drafted 4 · Needs input 4"), step 7 (point at a question card's Copy button), step 10, step 12 (the new ask) and the new E rows. Every click label is unchanged, so the demo itself is the same. Material is on branch `sales/blue-heart-fit` (not merged; until it is, rehearse from `~/Projects/Appstackx/clinforms-wt/blue-heart-fit/docs/blue-heart-runsheet.md` – the copy in `~/Projects/Appstackx/clinforms` is the 20/10 version). Never try an RTF upload on the call. Never show or recreate his providers' forms (all demo forms stay fictional).
1. ~~Khuram: send the reply~~ – done differently: Khuram replied himself and booked Fri 23 Oct 11:30 (20/10), then sent a calendar invite (21/10).
2. **Khuram decides before the call** (`docs/demo-blue-heart.md` §0): what he last sent Dell (check Sent mail – unrecorded); year-2 price at ~125 forms/month; VAT status; proof of concept free + turnaround "[X] working days"; when to get a DPA drafted (none exists; the live `/security` page says it is "available on request").
3. **Before the call:** restart the frozen demo server (the 13/10 one was still listening on :3000 at 18:00 BST on 20/10), Reset demo in the "ClinForms demo" Chrome profile, rehearse once with `docs/blue-heart-runsheet.md`. Never mention RED or any other prospect to Dell.
4. **After the call:** record Dell's answers in §7 below (referrers + volumes, which providers take a document by email/upload vs a website, whether the original Word/PDF templates still exist or only the RTFs, Word/PDF/scanned/portal split, TM3 web/desktop and export options, who writes/signs, data rules, price reaction, next step and date) and in `memory/people/dell-baines.md`; draft the follow-up.
5. When forms/notes arrive: classify each (Word / AcroForm / flat / scanned / **RTF** / .doc). For an RTF: ask for a .docx saved from Word (keeps the tables; no Word or LibreOffice on this Mac, and `textutil` flattens tables), then delete the TM3 merge fields in the .docx before "Analyse form" (call pack §10.2). Pick the referrer type by who reads the report: PI/medico-legal providers (Speed Medical, The Treatment Network, 3D Rehab, Bodycare, Physio Link, HCML's PI work) → "Medico-legal company"; Physio Med and The Physio Network (employer-funded) stay "Case manager"/"Employer", where past medical and social history are held back by design – say so in the PoC return. Then map + confirm, turn his anonymised notes into a made-up patient before any drafting, complete, return drafts + short walkthrough (`docs/demo-blue-heart.md` §10). Keep his files out of git (use gitignored `demo-assets/`).
6. Before contract: legal entity (09158709 files dormant accounts), VAT, DPO, DPA naming Anthropic as sub-processor, DPIA, London database, price.

## 7. Call notes (fill in after the call)
**Fri 23 Oct 2026, 11:30 BST (held).** Source: Khuram's chat message the same afternoon. He has recorded nothing else yet.
- "ok so demo went really." (read as "really well").
- Dell: there is no tool like this at the moment (verbatim "here is tool like this at the moment"; read as "no tool" [I]).
- Dell raised the "bigger opportunity to build one in all tool, so he can replace TM3 with our product": everything TM3 offers now, plus what ClinForms has.
- **Still to record** (ask Khuram): referrer volumes; price reaction; PoC material promised (templates, IA note); TM3 Desktop/Web and export options; who signs; the next step and its date. Report §8 has the question list for the follow-up.
- Rule from the report: don't ask Dell for TM3 logins, screen recordings or exports in order to copy TM3. TM3's MSA cl. 3.2(b) bars clients from using TM3 to build a competing product [C].
