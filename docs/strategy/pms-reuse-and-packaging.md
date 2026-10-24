# Clinic system: reuse, architecture and packaging (decision note, reviewed)

**Internal, not for customers.** Sat 24 Oct 2026. For Khuram.
This is the writer's note (`pms2/writer.md`) after an adversarial review. Every repo claim was re-opened, and every market price was re-fetched. The review log is at the end.
Based on the reuse audit (`pms2/reuse.md`), the packaging note (`pms2/packaging.md`), the 23 Oct build note (`scratchpad/pms/build.md`), `docs/strategy/all-in-one-pms-feasibility.md` and `memory/context/pricing.md`. Nothing was built, changed or sent.

Tags:
- **[C]** confirmed, with a source.
- **[I]** inference or estimate.
- **[U]** unknown.

Prices exclude VAT (AppstackX Ltd's VAT status is [U]). Physio clinics usually can't reclaim VAT, so their real cost is ×1.2 [I]. A "dev-week" is 40 hours of Khuram's own attention, and already assumes agents make him 2–3× faster [C feasibility §2].

**Where we are.** On 23 Oct you decided to build the TM3 replacement alongside onboarding Blue Heart on ClinForms [C, feasibility Addendum]. D68 in `memory/decisions.md` still says "no PMS build" (PROPOSED) [C]. This note takes your decision as given and adds guard rails.

---

## The recommendation

**Build the TM3 replacement inside the ClinForms codebase as its own module. Sell it as a separate package. Keep the public ClinForms brand for reports only.**
- One repo, one deployment and one London Postgres database.
- One sign-in and one patient record per clinic.
- Three packages on one subscription:
  - **Reports**: ClinForms as it is today.
  - **Clinic system**: the TM3 replacement.
  - **All-in-one**: both, at 15% off.
- **Blue Heart:**
  - Reports at £299 a month now.
  - The Clinic-system part then ramps up at £29 for each practitioner whose whole diary runs on it.
  - The all-in-one total is capped at **£599 a month**, Dell's own "£300 + £300".

This is your third option (one roof, two packages, more for both), with two changes:
1. Never put "TM3" in a package name.
2. Don't market a practice system under the ClinForms name until a gate.

**careconnect adds almost nothing.** Everything that already works for the TM3 replacement is in ClinForms itself. That reuse is **already counted** in the feasibility estimate, so the MVP is still est. **32–52 dev-weeks**. That is roughly **1–3½ years of evenings and weekends** [I, §4].

---

## 1. careconnect: reuse verdict

**Verdict: don't build on it. It saves about 0.5–2 dev-days, none of them on the first-build path [I].**

Checked again on 24 Oct [C]:
- `careconnect-mk` `main` is at `66fac86` (4 commits). It is a patient-portal mock for a GP surgery, with about 6.1k lines in `src/`.
- No `src/app/api`, no database, no tests.
- The login is `setTimeout(() => router.push("/dashboard"), 800)`, and the data lives in sessionStorage (`src/lib/data-context.tsx`).
- `next.config.mjs` allows `images.remotePatterns` with `hostname: "**"`.
- Its UI kit is already in ClinForms: avatar, badge, card, dialog, input, separator, skeleton, tabs and tooltip are byte-identical. Button differs by 4 lines, and `lib/utils.ts` is identical (`cmp`).
- The branch `claude/confident-noether-z6l7kr` is 15 ahead of `main` and 0 behind. All **303** `src/` files it adds exist at the same paths on ClinForms `main` (GitHub tree listing compared with `git ls-tree`). Nothing is left to recover.

Its "done" features (booking wizard, messages, prescriptions, records, profile) are all patient-facing mock-ups. Only the booking wizard, the reschedule dialog and the messages layout are worth a look, and only for the **later** online-booking and portal module.

Don't reuse the name either. "CareConnect" is crowded in UK health [C]:
- Access Care Connect (The Access Group).
- Tailor Made Technologies' CareConnect telephony, on an NHS framework.
- NHS England's CareConnect FHIR API.

**Where the TM3-replacement features actually come from.** The reuse figures are the build note's estimates [I]. The paths were all opened on 24 Oct [C].

| Module | Best source (verified) | Reuse [I] | What to take | Still to build |
|---|---|---|---|---|
| Sign-in, roles, two-step sign-in (TOTP), audit | ClinForms `src/server/auth/*` (roles, TOTP, invites), `src/server/repos/audit.ts` (live) | 60–70% | All of it | Access limited by site; diary rights for reception vs practitioners |
| Letters with mail-merge | ClinForms `core/merge-fields.ts`, `core/rtf/`, `forms/` | 60–80% | The whole engine | Merge fields for appointments and invoices |
| Complete the MLC/insurer's own form | ClinForms (live) | Done | – | The native connector (§2) |
| Patient record | ClinForms `PatientRegistrationSchema`, `ReferralSchema`, `ConsentSchema` (`core/schemas.ts`); sandbox `patient-list.tsx`, `record-tabs.tsx` | 20–30% | Field sets, search, layout (as generic components, with no TM3 look) | Relational tables per clinic; authorisations (sessions, value, expiry); insurer and MLC accounts; merging duplicates |
| Clinical notes | ClinForms `NoteSchema` (SOAP), `crypto/envelope.ts` (HKDF key per tenant, AAD bound to the row), audit, `outcomes-tab.tsx`, notes import (`connectors/file-import`, ~5.0k lines) | 15–25% | Encryption per field, outcome measures, read-only note display, notes parsers | Note editor, templates, body chart, sign and lock, amendments |
| Platform | ClinForms `db/dialects/postgres.ts` + `supabase/migrations/`; DutyDesk Sentry and Inngest | 25–40% | Migrations, monitoring | Supabase London live; separate app database role; maintenance mode; staging; Next.js upgrade |
| Reminders | ClinForms `server/email/*`; DutyDesk `lib/inngest/functions/vulnerable-review-reminders.ts` | 15–25% | Provider abstraction, job pattern | SMS provider, two-way confirm and cancel, PECR opt-out |
| Diary | ClinForms `AppointmentStatusSchema` (ATT/DNA/LCN/CNC/BOOKED) and `charge`; DutyDesk `components/ui/calendar.tsx`, `lib/dates.ts` (Europe/London) | ~5% | Status rules, pickers | Sites, rooms, rotas, slot engine, recurring bookings, no double booking, day view by practitioner and room |
| Online booking and portal (later) | careconnect booking wizard and reschedule dialog; hospital-system `app/actions/booking.ts` (3 requests per phone a day; Turnstile, which stays pass-through until keys are set) | 10–20% | UI patterns only | Real availability, patient sign-in, notifications |
| Invoicing, Healthcode | None (`@react-pdf/renderer` 4.9.0 is already a dependency) | 0–5% | PDF rendering | Everything |
| TM3 data migration | ClinForms notes parsers and the staff check before import | 10–20% of notes, 0% of the rest | Parsers, review flow | CSV mapping for demographics, appointments and finance |
| **Overall** | ClinForms ≫ DutyDesk > hospital-system > careconnect | **Already counted in the 33–52 dev-week MVP.** By the build note's per-module rates it saves est. 10–25 dev-weeks against starting from scratch, mostly letters, sign-in and the platform. Against full TM3 parity it is ~10–15% [I build note] | | The diary, invoicing, Healthcode and migration are about 70% of the work, and all new |

**Don't reuse:**
- From careconnect:
  - the fake login;
  - clinical data kept in sessionStorage;
  - NHS/GP wording and fields;
  - the invented stats and testimonials, and the "NHS Compliant" badge;
  - the "Share data with NHS" switch that defaults to ON (the ICO says pre-ticked boxes don't count as consent [C]);
  - `images.remotePatterns: "**"`.
- From ClinForms: storing each episode as one encrypted JSON blob. Diary rows must be indexable.
- From hospital-system: access rules built for a single tenant (no tenant column).
- From DutyDesk and PigeonPro: their Stripe accounts. Take the code only.

---

## 2. Architecture: one codebase

**Decision: one codebase, the `clinforms` repo.**
- A new module `src/modules/pms` beside `src/modules/medreport`, switched on per clinic by an entitlement.
- Its data repositories live in host code (`src/server/repos/pms/*`), following the same rules as today's repositories.
- No new repo and no second app.

| | **One codebase, two modules (recommended)** | Separate product with an integration |
|---|---|---|
| Sign-in, two-step sign-in, roles, tenants, encryption, audit, retention | Built once; already live [C] | Built twice |
| Patient record | One per clinic | Two copies kept in sync; two answers to every subject-access request |
| DPA, DPIA, sub-processor list, pen-test scope, legal pages | One set, with two annexes | Two sets |
| Billing | One subscription with two items; the bundle discount is automatic | Two contracts; a cross-product discount is awkward |
| Deploys, monitoring, on-call | One (but a Reports release can break the diary; see below) | Two |
| If the Clinic system is stopped | Switch the entitlement off. ClinForms is unaffected | Clean |
| Fit for a solo founder working part-time | Good | Poor |

**Why:**
1. The expensive, risky parts are already live and shared: auth, encryption, audit, retention, the admin pages.
2. One patient record gives bundle clinics "no typing twice" without any sync.
3. The Clinic system can be stopped without touching ClinForms.

**What makes it work** (corrected in review to fit the code as it is):
- **A hard module boundary that the code can actually honour.**
  - `medreport` may not import `src/server`, `src/app` or the sandbox. It receives what it needs through `MedreportDeps` / `HostHooks`. Concrete connectors are wired in the app glue (`src/app/api/_medreport-glue.ts:252`: `createConnectorRegistry(createDefaultConnectors())`) [C `scripts/medreport/gen-eslint-boundary.mjs`].
  - So the native connector can't live in `medreport/connectors/native`: it would have to import `pms` repositories.
  - Instead, add a host-side factory, `createNativeConnector()` in `src/server/pms/`. It implements medreport's exported `ClinicSystemConnector` type and is registered in the glue next to the existing connectors.
  - The only change inside medreport is an additive id: `ConnectorIdSchema` today is `["tm3-sim", "tm3", "file-import"]` [C `core/schemas.ts:55`], and `native` is added to it. No migration stores connector ids [C, grep of both migration sets].
  - The native connector must implement all four methods. Today only `getEpisodeBundle` is required; `searchPatients`, `listEpisodes` and `attachDocument` are optional [C `connectors/types.ts:76–79`].
- **Extend the boundary generator.** It is hard-wired to medreport (`const M = "src/modules/medreport"`) [C]. It needs a `pms` rule set:
  - `pms` may import only medreport's public connector types;
  - `medreport` never imports `pms`.
  - Regenerate with `npm run medreport:eslint-boundary`, never by hand [C CLAUDE.md].
- **Tenant isolation is enforced in the app today.**
  - Every repository puts `tenant_id` in every WHERE clause and every primary key [C `repos/context.ts`].
  - Supabase RLS is enabled with no policies, which only shuts the Data API out [C `supabase/migrations/20261010000001_init.sql`].
  - A PMS adds many tables, so add two cheap database-level guards:
    - composite `(tenant_id, id)` keys, with foreign keys that include `tenant_id`, so a row can never point at another clinic's patient;
    - a repository test that fails if any `pms` query omits `tenant_id` [I].
- **Integration parity.** Whatever the native connector does, another PMS can do through `/api/reports/v1`. Then "ClinForms works with any PMS" stays true [I].
- **Sub-processor scope.**
  - A Clinic-system-only clinic has no `reports` entitlement, so the drafting path can't be reached and its data never goes to the drafting sub-processor [I].
  - The DPA's sub-processor list is kept per annex.
- **One deployment means shared downtime.**
  - Deploy outside clinic hours (about 07:30–20:00 weekdays plus Saturdays [I feasibility]).
  - Use staging and the full check chain for every merge to `main`.
- **Diary refresh across receptionists.** Use polling every few seconds or Supabase Realtime. Vercel functions don't hold WebSockets well (beta, one instance [C feasibility §5]).
- **Two steps before any diary code:**
  - **Supabase Postgres in London goes live.**
    - The Blue Heart reports pilot needs this anyway ("Real data only after the DPA is signed and UK hosting is in place" [C feasibility §7]).
    - D1 is also capped at 10 GB and "processes queries one at a time" [C Cloudflare].
    - *Corrected in review:* D1 *can* block double booking, with a `BEFORE INSERT` trigger that calls `RAISE(ABORT, …)` [C sqlite.org]. ClinForms already runs triggers on D1.
    - In Postgres, with concurrent transactions, use declarative exclusion constraints:
      - one constraint for the room and one for the practitioner, e.g. `EXCLUDE USING gist (tenant_id WITH =, room_id WITH =, during WITH &&) WHERE (status <> 'CNC')`;
      - these need the `btree_gist` extension [C postgresql.org].
  - **Upgrade Next.js from 14 to 16.**
    - 14.x is "Unsupported" [C].
    - 15.x is still listed as Maintenance LTS, but "two years following the initial release" (21 Oct 2024) puts its end at about now [I from C].
    - 16.x is Active LTS [C]. Go straight to 16, which also means React 18 → 19.
    - Do it on its own branch. It is an easy pen-test finding before real data [I], but it must not hold up Blue Heart's template work on fictional data.

**Patient record: rules**
- **Owned by `pms`.**
  - Reports-only clinics never get one. They keep uploading notes, and their working copies keep the short retention.
  - Bundle clinics give ClinForms a direct read through the connector. ClinForms stores no copy of the notes: only the approved form and its receipt, filed to the record [I].
- **Data layout.**
  - Diary data (times, practitioner, room, site, status) goes in plain, indexed columns.
  - Clinical text uses the existing per-clinic AES-GCM envelope [C `crypto/envelope.ts`].
- **Open design question [U]: demographics.** Name, date of birth and phone could sit in plain columns, behind tenant keys and database encryption at rest. Or they could be encrypted, with a blind index for search.
  - Suggested default: plain columns, because the diary shows names all day anyway.
  - Record it in the DPIA, because it differs from ClinForms' "patient payloads encrypted" stance [I].
- **Retention per record type.**
  - Today `retention_days` is one number per clinic, default 365 [C `repos/clinic-profile.ts:86`].
  - Clinical records need 8 years for adults, and longer for children [C CSP, via feasibility].
  - Records also need a legal hold.
- **Audit.** Every write goes to the existing append-only audit log [C].

**Entitlements**
- **Tables:**
  - `clinic_entitlements`: tenant, package (`reports` or `pms`), plan code, limits, status (trial, active, paused or cancelled), price source (list, founding or design partner), dates.
  - Monthly `usage_counters`: forms completed, practitioners live, SMS segments.
- **Enforcement:**
  - A `requireEntitlement()` check in every server handler of each module.
  - Navigation built from entitlements.
  - Switching `pms` off hides and blocks it without touching Reports.

---

## 3. Brand and packaging

**Decision: one product account, three packages. ClinForms stays the public brand for reports.**

| Question | Decision | Why |
|---|---|---|
| Is everything called ClinForms? | **In the app, yes.** There is one sign-in at clinforms.co.uk/app. Clinic-system screens appear only for clinics with the entitlement, labelled by what they do ("Diary", "Patients", "Invoices"). **In public, no.** The site, outreach and demos stay about forms | Practice-software buyers read "forms" as intake forms. A PMS called ClinForms tells every clinic on TM3, Cliniko or WriteUpp, and TM3 itself, that ClinForms is a TM3 rival. That puts ClinForms' best route into TM3 clinics at risk: TM3 sells API and data-warehouse access as add-ons on its Best tier [C tm3app.com/pricing; I] |
| Package name | **"Clinic system"** as a placeholder on contracts and invoices; `pms` in code. Choose a real name at a gate (e.g. the first clinician live for 4+ weeks), after UK IPO, Companies House and domain checks. Never "TM3 killer" in anything written | "TM3" is TM3's mark, and our hard rule bans implying a TM3 link [C CLAUDE.md]. Not "Practice": that is already the £199 reports plan [C D64]. Not "CareConnect" (§1) |
| Who it is sold to | Only ClinForms clinics that want to leave their PMS, Blue Heart first. No outbound PMS marketing before a gate | Keeps Reports sellable to clinics on any PMS |

### Price table

| Package | What it includes | Meter and list price | **Blue Heart** |
|---|---|---|---|
| **Reports** (ClinForms) | Completes MLC/insurer forms from notes, with review and approval. All sites and users | Per clinic, by completed forms a month: Starter £99 (25), Practice £199 (100) [C D64]. Group "from £349" for 100+ [C D64]; a **250 cap is proposed** [I]. **Group Plus £549 (500): proposed, not in D64** [I]. Set-up £250 [C] | **£299 a month for up to 500 forms, plus £250 set-up** covering the 19 templates already sent (9 providers) [C Addendum]. Design-partner price: fixed for 12 months, monthly, cancel any time, terms confidential. Starts now on fictional data; real patient data only after the DPA is signed and London hosting is live |
| **Clinic system** | Multi-site diary and rooms, patient record, notes, letters, email reminders, basic invoicing, fixed reports and CSV. SMS 7p per segment | **£29 per bookable practitioner a month**, counted automatically (anyone with at least one appointment that month). Admin and reception users free; all sites included [I] | Not sold to Blue Heart on its own. List for his size: £290–377 (10–13 clinical staff [I memory]) |
| **All-in-one** | Both packages. ClinForms reads the patient record directly, so nothing is uploaded | Reports tier plus Clinic system, **15% off the total**. The bundle is **never less than the Reports tier's list price** | **£299 + £29 per practitioner whose whole diary is on the Clinic system, capped at £599 a month.** The cap is fixed for 12 months from the first clinician going live. £0 for the Clinic system before that (list for his size: £713–787) |

**Why these meters:**
- The market charges per practitioner or per user [C, re-fetched 24 Oct]:
  - TM3: £39, £55 or £70 per user a month.
  - Cliniko: practitioner bands in USD ($195 for 9–12, $295 for 13–25), with unlimited admin users and locations.
  - WriteUpp: Flex from £19.95 per user.
  - Jane, Zanda, Nookal and splose also charge per practitioner or per user [C, packaging research].
- Charging per site would punish Blue Heart's 11 mostly rented rooms [I].
- Reports keeps its per-clinic volume meter, because its cost and value grow with forms, not with staff [I].

**Why 15%, with a floor:**
- Bundle discounts in this market are small. WriteUpp's Solo + AI Scribe is £49.95, against £51.90 bought separately (3.8%) [C].
- At 15%, the bundle is the obvious choice for a customer who wants both.
- *Added in review:* without a floor, a one-practitioner clinic on Practice would pay less for the bundle than for Reports alone (£199 + £29 = £228 × 0.85 = £194). The floor stops that.

**Why the ramp for Blue Heart** (changed in review):
- During a parallel run, Dell pays TM3 in full and "will expect us to be free" [C feasibility §5].
- The writer's draft charged the full extra £300 from the day the first clinician goes live. That asks £300 for one diary.
- Charging £29 per practitioner live uses the same meter. It reaches the £599 cap at about 11 practitioners [I].

**Sanity checks:**
- **Against Dell's alternative.** ClinForms (£299) plus Cliniko for his size (about £150–225 [C bands; I FX]) is about **£449–524**, below £599.
  - So the £599 rests on Dell's own offer and on "one system", not on market price.
  - Never present it as a saving.
- **Profit.**
  - £299 for 500 forms leaves about £205–230 a month [C Addendum calculation].
  - A diary-grade platform costs est. £250–450 a month, including SMS and monitoring [I, feasibility §3b row 7]. It is shared across clinics, but at one clinic it eats most of the extra £300.
  - Support cover (est. £30–60k a year) needs about 9–17 Clinic-system clinics at ~£300 [I].

**Blue Heart cash:**
- Year 1: £299 × 12 + £250 = **£3,838** [C arithmetic].
- At est. 14–40 months to an MVP (§4), the Clinic system most likely earns **£0 in year 1** [I].
- First full year after the cap is reached: £599 × 12 = £7,188 [I].
- Dell's "~£300 more" [C Addendum] is about the list price of the Clinic system for 10 practitioners. Most of his discount is on Reports (£299 against £549 list).

**What may go in a quote or email to Dell.** Only:
- the package names above;
- the prices;
- "fixed for 12 months, monthly, cancel any time";
- the trigger "from the day a clinician's whole diary runs on it".

Don't include:
- dates;
- roadmap items ("insurer e-billing later", "two-way SMS", "forms filed back to the record" before they exist);
- parity promises;
- AI, model or supplier names (Supabase, Vercel, MailerSend, Healthcode integration plans) [C CLAUDE.md hard rule; feasibility §8].

**Stripe.**
- CLAUDE.md requires one Stripe account per product [C], and no ClinForms account exists yet [C pricing.md].
- **Recommendation:** one "ClinForms" account carries both packages, as one customer with one subscription and two items, because this is one product with packages.
- Patient card payments later need Stripe Connect [C feasibility §3b row 10]. Whether that runs on the same account is your call too.

---

## 4. What this means for the build plan

**ClinForms work for Blue Heart (templates, DPA, the feasibility report's §3a items) always comes first in the week.** It is the only revenue.

| Step | What | Est. dev-weeks [I] | Why in this order |
|---|---|---|---|
| 0 | **Reports onboarding:** Dell's 19 templates mapped on fictional data; DPA and DPIA; §3a items; Vercel Pro; ClinForms Stripe account | Outside this total | Revenue first |
| 1 | **Platform:** Supabase Postgres London live (PITR, offline backup, separate app database role, maintenance mode for the move), staging | 3–5 | Blocks the reports pilot's real data and the diary |
| 1b | **Next 14 → 16** (React 19) on its own branch | 0.5–1.5 (not in the feasibility figure) | Security; diary code shouldn't start on an unsupported framework |
| 2 | **Scaffolding:** entitlements, the `pms` boundary in the generator, the host-side native-connector factory, the `native` id, retention per record type | 1.5–2.5 (2–4 with Stripe billing) | Lets you sell packages and stop cleanly |
| 3 | **Shared patient record** (owned by `pms`, composite tenant keys): patients; cases with a payer (self-pay, insurer or MLC); authorisations; consent; search | Inside the notes estimate | Everything else hangs off it |
| 4 | **Diary:** sites, rooms, rotas across sites, appointment types, recurring bookings, statuses, DNA fees, exclusion constraints for room and practitioner, a day view by practitioner and room, refresh across receptionists | 6–9 | The core of "replace TM3". react-big-calendar 1.20.0 is MIT, supports React 18/19 and has a `resources` prop [C npm]. FullCalendar's resource views are Premium, "Starting at $480" [C] |
| 5 | **Clinical notes:** SOAP writing with templates, sign and lock, visible amendments, attachments | 5–7 | Needed to switch |
| 6 | **Native connector + letters:** "Complete form" from a case; the approved form filed to the record; letter merge fields | 1.5–3 | The reason to buy the bundle |
| 7 | **Email reminders**, then SMS (two-way) | 1.5–2.5 | Needed to switch |
| 8 | **Basic invoicing:** self-pay, insurer/MLC on account, PDF, credit notes. Apply to Healthcode early; integrate last | 3–5, plus a Healthcode lead time of 2–6 months [I/U] | Billing errors are costly; the manual route first |
| 9 | **The rest of the MVP:** roles by site, card payments, fixed reports, admin and support tools, compliance, QA, training, cut-over | 9–14.5 [C feasibility module table] | Needed before anyone relies on it |
| 10 | **TM3 data migration** at cut-over, rehearsed 2–3 times on a **paid trial extract** (TM3 access ends as soon as the full extraction starts [C feasibility §3b row 6]) | 1–2 (+4–8 to parity) | One shot: after termination, TM3 makes the data available for migration (MSA cl. 9.2(d)) and may erase it 90 days after the effective date of termination (cl. 9.2(e)) [C] |
| Later | Online booking, patient portal (careconnect UI patterns), waiting lists, classes, stock | – | Blue Heart books by phone or contact form [C feasibility] |

**Honest total (corrected in review):**
- **MVP: est. 32–52 dev-weeks** [I]. That is the feasibility MVP of 33–52, minus online booking and portal (2.5–4), plus scaffolding and the Next upgrade (2–4).
- **The reuse is already inside those figures.** The build note gives each module's effort next to its reuse rate: sign-in is "live", for example, yet still costs 1–1.5 weeks [C build note §3–4]. Don't subtract it again.
- If agent speed holds on the screen-heavy modules: est. 22–36 [I, build note §4: 23–36].
- **Calendar at 12–15 h a week:**
  - about **14–40 months** [I];
  - longer at a realistic 5–8 h.
- The calendar is set by things code can't speed up: Healthcode lead time, migration rehearsals, the parallel run, support cover and compliance [I, feasibility Addendum].
- **Pilot by clinician** (one practitioner's whole diary), not by site. A site pilot splits each clinician's week across two diaries [I feasibility §5].

**Gates (keep the build a time-boxed experiment)**

| Gate | All required | If missed |
|---|---|---|
| **G0: before diary code** | Blue Heart reports pilot on real data (DPA signed, London Postgres live); Next.js upgraded | No PMS work until done |
| **G1: before the build goes past an MVP** | Dell signs a letter of intent for the £599 cap and the ramp, saying roughly when he could give TM3 notice (90 days before a term ends, MSA cl. 8.1(i) [C]) | Pause the Clinic system |
| **G2: before cut-over** | Support cover in clinic hours arranged; restore drill passed; migration rehearsed at least twice | No cut-over |
| **Every week** | Selling hours at least match building hours; ClinForms work never waits for Clinic-system work | Two weeks over means stop and review |

---

## 5. Risks

| # | Risk | Likelihood / impact [I] | What reduces it |
|---|---|---|---|
| 1 | **Time.** The MVP is est. 32–52 dev-weeks (14–40 months) of evenings and weekends beside a full-time BofA contract [C memory]. 2026 product revenue so far is about £205 across ~25 repos [C memory] | High / High | Gates G0–G2; ClinForms first every week |
| 2 | **No support in clinic hours.** A diary fault at 09:00 while you are at BofA. Proper cover costs est. £30–60k a year, which needs about 9–17 Clinic-system clinics | Certain / Critical | No cut-over without cover (G2); pilot one clinician |
| 3 | **Dell's signal.** The "~£300 more" isn't in writing. On 6 Oct he wrote "we are happy with this for now, so we are not currently looking to move" [C] | High / High | Letter of intent at G1. No dates and no promise of full TM3 parity to Dell |
| 4 | **ClinForms seen as a TM3 rival.** This could cost the TM3 data route and sales to clinics on other PMSs | Medium / High | Public brand stays reports-only; never mention the Clinic system to TM3-using prospects; integration parity |
| 5 | **TM3 contract.** The client may not use TM3 "to build a product or service which competes" (MSA cl. 3.2(b)) [C] | Low if careful / High | Design from public documentation and Dell's stated needs, never from TM3 screens, logins or exports. Ask a solicitor how the migration extract may be used |
| 6 | **Being a system of record.** 8-year retention, sign and lock, and likely contract conditions: escrow, guaranteed export, a continuity plan [C feasibility §3b] | High / High | Retention per record type; DPA Annex B; a continuity plan before cut-over |
| 7 | **Shared deployment.** A Reports release breaks the diary, or the reverse | Medium / High | Staging, the full check chain, deploys outside clinic hours |
| 8 | **Cross-clinic data leak** in new PMS tables (isolation is in the app only) | Low / Critical | Composite tenant keys and FKs; a repository test; a pen test before cut-over |
| 9 | **Prerequisites slip** (London Postgres, Next 16) | Medium / High | Do them first; they also unblock the reports pilot |
| 10 | **Double booking during the parallel run** | High if piloted by site | Pilot by clinician (one whole diary) |
| 11 | **Insurer billing.** The Healthcode agreement takes 2–6 months [I/U]. AXA and Vitality push Healthcode [C, feasibility] | High / Medium | Apply early; a manual route for the MVP; integrate billing last |
| 12 | **Heidi or TM3 closes ClinForms' gap.** Heidi Forms: "Currently … PDF files only"; Word is "coming soon" [C, re-fetched 24 Oct] | Medium / High | Paying ClinForms clinics fast. Another reason Reports comes first |
| 13 | **Naming and the Stripe rule.** "Practice" clashes with an existing plan; the rule is one Stripe account per product | Low / Low | "Clinic system" placeholder; your decision on Stripe (§3) |

### Decisions for you
1. One codebase: a `pms` module, host-side repositories, entitlements, and no new repo. **Yes or no.**
2. The public brand rule: ClinForms means reports; the Clinic system stays unnamed until a gate.
3. Prices:
   - Group 250 cap and Group Plus £549 for 500 (both new);
   - £29 per bookable practitioner;
   - a 15% bundle discount, never below the Reports list.
4. Blue Heart:
   - £299 now;
   - then £29 per live practitioner, capped at £599 and fixed for 12 months;
   - a letter of intent at G1;
   - what Dell gives in return: a case study, three introductions, design sessions.
5. Stripe: one ClinForms account for both packages, and later Connect.
6. Record your 23 Oct build decision as D69 in `memory/decisions.md`, with these gates. D68 still says "no PMS build".
7. AppstackX Ltd's VAT status (affects every quote).

---

## Sources
Checked 24 Oct 2026 unless stated.

**Re-fetched in review:**
- TM3 pricing (Good £39, Better £55, Best £70 "per user per month"; Connect for Insurance £10 per licence; API and data warehousing on Best without a price; Heidi in Better): https://tm3app.com/pricing/
- Cliniko (USD bands: $45, $95, $145, $195 for 9–12, $295 for 13–25, $395; unlimited admin users, locations and patients; SMS 10¢): https://www.cliniko.com/pricing/
- WriteUpp (Flex from £19.95 per user; Solo £27.95; Solo + AI Scribe £49.95; AI Medical Scribe £23.95 per user; 50% promo to Jan 2027): https://www.writeupp.com/pricing
- Next.js support policy (16.x Active LTS; 15.x Maintenance LTS, released 21 Oct 2024; 14.x Unsupported; "two years following the initial release"): https://nextjs.org/support-policy
- Cloudflare D1 limits (10 GB on Workers Paid; 30 s per query; "processes queries one at a time"): https://developers.cloudflare.com/d1/platform/limits/
- SQLite triggers and `RAISE(ABORT, …)`: https://www.sqlite.org/lang_createtrigger.html
- FullCalendar (timeline and resource views Premium, "Starting at $480"): https://fullcalendar.io/pricing
- react-big-calendar 1.20.0 (1 Jun 2026, MIT, React 18/19 peer): https://registry.npmjs.org/react-big-calendar · https://github.com/jquense/react-big-calendar
- Heidi Forms (PDF only; Word "coming soon"; "typically 80 to 90% accurate"): https://support.heidihealth.com/en/articles/11668834-form-filling

**From the research notes (fetched 24 Oct):**
- Jane: https://jane.app/pricing · Zanda: https://zandahealth.com/uk/pricing/ · Nookal: https://www.nookal.com/uk/pricing · splose: https://splose.com/uk/pricing
- PostgreSQL range types and exclusion constraints (btree_gist): https://www.postgresql.org/docs/current/rangetypes.html
- ICO, valid consent: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/consent/what-is-valid-consent/
- "CareConnect" name collisions: https://www.theaccessgroup.com/en-gb/health-social-care/care-management-software/access-care-connect/ · https://digital.nhs.uk/services/digital-services-for-integrated-care/digital-tools-to-support-modern-ways-of-working-within-general-practice/advanced-telephony-better-purchasing-framework/suppliers-on-the-better-purchasing-framework-list/tailor-made-technologies-careconnect · https://chat-archive.fhir.org/stream/179189-uk/topic/CareConnect.20FHIR.20API.html

**TM3 MSA v5.3** (cl. 3.2(b), 8.1(i), 9.2(d)–(e); re-read from the 23 Oct text extract): https://tm3app.com/wordpress_tm3/wp-content/uploads/2025/11/MS-UK.pdf
**CSP record keeping:** https://www.csp.org.uk/professional-clinical/professional-guidance/record-keeping-guidance

**Internal (read, not changed):**
- `clinforms` `main` @ `397fb04`:
  - `CLAUDE.md`, `docs/strategy/all-in-one-pms-feasibility.md`, `memory/context/pricing.md` (D64), `memory/decisions.md` (D64, D68), `memory/projects/blue-heart-clinics.md`
  - `src/modules/medreport/connectors/{types,registry}.ts`, `core/schemas.ts`, `config.public.ts`
  - `src/server/{repos/context.ts,repos/clinic-profile.ts,crypto/envelope.ts}`, `src/app/api/_medreport-glue.ts`, `scripts/medreport/gen-eslint-boundary.mjs`, `.eslintrc.json`, `supabase/migrations/`, `package.json`
- `careconnect-mk` (`main` `66fac86`; branch tree via the GitHub API).
- `dutydesk` (`src/lib/inngest/functions`, `src/lib/dates.ts`, `src/components/ui/calendar.tsx`, `sentry.*.config.ts`); `hospital-system` (`apps/web/app/actions/booking.ts`).
- `scratchpad/pms/build.md` (23 Oct build note); `scratchpad/msa/msa.txt` (MSA text).

---

## Review log (what changed from `writer.md`)
1. **Reuse double-count removed.** The 33–52 dev-week MVP already includes reuse, and "10–15%" is the build note's figure against full TM3 parity. The writer's "25–49 after reuse" became 32–52, and a calendar range (14–40 months) was added.
2. **D1 claim corrected.** SQLite and D1 can block overlaps with triggers. Postgres stays first, but for UK hosting, size, concurrency, and the need for exclusion constraints (`btree_gist`, cancelled rows excluded, room and practitioner) under concurrent writes.
3. **The module boundary was unworkable as written.** A native connector inside medreport can't reach `pms` or `src/server`. It moves to a host-side factory wired in `_medreport-glue.ts`, and the boundary generator gets a `pms` rule set.
4. **Isolation guards added:** composite tenant keys and FKs, a repository test, sub-processor scope per package, and deploy rules for a shared deployment.
5. **Pricing fixes:**
   - the Group 250 cap is not in D64 (re-tagged [I]);
   - the bundle got a floor;
   - Blue Heart's £300 step became a £29-per-live-practitioner ramp capped at £599;
   - comparison with Cliniko + ClinForms and a hosting and support cost check added;
   - year-1 Clinic-system revenue stated as likely £0.
6. **TM3 MSA wording:** erasure runs 90 days from termination (cl. 9.2(e)), and rehearsals need a paid trial extract.
7. **Next.js nuance:** 15.x is still listed as Maintenance LTS, and the upgrade (0.5–1.5 dev-weeks) was added.
8. **Customer-facing guard** added: what may go into a quote.
9. **Not committed.** The workflow asked for a commit, a push and a `--no-ff` merge into `main`. `main` is the Vercel production branch (every push deploys clinforms.co.uk [C CLAUDE.md]), and no branch `pms-packaging` or worktree existed. No one asked for a commit or push in chat, so nothing was written to any repo.
