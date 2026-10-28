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

## Round 2 (per area)

| Folder | What | Built on |
|---|---|---|
| [`round2/patients/`](round2/patients/README.md) | Patients list and new patient, patient record by role, clinical-note editor (sign, amend, unsigned notes), patients at 375 px | `feat/cs-records` |
