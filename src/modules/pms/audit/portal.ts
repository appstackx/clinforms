/**
 * Audit actions of the portal module and their plain-English labels (owned by the portal builder – contract §7).
 * Codes: "pms.<entity>.<verb>", lower case. Every code a repository writes must be listed here. Writes made by a
 * patient online carry no member (the activity page shows "Automatic"); their detail says via: "patient".
 */
export const PORTAL_AUDIT_LABELS: Readonly<Record<string, string>> = {
  "pms.booking_settings.update": "Online booking settings changed",
  "pms.booking_hours.create": "Online booking hours added",
  "pms.booking_hours.remove": "Online booking hours removed",
  "pms.online_booking.create": "Appointment booked online",
  "pms.online_booking.rebook": "Online booking moved by the patient",
  "pms.online_booking.cancel": "Online booking cancelled",
  "pms.online_booking.review": "Online booking checked",
  "pms.online_booking.link": "Online booking linked to the diary",
  "pms.portal_account.create": "Patient portal account created",
  "pms.portal_account.status": "Patient portal access switched on or off",
  "pms.portal_link.create": "Portal sign-in link sent",
  "pms.portal_session.create": "Patient signed in to the portal",
  "pms.portal_session.end": "Patient signed out of the portal",
  "pms.portal_message.queue": "Patient email added to the outbox",
  "pms.portal_share.create": "Document shared with the patient",
  "pms.portal_share.view": "Patient opened a shared document",
  "pms.portal_share.withdraw": "Shared document withdrawn",
  "pms.intake_form.create": "Patient form created",
  "pms.intake_form.update": "Patient form changed",
  "pms.intake_response.request": "Form sent to a patient",
  "pms.intake_response.submit": "Form completed",
  "pms.intake_response.sign": "Form completed and signed",
  "pms.intake_response.cancel": "Form request withdrawn",
  "pms.intake_response.review": "Completed form checked",
  "pms.intake_response.apply": "Form answers copied to the patient's record",
};

/** Names of the record types its audit rows point at (target_type → label). */
export const PORTAL_AUDIT_TARGETS: Readonly<Record<string, string>> = {
  pms_booking_settings: "Online booking settings",
  pms_booking_hours: "Online booking hours",
  pms_online_booking: "Online booking",
  pms_portal_account: "Patient portal account",
  pms_portal_message: "Patient email",
  pms_portal_share: "Shared document",
  pms_intake_form: "Patient form",
  pms_intake_response: "Patient's form",
};
