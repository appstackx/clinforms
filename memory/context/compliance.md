# Compliance, GDPR and security – built vs promised

**Bottom line (09/10/2026):** the demo uses **fictional data only** and stores reports in the browser. The GDPR measures Dell was shown are **commitments to put in place before any real patient data**, not built or certified. Never describe them as already in place.

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

## 6. NOT built yet (needed before real patient data)
User accounts with **2FA/MFA** and roles; per-clinic tenancy in a **UK database** (Supabase London) with **encryption at rest** (+ field-level); **append-only audit log** server-side; **retention/auto-deletion** jobs; shared (non-memory) rate limits; per-clinic partner keys / OAuth client credentials; UK converter service; mapping of real TM3 exports; all documents in §1.

## 7. Handling rules for the team (us)
- Never commit secrets or `.env.local`; scan staged diffs (`sk-ant-` etc.) before every commit.
- **Rotate EVERY Anthropic key that was ever in the cloud container:** the one pasted in chat 06/10 12:18 UTC, plus a second key file the 09/10 build report mentions ("The different key file in the scratchpad was not used"). Ask Khuram which keys exist in the Anthropic Console and revoke all but one fresh key; use a spend-limited workspace + alerts.
- Treat `MEDREPORT_LIVE_PASSCODE`, `MEDREPORT_LAUNCH_SECRET`, `MEDREPORT_SIGNING_SECRET`, `MEDREPORT_PARTNER_KEY` and `TM3_SIM_TOKEN` from the cloud `careconnect-mk/.env.local` as **burned** (the passcode also appeared in chat); generate new values (e.g. `openssl rand -base64 32` each, a 24-char passcode) – Khuram does this himself, never pasted in chat. Values were never copied into memory.
- Prospect-supplied files (Dell's anonymised forms/notes) and third-party insurer PDFs stay out of git (`/demo-assets/`). Screenshots of real emails are personal data – don't store them in the repo.
