# Before the first paying clinic – checklist

**Internal.** Everything to finish before a real, paying clinic is onboarded onto ClinDesk (or ClinForms). Written
01/11/2026 from Khuram's list. Tick an item only when it is done and checked; add the date and who did it.
Billing's own go-live order is in [`billing.md` §7](billing.md#7-go-live-exact-order) – this list sits around it.

## Company and legal

- [x] **Exact company name on both sites.** Companies House: **APPSTACK X LTD**, number **16287309**, registered in
  England and Wales. The sites, legal pages, emails and structured data say "Appstack X Ltd" (`COMPANY.legalName` in
  `src/lib/site.ts`; done 01/11/2026). The trading brand stays "AppStackX" and the domain `appstackx.co.uk`.
- [x] **Registered office on the sites** (Companies (Trading Disclosures) Regulations 2008). Shown as the last, small
  line of both footers: "Registered office: 18 Westergate Avenue, Milton Keynes, MK10 7LQ" (done 01/11/2026). One
  value per site, kept equal by a test: ClinDesk `company.registeredOffice` in `content/clindesk-site.json`, ClinForms
  `COMPANY.registeredAddress` in `src/lib/site.ts`. A **registered-office service address** can replace it later
  (recommended, so a home address is not published) – change both values and Companies House together.
- [x] **ICO registration number shown:** ZC135044 (ClinDesk security page and privacy policy, ClinForms privacy
  policy; done 01/11/2026).
- [ ] **Lawyer review** of the terms, privacy policy and cookie policy on both sites (the open `[to confirm]` points
  in `content/clindesk-site.json`, `legal.*`; docs/clinic-system/CLINDESK-SITE-CONTENT.md).
- [ ] **Fair-use storage allowance** written into the terms (attachments, imports), with what happens above it.
- [ ] **DPA signed** with the clinic **and a DPIA** done before any real patient data (CLAUDE.md hard rule).

## Security and hosting

- [ ] **Cyber Essentials certification.** Until it is held, the security page says "No certifications yet – Cyber
  Essentials planned" – never claim a certification we do not hold. When certified, change
  `security.certifications`.
- [ ] **Vercel Pro** – Hobby is for non-commercial use only.
- [ ] **Supabase: point-in-time recovery (PITR) on, and a compute review** for the expected load. Check the security
  page's backup lines (`security.backupFrequency` "Daily", `security.backupRetention` "7 days") still match the plan.
- [ ] **Move attachments from Postgres to R2** before a large group clinic (file sizes, database size and backups).
- [ ] **Roll the test keys** (every test/demo secret used during the build) before real data arrives.

## Billing and messages

- [ ] **Stripe live smoke test done** (billing.md §7 step 7: a real card on the internal clinic, cancel, refund).
- [ ] **The SMS Works account** opened, with the **sender ID "ClinDesk"** approved (SMS-CREDITS.md §7).

## Onboarding

- [ ] **Onboarding and support scope written down**: what switching help includes (data import, training, go-live
  day), support hours and channels, response times – matching the website's fill-ins (`switching.*`, `support.*`).
