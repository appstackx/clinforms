/**
 * Tabs of a patient's record (/app/clinic/patients/[patientId]/<segment>). The records module owns the record's
 * layout and renders these tabs; every module declares its own tabs in record-tabs/<module>.ts and owns the route
 * folder of each segment it declares. Pure.
 */
import type { PmsModuleId } from "./modules";
import type { PmsPermission } from "./permissions";

export interface PmsRecordTab {
  id: string;
  module: PmsModuleId;
  label: string;
  /** URL segment under the record ("" = the record's first page, owned by records). */
  segment: string;
  /** Same bands as the navigation (core/nav.ts). */
  order: number;
  permission: PmsPermission;
}

export function visibleRecordTabs(tabs: readonly PmsRecordTab[], can: (permission: PmsPermission) => boolean): PmsRecordTab[] {
  return tabs.filter((t) => can(t.permission)).slice().sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}
