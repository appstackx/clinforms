# ClinForms – working memory (hot cache)

Last updated: **Sat 2026-10-10 ~19:00 UTC** (go-live day: the production line has been LIVE on clinforms.co.uk since
17:13 UTC, followed by the passcode server check and a polish deploy). Deep memory lives in `memory/` (index: `memory/README.md`).

## Start here (every new session)
1. Read **`memory/next-steps.md`** (prioritised backlog) and **`memory/README.md`** (index). Pull detail from
   `memory/projects/*`, `memory/context/*`, `memory/people/*` as needed. Production: runbook `docs/go-live.md`
   (incl. run log), contract `docs/production-architecture.md` (+ `docs/auth.md`, `docs/database.md`).
2. Check repo state: `git fetch && git worktree list && git log --oneline -5`, `git status`, Node 22, `npm ci`
   (+ `(cd workers/data-gateway && npm ci)` for `test:gateway` and wrangler).
   **Branches:** **`main` = production** (Vercel production branch: every push to `main` deploys clinforms.co.uk);
   `feat/production` == `main` since go-live (can be retired); **`demo/red-physio` + tag `red-demo-2026-10-13`
   (= `3521401`) are FROZEN** in the worktree `~/Projects/Appstackx/clinforms-demo` for the RED call – never touch,
   pull or move them; `sales/outreach-video` (video recorder, not merged); `ops/key-fingerprint` (in progress 10/10,
   not on `main`). Work on a feature branch → full check chain → `git merge --no-ff` into `main` → push = deploy.
3. **RED Physiotherapy call: Tue 13 Oct 2026, morning** (exact time: check the invite). Demo pack and call pack are
   DONE: `npm run demo:red` from the frozen folder `~/Projects/Appstackx/clinforms-demo` (its own `.env.local` with
   an absolute `MEDREPORT_DEMO_ASSETS_DIR` → gitignored `clinforms/demo-assets/insurers/`); **call pack
   `docs/demo-red-physio.md`**. Khuram rehearses Monday evening in a separate "ClinForms demo" Chrome profile. The
   demo runs locally, not from clinforms.co.uk – still, **don't change the public site from Monday evening until
   after the call**.
4. At the **end of every working session**: update `memory/next-steps.md`, add dated rows to
   `memory/decisions.md` (newest first) and `memory/history.md`, refresh the status snapshot below, commit.
5. **Never put secrets in memory or git** (keys, passcodes, tokens, signing secrets, invite links, workspace codes).
   Write "set in `.env.local` / the secrets file (not in git)" instead. Look at the secrets file by **names only**
   (`cut -d= -f1 ~/.config/appstackx/clinforms.secrets.env`); never `cat` it, echo a value or show one on screen.

## Me
**Khuram Masood**, runs **AppStackX** (legal name in his signature: **AppstackX Ltd**), a UK software
agency. Sells to UK physio clinics. Business email: `khuram@appstackx.co.uk` (also the ClinForms platform admin).
UK time (BST = UTC+1; times in memory are UTC). Mac + Chrome + Gmail. Works on ClinForms mostly evenings/weekends.
He decides everything; the agent proposes.

## How Khuram works (preferences)
- **Plan first, build after he approves** anything big ("let's plan first, once i approve you build it").
- Short messages with typos; wants concise answers, tables, one clear recommendation, exact next steps.
- Deadline-driven; asks for status often. Give honest estimates (label them), flag blockers immediately.
- Cost-conscious: cheapest suitable model ("like sonnet"), real hosting cost comparisons; free tiers until a clinic pays.
- Likes orchestrated multi-agent workflows (`/workflow-authoring`) with independent verification.
- Wants demos he can send or show (videos with voice-over, live demos). Uses ElevenLabs + Gmail.
- "make sure memory has all the details so new window do not forget things" – keep memory current.

## Hard rules
- **No "AI", "Claude", model or vendor names in anything customer-facing** (screens, docs, emails, videos,
  file names). Neutral wording lives in `src/modules/medreport/core/wording.ts` (single source; `ui/wording.ts`
  only re-exports it – edit core, and switch `DISCLOSURE` there), guarded by
  `scripts/medreport/neutral-wording.test.ts`. Still disclose truthfully: the DPA names **Anthropic as
  sub-processor**, and answer honestly if a customer asks.
- **Fictional data only.** No real patient data until DPA + DPIA + safeguards exist (a clinic is created only after
  its DPA is signed; drafting from notes is OFF for every new clinic until its owner switches it on).
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
- **Production is live with real accounts:** writing scripts with `--env production` (create/offboard clinic,
  migrations, secret provisioning, key rotation) only with Khuram's go; read-only checks (`admin:list-clinics`,
  health, `SELECT count(*)`) are fine. Outreach links carry campaign-level UTM only – never a clinic or person.
- Work on feature branches; no PRs unless asked. Commit trailer:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (or the attribution lines the session's own instructions give).
- Product name is **ClinForms** everywhere now – not "AppStackX Reports", not "CareConnect".

## People
| Who | Role |
|---|---|
| **Dell** | **Dell Baines** (Companies House: Dell David Henson-Baines), owner/director, **Blue Heart Clinics** (11 sites, uses **TM3**). Buyer, no longer treats patients. → `memory/people/dell-baines.md` |
| **Daniel** | **Daniel Vatamanu**, co-founder, **RED Physiotherapy** (Milton Keynes, Towcester, Northampton). Asked "Which insurers do you support?". Call **Tue 13 Oct, morning**; call pack `docs/demo-red-physio.md`. → `memory/people/daniel-vatamanu.md` |
| **Megan Hart** | FICTIONAL demo patient `sim-pat-001` (RTA whiplash, Harrow & Pike solicitor) – also the outreach video's patient |
| **Daniel Brooks** | FICTIONAL demo patient `sim-pat-002` (warehouse back injury, employer) – not Daniel Vatamanu! |
| **Sarah Reid / Tom Ellis** | FICTIONAL physios `PH-DEMO-01` / `PH-DEMO-02` |
| **Beth** | ElevenLabs voice `utezIGbCLSGO3Z7oKJwL` used for the Dell video and the outreach video |
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
| **demo / live / auto** | `MEDREPORT_AI_MODE`: demo = no AI calls; live = key + passcode (verified by the server); auto = live if possible |
| **medreport** | Internal module name (`src/modules/medreport`) = the product code |
| **Studio** | The review-and-approve UI: **public demo** at `/reports` (browser storage, fictional) and a **clinic's own** at `/app/studio` (server storage, encrypted) |
| **gateway** | Cloudflare Worker `clinforms-data`: HMAC-signed SQL gateway from Vercel to D1 |
| **platform page** | `/app/platform` – Khuram's admin view (clinics, access requests, platform actions); 404 for anyone not in `CLINFORMS_PLATFORM_ADMINS` |
| **DPA / DPIA** | Data processing agreement / data protection impact assessment |
→ Full glossary (incl. old names "AppStackX Reports", "CareConnect"): `memory/glossary.md`

## Projects
| Name | What | Status |
|---|---|---|
| **ClinForms** | The product: completes each referrer's own form, original layout, from clinic notes | **LIVE on clinforms.co.uk since 10/10 17:13 UTC** (public site, invite-only clinic sign-in, clinic Studio, encrypted D1); only the internal clinic `appstackx` exists → `memory/projects/clinforms.md` |
| **Blue Heart deal** | Dell; MLC/case-manager forms; voiced 6:15 video made 09/10 | Waiting on Dell (video send unconfirmed) → `memory/projects/blue-heart-clinics.md` |
| **RED deal** | Daniel; insurer (PMI) forms; call Tue 13 Oct, morning | **Demo + call pack ready** (frozen folder `clinforms-demo`, `docs/demo-red-physio.md`); Khuram rehearses Monday → `memory/projects/red-physiotherapy.md` |
| **Outreach video** | 1:30 ClinForms demo for cold outreach (fictional data, voice Beth) | FINAL 10/10; files in `~/Projects/Appstackx/marketing/clinforms/outreach-video-v1/`; hosted at **clinforms.co.uk/demo**; no outreach sent yet (as far as recorded) |
| **careconnect-mk** | Origin repo (patient-portal portfolio demo); module first built on branch `claude/confident-noether-z6l7kr` @ `ff05fab` | Superseded; unmerged → `memory/projects/careconnect-mk.md` |

## Status snapshot (2026-10-10 ~19:00 UTC)
- **Repo:** `github.com/appstackx/clinforms` (private). `main` = **`8def25b`**, deployed.
- **Production deploys today** (Vercel project `clinforms`, team `khuram99gmailcoms-projects`, `lhr1`, **Hobby**):
  | Created (UTC) | `main` | Deployment `clinforms-<id>-khuram99gmailcoms-projects.vercel.app` | What |
  |---|---|---|---|
  | 17:13 | `02ddfb5` (merge of `feat/production` `29c0b39`) | `d4drhu49m` | **Go-live** |
  | 17:45 | `04c18d0` | `c3lbxtxy3` | Demo Studio: live passcode verified by the server first |
  | 18:43 | `8def25b` | `kg5bz9ny7` | Polish: no caption behind the `/demo` end panel; Studio tabs wrap at 375 px |
  Pre-go-live build (`26cd447`, RED-era demo) = `b8guhpqyz` (the go-live rollback target). Hobby rolls back only to
  the **previous** production deployment.
- **What is live:** public site `/` + **`/demo`** (the 1:30 video from `media.clinforms.co.uk`, R2 bucket
  `clinforms-media`, EU, folder `demo/2026-10-10/`), `/privacy` `/cookies` `/terms` `/security` (drafts – owner review
  pending), `/request-access` (row in D1, **no email notification** – check `/app/platform` daily); cookie banner,
  **PostHog EU project 300254 only after consent** (via `/ingest`); **clinic sign-in** (Better Auth, invite-only,
  TOTP two-step required; email off → invite/reset links handed over by hand); `/app` (overview + checklist, settings:
  clinic/members/security/api-keys, **activity log** `/app/settings/activity` with CSV); **clinic Studio
  `/app/studio`** (reports, form maps, files AES-256-GCM encrypted per clinic in D1 via the gateway Worker
  `clinforms-data`); **notes import** (any layout, staff check before the record is built); drafting from notes OFF for
  new clinics; **`/app/platform`** for `khuram@appstackx.co.uk`; public demo `/reports` + `/pms-sandbox` kept
  (`CLINFORMS_PUBLIC_DEMO=1`, browser storage; live drafting only after the server accepts the passcode); **retention
  cron** `/api/cron/retention` daily 03:17 UTC (`CRON_SECRET`; first scheduled run 11/10 – unverified). Headers: HSTS
  2 y includeSubDomains, CSP **Report-Only**, X-Frame-Options DENY, noindex on `/api` `/app` `/reports` `/pms-sandbox`.
- **Production data (checked 18:58 UTC):** D1 `clinforms-prod` 21 tables / 3 triggers; 1 clinic = internal
  **`appstackx`** ("AppStackX (internal)", owner Khuram Masood, two-step on, 30-day retention, fictional data only);
  0 reports, 0 form files → go-live §7.6 (offline key decrypts production data) still pending; 1 fictional
  smoke-test access request (delete it). Active data key id **`k2`** (k1 retired after it showed in a screenshot,
  before any data existed).
- **Infra ids (no secrets):** Cloudflare account `appstackx-demos` (`a04ab546d0f1be2aa339bafebcdb3ffa`); D1 (EU)
  `clinforms-prod` (`c1a631fe-9cf0-414d-ab2f-28f7291282e3`) / `clinforms-preview`
  (`3a548cc6-45d9-4dc5-b308-23a75534dcc9`); gateway Workers `clinforms-data`
  (`https://clinforms-data.appstackx-demos.workers.dev`) / `clinforms-data-preview` (Workers Free per runbook §8 – verify); R2 `clinforms-media`
  (EU) at `media.clinforms.co.uk`; zone `clinforms.co.uk` (Cloudflare Free; NEL off, Always Use HTTPS on; www → 308
  apex); PostHog EU org "ClinForms", project **300254**; MailerSend chosen, not set up. Supabase Postgres London later.
- **Secrets (values never in git):** `~/.config/appstackx/clinforms.secrets.env` (chmod 600; `PREVIEW_*` and
  `PRODUCTION_*` names); offline copy = encrypted disk image `ClinForms-keys-backup-20261010.dmg` in iCloud Drive,
  passphrase in Apple Passwords (redo after any change to the file); `.env.local` in each checkout.
- **Prompts:** analysis `form-analysis-4` (rules `rules-2`), drafting `forms-7`, templates `2`; model `claude-sonnet-5-5`.
- **Not built:** Word→PDF converter (Word forms download as Word), real PMS connectors (TM3 simulated; clinics upload
  notes), email sending, billing, assisted note structuring ("Organise these notes"), CSP report endpoint.
- **Dell video:** `assets/sales/blue-heart/AppStackX-Reports-demo-Blue-Heart-Clinics-voiceover-v2.mp4`
  (6:15, 17.7 MB). Whether Khuram emailed it to Dell is **unverified** – ask.

## Top next actions (detail in `memory/next-steps.md`)
1. **RED call** (Tue 13 Oct, morning) – all in **`docs/demo-red-physio.md`**: Monday-evening rehearsal from
   `~/Projects/Appstackx/clinforms-demo`; Tuesday `npm run demo:red -- --skip-build`; afterwards record Daniel's answers in
   `memory/projects/red-physiotherapy.md` §7. No production changes Monday evening → after the call.
2. **Go-live loose ends:** §7.6 key check (via the `ops/key-fingerprint` endpoint once merged, or after the first
   encrypted write); confirm the first scheduled retention run (`cron.retention.done`, 11/10 03:xx UTC); delete the
   smoke-test access request; Khuram to confirm the Anthropic key (keep the new one, delete older ones in the Console).
3. **Before a paying clinic:** Vercel **Pro** (Hobby is non-commercial), Workers Paid, MailerSend, legal pages reviewed
   + company number/ICO, DPA/DPIA, Supabase London when a clinic pays.
4. **Outreach** with the video (link `https://clinforms.co.uk/demo`, campaign-level UTM only) – Khuram's call.
5. **Ask Khuram** (one message): RED call time; Anthropic key done?; Dell video sent/replied?; price line for RED;
   "Organise these notes" yes/no.

## Key commands
```bash
npm ci && npm run dev                      # http://localhost:3000 = public site; /reports = public demo (demo mode with empty env)
npm run typecheck && npm run lint && npm run test:medreport && npm run test:db && npm run test:auth \
  && npm run test:site && npm run test:gateway && npm run build   # FULL CHECK CHAIN before any merge to main
# test:medreport includes the sandbox tests (src/sandbox/**/*.test.ts)
PORT=3000 MEDREPORT_AI_MODE=demo npm run start   # prod build; PORT matters (self-calls sim API)
NODE_PATH=/Users/khuram/Projects/Appstackx/pigeon-web/node_modules node scripts/e2e/<script>.cjs   # Playwright scripts
npm run -s admin:list-clinics -- --env production    # read-only signed SELECT through the gateway
npm run admin:create-clinic|admin:offboard-clinic|admin:reset-two-factor -- --env production …   # Khuram's go only (docs/auth.md)
npm run db:migrate / db:selftest / db:provision-gateway / admin:provision-auth    # see docs/database.md, docs/go-live.md
curl -s https://clinforms.co.uk/api/reports/v1/health; curl -s https://clinforms-data.appstackx-demos.workers.dev/v1/health
npx --yes vercel@63.1.0 ls clinforms --environment production --limit 3      # deployments (from this checkout)
npx --yes vercel@63.1.0 logs --environment production --since 1h --level error
(cd workers/data-gateway && npx wrangler tail clinforms-data --format pretty)   # gateway logs (account appstackx-demos)
npm run demo:red                           # RED demo – ONLY from ~/Projects/Appstackx/clinforms-demo before the call
npm run medreport:eslint-boundary          # regenerate .eslintrc.json (never hand-edit)
```

## Env vars (names only – values in Vercel / `.env.local` / the secrets file, never in git)
- **Vercel production (exactly 19):** `ANTHROPIC_API_KEY`, `MEDREPORT_AI_MODE`, `MEDREPORT_LIVE_PASSCODE` (16+ chars,
  enforced), `MEDREPORT_LAUNCH_SECRET`, `MEDREPORT_SIGNING_SECRET`, `MEDREPORT_PARTNER_KEY`, `TM3_SIM_TOKEN`,
  `NEXT_PUBLIC_POSTHOG_KEY`, `CLINFORMS_DB` (`d1`), `CLINFORMS_D1_GATEWAY_URL`, `CLINFORMS_D1_GATEWAY_SECRET`,
  `CLINFORMS_DATA_KEYS`, `CLINFORMS_DATA_KEY_ID` (`k2`), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
  `CLINFORMS_EMAIL_PROVIDER` (`none`), `CLINFORMS_PLATFORM_ADMINS`, `CLINFORMS_PUBLIC_DEMO` (`1`), `CRON_SECRET`.
  Gateway Worker secret: `GATEWAY_SECRET` (= `CLINFORMS_D1_GATEWAY_SECRET`).
- **Optional / later:** `MAILERSEND_API_KEY`, `MAILERSEND_FROM_EMAIL`, `CLINFORMS_ACCESS_REQUEST_TO`,
  `NEXT_PUBLIC_POSTHOG_HOST` (default `/ingest`), `NEXT_PUBLIC_POSTHOG_DEBUG`, `APP_ORIGIN`, `DATABASE_URL`
  (+ `DATABASE_SSL`, `DATABASE_CA_CERT`, `DATABASE_POOL_MAX` – Supabase later), `CLINFORMS_SQLITE_PATH` (local),
  `CLINFORMS_TENANT_LIVE_CALLS_PER_MINUTE` / `_PER_DAY`, `MEDREPORT_MODEL`, `MEDREPORT_SOFFICE_PATH`, `TM3_SIM_BASE_URL`.
- **Never on a deployment:** `MEDREPORT_DEMO_ASSETS_DIR` (local insurer forms; ABSOLUTE path in a worktree),
  `MEDREPORT_DEMO_ASSETS_ALLOW_PROD` (local `next start` only), `MEDREPORT_ALLOW_DEMO_SECRETS`.
Empty `.env.local` = demo mode, SQLite/none (fine for most work). `npm run demo:red` runs in demo mode unless `--live`.

## Key paths
| Path | What |
|---|---|
| `src/modules/medreport/` | The product engine (README = folder map, contracts, gotchas) |
| `src/modules/medreport/config.public.ts` / `config.server.ts` | `PRODUCT` name/tagline / AI mode, model allow-list, secrets, passcode minimum |
| `src/modules/medreport/forms/` | Word/PDF outline, fill, convert (LibreOffice locally only) |
| `src/app/(marketing)`, `src/lib/site.ts` | Public site, legal pages; `COMPANY` (company number/ICO unset → lines hidden) |
| `src/lib/site/demo-video.ts` | `/demo`: single source for the video (media URLs `media.clinforms.co.uk/demo/<date>/`, never overwritten; chapters, transcript, end card); tests `demo-video.test.ts` + `scripts/e2e/demo-video.cjs` |
| `src/server/{auth,db,crypto,repos,store,cron,email,admin}` | Production server: Better Auth, Kysely data layer, AES-GCM, repositories, retention cron |
| `workers/data-gateway/` | Gateway Worker `clinforms-data` (pinned wrangler; D1 bindings) |
| `db/migrations/sqlite/`, `supabase/migrations/` | D1/SQLite migrations `0001`–`0005` (applied on prod 10/10); Postgres twins for Supabase later |
| `scripts/admin/`, `scripts/db/` | Clinic admin scripts; migrate/selftest/provision |
| `scripts/e2e/` | Playwright flows (tenant full flow, fix checks, demo video, passcode check …) |
| `src/sandbox/tm3-sim/fixtures/` | Fictional patients (`rebecca-lane.ts` = RED's PMI patient `sim-pat-006`) |
| `docs/go-live.md` | Runbook + **run log** of the 10/10 go-live, known limits (§8) |
| `docs/production-architecture.md`, `docs/auth.md`, `docs/database.md` | Contract, sign-in/clinics, D1/gateway/keys/backups |
| `docs/demo-red-physio.md` | RED call pack (internal) |
| `assets/sales/blue-heart/` | Dell's video, SRT, narration, voice-over scripts |
| `memory/` | Deep memory (this pack) |
