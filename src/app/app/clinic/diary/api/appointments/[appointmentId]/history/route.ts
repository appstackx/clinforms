/**
 * GET /app/clinic/diary/api/appointments/[appointmentId]/history – the drawer's "History of changes" (who changed
 * the appointment and when, newest first; redacted for reception like the record's History). JSON, never cached.
 */
import { diaryCallerOf } from "@/server/pms/diary/caller";
import { loadAppointmentHistory } from "@/server/pms/diary/history";
import { readResponse } from "@/server/pms/diary/actions-support";
import { clinicRoute } from "@/server/pms/http";

export const dynamic = "force-dynamic";

export const GET = clinicRoute({ permission: "diary.view" }, async (_req, actor, params: { appointmentId: string }) =>
  readResponse(await loadAppointmentHistory(await diaryCallerOf(actor), { tenantId: actor.tenantId, organizationId: actor.organizationId, role: actor.role, userId: actor.userId }, params.appointmentId)),
);
