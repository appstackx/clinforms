/** Navigation entries of the records module (owned by the records builder – contract §3). */
import type { PmsNavEntry } from "../core/nav";
import { CLINIC_BASE_PATH } from "../core/modules";

export const RECORDS_NAV: readonly PmsNavEntry[] = [
  { id: "records.patients", module: "records", label: "Patients", href: `${CLINIC_BASE_PATH}/patients`, order: 20, permission: "patients.view", group: "main" },
  { id: "records.note_templates", module: "records", label: "Note templates", href: `${CLINIC_BASE_PATH}/patients/note-templates`, order: 25, permission: "settings.manage", group: "manage" },
];
