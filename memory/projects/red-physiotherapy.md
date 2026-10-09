# RED Physiotherapy deal (Daniel Vatamanu)

**Status (2026-10-09 ~23:45 UTC):** Call **booked** (Khuram 09/10 14:08); day "Tuesday" from the research text he pasted, **date 13 Oct inferred – confirm day AND time with Khuram**. **Demo pack BUILT, reviewed, fixed and rehearsed** on branch `demo/red-physio` (`npm run demo:red`; assets in gitignored `demo-assets/insurers/`) – see `memory/next-steps.md` §1 and §8 below for the call.
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
| **Bupa** | Further Physiotherapy Treatment Request (therapies management form), 3 pp | Fillable PDF (26 fields) – fully supported; the clinic completes and signs it in the therapist's declaration | **Tuesday #1** ("best match") | Ready: prepared map + answers; lead with it |
| **AXA Global Healthcare** | Therapy Treatment Plan, 4 pp (international – label separately from domestic AXA Health) | Fillable PDF (32); signature written in the printed box | **Tuesday #2** | Ready; membership/claim numbers blocked (Bupa's not copied) – show as the safety feature, don't approve on the call |
| **Aviva** | CM016 PMI claim form, 8 pp | Flat PDF; the patient's/GP's form – only identification prefilled (address lines + postcode); approved as a prefill (`_PREFILLED`) | **Tuesday #3** (30 s) | Ready |
| Aviva | GEN030 medical report request, 2 pp | Doctor-only – format example only, labelled | Optional | Map ready (patient details only) |
| Freedom Health Insurance | Worldwide outpatient claim form, 4 pp | Policyholder's claim form; the clinic fills the expenses table only; prefill | Skip on the call | Ready |
| Allianz Care | Pre-authorisation form FRM-PreAuth-EN-0825, 3 pp | Section 2 (medical provider) drafted; doctor-labelled name/signature/date left for a doctor → prefill | Skip on the call | Ready (answers file) |
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

## 8. Call guidance (from the prospect's-eye review, 09/10 ~21:50 UTC – honest answers, nothing invented)
**Flow (~10 min):** say up front "one fictional patient shown on several insurers' public layouts – not RED's own forms".
1. Bupa end to end (rehearsed): simulated TM3 tab → Complete referrer's report form → Bupa → review (citations;
   "Write in my own voice" turns "Sarah Reid recorded…" into plain clinical wording) → preview → approve → final PDF →
   saved back to the record. Bupa's form is the one a UK physio clinic fills routinely.
2. AXA Global Healthcare: stop at the identifier block ("it will not copy Bupa's membership number onto AXA's form").
   Don't type numbers, don't approve. AXA Global Healthcare is the international plan, not AXA Health UK.
3. Portal questions (seeded "Example portal questions (illustrative)"): drafted in demo mode, copy-ready, prognosis left
   blank and flagged because no clinician recorded one – the answer to "AXA Health / Vitality / WPA use portals".
4. Aviva CM016, 30 s: "it knows what not to fill" – patient/GP parts left blank, approved as a prefill, never signed.
5. Skip Freedom and Allianz unless asked.

**Support line:** "Bupa's form: routine. AXA Health / Vitality / WPA: portals, so copy-ready answers (no portal login or
submission). Others: any Word/PDF form after a one-off check by staff." Ask which forms and portals RED gets, and how many.

**Likely questions, honest answers:**
- *Which insurers?* No fixed list; any Word/PDF form, mapped once and checked by staff; tried so far on 6 public insurer
  PDFs with fictional data; portals → copy-ready answers.
- *Clinic system?* Not connected to any real system yet; the demo reads a simulated TM3; today: upload a notes printout
  (PDF) or an export (JSON/CSV); a direct TM3 link depends on TM3 granting access. Confirm RED's system first.
- *Who writes the text / responsibility?* An automated drafting service drafts each answer from the notes, citing the
  note; identifiers and figures are copied by code; opinions only if a clinician recorded them, else blank and flagged.
  The checks can't catch a wrong paraphrase that cites a real note – the physio reads every answer and approves (typed
  name, HCPC number, attestations; server-signed receipt). No user logins yet. If asked what powers it: say truthfully
  which provider processes it (named as sub-processor in the DPA).
- *Data / pilot now?* Not yet: everything stays in the browser in this demo; no database, logins or 2FA, nothing
  deployed (UK hosting planned). Real data needs a DPA, a DPIA, UK hosting and access controls first; give a date only
  after scoping.
- *Time saved / price?* Machine time is seconds (about 7 s to draft a form live, about 15 s to read a new form – script
  measurements); review time with real clinicians not measured. No price set for RED; offer a measured pilot on their
  own forms once the safeguards exist.

**Don't:** claim these are RED's forms; say "watch it read Bupa's form" (the maps were prepared and checked in advance –
say so); share the terminal (server logs); show the AXA typed-number flow.
