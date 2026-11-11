# Cyber Essentials – readiness check (ce02)

**Internal.** AppstackX Ltd (Companies House: APPSTACK X LTD, no. 16287309; ICO ZC135044). Written 11/11/2026 from the
repo docs, the handover notes and a read-only check of Khuram's Mac (`sw_vers`, `fdesetup`, `socketfilterfw`,
`softwareupdate -l`, admin group). Nothing was changed. Owner: Khuram (khuram@appstackx.co.uk).

Status key: **✓** looks met from the repo/docs/the Mac check · **?** Khuram must check on his devices or accounts ·
**✗** gap to fix before applying.

## 1. What is in force on 11/11/2026

| Item | Current position | Source |
|---|---|---|
| Requirements document | **Cyber Essentials: Requirements for IT Infrastructure v3.3** | [IASME April 2026 update][iasme-2026], [NCSC][ncsc-res] |
| Question set | **Danzell** (IASME preparation booklet "Version 16, April 2026") – used for every assessment account created from 27/04/2026. The previous set, **Willow** (v3.2), closed for basic CE on 26/10/2026 (Plus under Willow until 27/01/2027), so a new application today is Danzell only | [Danzell booklet][danzell], [LRQA][lrqa], [Cybersmart guide][cybersmart] |
| The 5 controls | Firewalls · Secure configuration · Security update management · User access control · Malware protection | [NCSC overview][ncsc] |
| Cloud services | **Cannot be excluded from scope.** IaaS, PaaS and SaaS all count, and so do social media accounts. A cloud service = accessed via an account (business email or issued credentials) and stores or processes the organisation's data (A2.9) | [Danzell booklet][danzell] |
| MFA | **Mandatory on every cloud service that offers it, for every user and every admin** (A7.14–A7.17). Answering "no" to A7.16 or A7.17 is an **automatic fail**, and so is listing a service as "no MFA" when it does offer MFA. If a service has no MFA of its own but can use SSO with a provider that has it (Google/Microsoft), that link must be set up. MFA plus a password of at least 8 characters. FIDO2 passkeys count as MFA | [Danzell booklet][danzell], [IASME April 2026 update][iasme-2026] |
| 14-day patching | High-risk/critical updates (vendor "critical"/"high", **CVSS v3 ≥ 7**, or no severity given) to OS, router/firewall firmware **and applications** within **14 days of release**. A6.4 and A6.5 are **automatic fails** if the answer is no. Auto-updates on wherever possible (A6.5.1) | [Danzell booklet][danzell] |
| Unsupported software | All software must be licensed and supported. Unsupported OS/apps must be removed or moved into a sub-set with no internet access. The booklet lists **macOS Ventura, iOS 15 and Android 12** as examples that are no longer supported. Windows 10 is only acceptable with paid ESU | [Danzell booklet][danzell] |
| BYOD | Personally owned devices that access organisational data or services are **in scope** (A2.6/A2.8 cover "corporate and user owned devices"). End-user devices cannot be left out of scope | [Danzell booklet][danzell] |
| Admin accounts | Separate admin accounts are required for admin tasks, **including cloud service administration** (A7.6). Admin accounts must not be used for email or web browsing (A7.7). Admin holders must be tracked and reviewed (A7.8–A7.9) | [Danzell booklet][danzell] |
| Passwords | One of: MFA · 12+ characters · 8+ characters with a deny list. No maximum length, no forced expiry, no complexity rules. Brute-force protection: throttling (≤ 10 guesses in 5 minutes) or lock after 10 attempts | [Danzell booklet][danzell] |
| Backups | v3.3 moves backup guidance to the front of the document. It is guidance, not one of the five marked controls | [IASME April 2026 update][iasme-2026] |
| Free cyber insurance | Opt-in, at no extra cost, with a **whole-organisation** CE certificate when the head office is in the UK (or Crown Dependencies) and gross turnover is **under £20m** (A3.1–A3.3). Cover is **£25,000**. Third-party sources give the excess (about £1,000) and the underwriter differently, so confirm both with the certification body | [Danzell booklet][danzell], [IASME insurance][iasme-ins] |
| Price (micro, 0–9 staff) | **About £80 + VAT with the First Step Fund** (75% off, live since 03/11/2026, until 31/03/2027 or until the £2.4m runs out, first come first served; for organisations with < 250 staff and no CE certificate in the last 4 years – we qualify; apply at firststep.iasme.co.uk BEFORE buying, basic CE only, not Plus – [GOV.UK][gov-fund]). Full list price **£320 + VAT** (£384 incl. VAT). Small 10–49: £440; medium 50–249: £500; large 250+: £600 (+ VAT). One-off per year; the certificate lasts 12 months | [IASME][iasme-ce], [NCSC overview][ncsc], [G-Cloud 15 price doc (Jan 2026)][gcloud] |
| Cyber Essentials **Plus** | Same five controls, plus a **hands-on technical audit** by an assessor: external vulnerability scan, sampled devices tested (patches, malware, MFA on cloud services, …). It must be done **within 3 months of the basic CE certificate**. Under Danzell, a Plus test that fails on missing patches means the assessor tests an **extra sample** of devices, and the self-assessment must be final and unchanged before testing starts. Price: quoted by the certification body on size and complexity. Third-party guides put a micro firm at about **£1,500+ VAT** (estimate) | [IASME Plus][iasme-plus], [LRQA][lrqa], [NCSC overview][ncsc] |

Your answers must be approved by a board-level person (Khuram, as director). The certificate names **one legal entity**,
which must match Companies House exactly: **APPSTACK X LTD**, 16287309. Trading names (AppstackX, ClinDesk, ClinForms)
can be added as "trading as".

## 2. Our scope (as the assessor will see it)

- **Organisation:** whole organisation (needed for the insurance). There is one person, a home worker, and no office
  network. The home router is not in scope; we rely on the Mac's software firewall (A2.5 notes).
- **End-user devices:** the Mac (MacBook, **macOS Sequoia 15.6.1**, checked 11/11/2026), Khuram's iPhone (? model/iOS),
  and any iPad or other computer that opens AppstackX email or consoles (?). **Do not use the Bank of America work
  laptop for AppstackX.** If it touches AppstackX accounts it falls into scope, and we can't answer for it.
- **Servers:** none we run. Everything is PaaS/SaaS.
- **Cloud services (A2.9, all in scope):** Vercel (app hosting), Supabase (database, file storage), Cloudflare (DNS,
  registrar for clinforms.co.uk and clindesk.co.uk, D1 frozen fallback, Workers, R2 media, Turnstile), GitHub (code),
  Google Workspace (mail on appstackx.co.uk, clindesk.co.uk and clinforms.co.uk – MX = Google), MailerSend (email
  sending), PostHog EU (statistics), Stripe (all product accounts), the drafting provider's console (Anthropic),
  Hostinger/Axidomains (registrar and DNS for appstackx.co.uk), Apple ID/iCloud (key-backup image, Apple Passwords),
  Google Ads, ElevenLabs, Slack, LinkedIn and other social accounts, The SMS Works (once opened), Companies House and
  HMRC online accounts, and any accounting or banking SaaS (?).

## 3. Checklist by control

### 3.1 Firewalls
| Requirement | What applies to us | Status | Fix |
|---|---|---|---|
| Firewall on every in-scope device (A4.1, A4.1.1) | Mac software firewall; no boundary firewall of our own | ✓ macOS firewall **on** (State = 1) | Optional: turn on stealth mode (it is off) |
| Default firewall/admin passwords changed (A4.2–A4.3) | The Mac's account password protects the software firewall | ? | Confirm the Mac password is 12+ characters, or rely on Touch ID + password |
| Unauthenticated inbound connections blocked (A4.7) | No inbound services on the Mac | ? | System Settings → General → Sharing: everything off that isn't needed (Screen/File Sharing, Remote Login, AirPlay Receiver) |
| Inbound rules documented and reviewed every 12 months (A4.5–A4.8) | None on the Mac. Cloud ingress = Vercel/Cloudflare public HTTPS only; the gateway Worker needs an HMAC signature | ✓ | Note "no inbound rules; reviewed 11/11/2026" in the access-control policy review |
| Firewall admin not reachable from the internet (A4.9–A4.11) | n/a (no boundary device) | ✓ | – |

### 3.2 Secure configuration
| Requirement | What applies to us | Status | Fix |
|---|---|---|---|
| Unused software and services removed, on devices **and cloud services** (A5.1) | Mac and iPhone apps; old Vercel projects, Workers, D1 databases, API keys, Stripe test accounts | ? | Remove unused apps. In the cloud consoles, delete stale projects and tokens (e.g. revoke every older drafting-provider API key – open item in `memory/context/compliance.md` §7). D1 `clinforms-prod` is deleted after ~29/11 |
| Only necessary accounts (A5.2) | The Mac has **two admin accounts** (`khuram`, `appstackx`); cloud consoles have one human each | ? | Decide whether the `appstackx` macOS account is needed; remove it if not |
| Default/guessable passwords changed (A5.3) | Mac, iPhone, every console | ? | Password manager (Apple Passwords) with unique generated passwords |
| External service we provide authenticates users (A5.4–A5.7) | ClinForms/ClinDesk sign-in: invite-only, **TOTP two-step required**, password **min 12**, rate limits in the database (`docs/auth.md`, architecture §3). Patient portal: one-time email link (passwordless, option D) | ✓ | Answer A5.5 = A (MFA). A5.7 = throttling (rate limits). Note that bespoke web-app code is out of CE scope under v3.3 |
| Compromised-password process (A5.6, A7.13) | Rotation steps exist for app secrets (`docs/database.md` §5, go-live §7) | ✓ (written) | Covered by `policies/incident-response.md` + `access-control.md` |
| Auto-run off (A5.8) | macOS asks before opening downloaded apps (Gatekeeper on: "assessments enabled") | ✓ | – |
| Device locking (A5.9–A5.10) | Mac password/Touch ID; iPhone passcode (6+ digits) / Face ID | ? | Mac: lock after ≤ 5 min idle, password at wake. iPhone: 6-digit or longer passcode, "Erase data after 10 attempts" optional |

### 3.3 Security update management
| Requirement | What applies to us | Status | Fix |
|---|---|---|---|
| Supported OS on every device (A6.1) | macOS 15 Sequoia is still supported. iPhone/iPad iOS version ? | ✓ Mac / ? phone | iPhone on the current iOS (or the previous major version still getting fixes) |
| High/critical OS updates within 14 days – **auto-fail** (A6.4) | The Mac runs **15.6.1** while **macOS Sequoia 15.8.3** and **Safari 27.2** are pending (`softwareupdate -l`, 11/11/2026) | **✗** | Install 15.8.3 + Safari now (or move to macOS 27.2.1). Keep "Install Security Responses and system files" and "Install macOS updates" on (they are on), and **restart when prompted**: pending updates are the gap |
| High/critical app updates within 14 days – **auto-fail** (A6.5) | Chrome 157 (auto-updates), Docker Desktop, Node, VS Code, Homebrew packages, Office/Google apps, iPhone apps | ? | Auto-update everywhere. Run `brew upgrade` weekly. Restart Chrome when it says an update is ready |
| Auto-updates on (A6.5.1) | macOS: automatic check, download, macOS updates, critical updates – all on | ✓ (macOS) / ? (apps) | App Store → auto-update on. iPhone → Automatic Updates on |
| All software licensed and supported (A6.2, A6.3) | Lists of browsers, anti-malware, email and office apps **with versions** are needed (A6.2.1–A6.2.4) | ? | Write the list at application time (Chrome 157, Safari, XProtect, Gmail web, Google Docs …) |
| Unsupported software removed (A6.6–A6.7) | Old Homebrew casks, old Node versions, abandoned apps | ? | `brew outdated`, remove anything end-of-life |
| Cloud PaaS patching | Vercel, Cloudflare and Supabase patch their platforms. Supabase Postgres **minor/major upgrades** are shown in the dashboard for us to run | ? | Check Supabase → Settings → Infrastructure monthly; apply security upgrades within 14 days |
| App dependencies (good practice; bespoke app code is out of CE scope) | npm dependencies pinned. The repo rule says "published ≥ 14 days". **No CI, no Dependabot/audit** in the repo | ✗ (good practice) | Monthly `npm audit --omit=dev` + update. Allow a security fix in before 14 days (see `policies/secure-development.md`) |

### 3.4 User access control
| Requirement | What applies to us | Status | Fix |
|---|---|---|---|
| Account approval process (A7.1, A7.5) | One person. Clinic accounts: invite-only, created by the platform after the DPA | ✓ | `policies/access-control.md` |
| Unique credentials, no shared accounts (A7.2) | One login per person per service | ? | Confirm no shared logins (e.g. a shared Stripe or Google login) |
| Leavers removed (A7.3) | No staff. Process written for contractors | ✓ | `policies/access-control.md` |
| Least privilege (A7.4) | Scoped tokens: Vercel/Cloudflare API tokens, MailerSend key, Supabase service role (server only) | ? | Review token scopes. Delete account-wide tokens that are no longer used |
| **Separate admin account on devices** (A7.6–A7.7) | Daily macOS user **`khuram` is an admin** (and so is `appstackx`) | **✗** | Create a separate admin account (e.g. `admin-khuram`), then make `khuram` a Standard user. Install software by entering the admin credentials only when prompted. Never browse or read email as the admin |
| **Separate admin accounts on cloud services** (A7.6) | Each console is used with one owner account that also does daily work. Google Workspace: daily mailbox = super admin? | ✗/? | **Google Workspace:** a separate super-admin account (e.g. `admin@appstackx.co.uk`) with MFA/passkey, and a non-admin daily mailbox. For consoles with one owner login (Vercel, Supabase, Cloudflare, Stripe, GitHub), ask the certification body what it accepts for a sole director. Usual answer: a dedicated admin identity used only for administration (no email or browsing in that profile), e.g. a separate Chrome profile signed in only to admin consoles. Record the decision |
| Admin holders tracked and reviewed (A7.8–A7.9) | One person | ✓ (once written) | Admin register table in `policies/access-control.md`; review quarterly |
| Password quality + brute force (A7.10–A7.12) | Password manager (Apple Passwords, per CLAUDE.md), MFA | ? | Answer: MFA + password manager + three-random-words guidance; no expiry, no complexity rules |
| **MFA on every cloud service – auto-fail** (A7.14–A7.17) | All services in §2. **PITR, plan and MFA state are not visible from the repo** | **?** | Khuram's to-do in §4. Every service = MFA on (authenticator app or passkey, not SMS where possible) |

### 3.5 Malware protection
| Requirement | What applies to us | Status | Fix |
|---|---|---|---|
| Anti-malware or allow-listing on every device (A8.1) | Mac: built-in XProtect/Gatekeeper (option A; many CBs accept it, but some ask for a named product). iPhone: App Store only (option B) | ? | Ask the CB whether XProtect is enough. If not, install a supported product (e.g. a current commercial Mac anti-malware app) |
| Anti-malware updates itself + blocks malicious sites (A8.2–A8.3) | XProtect updates via "Security Responses" (on). Safari/Chrome Safe Browsing | ? | Chrome → Settings → Privacy → Safe Browsing = Standard or Enhanced |
| App store + approved app list (A8.4–A8.5) | iPhone apps from the App Store only; jailbreak not allowed | ? | Write a short approved-apps list (in `policies/acceptable-use.md` annex or a note) |

### 3.6 Outside the five controls but asked about, or worth fixing first
| Item | Status | Fix |
|---|---|---|
| Disk encryption (Mac) | ✓ FileVault **on** | iPhone: encrypted when a passcode is set |
| Supabase **PITR** | ✗ **off** (START-HERE.md, BEFORE-FIRST-CLIENT.md) | Turn on before real clinic data (about $100/month add-on) |
| Scheduled off-site logical backups | ✗ one manual dump only (`~/Projects/Appstackx/backups/supabase-prod-before-healthcode-20261102.dump`, 02/11) | Weekly dump + restore test (`policies/backups-and-recovery.md`) |
| Vercel plan | ✗ Hobby (non-commercial use only) | Vercel Pro before a paying clinic |
| Vercel/other consoles on a personal email | ? Vercel team `khuram99gmailcoms-projects` suggests a personal Gmail login | Move owner logins to `@appstackx.co.uk` addresses, or count that Gmail account as an in-scope cloud account with MFA |
| NCSC Early Warning (A1.16) | ? | Sign up (free) for the company domains |

## 4. Khuram's to-do (device and account checks)

1. **Mac:** install macOS **15.8.3** and Safari 27.2 now (14-day rule). Then confirm under System Settings → General →
   Software Update → Automatic updates that every switch is on.
2. **Mac:** create a separate admin account and make `khuram` a Standard user. Decide on the `appstackx` user (remove,
   or make it Standard).
3. **Mac:** screen lock ≤ 5 min with password at wake; Sharing services off; firewall stealth mode on (optional);
   FileVault recovery key stored in Apple Passwords (FileVault is already on).
4. **iPhone (and any iPad):** write down model + iOS version; current iOS; 6+ digit passcode + Face ID; automatic
   updates on; App Store apps only.
5. **Password manager:** Apple Passwords for every account; unique generated passwords; no reuse.
6. **MFA on EVERY cloud admin account** (authenticator app or passkey; tick when done):
   - [ ] Vercel  - [ ] Supabase (and the org's other members)  - [ ] Cloudflare (both accounts)  - [ ] GitHub
   - [ ] Stripe (each product account)  - [ ] Google Workspace (enforce 2-Step Verification for **all** users in Admin
     console → Security)  - [ ] MailerSend  - [ ] PostHog  - [ ] Hostinger/Axidomains (appstackx.co.uk registrar)
   - [ ] drafting provider console  - [ ] Apple ID  - [ ] Google Ads  - [ ] ElevenLabs  - [ ] Slack  - [ ] LinkedIn/
     social  - [ ] Companies House / HMRC / bank (where offered)  - [ ] any personal Gmail used as a login
7. **Separate admin identity** for Google Workspace (a super-admin account that is not the daily mailbox). Ask the CB
   about sole-director cloud consoles.
8. **Confirm the scope list** in §2 (anything missing, e.g. accounting software, bank, other SaaS).
9. **Do not** use the Bank of America work laptop for AppstackX, and keep the two separate.

## 5. Steps to certify

1. **Fix the ✗ items and the to-do above** (estimate: 1–2 evenings, plus waiting for macOS to install). Re-run the
   checks: `sw_vers`, `softwareupdate -l` (nothing "Recommended" outstanding), `fdesetup status`,
   `dscl . -read /Groups/admin GroupMembership` (the daily user must not be listed).
2. **Apply for the First Step Fund first** (firststep.iasme.co.uk, 75% off: about £80 + VAT instead of £320 + VAT),
   then **choose a certification body.** Any IASME-licensed CB (finder on [iasme.co.uk][iasme-ce]). The list price is the same everywhere
   (£320 + VAT for micro). Choose one that also does Plus and answers questions quickly. A local one is handy if we do
   Plus on site. Optional: a session with an NCSC-assured **Cyber Advisor** (A1.12) if a question is unclear.
3. **Read** the Requirements for IT Infrastructure v3.3 (A1.11 asks) and fill in the **Danzell** booklet offline
   first (notes per question). Then enter the answers on the IASME portal. Name = APPSTACK X LTD, 16287309;
   whole-organisation scope; opt **in** to the insurance (A3.1–A3.3, contact khuram@appstackx.co.uk).
4. **Director sign-off**, submit, and pay (about **£80 + VAT** with the fund; £320 + VAT without).
5. **Marking:** usually a few working days. If the assessor raises points, fix them and answer within the window the
   CB gives. The account must be completed within **6 months** of creation.
6. **On pass:** certificate valid **12 months** (renew by about **11/2027**). Change `security.certifications` in
   `content/clindesk-site.json` (and the ClinForms trust page) to "Cyber Essentials certified" only once the
   certificate is issued. Never before.
7. **Plus (optional, later):** book within **3 months** of the CE certificate; budget about £1,500+ VAT (estimate);
   expect a remote scan and testing of the Mac and iPhone.

**Timeline (estimate):** fixes this week → submit by about 20/11/2026 → certificate by about the end of November
2026, if nothing fails.

## Sources
[iasme-2026]: https://iasme.co.uk/articles/upcoming-changes-to-the-cyber-essentials-scheme-april-2026/
[danzell]: https://www.ukcybersecurity.co.uk/wp-content/uploads/CE-2026_Danzell-Question-Set.pdf
[lrqa]: https://www.lrqa.com/en-gb/latest-news/cyber-essentials-changes-danzell-question-set-released/
[cybersmart]: https://cybersmart.co.uk/wp-content/uploads/2026/03/Danzell-Question-Set-Guide.pdf
[ncsc]: https://www.ncsc.gov.uk/cyberessentials/overview
[ncsc-res]: https://www.ncsc.gov.uk/cyberessentials/resources
[iasme-ce]: https://iasme.co.uk/cyber-essentials/
[iasme-ins]: https://iasme.co.uk/cyber-essentials/cyber-liability-insurance
[gov-fund]: https://www.gov.uk/government/publications/cyber-essentials-funding-package/cyber-essentials-funding-package
[iasme-plus]: https://www.iasme.co.uk/cyberessentials/cyber-essentials-plus/
[gcloud]: https://assets.applytosupply.digitalmarketplace.service.gov.uk/g-cloud-15/documents/720344/785037226262462-pricing-document-2026-01-30-1039.pdf

- IASME, "Upcoming changes to the Cyber Essentials scheme: April 2026" – <https://iasme.co.uk/articles/upcoming-changes-to-the-cyber-essentials-scheme-april-2026/>
- IASME Danzell self-assessment preparation booklet, Version 16, April 2026 (copy hosted by a CB) – <https://www.ukcybersecurity.co.uk/wp-content/uploads/CE-2026_Danzell-Question-Set.pdf>
- LRQA, Danzell question set released – <https://www.lrqa.com/en-gb/latest-news/cyber-essentials-changes-danzell-question-set-released/>
- Cybersmart, Danzell question set guide – <https://cybersmart.co.uk/wp-content/uploads/2026/03/Danzell-Question-Set-Guide.pdf>
- NCSC, Cyber Essentials overview (5 controls, "from £320 + VAT") – <https://www.ncsc.gov.uk/cyberessentials/overview>
- IASME, Cyber Essentials (price bands) – <https://iasme.co.uk/cyber-essentials/>; G-Cloud 15 pricing document (Jan 2026) – <https://assets.applytosupply.digitalmarketplace.service.gov.uk/g-cloud-15/documents/720344/785037226262462-pricing-document-2026-01-30-1039.pdf>
- IASME, Cyber liability insurance – <https://iasme.co.uk/cyber-essentials/cyber-liability-insurance>
- IASME, Cyber Essentials Plus (3-month window) – <https://www.iasme.co.uk/cyberessentials/cyber-essentials-plus/>

*Not verified directly: the IASME FAQ and price pages returned HTTP 403 to automated fetches. Prices and the insurance
terms come from IASME pages as quoted in search results, from the NCSC overview and from the G-Cloud document. Check
the price on the CB's checkout.*
