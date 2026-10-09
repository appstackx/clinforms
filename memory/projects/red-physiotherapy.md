# RED Physiotherapy deal (Daniel Vatamanu)

**Status (2026-10-09 ~16:00 UTC):** Call **booked** (Khuram 09/10 14:08); day "Tuesday" from the research text he pasted, **date 13 Oct inferred – confirm day AND time with Khuram**. Demo prep **NOT started** (cloud container could not download the insurer PDFs). Highest-priority work item. Ready-to-paste prompt: `memory/next-steps.md` §1 (base: `memory/sources/red-physio-demo-task.md`).
**Contact:** `memory/people/daniel-vatamanu.md`.

## 1. Company (from his email signature only – no research done yet)
RED Physiotherapy LTD, company **13547807**, registered office 30 Elba Gate, Newton Leys, Milton Keynes MK3 5QX. Sites: **Milton Keynes, Towcester, Northampton**. contact@red-physiotherapy.co.uk; www.red-physiotherapy.co.uk; phones MK 01908 713973, Towcester 01327 362717, Northampton 01604 385343. Official physio of NTFC Women's; "Three Best Rated 2025 – Best Physiotherapists Milton Keynes". Unknown: size, staff, revenue, clinic system, insurer mix, volumes, Word/PDF vs portal, signers.
Overlaps geographically with Blue Heart (MK, Northampton) – keep materials separate.

## 2. Email thread (verbatim, from Khuram's Gmail screenshots shared 09/10 14:04 UTC; all Wed 7 Oct 2026, UK time; thread "7 of 563")
0. Khuram → RED (before 09:23): initial outreach – content not visible (only signature "AppstackX Ltd / khuram@appstackx.co.uk").
1. **RED (Daniel) → Khuram, 09:23**
   > Hello
   > Thank you for the email
   > Which insurers do you support?
   >
   > Daniel Vatamanu, Co-founder [signature]
2. **Khuram → contact@ (RED), 09:54**
   > Hi Daniel,
   >
   > Thanks for getting back so quickly.
   >
   > CareConnect isn't limited to a fixed list of insurers. Clinics use it to complete whatever report form an MLC or insurer sends them — each referrer has their own layout, questions and headings — pulling patient registration details and physiotherapy notes from TM3 (or your existing clinic system) so the team isn't retyping the same information.
   >
   > That usually covers the common UK medical insurers and MLCs (for example AXA, Aviva, Vitality, WPA and others), but the point of the product is that you're not locked to our template: if a referrer sends their own Word or PDF form, CareConnect fills that document for clinician review and approval before it goes out.
   >
   > If useful, I can send a short demo video, or we can jump on a quick call and I can walk through how it would sit alongside how RED already works with referrals.
   >
   > Khuram
   > AppstackX Ltd
   > khuram@appstackx.co.uk
3. **RED (Daniel) → Khuram, 11:05**
   > Let's book a call, can you share a booking link?
4. Khuram (09/10 14:08 UTC): "i have replied and a meeting is booked" – his reply text and booking link are not in our records.

Assistant's suggested reply (09/10 14:04 UTC, before Khuram said he'd replied – probably unused): "Hi Daniel, apologies for the delay – happy to. You can pick a time that suits here: [booking link]. It'd help to know beforehand which insurers/MLCs send you the most reports (and whether as Word/PDF forms or through an online portal), and which clinic system you use. Kind regards, Khuram"

## 3. Assessment (assistant, 09/10 14:04–14:10 UTC)
- **Product covers RED's need; the Dell video does not** (title "Prepared for Dell Baines", "Hello Dell", Dell's quotes and questions). **Never send it to RED.** Demo live on the call; offer a generic video ("for UK physiotherapy clinics", 1–2 h) or a RED-specific one after the call.
- Answer to "Which insurers do you support?": no fixed list – ClinForms completes whatever form a referrer sends (matches Khuram's email).
- Caveats on Khuram's email wording: no real insurer form tested yet; some PMIs take updates via **online portals** (we fill documents, we don't submit into portals); "support" may mean billing/authorisations/claims – clarify early.
- Product name: email said "CareConnect" – use **ClinForms** on the call.
- Blue Heart vs RED: same core ("complete *their* form from *our* clinical records, clinician approves"); differences: senders (MLCs/case managers vs PMIs), form types (treatment/progress reports vs further-treatment requests, therapy plans, claim forms), system (TM3 vs unknown), arrival (Word/PDF vs some PDFs + portals). **One product, two sets of forms.**
- Network effect: a Bupa or Aviva form mapped once works for every clinic – a library of ready-mapped insurer forms becomes the advantage.

## 4. Insurer support matrix (draft – forms not yet downloaded or classified)
Research pasted by Khuram 09/10 14:08 UTC (author not stated). Full list + URLs: `memory/context/insurer-forms.md`.

| Insurer | Form | Expected handling | Priority | Status |
|---|---|---|---|---|
| **Bupa** | Further Physiotherapy Treatment Request (therapies management form), 3 pp | Fillable → fully supported; flat → best effort (unknown which) | **Tuesday #1** ("best match") | Not downloaded |
| **AXA Global Healthcare** | Therapy Treatment Plan, 4 pp (international – label separately from domestic AXA Health) | As above | **Tuesday #2** | Not downloaded |
| **Aviva** | CM016 PMI claim form, 8 pp | Clinician sections only; patient parts and declarations left for the right person | **Tuesday #3** | Not downloaded |
| Aviva | GEN030 medical report request, 2 pp | Doctor-only – format example only, labelled | Optional | – |
| Freedom Health Insurance | Worldwide outpatient claim form, 4 pp | Repeated rows, expenses table incl. physio | Optional | – |
| Allianz Care | Pre-authorisation form FRM-PreAuth-EN-0825, 3 pp | Patient + doctor sections | Optional | – |
| Vitality | No public PDF (therapist hub) | Likely portal → copy-ready answers, no submission | List only | – |
| WPA | No public PDF (provider hub) | Likely portal → copy-ready answers | List only | – |
| AXA Health (domestic) | No public PDF (provider site) | Likely portal → copy-ready answers | List only | – |

## 5. Demo plan for Tuesday (Khuram's pasted research, endorsed by assistant 14:10 UTC)
- Complete **Bupa, AXA Global Healthcare and Aviva CM016** from **one fictional patient** – show three layouts filled from the same records, missing information flagged, declarations left for the right person, "without claiming these are Daniel's exact forms".
- Label each "public form – used for demonstration only; not affiliated with or endorsed by [insurer]"; footer on outputs: "Public form used for demonstration only – not affiliated with or endorsed by <insurer>. Fictional patient data."; private demos only; never commit the PDFs (gitignored `/demo-assets/`).
- Branch `demo/red-physio`; fictional PMI patient `sim-pat-006` (001–005 taken; episode `sim-ep-1006` suggested) with fictional policy/authorisation numbers (e.g. `DEMO-POL-0001`, `DEMO-AUTH-0001`); `PH-DEMO-03` is reserved for a clinician (the original task prompt's "e.g. PH-DEMO-03" is superseded); `docs/demo-red-physio.md` with support matrix, 10-minute call script, caveats, questions. Estimate 2–3 hours once PDFs are available.
- Use neutral wording (no AI/Claude/model names) in anything Daniel sees.

## 6. Questions for Daniel on the call
1. Which insurers and MLCs send the most reports? Volume per month?
2. Do they arrive as Word/PDF forms or via online portals?
3. Current time per form; who writes and who signs?
4. Which practice-management system does RED use (TM3? Cliniko? other)?
5. What does "support" mean to him – report forms, or billing/authorisations/claims?
6. (Later) pricing expectations – no RED price has been discussed.

## 7. Open items
- Call day (Tue 13 Oct inferred) + time and attendees (ask Khuram, or check his Gmail read-only if he agrees – `next-steps.md` §0 step 7). Booking link used unknown.
- Live drafting is needed: demo mode has no recorded drafts for a new patient on these forms (`NO_DEMO_DRAFT`) – see `next-steps.md` §1 Blockers and Call-day fallback.
- Company research (Companies House 13547807, website) – quick check before Tuesday.
- Deploy a live URL for the call? (Vercel not deployed yet – running locally on Khuram's Mac with `npm run dev` is the fallback; screen-share. The insurer PDFs are not in git, so a Vercel URL can't show them, and confirmed form maps live only in the browser that made them.)
- After the call: record RED's answers here, update the support matrix, decide on a RED-specific video.
