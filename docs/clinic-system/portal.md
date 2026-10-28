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
  positions (`pms_booking_sites`); a typed postcode is placed at a site of the same postcode district (no lookup
  service). Nothing about the patient is sent or stored.

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
