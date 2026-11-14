# Self-serve 14-day free trial (13/11/2026, owner approved; OFF by default)

Branch `feat/self-serve-trial`. A clinic that signs itself up ("Start free trial", docs/auth.md §1b) gets a free trial
straight away – no demo, no card. **Everything here sits behind the existing switch `CLINFORMS_SELF_SIGNUP`** (off by
default): while it is off no page, link, email or website text changes. Migration **0011** (`self_trial`,
`trial_email`, `trial_report_hold`; extended in place on 14/11/2026 – still unreleased – with the deletion columns, the
`deletion_warning` email kind and the sample state `removed`).

## 1. What a trial includes

| | ClinDesk (sign-up on clindesk.co.uk) | ClinForms (sign-up on clinforms.co.uk) |
|---|---|---|
| Length | `CLINFORMS_TRIAL_DAYS` (default **14**, 1–366), from the **owner's first sign-in** (the moment is recorded once; a trial never starts before anyone has looked) | same |
| Card | not needed | not needed |
| Product | the clinic system (diary, patients, notes, invoicing, messages) and the Reports add-on, both on as **`trial`** | Reports (ClinForms' default) |
| Reports | `CLINFORMS_TRIAL_REPORTS` (default **10**) free reports for the whole trial – a **Trial** package (`clinic_package`, £0, 10 included). A report counts as before (its first live drafting that cost money, or its approval if nothing was drafted). Before each LIVE drafting call one free report is **reserved atomically** for the report (`self_trial.reports_reserved` by one conditional UPDATE + a `trial_report_hold` row – parallel drafts can never exceed 10; given back when the call failed without cost). Once none are left, live drafting for a NEW report is refused: **403 `TRIAL_REPORTS_USED`** "Your free trial includes 10 reports … Buy the Reports add-on under Plan and billing to continue" (ClinForms: "Choose a plan"). A report already inside the 10, and an amendment of a counted report, may be drafted again. Demo answers never count | same ("Choose a plan") |
| Texts | `CLINFORMS_TRIAL_TEXTS` (default **10**) text credits, granted once at sign-up as a ledger adjustment labelled **"Trial credits – free test texts for your trial"** (Messages → Text credits). Packs can be bought at any time – during the trial and after it ended (checked: buying was never blocked by a trial; the after-the-trial read-only rule lets it through) | – (texts are a clinic-system feature) |
| Drafting limits | 5 live drafting calls a minute, 60 a day (`clinic_plan`; ClinForms staff can change them on the platform page) | same |
| Healthcode | the existing readiness checks work as normal; nothing added, no file export promised | – |
| Sample data | "Explore with sample data" (§4) | – (the sample is the clinic system's demonstration data; ClinForms' own demo is the public `/reports`) |

The banner on every page (`/app`, the Studio and – new – the clinic system's shell): **"Free trial – N days left · X of
10 free reports used."** plus **"Choose a plan"** (owners and admins → Plan and billing). **14/11/2026 (owner decision):
no "use made-up patient details only" line for self-serve trials** – not on the banner, the sign-up page, the trial
emails, the tips (they no longer say "made-up appointments / a made-up patient's notes") or the drafting switch
(Settings → Clinic and the overview checklist use the standard wording for a self-serve trial). A trial ClinForms staff
set by hand (Blue Heart's kind) keeps "Trial – N days left. Use made-up notes only until your data processing agreement
is signed." and its drafting wording, unchanged (`clinicTrialRunning` is true only for a hand-set trial). The sample
clinic is still described as made-up data – it is.

## 2. When the trial ends

- **Read-only, data kept.** Reports: as before (403 `TRIAL_ENDED` for anything new; everything opens and downloads).
  **Clinic system (self-serve trials only, `src/server/trial/access.ts trialWriteBlock`):** every server action is a
  WRITE unless it is marked `readOnly: true` (an audited list of searches and loaders – `src/server/trial/write-paths.test.ts`),
  whatever its permission – so emailing an invoice, reviewing a form response or starting a referrer form is refused
  too ("Your free trial has ended, so nothing new can be added or changed. Your data is safe …"); route handlers read on
  GET / HEAD (downloads – letters, activity CSV, role history – stay open); the clinic API's writes answer 403
  `READ_ONLY`; the messages cron sends nothing for the clinic (no reminders, no campaigns); public booking and portal
  pages close. Every page, list, record, export and download still works. Buying text credits and everything under
  Plan and billing keep working. A trial ClinForms staff set by hand (platform page) is not affected.
- **Kept for 90 days, then deleted (owner decision 14/11/2026; self-serve trials only – `src/server/trial/retention.ts`).**
  A self-serve trial that ends without a plan stays read-only for **90 days**; nothing is deleted before. The daily cron
  (`/api/cron/retention`, 03:17 UTC, after the trial emails, **only after a successful retention pass**; own budget ~10 s,
  at most 10 clinics a night; log line `cron.trial_retention.done` with counts) then:
  1. **Warning – 14 days before** (UK day = end's UK day + 77): one branded HTML + text email to the owner(s) in the
     trial's brand – "Your <brand> trial clinic will be deleted on <date>": the date, "to keep it: choose a plan before
     then", "to keep a copy: Export CSV on the Patients and Billing pages, download letters, files and reports"
     (ClinForms: "download the completed forms and reports"), "reply if you need help". Claimed per clinic and per owner
     like every trial email (kind `deletion_warning`; never twice; a refused send retried for that owner, max 3).
  2. **The date it promises** (`self_trial.deletion_due_at`, UK midnight) is the end's UK day **+ 91** (so at least 90 full
     days), or – when the warning goes late (sweep off, provider refused it) – **14 days from the day it actually goes**.
     Once an owner has it the date never moves – unless staff extend or restart the trial: a warning for an earlier end
     no longer counts, it is forgotten and a fresh warning goes 14 days before the new date.
  3. **Deletion on that day** – only if an owner was actually SENT the warning, at least 14 UK days earlier, the promised
     day has come (for the CURRENT end – staff may have moved it). One conditional claim per clinic
     (`deletion_claimed_at`, stale after 30 minutes): two runs never delete twice; a deletion that stopped part-way (a
     crash, the function's time limit, a failed batch) KEEPS its claim and a later run finishes it. Under the claim
     everything is read again – and once more right before the clinic itself: still a self-serve trial (a `self_trial`
     row; a trial set by hand never has one), **not converted**, the plan still an **ended trial** (not paid, not
     extended), **no subscription that is not over** (any status but canceled / incomplete_expired holds it), **no payment
     page opened in the last 48 hours** (audit `clinic.subscription_checkout` – the payment page expires within 24 hours),
     the clinic still open.
  4. **What is deleted:** the offboarding's own deletes (`offboardClinic` with `withoutExport` – the path
     `admin:offboard-clinic` uses, without the export): every clinic-system record and ClinForms record, form files, the
     **stored patient files** (removed FIRST, so a failure leaves rows that the next night finds again), members,
     invitations, profiles, sessions' active clinic, partner keys revoked, and the accounts that belong to no other clinic.
     The stored files' keys are saved on the `self_trial` row (`deletion_files_json`) BEFORE the rows go and the files are
     removed AFTER them (retried every night until removed) – a clinic is never left with rows whose files are gone.
     **Kept, as an offboarding keeps them:** the organization row as a tombstone (the id is never reused), the audit trail
     (incl. the `clinic.offboard` row, detail `withoutExport: "trial_expired"`), the sign-up acceptance records, the
     billing / usage records, and the `self_trial` row (keyed hashes and counts – marked `deleted_at`, so the abuse brakes
     still see the earlier trial) with its `trial_email` rows. `trial_report_hold` rows go.
  5. **Its sample clinic is deleted with it, first** (only the sample whose own row – or, after a crash before that row was
     written, whose organization's `sampleOf` – names this clinic).
  **Never touched:** a clinic that paid (converted – even one that later stops paying), a trial converted by hand, a
  trial ClinForms staff set by hand, a clinic with a subscription under way, the sample clinic of a paid clinic. A trial
  whose owner never signed in (no end date) is never deleted. With email off (`CLINFORMS_EMAIL_PROVIDER=none`) no warning
  is delivered, so nothing is deleted (`held` in the log).
- Banner after the end (self-serve): "Your free trial has ended. Your data is safe and kept for 90 days, until <last
  day>: you can still open and download everything, but nothing new can be added or changed until a plan is chosen." +
  "Choose a plan" (the last day = the day before the deletion day – the deletion runs early that morning; a later day a
  late warning promised drops "for 90 days"; the sample clinic shows its real clinic's). The ended email and the warning
  name the same days ("kept … until Sunday 28 February", "deleted on Monday 1 March – choose a plan by Sunday 28
  February").

## 3. Paying

The subscription sync (`src/server/billing/sync.ts finishSelfServeTrial`) converts the trial at once – and checks it
again on EVERY sync of an active subscription until it is complete (idempotent: a crash part-way, or a conversion by
hand on the platform page, is finished by the next sync): `clinic_plan` → `paid`, `self_trial.converted_at`, the
trial's drafting limits (5/min, 60/day) back to the defaults (limits staff changed are kept), the plan's packages and
allowance apply immediately (the plan's own Reports package replaces the free Trial package; a plan without Reports
removes it). The trial's reports never count as extras of the first paid month (`billing/extras.ts`). Every record is
kept – patients, notes, invoices, reports, usage, the trial's texts, the sample clinic.

**A product the plan does not include** (owner: never lose access to data): if the trial left data in it (patients in
the clinic system, reports in Reports) it stays on as `trial` = **read-only** – readable and downloadable, nothing new,
with the notice "Read-only – these records are from your free trial … Add ClinDesk / the Reports add-on to your plan to
keep working on them" (banner, refusals, the Report API's 403 `READ_ONLY`); the sync never switches it off, and buying
it makes it active again. Without data it is paused. So a ClinForms-only plan never keeps the clinic system writable
for free. A clinic that paid is never deleted by the 90-day rule (§2). Then one branded "You're on a paid plan" email, in the brand of the product bought. (Tests: `src/server/trial/testing/trial-suite.ts` "paying
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
- Made in **short resumable steps** (clinic, patients, set-up, diary, records, billing – ~8 s a call, the page calls
  again until it is ready; a crashed step is resumed after 2 minutes) – no request runs long.
- Limits (it must never be a free second clinic): one per trial (one conditional claim); its **owner only** – Better
  Auth refuses invitations and new members into it (`SAMPLE_CLINIC`); the **same trial window** (ends with the trial, read-only afterwards, not converted by paying for
  the real clinic); no Reports (no drafting cost), no texts, no reminder rules – nothing is ever sent from it.
- **After paying – "Remove sample clinic" (14/11/2026):** the real clinic's **owner** (only – admins and others see no
  button, and the action re-checks the owner role in the member table) sees a "Sample clinic" card on `/app` and the
  clinic system's Today page while the sample exists. Two steps: "Remove sample clinic" → "Remove the sample clinic
  permanently? … It cannot be undone. Your own clinic and its records are not affected." → "Remove permanently". It
  deletes ONLY the sample clinic through the same offboarding deletes (no export – made-up data), one conditional claim
  (`sample_state` ready/creating → `removed`; two clicks remove once; never under a creation step that still holds its
  lock), audited `clinic.sample_removed` in the real clinic (by the owner) and `clinic.offboard` (`withoutExport:
  "sample_removed"`) in the sample. The owner's account and the real clinic are untouched; the offer to create a sample
  does not come back. (`src/server/trial/sample.ts removeSampleClinic`, `src/app/app/sample-actions.ts`,
  `src/components/account/remove-sample.tsx`.)
- An unpaid trial's sample clinic is deleted together with it after the 90 days (§2).

## 5. Emails (branded HTML + plain text)

| Email | When (UK calendar days, Europe/London) | Skipped when |
|---|---|---|
| Welcome – "your 14-day free trial has started" | at once when the first sign-in starts the trial (the cron catches up to day 2) | tips stopped; later than day 2 |
| Tips – "Three things to try … this week" | day 3 | tips stopped; "4 days left" already due |
| "4 days left in your … free trial" | 4 UK days before the end (day 10 of 14) | "last day" already due |
| "Your … free trial ends tomorrow / today" | the UK day before the end (day 13), or the end day | the trial already ended |
| "Your … free trial has ended – your data is safe" | after the end (day 14/15) | more than 7 days after the end |
| "You're on a paid … plan" | at once from the payment (webhook / success page), cron catch-up | more than 7 days after converting |
| "Your … trial clinic will be deleted on <date>" (14/11/2026) | 14 days before the deletion (end + 77 UK days; late = 14 days' notice from the day it goes) – the retention sweep (§2) | the clinic paid or was converted; a hand-set trial; email off (then nothing is deleted) |

The "ended" email now says the data is kept for 90 days (with the date) and that a warning comes two weeks before the
deletion; "ends tomorrow / today" says "for 90 days after the trial you can still sign in …". The welcome no longer has
the made-up-details line.

- Sent by the **existing daily cron** (`/api/cron/retention`, after retention, billing extras and the expiry sweep;
  ~15 s budget; `cron.trial_emails.done` log line with counts) – no queue service. Vercel Hobby runs it once a day at
  03:17 UTC, so day-based emails arrive in the early morning (see open decisions).
- **Exactly once per clinic and per owner**: a `trial_email` row is claimed for the clinic, then one per owner, before
  sending; a second run, a concurrent run or the request racing the cron does nothing; a send the provider refused is
  retried for that owner only (max 3 attempts – an owner who got it never gets it twice); a moment that passed is
  recorded as `skipped`, never sent late. The clinic's paid status is re-read right before a send: converted clinics
  get "paid" only (in the brand of the product bought).
  Only clinics with a `self_trial` row (never a sample clinic, a closed clinic or a hand-set trial).
- To the clinic's owner(s); the brand's sender (ClinDesk → its own MailerSend account when configured), tracking off.
- Layout (`src/server/email/layout.ts`): tables + inline CSS, max-width 600 with an Outlook ghost table, the brand's
  text wordmark and colours (no images, no remote content, no tracking pixel), bulletproof button + plain link, hidden
  preheader, plain-text twin. **The existing emails (invitation, password reset, sign-up confirmation, existing account,
  billing and text-credit notices) now use the same layout – words unchanged.**
- "Stop these tips emails" (welcome and tips only): a signed link to `/trial/stop-tips` (opening it changes nothing –
  the button does; 404 without a valid signature; no cookie banner and no analytics there, like the sign-in pages). Account emails (days left, ended, paid) always go.
- Previews: `npm run trial:email-previews -- --out <folder>` renders every trial email for both brands plus the
  existing emails to HTML + text (fictional data; sends nothing) – open `index.html`.

**Switched off = unchanged.** Every trial path checks for a `self_trial` row first: a trial ClinForms staff set by hand
(e.g. Blue Heart) sees exactly what it saw before – no banner or visit noted in the clinic system's shell, the same
banner text in /app and the Studio, no read-only rule, no emails. Only the branded email layout is new for everyone
(owner's wish).

## 6. Abuse brakes

On top of sign-up's own limits (3 sign-ups per network per day, 3 emails per address per day, honeypot, signed time
stamp, disposable domains): a trial gets **no free reports or texts** (still a trial, clearly flagged on the platform
page) when the same owner address had a trial before (case, `+tags` and Gmail dots ignored), the network (the sign-up
limits' own rule `ipLimitSubject`: an IPv4 address exactly – ports dropped, no /24 so a shared mobile network's
neighbours are not caught – an IPv6 address by its /64, brackets and ports normalised) already started 2 trials with an
allowance in 30 days, or the address's own (non-webmail) domain 3 in 30
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

To switch off: remove the variable and redeploy – existing trial clinics keep their trial and their emails (the cron
keeps sending the remaining trial emails to clinics that already have one) and the 90-day rule still applies to them
(§2: an unpaid trial is deleted 90 days after its end, after the warning).

## 9. Code and tests

- Rules (pure): `src/lib/trial.ts` (settings, schedule, abuse forms), `src/lib/trial-copy.ts` (banner),
  `src/lib/clindesk/trial-cta.ts` (website).
- Server: `src/server/trial/{start,allowance,access,emails,sample,view,platform}.ts`, `src/server/repos/self-trial.ts`,
  `src/server/email/{layout,trial-templates}.ts`; hooks in `src/server/signup/self-signup.ts` (finishSignup),
  `src/server/admin/clinic-plan.ts` (first visit → welcome), `src/server/billing/{sync,notify}.ts` (conversion),
  `src/server/pms/actor.ts` (read-only), `src/server/auth/medreport-actor.ts` + `src/modules/medreport/auth/clinic-access.ts`
  (10-report cap), `src/app/api/cron/retention/route.ts` (sweep).
- 14/11/2026: `src/server/trial/retention.ts` (warning + deletion), `offboardClinic(…, { withoutExport })` in
  `src/server/auth/platform.ts`, `removeSampleClinic` / `sampleRemovalOffer` in `src/server/trial/sample.ts`; pure day
  rules in `src/lib/trial.ts` (`trialDeletionDay`, `trialDeletionWarningDay`, `trialDeletionDayIfWarnedAt`,
  `ukDayStart`); cron step `trialRetention` in `src/server/cron/expiry.ts afterRetentionCron` (200 only).
- Tests: `src/server/trial/trial.test.ts` (suite on SQLite + PGlite, and a database before 0011; 14/11/2026: the 90-day
  boundary, one warning, double runs, a refused warning holding the deletion, paid / converted by hand / hand-set /
  open subscription untouched, the paid re-check during the deletion, the sample deleted with its unpaid clinic and kept
  for a paid one, "Remove sample clinic" owner-only and once), `src/lib/trial.test.ts` (deletion days, UK midnight),
  `src/lib/trial-copy.test.ts` (banners), `src/server/cron/expiry.test.ts` (the step runs last, 200 only),
  `workers/data-gateway/test/trial-stack.test.ts` (D1 stand-in + real local D1), `src/lib/trial.test.ts` (schedule,
  clock change), `src/server/email/trial-emails.test.ts` (every email, both brands; layout; stop-tips),
  `src/components/clindesk/trial-cta.test.ts` (website off/on), `src/server/trial/migrations.test.ts`,
  `src/server/auth/self-signup.test.ts` (sign-up now starts the trial), e2e `scripts/e2e/trial-journey.cjs` (whole
  journey incl. Stripe TEST checkout; 14/11/2026: T8b the deletion warning, T11 "Remove sample clinic" after paying, T12 – with `PAY=skip` – the deletion of the unpaid clinic and its sample) and `scripts/e2e/self-signup.cjs` (updated landing).

## 10. Decisions (owner, 14/11/2026 – were open)

| Question | Decided 14/11/2026 (Khuram) |
|---|---|
| "Use made-up patient details only during the trial" for self-serve trials | **Dropped** for self-serve trials everywhere (banner, sign-up page, trial emails and tips, drafting wording, docs) – §1. Kept for trials ClinForms staff set by hand (a separate code path). Before the first real client: the DPA's online acceptance must be in place (switch-on checklist §8) |
| Email send time | **Unchanged: nightly** – the one daily cron at 03:17 UTC (Vercel Hobby). A second cron at 09:00 UK on Pro stays a one-line change if wanted later |
| Retention for trials that never convert | **Read-only for 90 days after the end, a warning 14 days before, then deleted** (the clinic and its sample clinic, via the offboarding's deletes) – §2 |
| Sample clinic after paying | **"Remove sample clinic" button for the owner** (confirm step, deletes only the sample, audited) – §4 |
| Abuse thresholds (2 per network / 3 per domain per 30 days) | **Unchanged** – review after the first weeks' data |

Still to check before switch-on (legal review, §8 item 1): the DPA draft (`content/dpa.json` §10 "Return and deletion")
says the data is deleted within [30] days after the agreement ends, and ClinDesk's terms say clinical records are never
deleted automatically while the agreement runs – both should say how a free trial that ends unpaid is kept read-only for
90 days, warned and then deleted.
