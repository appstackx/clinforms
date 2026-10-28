# Clinic system – design v1

**Internal.** 27/10/2026. Made with Claude Design from `K2-DESIGN-PROMPT.md`; approved by Khuram as the design
for the clinic system's screens. Fictional data only (names, `@example.com` addresses, `07700 900xxx` numbers,
organisations ending "(fictional)").

| File | What |
|---|---|
| `design-system-v1.pdf` | The design system as 3 pages: colour tokens, type, spacing, buttons, inputs, status pills, diary blocks, tables / filters / pagination / tabs, table → cards at 375 px, loading skeleton, notices, toasts, empty and error states, dialogs, side drawer, site switcher, avatars, keyboard hints. |
| `clinic-system-design-v1.html` | The Claude Design export, self-contained (fonts packed in; React 18.3.1 is loaded from jsDelivr when opened). Two frames: the **design system** as live markup, and the interactive **app shell** (product switch, site switcher, patient search with "/", user menu, left navigation by role – owner / clinician / reception). Open it in a browser; treat it as a reference, not code to ship. |

## Where it lives in code

- Tokens (additive): `src/app/globals.css` (`--primary-strong`, `--accent-text`, `--destructive-strong`,
  `--input-strong`) and `tailwind.config.ts`.
- Component kit: `src/components/pms/ui/` (index: `src/components/pms/ui/index.ts`).
- App shell: `src/app/app/clinic/layout.tsx` + `src/components/pms/shell/`.
- Side-by-side preview of every component: `/app/clinic/design-system` (clinic package, owners and administrators).

## Known differences from the design

See the kit's commit message (feat/cs-ui) – e.g. the shell's nav shows only the modules whose screens exist, the
user menu has "My account and security" (there is no profile/signature page yet), and avatar colours come from a
hash of the name, so the example people get different colours than in the mock-up.

## Round 2 – diary (approved 28/10/2026)

`round2/diary/` – six reference mock-ups exported from the design tool, each a folder with its `*.dc.html` artboard,
`README.md`, `support.js` and `vendor/` (the runtime that renders it – not part of the design). Serve a folder over
http (e.g. `python3 -m http.server 3185`) and open the `.dc.html`. Screenshots: `round2/diary/screenshots/`.
Fictional data only.

| Folder | Screen | Built in |
|---|---|---|
| `diary-day-view-site-practitioners-rooms/` | Day view: practitioner or room columns, drawer, keyboard move | `src/app/app/clinic/diary/page.tsx`, `src/components/pms/diary/{diary-screen,diary-grid,appointment-drawer}.tsx` |
| `diary-week-view-per-practitioner/` | Week of one practitioner (or room) | same page, `view=week` |
| `booking-dialog-find-create-patient-recurring-clash/` | New appointment: find/create patient, case and payer, clash, repeat | `src/components/pms/diary/booking-dialog.tsx` |
| `rota-editor-waiting-list/` | Rota editor and waiting list | `src/app/app/clinic/diary/{rotas,waiting-list}/page.tsx`, `src/components/pms/diary/rota-waiting.tsx` |
| `print-day-sheet-a4/` | Printed day sheet (A4 portrait) | `src/app/app/clinic/diary/day-sheet/page.tsx` |
| `diary-375-px/` | Phone diary ("My diary") | `src/components/pms/diary/mobile-diary.tsx` |

Differences from the mock-ups, and why, are listed in the commit message of the diary screens (feat/cs-diary): no
"In treatment" status in the diary (Start treatment opens a clinical note), "Book anyway" only over the patient's own
other appointment (a practitioner or room is never double-booked – K2-DIARY-006), the day sheet prints no phone
numbers and dates of birth only when the clinic switches it on (K2-DIARY-017 and Khuram's decision of 28/10/2026),
the clash text keeps names' capitals (the mock-up lower-cased them).
