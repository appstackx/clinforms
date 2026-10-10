# Next steps – prioritised backlog

State: **Sat 2026-10-10 ~19:00 UTC** (desktop). **ClinForms is LIVE on https://clinforms.co.uk** since 17:13 UTC
(`main` `02ddfb5` → `04c18d0` passcode server check → `8def25b` polish, all deployed; `feat/production` == `main`).
The RED demo is frozen at tag `red-demo-2026-10-13` in `~/Projects/Appstackx/clinforms-demo` for the call on
**Tue 13 Oct, morning**. Snapshot of what is live: `CLAUDE.md`; run log: `docs/go-live.md`.
Rule: Khuram wants **a short plan first, build after his OK** for anything big – keep it brief when a deadline is close.
Update this file at the end of every session (status, blockers, what changed).

## 0. First 15 minutes of a new session (checklist)
1. Read `CLAUDE.md`, this file, `memory/README.md`; skim `memory/decisions.md` (top rows).
2. `git fetch && git status && git worktree list && git log --oneline -5` (expect `main` = `8def25b` or later);
   `nvm use` (Node 22); `npm ci` (+ `(cd workers/data-gateway && npm ci)`).
3. Production health (read-only): `curl -s https://clinforms.co.uk/api/reports/v1/health` →
   `{"product":"ClinForms",…,"model":"drafting-service","promptVersion":"","pdfFromWord":false}`;
   `curl -s https://clinforms-data.appstackx-demos.workers.dev/v1/health` → `{"ok":true}`;
   `npx --yes vercel@63.1.0 ls clinforms --environment production --limit 3`; errors:
   `npx --yes vercel@63.1.0 logs --environment production --since 24h --level error`. Look at `/app/platform` →
   Access requests (email is off: nobody is notified of a new request) – or ask Khuram to.
4. Baseline before any change: the full check chain (`CLAUDE.md` → Key commands). **Pushing `main` deploys.**
5. Never touch `~/Projects/Appstackx/clinforms-demo`, tag `red-demo-2026-10-13` or branch `demo/red-physio`
   (at least until after the RED call).
6. Send Khuram **one message** with the open questions in §A.

### §A. Questions for Khuram (ask once, together)
1. RED call: exact time on Tue 13 Oct; who attends? (Day confirmed 09/10 – D45.)
2. **Anthropic key:** is the production `ANTHROPIC_API_KEY` the new key, and have the older keys (the 06/10 chat key
   and the second cloud key file) been deleted in the Console? (Asked at go-live; he asked why – told: keep the new
   key, delete older ones; not a launch blocker. **Confirmation still unanswered.**)
3. Did the voiced v2 video go to Dell? Did he reply or send forms? Which of our 06/10 draft replies did you send?
4. If Daniel asks about price on Tuesday, what do we say? (Proposal: `memory/context/pricing.md`; same structure as
   Blue Heart – per clinic; Practice £199/mo list; founding £149/mo × 12 + £250 setup incl. 5 forms – or "depends on
   volume, typically £99–£199/month; confirmed after a short pilot".)
5. "Organise these notes" (assisted structuring of messy notes, would send notes to the drafting service) – build it
   or not? (§2 item 2.10.)
6. Company number, registered office and ICO registration for the site footer/legal pages; who reviews the legal
   pages (§2 item 2.6)?
7. Is `clinforms.com` registered (redirect to `.co.uk`)? UK IPO trademark search "ClinForms" (classes 9, 42)?
8. Outreach: start sending the video (link `clinforms.co.uk/demo`) – to whom, from which mailbox, when?

---

## 1. RED Physiotherapy call – **P0, Tue 2026-10-13, morning (exact time: the invite)**
- **Everything is in the call pack `docs/demo-red-physio.md`** (support matrix, Monday/Tuesday checklist with exact
  commands, Chrome set-up, what to pre-upload, 10-minute script with click path and rehearsal timings, labels to
  frame, honest answers, questions for Daniel, fallbacks). Short version: `memory/projects/red-physiotherapy.md` §8.
- **Frozen demo:** `~/Projects/Appstackx/clinforms-demo` (detached at tag `red-demo-2026-10-13` = `3521401`, own
  `node_modules`, `.next`, `.env.local` with an absolute `MEDREPORT_DEMO_ASSETS_DIR` → gitignored
  `clinforms/demo-assets/insurers/`: 6 insurer PDFs, 7 maps, 4 answer files). `npm run demo:check` → "Demo assets OK:
  7 maps, 4 answer files, 6 form files". Do not pull, rebuild from `main` or move the tag.
- **Khuram:**
  1. **Monday evening:** one rehearsal in his own Chrome, separate "ClinForms demo" profile, from the frozen folder
     (call pack §2.2) – maps live in the browser that confirmed them; then Reset demo.
  2. **Tuesday morning:** quit heavy processes/agent workflows, `npm run demo:red -- --skip-build`, pre-upload and
     confirm AXA + Aviva CM016, leave Bupa to upload live, two tabs (call pack §2.3). Order: Bupa end to end → AXA
     identifier block (never type AXA numbers or approve AXA) → portal questions (prognosis gap) → Aviva 30 s
     (prefill) → ask for 2–3 blank forms.
  3. Confirm RED's practice system if possible (if not TM3, avoid the home page); decide the price line (§A Q4).
  4. Don't send Daniel clinforms.co.uk as "the demo" (call pack); whether to follow up with the `/demo` video is Khuram's call.
- **After the call:** record Daniel's answers in `memory/projects/red-physiotherapy.md` §7 + `decisions.md`; then the
  freeze ends (the folder/tag can stay as an archive).
- **Still open (product):** a second fictional patient whose record names AXA Global Healthcare; `forms-8` giving the
  drafting prompt each box's capacity; BESS/BOA and "cuff" in the glossary; generic upload dialog defaults to
  "Medico-legal company"; whether AXA accepts an electronic approval line; review time with real clinicians.

## 1b. Production – **LIVE since 10/10 17:13 UTC** (go-live loose ends)
What is live, infra ids and env var names: `CLAUDE.md` status snapshot; architecture: `memory/context/hosting-and-infra.md`;
runbook + run log + known limits: `docs/go-live.md` (§8).
| # | Item | Status | Needs |
|---|---|---|---|
| G1 | **§7.6 – the offline key really decrypts production data.** No encrypted row exists yet (0 reports / 0 form files at 18:58 UTC; Khuram declined a test upload). Alternative in progress: a `CRON_SECRET`-protected `/api/ops/key-fingerprint` endpoint (branch `ops/key-fingerprint`, worktree `clinforms-wt/key-fp`, workflow `wf_c9f57175-279`) to compare the key's fingerprint with the secrets file's, without data | IN PROGRESS (not on `main` at 19:00) | Merge + deploy after review; or run §7.6 after the first encrypted write |
| G2 | First scheduled retention run: `cron.retention.done` in the Vercel logs on 11/10 (Hobby runs it within the 03:00 UTC hour); then update the security/privacy pages' "automatic deletion is planned" wording (go-live §8) | Waiting | Check logs 11/10 |
| G3 | Delete the fictional smoke-test access request (`go-live-check@example.com`, still the only row at 18:58 UTC): `wr d1 execute clinforms-prod --remote --command "DELETE FROM access_requests WHERE email = 'go-live-check@example.com'"` (go-live §7.2) | PENDING | A write on production – Khuram's OK |
| G4 | Anthropic key confirmation (§A Q2) | UNANSWERED | Khuram |
| G5 | Retire `feat/production` (== `main`) and the merged wave worktrees under `clinforms-wt/` (`p2-*`, `p3-notes`, `w2-*`, `w3-e2e`, `red-*`, `passcode-fix`, `polish-1`, `demo-page`) – all merged into `main`; keep `clinforms-demo`, `red-integrate` (= the tag) and `video` | Optional | Khuram's OK (after the RED call) |
| G6 | Optional: tag the release `go-live-2026-10-10` on `02ddfb5` (go-live "After go-live") | Optional | – |
| G7 | Re-make the offline secrets backup (encrypted dmg in iCloud Drive) after ANY change to `~/.config/appstackx/clinforms.secrets.env` (e.g. a `CRON_SECRET` or key rotation) | Rule | Khuram |

## 2. Post-launch backlog (before / for the first paying clinic)
| # | Item | Priority | Status | Needs |
|---|---|---|---|---|
| 2.1 | **Vercel Pro** before a paying clinic (Hobby = non-commercial; also: rollback only to the previous deployment, cron timing within the hour) | P1 (before payment) | Hobby now (D41) | Khuram pays |
| 2.2 | **Cloudflare Workers Paid** ($5/mo: more CPU per gateway request, 10 GB D1, 30-day Time Travel) before real patient data; check `wrangler d1 info clinforms-prod` | P1 (before real data) | Free (per runbook §8 – verify) | Khuram pays |
| 2.3 | **MailerSend** when ready: `MAILERSEND_API_KEY`, `MAILERSEND_FROM_EMAIL` (verified sender on clinforms.co.uk), `CLINFORMS_EMAIL_PROVIDER=mailersend`, optional `CLINFORMS_ACCESS_REQUEST_TO`; until then invite/reset links go by hand and access requests notify nobody | P1 | Chosen (D40), not set up | Khuram: MailerSend domain + key |
| 2.4 | **Word → PDF converter** (UK Gotenberg/LibreOffice service; prompt §4 below) – a Word form downloads as Word only today (`pdfFromWord: false`) | P2 (before clinics needing PDF copies of Word forms) | Not started | Host choice |
| 2.5 | **Real PMS connectors** (TM3 export mapping from a real sample; TM3 API only if TM3 grants partner access; Cliniko…). Today clinics upload notes; a launch from a clinic system → 503 `CONNECTOR_NOT_CONFIGURED` | P2 | Not started | A clinic's system + terms |
| 2.6 | **Legal pages owner review** (privacy, cookies, terms, security – drafts dated 9 Oct 2026), ideally with legal advice; **company number, registered office, ICO registration** into `src/lib/site.ts` `COMPANY` (lines hidden until set); ICO fee before real patient data | P1 | Drafts live | Khuram (§A Q6) |
| 2.7 | **DPA + DPIA templates**, sub-processor list (Anthropic named), intended-purpose statement – before the first clinic with real data | P1 | Not started | Khuram + legal |
| 2.8 | **Supabase Postgres London** when a clinic pays (D39); switch runbook `docs/database.md` §8; `db:provision-supabase`, `db:copy-to-postgres` exist | P3 | Ready in code | A paying clinic |
| 2.9 | **CSP:** add a same-origin report endpoint (no query strings logged – reset/invite links carry tokens), watch Report-Only, then enforce | P2 | Report-Only, no reporting | – |
| 2.10 | **"Organise these notes"** – assisted structuring of notes the reader can't structure (sends notes to the drafting service) | P3 | Not built (follow-up noted in wave 3) | **Khuram's decision** |
| 2.11 | **Outreach with the video:** `~/Projects/Appstackx/marketing/clinforms/outreach-video-v1/` (master, 7 MB email MP4, teaser GIF, poster, SRT; usage notes in its README); link **`https://clinforms.co.uk/demo`** with campaign-level UTM only (`utm_source/medium/campaign`; never a clinic or person); first email: link the poster/GIF, don't attach | P1 (sales) | Video final; no sends recorded | Khuram (§A Q8) |
| 2.12 | Media host: **Always Use HTTPS** on zone `clinforms.co.uk` | – | **DONE 10/10 ~18:50 UTC** (Khuram OK; `http://media.clinforms.co.uk` → 301 https) | – |
| 2.13 | Scheduled off-site backup: weekly `wrangler d1 export` to encrypted storage once real data exists (`docs/database.md` §7) | P2 (before real data) | Manual only (Time Travel) | – |
| 2.14 | Billing (Stripe: new account per product, see the Appstackx CLAUDE.md), usage metering | P3 | Not started | A paying clinic |
| 2.15 | `sales/outreach-video` branch (recorder scripts) – merge to `main` or leave as is | P4 | Not merged | Khuram |

---

## 3. Production hardening – status
**Built and live** (10/10): invite-only accounts with required TOTP two-step and roles (owner/admin/clinician/staff);
per-clinic tenancy; AES-256-GCM encryption at rest per clinic; append-only audit log (`/app/settings/activity`);
retention cron; shared (database) rate limits; partner keys (created, unused); public site + legal drafts;
consent-gated analytics; security headers (CSP Report-Only). **Still open:** §2 above (converter, PMS mapping,
billing, email, CSP enforcement, compliance pack: DPA naming Anthropic, DPIA, ICO, Cyber Essentials, Anthropic ZDR,
legal review of Part 35 / MedCo, intended-purpose statement), E2E suite as a maintained runner, gold-case prompt
regression set.

## 4. Word → PDF converter service – **P2 (before clinics that need PDF copies of Word forms)**
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

## 5. Hardening plan prompt (only if Khuram wants a written plan for the rest of §3)

```text
Plan (do not build yet) production hardening of ClinForms for a first pilot clinic with real patient data. Read CLAUDE.md, memory/projects/clinforms.md (§9–11), memory/context/compliance.md, memory/context/hosting-and-infra.md and memory/next-steps.md §6. Produce docs/hardening-plan.md: workstreams (auth/2FA/roles; Supabase London tenancy with RLS, server-side reports, encryption at rest, append-only audit, retention; partner keys/OAuth; shared rate limits; converter; TM3 export mapping; Stripe + metering; E2E suite (from scripts/e2e/); CSP; gold-case prompt regression), each with tasks, estimate in days, dependencies, what's needed from me, and a test/verification plan; plus the compliance checklist (DPA with Anthropic as sub-processor, DPIA, ICO, Cyber Essentials, Anthropic ZDR, legal review, intended-purpose statement) marking which are mine vs code. Keep the import boundaries and neutral customer wording rules. Then wait for my approval before any build.
```

---

## 7. Smaller items / follow-ups
| # | Item | Status | Needs |
|---|---|---|---|
| 7.1 | **Keys:** production `MEDREPORT_*` / `TM3_SIM_TOKEN` values are fresh (generated 09/10 for Vercel, in the secrets file); production data key rotated k1 → k2 on 10/10 (k1 shown in a screenshot, no data existed). **Anthropic:** Khuram to confirm the new key is in production and older keys (06/10 chat key + the second cloud key file) are deleted; spend-limited workspace + alerts | PARTLY DONE | Khuram (§A Q2) |
| 7.2 | Dell follow-up: confirm v2 sent; introduce "ClinForms"; chase anonymised forms + notes; fix the "[7–10] days" commitment; the `/demo` video could go to him too | PENDING | Khuram answers §A Q3 |
| 7.3 | `clinforms.co.uk` registered and live (DNS on Cloudflare); `clinforms.com` unknown; UK IPO trademark search "ClinForms" (classes 9, 42) | PARTLY DONE | Khuram (§A Q7) |
| 7.4 | RED company check (Companies House 13547807, website, likely PMS) before Tuesday | Not done | Web access |
| 7.5 | RED-specific or other video after the call. Generic outreach video DONE 10/10 (`marketing/clinforms/outreach-video-v1/`, recorder on `sales/outreach-video`) | – | Khuram's OK |
| 7.6 | careconnect-mk branch: leave as archive (default) or delete; **never merge** | Undecided | Khuram |
| 7.7 | Pricing: confirm the price list to quote (Practice £199, founding £149 × 12 + £250 setup, 5 forms, extra-form cap, VAT stance); RED price not discussed (§A Q4) | PROPOSED | Khuram |
| 7.8 | Haiku cost test (re-run an effort sweep; `sweep.ts` was not preserved – rebuild; `scripts/dev-tools/probe-models.ts` exists) | Offered | Only if asked |
| 7.9 | Doc fix: module README says `MAX_FORM_FILE_BYTES` 3 MB (code 2.5 MB) | Small | – |
| 7.10 | App nits: "Draft them now" doesn't auto-retry on 429; live Meridian analysis names referrer "Meridian" | Known | – |
| 7.11 | The Dell video's 1080p masters, clip MP3s and the sweep script were **not preserved in git** (see `memory/assets.md`) | – | – |
| 7.12 | Gmail: save reply drafts to Dell/Daniel via the Gmail connector – only if Khuram asks | – | – |
| 7.13 | Ask Khuram to check Vercel for an old careconnect-mk project with preview deployments of branch `claude/confident-noether-z6l7kr` ("AppStackX Reports" + `/pms-sandbox`); if one exists: protect or delete those previews and remove its `ANTHROPIC_API_KEY`/passcode env vars | Unverified | Khuram |
| 7.14 | `assets/sales/blue-heart/README.md` heading says "(sent to Dell Baines, 9 Oct 2026)" – unconfirmed; change to "(prepared for … – sending unconfirmed)" unless Khuram confirms; then update `memory/assets.md` | Small | §A Q3 |

---

## Archive – done or superseded prompts (kept for reference)
- **RED demo task** (DONE 09/10; enriched version of `memory/sources/red-physio-demo-task.md`):

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

- **Vercel deploy readiness** (SUPERSEDED: clinforms.co.uk live on Vercel Hobby since 09/10; production line since 10/10):

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

- **Supabase scripts** (SUPERSEDED: migrations, parity tests and admin scripts built and live on D1; Supabase later – D39):

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

- **Cloudflare Workers spike** (RESOLVED – D39: the app stays on Vercel; Cloudflare only for D1 + gateway Worker + R2 media):

```text
Run a time-boxed (max 3 hours) Cloudflare Workers feasibility spike for ClinForms on branch spike/cloudflare. Read memory/context/hosting-and-infra.md (Cloudflare section) and the README "Cloudflare" section first. Do not change production behaviour on main.
1. Check the current Cloudflare guidance for Next.js (OpenNext @opennextjs/cloudflare vs vinext) and whether it supports Next 14.2; report with sources.
2. Try an OpenNext build; measure the compressed Worker size against the 3 MB (free) / 10 MB (paid) limits.
3. Test the known blockers: react-pdf/yoga runtime WebAssembly compile (built-in template PDF), DejaVu fonts written to os.tmpdir(), pdfjs-dist legacy build, pdf-lib form fill, docx fill, CPU time per request, 128 MB memory; production-secret rule (VERCEL_ENV only) – secrets must be set explicitly.
4. Note data-location implications (Workers run globally) vs Vercel lhr1.
5. Write docs/cloudflare-spike.md: works / breaks / effort to fix each / monthly cost comparison with sources / recommendation. Do not deploy anything without my OK. Update memory/context/hosting-and-infra.md and memory/decisions.md.
```
