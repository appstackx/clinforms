# Insurer and referrer forms – catalogue

Purpose: which real forms exist, where to get them, how ClinForms would handle them, and priority.
**Rules:** download only into the gitignored `/demo-assets/` (e.g. `demo-assets/insurers/`); **never commit** third-party PDFs or outputs made from them; label "Public form used for demonstration only – not affiliated with or endorsed by <insurer>. Fictional patient data."; private demos only, never public marketing; never claim they are a prospect's own forms; no real insurer/MLC branding in our own demo forms.
**Status (09/10, desktop):** all six §1 PDFs **downloaded** (~17:10 UTC, into gitignored `clinforms/demo-assets/insurers/`) and **classified**; a hand-checked map exists for each (`maps/<sampleId>.json`, mode `demo_prewritten`, bound to the file's SHA-256). Results and handling: §1b. Call pack using them: `docs/demo-red-physio.md`. (The cloud proxy had returned 403 for every insurer host.)

## 1. Public PMI forms (research pasted by Khuram 09/10 14:08 UTC; "I checked the documents themselves" – author not stated)

| # | Insurer – form | URL | Pages / content | ClinForms handling (expected) | Priority |
|---|---|---|---|---|---|
| 1 | **Bupa – Further Physiotherapy Treatment Request** ("therapies management form") | https://www.bupa.co.uk/~/media/files/hcp/latest-updates-from-bupa/forms/therapies-management-form.pdf | 3 pp: assessment findings, outcome measures, treatment response, additional sessions, treatment justification. "Best match for our demo" | Fillable → fully supported; flat → best effort | **RED Tuesday #1** |
| 2 | **AXA Global Healthcare – Therapy Treatment Plan** | https://www.axaglobalhealthcare.com/globalassets/intermediary/sales-tool-kit/operational-forms/eu/therapy-treatment-plan-form---english.pdf | 4 pp: clinical questions, functional limitations, pain scale, care planning. **International – label separately from domestic AXA Health** | As above | **RED Tuesday #2** |
| 3 | **Aviva – Private Medical Insurance Claim Form CM016** | https://static.aviva.io/content/dam/document-library/health/cm016.pdf | 8 pp: patient details, symptoms, medical history, practitioner sections. General claim form (not a physio progress report); shows sections completed by different people | **Clinician sections only**; patient parts + declarations left for the right person | **RED Tuesday #3** |
| 4 | Aviva – Medical Report Request **GEN030** | https://static.aviva.io/content/dam/document-library/health/gen030.pdf | 2 pp: treatment history, dated events, prognosis, future treatment. Underwriting report **requiring a doctor** | Physio shouldn't complete it – **format example only**, labelled | Optional |
| 5 | Freedom Health Insurance – **Freedom Worldwide** Outpatient Medical Treatment Claim Form | https://www.freedomhealthinsurance.co.uk/getmedia/7d7633f2-0ab0-4fb6-9071-28dfba6d2572/worldwide-medical-claim-form | 4 pp: symptoms, diagnosis, recommended treatment, expenses table explicitly incl. physiotherapy; international reimbursement; repeated rows, supporting-document requirements | Repeated-row tables may need continuation handling | Optional |
| 6 | **Allianz Care – Pre-authorisation Form** | https://www.allianzcare.com/content/dam/onemarketing/azcare/allianzcare/en/docs/FRM-PreAuth-EN-0825.pdf | 3 pp: patient + doctor sections; general international treatment authorisation | Clinician/doctor sections only | Optional |

## 1b. Classification and handling (09/10/2026, Case C Rebecca Lane)
None is encrypted, XFA-only or scanned. "Questions" = answer spaces in the prepared map; parties as the map assigns them.

| sampleId | File | Pages | Type | Questions (parties) | Handling in ClinForms | Answers file | Demo use |
|---|---|---|---|---|---|---|---|
| `bupa-tmf` | `bupa-therapies-management-form.pdf` | 3 | Fillable, 26 fields | 26 (clinic) | Therapist's form, fully: 8 registration, 3 calculated (`first_scores` / `latest_scores` = every measure with its date, sessions attended), 7 drafted, 3 recorded opinions, 3 sign-off (therapist's declaration), 1 fixed (provider number), 1 blank | Yes (10 drafted; 5 hand-edited, listed in its note) | #1, end to end, `_SIGNED` |
| `axa-gh-ttp` | `axa-global-therapy-treatment-plan.pdf` | 4 | Fillable, 73 fields | 32 (clinic) | Therapist's form; signature written in the printed box no field covers. Membership (F-04) and authorisation/claim (F-06) numbers withheld – the record's are Bupa's (`otherInsurerOnForm`); F-28 specialist-review date is a gap (can be answered N/A) | Yes (12 drafted; 6 + attendance wording hand-edited) | Show up to the identifier block; never approve on the call |
| `aviva-cm016` | `aviva-cm016.pdf` | 8 | Flat (print-ready, trim box inside crop box) | 56 (patient 32, doctor 14, unassigned 10) | Patient's/GP's claim form: section 1 identity only (name, address lines, postcode, email, DOB, mobile; policy number left for staff); 49 blank; prefill (`_PREFILLED`) | Not needed (nothing to draft) | 30 s |
| `aviva-gen030` | `aviva-gen030.pdf` | 2 | Flat | 17 (doctor 11, insurer 2, unknown 4) | Doctor's report: patient details only (3); rest blank | Not needed | Only if asked |
| `freedom-ww-claim` | `freedom-worldwide-claim-form.pdf` | 4 | Fillable, 73 fields | 35 (policyholder 25, patient 9, clinic 1) | Policyholder's claim form: only the treatments-and-fees table from the appointments (`appointments_table`: £70, £55 × 4, paid circled); prefill | Not needed | Skip |
| `allianz-preauth` | `allianz-care-preauth.pdf` | 3 | Fillable, 80 fields | 55 (clinic 37, patient 13, doctor 5) | Medical-provider section: 6 registration, 10 drafted (5 left as gaps), 1 fixed; doctor's name/signature/date and patient section blank; prefill | Yes (10 drafted; 3 hand-edited) | Skip |
| `portal-example` | – (our own illustrative questions, kind `questions`; `fileSha256` = hash of the questions) | – | Portal question set | 8 | Copy-ready answers: 1 registration, 1 calculated, 3 drafted, 3 opinion (prognosis left as a gap) | Yes (7 of 8 drafted; attendance wording hand-edited) | #3, seeded in the library |

Live form analysis (`form-analysis-4`, effort low) of these PDFs took 14–24 s each in the 09/10 sweep, with no wrong-party sign-off; who completes CM016's/GEN030's patient details and Allianz section 2 varied between runs, so the hand maps decide. Live drafting (`forms-7`) overflows Bupa's, AXA's and Allianz's boxes – use the prepared answers until `forms-8` passes each box's capacity to the prompt.

## 2. Priority PMIs with no public PDF found (likely portal-based [I])
| Insurer | Official hub | Handling |
|---|---|---|
| **Vitality** | https://www.vitality.co.uk/healthcare-providers/i-am-a-therapist/ | Copy-ready answers; **no automatic portal submission** |
| **WPA** | https://www.wpa.org.uk/healthcare-providers | Copy-ready answers |
| **AXA Health (domestic)** | https://provider.axahealth.co.uk/ | Copy-ready answers |
**Built (RED wave 1, S6):** portal question sets (form kind `questions`) – staff add the portal's questions once, answers are drafted and copied out ("Copy all answers"); no portal login or submission. Demo: our own "Example portal questions (illustrative)".

Research's priority order: **Bupa, AXA Health, Aviva, Vitality, then WPA** (the first four are the main UK PMI brands). Blue Heart's FAQ names AXA Health, Aviva, Vitality, WPA (not Bupa).

## 3. MLC / case-management referrers (Blue Heart) – real names, forms not obtained
HCML, Speed Medical (OPM), PhysioMed Ltd, Physio-Link Services, 3D Rehabilitation, 10 Bridge Physio Ltd, The Physio Network, The Treatment Network. Their forms arrive as Word/PDF per Dell. **Do not use their branding**; wait for Dell's anonymised examples.

## 4. Our fictional demo forms (bundled, in git)
| Label | Referrer (fictional) | Kind | File |
|---|---|---|---|
| (a) | Harrow & Pike Medico-Legal | Word MLC, tables + tick boxes | `Harrow-Pike-ML_Treating-Physiotherapist-Report_HPM-TP3.docx` |
| (b) | Northfield Assurance | Fillable PDF insurer | `Northfield-Assurance_Rehabilitation-Progress-Report_NA-RPR-2.pdf` |
| (c) | Kingsway Case Management | Word, numbered headings, dotted lines | `Kingsway-CM_Return-to-Work-Assessment_KCM-RTW-01.docx` |
| (d) | Meridian Claims Services | Word, content controls (live "new form") | `Meridian-Claims_Physiotherapy-Discharge-Report_MCS-PDR-3.docx` |
| flat | Ashcroft Medical Reporting | Flat PDF (no fields) | `Ashcroft-MR_Physiotherapy-Update-Report_AMR-PU-2.pdf` |
Generated by `npm run medreport:forms` (`scripts/medreport/build-demo-forms.mjs`) – don't rebuild casually (recordings are keyed to bytes).

## 5. Handling by form type (product rules)
| Type | Handling |
|---|---|
| Word .docx | Fully supported; answers written into table cells / placeholders / content controls / tick glyphs; Word out (+ PDF copy where a converter exists) |
| Fillable PDF (AcroForm) | Fully supported; filled in its own fields; flattened on approval |
| Flat PDF | Best effort: text at mapped positions (≥ 8 pt, continuation sheets); needs checking |
| Scanned PDF | Classifies as flat, no text layer → mapping largely manual; never demonstrated; biggest risk |
| XFA PDF | Warning; AcroForm fields used, XFA layer deleted on fill |
| Encrypted PDF | 422 "This PDF is password-protected" – ask for an unprotected copy |
| Old .doc | 422 – "File → Save As → Word Document (.docx)" |
| Portal | Copy-ready answers, no submission |
Fill font is Helvetica/WinAnsi: "→", "≥" etc. are reported, not printed.
