# Supplier management policy

AppstackX Ltd · Owner: Khuram · Approved 11/11/2026 · Next review 11/11/2027

**Internal list. It names suppliers.** The customer-facing privacy pages describe them by function only. The DPA's
sub-processor schedule names them, and so do our answers when a clinic asks.

## Rules
1. **Before a supplier touches clinic or personal data:** check its security (certification such as ISO 27001 or
   SOC 2), its data location, and its DPA. Sign or accept its DPA. Record the transfer safeguard if data leaves the UK
   (adequacy, IDTA or the UK Addendum, plus a transfer risk assessment). Add it to the table below.
2. **New or replaced sub-processor of patient data:** tell clinics in advance so they can object (privacy policy §5
   and the DPA).
3. **Least data:** send a supplier only what it needs. The drafting provider gets minimised extracts only, and only
   for clinics that switched drafting on after signing their DPA.
4. **Accounts:** company login, MFA on, and least-privilege API keys ([access control](access-control.md)).
5. **Review yearly** (and when a supplier changes terms or reports a breach). Remove suppliers we no longer use, and
   delete our data from them.

## Sub-processors and suppliers (status 11/11/2026)
| Supplier | Used for | What it holds | Location | DPA status |
|---|---|---|---|---|
| **Vercel Inc.** | App hosting (project `clinforms`, region `lhr1`); runs the code, logs, crons | All data in transit and in memory; request logs (no note text) | London compute; US company | To confirm (Vercel DPA). **Hobby plan = non-commercial: move to Pro before a paying clinic** |
| **Supabase Inc.** | Production database (project `clinforms`, London) and private file bucket `clinic-files` | All clinic data: accounts, audit log, clinic records; free text and files AES-256-GCM encrypted per clinic | UK (eu-west-2); US company | To confirm (Supabase DPA signed in the dashboard?). PITR off |
| **Cloudflare Inc.** | DNS + registrar (clinforms.co.uk, clindesk.co.uk); R2 media (videos); Workers (gateway); frozen D1 `clinforms-prod` until ~29/11/2026; D1 `clinforms-preview`; Turnstile human check (when switched on) | D1 prod: copy of clinic data up to 29/10/2026 (delete after the window). R2: demo videos only. Turnstile: browser signals only | EU (D1, R2 jurisdiction eu); global edge; US company | To confirm (Cloudflare DPA, part of its self-serve terms) |
| **MailerSend** (MailerLite group) | Transactional email: invitations, resets, security notices; clinic emails to patients when switched on | Recipient names and emails, message content and links | EU | To confirm |
| **PostHog Inc.** | Website statistics (EU cloud, project 300254), cookieless by default | Page views, campaign tags, no clinic data | EU (Frankfurt) | To confirm |
| **Anthropic PBC** | Drafting service (Reports add-on only; off for a clinic set up by hand until it switches it on; on from sign-up for a clinic that signs up online and accepts the DPA, which it can switch off) | Minimised note extracts per draft (name replaced, no address or DOB) | US | To confirm: commercial terms with no training on our data, **zero data retention**, DPA, **IDTA/Addendum + TRA**. Rotate and remove old API keys (open item) |
| **Stripe** | Subscription billing; clinic card payments (when switched on). ClinDesk account still to be created | Customer billing details; card data stays with Stripe | UK/EU entities; US processing | To confirm (Stripe DPA is part of its services agreement) |
| **The SMS Works Ltd** | Patient text messages (chosen 31/10/2026; account not opened) | Mobile numbers and message text | UK | To confirm when opened |
| **Google (Workspace)** | Business email for appstackx.co.uk, clindesk.co.uk, clinforms.co.uk | Correspondence with clinics; may hold personal data | EU/US | To confirm (Workspace Cloud Data Processing Addendum accepted in the Admin console?) |
| **Google (Ads)** | Advertising measurement, consent-only | Ad measurement data from public pages; no clinic data | US/EU | Separate controller (not a sub-processor) |
| **GitHub (Microsoft)** | Source code (`appstackx/clinforms`, private) | Code and docs; **no secrets, no patient data** | US | Standard terms; no clinic data |
| **Hostinger / Axidomains** | Registrar and DNS for appstackx.co.uk | Domain records | EU | No personal data; MFA on the account |
| **Apple (iCloud, Passwords)** | Encrypted key-backup image; password manager | Encrypted secrets only | – | Personal account: MFA on |

Not suppliers of clinic data: ElevenLabs and Slack (marketing and internal use only). They are still in scope for
Cyber Essentials, so MFA must be on. Healthcode (insurer e-billing) is not connected: the clinic uploads its own files.

## To do
- Collect and file each DPA (PDF, date accepted) in a `DPAs/` folder outside git. Then change "To confirm" to
  "Signed DD/MM/YYYY".
- Produce the clinic-facing "Sub-processors list (PDF)" from this table (security page fill-in
  `security.subProcessorsDocument`).
