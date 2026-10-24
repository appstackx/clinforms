# ClinForms – sub-processors

**Draft v0.1 – 24 October 2026 – for review.** This is not legal advice. A solicitor should review it before it is
sent. Placeholders are marked **[TO CONFIRM]**.

Provider of ClinForms: **AppstackX Ltd** (company number [TO CONFIRM], registered office [TO CONFIRM]).
Contact: khuram@appstackx.co.uk.

This list forms Annex 3 of the ClinForms data processing agreement (DPA). It names every third party that AppstackX
uses, or plans to use, to process the patient information a clinic brings into ClinForms ("clinic personal data").
The clinic is the controller of that information and AppstackX is its processor. A second table lists the providers
that do **not** process clinic personal data, so that the list is complete.

## 1. Sub-processors that process clinic personal data

| # | Sub-processor | Service | Clinic personal data it handles | Where | Transfer safeguard | Status |
|---|---|---|---|---|---|---|
| 1 | **Vercel** – Vercel Inc. [TO CONFIRM contracting entity] | Application hosting: runs the ClinForms website and application | All clinic data while a request is handled: uploaded notes, referrer forms, reports and completed forms. Reports, form set-ups and form files are decrypted only inside the application, in memory | Application functions in **London, UK** (region `lhr1`). Requests reach them through Vercel's network. The company is based in the USA | [TO CONFIRM from Vercel's DPA: the mechanism that covers any access from outside the UK, e.g. the UK Addendum or IDTA] | In use |
| 2 | **Cloudflare** – Cloudflare, Inc. [TO CONFIRM contracting entity] | Database (Cloudflare D1) and the data gateway in front of it (Cloudflare Workers) | All stored clinic data. Reports, form set-ups and form files are encrypted by ClinForms **before** they reach Cloudflare (AES-256-GCM, a key specific to each clinic). Clinic and user account details, the activity log (no patient information) and record metadata (ids, statuses, form titles, referrer names) are stored without that extra encryption [TO CONFIRM the provider's own encryption at rest] | Database in the **EU** (D1 EU jurisdiction). The gateway runs on Cloudflare's network. The company is based in the USA | EU: UK adequacy regulations for the EEA. Any other access: [TO CONFIRM from Cloudflare's DPA] | In use. To be replaced as the database by Supabase (row 4) |
| 3 | **Anthropic** – [TO CONFIRM contracting entity, e.g. Anthropic, PBC] | Drafting service: (a) drafts answers to a form's questions from minimised extracts of treatment notes, for a clinician to review and approve; (b) reads the layout and questions of a referrer form when the form is set up | (a) **Minimised extracts** of treatment notes and the form's questions: the patient's name is replaced by a placeholder, age is sent instead of date of birth, addresses and contact details are left out, and dates of birth in the note text are removed. Names, dates of birth, references and clinician details on the form are filled in by ClinForms itself, never by the drafting service. For employer and case-manager forms, past medical and social history are held back. The extracts are still personal data and health data (pseudonymised, not anonymous). (b) Blank form templates; if a filled-in form is uploaded, its patient details are masked first | **USA** [TO CONFIRM whether a UK or EU processing location is available] | [TO CONFIRM: IDTA or UK Addendum to the EU Standard Contractual Clauses, with a transfer risk assessment – see DPA Annex 4. UK adequacy regulations (UK Extension to the EU–US Data Privacy Framework) apply only if the provider is certified – check before signing] | In use (the public demo, fictional data only). For a clinic, **nothing is sent until its owner or an administrator switches drafting on** (Settings → Clinic), which happens only after the DPA is signed. The same switch controls reading forms: while it is off, ClinForms reads forms with its own layout rules |
| 4 | **Supabase** – Supabase, Inc. [TO CONFIRM contracting entity] | Database (PostgreSQL), replacing row 2's database | The same as row 2, with the same ClinForms encryption | **London, UK** (AWS `eu-west-2`) | [TO CONFIRM from Supabase's DPA for any access from outside the UK] | **Planned** – before real patient data [TO CONFIRM date]. Cloudflare's database is kept read-only for about 30 days after the move, then deleted |
| 5 | **MailerSend** – [TO CONFIRM contracting entity] | Email delivery: invitations, password resets and security notices | Users' names and work email addresses, and the links in those emails. **No patient information** | [TO CONFIRM] | [TO CONFIRM] | **Chosen, not in use.** Until it is switched on, invitation and reset links are passed on by hand |
| 6 | Document converter – provider not chosen | Converting completed Word forms to PDF | Completed forms | UK (planned) | – | **Planned, not built.** Word forms download as Word today |

Notes:
- Row 5 handles account data, for which AppstackX is the controller (see the ClinForms privacy policy). It is listed
  here because its emails are sent to the clinic's own users.
- ClinForms does not send completed forms to referrers and is not connected to the clinic's practice-management system.
  The clinic downloads each approved form and sends it through its own channel.

## 2. Providers that do not process clinic personal data

| Provider | What for | Why it does not see clinic personal data |
|---|---|---|
| **PostHog** (EU cloud) [TO CONFIRM contracting entity] | Product analytics | Runs only after a visitor or user allows analytics. Only a fixed list of events with short coded values and counts is sent (no free text, names, emails, ids or file names); page views are counted for the public website pages only. AppstackX is the controller of this data |
| **Cloudflare** (R2 storage and DNS) | The public demo video at media.clinforms.co.uk; DNS for clinforms.co.uk | The video bucket holds only the demo video. DNS directs visitors to the application host and does not carry application traffic |
| **Google Workspace** | AppstackX's email (khuram@appstackx.co.uk) for support and contracts | Not used for patient information. **Please do not send patient information by email.** If a support case needs it, we agree a channel first |
| **GitHub** | ClinForms source code | Holds code only, never clinic data |

## 3. Changes to this list

- AppstackX tells the clinic by email at least **[30] days [TO CONFIRM]** before a new or replacement sub-processor
  starts to process clinic personal data, so that the clinic can object (DPA clause 5).
- The planned sub-processors above (rows 4 and 6) are authorised by the DPA. AppstackX still tells the clinic at least
  **[14] days [TO CONFIRM]** before each one starts.
- Each sub-processor is bound by a written contract with data protection terms (UK GDPR Article 28(4)). AppstackX
  remains responsible to the clinic for its sub-processors.

| Version | Date | Change |
|---|---|---|
| 0.1 | 24 October 2026 | First draft |
