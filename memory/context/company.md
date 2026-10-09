# AppStackX – company context

## Facts (as stated in conversation; anything else unverified)
| | |
|---|---|
| Brand | **AppStackX** (CareConnect banner, ClinForms vendor, email sign-offs) |
| Legal name | "**AppstackX Ltd**" (Khuram's email signature). Company number, registered address and VAT status **not stated (unverified)** |
| People | Only **Khuram Masood** appears (founder/owner/sales/product – title unverified) |
| Prospect email | `khuram@appstackx.co.uk` (Google Workspace Gmail) |
| Website | `appstackx.co.uk` (agency site; ClinForms page metadata author link) |
| GitHub org | `appstackx` (login `appstackx`, id 204474745 per `get_me` on 09/10) |
| Products | **ClinForms** (forms SaaS, `appstackx/clinforms`, private) and **CareConnect MK** (patient-portal portfolio demo, `appstackx/careconnect-mk`) |
| Product domains | `clinforms.co.uk` (primary), `clinforms.com` – Khuram said he'd reserve them (09/10 14:34 UTC); **registration unverified**. Interim idea (never decided): `reports.appstackx.co.uk` |

## Tools, accounts and connectors
| Tool | Used for | Notes |
|---|---|---|
| **Claude Code (cloud, 06–09/10)** | All build work so far | Moved to the **Claude desktop app** on Khuram's Mac from 09/10 because the cloud egress proxy blocked insurer sites, Companies House, Vercel and Supabase APIs |
| **GitHub** | `appstackx/clinforms`, `appstackx/careconnect-mk` | Claude GitHub App **cannot create repos** (403 "Resource not accessible by integration"); Khuram creates them at github.com/new; add the repo at claude.ai/connect-github if the app uses "selected repositories" |
| **Anthropic API** | Live drafting + form analysis (`ANTHROPIC_API_KEY`) | Credit ran out 06/10 ~20:40 and 09/10 07:36–07:52 UTC; topped up 06/10 21:31 and 09/10 ~08:10. Key pasted in chat 06/10 → **rotate**. Recommend a spend-limited workspace + spend alerts |
| **ElevenLabs** | Voice-over for the Dell video | Restricted connector (speech only; image/video/music need the full connector at `https://api.elevenlabs.io/v1/mcp`). The connector writes to **its own workspace**, not the "ElevenCreative" workspace Khuram views. Flow "AppStackX demo voice-over – Blue Heart Clinics", id `gfLay4qckJq49KVb4Ghd` (`https://elevenlabs.io/app/flows/gfLay4qckJq49KVb4Ghd`). To find it: bottom-left workspace switcher → other workspace → Flows. (The switch link sent in chat carried a one-time workspace code – deliberately not stored.) Voice **Beth** `utezIGbCLSGO3Z7oKJwL`, model `eleven_v4`. Cost ~4,600 credits (~$0.85) + Scribe QA 2,064 credits (~$0.38) |
| **Gmail** (connector available) | Prospect email | Never used by the agent; drafts were offered twice (06/10) but not created. Could save reply drafts if Khuram asks |
| **Google Drive** (connector available) | – | One search 09/10 15:41 for insurer PDFs: nothing. Query syntax: `title contains '…'` |
| **Vercel** | Chosen host | Plan unconfirmed (Pro recommended). No access from the cloud; Khuram imports the repo or gives a token |
| **Supabase** | Planned DB (London) | Not set up; needs account/org + personal access token (env var) |
| **Cloudflare** | Considered | Not used |
| **Workflow tool** | Multi-agent build/verify runs | Khuram invokes `/workflow-authoring` for big tasks |
| Datadog / BigQuery plugins | Not used | Need authorisation; irrelevant |

## Products in one line each
- **ClinForms** – completes each referrer's own report form (MLC/insurer/solicitor/case manager/employer) in its original layout from clinic notes, with clinician approval. See `memory/projects/clinforms.md`.
- **CareConnect MK** – patient-portal demo used as a portfolio piece; not for sale as-is. See `memory/projects/careconnect-mk.md`.

## Market notes
- UK health-cover market grew £825m in a year to £7.59bn (LaingBuisson, via Khuram's pasted research).
- Competitor inside TM3: **Heidi** (AI scribe; drafts insurer reports/discharge summaries from one session; UK annual ≈ £50/mo). ClinForms' edge: the referrer's own form in its original layout, whole course of treatment, citations, gap flags, clinician approval, batch.
- TM3 price ≈ £50/mo (TM3) – £60/mo (TM3 Connect) [Capterra snippet]. Physitrack £39.99/user/mo.
- Name check (09/10): no product called "ClinForms" found; nearest **ClientForms** (Australian, Cliniko connected app: cliniko.com/connected-apps/clientforms); also Epro "Clinical Forms" (NHS) and ClinCapture (trials) – not direct clashes. **UK IPO trademark search for "ClinForms", classes 9 and 42, pending.**
- Other names considered 09/10: ReportReady (reportready.co.uk), ReferForm (referform.co.uk), NoteToForm (notetoform.com), ReportBridge (.co.uk taken; .io free). Likely taken: formbridge.co.uk, completa.health, formready.co.uk. "Free" = no DNS record only.
