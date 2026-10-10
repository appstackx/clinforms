# ClinForms – working memory (hot cache)

Last updated: **Fri 2026-10-09 ~23:20 UTC** (branch `demo/red-physio`: RED demo pack built, reviewed, fixed and
rehearsed; call pack `docs/demo-red-physio.md` written; earlier hand-off from the cloud session at ~16:00 UTC). Deep memory lives in `memory/` (index: `memory/README.md`).

## Start here (every new session)
1. Read **`memory/next-steps.md`** (prioritised backlog, ready-to-paste prompts) and **`memory/README.md`**
   (index). Pull detail from `memory/projects/*`, `memory/context/*`, `memory/people/*` as needed.
2. Check repo state: `git fetch && git worktree list && git log --oneline -5`, `git status`, Node 22, `npm ci`.
   Branches: `main` (= `demo/red-physio` since 10/10: RED demo + call pack; deployed to clinforms.co.uk), `demo/red-physio` (worktree
   `clinforms-wt/red-integrate`), `feat/production` (production line; worktree `clinforms-wt/p-integrate`).
3. **The RED Physiotherapy call is Tue 13 Oct 2026, morning** (exact time: check the invite). **Demo pack and call
   pack are DONE** on `main` (merged from `demo/red-physio`): `npm run demo:red` from `~/Projects/Appstackx/clinforms` with the gitignored
   `clinforms/demo-assets/insurers/` (6 insurer PDFs, 7 maps incl. our own portal question set, 4 answer files);
   **call pack `docs/demo-red-physio.md`** (support matrix, Monday/Tuesday checklist, 10-minute script, honest
   answers, fallbacks). Left for Khuram: one rehearsal in his own Chrome (Monday evening), the call itself.
   **Budget:** the Claude weekly usage limit last reset Fri 09/10 06:00 UTC; next reset probably Fri 16/10 06:00 UTC
   (unverified) – i.e. AFTER the RED call. Work lean until then (single session or small workflows, no multi-agent
   fan-outs or full video re-records); commit after each verified step so a limit hit loses nothing.
4. At the **end of every working session**: update `memory/next-steps.md`, add dated rows to
   `memory/decisions.md` (newest first) and `memory/history.md`, refresh the status snapshot below, commit.
5. **Never put secrets in memory or git** (keys, passcodes, tokens, signing secrets, workspace codes).
   Write "set in `.env.local` (not in git)" instead.

## Me
**Khuram Masood**, runs **AppStackX** (legal name in his signature: **AppstackX Ltd**), a UK software
agency. Sells to UK physio clinics. Prospect email: `khuram@appstackx.co.uk`. UK time (BST = UTC+1;
transcript times in memory are UTC). Mac + Chrome + Gmail. He decides everything; the agent proposes.

## How Khuram works (preferences)
- **Plan first, build after he approves** anything big ("let's plan first, once i approve you build it").
- Short messages with typos; wants concise answers, tables, one clear recommendation, exact next steps.
- Deadline-driven; asks for status often. Give honest estimates (label them), flag blockers immediately.
- Cost-conscious: cheapest suitable model ("like sonnet"), real hosting cost comparisons.
- Likes orchestrated multi-agent workflows (`/workflow-authoring`) with independent verification.
- Wants demos he can send or show (videos with voice-over, live demos). Uses ElevenLabs + Gmail.
- "make sure memory has all the details so new window do not forget things" – keep memory current.

## Hard rules
- **No "AI", "Claude", model or vendor names in anything customer-facing** (screens, docs, emails, videos,
  file names). Neutral wording lives in `src/modules/medreport/core/wording.ts` (single source; `ui/wording.ts`
  only re-exports it – edit core, and switch `DISCLOSURE` there), guarded by
  `scripts/medreport/neutral-wording.test.ts`. Still disclose truthfully: the DPA names **Anthropic as
  sub-processor**, and answer honestly if a customer asks.
- **Fictional data only.** No real patient data until DPA + DPIA + UK hosting + safeguards exist.
  Organisations end "(fictional)"; HCPC-style numbers use the invalid `PH-DEMO-0N` format – **fictional clinicians
  only, never a patient label** (patients are `sim-pat-00N`; next free `sim-pat-007`).
- Simulated TM3 is always labelled **"Simulated TM3 sandbox – demo data, not affiliated with TM3"**
  (verbatim). No TM3 logo/colours; never imply a TM3 partnership; never claim a direct TM3 link.
- **Never commit secrets** (`.env.local` is gitignored) **or third-party insurer PDFs** (gitignored
  `/demo-assets/`). Scan staged diffs (e.g. for `sk-ant-`) before every commit.
- Public insurer forms: footer "Public form used for demonstration only – not affiliated with or endorsed
  by <insurer>. Fictional patient data."; private demos only; never claim they are the prospect's forms.
- Opinions (prognosis, causation, fitness for work) are only attributed if a clinician recorded them.
- Don't rename internal IDs (`appstackx-reports.*`, HMAC labels, `medreport.` keys, `/api/reports/v1`).
- Don't rebuild bundled demo forms casually (`npm run medreport:forms`): recordings are keyed to bytes.
- Work on feature branches; no PRs unless asked. Commit trailer: use the attribution lines this session's
  own instructions give (cloud sessions used `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` +
  a `Claude-Session:` URL).
- Product name is **ClinForms** everywhere now – not "AppStackX Reports", not "CareConnect".

## People
| Who | Role |
|---|---|
| **Dell** | **Dell Baines** (Companies House: Dell David Henson-Baines), owner/director, **Blue Heart Clinics** (11 sites, uses **TM3**). Buyer, no longer treats patients. → `memory/people/dell-baines.md` |
| **Daniel** | **Daniel Vatamanu**, co-founder, **RED Physiotherapy** (Milton Keynes, Towcester, Northampton). Asked "Which insurers do you support?". Call **Tue 13 Oct, morning**; call pack `docs/demo-red-physio.md`. → `memory/people/daniel-vatamanu.md` |
| **Megan Hart** | FICTIONAL demo patient `sim-pat-001` (RTA whiplash, Harrow & Pike solicitor) |
| **Daniel Brooks** | FICTIONAL demo patient `sim-pat-002` (warehouse back injury, employer) – not Daniel Vatamanu! |
| **Sarah Reid / Tom Ellis** | FICTIONAL physios `PH-DEMO-01` / `PH-DEMO-02` |
| **Beth** | ElevenLabs voice `utezIGbCLSGO3Z7oKJwL` used for the Dell video narration |
→ Full list: `memory/glossary.md`; profiles: `memory/people/`

## Terms
| Term | Meaning |
|---|---|
| **MLC** | Medico-legal company – intermediary that instructs clinics and sends its own report forms |
| **TM3** | Physio practice-management system (Blue Heart's). We only simulate it |
| **PMS** | Practice-management system (TM3, Cliniko…) |
| **PMI** | Private medical insurance/insurer (Bupa, AXA, Aviva, Vitality, WPA) – RED's referrers |
| **RTA / WAD** | Road traffic accident / whiplash-associated disorder (Megan's case: WAD II) |
| **HCPC** | Health and Care Professions Council – physio registration number on approvals |
| **referrer form** | The MLC/insurer/solicitor/employer's own Word/PDF form that ClinForms completes |
| **form map** | Per-form map of questions → anchor (where the answer goes) + fill source; confirmed once by staff |
| **AcroForm** | Fillable PDF (fully supported). **Flat PDF** = no fields, best effort. **Scanned** = riskiest |
| **SignReceipt** | Server HMAC-signed approval receipt bound to the report's content hash |
| **recorded drafts** | Real model output frozen into JSON for demo mode (`ai/demo-drafts/`, `ai/recorded/forms/`) |
| **demo / live / auto** | `MEDREPORT_AI_MODE`: demo = no AI calls; live = key + passcode; auto = live if possible |
| **medreport** | Internal module name (`src/modules/medreport`) = the product code |
| **Studio** | The review-and-approve UI at `/reports` |
| **DPA / DPIA** | Data processing agreement / data protection impact assessment |
→ Full glossary (incl. old names "AppStackX Reports", "CareConnect"): `memory/glossary.md`

## Projects
| Name | What | Status |
|---|---|---|
| **ClinForms** | The product: completes each referrer's own form, original layout, from clinic notes | Demo-grade; a pre-RED build live at **clinforms.co.uk** (Vercel); production line on `feat/production` → `memory/projects/clinforms.md` |
| **Blue Heart deal** | Dell; MLC/case-manager forms; voiced 6:15 video made 09/10 | Waiting on Dell (video send unconfirmed) → `memory/projects/blue-heart-clinics.md` |
| **RED deal** | Daniel; insurer (PMI) forms; call Tue 13 Oct, morning | **Demo + call pack ready** (`npm run demo:red`, `docs/demo-red-physio.md`); Khuram rehearses Monday → `memory/projects/red-physiotherapy.md` |
| **careconnect-mk** | Origin repo (patient-portal portfolio demo); module first built on branch `claude/confident-noether-z6l7kr` @ `ff05fab` | Superseded; unmerged → `memory/projects/careconnect-mk.md` |

## Status snapshot (2026-10-09 ~23:20 UTC)
- **Repo:** `github.com/appstackx/clinforms` (private).
  - `main` = `c6a2850` (memory pack; app `e799c51`): tsc, lint, **243/243** `test:medreport`, sandbox 26/26, build.
    **Deployed (a pre-RED build, prompt as on `main`):** `https://clinforms.co.uk` (Vercel project `clinforms`, team `khuram99gmailcoms-projects`, `lhr1`,
    **Hobby for now**; `www` → apex; health 22:53 UTC: ClinForms, prompt `form-analysis-3`, live drafting available
    behind the passcode). Production branch = `main`.
  - `demo/red-physio` (worktree `clinforms-wt/red-integrate`): RED waves 1–2 + review fixes + call pack; **448 tests,
    445 pass, 3 skipped** (LibreOffice), typecheck, lint, build, `demo:check` OK. Not pushed since wave 2 (the
    orchestrator pushes). Prompts `form-analysis-4` / `rules-2` (analysis), `forms-7` (drafting).
  - `feat/production` (worktree `clinforms-wt/p-integrate`, `ec76a0a`): Better Auth (invite-only, TOTP two-step),
    Kysely data layer, encrypted storage, public site, tenant Studio `/app/studio`, admin pages. Contract:
    `docs/production-architecture.md` (+ `docs/auth.md`, `docs/database.md`) on that branch. Not merged, not deployed.
- **Infra ids (no secrets):** Cloudflare account `appstackx-demos` (`a04ab546d0f1be2aa339bafebcdb3ffa`), D1 (EU)
  `clinforms-prod` (`c1a631fe-9cf0-414d-ab2f-28f7291282e3`) / `clinforms-preview`
  (`3a548cc6-45d9-4dc5-b308-23a75534dcc9`), gateway Workers `clinforms-data` / `clinforms-data-preview`; PostHog EU
  org "ClinForms", project **300254**; email via MailerSend. Supabase Postgres London later (when a clinic pays).
  Secret values: `.env.local` and `~/.config/appstackx/clinforms.secrets.env` (never in git).
- **Built (demo):** forms library + map confirm, completion from simulated TM3 / export upload / notes PDF,
  cited drafting (Claude **Sonnet 5.5**, `claude-sonnet-5-5`), validators, review + approval, Word/PDF in
  original layout, file-back to simulated TM3, batch, Security & GDPR page, insurer PDFs (fillable/flat, tables,
  parties, prefill-only forms), portal question sets with copy-ready answers. Reports stored in browser.
- **Not built:** Word→PDF converter service, real TM3 connector, billing; auth/database only on `feat/production`.
- **Dell video:** `assets/sales/blue-heart/AppStackX-Reports-demo-Blue-Heart-Clinics-voiceover-v2.mp4`
  (6:15, 17.7 MB). Whether Khuram emailed it to Dell is **unverified** – ask.

## Top next actions (detail + prompts in `memory/next-steps.md`)
1. **RED call** (Tue 13 Oct, morning) – everything is in **`docs/demo-red-physio.md`**: Monday-evening rehearsal in a
   separate "ClinForms demo" Chrome profile from the worktree; Tuesday morning `npm run demo:red -- --skip-build`,
   pre-upload AXA + Aviva CM016, Bupa uploaded live; Bupa end to end → AXA identifier block (never type AXA numbers
   or approve AXA) → portal questions (prognosis gap) → Aviva 30 s (prefill) → ask for 2–3 blank forms. After the
   call: record Daniel's answers in `memory/projects/red-physiotherapy.md` §7.
2. **Production line** (`feat/production`) – review with Khuram before merging to `main` (= deploying to
   clinforms.co.uk). Vercel Hobby is non-commercial: move to Pro before a paying clinic.
3. **Ask Khuram** (one message): RED call time; key rotated?; Dell video sent/replied?; price line for RED (if asked).
4. **Supabase** – later, when a paying clinic signs (D39); migrations and clinic scripts already on `feat/production`.
5. **Rotate every Anthropic key** that was ever in the cloud container (the one pasted in chat 06/10 12:18 + a second
   key file the 09/10 build report mentions) and treat the old `careconnect-mk/.env.local` passcode, launch/signing/
   partner secrets and `TM3_SIM_TOKEN` as burned – new values only (Khuram action; `memory/context/compliance.md` §7).

## Key commands
```bash
npm ci && npm run dev                      # open http://localhost:3000/reports (demo mode with empty env; on feat/production "/" is the public site)
npm run typecheck && npm run lint && npm run test:medreport && npm run test:db && npm run test:auth \
  && npm run test:site && npm run test:gateway && npm run build   # full check chain (production branches)
# test:medreport includes the sandbox tests (src/sandbox/**/*.test.ts) since demo/red-physio – no separate run
PORT=3000 MEDREPORT_AI_MODE=demo npm run start   # prod build; PORT matters (self-calls sim API)
npm run demo:check                         # check the local demo assets (maps, answers, insurer PDFs)
npm run demo:red                           # RED demo on this machine: build + start with demo assets, always demo mode (refuses without maps)
npm run demo:red -- --live                 # same, but .env.local's MEDREPORT_AI_MODE (auto) allows live calls once the passcode is typed
npm run medreport:eslint-boundary          # regenerate .eslintrc.json (never hand-edit)
```

## Env vars (names only – values live in `.env.local`, never in git)
`ANTHROPIC_API_KEY`, `MEDREPORT_MODEL`, `MEDREPORT_AI_MODE`, `MEDREPORT_LIVE_PASSCODE` (16+ chars),
`MEDREPORT_LAUNCH_SECRET`, `MEDREPORT_SIGNING_SECRET`, `MEDREPORT_ALLOW_DEMO_SECRETS` (never in prod),
`MEDREPORT_PARTNER_KEY`, `TM3_SIM_TOKEN`, `TM3_SIM_BASE_URL`, `MEDREPORT_SOFFICE_PATH`,
`MEDREPORT_DEMO_ASSETS_DIR` (local insurer forms + prepared maps/answers; use an ABSOLUTE path in a git worktree),
`MEDREPORT_DEMO_ASSETS_ALLOW_PROD` (local `next start` only – never on a deployment).
Empty `.env.local` = demo mode (fine for most work). Both checkouts (`clinforms/` and the worktree
`clinforms-wt/red-integrate/`) have a `.env.local` with a key, a passcode and `MEDREPORT_AI_MODE=auto`; the
worktree's also sets `MEDREPORT_DEMO_ASSETS_DIR` to the absolute `clinforms/demo-assets/insurers` path. `npm run demo:red`
ignores the `auto` and runs in demo mode unless `--live`.

## Key paths
| Path | What |
|---|---|
| `src/modules/medreport/` | The product (README = folder map, contracts, gotchas) |
| `src/modules/medreport/config.public.ts` | `PRODUCT` name/tagline (rename here) |
| `src/modules/medreport/config.server.ts` | AI mode, model allow-list, secrets |
| `src/modules/medreport/forms/` | Word/PDF outline, fill, convert (LibreOffice) |
| `src/sandbox/tm3-sim/fixtures/` | Fictional patients (`rebecca-lane.ts` = RED's PMI patient `sim-pat-006`) |
| `docs/plan.md` | Original plan + Revision 2 (referrer forms) |
| `docs/demo-red-physio.md` | RED call pack (internal): support matrix, checklist, script, answers, fallbacks |
| `assets/sales/blue-heart/` | Dell's video, SRT, narration, voice-over scripts |
| `scripts/e2e/`, `scripts/dev-tools/` | Ad hoc Playwright flows (port 3107-era) and dev tools (model probe, flag check) |
| `src/lib/site/demo-video.ts` | `/demo` (feat/production, 10/10): the product video's single source – media URLs (R2 `clinforms-media`, EU, `media.clinforms.co.uk/demo/<date>/`, never overwritten), chapters, transcript, markup, end-card hold; tests `src/lib/site/demo-video.test.ts` + `scripts/e2e/demo-video.cjs`; see `docs/production-architecture.md` §4. **Outreach links to `/demo` (or anywhere on the site) use campaign-level UTM only** – never a clinic or person in any UTM value (analytics also drops `utm_content`/`utm_term`). Open for Khuram: NEL on the media zone (switch off or keep the privacy sentence), disclose the generated voice-over or not, OK with "TM3" in the public video's sandbox label |
| `memory/` | Deep memory (this pack) |
