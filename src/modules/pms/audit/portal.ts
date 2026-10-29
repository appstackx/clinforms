/**
 * Audit actions of the portal module and their plain-English labels (owned by the portal builder – contract §7).
 * Codes: "pms.<entity>.<verb>", lower case. Every code a repository writes must be listed here. Writes made by a
 * patient online carry no member (the activity page shows "Automatic"); their detail says via: "patient".
 */
export const PORTAL_AUDIT_LABELS: Readonly<Record<string, string>> = {
  "pms.booking_settings.update": "Online booking settings changed",
  "pms.booking_site.update": "Site's online booking changed",
  "pms.online_booking.create": "Appointment booked online",
  "pms.online_booking.review": "Online booking checked",
  "pms.portal_account.create": "Patient portal account created",
  "pms.portal_account.status": "Patient portal access switched on or off",
  "pms.portal_link.create": "Portal sign-in link sent",
  "pms.portal_session.create": "Patient signed in to the portal",
  "pms.portal_session.end": "Patient signed out of the portal",
  "pms.portal_share.create": "Document shared with the patient",
  "pms.portal_share.view": "Patient opened a shared document",
  "pms.portal_share.withdraw": "Shared document withdrawn",
  "pms.portal_share.download": "Patient downloaded a shared document",
  "pms.intake_form.create": "Patient form created",
  "pms.intake_form.update": "Patient form changed",
  "pms.intake_response.request": "Form sent to a patient",
  "pms.intake_response.submit": "Form completed",
  "pms.intake_response.sign": "Form completed and signed",
  "pms.intake_response.cancel": "Form request withdrawn",
  "pms.intake_response.review": "Completed form checked",
  "pms.intake_response.apply": "Form answers copied to the patient's record",
  "pms.intake_response.score": "Questionnaire scored into the patient's outcomes",
  "pms.intake_response.verify": "Form completed in the clinic verified by staff",
  "pms.intake_response.pdf": "Signed form downloaded as a PDF",
  "pms.intake_handoff.start": "Form handed to the patient on a clinic device",
  "pms.intake_handoff.end": "Clinic device hand-off ended",
  "pms.intake_handoff.pair_code": "Code for a clinic device shown to staff",
  "pms.intake_handoff.paired": "Clinic device paired with a hand-off",
  "pms.portal_account.signed_out": "Patient portal signed out (email address changed)",
};

/** Names of the record types its audit rows point at (target_type → label). */
export const PORTAL_AUDIT_TARGETS: Readonly<Record<string, string>> = {
  pms_booking_settings: "Online booking settings",
  pms_booking_site: "Site's online booking",
  pms_online_booking: "Online booking",
  pms_portal_account: "Patient portal account",
  pms_portal_share: "Shared document",
  pms_intake_form: "Patient form",
  pms_intake_response: "Patient's form",
  pms_intake_handoff: "Clinic device hand-off",
};
