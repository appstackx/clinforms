# Glossary – the full decoder ring

Everything shorthand, acronym, old name, nickname and fictional entity used in the ClinForms work.
Last updated 2026-10-09. Search here when something is not in `CLAUDE.md`.

## Product and project names (incl. old names / codenames)

| Term | Meaning |
|---|---|
| **ClinForms** | The product (since 09/10/2026 14:34 UTC; suggested by the assistant at 14:10 as its top pick of 5, adopted by Khuram). Spelling: capital C and F. "ClinForms by AppStackX" where the vendor matters. Repo `appstackx/clinforms`. Domains to reserve: `clinforms.co.uk` (primary), `clinforms.com`. |
| **AppStackX Reports** | Old product name (06/10 – 09/10/2026). Still visible in Dell's video, its file names, the careconnect-mk branch, internal IDs (`appstackx-reports.*`) and the bundled demo forms' hidden document properties. |
| **medreport** | Internal module name: `src/modules/medreport`; storage prefix `medreport.`; HTTP headers `x-medreport-*`; env vars `MEDREPORT_*`. Never renamed. |
| **"the module" / "Reports"** | How the product was referred to while it lived inside careconnect-mk. |
| **Studio** | The product's review-and-approve web UI at `/reports`. |
| **Report API** | `/api/reports/v1` – "the API is the product"; the Studio is the first app on it. |
| **CareConnect / CareConnect MK / careconnect-mk** | AppStackX's **patient-portal portfolio demo** (booking, prescriptions, records, messages; mock data; banner "This is a portfolio demo by AppStackX"). Repo `appstackx/careconnect-mk`. NOT the forms product – but Khuram's 07/10 email to RED wrongly called the forms product "CareConnect". |
| **the sandbox / sim / tm3-sim** | The **Simulated TM3 sandbox** (`/pms-sandbox`, `/api/tm3-sim/v1`, `src/sandbox/tm3-sim`). Demo scaffolding, not the product. |
| **the video / Dell video** | `AppStackX-Reports-demo-Blue-Heart-Clinics-voiceover-v2.mp4` – 6:15 voiced walkthrough for Dell (v2 = final). |
| **v1 / v2 (video)** | Voiced v1 (13:37 UTC 09/10, buggy: missing line, early starts) vs v2 (13:51, final). |
| **first cut** | 06/10 21:35 video that mentioned Claude – banned, superseded. Never use. |
| **RED demo / RED pack** | Planned demo for RED Physiotherapy's call: Bupa + AXA Global Healthcare + Aviva CM016 completed from one fictional patient; branch `demo/red-physio`. |
| **PH-DEMO-03** | Appears in the original RED task prompt ("e.g. `PH-DEMO-03`") as a label for the planned fictional private-medical-insurance patient. **Superseded:** `PH-DEMO-0N` is reserved for fake HCPC numbers of fictional clinicians, so the patient is `sim-pat-006` (001–005 taken; episode `sim-ep-1006` suggested) with fictional policy/authorisation numbers (e.g. `DEMO-POL-0001`, `DEMO-AUTH-0001`). Use `PH-DEMO-03` only for a new fictional clinician. |
| **ultracode** | Cloud-session mode where every substantive task ran as a multi-agent Workflow. |

## Acronyms – clinical, legal, insurance

| Term | Meaning | Context |
|---|---|---|
| **MLC** | Medico-legal company | Intermediary that instructs clinics and sends its own report forms (Blue Heart's main referrers) |
| **PMI** | Private medical insurance / insurer | Bupa, AXA Health, Aviva, Vitality, WPA – RED's referrers |
| **RTA** | Road traffic accident | Megan Hart's case; personal-injury referrals |
| **WAD (WAD II)** | Whiplash-associated disorder (grade II) | Megan Hart's diagnosis. A live draft once corrupted it to "whale-associated disorder" → `TERM_NOT_IN_SOURCE` check |
| **MSK** | Musculoskeletal | Blue Heart's core physio work |
| **HCPC** | Health and Care Professions Council | Physio registration number recorded on approval |
| **CSP / MCSP** | Chartered Society of Physiotherapy / Member | Fictional physios are "MCSP" |
| **DBS** | Disclosure and Barring Service check | Blue Heart staff are enhanced-DBS-checked |
| **MedCo** | UK whiplash medical-reporting regime | Physio report fixed fee **£226 from April 2025** (was £180). ClinForms is NOT a MedCo initial-report tool |
| **CPR Part 35 / statement of truth** | Civil Procedure Rules for expert court reports | Physio stays author and signs; tool only drafts. Blue Heart shows no sign of writing expert reports |
| **NDI / ODI / NPRS / PSFS / QuickDASH** | Outcome measures: Neck Disability Index, Oswestry Disability Index, Numeric Pain Rating Scale, Patient-Specific Functional Scale, Quick Disabilities of Arm/Shoulder/Hand | Computed facts `FACT-outcomes-<X>` |
| **AROM / HEP / LBP** | Active range of motion / home exercise programme / low back pain | Written out in drafts (`CLINICAL_ABBREVIATIONS`) |
| **DNA / ATT / LCN** | Did not attend / attended / late cancellation | Appointment statuses in the sim |
| **PMH** | Past medical history | Withheld from employer and case-manager forms (`formScope()`) |
| **OH / HR** | Occupational health / human resources | Employer-form context |
| **MMI** | Maximum medical improvement | Tick box on Harrow & Pike form |
| **GDPR / UK GDPR** | Data protection law | Health = special-category data |
| **DPA** | Data processing agreement | Clinic = controller, AppStackX = processor; must name Anthropic as sub-processor |
| **DPIA** | Data protection impact assessment | Before any real data |
| **DPO** | Data protection officer | Ask Dell's before a pilot |
| **ICO** | Information Commissioner's Office | Registration needed for SaaS |
| **CE / CE+** | Cyber Essentials / Cyber Essentials Plus | UK security certification, planned |
| **ZDR** | Zero data retention (Anthropic arrangement) | Planned compliance item |
| **UK IPO** | UK Intellectual Property Office | Trademark search for "ClinForms", classes 9 and 42 (pending) |
| **VAT** | Value added tax | Physio is VAT-exempt → clinics can't reclaim; £149 ≈ £179 to them |

## Acronyms – technical

| Term | Meaning |
|---|---|
| **AcroForm** | Fillable PDF form (fields). Fully supported: filled in its own fields, flattened on approval |
| **Flat PDF** | Print-and-fill PDF with no fields. Best effort: text overlaid at mapped positions (`PdfOverlayAnchor`) |
| **Scanned PDF** | Image-only PDF, no text layer. Classifies as flat; mapping largely manual; never demonstrated. Scanned *notes* PDFs are refused (no OCR) |
| **XFA** | Adobe dynamic-form layer; detected, warned, deleted on fill (`deleteXFA()`) |
| **docx** | Word file. Old binary `.doc` is refused (422 with "Save As .docx" instructions) |
| **SignReceipt** | `{reportId, tenantId, contentSha256, signer, signedAt, attestations, formMapSha256?, approvedVia, mac}`; `mac` = HMAC-SHA256 with `MEDREPORT_SIGNING_SECRET` |
| **attested map** | Form map confirmed via `POST /forms/confirm`; server adds `confirmed {by, at, mapSha256, mac}`. Required by `/drafts`, `/sign`, final `/render` (else 409 `FORM_NOT_CONFIRMED`) |
| **launch token / session token** | HMAC tokens: launch 10 min single-use (`jti`), session 1 h bound to tenant/patient/episode |
| **partner key** | `x-partner-key` header the clinic system sends on `POST /launch` (`MEDREPORT_PARTNER_KEY`) |
| **passcode** | `x-medreport-passcode`; presenter types it in the Studio to allow live AI calls (`MEDREPORT_LIVE_PASSCODE`) |
| **demo / live / auto mode** | `MEDREPORT_AI_MODE`. demo = never calls AI (recorded/pre-written drafts, badged); live = key + passcode required; auto (default) = live only when available and passcode sent |
| **recorded drafts / recorded analyses** | Real Claude output frozen in JSON (`ai/demo-drafts/*.json`, `ai/recorded/forms/*.json`), keyed to file SHA-256 / bundle fingerprint |
| **pre-written draft** | Hand-made demo answers (Ashcroft flat PDF), badged "Pre-written draft – no AI call" |
| **bundle / EpisodeBundle** | One patient episode's registration, notes, appointments, outcomes as JSON |
| **source IDs** | Citations: `REG` (registration), `N-001…` (notes), `FACT-attendance`, `FACT-age`, `FACT-episode`, `FACT-outcomes-<X>` |
| **gap** | A visible "missing information" item for the clinician (never guessed) |
| **flags** | Validator results: `UNCITED_PARAGRAPH`, `FIGURE_NOT_IN_SOURCE`, `OPINION_LANGUAGE`, `TERM_NOT_IN_SOURCE`, `SCOPE_TERM`, `MISSING_PLACEHOLDER`, `OPEN_GAP`, `UNKNOWN_SOURCE_ID`, `DATA_CHECK` |
| **[CLAIMANT]** | Placeholder replacing the patient's name before any AI call (data minimisation) |
| **forms-7 / form-analysis-3 / "2" / rules-1** | Current prompt versions (drafting forms / form analysis / built-in templates / no-AI analysis) |
| **effort** | Claude `output_config.effort`: analysis `low`, drafting `medium` |
| **lhr1** | Vercel London region; `vercel.json` pins functions there |
| **OpenNext / vinext** | Adapters to run Next.js on Cloudflare Workers (vinext reportedly now recommended – unverified) |
| **Gotenberg** | LibreOffice-in-a-container HTTP service; candidate Word→PDF converter |
| **soffice** | LibreOffice binary used for Word→PDF (`MEDREPORT_SOFFICE_PATH`) |
| **RLS** | Supabase/Postgres row-level security (planned per-clinic isolation) |
| **E2E** | Playwright browser end-to-end flows (42 steps in demo mode). The ad hoc scripts are in git at `scripts/e2e/*.cjs` (commit `32499de`, written for port 3107, outputs to gitignored `.e2e-out/`). The runner shell scripts `run-all.sh` and `rebuild.sh` were not preserved. |
| **SRT** | Subtitle file for the Dell video (62 entries) |
| **LUFS** | Loudness unit; narration normalised to −16 LUFS |
| **Scribe** | ElevenLabs speech-to-text, used to QA the voice-over |
| **stop hook** | Cloud-only `~/.claude/stop-hook-git-check.sh` that forced WIP commits; absent on desktop |

## People and nicknames → full identity

| Name used | Who |
|---|---|
| **Khuram** | Khuram Masood, AppStackX (the user) |
| **Dell** | Dell Baines = Dell David Henson-Baines (Companies House) = "Dell Henson-Baines" (old Physio Assured / Celtic SMR quote). Owner of Blue Heart Clinics |
| **Daniel** (prospect) | Daniel Vatamanu, co-founder, RED Physiotherapy |
| **Daniel Brooks** | FICTIONAL demo patient – do not confuse with Daniel Vatamanu |
| **Daniel Okafor** | Name of the employer demo patient in the first plan; renamed Daniel Brooks in the build |
| **Beth** | ElevenLabs voice "Beth – Intelligent, warm, approachable English professional premium female", `utezIGbCLSGO3Z7oKJwL` |

## Companies (real)

| Name | What |
|---|---|
| **AppStackX / AppstackX Ltd** | Khuram's company (vendor of ClinForms and CareConnect). Site `appstackx.co.uk`; GitHub org `appstackx` |
| **Blue Heart Clinics (Ltd)** | Dell's physio business; company 09158709; formerly **Physio Assured** (renamed 10/01/2023) |
| **RED Physiotherapy LTD** | Daniel's clinic group; company 13547807; Milton Keynes, Towcester, Northampton |
| **TM3** | Blue Heart's practice-management system (vendor not engaged; never imply partnership) |
| **Heidi (Heidi Health)** | AI scribe already inside TM3; main competitor |
| **Physitrack** | TM3-integrated exercise tool, £39.99/user/month – price benchmark |
| **Cliniko** | Another PMS; possible future connector; hosts "ClientForms" app |
| **ClientForms** | Australian assessment-forms app in Cliniko's marketplace – nearest name clash to ClinForms |
| **HCML, Speed Medical (OPM), PhysioMed, Physio-Link, 3D Rehabilitation, 10 Bridge Physio, The Physio Network, The Treatment Network** | Blue Heart's rehab / case-management partner networks (source of MLC forms). Never use their branding in demos |
| **Anthropic** | Drafting/form-analysis sub-processor (Claude API). Never named to customers except in the DPA / if asked |
| **ElevenLabs** | Voice-over vendor (connected to Claude by Khuram) |
| **Vercel / Supabase / Cloudflare / Railway / Fly.io** | Hosting options (see `context/hosting-and-infra.md`) |
| **Celtic SMR** | Blue Heart's laser (MLS Class IV) supplier |
| **LaingBuisson** | Source of UK health-cover market size (£7.59bn, +£825m in a year) |

## Fictional demo entities (never real)

| Fictional name | Used as |
|---|---|
| **Riverside Physiotherapy (fictional)**, Milton Keynes | Demo clinic/letterhead (Unit 4, Riverside Court (fictional), MK9 0ZZ, 01908 000000, reports@riverside-physio.example) |
| **Megan Hart** `sim-pat-001` / `sim-ep-1001` | 34, office administrator; RTA 12/03/2026 rear-end shunt, WAD II; 10 notes, 11 appts (1 DNA), NDI 42→24→12 %, NPRS 7→4→2; no prognosis recorded (planted gap). Employer "Ashby Property Services (fictional)" |
| **Daniel Brooks** `sim-pat-002` / `sim-ep-1002` | 46, warehouse operative; lifting injury 02/06/2026, mechanical LBP; 6 notes, 7 appts (1 LCN); ODI 48→30→18 %; discharge opinion "phased return over 2 weeks; avoid repetitive lifting >15 kg for 4 weeks" |
| **Aisha Rahman, George Whitfield, Chloe Bennett** | `sim-pat-003/004/005`, registration only |
| **Priya Nair** | File-import sample patient (JSON/CSV/pasted text + printed-notes PDF) |
| **Sarah Reid** `PH-DEMO-01` | Senior Physiotherapist (signer for Megan) |
| **Tom Ellis** `PH-DEMO-02` | Physiotherapist (signer for Daniel Brooks) |
| **Harrow & Pike Solicitors / Medico-Legal** | Word MLC form (a); ref `HP/RTA/2291`; contact "Amelia Grant" |
| **Northfield Assurance** | Fillable-PDF insurer form (b); claim ref shown in video `NA-PI-77310`. Unrelated to Blue Heart's Ealing address on Northfield Ave |
| **Kingsway Case Management** | Word case-manager return-to-work form (c) |
| **Meridian Claims Services** | Word form (d) used for the live "upload a new form" moment; 17 questions |
| **Ashcroft Medical Reporting** | Flat (non-fillable) PDF sample |
| **Ashby Freight Ltd** | Daniel Brooks's employer; ref `AF-OH-0457`; contact "Karen Doyle, HR & OH Adviser" |
| **Northfield Logistics Ltd** | Employer name in the first plan (replaced by Ashby Freight) |
