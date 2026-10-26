/**
 * GET /app/clinic/diary/api/appointments/[appointmentId] – the appointment dialog's data (notes decrypted; the
 * patient's date of birth and mobile only for roles that may see patients). JSON, never cached.
 */
import { PMS_ID_PATTERN } from "@/modules/pms/core/ids";
import { loadAppointmentDetails } from "@/server/pms/diary/details";
import { clinicRoute } from "@/server/pms/http";

export const dynamic = "force-dynamic";

const notFound = () => Response.json({ error: { code: "NOT_FOUND", message: "This appointment no longer exists." } }, { status: 404 });

export const GET = clinicRoute({ permission: "diary.view" }, async (_req, actor, params: { appointmentId: string }) => {
  if (!PMS_ID_PATTERN.test(params.appointmentId)) return notFound();
  const appointment = await loadAppointmentDetails(actor.repo(), actor.tenantId, params.appointmentId, { withPatient: actor.can("patients.view") });
  return appointment ? Response.json({ appointment }) : notFound();
});
