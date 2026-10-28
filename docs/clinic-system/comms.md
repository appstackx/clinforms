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

## Providers – nothing reaches a patient in this build

`CLINIC_SMS_PROVIDER` / `CLINIC_EMAIL_PROVIDER` = `outbox` (default: kept, shown, never sent) or `test` (a test service
in memory that "sends" and never contacts anyone; numbers ending 999 and addresses starting `bounce@` fail). Anything
else, or a key in `CLINIC_SMS_API_KEY` / `CLINIC_EMAIL_API_KEY` that does not start `test_`, is refused; `test` is
refused on a production deployment unless `CLINIC_ALLOW_TEST_PROVIDER=1`. The SMS webhook exists only with
`CLINIC_SMS_PROVIDER=test` and `CLINIC_SMS_WEBHOOK_SECRET` (32+ characters). A live email or SMS provider is
K2-COMMS-005/006 (after gate B, DPA, Khuram's choice of service).

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

Migrations `0140_pms_comms` (settings, templates, reminder rules, messages, planned messages, consent events) and
`0141_pms_letters` (letter templates, letters), each with its Postgres twin. Message and letter text is encrypted
(`*_enc`); lists never decrypt – an outbox row says what a message is for from plain fields. Nothing is deleted
(messages and letters belong to the patient's record; a letter written in error is withdrawn). Every change and its
audit row are one batch (conditional audit INSERT – `src/server/repos/pms/comms/shared.ts`).

## Tests

`src/modules/pms/comms/comms.test.ts` (rules), `src/server/pms/comms/comms-server.test.ts` (providers, links, cron,
webhook, unsubscribe), the repository suite `src/server/repos/pms/comms/testing/comms-suite.ts` on SQLite, PGlite and
D1 (`workers/data-gateway/test/pms-comms-stack.test.ts`, stand-in + local workerd), the seed
(`scripts/pms/seed-comms.ts`, `seed-demo-modules.test.ts`) and the browser check `scripts/e2e/pms-messages-screens.cjs`.
