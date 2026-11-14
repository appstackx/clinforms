# Self-serve 14-day free trial (13/11/2026, owner approved; OFF by default)

Branch `feat/self-serve-trial`. A clinic that signs itself up ("Start free trial", docs/auth.md §1b) gets a free trial
straight away – no demo, no card. **Everything here sits behind the existing switch `CLINFORMS_SELF_SIGNUP`** (off by
default): while it is off no page, link, email or website text changes. Migration **0011** (`self_trial`,
`trial_email`).

## 1. What a trial includes

| | ClinDesk (sign-up on clindesk.co.uk) | ClinForms (sign-up on clinforms.co.uk) |
|---|---|---|
| Length | `CLINFORMS_TRIAL_DAYS` (default **14**, 1–366), from the **owner's first sign-in** (the moment is recorded once; a trial never starts before anyone has looked) | same |
| Card | not needed | not needed |
| Product | the clinic system (diary, patients, notes, invoicing, messages) and the Reports add-on, both on as **`trial`** | Reports (ClinForms' default) |
| Reports | `CLINFORMS_TRIAL_REPORTS` (default **10**) free reports for the whole trial – a **Trial** package (`clinic_package`, £0, 10 included). A report counts as before (its first live drafting that cost money, or its approval if nothing was drafted). Once 10 have counted, live drafting for a NEW report is refused: **403 `TRIAL_REPORTS_USED`** "Your free trial includes 10 reports … Buy the Reports add-on under Plan and billing to continue" (ClinForms: "Choose a plan"). A report already inside the 10 may be drafted again. Demo answers never count | same ("Choose a plan") |
| Texts | `CLINFORMS_TRIAL_TEXTS` (default **10**) text credits, granted once at sign-up as a ledger adjustment labelled **"Trial credits – free test texts for your trial"** (Messages → Text credits). Packs can be bought at any time – during the trial and after it ended (checked: buying was never blocked by a trial; the after-the-trial read-only rule lets it through) | – (texts are a clinic-system feature) |
| Drafting limits | 5 live drafting calls a minute, 60 a day (`clinic_plan`; ClinForms staff can change them on the platform page) | same |
| Healthcode | the existing readiness checks work as normal; nothing added, no file export promised | – |
| Sample data | "Explore with sample data" (§4) | – (the sample is the clinic system's demonstration data; ClinForms' own demo is the public `/reports`) |

The banner on every page (`/app`, the Studio and – new – the clinic system's shell): **"Free trial – N days left · X of
10 free reports used. Use made-up patient details only during the trial."** plus **"Choose a plan"** (owners and
admins → Plan and billing). Owner direction 24/10/2026 (no real patient data in a trial) is kept – see open decisions.

## 2. When the trial ends

- **Read-only, data kept.** Reports: as before (403 `TRIAL_ENDED` for anything new; everything opens and downloads).
  **Clinic system (new, self-serve trials only):** every server action / route that WRITES answers "Your free trial has
  ended, so nothing new can be added or changed. Your data is safe …" (`clinicActionActor` → `trial_ended`,
  `src/server/trial/access.ts`); every page, list, record, export and download still works. Buying text credits and
  everything under Plan and billing keep working. A trial ClinForms staff set by hand (platform page) is not affected.
- **Nothing is deleted automatically.** No cron deletes trial clinics; the daily retention job only applies each
  clinic's own report retention (365 days by default) and the sign-up request clean-up, exactly as before (tested: a
  trial that ended 75 days ago keeps its clinic, patients and trial record). The owner decides a retention rule later.
- Banner: "Your free trial has ended. Your data is safe: you can still open and download everything, but nothing new
  can be added or changed until a plan is chosen." + "Choose a plan".

## 3. Paying

The first paid activation (the existing subscription sync, `src/server/billing/sync.ts`) converts the trial at once:
`clinic_plan` → `paid`, `self_trial.converted_at`, the plan's packages and allowance apply immediately (the clinic
system `active`, Reports per the plan; the plan's own Reports package replaces the free Trial package; a plan without
Reports removes it). Every record is kept – patients, notes, invoices, reports, usage, the trial's texts, the sample
clinic. Guard: a clinic-brand trial that pays for a ClinForms plan only gets the clinic system **paused** (data kept) –
never free. Then one branded "You're on a paid plan" email. (Tests: `src/server/trial/testing/trial-suite.ts` "paying
converts the trial …" on SQLite, PGlite, D1 stand-in and real local D1; e2e T9–T10.)

## 4. Sample data – a separate sample clinic

Offered to the **owner** of a running self-serve **ClinDesk** trial on its start page (`/app` and the clinic system's Today page)
until used or declined ("No thanks"). **Design choice: a separate clinic, not flagged records inside the real one.**
Every report, export, invoice run, reminder, Healthcode check, search and count in the product is already scoped by
clinic, so made-up patients can never appear in the real clinic's reports or exports, and nothing has to remember a
"sample" flag; removing or ignoring it can never touch a real record. Flagged records would need a filter in every
query, forever – one forgotten filter mixes fictional patients into a real export.

- Name "<clinic> – sample clinic (fictional)", id `<clinic>-sample`; the owner is its only member (Switch clinic).
- Data: the demonstration clinic's seed (`scripts/pms` – Riverside's made-up sites, practitioners, 40 patients with
  cases, a diary week, notes, invoices; drama-range phone numbers, `@example.com` addresses), the demo flags (banner
  "Demo clinic – made-up data only", a notice on every output).
- Limits (it must never be a free second clinic): one per trial (one conditional claim; a crashed attempt is resumed
  after 5 minutes); the **same trial window** (ends with the trial, read-only afterwards, not converted by paying for
  the real clinic); no Reports (no drafting cost), no texts, no reminder rules – nothing is ever sent from it.

## 5. Emails (branded HTML + plain text)

| Email | When (UK calendar days, Europe/London) | Skipped when |
|---|---|---|
| Welcome – "your 14-day free trial has started" | at once when the first sign-in starts the trial (the cron catches up to day 2) | tips stopped; later than day 2 |
| Tips – "Three things to try … this week" | day 3 | tips stopped; "4 days left" already due |
| "4 days left in your … free trial" | 4 UK days before the end (day 10 of 14) | "last day" already due |
| "Your … free trial ends tomorrow / today" | the UK day before the end (day 13), or the end day | the trial already ended |
| "Your … free trial has ended – your data is safe" | after the end (day 14/15) | more than 7 days after the end |
| "You're on a paid … plan" | at once from the payment (webhook / success page), cron catch-up | more than 7 days after converting |

- Sent by the **existing daily cron** (`/api/cron/retention`, after retention, billing extras and the expiry sweep;
  ~15 s budget; `cron.trial_emails.done` log line with counts) – no queue service. Vercel Hobby runs it once a day at
  03:17 UTC, so day-based emails arrive in the early morning (see open decisions).
- **Exactly once per clinic per email**: a `trial_email` row is claimed before sending (primary key tenant + kind); a
  second run, a concurrent run or the request racing the cron does nothing; a send the provider refused is retried
  (max 3 attempts); a moment that passed is recorded as `skipped`, never sent late. Converted clinics get "paid" only.
  Only clinics with a `self_trial` row (never a sample clinic, a closed clinic or a hand-set trial).
- To the clinic's owner(s); the brand's sender (ClinDesk → its own MailerSend account when configured), tracking off.
- Layout (`src/server/email/layout.ts`): tables + inline CSS, max-width 600 with an Outlook ghost table, the brand's
  text wordmark and colours (no images, no remote content, no tracking pixel), bulletproof button + plain link, hidden
  preheader, plain-text twin. **The existing emails (invitation, password reset, sign-up confirmation, existing account,
  billing and text-credit notices) now use the same layout – words unchanged.**
- "Stop these tips emails" (welcome and tips only): a signed link to `/trial/stop-tips` (opening it changes nothing –
  the button does; 404 without a valid signature). Account emails (days left, ended, paid) always go.
- Previews: `npm run trial:email-previews -- --out <folder>` renders every trial email for both brands plus the
  existing emails to HTML + text (fictional data; sends nothing) – open `index.html`.

## 6. Abuse brakes

On top of sign-up's own limits (3 sign-ups per network per day, 3 emails per address per day, honeypot, signed time
stamp, disposable domains): a trial gets **no free reports or texts** (still a trial, clearly flagged on the platform
page) when the same owner address had a trial before (case, `+tags` and Gmail dots ignored), the network (IPv4 /24,
IPv6 /64) already started 2 trials with an allowance in 30 days, or the address's own (non-webmail) domain 3 in 30
days. Only keyed hashes (HMAC under `BETTER_AUTH_SECRET`) are stored – never the address, IP or domain. The trial's own
drafting limits and the sample clinic's limits (§4) cap the cost of one trial.

## 7. Platform page

`/app/platform/trials` (link on `/app/platform`): every trial clinic – brand, signed up, state (waiting / running /
ended / converted), started, end and days left, reports used of included, texts used of free, converted when, the abuse
decision, the sample clinic, the emails sent, tips stopped.

## 8. Switch-on checklist

**Before the first client (prerequisites):**
1. The **DPA reviewed** by a lawyer (`content/dpa.json` – still "DRAFT – pending legal review"), both brands' `/terms`
   allow online sign-up.
2. **Point-in-time recovery** on the Supabase project (production data from real clinics).
3. **Vercel Pro** (Hobby is for non-commercial use; also allows more frequent crons).
4. **MailerSend out of sandbox** for the brand's domain (and `MAILERSEND_API_KEY_CLINIC` + `MAILERSEND_FROM_EMAIL_CLINIC`
   for ClinDesk), `CLINFORMS_EMAIL_PROVIDER=mailersend`.

**Then:**
5. Apply migrations **0010_self_signup** and **0011_self_trial** to Supabase production (`npm run db:migrate` with the
   session pooler; and to D1 while it is the fallback). Code deployed before the migration is safe while the switch is
   off (reads absorb the missing tables; the cron sweep does nothing).
6. Optional: `CLINFORMS_TRIAL_DAYS`, `CLINFORMS_TRIAL_REPORTS`, `CLINFORMS_TRIAL_TEXTS` (defaults 14 / 10 / 10).
7. `CLINFORMS_SELF_SIGNUP=clinic` (and/or `forms`) on Vercel Production, `CLINFORMS_AUTH_ORIGINS` includes
   `https://clindesk.co.uk`; redeploy (the website's "Start free trial" and "14-day free trial, no card needed" are
   built with the deployment).
8. Check: clindesk.co.uk shows "Start free trial"; sign up with a mailbox you own; the welcome email arrives (branded);
   `/app/platform/trials` lists the clinic; the next morning's cron log shows `cron.trial_emails.done`.

To switch off: remove the variable and redeploy – existing trial clinics keep their trial, their data and their emails
(the cron keeps sending the remaining trial emails to clinics that already have one).

## 9. Code and tests

- Rules (pure): `src/lib/trial.ts` (settings, schedule, abuse forms), `src/lib/trial-copy.ts` (banner),
  `src/lib/clindesk/trial-cta.ts` (website).
- Server: `src/server/trial/{start,allowance,access,emails,sample,view,platform}.ts`, `src/server/repos/self-trial.ts`,
  `src/server/email/{layout,trial-templates}.ts`; hooks in `src/server/signup/self-signup.ts` (finishSignup),
  `src/server/admin/clinic-plan.ts` (first visit → welcome), `src/server/billing/{sync,notify}.ts` (conversion),
  `src/server/pms/actor.ts` (read-only), `src/server/auth/medreport-actor.ts` + `src/modules/medreport/auth/clinic-access.ts`
  (10-report cap), `src/app/api/cron/retention/route.ts` (sweep).
- Tests: `src/server/trial/trial.test.ts` (suite on SQLite + PGlite, and a database before 0011),
  `workers/data-gateway/test/trial-stack.test.ts` (D1 stand-in + real local D1), `src/lib/trial.test.ts` (schedule,
  clock change), `src/server/email/trial-emails.test.ts` (every email, both brands; layout; stop-tips),
  `src/components/clindesk/trial-cta.test.ts` (website off/on), `src/server/trial/migrations.test.ts`,
  `src/server/auth/self-signup.test.ts` (sign-up now starts the trial), e2e `scripts/e2e/trial-journey.cjs` (whole
  journey incl. Stripe TEST checkout) and `scripts/e2e/self-signup.cjs` (updated landing).

## 10. Open decisions (owner)

- "Use made-up patient details only during the trial" (owner direction 24/10 for hand-set trials) is kept for self-serve
  trials too – drop it once the DPA is final and online acceptance is accepted as the contract?
- Email send time: the one daily cron runs 03:17 UTC. A second Vercel cron at 09:00 UK for the trial emails is a
  one-line change once on Pro.
- Retention for trials that never convert (none is deleted today).
- Sample clinic after paying: it stays read-only; offer "Remove sample clinic" (offboard) as a button?
- Abuse thresholds (2 per network / 3 per domain per 30 days) – adjust after the first weeks' data.
