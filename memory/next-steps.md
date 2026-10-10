# Next steps – prioritised backlog

State: **Fri 2026-10-09 ~23:15 UTC** (desktop). RED demo pack + call pack DONE on `demo/red-physio` (not pushed – the orchestrator pushes); production line on `feat/production` (§1b). Original hand-off state (16:00 UTC): `main` = `e799c51` → `7f6fcf8` → `32499de` → `cba79dc` → `c6a2850` (memory pack).
Rule: Khuram wants **a short plan first, build after his OK** for anything big – but keep it brief when a deadline is close (RED call, Tue 13 Oct, morning).
Update this file at the end of every session (status, blockers, what changed).

## 0. First 15 minutes of a new session (checklist)
1. Read `CLAUDE.md`, this file, `memory/README.md`; skim `memory/decisions.md` (top rows).
2. `git fetch && git status && git log --oneline -5` (expect `32499de` → `cba79dc` (WIP memory) → final memory commit, or later); `nvm use` (Node 22); `npm ci`.
3. Baseline: `npm run typecheck && npm run lint && npm run test:medreport && npm run build` → on `main` expect **243/243** (+ sandbox tests 26/26 run separately); on `demo/red-physio` `test:medreport` includes the sandbox tests: **448 tests, 445 pass, 3 skipped** (LibreOffice). On `demo/red-physio` also `npm run demo:check` → "Demo assets OK: 7 maps, 4 answer files, 6 form files".
4. `npm run dev` → click `/pms-sandbox` → Megan Hart → **Complete referrer's report form** → Harrow & Pike → review → approve → download (demo mode, no env needed).
5. Network check (desktop should be open): `curl -sI` the three insurer PDF URLs (`memory/context/insurer-forms.md`), `https://api.vercel.com`, `https://api.supabase.com`.
6. Tooling check on the Mac: LibreOffice (`/Applications/LibreOffice.app/Contents/MacOS/soffice`), ffmpeg/poppler, Postgres or Docker, `vercel`/`supabase` CLIs (via `npx` is fine).
7. Send Khuram **one message** with the questions in §A, then start §1 (most of it doesn't depend on the answers; live drafting does – see §1 Blockers). Offer once, in that message: "Shall I check your Gmail (read-only) to answer Q1 and Q5 myself?" If he agrees (and a Gmail connector is available), search threads for "Blue Heart" / "Dell" / "red-physiotherapy" / "RED Physiotherapy" from 06/10 onwards; record what was actually sent to Dell (draft 1/2, video v2, timeframe) and Daniel's booking (date/time/link) in `projects/*.md`, copying no personal data beyond names and business emails. Never send or draft email without an explicit ask.

### §A. Questions for Khuram (ask once, together)
1. *(Partly answered 09/10: Tue 13 Oct, morning – exact time still to check.)* Confirm the RED call is **Tue 13 Oct** ("Tuesday" came only from the research text you pasted; the date is inferred), and what time; who attends; did Daniel say anything when booking?
2. *(Answered 09/10: Hobby for now; `clinforms.co.uk` is live.)* Vercel: which plan (Pro needed for commercial use)? Will you import `appstackx/clinforms` yourself, or set a `VERCEL_TOKEN` env var for me?
3. Are `clinforms.co.uk` and `clinforms.com` registered? Which registrar (for DNS)?
4. Has the Anthropic API key pasted in chat on 06/10 been **rotated**? Which keys exist in the Anthropic Console (a second key file was also in the cloud container)? Please revoke all but one fresh key and put it in `.env.local` yourself (don't paste it in chat), plus a new `MEDREPORT_LIVE_PASSCODE` and new `MEDREPORT_LAUNCH_SECRET`, `MEDREPORT_SIGNING_SECRET`, `MEDREPORT_PARTNER_KEY`, `TM3_SIM_TOKEN` (e.g. `openssl rand -base64 32` each). **Needed for the RED demo:** demo mode can't draft a new patient on the new insurer forms (`NO_DEMO_DRAFT`), so without these the narrative answers stay blank. After the live run: should the call avoid depending on the live API (e.g. a local-only recorded-draft path for the demo-assets forms, kept out of git), or do you want to demo live with the passcode?
5. Did the voiced v2 video go to Dell? Did he reply or send forms? Which of our draft replies did you actually send him (the 06/10 ones)?
6. *(Answered 09/10 – D39: Cloudflare D1 now, Supabase London later.)* "Cloudflare for demos and base account + Supabase scripts to create new db": do you still want Cloudflare given Vercel Pro has unlimited projects at no extra cost? Does "new db" mean a **new Supabase project per clinic** or **a new clinic (tenant) in one shared London database** (my recommendation, dedicated project as premium)?
7. If Daniel asks about price on Tuesday, what do we say? Default proposal (assistant, unconfirmed): same structure as Blue Heart – per clinic, not per seat; Practice £199/mo list; founding offer £149/mo fixed 12 months + £250 setup incl. 5 forms (e.g. Bupa, AXA, Aviva + 2), monthly, cancel any time, state VAT treatment – or simply "depends on volume, typically £99–£199/month; we'll confirm after a short pilot".

---

## 1. RED Physiotherapy demo pack – **P0, DONE / READY; deadline: the RED call (Tue 2026-10-13, morning)**
- **Goal:** live demo answering Daniel's "Which insurers do you support?" – ClinForms completes **Bupa, AXA Global Healthcare, Aviva CM016** (real public forms) in their original layout from **one fictional PMI patient**, plus a support matrix and 10-minute call script.
- **Status (09/10 ~23:15 UTC): DONE – built, reviewed, fixed, rehearsed (headless, twice) and the CALL PACK is written:
  `docs/demo-red-physio.md`** (support matrix; Monday-evening and Tuesday-morning checklist with exact commands; Chrome
  set-up; what to pre-upload; 10-minute script with click path, what to say and rehearsal timings; labels to frame;
  likely questions with honest answers; questions for Daniel; fallbacks). Branch `demo/red-physio` (worktree
  `clinforms-wt/red-integrate`; the orchestrator pushes it). `npm run demo:red` (always demo mode unless `--live`) with
  the gitignored `clinforms/demo-assets/insurers/`: 6 insurer PDFs, 7 prepared maps (incl. our own illustrative portal
  question set, seeded into the library), 4 answer files (Bupa, AXA, Allianz, portal) for Rebecca Lane (`sim-pat-006`).
  `npm run demo:check` → "Demo assets OK: 7 maps, 4 answer files, 6 form files". Finals of the rehearsal:
  `demo-assets/outputs/`; screenshots `demo-assets/rehearsal/` (older sets in `_wave2-before/` – never show).
- **What remains (Khuram):**
  1. **Monday evening:** one rehearsal in his own Chrome, in a separate "ClinForms demo" profile, from the frozen folder `~/Projects/Appstackx/clinforms-demo`
     (tag `red-demo-2026-10-13`; call pack §2.2) – maps live in the browser that confirmed them; then Reset demo.
  2. **Tuesday morning:** quit heavy processes/agent workflows, `npm run demo:red -- --skip-build`, pre-upload and
     confirm AXA + Aviva CM016, leave Bupa to upload live, two tabs (call pack §2.3).
  3. Check the call time in the invite; confirm RED's practice system if possible (if not TM3, avoid the home page).
  4. Decide the price line (only if asked; proposals in `memory/context/pricing.md`).
  5. Optional: Anthropic credit check only if he wants to show live drafting (not recommended).
- **Still open after the call (product):** a second fictional patient whose record names AXA Global Healthcare (AXA
  approvable without typed numbers); `forms-8` giving the drafting prompt each box's capacity (live answers overflow);
  BESS/BOA and "cuff" in the glossary; generic upload dialog defaults to "Medico-legal company"; no logins/roles in the
  demo; whether AXA accepts an electronic approval line is unknown; review time with real clinicians not measured.
- **Call guidance:** `docs/demo-red-physio.md` (full) and `memory/projects/red-physiotherapy.md` §8 (short).
- **Historical – the original task prompt (done; kept for reference):**

- **Ready-to-paste prompt:**

```text
Prepare the RED Physiotherapy insurer-forms demo in ClinForms (this repo, appstackx/clinforms). Read CLAUDE.md, memory/next-steps.md §1, memory/projects/red-physiotherapy.md, memory/context/insurer-forms.md and memory/sources/red-physio-demo-task.md first. The call with Daniel Vatamanu (co-founder, RED Physiotherapy, Milton Keynes/Towcester/Northampton) is booked for Tuesday (13 Oct inferred – I'll confirm the time); he asked "Which insurers do you support?".

Give me a 5-line plan first, then proceed once I say go. Keep it lean (my weekly Claude usage limit probably resets only after the call): no multi-agent fan-outs; commit after each verified step.

Work on a new branch demo/red-physio from main. Push it when done; no PR.

1. Forms: `/demo-assets/` is already gitignored. Download into demo-assets/insurers/:
   - Bupa therapies management form: https://www.bupa.co.uk/~/media/files/hcp/latest-updates-from-bupa/forms/therapies-management-form.pdf
   - AXA Global Healthcare therapy treatment plan: https://www.axaglobalhealthcare.com/globalassets/intermediary/sales-tool-kit/operational-forms/eu/therapy-treatment-plan-form---english.pdf
   - Aviva CM016: https://static.aviva.io/content/dam/document-library/health/cm016.pdf
   Optional if time: Aviva GEN030, Freedom Worldwide claim form, Allianz Care pre-authorisation (URLs in memory/context/insurer-forms.md). If a URL is dead, tell me and I'll download it manually. NEVER commit these PDFs or outputs made from them.
2. Classify each PDF (AcroForm fillable / flat text / scanned / XFA / encrypted; page count; field count) with a small script using pdf-lib/pdfjs from node_modules. Record results in the doc (step 6).
3. Run each through Referrer forms → Upload (live analysis if .env.local has ANTHROPIC_API_KEY + MEDREPORT_LIVE_PASSCODE, otherwise the rules-1 no-AI analysis), then correct and confirm the map. For CM016 map ONLY the practitioner/clinician sections; patient sections and declarations are leave_blank. Label the AXA form "AXA Global Healthcare (international)", separate from domestic AXA Health. If analysis or fill fails, fix the root cause in src/modules/medreport/forms/** with a unit test (minimal changes). Note: fills use Helvetica/WinAnsi; unsupported characters are reported. If .env.local lacks any of the six live variables (ANTHROPIC_API_KEY, MEDREPORT_LIVE_PASSCODE, MEDREPORT_LAUNCH_SECRET, MEDREPORT_SIGNING_SECRET, MEDREPORT_PARTNER_KEY, TM3_SIM_TOKEN), stay in demo mode and tell me – demo mode cannot draft this new patient on these forms (NO_DEMO_DRAFT).
4. Add ONE fictional private-medical-insurance patient fixture in src/sandbox/tm3-sim/fixtures/ modelled on megan-hart.ts / daniel-brooks.ts and registered in index.ts/build.ts: id sim-pat-006 (sim-pat-001..005 are taken), episode sim-ep-1006. Do NOT use "PH-DEMO-03" as a patient label: PH-DEMO-0N is the fake HCPC number format for fictional clinicians. Give the patient fictional insurer membership/policy and pre-authorisation numbers in an obviously fake format (e.g. "DEMO-POL-0001", "DEMO-AUTH-0001"). Use PH-DEMO-03 only if you add a new fictional clinician. Plausible MSK case (e.g. shoulder or knee), insurer name + fictional policy and authorisation numbers in the referral/registration, initial assessment, 4-6 follow-ups, outcome measures at 3 time points, a treatment plan with sessions used/requested, one planted gap (e.g. no recorded prognosis). Treating physio Sarah Reid (PH-DEMO-01). All organisations "(fictional)". Keep sim tests green; re-stamp demo-draft fingerprints only if needed (scripts/medreport/stamp-demo-drafts.ts).
5. Complete and approve all three forms for that patient end to end; save finals to demo-assets/outputs/. Every demo output must carry: "Public form used for demonstration only – not affiliated with or endorsed by <insurer>. Fictional patient data." – implement as an opt-in footer/watermark (e.g. a per-form `demoNotice` on the form definition or a render option) so production output is unaffected; add a test. Keep the sandbox labelled "Simulated TM3 sandbox – demo data, not affiliated with TM3". After the live run, stop and decide with me how to make the call independent of the live API (e.g. a local-only recorded-draft path for the demo-assets forms, kept out of git), or plan to demo live with the passcode.
6. Write docs/demo-red-physio.md: (a) support matrix – insurer | form | type (fillable/flat/scanned) | how completed (fields / best-effort overlay / clinician sections only / portal → copy-ready answers) | status; include Vitality, WPA, domestic AXA Health as "no public form found – likely portal; copy-ready answers, no automatic submission"; (b) a 10-minute call script with the exact click path; (c) honest caveats: public forms not RED's own, portals not submitted, "support" may mean billing/claims (not what ClinForms does), TM3 simulated (export/upload today), flat/scanned PDFs best effort, nothing goes out without clinician approval; (d) questions for Daniel: top insurers/MLCs and monthly volume, Word/PDF vs portal, time per form today, which practice-management system RED uses, who signs, what "support" means. Customer-facing text must not mention AI, Claude or model names – use the neutral wording in src/modules/medreport/core/wording.ts.
7. REQUIRED: confirmed form maps and uploaded form files live only in the browser that created them (localStorage medreport.forms + IndexedDB medreport-forms; no export), so the demo must be reproducible in MY Chrome. Either (a) build `npm run demo:red`, or a dev-only preload page/route that reads the PDFs from gitignored demo-assets/insurers/ at runtime, attests the three maps via POST /forms/confirm and seeds them (plus the patient) into the browser – dev/local only, never on production; or (b) write an exact rehearsal checklist I follow in my Chrome before the call (upload → correct → confirm each form, using the saved map corrections). Default to (a). Optional extra (ask me first): a "portal questions → copy-ready answers" view. The insurer PDFs are not in git, so a Vercel URL cannot show them – plan to present locally via screen share.
8. Run: npm run typecheck && npm run lint && npm run test:medreport && npm run build, plus the sandbox tests. Scan the staged diff for secrets (sk-ant- etc.) and for any PDF under demo-assets before committing. Commit and push demo/red-physio.
9. Summarise: what works, what is best effort, exact demo click path, rehearsal timings, the call-day fallback (finals in demo-assets/outputs/ + screenshots), and anything I must do before Tuesday (e.g. check Anthropic credit). Then update memory/projects/red-physiotherapy.md (support matrix + status), memory/next-steps.md and memory/decisions.md, and commit those too.
Use the product name ClinForms everywhere (not CareConnect, not AppStackX Reports).
```

---

## 1b. Production track – `feat/production` (pointer)
- **Branch** `feat/production` (worktree `clinforms-wt/p-integrate`, `ec76a0a` at 09/10 22:41 UTC; wave 1 + wave 2
  integrated, includes the RED engine via `prod/w2-base`). **Contract:** `docs/production-architecture.md` on that branch
  (plus `docs/auth.md`, `docs/database.md`). Wave branches `prod/w2-*` have their own worktrees under `clinforms-wt/`.
- **Owner decisions it follows** (`decisions.md` D39–D41): Cloudflare D1 now (EU jurisdiction, via the authenticated
  gateway Worker `clinforms-data`), Supabase Postgres London later (when a paying clinic signs); Better Auth (invite-only
  clinics, required TOTP two-step); MailerSend for email; PostHog EU (org "ClinForms", project 300254), consent-gated;
  Vercel Hobby for now; `clinforms.co.uk` live.
- **Built there (not on `main`, not deployed):** Kysely data layer (D1 gateway / Postgres / SQLite), AES-GCM
  encryption at rest, Better Auth identity + `/app` settings, public website + request access + legal pages, tenant
  Studio at `/app/studio`, clinic storage API, admin/platform pages, retention cron.
- **Next:** read the contract and that branch's own notes before touching it; merging to `main` = deploying to
  `clinforms.co.uk` (production branch `main`) – only with Khuram's go.

## 2. Vercel deploy readiness + deploy – **P1, PARTLY DONE**
- **Goal:** ClinForms live on Vercel in London, demo mode by default, live mode behind the passcode, on `clinforms.co.uk`.
- **Status (checked 09/10 22:53 UTC):** **`https://clinforms.co.uk` is live** on Vercel (project `clinforms`, team
  `khuram99gmailcoms-projects`, `lhr1`; `www` → 308 apex; `/` → `/reports`). `/api/reports/v1/health` = product
  "ClinForms", `aiMode` live, `liveAiAvailable` true, prompt `form-analysis-3` → a **pre-RED build** (as on `main`),
  not `demo/red-physio` or `feat/production`. Plan: **Hobby for now** (Khuram; Hobby is non-commercial – revisit before a
  paying clinic). Who deployed it and when is not recorded here.
- **Remaining:** fresh secrets per environment (names in `~/.config/appstackx/clinforms.secrets.env`, values never in
  git), rotated key (§7.1), and the production line (§1b) when Khuram says go. The old prompt below predates the
  deployment – use only the parts still missing.
- **Ready-to-paste prompt:**

```text
Make ClinForms (this repo) deploy-ready for Vercel and help me deploy it. Read CLAUDE.md, memory/context/hosting-and-infra.md and the root README "Deploying" section first. Decision already made: Vercel Pro, functions in London (vercel.json lhr1). Plan first (short), then go.

1. Work on branch chore/vercel-deploy. Verify a clean `npm ci && npm run typecheck && npm run lint && npm run test:medreport && npm run build`.
2. Add scripts/gen-secrets.mjs: prints fresh random values (crypto.randomBytes(32).toString('base64url')) for MEDREPORT_LAUNCH_SECRET, MEDREPORT_SIGNING_SECRET, MEDREPORT_PARTNER_KEY, TM3_SIM_TOKEN and a 24-char MEDREPORT_LIVE_PASSCODE, formatted for pasting into Vercel. It must never write files or log anywhere else. Add an npm script "secrets:gen". Do not print the values into this chat – I will run it myself.
3. Write docs/deploy-vercel.md: import steps (Add New Project → Import appstackx/clinforms, framework Next.js, Node 22, production branch main), the env var table for Production and Preview (from .env.example; MEDREPORT_AI_MODE=auto; never MEDREPORT_ALLOW_DEMO_SECRETS in production; ANTHROPIC_API_KEY from a spend-limited workspace, rotated), Deployment Protection + "Protection Bypass for Automation" (VERCEL_AUTOMATION_BYPASS_SECRET), domains (clinforms.co.uk + www as production, clinforms.com + www redirect; DNS at registrar), known limits (4.5 MB bodies, maxDuration 60 on drafts/analyse/fill-preview/render, Word→PDF returns 503 PDF_CONVERSION_UNAVAILABLE until the converter exists), smoke-test checklist.
4. Check whether maxDuration/LIVE_TIMEOUT_MS should be raised on Pro (keep 60/50 unless there is a clear reason; explain).
5. If I have set VERCEL_TOKEN in the environment, use `npx vercel` to link, add env vars (I will paste secret values myself via the Vercel UI if you prefer) and deploy a preview, then production. Otherwise give me the exact click-through and wait.
6. Smoke test the deployed URL: /api/reports/v1/health (product "ClinForms", model "drafting-service"), /reports, /pms-sandbox, the Megan → Harrow & Pike flow in demo mode; then live mode with the passcode (I'll type it). Confirm no "AI"/"Claude" text on screen.
7. Commit/push the branch (no PR unless I ask), then update memory/context/hosting-and-infra.md, memory/next-steps.md and memory/decisions.md with the deployment URL, date and status.
Never commit or echo secrets.
```

---

## 3. Clarify and build Supabase scripts (create DB / onboard / offboard clinic) – **P2**
- **Goal:** scripts ready to provision the database and onboard/offboard a clinic, tested locally, so a pilot can start fast.
- **Why:** Khuram 15:39 request #3; prerequisite for real tenancy.
- **Status:** **SUPERSEDED by §1b** – `feat/production` has migrations for D1/SQLite and Supabase Postgres (parity-tested) and the admin scripts (`create-clinic`, `list-clinics`, `offboard-clinic`, `reset-two-factor`, `provision-auth`; see `docs/production-architecture.md` there). Supabase itself comes later (D39). The prompt below is historical.
- **Blockers:** scope answer; Supabase org + personal access token (env var `SUPABASE_ACCESS_TOKEN`), London region; local Postgres/Docker for tests.
- **Ready-to-paste prompt:**

```text
Build Supabase provisioning and clinic onboarding scripts for ClinForms. Read CLAUDE.md, memory/context/hosting-and-infra.md (Supabase section), memory/context/compliance.md and memory/projects/clinforms.md first. Architecture (recommended, confirm with me): ONE Supabase project in London (eu-west-2), pooled multi-tenant, row-level security keyed by clinic; a dedicated project per clinic only as a premium option. The app currently has NO database code – this task is scripts + schema only, not wiring the app.

Plan first (tables, RLS model, script interfaces, test approach), wait for my OK, then build on branch feat/supabase-scripts:
1. supabase/migrations/*.sql: tenants (clinics), memberships (auth user ↔ tenant, role: admin|clinician|staff), forms (tenant_id nullable = shared insurer library; map JSON; file sha256; confirmed_by/at), form_files metadata, reports (tenant_id, patient ref, status, content hash, receipt JSON), audit_log (append-only: no UPDATE/DELETE grants), api_keys (hashed partner keys, revoked_at). RLS on every table via a helper is_member(tenant_id); shared library rows readable by all members, writable only by service role. Storage: one bucket per purpose with per-tenant path prefixes and policies. Retention: a function/cron to delete reports and files older than the tenant's retention_days.
2. scripts/supabase/provision.mjs: create a project via the Supabase Management API (POST https://api.supabase.com/v1/projects, Bearer SUPABASE_ACCESS_TOKEN from env, London region – check the current OpenAPI reference for the exact region field and db password field; GET /v1/projects/available-regions), wait until healthy, then apply migrations (supabase CLI `db push` or psql with the connection string). Store the generated DB password only in the user's .env.local / password manager – print a reminder, not the value.
3. scripts/supabase/onboard-clinic.mjs --name --slug --admin-email [--retention-days 90]: create tenant, invite admin (auth admin API), issue a partner key (print once, store only its hash), seed the shared insurer-form library link. scripts/supabase/offboard-clinic.mjs --slug [--export-dir]: export tenant data, delete rows and storage objects, revoke keys, write an audit entry.
4. Tests against a local Postgres (Docker supabase/postgres image, or plain Postgres 16 with stubbed auth.uid() and storage schema): RLS isolation (clinic A can't read clinic B), audit log append-only, retention deletes, onboarding idempotency.
5. docs/supabase.md: how to run each script, required env vars (names only), what Khuram must click in the Supabase dashboard (org, access token, London region).
6. Checks green, commit, push; update memory (hosting-and-infra, next-steps, decisions).
Never commit tokens, passwords or connection strings.
```

---

## 4. Cloudflare-for-demos question – **P3 (decision needed)**
- **Goal:** decide whether demos/base account run on Cloudflare; if yes, prove feasibility with evidence.
- **Why:** Khuram asked (15:39) for cost reasons. Assistant view: Vercel Pro has unlimited projects, so demo/base cost nothing extra on Vercel; Cloudflare ≈ $5/mo + 1–2 days porting and 9 known blockers (`memory/context/hosting-and-infra.md`).
- **Status:** **RESOLVED (D39)** – the app stays on Vercel; Cloudflare is used for the database (D1 + gateway Worker) only. No Workers port. Prompt below is historical.
- **Ready-to-paste prompt (only if Khuram wants the spike):**

```text
Run a time-boxed (max 3 hours) Cloudflare Workers feasibility spike for ClinForms on branch spike/cloudflare. Read memory/context/hosting-and-infra.md (Cloudflare section) and the README "Cloudflare" section first. Do not change production behaviour on main.
1. Check the current Cloudflare guidance for Next.js (OpenNext @opennextjs/cloudflare vs vinext) and whether it supports Next 14.2; report with sources.
2. Try an OpenNext build; measure the compressed Worker size against the 3 MB (free) / 10 MB (paid) limits.
3. Test the known blockers: react-pdf/yoga runtime WebAssembly compile (built-in template PDF), DejaVu fonts written to os.tmpdir(), pdfjs-dist legacy build, pdf-lib form fill, docx fill, CPU time per request, 128 MB memory; production-secret rule (VERCEL_ENV only) – secrets must be set explicitly.
4. Note data-location implications (Workers run globally) vs Vercel lhr1.
5. Write docs/cloudflare-spike.md: works / breaks / effort to fix each / monthly cost comparison with sources / recommendation. Do not deploy anything without my OK. Update memory/context/hosting-and-infra.md and memory/decisions.md.
```

---

## 5. Word → PDF converter service – **P3 (before real clinic use)**
- **Goal:** PDF copies of completed Word forms in production (Vercel/Cloudflare can't run LibreOffice).
- **Status:** NOT STARTED; `forms/convert.ts` only spawns a local `soffice`; no `MEDREPORT_CONVERTER_URL` exists.
- **Blockers:** choice of host (Fly.io London / Railway / ~£5 UK VPS) and account.
- **Ready-to-paste prompt:**

```text
Add remote Word→PDF conversion to ClinForms. Read memory/context/hosting-and-infra.md (converter section) and src/modules/medreport/forms/convert.ts first. Plan first, then build on branch feat/converter.
1. In forms/convert.ts add a remote path: when MEDREPORT_CONVERTER_URL is set, POST the .docx to a Gotenberg-compatible endpoint (/forms/libreoffice/convert) with a shared-secret header (MEDREPORT_CONVERTER_TOKEN), timeout ~30 s, size cap, and return the PDF bytes; keep the local soffice path and the Vercel "unavailable" behaviour as fallbacks. Update pdfConversionAvailable(), .env.example, README and the module README env table. Tests with a mocked fetch.
2. Add deploy/converter/: Dockerfile (pinned gotenberg/gotenberg image), fly.toml for region lhr (or Railway notes), basic auth/secret check, no outbound network (document how per host), healthcheck, auto-update/patching note.
3. Document cost and setup in docs/converter.md (what I must click/pay). Do not deploy without my OK.
4. Checks green, commit, push; update memory files.
```

---

## 6. Production hardening (pilot-ready) – **P4, ~3–5 weeks once a clinic commits**
- **Goal:** safe to process real patient data for one pilot clinic.
- **Scope:** auth + 2FA/MFA + roles; tenancy on Supabase London (server-side reports, encryption at rest, append-only audit, retention jobs); per-clinic partner keys / OAuth client credentials; shared rate limiting (not in-memory); converter (§5); mapping Dell's real TM3 export (needs a sample); real `Tm3Connector` only if TM3 grants partner access; Stripe billing + usage metering; shared insurer-form library; streaming drafts + background batch queue; OpenAPI spec; gold-case regression set run on every prompt change; turn the ad hoc Playwright scripts in `scripts/e2e/` (commit `32499de`) into a maintained E2E suite (fix ports/selectors, add a runner); CSP. Compliance pack in parallel: DPA naming Anthropic as sub-processor, DPIA, ICO registration, Cyber Essentials, ZDR with Anthropic, legal review (Part 35 / MedCo), intended-purpose statement.
- **Status:** **IN PROGRESS on `feat/production`** (§1b: auth + two-step, tenancy, encrypted storage, append-only audit, retention cron, shared rate limits). Still open: converter (§5), real TM3 export mapping, billing, compliance pack.
- **Ready-to-paste prompt:**

```text
Plan (do not build yet) production hardening of ClinForms for a first pilot clinic with real patient data. Read CLAUDE.md, memory/projects/clinforms.md (§9–11), memory/context/compliance.md, memory/context/hosting-and-infra.md and memory/next-steps.md §6. Produce docs/hardening-plan.md: workstreams (auth/2FA/roles; Supabase London tenancy with RLS, server-side reports, encryption at rest, append-only audit, retention; partner keys/OAuth; shared rate limits; converter; TM3 export mapping; Stripe + metering; E2E suite (from scripts/e2e/); CSP; gold-case prompt regression), each with tasks, estimate in days, dependencies, what's needed from me, and a test/verification plan; plus the compliance checklist (DPA with Anthropic as sub-processor, DPIA, ICO, Cyber Essentials, Anthropic ZDR, legal review, intended-purpose statement) marking which are mine vs code. Keep the import boundaries and neutral customer wording rules. Then wait for my approval before any build.
```

---

## 7. Smaller items / follow-ups
| # | Item | Status | Needs |
|---|---|---|---|
| 7.1 | **Rotate every Anthropic key** that was in the cloud container (pasted 06/10 12:18 + a second key file the 09/10 build report mentions; check the Anthropic Console, revoke all but one fresh key); treat the old `careconnect-mk/.env.local` `MEDREPORT_LIVE_PASSCODE`, `MEDREPORT_LAUNCH_SECRET`, `MEDREPORT_SIGNING_SECRET`, `MEDREPORT_PARTNER_KEY`, `TM3_SIM_TOKEN` as burned – generate new values; new key only in `.env.local` + Vercel; spend-limited workspace + alerts | PENDING | Khuram |
| 7.2 | Dell follow-up: confirm v2 sent; introduce "ClinForms"; chase anonymised forms + notes; fix the "[7–10] days" commitment | PENDING | Khuram answers §A Q5 |
| 7.3 | Register `clinforms.co.uk` + `clinforms.com`; UK IPO trademark search "ClinForms" (classes 9, 42) | PENDING (unverified) | Khuram |
| 7.4 | RED company check (Companies House 13547807, website, likely PMS) before Tuesday | Not done | Web access |
| 7.5 | Generic video ("for UK physiotherapy clinics", ClinForms-branded, no Dell quotes) or RED-specific video after the call. Recorder: `scripts/medreport/video/record-demo.mjs` (needs running server `MEDREPORT_AI_MODE=auto PORT=3110 npm run start`, Playwright via `NODE_PATH=$(npm root -g)`, ffmpeg, poppler; ~10 min, ~8 live calls). Re-dub with ElevenLabs Beth on a new flow; QA timings against the SRT, add 10–20 ms fades | Offered, not requested | Khuram's OK |
| 7.6 | careconnect-mk branch: leave as archive (default) or delete; **never merge** | Undecided | Khuram |
| 7.7 | Pricing: confirm the price list to quote (Practice £199, founding £149 × 12 + £250 setup, 5 forms, extra-form cap, VAT stance); RED price not discussed (see §A Q7) | PROPOSED | Khuram |
| 7.8 | Haiku cost test (re-run an effort sweep; `sweep.ts` was not preserved – rebuild; `scripts/dev-tools/probe-models.ts` exists) | Offered | Only if asked |
| 7.9 | Doc fixes: module README says `MAX_FORM_FILE_BYTES` 3 MB (code 2.5 MB); add sandbox tests to a test script | Small | – |
| 7.10 | App nits: "Draft them now" doesn't auto-retry on 429; live Meridian analysis names referrer "Meridian" | Known | – |
| 7.11 | The Dell video's 1080p masters, clip MP3s and the sweep script were **not preserved in git** (cloud scratchpad only – assume gone; see `memory/assets.md`). The E2E `.cjs` scripts and dev tools ARE in git (`scripts/e2e/`, `scripts/dev-tools/`, commit `32499de`) – may need port/selector fixes (written for :3107) | – | – |
| 7.12 | Gmail: save reply drafts to Dell/Daniel via the Gmail connector – only if Khuram asks | – | – |
| 7.13 | Ask Khuram to check Vercel for a careconnect-mk project with preview deployments of branch `claude/confident-noether-z6l7kr` ("AppStackX Reports" + `/pms-sandbox`). If one exists: enable Deployment Protection or delete those previews, and remove/rotate `ANTHROPIC_API_KEY` and passcode env vars there, so the old-name module is not publicly reachable or spending credit | Unverified (13:52 UTC 09/10 remark, never checked) | Khuram |
| 7.14 | `assets/sales/blue-heart/README.md` heading says "(sent to Dell Baines, 9 Oct 2026)" – unconfirmed. Change to "(prepared for Dell Baines, 9 Oct 2026 – sending unconfirmed)" unless Khuram confirms it was sent; then update `memory/assets.md` | Small | §A Q5 |
