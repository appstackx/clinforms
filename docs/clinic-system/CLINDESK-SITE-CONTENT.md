# ClinDesk website – the fill-ins (content/clindesk-site.json)

**Internal.** ClinDesk's public website (clindesk.co.uk, built in `src/app/clindesk-site`) never invents a price, a
term or a claim. Every value Khuram must confirm – prices, plans, hosting region, certifications, contract and support
details, timelines, company number, registered office, response times, the legal pages' open points – comes from ONE
file:

    content/clindesk-site.json

It is read when the site is built (the pages are static) and validated with zod (`src/lib/clindesk/content.ts`).
**57 keys.**

## How to edit it

1. Open `content/clindesk-site.json`. Each key has a `value` and a `description` (what it is and where it shows).
2. Change only `value`. Write it as it should read in its sentence (the description says what comes before it), e.g.
   `"value": "£35"` for `pricing.essentialsPrice`, `"value": "one working day"` for `contact.responseTime`.
3. Leave a value **in [square brackets]** while it is not known. It stays visible on the page:
   - `next dev`, Vercel previews (and any build with `CLINDESK_SITE_DRAFT=1`): the placeholder as written, e.g.
     "[£X]", in the design's placeholder colour;
   - production: the neutral marker **"[to confirm]"**.

   The element carries `data-to-confirm="<key>"`, so a check of a page finds every gap.
4. A filled value must not contain `[` or `]` (half-filled values are refused), nor `<` or `>`, and may not be empty.
5. Run `npm run test:site` (or `npm run build`). A bad file – unknown key, missing key, empty value, a value only
   partly in brackets, an extra field – **fails the build** and names the key.
6. Commit on a branch and merge into `feat/clinic-system` as usual (the site ships with the clinic system).

Adding a fill-in: add the key to `CLINDESK_CONTENT_KEYS` in `src/lib/clindesk/content.ts` and to the JSON (value in
brackets + description), use `<Fill k="…" />` on the page and add a row below. `src/lib/clindesk/content.test.ts`
fails until the key list, the JSON, the pages and this document agree.

Not in this file, on purpose:
- the contact email (`COMPANY.contactEmail` in `src/lib/site.ts`: khuram@appstackx.co.uk);
- the free-trial link: the design keeps a "TrialLink" slot only for when a free trial is confirmed (pricing plans and
  the closing call to action) – add it in `src/components/clindesk/cta-band.tsx` / the pricing page then;
- the legal pages' text itself: ClinDesk has its own privacy policy, terms and cookie policy
  (`src/app/clindesk-site/{privacy,terms,cookies}`, adapted from ClinForms' – whose pages stay unchanged – and dated
  `CLINDESK_LEGAL_LAST_UPDATED` in `src/lib/clindesk/site.ts`). Only their open points are fill-ins here (the `legal.*`
  keys, plus company, security, pricing and support keys they reuse). Have a lawyer review them before go-live.

## Every key

### Company

| Key | Placeholder (current value) | What it is and where it shows |
|---|---|---|
| `company.number` | [Company number] | Companies House number of AppstackX Ltd, e.g. 12345678. Footer of every page. Also the privacy policy and the terms ("company number …"). |
| `company.registeredOffice` | [Registered address] | Registered office address on one line, e.g. "1 High Street, Town, AB1 2CD". Footer of every page. Also the privacy policy and the terms ("registered office …"). |

### Contact

| Key | Placeholder (current value) | What it is and where it shows |
|---|---|---|
| `contact.responseTime` | [response time] | How fast you reply to an email or a demo request, e.g. "one working day". Book a demo page and its thank-you page ("we'll reply within …"). |

### Pricing

| Key | Placeholder (current value) | What it is and where it shows |
|---|---|---|
| `pricing.fromPrice` | [£X a month, ex VAT – price and unit to confirm] | Lowest price line in the closing call to action ("From … · Reports is an add-on"), e.g. "£35 per practitioner a month, ex VAT". Home, Features, Reports and Switching pages. |
| `pricing.vat` | [exclude / include] | Whether prices include VAT: "exclude" or "include" (reads "Prices … VAT"). Pricing page, top and the VAT question. Also the terms ("fees … VAT"). |
| `pricing.trialSummary` | [length and terms] | Free trial in a few words after "Free trial:", e.g. "14 days, no card" – or "none". Pricing page, top. |
| `pricing.essentialsPrice` | [£X] | Price of the Essentials plan per practitioner a month, e.g. "£35". Pricing page, Essentials card. |
| `pricing.completePrice` | [£X] | Price of the Complete plan per practitioner a month, e.g. "£49". Pricing page, Complete card. |
| `pricing.groupPlan` | [Plan names and what each includes – to confirm] | Line under the plan cards: the plan names and what each includes (or a note that they are final). Pricing page. |
| `pricing.switchingFeeSummary` | [Any switching fee] | Short note on any switching fee in the "With every plan" list, e.g. "Included" or "£X one-off per site". Pricing page. |
| `pricing.contractLength` | [Contract length, e.g. monthly rolling or 12 months] | Contract length ("How long is the contract?"), e.g. "Monthly rolling". Pricing page FAQ. |
| `pricing.noticePeriod` | [Notice period] | Notice period, written as a sentence fragment after the contract length, e.g. "30 days' notice to leave". Pricing page FAQ. |
| `pricing.dataExport` | [How export works: formats, timescale and any cost] | How a clinic exports its data when it leaves: formats, timescale and any cost. Pricing page FAQ. Also the terms, after "How the data is returned:". |
| `pricing.switchingFee` | [Switching fee, if any] | Switching fee, if any ("Will you help us switch?" answer). Pricing page FAQ. |
| `pricing.trialTerms` | [Trial length and terms] | Free trial answer ("Is there a free trial?"), e.g. "Yes – 14 days on your own data, no card needed". Pricing page FAQ. |

### Reports add-on

| Key | Placeholder (current value) | What it is and where it shows |
|---|---|---|
| `reports.price` | [£X a month for up to N reports] | Price of the Reports add-on, e.g. "£40 a month for up to 20 reports". Home, Features, Pricing and Reports pages. |
| `reports.aboveAllowance` | [What happens above N reports] | What happens above the included number of reports, e.g. "Each extra report is £2". Pricing page FAQ. |
| `reports.supportedForms` | [List of supported forms – to come] | Which referrer forms are supported today (or a short summary). Reports page, "Forms you're sent". |
| `reports.newFormProcess` | [process and turnaround – to confirm] | How a new referrer's form is added and how long it takes, after "Adding a new referrer's form:". Reports page. |

### Support

| Key | Placeholder (current value) | What it is and where it shows |
|---|---|---|
| `support.summary` | [Support hours and channels] | Support in a few words, e.g. "Mon–Fri 08:00–18:00, by email and phone". Features and Pricing pages ("Support"). |
| `support.hours` | [Support hours, e.g. Monday to Friday, 08:00–18:00] | Support hours ("When can we get support?"). Pricing page FAQ. Also the terms, in brackets after the support channels. |
| `support.channels` | [email, phone or in-app] | How to reach support, after "by", e.g. "email and phone". Pricing page FAQ. Also the terms ("Support is by …"). |

### Hosting

| Key | Placeholder (current value) | What it is and where it shows |
|---|---|---|
| `hosting.summary` | [UK data hosting – region to confirm] | Where patient data is hosted, in a few words, e.g. "UK (London)". Home page security band and the Security page top. |

### Features

| Key | Placeholder (current value) | What it is and where it shows |
|---|---|---|
| `features.reminderChannels` | [SMS and email] | Channels appointment reminders are sent by, after "Appointment reminders by", e.g. "text message and email". Features page. |

### Switching

| Key | Placeholder (current value) | What it is and where it shows |
|---|---|---|
| `switching.typicalMove` | [X–Y weeks, depending on sites and data] | Typical length of a move, e.g. "6–8 weeks, depending on sites and data". Home page, "Moving day". |
| `switching.timelineNote` | [Timeline to confirm – varies with sites and data] | Note above the typical timeline, e.g. "A typical single-site move – groups take longer". Switching page. |
| `switching.whenDiscovery` | [Week 1] | When the discovery and plan step happens, e.g. "Week 1". Switching page timeline. |
| `switching.whenTrialImport` | [Weeks 2–3] | When the export and trial import happens, e.g. "Weeks 2–3". Switching page timeline. |
| `switching.whenTraining` | [Week 4] | When training happens, e.g. "Week 4". Switching page timeline. |
| `switching.whenGoLive` | [Week 5] | When the final import and go-live happen, e.g. "Week 5". Switching page timeline. |
| `switching.whenSettlingIn` | [Weeks 6–8] | When the settling-in period is, e.g. "Weeks 6–8". Switching page timeline. |
| `switching.whatMoves` | [Confirm the list for each current system] | Note under "What comes across": what can move depends on the current system – confirm the list. Switching page. |
| `switching.oldSystemAccess` | [read-only, for X weeks] | How the clinic keeps its old system during settling in, e.g. "read-only, for 4 weeks". Switching page, go-live day. |
| `switching.trainingFormat` | [live online, on site or both] | How training is given, after "Format:", e.g. "live online". Switching page, go-live day. |

### Security and data

| Key | Placeholder (current value) | What it is and where it shows |
|---|---|---|
| `security.region` | [UK region] | The hosting region, e.g. "the UK (London)" – used for the data and the backups ("stored in …"). Security page. Also the privacy policy (sub-processors and "clinic data is stored in …"). |
| `security.hostingDetails` | [Hosting details] | One line on the hosting provider and set-up, e.g. "Hosted on … in London". Security page, Hosting. |
| `security.icoRegistration` | [UK GDPR / ICO registration – to confirm] | ICO registration line, e.g. "Registered with the ICO, number ZA123456". Security page top. Also the privacy policy, after "ICO registration:". |
| `security.certifications` | [Certifications – to confirm] | Certifications held, e.g. "Cyber Essentials" – or say none yet. Never claim one you do not hold. Security page top. |
| `security.encryptionInTransit` | [standard] | Encryption in transit, after "In transit:", e.g. "TLS 1.2 or later". Security page. |
| `security.encryptionAtRest` | [standard] | Encryption at rest, after "At rest:", e.g. "AES-256". Security page. |
| `security.backupFrequency` | [Backup frequency] | How often backups are made, e.g. "Daily" (starts the sentence). Security page, Backups. |
| `security.backupRetention` | [period] | How long backups are kept, after "kept for", e.g. "7 days". Security page, Backups. Also the privacy policy ("Backups are kept for …"). |
| `security.retentionGuidance` | [professional and legal guidance] | Which guidance record retention follows, e.g. "HCPC and Records Management Code guidance". Security page, Retention. Also the privacy policy, Retention. |
| `security.deletionProcess` | [Deletion process] | One sentence on how records are deleted at the end of the retention period or when a clinic leaves. Security page, Retention. |
| `security.auditRetention` | [audit retention period] | How long the audit trail is kept, after "Kept for", e.g. "8 years". Security page, Audit trail. Also the privacy policy ("kept for …"). |
| `security.overviewDocument` | [Security overview] | Title of the security overview document you send on request, e.g. "Security overview (PDF)". Security page, Documents. |
| `security.subProcessorsDocument` | [List of sub-processors] | Title of the sub-processor list you send on request, e.g. "Sub-processors (PDF)". Security page, Documents. Also the privacy policy, sub-processors. |
| `security.issueResponseTime` | [timeframe] | How fast you respond to a reported security issue, after "we'll respond within", e.g. "one working day". Security page. |

### Book a demo

| Key | Placeholder (current value) | What it is and where it shows |
|---|---|---|
| `demo.callLength` | [length, e.g. 30–45 minutes] | Length of the demo call, after "Online,", e.g. "30–45 minutes". Book a demo page, "What to expect". |

### Legal pages (privacy, terms, cookies)

For Khuram and a lawyer: none of these may be guessed. Until filled in, the pages show "[to confirm]".

| Key | Placeholder (current value) | What it is and where it shows |
|---|---|---|
| `legal.termsEffectiveFrom` | [Date these terms take effect] | The date the terms take effect, after "These terms apply from", e.g. "1 December 2026". Terms page, top. |
| `legal.accountRetention` | [How long a clinic user's account data is kept after the clinic's account closes] | How long clinic user accounts (name, email, sign-in records) are kept after a clinic's account closes, e.g. "deleted within 90 days". Privacy page, table of data we control. |
| `legal.demoRequestRetention` | [How long demo requests are kept] | How long "Book a demo" requests are kept, e.g. "Up to 24 months after our last contact, unless your clinic becomes a customer". Privacy page, table of data we control. |
| `legal.providerLocations` | [Where the messaging, card payment and human-check services process data, and the safeguards] | Where the patient messaging, card payment and human-check services (all only where switched on) process data, and the transfer safeguards. Privacy page, "Where data is stored". |
| `legal.humanCheckStorage` | [What the human check stores in the browser, if anything] | What the human check on the booking page and portal sign-in (only where switched on) stores in the browser, if anything, and for how long. Cookie page. |
| `legal.medicalDeviceStatus` | [Medical device status – to confirm with a lawyer] | One sentence on whether the clinic system is a medical device, checked by a lawyer, e.g. "It is not a medical device." Terms page, clinical responsibility. |
| `legal.liabilityCap` | [Liability limit – to confirm with a lawyer] | Each party's total liability in any 12-month period, after "is limited to", e.g. "the fees paid and payable by the clinic in the 12 months before the claim". Terms page, liability. |
| `legal.paymentProviderTerms` | [How the card payment provider's own terms apply – to confirm] | One sentence on whether the card payment provider's own terms also apply to a clinic that switches on card payments. Terms page, fees and payments. |
