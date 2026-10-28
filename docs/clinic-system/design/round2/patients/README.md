# Round 2 – patients and clinical notes (records module)

**Internal.** 28/10/2026. Reference mock-ups made in a visual design tool (Claude Design, round "2e"), approved by
Khuram for the records screens. Fictional data only. Treat them as references, not code: the values to copy are in
each artboard's inline styles; `support.js` and `vendor/react*.js` are only the runtime that renders them.

| File | Screen | Variants (props in the artboard) |
|---|---|---|
| `PatientList.dc.html` | Patients – list, states, new patient | `state`: ready / loading / empty / error; "New patient" opens the drawer |
| `PatientRecord.dc.html` | Patient record – header and tabs by role | `role`: clinician / reception / owner (reception: no clinical tabs, flags or "New note") |
| `NoteEditor.dc.html` | Clinical note – editor, sign, amend, unsigned list | draft → "Sign and lock" dialog → signed → "Add amendment" |
| `PatientMobile.dc.html` | Patients at 375 px – list and record | tap a patient to open the record |
| `screenshots/*.png` | The default state of each at 1440 px (375 px for the mobile one) | |

View: serve this folder over http (e.g. `python3 -m http.server 3196`) and open a `.dc.html` file; links between
artboards (AppShell, BookingDialog…) point at other rounds and are not included.

Built on `feat/cs-records`: `src/app/app/clinic/patients/**`, `src/components/pms/records/**`. Differences from the
mock-ups and why are listed in the records commit message and `scripts/e2e/pms-records-screens.cjs`.
