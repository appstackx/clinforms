# careconnect-mk (origin repo)

**What it is:** `github.com/appstackx/careconnect-mk` – AppStackX's **patient-portal portfolio demo** ("CareConnect MK": booking, prescriptions, records, messages; mock data, no backend; orange banner "This is a portfolio demo by AppStackX"; demo patient "Sarah Mitchell"; mock tiers Free £0 / Premium £9.99/mo / Practice £299/mo "For healthcare providers"). Planned URL `careconnect-mk.vercel.app` (unverified whether a Vercel project exists).
**Relation to ClinForms:** ClinForms was first built **inside** this repo as module `src/modules/medreport` ("AppStackX Reports") next to the portal, then extracted to `appstackx/clinforms` on 09/10/2026. The two products share nothing now.

## Branches and commits
- `main` = **`66fac86`** ("Fix missing Tabs component imports in appointments page") – portal only, **untouched** by this work.
- Work branch **`claude/confident-noether-z6l7kr`**, head **`ff05fab3ad9563f12b596f7fed5ff7cbea67c554`** (09/10 12:58 UTC), pushed, clean, **never merged**. vs `main`: 339 files changed; outside the new trees only `.env.example`, `.eslintrc.json`, `docs/medreport-plan.md`, `package.json`, `package-lock.json`, `tailwind.config.ts` (+2 lines). Portal code untouched.

| SHA | Time (UTC) | Message |
|---|---|---|
| `785b0b0` | 06/10 14:03 | Add dependencies for AppStackX Reports module |
| `72ce8e1` | 06/10 14:45 | Foundation: contract, skeleton, simulated TM3 data (141 files) |
| `382afe2` | 06/10 14:52 | WIP |
| `8ba2775` | 06/10 15:23 | WIP: sandbox, connectors, auth done (paused for Dell's pivot) |
| `6272675` | 06/10 16:21 | Form-handling dependencies |
| `08a0aac` | 06/10 20:41 | Complete referrer forms in their original layout (214/214 tests, E2E 34/34, 14 security findings fixed) |
| `9027640`, `de40876` | 06/10 21:15, 21:35 | WIP video recorder |
| `e399b4c` | 06/10 22:03 | WIP neutral wording (after container restart) |
| `d059618` | 06/10 22:19 | Neutral customer-facing wording (224/224) |
| `a33786c` | 09/10 07:22 | Re-record drafts, forms-5, rate-limit retry |
| `060a3a6` | 09/10 08:11 | WIP Sonnet switch |
| `21518e7` | 09/10 10:17 | Sonnet 5.5 + forms-7 / prompt 2 (243/243, E2E 42/42) |
| `530be25` | 09/10 10:17 | WIP video recorder |
| `ff05fab` | 09/10 12:58 | Dell-addressed video recorder (also touched upload dialog, preview panel, review header) |

## What remains there
The full module as "AppStackX Reports" (pre-rename), the sandbox, routes, scripts, `docs/medreport-plan.md`. Its gitignored `.env.local` in the cloud container held the live secrets – ephemeral, never copied.

## Cleanup plan (offered, not decided)
- Options: (a) leave the branch as an archive (simplest; recommended until Khuram decides), (b) delete the branch, (c) nothing else – **do not merge it into careconnect-mk `main`**. The 09/10 13:52 offer to open a PR was not taken up.
- Optional cross-sell: a "For clinics" link on CareConnect's landing page (e.g. within the £299 Practice tier) pointing to ClinForms – idea only (13:56 UTC).
- Ask Khuram before touching this repo.
