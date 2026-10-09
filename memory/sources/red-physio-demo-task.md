# Task: Prepare RED Physio insurer-forms demo in ClinForms

Paste everything below into a new Claude Code session in the desktop app, opened on your local clone of `appstackx/clinforms`.

---

## Goal
Prepare a live demo for a Tuesday call with RED Physiotherapy (contact: Daniel Vatamanu). Daniel asked: "Which insurers do you support?" Show ClinForms completing three real, publicly available UK private-medical-insurer therapy forms, each in its original layout, from one fictional patient's TM3-style notes.

## Repository
Work in **appstackx/clinforms** (private). Create branch `demo/red-physio` from `main` and push it when done. Do not open a PR unless asked.

ClinForms is a standalone Next.js 14 app (Node 22, `.nvmrc`):
- `src/modules/medreport/**` holds the engine, UI and API.
- `src/sandbox/tm3-sim/**` holds a simulated TM3 practice-management system with fixtures. `megan-hart.ts` and `daniel-brooks.ts` are the existing demo patients; see `fixtures/index.ts` and `build.ts`.
- `src/modules/medreport/forms/**` holds the docx/PDF outline, fill and render code.

Product flow:
1. Under **Referrer forms → Upload**, the form is analysed and the field mapping is proposed.
2. Staff correct and confirm the mapping.
3. Staff create a report for a patient, which drafts cited answers.
4. A clinician reviews and approves.
5. The final document is produced in the form's original layout and filed back to the simulated TM3.

Setup:
- Run `npm ci`, then `cp .env.example .env.local`.
- Fill `.env.local` locally: `ANTHROPIC_API_KEY`, `MEDREPORT_AI_MODE=auto`, a 16+ character `MEDREPORT_LIVE_PASSCODE`, the launch/signing secrets, and `TM3_SIM_TOKEN`. Never commit `.env.local` or print secret values.
- Run `npm run dev`.

## Steps
1. **Download the forms.** Save the public PDFs into a new gitignored folder `demo-assets/insurers/` (add it to `.gitignore` first). Never commit third-party insurer PDFs.
   - **Priority:**
     - Bupa therapies management form (bupa.co.uk)
     - AXA Global Healthcare therapy treatment plan (axaglobalhealthcare.com)
     - Aviva CM016 (static.aviva.io)
   - **Optional, if time allows:** Aviva GEN030, Freedom Health Insurance (Worldwide), Allianz Care.
   - **No public PDF:** Vitality, WPA and AXA Health (portal-based). List these in the doc; do not hunt for them.
2. **Classify each PDF:** fillable AcroForm, flat text PDF, or scanned. Flat and scanned PDFs are best-effort in ClinForms, so note which kind each one is.
3. **Upload each form** via Referrer forms → Upload. Review the proposed mapping, correct any wrong field mappings, and confirm it. If a form fails to analyse or fill correctly, find the root cause in `src/modules/medreport/forms/**` and fix it with a test. Keep the fixes minimal.
4. **Add one fictional patient fixture** for private-medical-insurance therapy, e.g. `PH-DEMO-03`, in `src/sandbox/tm3-sim/fixtures/`. Model it on the existing fixtures:
   - Plausible MSK case, insurer policy/authorisation number fields, initial assessment, follow-ups, outcome measures, and a treatment plan with session counts.
   - Clearly fictional data only.
5. **Complete and approve all three forms** for that patient end to end. Save the final outputs to `demo-assets/outputs/` (gitignored).
   - Each demo output must carry this footer or watermark: "Public form used for demonstration only – not affiliated with or endorsed by <insurer>. Fictional patient data."
   - Keep the simulated TM3 labelled "Simulated TM3 sandbox – demo data, not affiliated with TM3".
6. **Write `docs/demo-red-physio.md`** containing:
   - A support matrix: insurer, form, how it is completed (fillable PDF / flat PDF best-effort / portal → copy-ready answers), and status.
   - A 10-minute call script.
   - Honest caveats:
     - Portal-only insurers get copy-ready answers, not automatic submission.
     - "Support" may mean billing/claims, which ClinForms does not do.
     - TM3 is simulated today; the real route is a TM3 export/upload until API access is agreed.
   - Questions to ask Daniel: which insurers matter most, volumes per month, current time per form, PMS used, who signs.
   - Customer-facing wording must not mention AI, Claude or any model name. Use neutral wording consistent with `src/modules/medreport/ui/wording.ts`.
7. **Run the checks** and fix anything red: `npm run typecheck`, `npm run lint`, `npm run test:medreport`, `npm run build`.
8. **Commit and push** `demo/red-physio`, then summarise what works, what is best-effort, and the exact demo click path.

## Done when
- All three priority insurer forms complete in their original layout for the fictional patient, with the demo footer.
- The doc and patient fixture are committed, and all checks are green.
- No third-party PDFs or secrets are in git.
