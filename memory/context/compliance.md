# Compliance, GDPR and security – built vs promised

**Bottom line (10/10/2026, go-live):** the **technical** safeguards are now **built and live** on clinforms.co.uk (§5b) – but still **no real patient data**: the documents (DPA, DPIA, ICO registration, Cyber Essentials, ZDR) are **not done**, and only the internal clinic `appstackx` exists (fictional data). Describe the technical measures as built; never describe the documents/certifications as in place. Clinic data is stored in the **EU** (Cloudflare D1, EU jurisdiction), the app runs in London – the privacy policy says exactly that; don't claim UK-only storage.
*(09/10 wording, for the record: the demo used fictional data only and stored reports in the browser; the GDPR measures Dell was shown were commitments.)*

## 1. Roles and documents (promised, not done)
- **DPA:** clinic = **controller**, AppStackX = **processor**. Must list sub-processors, including **Anthropic** (drafting/form analysis) – required by UK GDPR even though customer materials never name AI.
- **DPIA** before real data (health data = special-category under UK GDPR). Ask the clinic's DPO.
- **ICO registration** (AppStackX), **Cyber Essentials** then **Plus**, pen test.
- **Anthropic commercial terms with no training on clinic data; zero-data-retention (ZDR) arrangement** where available. Claude Fable 5.1 excluded partly because it needs 30-day retention.
- **Data residency:** UK hosting (Vercel `lhr1`, Supabase London, UK converter). Make **no UK-only AI processing claim** until `inference_geo` options are confirmed; the DPIA covers the transfer.
- Legal review of CPR Part 35 / statement-of-truth wording and MedCo scope (ClinForms is **not** a MedCo initial-report tool).
- Intended-purpose statement: a **documentation tool, not clinical decision support**.
- Contracting: confirm the prospect's legal entity (Blue Heart Clinics Ltd files dormant accounts), VAT status, MLC data-handling rules.

## 2. Disclosure rule
- Customer-facing materials stay neutral ("the system drafts each answer from the notes"); the Security & GDPR page says drafting is done by "**a contracted sub-processor**" without naming it.
- **Disclose truthfully** in the DPA (Anthropic named) and **if a customer asks**. (Assistant, 06/10 21:42 UTC; accepted.)
- Draft reply 2 to Dell (06/10 15:24) mentions "an AI service … that exclude[s] training on your data" – written before the no-AI-wording rule.

## 3. What was promised to Dell (draft 2 + video GDPR card)
DPA (clinic controller / us processor) + DPIA; UK hosting; encryption in transit and at rest; two-factor login; automatic deletion after an agreed period; minimised data sent to the drafting service under contract (no training); audit trail; clinician approval of everything; proof of concept on anonymised data only. "To be confirmed with Dell's DPO before a pilot."

## 4. Data minimisation (BUILT)
- "Data minimisation, not anonymisation" (stated in UI and docs).
- Before drafting: name → `[CLAIMANT]` (swapped back by code); age instead of DOB; no address/contacts; DOBs in note text removed; identifiers on the form (name, DOB, references, clinician details) filled by code, never by the AI.
- Scope: past medical + social history withheld for employer and case-manager forms (`formScope()`), flagged `SCOPE_TERM` if they appear.
- Before form analysis: filled-in forms have patient details masked (`ai/form-redact.ts`); PDFs sent blank (`forms/pdf-blank.ts`).
- Note/form text treated as data, never instructions.
- `POST /ai/payload-preview` + "See exactly what is sent…" panel shows the minimised payload.
- Logs: IDs, timings, token counts only – never note text, names or secrets.

## 5. Security measures BUILT (demo-grade, verified 06–09/10)
- HMAC **launch tokens** (10 min, single use `jti`) and **session tokens** (1 h, bound to tenant/patient/episode); partner key on `/launch`; sandbox server action looks up clinician by ID (browser can't supply its own).
- **SignReceipt** (HMAC over canonical content hash); final render only with valid receipt, matching hash, no blocking flags, approved map; approval bound to a sign-in (`SESSION_MISMATCH`, `SIGNER_MISMATCH`).
- **Attested form maps** (server MAC over map SHA-256); filed-document tokens (`x-medreport-file-token`).
- Live AI behind a **presenter passcode** (timing-safe compare), **6 live calls/min/instance**, wrong-guess limits (5/client, 30/instance per 10 min).
- SSRF fix: connector calls only `simTrustedBaseUrl()`, never the Host header.
- Zip-bomb / PDF stream guards; old `.doc` and encrypted PDFs refused; docx-preview output sanitised (no scripts/frames/`href`/`on*`).
- LibreOffice hardened (minimal env, macros off, no linked updates, max 2, kill on timeout).
- Production-secret rule on Vercel; secrets server-side only (never `NEXT_PUBLIC_`).
- 14 blocker/major security-review findings fixed at careconnect-mk `08a0aac` (06/10 20:41 UTC).
- Neutral-wording guard test.
- Deliberately **not** done: CSP (needs nonces), passcode-length enforcement, Unicode font in PDF fills, OCR, converter host patching/egress (operational).

## 5b. BUILT and LIVE at go-live (10/10/2026)
Invite-only accounts (Better Auth) with **required TOTP two-step** and roles (owner/admin/clinician/staff); per-clinic
tenancy; **AES-256-GCM encryption at rest per clinic** (reports, form maps, files; key id `k2`, offline backup);
**append-only audit log** (database triggers) visible to clinics at `/app/settings/activity`; **retention cron** (daily,
per-clinic `retention_days`); shared (database) rate limits; drafting from notes **off for a new clinic** until its
owner switches it on after the DPA; staff check imported notes before a record is built; consent-gated analytics
(PostHog EU; "discard client IP" setting = Khuram's pre-flight item, not verified here); security headers (HSTS, CSP Report-Only); public demo passcode verified by the server.

## 6. NOT built yet (needed before real patient data)
UK database (Supabase London – later, D39; today D1 EU); UK converter service; mapping of real TM3 exports; email
sending (MailerSend); CSP enforcement + report endpoint; scheduled off-site backups; Workers Paid / Vercel Pro; all
documents in §1 (DPA, DPIA, ICO, Cyber Essentials, ZDR, legal review, intended-purpose statement); legal pages' owner
review, company number and ICO line on the site.

## 7. Handling rules for the team (us)
- Never commit secrets or `.env.local`; scan staged diffs (`sk-ant-` etc.) before every commit.
- **(10/10)** Production `MEDREPORT_*`/`TM3_SIM_TOKEN` are fresh values; the production data key was rotated k1 → k2 after k1 appeared in a screenshot (no data existed). The Anthropic key confirmation is still open (keep the new key, delete older ones).
- **Rotate EVERY Anthropic key that was ever in the cloud container:** the one pasted in chat 06/10 12:18 UTC, plus a second key file the 09/10 build report mentions ("The different key file in the scratchpad was not used"). Ask Khuram which keys exist in the Anthropic Console and revoke all but one fresh key; use a spend-limited workspace + alerts.
- Treat `MEDREPORT_LIVE_PASSCODE`, `MEDREPORT_LAUNCH_SECRET`, `MEDREPORT_SIGNING_SECRET`, `MEDREPORT_PARTNER_KEY` and `TM3_SIM_TOKEN` from the cloud `careconnect-mk/.env.local` as **burned** (the passcode also appeared in chat); generate new values (e.g. `openssl rand -base64 32` each, a 24-char passcode) – Khuram does this himself, never pasted in chat. Values were never copied into memory.
- Prospect-supplied files (Dell's anonymised forms/notes) and third-party insurer PDFs stay out of git (`/demo-assets/`). Screenshots of real emails are personal data – don't store them in the repo.
