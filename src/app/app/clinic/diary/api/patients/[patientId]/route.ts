/**
 * GET /app/clinic/diary/api/patients/[patientId] – what the booking form offers for a patient: their open cases
 * and the active treatment authorisations with the sessions left. JSON, never cached.
 */
import { readResponse } from "@/server/pms/diary/actions-support";
import { diaryCallerOf } from "@/server/pms/diary/caller";
import { loadBookingOptions } from "@/server/pms/diary/reads";
import { clinicRoute } from "@/server/pms/http";

export const dynamic = "force-dynamic";

export const GET = clinicRoute({ permission: "diary.book" }, async (_req, actor, params: { patientId: string }) =>
  readResponse(await loadBookingOptions(await diaryCallerOf(actor), params.patientId)),
);
