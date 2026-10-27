/** Navigation entries of the records module (owned by the records builder – contract §3). */
import type { PmsNavEntry } from "../core/nav";
import { CLINIC_BASE_PATH } from "../core/modules";

export const RECORDS_NAV: readonly PmsNavEntry[] = [
  { id: "records.patients", module: "records", label: "Patients", href: `${CLINIC_BASE_PATH}/patients`, order: 20, permission: "patients.view", group: "main" },
  // "Note templates" (/patients/note-templates, settings.manage, group "manage", order 25) is added with its screen –
  // the editor's back end is in place (note-templates/actions.ts), the page waits for the design.
];
