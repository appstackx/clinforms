/** Patient record tabs of the records module (owned by the records builder – contract §3). */
import type { PmsRecordTab } from "../core/record-tabs";

export const RECORDS_RECORD_TABS: readonly PmsRecordTab[] = [
  { id: "records.overview", module: "records", label: "Overview", segment: "", order: 20, permission: "patients.view" },
  { id: "records.cases", module: "records", label: "Cases", segment: "cases", order: 21, permission: "patients.view" },
  { id: "records.notes", module: "records", label: "Clinical notes", segment: "notes", order: 22, permission: "clinical.view" },
  { id: "records.outcomes", module: "records", label: "Outcomes", segment: "outcomes", order: 23, permission: "clinical.view" },
  // TODO(cs-access): the design shows Attachments to reception too; the records back end treats attached files as
  // clinical (referral letters, scans) – revisit with configurable permissions.
  { id: "records.attachments", module: "records", label: "Attachments", segment: "attachments", order: 24, permission: "clinical.view" },
  { id: "records.history", module: "records", label: "History", segment: "history", order: 29, permission: "patients.view" },
];
