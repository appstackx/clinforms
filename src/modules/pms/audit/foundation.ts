/**
 * Audit actions of the foundation (shared patient record, clinic directory, packages) and their plain-English
 * labels for the clinic's activity page. Audit rows hold ids, actions and counts only – never patient details.
 */
export const FOUNDATION_AUDIT_LABELS: Readonly<Record<string, string>> = {
  "pms.patient.create": "Patient registered",
  "pms.patient.update": "Patient details updated",
  "pms.patient.status": "Patient record archived or restored",
  "pms.patient.legal_hold": "Patient record hold changed",
  "pms.patient.bulk_create": "Patients added in bulk",
  "pms.case.create": "Case opened",
  "pms.case.update": "Case updated",
  "pms.case.bulk_create": "Cases added in bulk",
  "pms.authorisation.create": "Treatment authorisation added",
  "pms.authorisation.update": "Treatment authorisation updated",
  "pms.authorisation.usage": "Treatment authorisation used",
  "pms.authorisation.bulk_create": "Treatment authorisations added in bulk",
  "pms.referrer.create": "Referrer or payer added",
  "pms.referrer.update": "Referrer or payer updated",
  "pms.site.create": "Site added",
  "pms.site.update": "Site updated",
  "pms.room.create": "Room added",
  "pms.room.update": "Room updated",
  "pms.practitioner.create": "Practitioner added",
  "pms.practitioner.update": "Practitioner updated",
  "pms.service.create": "Appointment type added",
  "pms.service.update": "Appointment type updated",
  "pms.price_list.create": "Price list added",
  "pms.price_list.update": "Price list updated",
  "pms.price_list_item.set": "Price set",
  "pms.price_list_item.remove": "Price removed",
  "pms.settings.update": "Record-keeping settings updated",
  "pms.demo.seed": "Demonstration data loaded",
  // Packages (entitlements): written under the clinic and, for platform staff, under the platform's own trail.
  "clinic.package_change": "Package switched on or off",
  "platform.entitlement_set": "Clinic package changed",
};

/** Names of the record types the foundation's audit rows point at (target_type → label). */
export const FOUNDATION_AUDIT_TARGETS: Readonly<Record<string, string>> = {
  pms_patient: "Patient",
  pms_case: "Case",
  pms_authorisation: "Treatment authorisation",
  pms_referrer: "Referrer or payer",
  pms_site: "Site",
  pms_room: "Room",
  pms_practitioner: "Practitioner",
  pms_service: "Appointment type",
  pms_price_list: "Price list",
  pms_settings: "Record-keeping settings",
};
