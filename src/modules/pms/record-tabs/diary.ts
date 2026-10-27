/**
 * Patient record tabs of the diary module (owned by the diary builder – contract §3).
 *
 * Empty until the tab's page exists (src/app/app/clinic/patients/[patientId]/appointments/page.tsx – its data is
 * loadPatientAppointments in src/server/pms/diary/reads.ts). Then:
 *   { id: "diary.appointments", module: "diary", label: "Appointments", segment: "appointments", order: 10, permission: "diary.view" }
 */
import type { PmsRecordTab } from "../core/record-tabs";

export const DIARY_RECORD_TABS: readonly PmsRecordTab[] = [];
