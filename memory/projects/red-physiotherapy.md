# RED Physiotherapy deal (Daniel Vatamanu)

**Status (2026-10-09 ~23:15 UTC; run location updated 10/10):** Call **booked** (Khuram 09/10 14:08) for **Tue 13 Oct 2026, morning** (per the 09/10 desktop brief; exact time not in our records – check the invite). **Demo pack BUILT, reviewed, fixed and rehearsed; CALL PACK written: `docs/demo-red-physio.md`** (support matrix, Monday/Tuesday checklist, 10-minute script with click path and timings, honest answers, fallbacks). Branch `demo/red-physio`, **frozen at tag `red-demo-2026-10-13` (= `3521401`)**; run `npm run demo:red` from the frozen folder **`~/Projects/Appstackx/clinforms-demo`** (since 10/10 – not from `clinforms-wt/red-integrate` or `main`); assets in gitignored `clinforms/demo-assets/insurers/`. *(10/10: clinforms.co.uk now runs the production line – the call still uses the local frozen demo, not the website.)* **Left for Khuram:** one rehearsal in his own Chrome (demo profile, Monday evening), confirm RED's practice system if he can, decide what to say on price.
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

## 4. Insurer support matrix (classified 09/10; full version with click-level detail: `docs/demo-red-physio.md` §1)
PDFs downloaded 09/10 ~17:10 UTC into gitignored `clinforms/demo-assets/insurers/`; per-form detail in `memory/context/insurer-forms.md`.

| Insurer | Form | Type | What ClinForms completes | On the call (13 Oct) | Status |
|---|---|---|---|---|---|
| **Bupa** | Therapies management form – further physiotherapy treatment request, 3 pp | Fillable PDF, 26 fields | The therapist's form fully: 8 registration, 3 calculated (every outcome measure; sessions), 7 drafted, 3 recorded opinions, sign-off only in the therapist's declaration | **#1 – end to end, upload live** | Ready: prepared map + answers (fit every box); final `_SIGNED` |
| **AXA Global Healthcare** (international, not AXA Health UK) | Therapy treatment plan, 4 pp | Fillable PDF, 73 fields / 32 questions | The therapist's form; signature written in the printed box | **#2 – stop at the identifier block** (Bupa's numbers not copied; F-28 specialist-review gap). Don't type numbers or approve | Ready (draft only) |
| **Aviva** | CM016 PMI claim form, 8 pp | Flat PDF (print-ready, trim size) | Patient's/GP's form: section 1 identity only (address lines + postcode); 49 boxes left; approved as a prefill (`_PREFILLED`) | **#4 – 30 s** "knows what not to fill" | Ready |
| Aviva | GEN030 medical report request, 2 pp | Flat PDF | Doctor's report – patient details only (format example) | Only if asked | Map ready |
| Freedom Health Insurance | Worldwide outpatient claim form, 4 pp | Fillable PDF, 73 fields / 35 questions | Policyholder's claim form – only the treatments-and-fees table; prefill | Skip unless asked | Ready |
| Allianz Care | Pre-authorisation form, 3 pp | Fillable PDF, 80 fields / 55 questions | Medical-provider section (17 answers, 5 gaps); doctor's and patient's parts left; prefill | Skip unless asked | Ready (answers file) |
| Vitality / WPA / AXA Health (domestic) | No public PDF (provider portals) | Portal | Copy-ready answers via a portal question set; no login, no submission | **#3 – "Example portal questions (illustrative)"** (our own questions; 7/8 drafted, prognosis gap) | Ready (seeded in the library) |

## 5. Demo plan
**As built (09/10/2026):** one fictional Bupa-insured patient, **Mrs Rebecca Lane** (`sim-pat-006` / `sim-ep-1006`, right shoulder, open episode, membership `DEMO-POL-0001`, authorisation `DEMO-AUTH-0001`, treating physio Sarah Reid `PH-DEMO-01`, no recorded prognosis on purpose); 7 prepared maps (6 insurer PDFs + our own portal question set) and 4 answer files (Bupa, AXA, Allianz, portal) recorded through the real drafting path, hand edits listed in each file's note, all in gitignored `clinforms/demo-assets/insurers/` (`npm run demo:check`: "7 maps, 4 answer files, 6 form files"); demo footer on every output; `npm run demo:red` = build + start in demo mode (no key needed). Rehearsed twice in headless Chromium (finals in `demo-assets/outputs/`, screenshots in `demo-assets/rehearsal/`). Call order: Bupa (upload live) → AXA block → portal questions → Aviva 30 s → close with "send me 2–3 blank forms". Script: `docs/demo-red-physio.md` §3.

**Original plan (Khuram's pasted research, endorsed by assistant 14:10 UTC):**
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
- Call time and attendees (Tue 13 Oct morning – check the invite). Booking link used unknown.
- ~~Live drafting is needed~~ – resolved: prepared answers replay in demo mode; live drafting is optional (`npm run demo:red -- --live` + passcode) and not recommended (live answers overflow the insurer boxes until `forms-8`).
- Company research (Companies House 13547807, website, likely PMS) – still not done.
- ~~Deploy a live URL for the call?~~ – resolved: present locally (insurer PDFs are not in git; maps live in the browser). `clinforms.co.uk` is live but runs an older, pre-RED build – don't send it to Daniel as "the demo".
- After the call: record RED's answers here (insurers, volumes, portals, PMS, signers, what "support" means, next step), update the support matrix here and in `docs/demo-red-physio.md`, decide on a RED-specific video and a second fictional patient insured with AXA.

## 8. Call guidance (from the prospect's-eye review, 09/10 ~20:50 UTC – honest answers, nothing invented)
**The full call pack is `docs/demo-red-physio.md`** (checklist, click path, timings, labels to frame, fallbacks); this section is the short version.
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
