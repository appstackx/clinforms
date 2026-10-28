/** Patient record tabs of the portal module (owned by the portal builder – contract §3). */
import type { PmsRecordTab } from "../core/record-tabs";

export const PORTAL_RECORD_TABS: readonly PmsRecordTab[] = [
  /** Forms (intake, consent, questionnaires), portal access, online bookings and documents shared with the patient. */
  { id: "portal.forms", module: "portal", label: "Forms", segment: "forms", order: 50, permission: "patients.view" },
];
