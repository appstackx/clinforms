# Home exercise programmes (tracker ex03–ex06)

**Internal.** 12/11/2026. Branch `feat/exercise-programmes` (not merged, migrations not applied anywhere). Built from
the recommendation in `decisions/exercise-programmes.md` (**Option B, lean: our own simple library**) while the
decision is still open, so the decision only confirms or adjusts it. Ships **dark**:

| Switch | Off (default) | On |
|---|---|---|
| `CLINFORMS_EXERCISE` (env, platform; only `on` counts) | Set-up → Exercises, the record's Exercises tab, the portal section and every page / route / action are not there (404 / "not found"). Production: not set | Set-up → Exercises exists (settings.setup) |
| Clinic setting (`pms_exercise_settings.enabled`, Set-up → Exercises, owner/admin with settings.setup) | No Exercises tab, nothing in the portal; existing programmes stay on the record (and in the subject-access copy) | Clinicians build and share programmes; patients see shared ones in the portal |

Module: **records**. Migrations **0126, 0127, 0128** (SQLite + Postgres twins, inside records' own range 0120–0129,
reserved in `src/modules/pms/core/modules.ts`; **0129 stays free**).

## 1. Decisions this build ASSUMES – for Khuram to confirm or change

| # | Assumption | Built as | Easy to change? |
|---|---|---|---|
| A1 | **Option B** (own library), not Physitrack (A) | Own tables, no third-party API | – (A would be a separate build; A0 still works: upload the PDF under Attachments and share it) |
| A2 | **Starter content: none shipped.** Clinics write their own; nothing copied from an open dataset | Empty library; demo clinics only get a button "Add demo exercises" – 6 fictional, generic entries named "… (demo)", cautions say "Demo text – the clinic checks and replaces it before use" | Yes – commissioned drawings/photos would be a seed + image storage (see A4) |
| A3 | **Who writes the library:** owner/admin (`settings.setup`) in Set-up → Exercises, like note templates. Clinicians pick from it and can also "write their own" exercise inside a programme (not saved to the library) | `settings.setup` | Yes – one permission check if clinicians should edit the library too |
| A4 | **Pictures and videos are links only** (https, no user/password in the link), shown as "Watch the video / See the picture (opens another website)", never embedded – so opening the portal leaks nothing to another site. No upload/storage | `LinkSchema` | Yes – uploads would reuse attachments (4 MB, pdf/jpeg/png) or the file store |
| A5 | **A programme is a snapshot**: picking a library exercise copies its text; later library edits never change what a patient was given | `items_enc` JSON | – |
| A6 | **Lifecycle draft → shared → ended.** Shared = locked. A change = "Make a new version" (a draft copy); sharing it ends the old one in the same batch (the patient never sees both). Several programmes may be shared at once (e.g. knee and shoulder) | `status`, `replaces_id` | Yes |
| A7 | **Dose fields:** sets (1–20), reps (1–100), hold seconds (1–600), times a day (1–10), days a week (1–7), all optional, plus a note per exercise and a note for the whole programme. Max 30 exercises | `ProgrammeItemSchema` | Yes |
| A8 | **Check-ins:** at most one per programme per UK day; sending again the same day changes that day's row. "Did you do your exercises today?" yes/no, pain 0–10 (optional, 0 = none, 10 = worst imaginable), comment ≤ 500 (optional, encrypted). Only on shared programmes. No per-exercise ticks, no backdating | `pms_exercise_checkins` | Yes |
| A9 | **Clinician view of check-ins:** on the programme (table) and in the Exercises list ("did the exercises on N of the last 14 days", latest pain, average pain over 14 days). Not shown in clinical notes yet | `adherenceSummary` | Yes |
| A10 | **No reminders.** Sharing can email a one-time portal sign-in link (the existing `portal_link` email – it never names the programme). No daily reminder emails | `emailPortalLink` | Reminders would be a comms job |
| A11 | **Permissions** as notes: read `clinical.view`, write/share `clinical.write` (reception never; admins see but do not write by default); the patient must be in the member's sites | records service | Yes, with configurable permissions |
| A12 | **PDF**: the same A4 document for clinician and patient (title, for whom, by whom, note, each exercise with dose / instructions / take care / note / links printed as text, a Mon–Sun tick row), file name `home-exercises-<date>.pdf` (no name in the file name). A draft is marked "Draft – not shared". Footer line: "Stop and contact the clinic if an exercise causes sharp or worsening pain." (our only wording – **please confirm**) | `exercise-pdf.tsx` | Yes |
| A13 | **Switching the clinic setting off hides everything** (staff tab, portal) but keeps the data; anonymisation and the subject-access copy include it regardless | – | – |
| A14 | **Website:** nothing changed on clindesk.co.uk | – | – |

## 2. Tables (records, all `tenant_id` first, RLS on, Data API revoked; no new name in offboarding)

| # | Table | Key columns | Deleted by |
|---|---|---|---|
| 0126 | `pms_exercise_settings` | id `exercises`, records_id `records`, enabled, rev | cascade from `pms_records_settings` |
| 0126 | `pms_exercises` | name, body_area (fixed list), instructions, cautions, image_url, video_url (https CHECK), active, rev – **plain** (clinic configuration) | cascade from `pms_exercise_settings` |
| 0127 | `pms_exercise_programmes` | patient_id, case_id (app-checked), replaces_id (app-checked), status, **title_enc, notes_enc, items_enc**, item_count, shared_at/by/by_name, ended_at/by, patient_viewed_at, anonymised_at | cascade from `pms_patients` |
| 0128 | `pms_exercise_checkins` | programme_id + patient_id (composite FK), done_on (unique per programme), completed, pain_score, **comment_enc** | cascade from the programme |

Cascades keep the offboarding batch the same size (the offboard-batch test's flag "the next per-clinic table should
hang off an existing parent row"). A library write inserts the missing parent rows (`pms_records_settings`,
`pms_exercise_settings`) in its own batch. Before the migrations every read answers "off / nothing"
(`exerciseTablesInstalled`); history, anonymisation and subject access skip the tables.

## 3. Screens

- **Set-up → Exercises** (`/app/clinic/setup/exercises`, settings.setup): on/off, add an exercise, the library (edit,
  archive / put back), "Add demo exercises" on demo clinics.
- **Patient → Exercises** (`…/patients/<id>/exercises`, clinical.view): programmes with status, shared/opened, check-in
  summary; "Start a programme" (title + optional open case).
- **Patient → Exercises → programme** (`…/exercises/<programme>`): draft = builder (add from library / write your own,
  dose, reorder, remove, instructions/cautions/links, notes) + "Share with the patient" (optional email) + "Discard
  draft"; shared/ended = the exercises as given, "Make a new version", "End programme", the check-ins, "Print (PDF)"
  (`…/pdf`).
- **Portal home**: "Your exercises" (only when there is a shared programme). **Portal → programme**
  (`/clinics/<clinic>/portal/exercises/<programme>`): exercises, links, today's check-in, recent check-ins, "Download
  as PDF" (`…/pdf`).

## 4. Audit (ids, counts and statuses only – never a title, exercise, pain score or comment)

`pms.exercise_settings.update`, `pms.exercise.create|update|archive|restore`,
`pms.exercise_programme.create|save|share|end|view|pdf|portal_view|portal_pdf`, `pms.exercise_checkin.record`
(target = the programme, so the patient's History tab shows it). Opening a programme (`view`) and printing it (`pdf`)
are recorded like opening a clinical note.

## 5. Tests

- `src/server/pms/records/exercises.test.ts` (test:pms + test:db): pure rules (switch, links, dose, check-in input,
  adherence, labels) and the whole flow on **node:sqlite and PGlite**: both switches, settings.setup / clinical.view /
  clinical.write by role (reception and admin refused), another clinic, another site, wrong patient in the URL,
  encryption at rest, drafts invisible to the patient, locked after sharing, new version ends the old in one batch,
  one check-in per day, PDFs, history, subject access, anonymisation, offboarding by cascade, tenant-scope guard.
- Contract/route tests updated by registration (page permissions, nav, record tab, migration ranges and parity).
- `scripts/e2e/pms-exercises.cjs`: screens end to end (see the file's header for how to run it).

## 6. Open questions for Khuram

1. Confirm Option B (A1) – or park the branch.
2. Starter content (A2): commission drawings, own photos with the pilot clinic, or text-only? Who writes/checks the text?
3. Should clinicians edit the library (A3)?
4. Picture/video upload instead of links (A4)?
5. The PDF/portal safety line (A12) – keep, change or remove?
6. Reminder emails (A10) – wanted for the pilot?
