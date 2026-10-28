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

Differences from the mock-ups, and why, are listed in the commit message of the diary screens (feat/cs-diary): the day
sheet prints no phone numbers and dates of birth only when the clinic switches it on (K2-DIARY-017 and Khuram's
decision of 28/10/2026), the clash text keeps names' capitals (the mock-up lower-cased them).

Khuram's decisions of 28/10/2026, now built (matching the mock-ups):
- **A – double-booking.** A member holding "Override clashes" (`diary.override`) may double-book a PRACTITIONER,
  explicitly per booking or move ("Book anyway (double-booking is logged)" in the booking dialog, Shift+Enter in the
  keyboard move, "Move anyway" after a refused drag). It is audited with the clashing appointment's id and both
  blocks show a "Double-booked" marker (and a note in the drawer). Rooms and blocked time are never double-booked.
  The database enforces it (migrations 0118–0119): only a write whose `overbook_write_id` equals its new `write_id`
  passes the practitioner check; the room check is absolute.
- **B – "In treatment".** booked → arrived → in treatment → attended. "Start treatment" sets it (and opens the
  linked note for a clinician); undo goes back to arrived. "attended" reads **Completed** everywhere on screen. Stored
  as arrived + `treatment_started_at` (migration 0117), so billing and reports reading the raw status see "arrived".

Prototype A (`round2h/prototype-a-book-arrive-write-sign-note/`, outside the repo) is reproduced end to end by
`scripts/e2e/pms-prototype-a.cjs`.

---

# Round 2 designs (28/10/2026)

**Internal.** 28/10/2026. Seven screens exported (and the records area's patients set, `round2/patients/`, added with feat/cs-records) from Claude Design as standalone pages (`round2/<screen>/`: the
`.dc.html` artboard, `support.js` and `vendor/react*.js` – the runtime that renders it, not part of the design – and
the export's `README.md`), plus a 1440 px screenshot of each in `round2/screenshots/`. Fictional data only
(`@example.com`, `07700 900xxx`, `PH-DEMO-0N`, made-up people and sites); checked for secrets before committing.
Treat the HTML as a reference mock-up: view it by serving the folder over http on a K2 port (e.g.
`python3 -m http.server 3190` inside the folder) – some browsers block the scripts over `file://`.

| Folder | Screen | Screenshot | Built |
|---|---|---|---|
| `round2/roles-and-permissions-grid-by-role/` (`Roles.dc.html`) | Set-up → Roles and permissions: the permission grid by role, locked cells, Custom markers, unsaved state, review-and-save confirm, change history | `screenshots/Roles.png` | Yes – `/app/clinic/access/roles` (feat/cs-access) |
| `round2/member-access-one-person/` (`MemberAccess.dc.html`) | Staff access → one member: role, exceptions, works at / can see per site, signing details, "What X can do" | `screenshots/MemberAccess.png` | Yes – `/app/clinic/access/<user>` (feat/cs-access) |
| `round2/patients/` ([README](round2/patients/README.md)) | Patients list and new patient, patient record by role, clinical-note editor (sign, amend, unsigned notes), patients at 375 px | `round2/patients/screenshots/` | Yes – `/app/clinic/patients` (feat/cs-records) |
| `round2/set-up/` (`Setup.dc.html`) | Set-up home with its sections (incl. the Staff access list) | `screenshots/Setup.png` | Later (reporting) |
| `round2/billing-invoices-aged-debt-remittance/` (`BillingList.dc.html`) | Billing: invoices, aged debt, remittance | `screenshots/BillingList.png` | Yes – `/app/clinic/billing` (feat/cs-billing, M5; see Round 3 – billing) |
| `round2/messages-outbox-templates-letters-replies/` (`Messages.dc.html`) | Messages: outbox, templates, letters, replies | `screenshots/Messages.png` | Later (comms) |
| `round2/reports/` (`Reports.dc.html`) | Reports | `screenshots/Reports.png` | Later (reporting) |
| `round2/import-from-previous-system/` (`Import.dc.html`) | Import from the previous system | `screenshots/Import.png` | Later (integration) |

Original exports: `~/Downloads/<screen name>-html.zip` on Khuram's machine.

## Round 3 – billing (M5, 28/10/2026)

`round3/billing/` – the billing screens' reference mock-ups (round 2f invoice detail and round 3), each a folder with
its `*.dc.html`, `README.md`, `support.js` and `vendor/`; screenshots in `round3/billing/screenshots/`. Serve a folder
over http on a K2 port (e.g. `python3 -m http.server 3190`) and open the `.dc.html`. Fictional data only.

**Postcodes:** the exports used `NG1 0AA`, `NG1 0AB`, `NG2 0CD`, `NG2 0ZZ` and `NG3 0AA`, which may be real
addresses. In these copies they are replaced with
`ZZ99 9AA`, `ZZ99 9AB`, `ZZ99 9CD`, `ZZ99 9YY` and `ZZ99 9AD`: the outward code `ZZ99` is the NHS pseudo-postcode
area – it is never a Royal Mail postcode, so it can never be someone's address (the `9xx` units avoid the NHS's own
`ZZ99 3xZ` meanings). The PNGs of the invoice detail and both prints were re-rendered from the corrected HTML; the
take-payment, invoice-visits and remittance screenshots show no postcode. The app itself refuses `ZZ99` for a real
patient's address (UK postcode check), so the demo seed keeps its existing `MK… 9ZZ` units. Still to replace (not
billing): `round2/set-up/` and `round2/import-from-previous-system/` carry one such postcode each.

| Folder | Screen | Screenshot | Built in |
|---|---|---|---|
| `invoice-detail-insurer-split-payment/` (`InvoiceDetail.dc.html`, round 2f) | One invoice: insured split, items with excess, payments and adjustments, PDF preview, actions | `InvoiceDetail.png` | `/app/clinic/billing/invoices/[id]`, `src/components/pms/billing/invoice-detail.tsx` |
| `take-payment-dialog/` (`TakePayment.dc.html`) | Take payment: amount, method, pay towards, receipt | `TakePayment.png` | `src/components/pms/billing/take-payment-dialog.tsx` (diary drawer, record, invoice) |
| `take-payment-375-px/` | Take payment at 375 px (full-screen sheet) | `TakePaymentMobile.png` | same component, below the `md` breakpoint |
| `invoice-attended-visits/` (`InvoiceVisits.dc.html`) | Invoice visits: choose → preview drafts → issue | `InvoiceVisits.png` | `/app/clinic/billing/visits`, `src/components/pms/billing/visits-table.tsx` |
| `remittance-allocation/` (`Remittance.dc.html`) | Allocate an insurer payment, shortfalls, summary | `Remittance.png` | `/app/clinic/billing/remittances/new`, `src/components/pms/billing/remittance-form.tsx` |
| `print-invoice-a4/` (`PrintInvoice.dc.html`) | Printed invoice (A4) | `PrintInvoice.png` | `/app/clinic/billing/invoices/[id]/print`, `src/components/pms/billing/print-sheets.tsx` |
| `print-patient-statement-a4/` (`PrintStatement.dc.html`) | Printed patient statement (A4) | `PrintStatement.png` | `/app/clinic/billing/statements/print` |
