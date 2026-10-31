/**
 * GET /app/clinic/diary/api/patients/[patientId]/appointments?before=<ISO> – the patient record's Appointments tab
 * (PatientAppointmentsView): upcoming and past appointments at the member's sites, counts per status, paging back
 * with `before`. JSON, never cached.
 */
import { readResponse } from "@/server/pms/diary/actions-support";
import { diaryCallerOf } from "@/server/pms/diary/caller";
import { loadPatientAppointments } from "@/server/pms/diary/reads";
import { clinicRoute } from "@/server/pms/http";

export const dynamic = "force-dynamic";

export const GET = clinicRoute({ permission: "diary.view" }, async (req, actor, params: { patientId: string }) => {
  const before = new URL(req.url).searchParams.get("before") ?? undefined;
  return readResponse(await loadPatientAppointments(await diaryCallerOf(actor), params.patientId, { before }));
});
