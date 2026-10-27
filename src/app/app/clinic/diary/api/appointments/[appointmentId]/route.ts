/**
 * GET /app/clinic/diary/api/appointments/[appointmentId] – the appointment dialog's data (AppointmentDetailsView:
 * booking and cancellation notes decrypted; the patient's date of birth and mobile only for roles that may see
 * patients). 404 for an item at a site outside the member's scope. JSON, never cached.
 */
import { diaryCallerOf } from "@/server/pms/diary/caller";
import { loadAppointmentDetails } from "@/server/pms/diary/details";
import { readResponse } from "@/server/pms/diary/actions-support";
import { clinicRoute } from "@/server/pms/http";

export const dynamic = "force-dynamic";

export const GET = clinicRoute({ permission: "diary.view" }, async (_req, actor, params: { appointmentId: string }) =>
  readResponse(await loadAppointmentDetails(await diaryCallerOf(actor), params.appointmentId)),
);
