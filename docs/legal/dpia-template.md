# Data protection impact assessment (DPIA) – template for a clinic

> **DRAFT – 14/11/2026, pending legal review.** A DPIA is the **clinic's** document (it is the controller). We give
> each clinic this pre-filled template so it only has to check our parts and add its own. Fill every `<…>`.
> Match the DPA (`content/dpa.json`) – Annex 2 (security) and Annex 3 (sub-processors) are the source.

## 1. About this assessment
| | |
|---|---|
| Clinic (controller) | `<clinic legal name>` |
| Completed by / role | `<name, e.g. practice owner or DPO>` |
| Date / review date | `<date>` / `<date + 12 months, or sooner if the processing changes>` |
| Processor | AppstackX Ltd (ICO ZC135044), providing ClinDesk / ClinForms |
| Why a DPIA | Large-scale processing of health data (special category) using new technology |

## 2. What the processing is
- **Purpose:** running the clinic – diary, patient records, clinical notes, billing, patient messages, and (ClinForms)
  completing referrers' own report forms from the clinic's notes.
- **Data subjects:** patients, clinic staff and users, referrers, insurers and other contacts.
- **Data:** identity and contact details, appointments, billing, clinical notes and assessments (health data).
- **Lawful basis (clinic to confirm):** Article 6(1)(b) contract / (f) legitimate interests for private patients
  (`<or (e) for NHS-funded work>`); Article 9(2)(h) health or social care, with the DPA 2018 Schedule 1 condition 2.
- **Volume:** `<number of patients / year>` across `<number of sites>`.
- **Retention:** set by the clinic in the service (reports deleted automatically); records per HCPC/CSP guidance
  (adults: at least 8 years after the last treatment).
- **Who sees it:** clinic staff by role and site; AppstackX only to provide support; the sub-processors in DPA Annex 3.

## 3. Necessity and proportionality
- Only the data needed to run the clinic is collected; optional features (drafting from notes, text messages, card
  payments) are **off until the clinic switches them on**.
- Drafting from notes receives a **minimised extract** – no patient name, date of birth, address or contact details –
  and every clinical opinion stays with the clinician, who approves every report.
- Patients are told through the clinic's privacy notice `<link>`; their rights are handled by the clinic, with our help
  (DPA section 8).

## 4. Risks and measures
| Risk to individuals | Likelihood / severity before | Measures | Residual |
|---|---|---|---|
| Unauthorised access to records (stolen password) | Possible / Severe | Two-step verification for every user, invite-only accounts, roles by site, audit trail | Low |
| Staff seeing more than their job needs | Possible / Significant | Access by role and site; audit trail of every view | Low |
| Data breach at the provider | Remote / Severe | Encryption in transit (TLS 1.2+) and at rest (AES-256, per-clinic key for notes and files); UK hosting; 48-hour breach notice (DPA §9) | Low |
| Data sent outside the UK | Probable (some sub-processors) / Minimal–Significant | Only where Annex 3 says, with an adequacy regulation, the UK–US data bridge or the IDTA; minimised extract for drafting | Low |
| Wrong content in a report | Possible / Significant | Clinician reviews and approves every report; every drafted answer cites its note; names and numbers copied, not drafted | Low |
| Data lost | Remote / Significant | Daily backups kept 7 days in the UK; clinic can export at any time | Low |
| Kept too long | Possible / Minimal | Clinic-set retention with automatic deletion; deletion 30 days after leaving | Low |
| Message to the wrong patient | Possible / Significant | `<clinic: check contact details at booking; staff training>` | `<clinic>` |

## 5. Sign-off
| Item | Name / date | Notes |
|---|---|---|
| Measures approved by | `<clinic>` | |
| Residual risks accepted by | `<clinic>` | If any residual risk stays **high**, the clinic must consult the ICO before starting |
| DPO advice (if the clinic has one) | `<clinic>` | |
| Review | `<date>` | |
