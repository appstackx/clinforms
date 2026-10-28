# Set-up, reports and dashboard – designs (M8)

Reference mockups from Claude Design (round 2c set-up and reports, round 3 dashboard per role and 375 px), as
received in `bh2-handover/k2-designs/`. Serve a folder over http (`python3 -I -m http.server <port> --bind 127.0.0.1`)
and open the `.dc.html`; `screenshots/` has a picture of each. Data, not code to run elsewhere.

| Folder | Built as |
|---|---|
| `set-up/Setup.dc.html` | Set-up → Sites and hours (`/app/clinic/setup/sites`); the other set-up pages follow its list + detail pattern |
| `reports/Reports.dc.html` | Reports (`/app/clinic/reports/*`) – attendance and DNA, utilisation, caseload, revenue, debtors, authorisations |
| `dashboard-per-role/Dashboard.dc.html` | "Today" (`/app/clinic`) for owners/administrators, clinicians and reception |
| `dashboard-375-px/DashboardMobile.dc.html` | "Today" at 375 px |

Changed on the way in: the site address postcode `NG1 0AA` (may be real) → the reserved fictional `ZZ99 9AA`
(the screenshot still shows the original). Differences between the build and the designs: handover §17.
