# All-in-one practice system to replace TM3: feasibility

**Internal – not for customers.** Fri 23 Oct 2026, written after the Blue Heart demo (11:30 BST). For Khuram. Revised the same afternoon after an independent review and a fact-check (38 findings, applied).

**The question.** On the call, Dell Baines (owner, Blue Heart Clinics: 11 sites, uses TM3) raised a bigger opportunity: one product that does everything TM3 does, plus ClinForms, so Blue Heart can replace TM3. Khuram asked: **is it doable?**

**How to read this:**
- Tags: **[C]** confirmed (source given), **[I]** inference or estimate, **[U]** unknown. "Est." = our estimate.
- Prices are ex VAT unless stated.
- Sources: five research notes (TM3, market, compliance, build, business) from 23 Oct 2026, public sources and this repo.
- Nobody was contacted and nothing was signed up for. Not legal advice; contracts need a solicitor.

---

## 1. The answer

**No – not as a product AppstackX builds or runs.** **Yes to ClinForms at Blue Heart now.** If Dell wants to leave TM3, he gets "one system" by moving to an existing practice system with UK insurer billing, with ClinForms linked to it (option E2, §6) [I].

Why a PMS of our own is out:

| | Solo at 12–15 h a week (stated assumption) | Solo at a realistic 5–8 h a week [I] |
|---|---|---|
| Switch all of Blue Heart off TM3 (parity) – **the number that answers Dell** | **est. 4–9 years** [I] | **est. 8–21 years** – i.e. never [I] |
| Engineering MVP (one site or one clinician alongside TM3) – *not something Blue Heart could use* | est. 20–40 months [I] | est. 3–8 years [I] |

- **Support:** a diary needs cover in clinic hours (about 07:30–20:00 weekdays plus Saturdays [I]). Khuram is at BofA on weekdays [C memory]. Proper cover (first line plus an engineer on call, ≤1 h response) costs est. **£30–60k a year** [I].
- **Money:** a PMS at Blue Heart is worth est. **£300–1,200 a month at steady state and £0 in year one** [I]. For each year it is paid, that is about **£0.40–3 per hour** of the build, against **£84 an hour** at BofA (§5).
- **Before any site could switch:** Healthcode insurer billing, a one-shot TM3 data exit and a compliance pack [C/I].
- **Dell's signal is unverified [U].** It is one relayed sentence from a 15-minute call. On 6 Oct he wrote "we are happy with this for now, so we are not currently looking to move" [C email]. No money, no proof-of-concept material and no price reaction are recorded yet [C memory]. **Treat the all-in-one idea as zero until money is attached.**

### Before you send anything (Khuram)
1. **What did Dell say, word for word?** "Here is tool like this" can mean there **is** a tool like this (for example Heidi, already integrated in TM3 [C]) or there is **no** tool. Did price come up?
2. **What happened to the day-14 gate** from the 3 Oct plan (≥80 personal sends, ≥15 replies, ≥3 conversations)? [C memory: `next-venture-research-oct-2026.md`]
3. **What stops to make room?** October so far: Starwrit 721 commits (about 510 in the week before the demo), ClinForms 129, simbah-academy 44, DutyDesk 2 [C git]. PigeonPro's time-box ends 30 Nov [C memory]. In 2026: ~1,540 commits across ~25 repos and ~£205 of product revenue [C memory].
4. Then edit and send the §8 email.

---

## 2. What "replace TM3" really means

TM3 is a full UK practice-management suite. Our count of its public modules is about 20–25 [I]; TM3 publishes no count. Its maker, Blue Zinc IT (Belfast, 2002), has been owned by the PE-backed ClearCourse since Sep 2022 [C, Irish News; BusinessCloud]. We scored 43 feature rows; 24 are must-haves for an 11-site physio group [I].

**Facts that shape everything:**
- **TM3 does not do the ClinForms part.** Its letter merge fields pull demographics and case fields (diagnosis, referral reason, pain scales, outcome), plus one free-text Case "Clinic Notes" field. No field brings in consultation or assessment content [C, TM3 "Full List of Merge Fields"]. That is why Blue Heart's physios type the clinical part by hand.
- **TM3 already covers part of the referral admin.** It records treatment authorisations (code, business, sessions and/or value, expiry, linked case, remaining amount) [C, TM3 help 4553166]; no expiry alerts are documented. Pronto lets clinics "receive patient referrals and treatment authorisations in real-time" from large providers, and Pronto Portal can send invoices and reports [C, TM3 help 4560121].
- **Blue Heart's RTF templates look like TM3 Desktop letters.** TM3 Web uses an in-app editor and documents no RTF upload [C, TM3 help]. Blue Heart may run Desktop, or a mix [I]. This matters for any export: Desktop-created cases export as CSV only, with no PDF notes [C, TM3 help 4585360].
- **What Blue Heart probably pays TM3:** list prices £39 / £55 / £70 per user a month [C, tm3app.com/pricing]. "Connect for Insurance" is £10 per practitioner a month as a limited-time offer [C]. For 8–17 users plus SMS: est. **£400–1,100 a month** [I]. Blue Heart probably can't reclaim VAT (physio is VAT-exempt), so ×1.2 [I]. Don't use any figure until a real one exists.
- **TM3's pricing and terms are confidential.** The MSA's "Confidential Information" includes "(a) the terms of this Contract and the pricing" (cl. 1.4). Each party shall "not disclose the Confidential Information to any other person" without prior written consent, except to its own officers, employees, agents and advisers (cl. 10.2) or by law (cl. 10.3) (cl. 10.1) [C, TM3 UK MSA v5.3, re-read 23 Oct]. Blue Heart may be on an older version [U]. **Don't ask Dell for his TM3 invoice or contract.** If it ever matters, ask only what he is free to share, and suggest he checks his contract or asks his solicitor.
- **Contract timing** [C, MSA v5.3]: 90 days' written notice before a term ends (cl. 8.1); renewal terms up to one year (cl. 1.19); fees up 5% a year or up to 8% indexed (cl. 6.7); data "made available for migration", then may be erased after 90 days (cl. 9.2(d)); the client may not use TM3 "to build a product or service which competes" (cl. 3.2(b)).

### Module table

"Needed to switch" = needed on day one for Blue Heart to leave TM3 [I]. Effort is in solo dev-weeks, **MVP + extra for parity** [I]. A dev-week is 40 hours of Khuram's attention. The figures assume agents make him 2–3× faster overall; for correctness-critical work (diary, billing, migration) assume **≤1.5×** [I], so the upper end of each range is likelier.

| Module | TM3 has | Needed to switch? | We have today | Effort (dev-weeks) |
|---|---|---|---|---|
| Multi-site diary: sites, rooms, rotas for practitioners on several sites, recurring bookings, DNA/late-cancel fees, no double booking | Yes [C] | **Yes** | Nothing usable. ClinForms has an appointment schema; hospital-system has appointment *requests* only, slot engine "Phase 2" [C repo] | 6–9 + 6–9 |
| Online booking + patient portal | Yes [C] | Later. Blue Heart books by phone or contact form [C, blueheartclinics.co.uk] | Patterns only (hospital-system, careconnect-mk) [C repo] | Booking 2–3 + 2–4; portal 0.5–1 + 3–5 |
| Patient record: demographics, GP, consent, insurer/MLC accounts, authorisations | Yes [C] | **Yes** | Partial: ClinForms data model (patients, episodes, PMI membership, authorisation numbers) [C repo] | In the notes row |
| Clinical notes: templates, body charts, outcome measures, attachments, sign and lock, audit | Yes [C] | **Yes** | Partial: notes import, per-clinic encryption, audit log, outcome schemas. No note-writing screens [C repo] | 5–7 + 5–8 |
| Online intake forms + e-signature | Yes [C] | **Yes** | No | In booking/portal |
| Letters with mail-merge | Yes: Web editor; Desktop RTF [C] | **Yes** | **Strong:** ClinForms engine; RTF forms live since 21 Oct [C repo] | 1.5–3 + 2–3 |
| **Complete the MLC/insurer's own form from notes** | **No** [C]. Heidi Forms fills PDF forms "from your session"; Word "coming soon" [C, Heidi help]. Whether Forms works inside TM3 is [I] | **The reason to switch** | **Live** (ClinForms) | Done |
| Invoicing: self-pay, insurer, MLC on account, excess split, credits, debtors | Yes [C] | **Yes** | Nothing (invoiceflow has docs only) [C repo] | 3–5 + 6–11 (incl. Healthcode) |
| Healthcode e-billing | Yes, all tiers [C] | **Yes.** AXA and Vitality push Healthcode [C, secondary for AXA]; WPA accepts Healthcode or its own free upload [C] | Nothing. Needs a Healthcode agreement [U] | In invoicing. Lead time est. 2–6 months [I/U] |
| Card payments | Yes (TM3Pay) [C] | Yes; can start non-integrated [I] | Stripe subscriptions in pigeon-web only [C repo] | 1.5–3 + 3–4 |
| SMS and email reminders | Yes, incl. two-way [C] | **Yes** | Email abstraction; MailerSend not set up [C repo] | 1.5–2.5 + 2–3 |
| Reporting | Yes, plus a custom builder [C] | **Yes** (fixed reports + CSV) | Nothing | 1–2 + 3–5 |
| Roles, two-step sign-in, audit | Yes [C] | **Yes** | **Strong:** Better Auth roles, required TOTP, audit log – live [C repo] | 1–1.5 + 1–2 |
| GDPR tools: subject access, anonymise, merge, per-patient retention, legal hold | Yes [C] | **Yes** | Partial: a flat per-clinic retention cron, wrong for clinical notes [C repo, I] | In compliance |
| Data migration from TM3 | TM3 exports CSV + PDF notes (Desktop cases CSV only) [C] | **Yes** | Notes readers help [C repo] | 1–2 + 4–8 |
| Waiting lists, classes, packages, stock, telehealth, recalls | Yes [C] | Later, if used [U] | No | 0 + 2–4 |
| Integrations, public API | Yes [C] | [U] | No | 0 + 2–6 |
| Platform: London Postgres, job queue, monitoring, staging | – | **Yes** | Postgres migrations written, not live; production is D1 in the EU [C repo] | 3–5 + 2–3 |
| Admin/support tools, compliance, QA, training, cut-over | – | **Yes** | Platform page, retention cron, security work [C repo] | 5.5–8 + 7–11 |
| **Total** | **~20–25 modules** [I] | **24 of 43 rows** [I] | Reuse saves ~10–15% overall [I] | **33–52 MVP; 83–138 to parity** [I] |

Reuse is uneven [I]: about 60–80% for letters and sign-in; about 5–15% for the PMS core (diary, billing, migration), which is about 70% of the work.

---

## 3. What it would take

### 3a. Before real patient data in ClinForms (the pilot – do these now)
| Item | Cost | Notes |
|---|---|---|
| Cyber Essentials (basic) | £320 + VAT a year [C, IASME] | 1–3 weeks |
| ICO fee, tier 1 | £52 a year [C, Lewis Silkin] | 1 day |
| Tech PI + cyber insurance covering hosted health data | est. £1–3k a year [I] | Current PI covers "Software Engineering" only [C memory] |
| Art 28 DPA + DPIA draft | solicitor est. £2–5k [I/U] | Mandatory terms [C, ICO] |
| IDTA or UK Addendum + transfer risk assessment for the US drafting provider | Khuram's time | No Data Bridge certification found for it [C/U]. Check its DPF/UK-extension status at dataprivacyframework.gov before the DPIA [U] |
| HCML notice line in the DPA pack | £0 | The clinic must tell HCML before data leaves the UK (cl. 5.4) [C, hcml.co.uk] |
| Contracting-entity check | £0 | Blue Heart Clinics Ltd (09158709) files dormant accounts [C Companies House via memory] |
| Vercel Pro, Workers Paid, London database, MailerSend, ClinForms Stripe account | est. £30–60 a month [I] | Hobby is non-commercial [C] |
| **Decide: pen test before real data?** | £5–11k + retest £1.3–2.6k [C, Kolonell] | The compliance note calls CE plus a pen test must-haves before real patient records [C note]. Ask what Dell's solicitor and his MLCs require |

**Option A's year-1 cash:** est. £3–8k, or **£8–19k if the pen test comes first** [I], against about £2k a year from Blue Heart (£149 × 12 + £250) [C pricing].

### 3b. Before any clinic could switch practice system (only if a PMS is ever reopened)
None of these is mainly code. The critical path is **Healthcode**, the **TM3 exit** and **support in clinic hours** [I].

| # | Item | Why | Cost | Time |
|---|---|---|---|---|
| 1 | Contract pack: SaaS terms, DPA, sub-processors, SLA, exit-and-return clause, liability cap | Dell's solicitor will ask [I] | £2–5k [I/U] | 3–6 weeks [I] |
| 2 | Cyber Essentials Plus | TM3 shows ISO 27001 and CE badges [C] | From £1,495 + VAT a year for up to 9 users [C, Forensic Control] | 2–6 weeks after CE [I] |
| 3 | Independent pen test + retest | ICO fined a software processor £3.07m after attackers used an account without MFA (Advanced) [C, TechMonitor] | £5–11k + £1.3–2.6k [C] | 4–8 weeks [I] |
| 4 | Records rules: retention (adults 8 years from last treatment; children until their 25th birthday, or 8 years after their 18th if later – check with a solicitor), legal hold, sign and lock, visible amendments | CSP guidance [C]; HCPC standard 10 [C] | Dev time | 1–2 weeks [I] |
| 5 | Insurer billing on day one: ICD/CCSD codes, pre-auth number, invoice no. ≤10 characters, remittance matching; **either** Healthcode **or** a manual route Dell signs off | Bupa takes electronic invoices only [C]. A Healthcode registration is per PMS: "You cannot use previous registrations that you have set up for another system" [C, WriteUpp guide] | CCSD licence fee [U]; clinic pays Healthcode £9.20 a month per payee + per invoice [C, vendor-reported] | Manual 2–4 weeks; native est. 2–6 months [I/U] |
| 6 | TM3 migration: importer, paid trial extract, reconciliation, archive viewer, cut-over weekend, finance closed in TM3 | Access ends as soon as extraction starts; Desktop cases export as CSV only, with no PDF notes; Cliniko's TM3 import moves no financial data [C] | TM3 extract fee [U] | est. 6–10 weeks of evenings [I] |
| 7 | Production hosting for a live diary: London Postgres with point-in-time recovery, nightly encrypted offline copy, restore drills | Today: Hobby, D1 in the EU, 7-day Time Travel, no off-site export [C repo]. NCSC: keep a backup offline [C] | est. £250–450 a month with SMS and monitoring [I] | 2–4 weeks [I] |
| 8 | **Support in clinic hours:** first-line help **plus an engineer on call (≤1 h response)**, outsourced or on retainer; alerts, status page, breach notice within ~12 h, printable diary fallback. Daily load across 11 sites: how-to questions, SMS failures, Healthcode rejections, remittance mismatches, refunds, clock-change bugs | Bupa wants breach notice within 24 h; HCML within one working day [C]. TM3's support hours aren't published [U]. Whether a bank contractor can be paged in the day [U] | **est. £30–60k a year** [I] | 1–3 months [I] |
| 9 | **Continuity:** source-code escrow, guaranteed export, a named successor or exit plan | "Expect Dell, or his solicitor, to ask what happens if you stop?" [C compliance note] | Escrow ~£1–2k a year [U] | 2–4 weeks [I] |
| 10 | Payments: a new Stripe Connect platform account | PCI DSS [C]; one Stripe account per product [C, CLAUDE.md] | 1.5% + 20p online, 1.4% + 10p in person [C] | 2–4 weeks [I] |
| 11 | SMS reminders with no clinical detail; DKIM/SPF/DMARC | PECR [C/I] | $0.056 a segment [C, Twilio] ≈ 4.3p [I]; at ~650–1,560 appointments a month [I] × 1–2 SMS ≈ **£30–135 a month** [I] | 1–2 weeks [I] |
| 12 | Accessibility (WCAG 2.2 AA) on booking and forms | Equality Act duty passed on [C, secondary] | Audit £1–3k [U] | 1–3 weeks [I] |
| 13 | Intended-purpose statement + light hazard log | MHRA (29 Jul 2026) on ambient voice tech: drafting for clinician review is not a device; suggesting diagnosis is [C, gov.uk]. Applying it to form completion is [I] by analogy – the guidance doesn't address third-party report forms. DCB0129 is mandatory only for NHS-funded work [C] | Officer 3–5 days [U] | 2–4 weeks [I] |

**Totals [I]:** about £12–25k one-off; £3–7k a year; **plus support cover est. £30–60k a year**; 4–6 months of calendar time, mostly waiting on Healthcode, the solicitor, the pen tester and TM3.

**Precondition before any diary talk [I]:** ClinForms runs for 3 months with paying clinics, with on-call alerts, a status page, a passed restore drill and no unhandled daytime Sev-1. ClinForms' own operations aren't proven yet: first retention cron run unverified, go-live §7.6 key check pending, access requests send no notifications, Vercel Hobby and Workers Free [C, CLAUDE.md].

---

## 4. Market and competition

**Size [I]:** about **19,000 physios** mainly independent (79,376 HCPC-registered on 1 Oct 2026 [C, HCPC] × 24% [C, CSP]). At £30–50 a month each, UK physio PMS spend is about **£7–11m a year**, shared by 12–15 credible products. Free migration and an AI scribe at £0–25 per clinician are standard [C].

| Who | UK price | Notes-drafting | What it means for us |
|---|---|---|---|
| **TM3** (ClearCourse, PE) | £39 / £55 / £70 per user [C] | Heidi integration (Better tier) [C] | Satisfaction **6.0/10 from 30 mentions**, the lowest of the systems with a meaningful sample; its users run the biggest clinics (median revenue £330k) [C, HMDG Private Practice Barometer 2026, survey Aug–Nov 2025, n=715]. Lock-in, not love [I] |
| **Cliniko** (AU) | $45–395 a month in total; 9–12 practitioners $195, 13–25 $295 (~£150–225) [C; £ I] | None native; open API [C] | CSP's partner PMS [C]. Effra (connected app) submits invoices to "all major UK health insurers" and processes remittances [C]; via Healthcode? [U] |
| **Jane** (CA) | £29–55 per practitioner; scribe £15 [C] | Yes | "more than 1,200" UK clinics [C, healthtechdigital, 17 Jul 2026]; valued $1.8B [C] |
| **WriteUpp** (UK) | From £19.95 per user [C] | Yes | Native Healthcode [C] |
| **splose / Nookal / Zanda / PPS** | £15–48 per practitioner [C/I] | Mostly yes [C] | splose has native Healthcode [C] |
| **Pabau** (UK) | Not re-confirmed [U] | Free scribe [C] | Aesthetics-leaning |
| **Semble** (UK) | [U] | Via Heidi and Tandem [C] | £30m Series C, Jun 2026 [C] |
| **Physitrack** | EMR from 28 Sep 2026 (US $41.99–59.99) [C] | Scribe [C] | Exercise-app vendor moving into PMS |
| **Healthcode** | – | – | Turning Epractice into a PMS [C, secondary]. Gatekeeper and competitor |
| **Heidi** | £45–65 per user [C, secondary] | **Forms:** PDF only, "from your session", "typically 80 to 90% accurate"; Word "coming soon" [C, Heidi help, 11 Jul 2026] | $340M raised Sep 2026 ($100M equity + $240M General Catalyst revenue-based fund) [C, TNW; MobiHealthNews]. Integrated in TM3 for notes and "insurer reports" [C]; Forms inside TM3 [I]. **Nearest threat to ClinForms** [I] |
| **Tandem** (SE) | [U] | Scribe | $100M Series B (Sep 2026) for an "AI-native Clinic Operating System" [C] |

**Dell's "no tool like this" [U].** We found no product that publicly completes RTF/Word provider templates from the whole course of treatment [U: absence of evidence]. But Heidi Forms fills PDF forms from a session [C], and Word is "coming soon" [C].

**Where we could win [I]:**
1. **Not as a generic TM3 clone.** Saturated, cheap, and funded players converge on "all-in-one + AI" [C, table].
2. **The referrer gap TM3 leaves.** TM3 records authorisations and handles Pronto-network referrals [C], but not Blue Heart's named MLC portals, per-referrer report deadlines and chasing, or completing the referrer's own form [I]. Value per form is unmeasured: HCML, Physio Med, 3D Rehab (Unity, with its own "automated report writing facility") and Speed Medical use portals [C memory]. **Measure Dell's form mix (Word/RTF vs portal, by provider and volume) in the proof of concept.**
3. **ClinForms' edge**, which no vendor publicly offers together: the referrer's own Word/RTF/PDF form in its layout; the whole course of treatment; a cited source per answer; gaps block approval until a clinician answers; batch work; per-clinic pricing [C repo; C Heidi help].
4. **It works on top of any PMS.** TM3 sells API and data-warehouse access on its Best tier [C]. Cliniko's API exposes patients, appointments and patient attachments at 200 requests a minute [C]; treatment notes [C, secondary].
5. **The window is time-limited.** Paying clinics fast matters more than breadth [I].

---

## 5. Build estimate

**Stated assumption:** the solo rows assume 12–15 spare hours a week go to the PMS. Those hours are already shared with Starwrit, Simbah Academy, PigeonPro (time-box to 30 Nov), DutyDesk and ClinForms selling and support [C git, C memory]. Years of a full-time job plus heavy side work is also a burnout risk [I].

- **Parity** = what Blue Heart actually uses in TM3 (usage audit [U]). **This is the number for Dell's question.**
- **MVP** = diary, notes, reminders and basic invoicing for one clinician's whole diary alongside TM3 – an **engineering milestone only**. A one-site pilot doesn't fit Blue Heart: 6–9 FTE clinicians rotate across 11 sites (most rented rooms) [I], so a site pilot splits each clinician's week across two diaries and risks double booking between systems. TM3's per-user licences keep running in full [C].

| Scenario | MVP (engineering milestone) | Parity (Blue Heart off TM3) | Cash cost |
|---|---|---|---|
| **Solo, 12–15 h a week** (1,320–2,080 h / 3,320–5,520 h) | est. 20–40 months [I] | **est. 4–9 years – not viable** [I] | §3b one-off and yearly costs + support cover £30–60k a year [I] |
| **Solo, 5–8 h a week** (realistic) | est. 3–8 years [I] | **est. 8–21 years** [I] | Same |
| Team: 2 senior devs + 1 QA/support – **no identified funder [U]** | est. 6–9 months from funding [I] | est. 12–20 months from funding [I] | est. £220–330k a year [I]. Blue Heart's turnover (est. £450–700k) can't fund it; investors would be backing a part-time solo founder against Jane, Semble, Tandem and Heidi [C/I] |

**Agents don't fix correctness.** The first TM3-style fit test gave a wrong approved form, and the engine changed a recorded prognosis from "I expect" to "I expected" [C, `memory/next-steps.md` TOP-b P2, P4]. In a diary, that kind of defect shows up at reception at 09:00 [I]. Migration rehearsals, Healthcode onboarding, receptionist testing, the parallel run and being on call don't get faster with agents [I].

**The revenue side [I]:**
- **All-in-one price at Blue Heart: est. £300–1,200 a month at steady state, £0 in year one.** A switching owner compares Cliniko for the whole group (~£150–225) + ClinForms ≈ £300–425, not his TM3 bill. During a parallel run he pays TM3 in full and will expect us to be free.
- **The extra over ClinForms alone: est. £150–900 a month (£2–11k a year).** Each year of that equals about **£0.40–3 per hour** of the 3,320–5,520 solo hours to parity, against **£84 an hour** at BofA (£630 ÷ 7.5 h).

**Architecture a PMS forces [C/I]:** Postgres in London, not D1 (10 GB cap, one query at a time, 30 s limit [C, Cloudflare]); no double booking enforced in the database (exclusion constraints [C, PostgreSQL]); real-time diary updates (Vercel WebSockets in beta, one instance [C]); a durable job queue; Stripe Connect; Vercel Pro; a Next.js upgrade (ClinForms is on 14.2 [C repo]).

---

## 6. Options compared

| | Option | Upside | Main risk | Cash in year 1 [I] | Fits BofA? | Verdict |
|---|---|---|---|---|---|---|
| **A** | **ClinForms for clinics on any PMS** (Blue Heart first) | Live product, biggest market, est. 85–95% gross margin, support can wait hours | Heidi or TM3 adds Word forms; getting notes out of each PMS | £3–8k, or £8–19k with a pen test first | **Good** | **Do now** |
| **E2** | **Existing PMS + ClinForms connector** – the answer to "one system" | Dell gets one system in weeks rather than years [I]; vendors migrate for free [C]; connector reusable (~1,900 UK Cliniko clinics, modelled [I]); no diary, Healthcode or migration liability for us | Depends on Dell wanting to move; vendor API limits | ~£0 until a paying clinic asks | **Excellent** | **Primary answer.** Build a connector only when a paying clinic on that PMS asks. Possible referral or co-marketing with a challenger PMS [U] |
| **E1** | **ClinForms launched from TM3** (integration, like Heidi) | Fixes Dell's "no typing twice" without leaving TM3 (API or data warehouse on Best [C]) | TM3 may refuse, charge or copy | £0–2k | **Excellent** | **Keep open – integration, never replacement.** Any PMS talk to a TM3 customer, who may repeat it at renewal, gives ClearCourse a reason to refuse this access |
| **D** | **Light co-funding** | Tests intent with money | Bespoke contracting; scope disputes | +£2–5k | OK | At most, paid help choosing a PMS (£2–5k) [I]. A 12-month prepay only as an optional discount – it cuts against "cancel any time", a known Blue Heart deal-breaker [C pricing] |
| **C** | **Staged wedge into our own PMS** | Each stage reversible | Stage 2 notes inside ClinForms = double entry or ClinForms becomes the clinical record (8-year retention, sign and lock) [C CSP]; stages 3–4 carry B's risk | Low until stage 3 | Stages 3–4 **poor** | **Not now.** Stage 2 shrunk (§7); stages 3–4 → Appendix |
| **B** | **Full PMS now** | Sticky | Everything in §1 and §3b | £10–20k solo over years, or a team at £220–330k a year | **Poor** | **No** |

### Recommendation
**A now. E2 as the answer to "one system". E1 kept open as integration. Light D only. No PMS build.**
1. Get ClinForms paid and live at Blue Heart; do the §3a items before real data.
2. Sell ClinForms to MLC-facing clinics on any PMS (activity gates in §7).
3. If Dell wants to leave TM3, point him to an existing PMS with UK insurer billing plus ClinForms. Offer at most paid help choosing one.
4. Keep every PMS ambition out of customer-facing writing.
5. A PMS of our own is reopened only under the Appendix conditions, after a written portfolio decision (what stops).

---

## 7. Roadmap with go/no-go gates

Internal only. **Never give dates to Dell.**

| Stage | What | Gate (all required) | No-go / stop |
|---|---|---|---|
| **0 – now to 30 Nov 2026: follow-up and proof of concept** | Answer the four §1 questions. Send the §8 email. Run the free proof of concept on 2–3 provider templates + one anonymised IA note. Measure his form mix (Word/RTF vs portal, by provider and volume). Do the §3a items and decide on the pen test. Send ≥80 targeted messages to MLC-panel clinics. Start a weekly selling-vs-building hours log in memory | **Gate 0:** drafts accepted by Dell and one of his physios; Dell says yes to the paid pilot on the stated terms; ≥80 sends by 30 Nov | He goes quiet, or says no to the pilot after good drafts |
| **1 – Dec 2026 to Mar 2027: paid ClinForms pilot at Blue Heart** | Founding Practice £149 a month, fixed for 12 months, up to 150 forms a month, monthly, cancel any time, + £250 set-up [C pricing D64]. Real data only after the DPA is signed and UK hosting is in place. Ask Dell for three introductions. Sell to MLC-panel clinics. Prove operations: alerts, status page, restore drill, retention cron and key check verified | **Gate 1 (31 Mar 2027):** Blue Heart has paid ≥60 days and uses real reports; ≥3 other paying clinics; ≥10 demos by 31 Jan; the hours log exists and shows selling ≥ building | A missed gate is a stop, not a re-date |
| **2 – after Gate 1, only if ≥10 paying clinics ask** | Read-only import of TM3 notes, plus an authorisation and report-due tracker that holds **no clinical record**. An E2 connector for a PMS only when a paying clinic on it asks | Paid for, and asked for by ≥10 paying ClinForms clinics | Requests below 10, or unpaid |

**Stop signals (any stage):** Dell won't start the paid pilot after good drafts; he asks for a free build or exclusivity; he won't move until full parity; building hours exceed selling hours two weeks running (from the log); an activity gate is missed.

**Weekly rule:** no new module without money or a signed commitment; selling hours at least match building hours [I].

---

## 8. What to say to Dell

### Reply email (draft – Khuram to edit and send)
Rules: no AI, model or vendor words; no dates; no promise of TM3 parity or a PMS; never suggest a TM3 partnership; don't ask about his TM3 price, terms or renewal (confidential under his contract, §2).

> **Subject:** Re: ClinForms – thank you, and next steps
>
> Hi Dell,
>
> Thank you for your time today. I'm glad the demo was useful.
>
> On your idea of one system for everything: I'd like to keep talking about it, but I'd rather earn that by getting the reports right at Blue Heart first. A system your whole team relies on every day has to be proven, and properly supported, before I'd ask you to move anything onto it.
>
> So for now I'd suggest three steps:
>
> 1. You send blank templates for two or three of your most common providers, plus one anonymised Initial Assessment note as TM3 prints or exports it.
> 2. I send back the completed drafts for you and one of your physios to check.
> 3. If you're happy with them, we start the paid pilot across all your sites once the data processing agreement is signed. As one of our first clinics, the price is £149 a month for all your sites and staff (up to 150 completed forms a month), fixed for 12 months, plus a one-off £250 set-up. It's paid monthly and you can cancel at any time. [VAT line – confirm before sending, e.g. "Prices exclude VAT."]
>
> For the anonymised note, please replace each of these with XXXX rather than deleting it, so I can see where it sits on the page:
> - names, including any mentioned in the notes themselves (patient, family, employer, GP, solicitor);
> - dates of birth, addresses and postcodes, phone numbers and email addresses;
> - NHS and hospital numbers, and claim and case references;
> - exact dates such as the accident and appointment dates (or move them by a few weeks).
>
> If it's easier, a made-up note written in the same style works just as well.
>
> If the drafts are right, would you be happy to start on that basis?
>
> And one question for when it suits you: when you mentioned one system, is the main thing not having to type the same information twice, or moving away from TM3 altogether? I'd also like to hear what frustrates you most about TM3 today.
>
> Kind regards,
>
> Khuram Masood
> AppstackX Ltd
> khuram@appstackx.co.uk
> https://appstackx.co.uk

Notes for Khuram:
- Answer the four §1 questions first. If price was already discussed, adjust step 3 to match what was said.
- Confirm the VAT wording before sending (`memory/context/pricing.md`).
- If you add a turnaround for the drafts, choose the number yourself.

### Questions for Dell (three only)
| # | Question | Why |
|---|---|---|
| 1 | "If the drafts are right, would you be happy to start the paid pilot on that basis?" | The cheapest test of the bigger idea |
| 2 | "Could you send two or three blank provider templates and one anonymised Initial Assessment note?" | Proof-of-concept material; then measure his form mix |
| 3 | "When you say one system, is the main thing not typing the same information twice, or leaving TM3 altogether?" | "Not typing twice" → a TM3 import or connector fixes it in weeks [I]. "Leaving TM3" → E2 |

Later, for the pilot paperwork only: which company signs and is invoiced; any NHS-funded work; whether he treats children.

**Don't:** promise dates, "everything TM3 does" or a PMS; ask for his TM3 invoice, pricing or contract terms; ask for TM3 logins, recordings or exports to copy TM3 (MSA cl. 3.2(b)); name our suppliers; mention other prospects.

---

## 9. Risks and how to reduce them

| # | Risk | Likelihood / impact [I] | How to reduce it |
|---|---|---|---|
| 1 | **Build trap.** The biggest build on offer, resting on one relayed sentence. 2026: ~£205 product revenue from ~25 repos [C memory] | High / High | No PMS build; gates in §7; written portfolio decision before reopening |
| 2 | **Dell's signal misread.** 6 Oct: "we are happy with this for now, so we are not currently looking to move" [C email]; the 23 Oct wording is ambiguous [U] | High / High | Ask Khuram for his words; ask Dell question 3; zero until money is attached |
| 3 | **Hours already spoken for** (Starwrit ~510 commits the week before the demo) [C git] | Certain / High | State the hours assumption; decide what stops |
| 4 | **No support in clinic hours** while Khuram is at BofA [C memory] | Certain / Critical for a diary | No diary; support cover est. £30–60k a year before any diary talk |
| 5 | **Key person and continuity.** A system of record with 8+ years of retention, run by a solo part-time founder [C memory] | High / High if a PMS | Escrow, guaranteed export, named successor or exit plan – expect it as a contract condition |
| 6 | **TM3 confidentiality.** Pricing and terms are confidential (MSA cl. 1.4(a), 10.1) [C] | Medium / Medium | Don't ask for his invoice or contract; ask only what he is free to share; suggest his solicitor |
| 7 | **TM3 contract misuse** (cl. 3.2(b)) [C] | Low if careful / High | Work only from public documentation |
| 8 | **C vs E1 conflict.** Replacement talk can cost ClinForms its TM3 data route [I] | Medium / High | Integration only; no PMS ambition in customer writing |
| 9 | **Heidi or TM3 closes ClinForms' gap** (Word "coming soon") [C] | Medium–high / High | Paying clinics fast; Word/RTF, whole course, citations, batch |
| 10 | **Compliance order in the pilot** | Medium / High | §3a items before real data; decide on the pen test |
| 11 | **One-shot TM3 exit** (access ends at extraction; Desktop cases CSV only; erase after 90 days) [C] | High / High if a PMS | Not ours to run under E2; the PMS vendor migrates |
| 12 | **Data leaving the UK** (US drafting provider; no Data Bridge certification found) [C/U] | Medium / Medium | IDTA or UK Addendum + TRA; tell Blue Heart so it can notify HCML |
| 13 | **Regulation drift.** MHRA lines (AVT guidance; ClinForms by analogy [I]); the Data (Use and Access) Act's health-IT information-standards power commenced 5 Feb 2026 [C, SI 2026/82], standards not set yet [C, secondary] | Low / High | Intended-purpose statement; human approval enforced; watch the standards |
| 14 | **Unclear contracting entity** (09158709 dormant) [C] | Medium / Medium | Confirm before the DPA or first invoice |
| 15 | **BofA outside-business rules** [I] | Low / Medium | Check the rules |

---

## Appendix – Conditions to reopen a PMS build (no dates)

Reopen only if **all** are true [I]:
1. A written portfolio decision says what stops to make room.
2. ≥£6k MRR from ≥25 paying ClinForms clinics.
3. Two multi-site owners have signed letters of intent with deposits big enough to fund support cover.
4. Dell has said in writing roughly when he could give TM3 notice.
5. ClinForms has run 3 months with paying clinics, with on-call alerts, a status page, a passed restore drill and no unhandled daytime Sev-1.
6. Support cover (first line + engineer on call) and build capacity are funded.
7. The Healthcode route is known (native, or a manual route signed off).
8. A continuity plan exists (escrow, export, successor).
9. An explicit opportunity-cost comparison beats contracting at ~£630–750 a day [C memory].

**If reopened:** pilot by clinician (one practitioner's whole diary), not by site, and say plainly it is still messy. Billing and Healthcode come last. Rehearse migration 2–3 times; parallel run est. 8–12 weeks; time cut-over to TM3's 90-day notice (cl. 8.1). Solo timing: MVP no earlier than mid-2028, parity around 2030 or later [I]. Contrast points for that conversation only: export at any time without losing access; no commercial use of anonymised client data (TM3 MSA cl. 11.3 allows it [C]); per-clinic pricing.

---

## Sources (checked 23 Oct 2026 unless stated)

**TM3**
- Pricing: https://tm3app.com/pricing/ · Connect for Insurance: https://tm3app.com/features/connect-for-insurance/ · Security: https://tm3app.com/features/security-and-compliance/
- MSA v5.3 (cl. 1.4, 1.19, 3.2(b), 6.7, 8.1, 9.2(d), 10.1–10.3, 11.3): https://tm3app.com/wordpress_tm3/wp-content/uploads/2025/11/MS-UK.pdf
- Help: merge fields http://help.tm3app.com/en/articles/4585166-full-list-of-merge-fields · authorisations http://help.tm3app.com/en/articles/4553166 · Pronto http://help.tm3app.com/en/articles/4560121 · Desktop templates http://help.tm3app.com/en/articles/4448652-how-to-replicate-your-old-desktop-templates-to-your-new-system · cancel and extract http://help.tm3app.com/en/articles/4585360-cancelling-the-subscription-and-extracting-your-data
- Ownership: https://businesscloud.co.uk/news/pe-backed-clearcourse-snaps-up-healthcare-expert/ · https://www.irishnews.com/business/2022/09/09/news/clearcourse_acquires_belfast_healthcare_software_provider_blue_zinc-2821986/
- Barometer: https://hmdg.co.uk/private-practice-barometer/ai-software-tools-physiotherapy-clinics-uk-2026/
- Migration out: https://help.cliniko.com/en/articles/4365780-transfer-data-from-tm3-to-cliniko · https://jane.app/guide/importing-to-jane/importing-to-jane-from-tm2-tm3

**Market**
- HCPC: https://www.hcpc-uk.org/data/the-register/register-summary · CSP: https://csp.org.uk/node/1341798
- Cliniko: https://www.cliniko.com/pricing/ · API https://docs.api.cliniko.com/ · attachments https://docs.api.cliniko.com/guides/uploading_patient_attachments · Effra https://www.cliniko.com/connected-apps/effra/
- Jane: https://jane.app/pricing · https://healthtechdigital.com/jane-app-launches-secure-ai-scribe-for-uk-private-healthcare-giving-clinicians-time-back/ · https://thelogic.co/briefing/jane-software-valued-at-1-8b-as-it-finalizes-500m-raise-report/
- WriteUpp: https://www.writeupp.com/pricing · Zanda: https://zandahealth.com/uk/pricing/ · Nookal: https://www.nookal.com/uk/pricing · splose: https://splose.com/uk/pricing · Pabau: https://pabau.com/pricing/
- Heidi Forms: https://support.heidihealth.com/en/articles/11668834-form-filling · Heidi in TM3: https://www.heidihealth.com/en-gb/integrations/tm3 · funding: https://thenextweb.com/news/heidi-340m-series-c-900m-valuation · https://www.mobihealthnews.com/news/heidi-health-garnered-340m-reaches-900m-valuation
- Tandem: https://letsdatascience.com/news/tandem-health-raises-100m-for-clinic-software-c98dcadd · Semble: https://www.techmarketview.com/ukhotviews/archive/2026/06/04/semble-secures-30m-series-c-to-scale-private-healthcare-platform · Physitrack: https://www.inderes.dk/releases/physitrack-sets-out-commercial-model-for-its-emr-as-more-than-100-clinics-sign-up-for-early-access-in-five-days · Healthcode Epractice: https://healthcareandprotection.com/healthcode-to-integrate-epractice-with-nhs-systems/

**Compliance, billing, operations**
- ICO Art 28: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/contracts-and-liabilities-between-controllers-and-processors-multi/what-needs-to-be-included-in-the-contract/ · fee: https://www.lewissilkin.com/insights/2025/02/06/fee-payable-to-the-ico-to-increase-in-february-102jzb9
- Advanced fine: https://www.techmonitor.ai/technology/cybersecurity/uk-ico-fines-advanced-computer-3-07m-after-nhs-data-breach
- CSP record keeping: https://www.csp.org.uk/professional-clinical/professional-guidance/record-keeping-guidance
- MHRA (29 Jul 2026): https://www.gov.uk/government/news/mhra-clarifies-regulatory-status-of-ambient-voice-technologies-used-in-the-nhs · DCB0129: https://digital.nhs.uk/services/clinical-safety/applicability-of-dcb-0129-and-dcb-0160/step-by-step-guidance
- DUAA commencement (SI 2026/82): https://www.legislation.gov.uk/uksi/2026/82/made
- Cyber Essentials: https://iasme.co.uk/cyber-essentials/faq-cyber-essentials · CE Plus: https://forensiccontrol.com/guides/how-much-does-cyber-essentials-plus-cost/ · pen test: https://kolonell.com/en/blog/web-application-penetration-test-pricing-london-2026
- Bupa physio terms: https://www.bupa.co.uk/~/media/Files/HCP/physio/physio-contract.pdf · HCML: https://hcml.co.uk/hcml-supplier-terms-and-conditions/ · WPA: https://www.wpa.org.uk/healthcare-providers
- Healthcode: https://www.healthcode.co.uk/software-developers/ · WriteUpp guide: https://knowledge.writeupp.com/en/en/article/guide-to-setting-up-healthcode-integration-1ldf1p8/ · splose guide: https://support.splose.com/en/articles/13682034-set-up-your-healthcode-integration · Pabau fees note: https://support.pabau.com/en/pabau2/insurance-pricing-uk · CCSD: https://ccsd.org.uk/?p=39442
- Stripe UK: https://stripe.com/gb/pricing · Twilio UK SMS: https://www.twilio.com/en-us/sms/pricing/gb · NCSC backups: https://www.ncsc.gov.uk/blog-post/offline-backups-in-an-online-world

**Build**
- D1 limits: https://developers.cloudflare.com/d1/platform/limits/ · Supabase backups: https://supabase.com/docs/guides/platform/backups · Vercel: https://vercel.com/pricing · https://vercel.com/guides/do-vercel-serverless-functions-support-websocket-connections · PostgreSQL: https://www.postgresql.org/docs/current/rangetypes.html#RANGETYPES-CONSTRAINT

**Internal (read, not changed):** this repo's `CLAUDE.md`, `memory/projects/blue-heart-clinics.md`, `memory/people/dell-baines.md`, `memory/context/pricing.md`, `memory/next-steps.md`; other repos `hospital-system`, `careconnect-mk`, `dutydesk`, `invoiceflow`, `pigeon-web`, and `git log` across the Appstackx repos; auto-memory `khuram-day-contract.md`, `next-venture-research-oct-2026.md`, `pigeonpro-traction-sep-2026.md`.
