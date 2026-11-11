# Decision: home exercise programmes (HEPs) – Physitrack or our own library

**Internal.** 11/11/2026. For Khuram. Tracker tasks ex03–ex06. Research only – nothing built, nothing signed up for.

## Recommendation (short)

**Build our own simple exercise programme feature (Option B, lean). Do not apply to Physitrack now.**
Clinics that already pay for Physitrack keep using it and upload its PDF to the record, then share it through the
portal. That works today and costs nothing.

Why:
1. **We can't get in yet.** Physitrack "usually only" takes integrations from systems with **500+ practitioners**
   (the exception is a 50+ practitioner practice with its own in-house system). We have neither. [1]
2. **Physitrack is now a competitor.** It launched its own EMR/practice system on 28/09/2026, aimed at 1–10 clinician
   practices – our market. It is US-first today. [2][3] Building our HEP feature on their product means our patients'
   exercise data sits in a competitor's app that also sells a clinic system.
3. **It costs the clinic more.** Each practitioner needs their own Physitrack subscription (the API works with a
   per-practitioner token), **£19.49 + VAT a month** in the UK (£210.49 a year). [1][4]
4. **Most of the build is ours either way.** The portal, document sharing, PDFs and questionnaires already exist
   (see "What the repo already has"). A basic builder on top of them is about 2–3 weeks of work.

The weak spot of Option B is **content**: Physitrack has 15,000+ filmed exercises; [4] at launch we would have a
small illustrated starter set plus whatever the clinic adds. That is enough for a pilot clinic. It is not enough to
win a clinic that relies on Physitrack's videos – those clinics stay on Physitrack, using the PDF route.

## Comparison

| | **A. Integrate Physitrack** | **B. Our own simple library** | **A0. Do nothing new (Physitrack PDF upload)** |
|---|---|---|---|
| Cost to clinic | £19.49 + VAT per practitioner a month (annual £210.49) [4]; 10–15% partner codes exist for TM3/WriteUpp/Cliniko [11][12][13] | Nothing extra (inside the ClinDesk subscription) | Same as A if they use Physitrack; nothing if not |
| Cost to us | Build ~7–9 days + Physitrack's approval (unknown wait, may be refused); API Usage Agreement possible [1] | Build ~14–17 days; starter content (images) – see Risks | 0 days |
| Build effort (days) | ex03 2, ex04 2, ex05 2–3, ex06 1–2 | ex03 6–7, ex04 3–4, ex05 3, ex06 2 | 0 |
| Content quality | Excellent – 15,000+ filmed videos, PhysiApp for patients [4] | Basic – starter set of drawings/photos, clinic's own photos and video links | Excellent (it is Physitrack) |
| Data / GDPR | Patient name, contact and programme copied into Physitrack (AWS London for UK accounts [5]); clinic needs its own terms/DPA with Physitrack; adherence comes back by webhook | Stays in our Supabase (London), same encryption, audit and subject-access export as the rest of the record | Only the PDF comes into our record |
| Lock-in | Clinic's programmes live in Physitrack; we depend on a competitor's API and approval | None for the clinic; we own it | None for us |
| Patient experience | PhysiApp (iOS, Android, web) with reminders [4] | Our portal page + PDF; email reminder via comms | PhysiApp + PDF in our portal |

## What the repo already has (grounds the estimates)

- **Patients and cases:** `pms_patients`, `pms_cases` (per-patient episodes with practitioner, payer, diagnosis) –
  `supabase/migrations/20261024000102_pms_patients.sql`, `…000213`, `…000224`; services in `src/server/pms/records/`.
- **Attachments:** `pms_attachments` + `pms_attachment_chunks` (encrypted, in Postgres) – **pdf/jpeg/png/docx only,
  max 4 MB**. No video storage and no object store. Videos would have to be links (e.g. the clinic's unlisted
  YouTube/Vimeo) unless we add storage.
- **Patient portal:** one-time email link sign-in, "Shared with you" documents (PORTAL-004, `pms_portal_share_files`),
  forms and outcome questionnaires (`pms_intake_responses`, scored into `pms_outcome_measures`) –
  `docs/clinic-system/portal.md`, `src/modules/pms/portal/`, `src/app/(public-clinic)/clinics/[clinicId]/portal/`.
- **PDFs:** `@react-pdf/renderer` with bundled fonts, pattern in `src/server/pms/comms/letter-output.tsx`; also
  `src/server/pms/billing/pdf.tsx`.
- **Messages:** comms module (templates, outbox, `portal_link`) for "your programme is ready" and reminders.
- Nothing exercise-related exists in code yet. The tracker tasks ex03–ex06 are not in the repo; mapping below uses
  the names given in the brief.

## What we would build

| Task | A. Physitrack | B. Own library |
|---|---|---|
| **ex03 builder** | No builder – it is Physitrack's. Settings: each practitioner pastes their Physitrack token; record and case get "Open in Physitrack" (API v1 SSO/copy patient). [1] ~2 days | `pms_exercises` (clinic library: name, body area, instructions, cautions, image, optional video link) seeded with a starter set; `pms_exercise_programmes` + items (sets, reps, hold, times a day/week, notes) linked to patient **and case**; templates ("ACL week 1–2"); copy a programme. Clinical permissions as notes (`clinical.write`). ~6–7 days |
| **ex04 portal + PDF** | Webhook receives the programme PDF when assigned/updated [1] → saved as an attachment on the case → optional portal share (existing PORTAL-004). ~2 days | Portal page "My exercises" (images, instructions, video links, printable); PDF with `@react-pdf` in the letter layout; email via comms. A new version replaces the shared one; old versions kept on the record. ~3–4 days |
| **ex05 check-ins** | Webhooks for adherence, PROM scores and messages [1] → shown on the case and in notes. ~2–3 days | Patient ticks "done today" per session + pain 0–10 + optional comment (reuse the portal form/outcome engine); staff see adherence % on the case and in the next note. ~3 days |
| **ex06 tests** | Unit tests for token storage, webhook signature and idempotency; e2e against Physitrack staging (on request [1]). ~1–2 days | Unit + RLS/permission tests (reception can't see programmes), PDF snapshot, portal e2e (`scripts/e2e/`). ~2 days |
| **Total** | **~7–9 days, after approval** | **~14–17 days** |

## Alternatives looked at

| Product | UK price | Integration route for us | Note |
|---|---|---|---|
| Physitrack | £19.49 + VAT/practitioner/month [4] | Partner API v1/v2 + webhooks, 500-practitioner bar [1] | Now also sells an EMR [2][3] |
| Rehab My Patient (UK) | Individual £11.42/mo, clinic £16.42/mo, multi-clinic from £23.33/mo [6] | Says it integrates with clinic software; no public API docs found | Cheapest UK option; ask them for API terms |
| Wibbi | From ~US$33, quote-based [7] | API listed; WriteUpp integrates it [14] | 20,000+ videos |
| MedBridge | Per seat + $1.50 per HEP episode (US) [8] | Enterprise, US-focused | Not a fit for small UK clinics |
| free-exercise-db | Free | Download (JSON + images) | 800+ **gym** exercises, Unlicense badge but image licence unconfirmed (open GitHub question) [9] – not safe to ship as is |
| wger | Free | API / download | Licence set per exercise (CC-BY-SA family; some images from Wikipedia with their own terms) [10] – needs attribution and share-alike; mostly gym |

**What competitors do**

| System | HEPs |
|---|---|
| TM3 | No own builder; integrates Physitrack, Physiotools, Salaso, Exercise Prescriber, PhysioTec (`docs/strategy/tm3-feature-comparison.md`) |
| Cliniko | No own builder; "Open in Physitrack" via a per-practice API key [12][15] |
| Jane | No HEP builder; Physitrack integration via API key [16] |
| WriteUpp | No own builder; Physitrack (per-clinician API key, programmes saved to the record) and Wibbi [13][14] |
| Pabau | No video library found; exercise sheet templates as forms/documents via the portal [17] |

None of the UK incumbents has its own library – they all point at Physitrack. A built-in, no-extra-cost programme
feature is a small differentiator for ClinDesk, as long as Physitrack users still have a route (the PDF).

## Risks

| Risk | Option | How we handle it |
|---|---|---|
| Physitrack refuses or delays access (we're far below 500 practitioners) | A | Don't depend on it; A0 covers Physitrack users |
| Physitrack, now a competitor, changes API terms | A | Same – keep integration optional |
| Thin content looks amateur next to Physitrack | B | Clean line-drawing starter set; let clinics add their own photos and video links; say "use Physitrack alongside if you prefer" |
| Image licence trouble from open datasets | B | Don't ship free-exercise-db/wger images without a per-image licence check; prefer commissioned or our own photos (we own them) |
| Clinical safety of instructions we write | B | Starter text written/checked by a physio (pilot clinic); clinic edits are theirs; "cautions" field; no dosing advice from us |
| Video storage cost/size | B | Links only at first (attachments are max 4 MB in Postgres); add storage only if clinics ask |
| Clinic expects PhysiApp-style reminders and app | B | Email reminders via comms now; a phone app is out of scope |

## The decision Khuram needs to make

1. **Option B (recommended), A, or A0 only?** Pick one.
2. **If B – starter content:** (a) commission ~60–80 simple line drawings of core MSK exercises (I haven't priced
   this; get a quote), (b) take our own photos with the pilot clinic, or (c) launch text-only, with clinic uploads.
   Which one, and who writes or checks the instruction text?
3. **If A – are you willing** to email support@physitrack.com for staging access, knowing we are below their
   practitioner threshold and they now sell a competing clinic system?

Until this is decided, ex03–ex06 stay parked. A0 needs no work: clinicians upload the Physitrack PDF under
Attachments and use "Share with the patient".

## Sources (checked 11/11/2026)

1. Physitrack developer information – https://www.physitrack.com/developer-information
2. Physitrack EMR launch – https://www.accessnewswire.com/newsroom/en/computers-technology-and-internet/physitrack-launches-next-generation-emr-powered-by-agentic-ai-1227700 ; https://physitrack.com/emr
3. Analyst view (Redeye) – https://borsvarlden.com/artiklar/physitrack-emr-launch-marks-shift-from-add-on-to-system-of-record-redeye
4. Physitrack UK price – https://support.physitrack.com/article/159-how-much-does-physitrack-cost (note: Physitrack's own UK blog posts quote £39.99/user/month for the "all-in-one" bundle, and our glossary used that figure; the exercise subscription is £19.49 + VAT)
5. Physitrack security/hosting (uk.physitrack.com, London, AWS) – https://www.physitrack.com/en-gb/security ; GDPR – https://support.physitrack.com/article/639-general-data-protection-regulation-gdpr
6. Rehab My Patient pricing – https://www.rehabmypatient.com/help/subscription-payment/how-much-does-rehab-my-patient-cost
7. Wibbi – https://www.softwareadvice.co.uk/software/202516/Wibbi ; https://www.capterra.co.uk/software/219523/Wibbi
8. MedBridge – https://www.medbridge.com/annual-cost-calculator
9. free-exercise-db – https://github.com/yuhonas/free-exercise-db ; image licence question https://github.com/yuhonas/free-exercise-db/issues/12
10. wger – https://wger.readthedocs.io/ ; https://pypi.org/pypi/wger
11. Physitrack + TM3 – https://www.physitrack.com/da/partners/tm3
12. Physitrack + Cliniko – https://www.physitrack.com/partners/cliniko ; https://support.physitrack.com/article/770-cliniko-integration-guide
13. WriteUpp + Physitrack – https://help.writeupp.com/en/article/connecting-to-physitrack-17pff1e/ ; https://www.physitrack.com/partners/writeupp
14. WriteUpp + Wibbi – https://www.writeupp.com/blog/improve-physio-patient-engagement-with-the-writeupp-and-wibbi-integration
15. Cliniko connected app – https://www.cliniko.com/connected-apps/physitrack/
16. Jane + Physitrack – https://integrations.jane.app/integrations/physitrack
17. Pabau HEP template – https://pabau.com/templates/home-exercise-program/
