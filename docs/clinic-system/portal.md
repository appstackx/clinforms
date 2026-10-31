# Clinic system – portal module (online booking, patient portal, intake forms)

**Internal.** M7, 28/10/2026. Code: `src/modules/pms/portal/**` (pure), `src/server/repos/pms/portal/**` (data),
`src/server/pms/portal/**` (flows, views, staff service), `src/app/(public-clinic)/clinics/[clinicId]/**` (public
pages), `src/app/app/clinic/{online-booking,intake}/**` and the record's `forms` tab (staff), `src/components/pms/portal/**`.

## One appointment store
An online booking IS a diary appointment (`pms_appointments.source = online`), booked by the diary's own
`bookAppointment` through the diary's adapter for the portal's port (`src/server/pms/diary/portal-adapter.ts`, port in
`src/server/pms/portal/diary-port.ts`). The diary's clash rule and triggers refuse whichever of an online and a
reception booking comes second. Free times are the diary's `findFreeSlots` (rota windows marked "online", minus
appointments and blocked time – closures included) within the clinic's minimum notice and horizon, so a time shown
online is bookable by reception at the same moment and the other way round. `pms_online_bookings` adds only the
reference, channel, how the record was found (staff only) and the SHA-256 of the "manage this booking" link – written
in the same batch as the appointment (`BookOptions.alsoWrite`).

## Patients
- Public booking: new or existing patient (matched on email + date of birth + last name; the answer never says which;
  a mismatch makes a new record staff can merge). Rate limits per client, email and clinic; honeypot; bot check ready
  but off (`human-check.ts`).
- Cancel any time before the start; inside the notice period it is a LATE cancellation (diary `late_cancelled`, fee
  flag). Move only outside the notice period. Both through the portal or the manage link.
- Portal sign-in: the email address only; a one-time link (15 minutes; 72 hours when staff send a form) to the address
  on the record, through comms (`portal_link` template). Same answer and similar timing whoever asks. Sessions 4 hours,
  30 minutes idle; cookie httpOnly, SameSite=Lax, limited to `/clinics/<clinic>`.
- Distance from the patient only after "Use my location" or a postcode – worked out in the browser from the sites' map
  positions (`pms_booking_sites`); a typed postcode is placed at the centre of its postcode district from the bundled
  ONS list (`src/modules/pms/portal/data/postcode-districts.json` – 2,863 Great Britain districts, the mean position of
  each district's live postcodes in the ONS Postcode Directory, August 2026; Northern Ireland (BT) left out because its
  data needs a separate licence for commercial use; loaded as its own small file from this site on first use – no
  lookup service, the postcode never leaves the browser). Source and method: `postcode-districts.SOURCE.md` next to
  it. Nothing about the patient is sent or stored.
- **Attribution (Open Government Licence v3.0)** – shown under the sites list on the booking page:
  "Contains OS data © Crown copyright and database right 2026. Contains Royal Mail data © Royal Mail copyright and
  database right 2026. Source: Office for National Statistics licensed under the Open Government Licence v.3.0."

## Forms
Templates (`pms_intake_templates`) and patients' copies (`pms_intake_responses`, a snapshot of the form). Answers and
the typed name encrypted; a completed copy is sealed by SHA-256 and a database trigger. Questions marked clinical
(`sensitive`) are shown only with `clinical.view` – never to reception. Consent is recorded on the record by itself only
when "verified" (portal sign-in); the manage link is "unverified" and waits for staff. Outcome questionnaires are copies
without a template (kind `outcome`): the form is built from the records module's measures (topics + a plain scale – no
licensed wording, Q-K8) and the answers are scored by records into `pms_outcome_measures`.

## Messages
Confirmation, cancellation, late-cancellation and "moved" notices are the diary hook's appointment messages (comms);
after a patient's write the portal runs the due messages so they reach the outbox at once. No outbox of its own.

## M9b follow-ups (polish)
- **Share with the patient (PORTAL-004).** Record → Attachments → under a file, "Share with the patient": a plain title
  (the portal lists it), an optional message (encrypted), and optionally an email with a one-time portal link (comms'
  `portal_link`; the email never names the document). Who: `clinical.view` + `clinical.write` (attachments are
  clinical – never reception; admins see but do not share by default). The share keeps who and when, the first time
  the patient opened it, and who withdrew it. In the portal ("Shared with you") the patient reads the message and
  downloads the file (`/clinics/<clinic>/portal/documents/<share>/file` – the record's file, verified, always a
  download) while the share stands and the file is not withdrawn from the record. `pms_portal_share_files` (0182)
  links a share to the records module's `pms_attachments`; nothing is copied.
- **Completing a form in the clinic (FORM-007, paired by a code since M10 H3).** Record → Forms → "Complete in the
  clinic" on a waiting form (`patients.edit`): a 30-minute hand-off (`pms_intake_handoffs`, 0182) and the member's own
  hand-off page `/app/clinic/intake/device/<hand-off>`, which shows a pairing code ("Show a code for the device":
  8 characters without look-alikes, valid 10 minutes, works once, "New code" replaces it – `pms_intake_device_pairings`,
  0190, only its SHA-256). On the clinic device – a separate browser that is NOT signed in – open
  `/clinics/<clinic>/device` and type the code (10 tries per address and 60 per clinic per 10 minutes). Only then does
  the device get its own secret (httpOnly, SameSite=Strict cookie limited to the device page; only its SHA-256 is
  stored). No staff session or cookie is ever placed on the device and the device page has no link into `/app`. The
  device shows ONLY that form (no staff navigation, no other patient data, not even the name). The patient's submit
  is the ordinary sealed submit ("unverified"), the hand-off marked completed in the same batch; the device then
  locks on "Please hand the device back". The staff page follows the device (refreshes every 5 s); the member
  confirms there with THEIR password (the sign-in service's verify-password; 5 tries per 15 minutes) → "Completed in
  the clinic, verified by <member>" on the signed copy, the PDF and the audit (`pms.intake_response.verify`); a signed
  consent form then records consent under that member. Audit: `pms.intake_handoff.pair_code`, `…paired` (no code).
- **Signed copy as PDF.** "Download PDF" on the signed copy (`…/forms/<copy>/pdf`): pdf-lib (as the subject-access
  copy), the same visibility as the screen (health answers only with `clinical.view`), the full fingerprint, the seal
  check; audited (`pms.intake_response.pdf`).
- **Preview as patient.** The builder's "Preview as patient" renders the patient's own filler (375 px, the clinic's
  public header) with the builder's unsaved questions; nothing can be sent.
- **Write ids.** `pms_intake_responses`, `pms_portal_shares`, `pms_portal_sessions` (0183–0185) and the hand-offs carry
  a fresh `write_id` per change; their conditional audit rows key on it (`portalAuditWhenWritten`), so two identical
  writes in the same millisecond audit once. Settings, sites, templates, online bookings and account status still key
  on the new revision and time (no migration numbers left – see the M9b report).
