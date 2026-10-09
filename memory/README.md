# Memory index

Deep memory for ClinForms (two-tier convention: `../CLAUDE.md` is the hot cache auto-loaded every session; this folder holds the detail). Written 2026-10-09 at the hand-off from the cloud session to the Claude desktop app. **No secrets are stored here** – values live in `.env.local` (not in git).

**Read first:** `next-steps.md` (what to do now, ready-to-paste prompts) → `decisions.md` (top rows) → the project file for the task at hand.
**Update at the end of every session:** `next-steps.md`, `decisions.md` (new rows on top), `history.md` (append), the status snapshot in `../CLAUDE.md`, and any project/context file that changed.

| File | One line |
|---|---|
| `next-steps.md` | Prioritised backlog (RED demo P0 → Vercel → Supabase → Cloudflare question → converter → hardening), questions for Khuram, ready-to-paste prompts |
| `decisions.md` | Dated decision log, newest first, with who/why/status (incl. open questions) |
| `history.md` | Timeline 06–09/10/2026 (UTC), workflow runs, lessons learned and gotchas |
| `assets.md` | Every deliverable and where it lives; what was NOT preserved from the cloud container |
| `glossary.md` | Decoder ring: acronyms, internal terms, old names (AppStackX Reports, medreport, CareConnect), people, fictional demo entities |
| `people/khuram-masood.md` | The user: role, accounts, working style, verbatim decisions, open questions |
| `people/dell-baines.md` | Blue Heart Clinics owner: aliases, background, his asks, what he's seen, questions to ask |
| `people/daniel-vatamanu.md` | RED Physiotherapy co-founder: contact details, thread summary, unknowns |
| `projects/clinforms.md` | Product + technical deep dive (flow, stack, AI config, demo data, live-demo gotchas, limits, roadmap); links to repo docs |
| `projects/blue-heart-clinics.md` | Deal file: company research, all emails verbatim, answers to Dell's 5 questions, pricing, commitments, status |
| `projects/red-physiotherapy.md` | Deal file: emails verbatim, assessment, insurer support matrix draft, Tuesday demo plan, questions |
| `projects/careconnect-mk.md` | Origin repo: branch, commit history, what remains, cleanup options |
| `context/company.md` | AppStackX facts, tools/connectors/accounts (GitHub, Anthropic, ElevenLabs, Vercel…), market and name checks |
| `context/pricing.md` | All price tiers, founding offer, reasoning, ROI model, our cost base |
| `context/hosting-and-infra.md` | Vercel decision, Cloudflare blockers, Supabase architecture + API notes, converter, regions, environment lessons |
| `context/insurer-forms.md` | Every insurer/referrer form with URL, public PDF vs portal, handling and priority |
| `context/compliance.md` | GDPR/DPA commitments, disclosure rule, data minimisation, security built vs promised |
| `sources/blue-heart-briefing.md` | Verbatim: Blue Heart research briefing (06/10) |
| `sources/report-builder-plan.md` | Verbatim: the original approved plan (06/10 12:31 UTC, pre-pivot) |
| `sources/red-physio-demo-task.md` | Verbatim: the RED demo task prompt handed over 09/10 15:26 UTC, plus two marked memory-pack annotations (enriched, corrected version in `next-steps.md` §1) |
| `sources/cv-live.md` | Build note (07/10 00:35): live re-record + E2E report – forms-5 rules, live timings, scripted-demo differences |
| `sources/cv-wording.md` | Build note (07/10): neutral-wording audit fix for case export (`ai_narrative` → `narrative`) |
| `sources/foundation-contract.md` | Build report (06/10, foundation run `wuu36wj9g`): contract + skeleton, 13/13 tests, 16 departures from the spec, key exports |
| `sources/report-integration.md` | Build report (06/10, 6-slice build `wbt0eybc1`): connectors, auth, data endpoints, 50/50 tests, requests to orchestrator |
| `sources/report-sandbox.md` | Build report (06/10, 6-slice build `wbt0eybc1`): simulated TM3 API + sandbox UI + launch action, 26/26 sandbox tests |
| `sources/forms-contract.md` | Build report (06/10, forms rebuild `wlyznsko8`): referrer-forms contract, packages, 90/90 tests, departures, handoffs |
| `sources/forms-integration.md` | Build report (06/10 evening, `wlyznsko8`): integrator stage, 173 tests, credit ran out, live/demo timings, rough edges |
| `sources/forms-fixed.md` | Build report (06/10 ~20:39, `wlyznsko8`): 14 security fixes + product fixes, 214/214, E2E 34/34, deliberately-left items |

The six build reports are historical (careconnect-mk era, pre-Sonnet, pre-rename); the module README supersedes them.

Related repo docs (authoritative for code): `../README.md`, `../docs/plan.md`, `../src/modules/medreport/README.md`, `../assets/sales/blue-heart/README.md`, `../scripts/medreport/video/README.md`.

Conventions: times are UTC unless marked (UK = BST, UTC+1, in October 2026); **(unverified)** = not confirmed by Khuram or a source; [C] public source, [I] inference, [U] unknown (research files).
