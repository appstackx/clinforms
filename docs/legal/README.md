# docs/legal – ClinForms legal drafts (INTERNAL – do not send this file)

Drafted 24 October 2026 for Blue Heart Clinics' onboarding (3-day trial, then the paid service). **These are drafts for
Khuram to review. They are not legal advice. Have a solicitor review the DPA, the DPIA (with its transfer assessment)
and the trial terms before anything is signed.** Every gap is marked `[TO CONFIRM]`.

| File | What | Send to Blue Heart? |
|---|---|---|
| `blue-heart-dpa.md` | Article 28 data processing agreement, Blue Heart (controller) – AppstackX Ltd (processor), with annexes: processing details, security measures as built, sub-processors, transfers | Yes, after review |
| `blue-heart-dpia.md` | DPIA in the ICO template's structure (Steps 1–7), risks R1–R18 with measures that match what is built and what is planned | Yes – it is Blue Heart's document to complete and sign off |
| `blue-heart-trial-terms.md` | One-page trial terms: 3 days, no charge, made-up or anonymised notes only, what happens to data afterwards | Yes, after review |
| `sub-processors.md` | Sub-processor list (DPA Annex 3), shared by all clinics | Yes |

**Reuse for the next clinic.** Everything specific to Blue Heart sits in the parties, Background C (clinic id), clause 12
(contacts) and Annex 1 of the DPA, and in the DPIA's Steps 2–3. Copy the files, change those parts, keep
`sub-processors.md` as the one shared list. Each clinic is its own account (tenant) in the shared database, with its
own encryption key – the DPA and DPIA say so in plain words.

## Decisions for Khuram before sending

1. **Trial account vs the "DPA first" rule.** CLAUDE.md's hard rule says a clinic is created only after its DPA is
   signed, and the live `/security` page says "Clinics are set up by us after the data processing agreement is signed".
   A 3-day trial account created before the DPA breaks both. **Recommendation:** have Dell sign the DPA and the trial
   terms together, then create `blue-heart`. Signing the DPA does not open the door to real data: trial terms clause 3
   and DPA Annex 2 §K keep real patient information out until the DPIA is signed off and the §K items are done. The
   alternative (trial terms only) needs a recorded decision changing the rule and a wording change on `/security`.
2. **Stricter data rule than the brief.** The brief said "made-up or anonymised notes until the DPA is signed". The
   drafts say "until the DPA is signed **and** both parties confirm in writing that the account is ready" (DPIA signed
   off, London database etc.), matching the hard rule "no real patient data until DPA + DPIA + safeguards". Confirm.
3. **Drafting during the trial.** Drafting from notes is off for a new clinic (D50) and sends notes to the drafting
   provider in the USA. If the trial should show drafting (it is the point of the trial), switch it on for made-up or
   anonymised notes only (trial clause 5) – another reason to have the DPA (which authorises the sub-processor) signed
   first. The same switch controls form reading: with it off, Dell's templates are read by layout rules only (a weaker
   reading, TOP-b P10), so setting up the 19 templates well needs it on – blank templates carry no patient data.
   "Anonymised" by clinic staff is often only pseudonymised; the trial terms push "if in doubt, use a made-up
   patient".
4. **Vercel Hobby is non-commercial.** A customer trial is arguably commercial use. Upgrade to Pro before the trial or
   at the latest before payment (backlog 2.1).
5. **Numbers to fix:** sub-processor notice 30 days (planned ones 14); passing on rights requests 5 working days;
   **breach notice 24 hours** (only promise it if you can meet it while working days elsewhere – consider alerting
   first); audit notice 30 days; deletion 30 days after export; trial deletion 14 days; how long activity-log rows are
   kept after offboarding; Blue Heart's retention period (default 365 days); liability cap; insurance amounts. Note:
   the feasibility report (§3a) says current PI cover is "Software Engineering" only – tech PI + cyber covering hosted
   health data is needed before real data.
6. **Contracting entity.** Blue Heart Clinics Ltd (09158709) files dormant accounts; ask Dell which entity signs and
   pays. Also AppstackX Ltd's company number, registered office, ICO registration (none recorded) and your title.
7. **Drafting provider (Anthropic):** contracting entity; accept its DPA; transfer mechanism (IDTA or UK Addendum; UK
   Extension to the Data Privacy Framework only if certified – check dataprivacyframework.gov); its retention period
   for API inputs/outputs; whether zero-data retention or a UK/EU processing location is available; confirm the "no
   training / no improving its services" statement, which the live privacy page already makes (§5). Also D63: confirm
   only one current key exists.
8. **Other providers' DPAs:** confirm each is accepted (Vercel, Cloudflare, Supabase when used, MailerSend when used,
   PostHog) and fill in the transfer column of `sub-processors.md`.
9. **Before real data (DPA Annex 2 §K, DPIA Step 7):** London database, paid plans, verified first live run of the
   retention cron (go-live G2, still unverified), scheduled encrypted off-site backup + restore test, ICO fee, Cyber
   Essentials, pen-test decision, prognosis-tense (TOP-b P4) and source-label (P7) fixes, breach procedure + alerting.
10. **HCML clause 5.4** (notice before data leaves the UK) is mentioned so Blue Heart can check its referrer contracts;
    keep it unless the solicitor says otherwise.

## What the drafts deliberately do NOT claim

UK-only hosting (the database is in the EU today); any certification; zero-data retention; a verified retention run;
a UK processing location for the drafting provider; a penetration test; that ClinForms sends forms to referrers or
connects to TM3. Customer-facing text follows the neutral-wording rule (no technology or model names); the provider is named (Anthropic) as UK GDPR
requires, and the service is described as "drafting service".

## Sources in the repo (facts used)

`docs/production-architecture.md` (hosting, data layer, tenancy, encryption, routes), `docs/auth.md` (two-step, roles,
sessions, links, offboarding), `docs/database.md` (gateway, encryption details, retention cron, backups, Supabase
switch), `memory/context/compliance.md` (minimisation, built vs not built, disclosure rule), `memory/context/hosting-and-infra.md`
(regions), `src/app/(marketing)/privacy|security|terms` (live public statements, 30-day return window, liability cap),
`src/server/repos/maintenance.ts` (what retention deletes), `src/lib/account-copy.ts` (retention 30–3650 days),
`src/components/analytics/events.ts` (analytics allow-list), `docs/strategy/all-in-one-pms-feasibility.md` §3a and the
addendum (compliance items, HCML 5.4, 400–500 reports/month), `memory/projects/blue-heart-clinics.md` (entity, sites),
`memory/next-steps.md` TOP-b (known product gaps P4, P7).
