# Insurer and referrer forms – catalogue

Purpose: which real forms exist, where to get them, how ClinForms would handle them, and priority.
**Rules:** download only into the gitignored `/demo-assets/` (e.g. `demo-assets/insurers/`); **never commit** third-party PDFs or outputs made from them; label "Public form used for demonstration only – not affiliated with or endorsed by <insurer>. Fictional patient data."; private demos only, never public marketing; never claim they are a prospect's own forms; no real insurer/MLC branding in our own demo forms.
**Status (09/10):** none downloaded or classified yet (cloud proxy returned 403 CONNECT for every insurer host). Classify each on the desktop: AcroForm (fillable) / flat / scanned / XFA / encrypted.

## 1. Public PMI forms (research pasted by Khuram 09/10 14:08 UTC; "I checked the documents themselves" – author not stated)

| # | Insurer – form | URL | Pages / content | ClinForms handling (expected) | Priority |
|---|---|---|---|---|---|
| 1 | **Bupa – Further Physiotherapy Treatment Request** ("therapies management form") | https://www.bupa.co.uk/~/media/files/hcp/latest-updates-from-bupa/forms/therapies-management-form.pdf | 3 pp: assessment findings, outcome measures, treatment response, additional sessions, treatment justification. "Best match for our demo" | Fillable → fully supported; flat → best effort | **RED Tuesday #1** |
| 2 | **AXA Global Healthcare – Therapy Treatment Plan** | https://www.axaglobalhealthcare.com/globalassets/intermediary/sales-tool-kit/operational-forms/eu/therapy-treatment-plan-form---english.pdf | 4 pp: clinical questions, functional limitations, pain scale, care planning. **International – label separately from domestic AXA Health** | As above | **RED Tuesday #2** |
| 3 | **Aviva – Private Medical Insurance Claim Form CM016** | https://static.aviva.io/content/dam/document-library/health/cm016.pdf | 8 pp: patient details, symptoms, medical history, practitioner sections. General claim form (not a physio progress report); shows sections completed by different people | **Clinician sections only**; patient parts + declarations left for the right person | **RED Tuesday #3** |
| 4 | Aviva – Medical Report Request **GEN030** | https://static.aviva.io/content/dam/document-library/health/gen030.pdf | 2 pp: treatment history, dated events, prognosis, future treatment. Underwriting report **requiring a doctor** | Physio shouldn't complete it – **format example only**, labelled | Optional |
| 5 | Freedom Health Insurance – **Freedom Worldwide** Outpatient Medical Treatment Claim Form | https://www.freedomhealthinsurance.co.uk/getmedia/7d7633f2-0ab0-4fb6-9071-28dfba6d2572/worldwide-medical-claim-form | 4 pp: symptoms, diagnosis, recommended treatment, expenses table explicitly incl. physiotherapy; international reimbursement; repeated rows, supporting-document requirements | Repeated-row tables may need continuation handling | Optional |
| 6 | **Allianz Care – Pre-authorisation Form** | https://www.allianzcare.com/content/dam/onemarketing/azcare/allianzcare/en/docs/FRM-PreAuth-EN-0825.pdf | 3 pp: patient + doctor sections; general international treatment authorisation | Clinician/doctor sections only | Optional |

## 2. Priority PMIs with no public PDF found (likely portal-based [I])
| Insurer | Official hub | Handling |
|---|---|---|
| **Vitality** | https://www.vitality.co.uk/healthcare-providers/i-am-a-therapist/ | Copy-ready answers; **no automatic portal submission** |
| **WPA** | https://www.wpa.org.uk/healthcare-providers | Copy-ready answers |
| **AXA Health (domestic)** | https://provider.axahealth.co.uk/ | Copy-ready answers |
Optional future feature (offered, not agreed): "portal questions → copy-ready answers" – treat the portal's questions as a form whose answers are shown for copy/paste.

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
