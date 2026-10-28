/**
 * Patient record tabs of the diary module (owned by the diary builder – contract §3). The tab's page:
 * src/app/app/clinic/patients/[patientId]/appointments/page.tsx (data: loadPatientAppointments).
 */
import type { PmsRecordTab } from "../core/record-tabs";

export const DIARY_RECORD_TABS: readonly PmsRecordTab[] = [
  { id: "diary.appointments", module: "diary", label: "Appointments", segment: "appointments", order: 10, permission: "diary.view" },
];
