# All-in-one practice system to replace TM3: feasibility

**Internal – not for customers.** Fri 23 Oct 2026, written after the Blue Heart demo (11:30 BST). For Khuram.

**The question.** On the call, Dell Baines (owner, Blue Heart Clinics: 11 sites, uses TM3) raised a bigger opportunity. He wants one product that does everything TM3 does, plus ClinForms, so Blue Heart can replace TM3. Khuram asked: **is it doable?**

**How to read this:**
- Tags: **[C]** confirmed (source given), **[I]** inference or estimate, **[U]** unknown.
- "Est." means our estimate.
- Prices are ex VAT unless stated.
- Built from five research notes (TM3, market, compliance, build, business) made on 23 Oct 2026 from public sources and this repo.
- Nobody was contacted and nothing was signed up for.
- This is not legal advice. Contracts need a solicitor.

---

## 1. The answer in one paragraph

**Technically, yes.** A physio practice system needs no new technology, and ClinForms already gives a head start on sign-in, encryption, audit, documents and the report engine [I]. **For AppstackX as it is today, no – not as a TM3 replacement.** On evenings and weekends, est. 20–40 months to an MVP one site could pilot, and est. 4–9 years to switch all of Blue Heart off TM3 [I]. Nobody would answer a diary outage at 09:15 on a Tuesday while Khuram is at BofA [C memory, I]. Healthcode insurer billing, a one-shot TM3 data exit and a compliance pack must all be ready before any site switches [C/I]. And the money is small. The all-in-one at Blue Heart is worth est. £600–1,200 a month [I]; a small team costs est. £220–330k a year [I]. **It becomes doable only if four things are true:**
1. Dell pays for ClinForms first and puts money behind the next stage.
2. At least two or three other multi-site clinics want the same, and pay.
3. A funded person (or a small team) covers support in clinic hours.
4. Healthcode, compliance and migration are solved before any site moves.

**So: yes to the direction, no to a TM3 rebuild now.** Grow out from ClinForms in this order, building each step only once it is paid for:
1. reports;
2. the funded-work admin around the reports;
3. the diary;
4. billing.

---

## 2. What "replace TM3" really means

TM3 is a full UK practice-management suite, not just a diary. It publishes about 25 modules [C, tm3app.com]. Its maker, Blue Zinc IT (Belfast), dates from 2002. The PE-backed ClearCourse group has owned it since Sep 2022 [C, Irish News; BusinessCloud]. The TM3 FAQ says it has served UK clinicians "for over 20 years" [C]. We scored 43 feature rows. 24 of them are must-haves for an 11-site physio group like Blue Heart [I].

**Four facts that shape everything:**
- **TM3 does not do the ClinForms part.** Its letter merge fields pull demographics and case-summary fields only, such as diagnosis, referral reason, pain scales and outcome. No field brings in consultation or assessment content [C, TM3 "Full List of Merge Fields"]. That is why Blue Heart's physios type the clinical part by hand.
- **Blue Heart's RTF templates look like TM3 Desktop letters.** TM3 Web uses an in-app editor and documents no RTF upload [C, TM3 help]. Blue Heart may therefore still run Desktop, or a mix of Desktop and Web [I]. Ask Dell, because it changes migration.
- **What Blue Heart probably pays TM3 today.** List prices are **£39 / £55 / £70 per user per month**, plus **"Connect for Insurance" at £10 per licence** [C, tm3app.com/pricing, 23 Oct]. For 8–17 users that is est. **£430–1,450 a month, central ~£900** (about £5–17k a year, central ~£11k) including SMS [I]. Physio treatment is VAT-exempt, so Blue Heart probably can't reclaim VAT and pays ×1.2 [I].
- **The contract decides the timing.** TM3's standard terms [C, TM3 UK MSA v5.3, Nov 2025]:
  - **90 days' written notice** before the end of a term (cl. 8.1).
  - Renewal terms of **up to one year** (cl. 1.19).
  - Fees rise **5% a year, or up to 8% indexed** (cl. 6.7).
  - Data is "made available for migration", then may be **erased after 90 days** (cl. 9.2(d)).
  - The client may not use TM3 "to build a product or service which competes" (cl. 3.2(b)).

### Module table

"Needed to switch" means needed on day one for Blue Heart to leave TM3 [I]. Effort is in solo dev-weeks: **MVP + extra for parity** [I]. A dev-week is 40 hours of Khuram's attention, with agents doing most of the typing. The figures already assume agents make him 2–3× faster overall [I].

| Module | TM3 has | Needed to switch? | We have today | Effort (dev-weeks) |
|---|---|---|---|---|
| Multi-site diary: sites, rooms, practitioner rotas, recurring bookings, DNA/late-cancel fees, no double booking | Yes [C] | **Yes** | Nothing usable. ClinForms has an appointment schema. hospital-system has appointment *requests* only; its slot engine is "Phase 2" [C repo] | 6–9 + 6–9 |
| Online booking + patient portal (TM3 Connect) | Yes [C] | Later. Blue Heart's website takes bookings by phone or contact form only [C, blueheartclinics.co.uk, 23 Oct] | Patterns only (hospital-system booking and portal, careconnect-mk screens) [C repo] | Booking 2–3 + 2–4; portal 0.5–1 + 3–5 |
| Patient record: demographics, GP, consent, insurer/MLC accounts, treatment authorisations | Yes [C] | **Yes** | Partial: ClinForms data model (patients, episodes, PMI membership and authorisation numbers) [C repo] | In the notes row |
| Clinical notes: template builder, body charts, outcome measures, attachments, sign and lock, audit | Yes [C] | **Yes** | Partial: notes import (PDF/Word/CSV/text), per-clinic encryption, audit log, outcome schemas (NDI, ODI, NPRS, PSFS, QuickDASH). No note-writing screens [C repo] | 5–7 + 5–8 |
| Online intake forms + e-signature | Yes [C] | **Yes** | No | In booking/portal |
| Letters with mail-merge (GP, discharge) | Yes: Web editor; Desktop RTF [C] | **Yes** | **Strong:** ClinForms engine; RTF forms live since 21 Oct; merge fields can't reach an approved form [C repo] | 1.5–3 + 2–3 |
| **Complete the MLC/insurer's own form from notes** | **No** [C]. Heidi (integrated in TM3) fills PDF forms; Word "coming soon" [C, Heidi help] | **Yes – the reason to switch** | **Live** (ClinForms) | Done |
| Invoicing: self-pay, insurer, MLC on account, excess split, credits, debtors | Yes [C] | **Yes** | Nothing (invoiceflow has docs, no code) [C repo] | 3–5 + 6–11 (incl. Healthcode) |
| Healthcode e-billing (file export, remittance import, membership lookup) | Yes, all tiers [C] | **Yes.** AXA, Vitality and WPA steer to it [C] | Nothing. Needs a Healthcode agreement [I/U] | In invoicing. Lead time est. 2–6 months [I/U] |
| Card payments: terminals, pay links | Yes (TM3Pay via ClearAccept) [C] | Yes; can start non-integrated [I] | Stripe *subscription* code in pigeon-web. No Stripe Connect or Terminal [C repo] | 1.5–3 + 3–4 |
| SMS and email reminders | Yes, incl. two-way SMS [C] | **Yes** (two-way later) | Email abstraction; MailerSend chosen but not set up [C repo] | 1.5–2.5 + 2–3 |
| Reporting: utilisation, DNAs, revenue by site/clinician/payer, aged debt, expiring authorisations | Yes, plus a custom builder [C] | **Yes** (fixed reports + CSV) | Nothing | 1–2 + 3–5 |
| Roles, permissions, two-step sign-in, audit | Yes; SSO and IP allow-list on Best [C] | **Yes** (SSO later) | **Strong:** Better Auth roles, required TOTP, audit log – live [C repo] | 1–1.5 + 1–2 |
| GDPR tools: subject access, anonymise, merge duplicates, per-patient retention, legal hold | Yes [C] | **Yes** | Partial: a flat per-clinic retention cron, which is wrong for clinical notes [C repo, I] | In compliance |
| Data migration **from** TM3 | n/a. TM3 exports raw CSV + PDF notes [C] | **Yes** | Notes readers (PDF/Word/CSV) help [C repo] | 1–2 + 4–8 |
| Waiting lists, classes, packages, stock, telehealth, automations, recalls, marketing | Yes [C] | No; later, and only if Blue Heart uses them [U] | No | 0 + 2–4 |
| Integrations (Physitrack, Heidi, Xero, Mailchimp, Zoom), public API | Yes [C] | No / [U] | No | 0 + 2–6 |
| Platform: London Postgres, job queue, monitoring, staging | – | **Yes** | Postgres dialect and migrations written but not live. Production database is Cloudflare D1 in the EU [C repo] | 3–5 + 2–3 |
| Admin/support tools, compliance work, QA, training, cut-over | – | **Yes** | Platform admin page, retention cron, security work [C repo] | 5.5–8 + 7–11 |
| **Total** | **~25 modules** [C] | **24 of 43 rows** [I] | Reuse saves ~10–15% overall [I] | **33–52 MVP; 83–138 to parity** [I] |

**Reuse is uneven [I]:**
- About **60–80%** for letters/ClinForms and for sign-in, roles and audit.
- About **5–15%** for the PMS core (diary, billing, migration). That core is about 70% of the work.

---

## 3. Must-haves before any clinic can switch

None of these is mainly code. Most are slow and partly outside Khuram's control. The three on the critical path are **Healthcode**, the **TM3 exit** and **support in clinic hours** [I].

| # | Item | Why | Cost | Time |
|---|---|---|---|---|
| 1 | **Contract pack:** SaaS terms, Art 28 DPA, sub-processor list, SLA, exit-and-return clause, liability cap | Art 28 terms are mandatory [C, ICO]. Dell's solicitor will ask [I] | £2–5k solicitor [I/U] | 3–6 weeks [I] |
| 2 | **Pre-filled DPIA** for the clinic, plus a transfer risk assessment for any US processing | Art 35 and 28(3)(f) [C, ICO]. HCML's terms say the clinic must tell HCML before data leaves the UK (cl. 5.4) [C, hcml.co.uk] | Khuram's time; adviser £1–2k optional [U] | 1–3 weeks [I] |
| 3 | ICO fee, tier 1 | AppstackX is controller of its own data [I] | £52 a year [C, Lewis Silkin] | 1 day |
| 4 | **Cyber Essentials** now; **CE Plus** within 3–6 months | TM3 shows ISO 27001 and Cyber Essentials badges [C, TM3 security page] | CE £320 + VAT a year [C, IASME]. CE+ ~£966–1,900 [C, third-party] | CE 1–3 weeks; CE+ 2–6 weeks later [C/I] |
| 5 | **Independent pen test** + retest | Health data. The ICO fined a software processor £3.07m after attackers got in through an account without MFA (Advanced, 2022) [C, TechMonitor] | £5–11k + £1.3–2.6k [C, vendor estimates] | 4–8 weeks incl. fixes [I] |
| 6 | **Tech PI + cyber insurance** that covers hosted health data | Current PI covers "Software Engineering" only [C memory]. A cap in the contract must be backed by cover [I] | est. £1–3k a year [I] | 1–3 weeks [I] |
| 7 | **Records rules in the product:** per-patient retention (adults 8 years from last treatment; children to 25); legal hold; sign and lock; amendments visible | CSP record-keeping guidance [C, csp.org.uk]; HCPC standard 10 [C] | Dev time | 1–2 weeks [I] |
| 8 | **Insurer billing working on day one.** Invoice fields: ICD and CCSD codes, pre-auth number, unique invoice no. of 10 characters or fewer. Deadline alerts and remittance matching. Then **either** a Healthcode integration **or** a manual route Dell signs off (Healthcode portal CSV upload, insurer web forms) | Bupa takes electronic invoices only [C, Bupa physio terms]; Blue Heart doesn't name Bupa [C]. AXA and Vitality push Healthcode [C]. A Healthcode registration is per PMS: "registrations from previous providers are not valid" [C, Pabau help] | CCSD annual licence required, fee [U] [C]. Clinic pays Healthcode £9.20 a month per payee plus a per-invoice fee [C, vendor-reported] | Manual route 2–4 weeks dev. Native: est. 2–6 months, mostly waiting [I/U] |
| 9 | **TM3 migration plan:** importer built on TM3's in-app CSVs plus a paid trial extract, a reconciliation report, an archive viewer for PDF notes, a cut-over weekend, finance closed out in TM3 | **Access ends as soon as extraction starts.** Notes come out as PDFs. Cliniko's TM3 import moves **no financial data** [C, TM3 and Cliniko help] | Khuram's time; TM3 extract fee [U] | est. 6–10 weeks of evenings [I] |
| 10 | **Know the TM3 dates:** term end and the 90-day notice deadline | Miss the window and Blue Heart is likely tied in for up to another year [C MSA, I] | £0 | Ask now |
| 11 | **Production hosting for a live diary:** London Postgres with point-in-time recovery, Vercel Pro, nightly encrypted off-site and offline copy, restore test | Today: Vercel Hobby (non-commercial), D1 in the EU, 7-day Time Travel, no off-site export [C repo]. NCSC: keep a backup offline [C] | est. £80–250 a month hosting; £250–450 with SMS, recovery and monitoring [I] | 2–4 weeks [I] |
| 12 | **Support in clinic hours:** a named backup engineer or a 0.5 FTE support person, on-call alerts, status page, breach notice to the clinic within ~12 h, printable 48-hour diary fallback | Bupa wants breach notice within 24 h [C]; HCML within one working day [C]. Khuram is at BofA on weekdays [C memory] | 0.5 FTE est. £12–18k a year [I] | Hiring est. 1–3 months [I] |
| 13 | **Payments:** a new Stripe platform account (Connect) for the PMS; card data never touches our servers | PCI DSS [C, Stripe]. One Stripe account per product [C, CLAUDE.md] | 1.5% + 20p online, 1.4% + 10p in person; readers £49–249 [C, stripe.com/gb] | 2–4 weeks [I] |
| 14 | **SMS and email:** neutral reminder text with no clinical detail; DKIM/SPF/DMARC on the clinic's domain | PECR [C/I]; Gmail and Outlook sender rules [C] | SMS ~4p each, est. £110–320 a month for Blue Heart [C/I] | 1–2 weeks [I] |
| 15 | Accessibility (WCAG 2.2 AA) on patient booking and forms | The Equality Act duty the clinic will pass on [C, secondary] | Manual audit £1–3k [U] | 1–3 weeks [I] |
| 16 | **Intended-purpose statement** plus a light clinical-safety hazard log signed by a clinical safety officer | MHRA, 29 Jul 2026: drafting for clinician review is not a medical device; suggesting diagnoses is [C, gov.uk]. DCB0129 is mandatory only if NHS-funded work touches the system [C, NHS England] | Officer 3–5 days, rate [U] | 2–4 weeks [I] |

**Totals [I]:**
- **About £12–25k one-off** (pen test, legal pack, Cyber Essentials, safety review).
- **About £3–7k a year** (insurance, renewals, CCSD licence, hosting with recovery, monitoring).
- **Plus a support person**, est. £12–18k a year.
- **4–6 months of calendar time**, mostly waiting on Healthcode, the solicitor, the pen tester and TM3. Start early and this runs alongside the build.

**Not needed for Blue Heart's private work:** DSPT, DTAC and ISO 27001. ISO 27001 is nice to have at est. £10–40k over three years [C, vendor estimates]. DSPT applies only if Blue Heart does NHS-funded work [U – ask].

---

## 4. Market and competition

**Size [I]:**
- About **19,700 physios** work mainly in the independent sector: 81,965 HCPC-registered [C, HCPC] × 24% independent [C, CSP].
- At £30–50 a month each, the **whole UK physio PMS spend is about £7–12m a year**, shared by 12–15 credible products.
- Multi-site groups like Blue Heart are probably a few hundred [I/U].
- Free migration is standard. So is an AI scribe at £0–25 per clinician [C].

| Who | UK price | Notes-drafting | What it means for us |
|---|---|---|---|
| **TM3** (ClearCourse, PE) | £39 / £55 / £70 per user [C] | Heidi integration on the Better tier [C] | The incumbent. User satisfaction **6.0/10**, the lowest of the named systems, while its users run the biggest clinics (median revenue £330k) [C, HMDG 2025 barometer, n=715]. That points to lock-in, not love [I] |
| **Cliniko** (AU) | $45–395 a month in total by practitioner band; 9–12 practitioners $195, about £150 [C; £ I] | None native; open API [C] | CSP's partner PMS [C]. Blue Heart could move today for est. £150–225 a month [I]. So price alone isn't Dell's reason |
| **Jane** (CA) | £29–55 per practitioner; scribe £15 [C] | Yes | 1,200+ UK clinics [C]; valued at $1.8B (May 2025) [C] |
| **WriteUpp** (UK) | From £19.95 per user; scribe £23.95 [C] | Yes | Small UK team (1–10 staff) [C] |
| **Zanda** (AU) | £15–25 + £15 per extra practitioner; AI Pro £19 [C] | Yes | 12-month money-back, 50% off for 6 months [C] |
| **Semble** (UK) | Not published [U] | Via Heidi and Tandem [C] | £30m Series C, Jun 2026 [C] |
| **Pabau** (UK) | From £50 a month [C] | Free scribe [C] | Aesthetics-leaning; Healthcode app [C] |
| **Nookal / splose / PPS** | £16–48 per practitioner or user [C/I] | Nookal and splose [C] | splose has native Healthcode [C] |
| **Physitrack** | EMR launched 28 Sep 2026 (US $41.99–59.99) [C] | Scribe [C] | Exercise-app vendor moving into PMS |
| **Healthcode** | – | – | Turning its Epractice into a full PMS [C, secondary]. The billing gatekeeper is also a competitor |
| **Heidi** | £45–65 per user a month [C, secondary] | **Forms:** fills PDF forms from a session, "typically 80 to 90% accurate"; Word "coming soon" [C, Heidi help, 11 Jul 2026] | Raised $340M in Sep 2026 [C]. **Already inside TM3. The nearest threat to ClinForms itself** [I] |
| **Tandem** (SE) | [U] | Scribe | $100M Series B (Sep 2026) to build an "AI-native Clinic Operating System" [C] |

**Dell's "no tool like this" is mostly right, for now.** We found no product that publicly completes his RTF/Word provider templates from the whole course of treatment [U: absence of evidence]. But Heidi Forms already fills PDF forms from inside TM3, and Word is "coming soon" [C, Heidi help; I].

**Where we could win [I]:**
1. **Not as a generic TM3 clone.** That layer is saturated and cheap. Funded players are converging on the same "all-in-one + AI" pitch [C, §4 table].
2. **As the "funded-work" layer for multi-site MSK groups.** This covers the whole chain:
   - MLC, rehab-network and PMI referrals in;
   - authorisations (sessions approved, used, expiring);
   - each referrer's report due dates;
   - **the referrer's own form (ClinForms)**;
   - referrer invoicing.

   TM3's insurer add-on stops at capturing insurer details and the excess at booking [C, tm3app.com/features/connect-for-insurance]. This is the part Dell feels. It needs UK referrer knowledge, not VC money.
3. **ClinForms' edge**, which no vendor publicly offers together:
   - the referrer's own Word/RTF/PDF form in its original layout;
   - the whole course of treatment;
   - a cited source for every answer;
   - gaps flagged, and approval blocked until a clinician answers;
   - batch work;
   - per-clinic pricing.

   [C repo for ours; C Heidi help for theirs: PDF only, from one session.]
4. **It works on top of any PMS.** TM3 sells API access on its Best tier [C]; Cliniko's API is open [C]. No switch is needed to buy it.
5. **The window is time-limited.** Heidi says Word support is "coming soon" [C]. Getting paying clinics fast matters more than breadth [I].

**Contrast points to use with Dell later [I]:**
- Free export at any time without losing access. TM3 cuts access as soon as extraction starts [C].
- We don't commercially use anonymised client data. TM3's MSA cl. 11.3 allows it [C].
- Pricing per clinic, not per user.

---

## 5. Build estimate

**MVP** = one site runs diary, notes, reminders and basic invoicing **alongside TM3**, for new patients only.
**Parity** = what Blue Heart actually uses in TM3. That list stays [U] until a usage audit is done with Dell.

| Scenario | MVP (one site, alongside TM3) | Parity (all of Blue Heart off TM3) | Cash cost |
|---|---|---|---|
| **Solo, 12–15 h a week** (33–52 / 83–138 dev-weeks) | **est. 20–40 months** [I] | **est. 4–9 years – not viable** [I] | §3 compliance (£12–25k + £3–7k a year) + infra est. £250–450 a month [I] + all of Khuram's spare time |
| Solo, if agent speed holds on forms-and-records work (23–36 / 58–97) | est. 14–28 months [I] | est. 3–6 years [I] | Same |
| **Team: 2 senior developers + 1 QA/support, full-time** (27–44 / 69–116) | **est. 6–9 months from the funding decision** (4–6 once hired) [I] | **est. 12–20 months from funding**; tail to ~24 if migration or Healthcode slips [I] | **est. £220–330k a year** fully loaded [I], plus the above |

**What doesn't get faster with agents [I]:**
- migration rehearsals;
- Healthcode onboarding;
- testing with receptionists;
- the parallel run;
- being on call.

ClinForms shows how fast agent building can be: about 97k lines, live on 10 Oct after about five days [C repo]. But it has no real clinic yet [C repo]. A diary that 11 receptionists trust is a different kind of work [I].

**The two research estimates disagree.**
- The business note guessed "12–24 months of evenings" for a full replacement.
- The module-by-module build estimate says that fits a one-site MVP at best, not switching off TM3.
- We use the module estimate [I].

**The revenue side [I]:**
- **Blue Heart's price for an all-in-one: est. £600–1,200 a month, central ~£900.** That is roughly today's TM3 bill plus ClinForms (§2), and an owner who switches expects to pay no more.
- **The extra over ClinForms alone is only est. £500–900 a month.**
- **Return on time:** in year one, Blue Heart would pay about **£6–11 per hour** of solo build time. Khuram's day rate works out at **£84 an hour** (£630 ÷ 7.5 h).
- **Scale needed:** funding a team takes est. **20–40 clinic groups** of Blue Heart's size.

**Architecture a PMS forces [C/I]:**
- **Postgres in London, not D1.** D1 caps each database at 10 GB, runs one query at a time and limits queries to 30 s [C, Cloudflare docs].
- **No double booking enforced in the database**, using exclusion constraints [C, PostgreSQL docs].
- **Real-time diary updates.** Vercel WebSockets are in beta and tied to one instance, so we need Supabase Realtime or SSE with Redis [C, Vercel].
- **A durable job queue for reminders** [I].
- **Stripe Connect** [C].
- **Vercel Pro**, because Hobby is non-commercial [C].
- **A Next.js upgrade.** ClinForms is on Next 14.2 [C repo].

---

## 6. Options A–E compared

| | Option | Upside | Main risk | Cash in year 1 [I] | First £ [I] | Fits the BofA day job? | Verdict |
|---|---|---|---|---|---|---|---|
| **A** | **ClinForms for clinics on any PMS** (Blue Heart first, then other MLC-facing clinics on TM3, Cliniko, Jane…) | Live product, biggest market, est. 85–95% gross margin, support can wait hours. £5k MRR ≈ 26 clinics [I] | Heidi or TM3 adds form filling; getting notes out of each PMS | £3–8k | Blue Heart in est. 4–10 weeks | **Good** – no live SLA | **Do now** |
| **B** | **Full PMS now**, Blue Heart as design partner | Sticky; forms built in; est. £7–14k a year from Blue Heart | One verbal design partner (6 Oct: "happy with TM3" [C email]); a PE incumbent and cheap Cliniko; Healthcode, migration, 7-day support; ClinForms selling stops for a year or more | £10–20k solo (over years), or a team at £220–330k a year | Years | **Poor** – needs daytime support | **Not now** |
| **C** | **Staged wedge** (§7): reports → funded-work admin, notes and letters → diary → billing, site by site, each paid for | Each stage pays and can be reversed; stages 1–2 sell to any clinic; Dell sees steady progress | Notes kept in two places until the diary exists; scope creep; stage 3 still carries B's risk, just later | Low until stage 3 | Stage 1 in 4–10 weeks | Stages 1–2 **good**; stage 3 only with a support hire or once BofA ends | **Do, with gates** |
| **D** | **Dell co-funds** in light forms: prepay 12 months (≈ £2,038 at the founding price [C pricing]), paid discovery £2–5k, a referral share, module fees later | Tests intent with money; lowers risk; turns Dell into a referrer | Becomes bespoke contracting; scope disputes; equity from a customer complicates the future | +£2–30k | On signing | OK, if it pays for help, not promises | **Use the light forms** |
| **E** | **Partner instead of build.** E1: ClinForms launched from inside TM3, like Heidi [C]. E2: Blue Heart moves to Cliniko or Jane (est. £150–225 a month) + ClinForms linked = an "all-in-one" result without our diary | Distribution without running a diary. ClearCourse buys clinic software [C], so it is also a possible buyer [I] | TM3 may refuse, charge or copy; dependence on a partner; slow talks | £0–2k | 1–12 months | **Excellent** | **Explore alongside** |

### Recommendation

**A now, C with hard gates, D to prove intent, E in the background.**

In practice:
1. Get ClinForms paid and live at Blue Heart.
2. Keep selling ClinForms to MLC-facing clinics on any PMS.
3. Offer Dell the staged path in §7. Each stage starts only when there is money or a signed commitment.
4. Build the funded-work module next (the first true "all-in-one" piece), still alongside TM3.
5. Don't touch the diary until a support person is funded and two multi-site owners have signed.

**Why [I]:**
1. **It is the only option that earns money this year.**
2. **It tests Dell's seriousness cheaply.** If he won't pay £149 a month for the part he says he has been looking for, he won't fund a practice system.
3. **It uses ClinForms' window** before Heidi ships Word forms inside TM3 [C].
4. **It fits the day job.** Forms work can wait hours; a diary can't.
5. **The diary is the most mission-critical part and the least different from rivals.** It is the worst place to start.
6. **The track record says gate it.** 2026 so far: ~1,540 commits across ~25 repos, and about £205 of product revenue in total [C memory]. This is the first product where a buyer is pulling. Don't turn that pull into the biggest build trap on offer.

---

## 7. Roadmap if he goes ahead (with go/no-go gates)

These dates are internal plans only. **Never give them to Dell.**

### Stage 0 – now to mid-Nov 2026: follow-up and discovery
- Send the reply in §8 and get answers to the §8 questions.
- Run the free proof of concept already offered: 2–3 of his providers' templates plus one anonymised Initial Assessment note [C memory].
- Close the ClinForms gaps that block real data:
  - Vercel Pro;
  - London database;
  - MailerSend;
  - DPA/DPIA draft;
  - a ClinForms Stripe account (one per product).
- **Don't** ask for TM3 logins, screen recordings or exports in order to copy TM3. TM3's MSA cl. 3.2(b) bars the client from using TM3 to build a competing product [C]. Work only from TM3's public help centre.

**Gate 0 (est. mid-Nov):**
- Dell has answered the TM3 and usage questions.
- He has sent proof-of-concept material.
- He accepts the drafts.

**No-go:** he goes quiet, or won't share anything about TM3.

### Stage 1 – Nov 2026 to Jan 2027: paid ClinForms pilot at Blue Heart
- **Founding Practice price:** £149 a month fixed for 12 months (fair use 150 forms a month), plus £250 set-up [C, pricing D64].
- Real patient data only after the DPA is signed and UK hosting is in place.
- Ask Dell for **three introductions** to other clinic owners.
- Sell ClinForms to about 10 clinics on MLC panels, on any PMS.
- With Dell, ask TM3 whether API or data-warehouse access (Best tier [C]) is open to him. That would remove the notes upload without replacing TM3.

**Gate 1 (31 Jan 2027) – all required:**
- Blue Heart has paid for at least 60 days and uses real reports.
- **At least 3 other paying clinics.**
- Dell has prepaid or paid for discovery, under a **design-partner agreement**:
  - AppstackX owns the IP;
  - no exclusivity;
  - a price lock and a seat on the roadmap for Dell.

### Stage 2 – Feb to Jun 2027: the funded-work module (first all-in-one piece, still alongside TM3)
- **MLC/insurer case tracker:**
  - referral intake per referrer;
  - authorisations (sessions approved, used, expiring);
  - report due dates and chasing.
- **Initial assessment, progress and discharge notes** inside ClinForms. The physio writes the assessment once and the forms complete themselves. Clinic letters come from his templates.
- Sellable to any clinic as an add-on (est. +£10–20 per practitioner a month [I]).
- In parallel:
  - open talks with Healthcode (criteria, cost, timeline [U]);
  - get Cyber Essentials;
  - book a pen test of the platform;
  - get a specialist broker's insurance quote.

**Gate 2 (est. 30 Jun 2027) – all required:**
- **At least £2.5–3k MRR.**
- **At least two multi-site owners** (Dell plus one) have signed a letter of intent **with a deposit** to move at least one site.
- **A funded support person** for clinic hours, or Khuram's BofA contract has ended.
- Blue Heart's **TM3 renewal date and notice deadline** are known.
- The **Healthcode route** is known: native integration, or a manual route Dell signs off.

### Stage 3 – H2 2027 at the earliest: diary, online booking and reminders at one pilot site
- Pick the site with the fewest patients who also attend other sites [I]. New patients only; TM3 keeps the rest.
- Every §3 must-have is done first: contract pack, pen test, Cyber Essentials, London hosting with recovery, support cover, retention rules, insurance.

**Gate 3:**
- The pilot site has been stable for at least 1–3 months [I], with no serious incident.
- Its receptionists sign it off.
- A restore drill has passed.

### Stage 4 – 2028: billing and Healthcode, migration, roll-out to 11 sites
- Billing and Healthcode come last.
- Rehearse the migration 2–3 times with counts checked.
- Roll out site by site, with a parallel run of est. 8–12 weeks [I].
- **Time the cut-over to TM3's notice:** at least 90 days' notice before the term ends [C, MSA cl. 8.1].

**Gate 4:** Blue Heart gives TM3 notice only after a full dry-run migration passes.

### Stop signals (any stage)
- Dell won't pay for ClinForms.
- He won't share his TM3 invoice or contract dates.
- He asks for a free build or exclusivity.
- He won't move any site until there is full parity.
- Building hours exceed selling hours for two weeks running.

**Weekly rule:** no new module without money or a signed commitment, and selling hours at least match building hours [I].

---

## 8. What to say to Dell

### Reply email (draft – Khuram to edit and send)

Customer-facing rules:
- No AI, model or vendor words.
- No dates.
- No promise of TM3 parity.
- Never suggest a TM3 partnership.

> **Subject:** Re: ClinForms – thank you, and next steps
>
> Hi Dell,
>
> Thank you for your time today. I'm really glad the demo was useful.
>
> I've been thinking about your idea of one system for everything, so Blue Heart wouldn't need TM3 as well. It's a big opportunity and I'd like to explore it with you properly. Your whole team would rely on that system every day, so I'd rather build it with you step by step than promise everything at once.
>
> This is how I'd suggest we do it:
>
> 1. **Reports first.** We set ClinForms up on two or three of your providers' templates, you check the completed reports, and then your clinicians start using it.
> 2. **Then the work around the reports.** Assessment notes, referral and authorisation tracking, report due dates and letters, all in one place.
> 3. **Then the diary, booking and billing.** Site by site, once the earlier steps have proved themselves in your clinics.
>
> To plan this properly, it would help to know a little more about how you use TM3 today:
> - which parts your team uses every day (for example the diary, online booking, reminders, insurer billing through Healthcode, card payments and reports);
> - roughly what you pay for it now, and when your contract renews;
> - what you would most like to work better than it does now.
>
> For the first step, could you send blank templates for two or three of your most common providers, and one anonymised Initial Assessment note as TM3 prints or exports it? Please replace names, dates of birth, addresses and claim references with XXXX rather than deleting them. I'll send the completed drafts back for you to review.
>
> [Optional, only if price came up on the call: As one of our first clinics, the price is £149 a month for all your sites and staff, fixed for 12 months, plus a one-off £250 set-up. Paid use starts once the data processing agreement is signed.]
>
> Kind regards,
>
> Khuram Masood
> AppstackX Ltd
> khuram@appstackx.co.uk
> https://appstackx.co.uk

Notes for Khuram:
- Confirm the VAT wording before quoting any price (`memory/context/pricing.md`).
- If you add a turnaround for the drafts, choose the number yourself.

### Questions to ask Dell (next call or reply), most important first

| # | Question | Why it matters |
|---|---|---|
| 1 | "If we only did the reports for now, would you start in November at the founding price?" | The cheapest test of the bigger idea |
| 2 | TM3 Desktop, Web or both? Which tier, how many licences, any pay-as-you-go practitioners? Could you share a recent invoice? | Sets the price anchor (§2) and the migration path |
| 3 | When does your TM3 contract end, and what is the notice period? Monthly or annual? | 90-day notice, renewal up to a year [C MSA] |
| 4 | Which TM3 features does the team use every day? Diary across sites, online booking, SMS reminders (two-way?), waiting lists, classes, packages, stock, telehealth, and which reports you run weekly | Defines "parity" from real use, not TM3's brochure |
| 5 | Insurer billing: Healthcode through TM3, or insurer portals? Which insurers by volume? How many payee providers are registered? | Healthcode is the slowest dependency |
| 6 | Card payments: TM3Pay or card machines? Term of that contract? | Payments switching friction [U] |
| 7 | Do you use Physitrack, Heidi, Xero, Mailchimp or Pronto (for example Vita Health Group referrals)? | Integrations we would need [U] |
| 8 | What would make you move away from TM3? Rank price, support, missing features, the reports | Tells us whether the funded-work module alone solves it |
| 9 | Would you switch site by site and run both systems for a while? Who on your side would lead migration and training? Which site has the fewest patients who also go to other sites? | Pilot design |
| 10 | Opening hours at each site, including evenings and weekends? What happens today when TM3 is down? | Sets the support window and SLA |
| 11 | Any NHS-funded work? CQC registered? Do you treat children? Do your MLCs or insurers set IT or security rules for suppliers? | DSPT/DCB0129 scope; retention rules; certificates |
| 12 | Would you co-fund the next stage (prepay, paid discovery)? Do you expect ownership or exclusivity? (Our answer: we keep the IP, no exclusivity) | Option D |
| 13 | Who else do you know with the same reporting pain? Would you introduce three? | Gate 1 needs 3 more paying clinics |
| 14 | Which company would sign and be invoiced? | Blue Heart Clinics Ltd (09158709) files dormant accounts [C Companies House via memory] |

**Don't:**
- Promise dates or "everything TM3 does".
- Ask for his TM3 login or screen recordings to copy TM3.
- Name our suppliers.
- Mention any other prospect.

---

## 9. Risks and how to reduce them

| # | Risk | Likelihood / impact [I] | How to reduce it |
|---|---|---|---|
| 1 | **Build trap.** The biggest build on offer, resting on one verbal idea after a good demo. 2026 so far: about £205 of product revenue from ~25 repos [C memory] | High / High | The gates in §7. No module without money or a signed commitment. Selling hours ≥ building hours |
| 2 | **One design partner.** On 6 Oct Dell wrote they were "happy with TM3" and not looking to move [C email] | High / High | Gate 2 needs two multi-site letters of intent with deposits |
| 3 | **No support in clinic hours** while Khuram is at BofA [C memory] | Certain / Critical for a diary | No diary until a support person is funded. Until then, sell only products where support can wait |
| 4 | **Healthcode onboarding unknown:** no public criteria, cost or timeline [U] | Medium / High | Open talks in stage 2. A manual route Dell signs off. Billing goes last |
| 5 | **One-shot TM3 exit.** Access ends at extraction; finance history doesn't move; data erased after 90 days [C] | High / High | Paid trial extract; close out finance in TM3; keep the archive 8+ years; rehearse 2–3 times |
| 6 | **TM3 contract misuse** (MSA cl. 3.2(b)) [C] | Low if careful / High | Work only from public documentation. Never use Dell's TM3 access to copy TM3 |
| 7 | **Heidi Forms or TM3 closes ClinForms' gap.** Word support "coming soon" [C] | Medium–high / High | Paying clinics fast. Lean on Word/RTF, the whole course of treatment, citations and batch. Keep partner route E open |
| 8 | **Funded rivals** moving into "all-in-one + AI": Jane, Semble, Tandem, Physitrack, Healthcode Epractice [C] | Certain / Medium | Don't fight on generic PMS. Win the funded-work niche |
| 9 | **Data breach liability.** The ICO fines processors directly (Advanced, £3.07m) [C] | Low / Severe | MFA everywhere, patching, pen test, CE+, offline backups, insurance |
| 10 | **Hosting not fit for a live diary** (Hobby, D1 in the EU, 7-day Time Travel, no off-site export) [C repo] | Certain today / High | Vercel Pro, London Postgres with recovery, nightly encrypted offline copy, restore drills before go-live |
| 11 | **Insurance gap:** PI covers "Software Engineering" only [C memory] | Certain / High | Specialist broker quote for tech PI + cyber covering hosted health data, before real data |
| 12 | **Scope creep and bespoke work** for one client | High / Medium | Design-partner agreement: our IP, no exclusivity, written scope per stage, paid change requests |
| 13 | **Unclear contracting entity** (09158709 dormant) [C] | Medium / Medium | Confirm before the DPA or the first invoice |
| 14 | **Data leaving the UK.** Our drafting provider is in the US and we found no Data Bridge certification [C/U]. HCML must be told before data leaves the UK [C] | Medium / Medium | IDTA or UK Addendum plus a transfer risk assessment. Keep the PMS core in London. Tell Blue Heart, so it can notify HCML |
| 15 | **Regulation drift.** MHRA lines: no diagnosis or treatment suggestions, no sending without approval [C]. New health-IT standards under the Data (Use and Access) Act 2025 not yet set [C] | Low / High | Intended-purpose statement. Human approval enforced. Watch the Act |
| 16 | **BofA outside-business rules** [I] | Low / Medium | Check the rules. Healthcare software is unrelated to capital markets [I] |

---

## Sources (checked 23 Oct 2026 unless stated)

**TM3**
- Product and pricing:
  - Pricing: https://tm3app.com/pricing/
  - Features: https://tm3app.com/features/connect-for-insurance/ · https://tm3app.com/features/security-and-compliance/
  - Migration and sectors: https://tm3app.com/migrating-to-tm3/ · https://tm3app.com/sectors/msk-groups-and-chains/
- TM3 UK MSA v5.3 (Nov 2025): https://tm3app.com/wordpress_tm3/wp-content/uploads/2025/11/MS-UK.pdf
- Help centre:
  - Merge fields: http://help.tm3app.com/en/articles/4585166-full-list-of-merge-fields
  - Desktop templates: http://help.tm3app.com/en/articles/4448652-how-to-replicate-your-old-desktop-templates-to-your-new-system
  - Cancel and extract: http://help.tm3app.com/en/articles/4585360-cancelling-the-subscription-and-extracting-your-data
  - Healthcode: http://help.tm3app.com/en/articles/4700000-exporting-invoices-to-healthcode
- Ownership:
  - https://businesscloud.co.uk/news/pe-backed-clearcourse-snaps-up-healthcare-expert/
  - https://www.irishnews.com/business/2022/09/09/news/clearcourse_acquires_belfast_healthcare_software_provider_blue_zinc-2821986/
- Satisfaction barometer: https://hmdg.co.uk/private-practice-barometer/ai-software-tools-physiotherapy-clinics-uk-2026/
- Migration out of TM3:
  - Cliniko: https://help.cliniko.com/en/articles/4365780-transfer-data-from-tm3-to-cliniko
  - Jane: https://jane.app/guide/importing-to-jane/importing-to-jane-from-tm2-tm3

**Market**
- Workforce:
  - HCPC register: https://www.hcpc-uk.org/data/the-register/register-summary
  - CSP workforce review: https://csp.org.uk/node/1341798
- Competitor pricing:
  - Cliniko: https://www.cliniko.com/pricing/
  - Jane: https://jane.app/pricing
  - WriteUpp: https://www.writeupp.com/pricing
  - Zanda: https://zandahealth.com/uk/pricing/
  - Nookal: https://www.nookal.com/uk/pricing
  - splose: https://splose.com/uk/pricing
  - Pabau: https://pabau.com/pricing/
- Heidi Forms: https://support.heidihealth.com/en/articles/11668834-form-filling
- Heidi in TM3: https://www.heidihealth.com/en-gb/integrations/tm3
- Funding news:
  - Heidi: https://www.fiercehealthcare.com/ai-and-machine-learning/heidi-lands-340m-build-ai-care-partner-clinicians
  - Tandem: https://letsdatascience.com/news/tandem-health-raises-100m-for-clinic-software-c98dcadd
  - Jane: https://thelogic.co/briefing/jane-software-valued-at-1-8b-as-it-finalizes-500m-raise-report/
  - Semble: https://www.techmarketview.com/ukhotviews/archive/2026/06/04/semble-secures-30m-series-c-to-scale-private-healthcare-platform
  - Physitrack: https://www.inderes.dk/releases/physitrack-sets-out-commercial-model-for-its-emr-as-more-than-100-clinics-sign-up-for-early-access-in-five-days
- Healthcode Epractice: https://healthcareandprotection.com/healthcode-to-integrate-epractice-with-nhs-systems/

**Compliance, billing, operations**
- ICO:
  - Art 28 contract terms: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/contracts-and-liabilities-between-controllers-and-processors-multi/what-needs-to-be-included-in-the-contract/
  - Fee: https://www.lewissilkin.com/insights/2025/02/06/fee-payable-to-the-ico-to-increase-in-february-102jzb9
- Advanced fine: https://www.techmonitor.ai/technology/cybersecurity/uk-ico-fines-advanced-computer-3-07m-after-nhs-data-breach
- CSP record keeping: https://www.csp.org.uk/professional-clinical/professional-guidance/record-keeping-guidance
- MHRA ambient voice guidance (29 Jul 2026): https://www.gov.uk/government/news/mhra-clarifies-regulatory-status-of-ambient-voice-technologies-used-in-the-nhs
- DCB0129 scope: https://digital.nhs.uk/services/clinical-safety/applicability-of-dcb-0129-and-dcb-0160/step-by-step-guidance
- Cyber Essentials and testing:
  - Cyber Essentials: https://iasme.co.uk/cyber-essentials/faq-cyber-essentials
  - CE Plus: https://forensiccontrol.com/guides/how-much-does-cyber-essentials-plus-cost/
  - Pen test: https://kolonell.com/en/blog/web-application-penetration-test-pricing-london-2026
- Insurer and MLC terms:
  - Bupa physio terms: https://www.bupa.co.uk/~/media/Files/HCP/physio/physio-contract.pdf
  - HCML supplier terms: https://hcml.co.uk/hcml-supplier-terms-and-conditions/
  - WPA: https://www.wpa.org.uk/healthcare-providers
- Healthcode:
  - Developers: https://www.healthcode.co.uk/software-developers/
  - Pabau set-up guide: https://support.pabau.com/en/pabau2/how-to-integrate-with-healthcode
  - Pabau fees note: https://support.pabau.com/en/pabau2/insurance-pricing-uk
  - WriteUpp set-up guide: https://knowledge.writeupp.com/en/en/article/guide-to-setting-up-healthcode-integration-1ldf1p8/
  - CCSD licence: https://ccsd.org.uk/?p=39442
- Payments and SMS:
  - Stripe UK: https://stripe.com/gb/pricing
  - Twilio UK SMS: https://www.twilio.com/en-us/sms/pricing/gb
- NCSC backups: https://www.ncsc.gov.uk/blog-post/offline-backups-in-an-online-world

**Build**
- Cloudflare D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- Supabase backups: https://supabase.com/docs/guides/platform/backups
- Vercel pricing: https://vercel.com/pricing
- Vercel WebSockets: https://vercel.com/guides/do-vercel-serverless-functions-support-websocket-connections
- PostgreSQL range types: https://www.postgresql.org/docs/current/rangetypes.html#RANGETYPES-CONSTRAINT

**Internal (read, not changed):**
- This repo:
  - `CLAUDE.md`
  - `memory/projects/blue-heart-clinics.md`
  - `memory/context/pricing.md`, `memory/context/compliance.md`, `memory/context/hosting-and-infra.md`
  - `docs/database.md`, `docs/production-architecture.md`
- Other repos: `hospital-system`, `careconnect-mk`, `dutydesk`, `invoiceflow`, `pigeon-web`
- Auto-memory: `khuram-day-contract.md`, `next-venture-research-oct-2026.md`
