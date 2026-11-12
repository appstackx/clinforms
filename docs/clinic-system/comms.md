# Clinic system – messages (comms module)

**Internal.** M6, 28/10/2026. What the messages part of the clinic system does, where the code is, and what is not
live yet. Requirements: `requirements.md` §3.10 (COMMS) and §3.7 (LTR); rules: `contract.md` §1 (hard rule 11:
providers in outbox / test mode only), §11.

## What it does

- **Appointment messages, planned from the diary.** Every diary write that books, moves, changes or ends an
  appointment calls `src/server/pms/diary/message-sync.ts`, which hands comms a snapshot of the appointment;
  `syncAppointmentMessages` (`src/server/repos/pms/comms/schedule.ts`) plans, re-plans or cancels its messages in
  `pms_message_schedule` (idempotent, audited):
  - booking confirmation (text and/or email – clinic setting) **only when the booking asked for one** ("Send
    confirmation text and email" → `pms_appointments.confirmation_requested`);
  - reminders per the clinic's rules (Message settings: "24 hours before by text", "1 day before at 10:00 by email");
  - moved notice when the time changes – or, when the confirmation has not gone yet, the confirmation for the new
    time instead;
  - cancelled (with notice) / late-cancellation notices; the did-not-attend follow-up an hour after the start;
  - a series cancelled from a date: reminders cancelled, no notice per appointment.
- **Quiet hours** (default 20:00–08:00, UK time, clock changes handled): automatic texts that fall inside wait until
  they end ("Held – quiet hours" on the outbox); emails are not held. A reminder that would land too close to the
  appointment goes just before the quiet hours instead.
- **Waiting-list offers in the quiet hours** (Khuram, 28/10/2026): an offer TEXT written inside them is kept in
  `pms_messages` as `queued` with `hold_until` = the end of the quiet hours (migration 0142) and the provider is not
  called; every message run (cron route, "Send due messages now") releases held texts whose time has come
  (`releaseHeldMessages` – a conditional claim, so two runs never both send one; audited `pms.message.release`). If
  the quiet hours end after the offered slot starts, the offer goes by email instead, else it is not sent
  (`too_late`). Offer emails are never held.
- **The message run** sends what is due: `GET /api/clinic-messages/cron` with `Authorization: Bearer $CRON_SECRET`
  (refused without the secret), or "Send due messages now" on the outbox (messages.templates). It re-checks consent
  and that the appointment is still booked at the moment of sending, writes each message with its audit row
  **before** calling the provider, and records the answer after.
- **Outbox screen** (`/app/clinic/messages`): planned, held, sent, delivered, failed (Retry), not sent (why), and
  messages kept in the outbox; replies inbox with the thread and an answer box; templates (editing:
  messages.templates); letters (titles for everyone with messages.send, content only with messages.letters);
  "Send a message" to one patient (text or email, about their care or marketing).
- **Replies.** A patient's text reply arrives through the SMS provider's webhook (`POST /api/clinic-messages/sms`,
  signed). YES confirms, C / NO asks to cancel (a person decides – nothing in the diary changes by itself), STOP
  switches texts off and sends one last text, anything else goes to "To answer". The Messages nav entry shows how many
  replies wait.
- **Consent (PECR).** Service messages go unless the patient opted out of that channel; marketing only with a recorded
  opt-in. STOP = no texts. The stop-emails link (`/api/clinic-messages/unsubscribe?t=…`, signed, 400 days, GET shows a
  button, POST / one-click unsubscribes) stops reminder and follow-up emails; booking confirmations, change notices
  and the patient's own account emails still go. Every change is recorded in `pms_consent_events` with its source.
- **Letters** (`/app/clinic/letters/new?patient=…`, `/app/clinic/letters/[id]`, `/print`): from the clinic's or the
  standard templates (GP assessment / discharge, payer progress, medico-legal summary, attendance, appointment
  letter, missed appointment, general), merged with the record ("[not recorded: …]" and "[[…]]" gaps block signing),
  signed with the signer's line (name, profession, register and number from their practitioner record), printed on
  A4 (Save as PDF), emailed to the recipient through the outbox, or marked as posted; withdrawn, never deleted.
  messages.letters – never reception (a lock).
- **Billing's messages**: invoice / statement / receipt by email, payment link by text or email
  (`src/server/pms/comms/billing-mail.ts`, buttons in billing's screens).
- **Patient-facing wording** (`/app/clinic/messages/patient-view`): the clinic's current templates written out by the
  same code that sends, with each text's length.

## Text credits (prepaid, 31/10/2026)

Every text needs credits first (1 credit = 1 segment): reserved before the provider call, returned when the text is
not sent; with too little credit an automatic text goes by email instead (or is recorded "no text credit"), a text
written by hand is refused. Owner/admin warnings at 20 % and zero; optional automatic top-up with a saved card.
Migration `0143_pms_sms_credits`; screens Messages → Text credits; platform page Text credits. Runbook, env vars,
webhook and go-live: [`SMS-CREDITS.md`](SMS-CREDITS.md).

## Bulk email to patient groups (tracker xt02, 12/11/2026) – OFF until switched on twice

**Two switches, both off by default.** The platform's `CLINFORMS_BULK_EMAIL=on` (anything else = the feature does not
exist: `/app/clinic/messages/campaigns/**` answers 404, no "Bulk email" link, no consent panel, the message run ignores
campaigns) AND the clinic's own setting (Messages → Bulk email → Settings: "Use bulk email in this clinic", the daily
cap; owners and admins only; no row = off). Rules: `src/modules/pms/comms/campaigns.ts` (pure), data
`src/server/repos/pms/comms/campaigns.ts`, sending `src/server/pms/comms/campaigns/send.ts`, screens' service
`src/server/pms/comms/campaigns/service.ts`, pages `src/app/app/clinic/messages/campaigns/**`, components
`src/components/pms/comms/campaigns/*`.

- **Who may:** `messages.templates` (owners and admins by default) and **never reception** (ClinForms role `staff` –
  refused in the pages and the service even if a clinic grants it the permission). No new permission was added.
  A member limited to some sites can only email one of their sites.
- **Marketing vs service.** *Marketing* (news, offers, events) goes ONLY to patients with the recorded marketing-email
  opt-in (`pms_patients.marketing_email` + when + how) and never to patients known to be under 18; the soft opt-in is
  NOT used. A *service announcement* (closure, new address, opening hours) needs a reason in words (stored), goes to
  patients who have not stopped reminder emails and must not promote anything.
- **Never** to deceased, archived, merged or anonymised records or records without an email address; **one email per
  address** (two patients sharing one address get one copy – recipients are unique per campaign by lower-case address).
- **The email:** subject + plain-text body (blank line = paragraph, "- " = list, https links clickable; HTML refused),
  merge fields `{first_name}` (preferred name; "there" when empty), `{clinic_name}`, `{clinic_address}`, `{clinic_phone}`;
  footer with the clinic's name, **postal address** (Settings → Clinic, else the first site with an address – no address
  = cannot send), phone, why the patient gets it and the unsubscribe link; headers `List-Unsubscribe` +
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058). Sender name = the clinic, reply-to = its email.
- **Screens:** list with counts; editor with filters (site = any non-cancelled appointment there, last seen within N
  months, has / has no upcoming booked appointment, age from–to), a live count (the send's own query), a preview
  rendered by the sending code, a test copy to the member's OWN address (max 10 an hour, "[Test]", not logged as a
  message), Send now (confirm) or Schedule (UK time), Cancel while draft or scheduled. After sending: recipients, sent,
  delivered (when the provider reports it), kept in the outbox, failed, not sent (with reasons), waiting, unsubscribed.
- **Sending** (part of the message run `GET /api/clinic-messages/cron` when the switch is on, and Send now / "Send more
  now"): the campaign is claimed (scheduled → sending), its recipients written once (the audience at that moment), then
  rounds of ≤ 40: claim → re-check every rule for each patient at that moment (consent withdrawn since = skipped) →
  write each `pms_messages` row (kind `marketing` / `general`) with its recipient row and one audit row in one batch →
  provider → record answers. **Rate limits:** ≤ 200 campaign emails per clinic per run and the clinic's **daily cap**
  (default 500, max 5,000 per UK day); the rest waits for the next run/day. Stale claims (15 min) are taken back. The
  emails appear in the outbox like any other; the email providers are unchanged (outbox / test / mailpit – there is
  still NO live patient-email provider, so nothing reaches a patient in this build).
- **Unsubscribe:** the existing stop-emails link (`/api/clinic-messages/unsubscribe`), now signed with the message id
  (and "announcement" for service links – wording only): GET shows a button and changes nothing, POST / one-click
  withdraws (marketing link → marketing emails off; announcement link → reminder and announcement emails off, booking
  confirmations still go), recorded in `pms_consent_events` with the message id (per-campaign count), idempotent
  (a second click records nothing), no sign-in, never reveals the patient. Older links keep working.
- **The patient record** (Messages tab, while the switch is on): marketing-email consent yes/no, recorded when and
  how, last withdrawn when and how; staff with `patients.edit` record (how is required) or withdraw it – audited
  (`pms.consent.change` + the event). The patient portal has no preferences page yet (nothing added there).
- **Data:** migration `0146_pms_email_campaigns` (+ Postgres twin; number reserved in `src/modules/pms/core/modules.ts`):
  `pms_bulk_email_settings`, `pms_email_campaigns` (subject/body encrypted), `pms_email_campaign_recipients`. Audit codes
  `pms.bulk_email_settings.update`, `pms.email_campaign.{create,update,schedule,cancel,start,send,finish,test_send}`.
- **Before switching it on for a real clinic:** a live patient-email provider (K2-COMMS-005) that passes our
  `List-Unsubscribe` headers through and reports bounces / complaints (then record them – today only send failures are
  recorded), the sending domain's SPF/DKIM/DMARC, legal review of the footer wording and the service-announcement rule,
  the clinic's postal address on its profile, its consent records checked (imported consent = "import"), and a
  scheduled message run (see "Scheduling the message run").
- **Tests:** `src/modules/pms/comms/campaigns.test.ts`, the suite `src/server/repos/pms/comms/testing/campaigns-suite.ts`
  on SQLite + PGlite (`campaigns-repos.test.ts`) and D1 (`workers/data-gateway/test/pms-comms-campaigns-stack.test.ts`),
  browser check `scripts/e2e/pms-comms-bulk-email.cjs` (own server + fake Mailpit; switch off → 404, then on).

## Providers – nothing reaches a patient in this build

`CLINIC_SMS_PROVIDER` / `CLINIC_EMAIL_PROVIDER` = `outbox` (default: kept, shown, never sent) or `test` (a test service
in memory that "sends" and never contacts anyone; numbers ending 999 and addresses starting `bounce@` fail). Anything
else, or a key in `CLINIC_SMS_API_KEY` / `CLINIC_EMAIL_API_KEY` that does not start `test_`, is refused; `test` is
refused on a production deployment unless `CLINIC_ALLOW_TEST_PROVIDER=1`. The SMS webhook exists only with
`CLINIC_SMS_PROVIDER=test` and `CLINIC_SMS_WEBHOOK_SECRET` (32+ characters). A live email or SMS provider is
K2-COMMS-005/006 (after gate B, DPA, Khuram's choice of service).

### Local testing with Mailpit

`mailpit` is a third value for both variables, for **local runs only** (`src/server/pms/comms/providers/mailpit.ts`).
The real message – including the portal sign-in link that staff screens never show – is handed to a local
[Mailpit](https://mailpit.axllent.org) inbox through its HTTP API (`POST $MAILPIT_URL/api/v1/send`; `MAILPIT_URL`
defaults to `http://localhost:8026`) and recorded as sent, like `test`. With `CLINIC_SMS_PROVIDER=mailpit` a text
appears there as a plain email to `<phone digits>@sms.local` (e.g. `447700900123@sms.local`) with subject "Text message" (nothing is texted; the SMS webhook
stays `test`-only, so simulated replies and delivery receipts need `test`). It is refused (the Messages screen shows
"not set up correctly") on any Vercel environment, and with `NODE_ENV=production` unless `MAILPIT_URL` points at
localhost / 127.0.0.1 (so a local `next start` works). The ClinForms account emails (invitations, sign-in and reset
links) can use the same inbox with `CLINFORMS_EMAIL_PROVIDER=mailpit` (`src/server/email/providers.ts`).

```sh
# Mailpit must expose its web/API port; SMTP is not needed.
export CLINFORMS_EMAIL_PROVIDER=mailpit CLINIC_EMAIL_PROVIDER=mailpit CLINIC_SMS_PROVIDER=mailpit
export MAILPIT_URL=http://localhost:8026
# then open http://localhost:8026 to read what was sent
```

## Route placement (M6 decision)

The three sessionless endpoints live together under `src/app/api/clinic-messages/{cron,sms,unsubscribe}/route.ts`,
owned by comms (contract §3), each a thin wrapper over `src/server/pms/comms/{cron,webhook,unsubscribe}.ts` (where the
logic and the tests are). Not under `/app/clinic` (that needs a signed-in member), not in portal's public route group
(`src/app/(public-clinic)/**`, portal-owned pages), not in ClinForms' `/api/cron` (production's own crons).

## Scheduling the message run (decision for Khuram)

There is **no `vercel.json` entry yet**: production is on Vercel Hobby, which runs a cron once a day (a `*/15`
schedule fails the deploy). Options: Vercel Pro and `{"path": "/api/clinic-messages/cron", "schedule": "*/15 * * * *"}`,
or a Cloudflare Worker cron trigger calling the route with `CRON_SECRET`. Until then the outbox's "Send due messages
now" does the run by hand.

## Data

Migrations `0140_pms_comms` (settings, templates, reminder rules, messages, planned messages, consent events),
`0141_pms_letters` (letter templates, letters), `0142_pms_messages_hold`, `0143_pms_sms_credits` (text credit
accounts and the append-only ledger, + `0144`/`0145`) and `0146_pms_email_campaigns` (bulk email), each with its
Postgres twin. Message and letter text is encrypted
(`*_enc`); lists never decrypt – an outbox row says what a message is for from plain fields. Nothing is deleted
(messages and letters belong to the patient's record; a letter written in error is withdrawn). Every change and its
audit row are one batch (conditional audit INSERT – `src/server/repos/pms/comms/shared.ts`).

## Tests

`src/modules/pms/comms/comms.test.ts` (rules), `src/server/pms/comms/comms-server.test.ts` (providers, links, cron,
webhook, unsubscribe), the repository suite `src/server/repos/pms/comms/testing/comms-suite.ts` on SQLite, PGlite and
D1 (`workers/data-gateway/test/pms-comms-stack.test.ts`, stand-in + local workerd), the seed
(`scripts/pms/seed-comms.ts`, `seed-demo-modules.test.ts`) and the browser check `scripts/e2e/pms-messages-screens.cjs`.
