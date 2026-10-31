import { notFound } from "next/navigation";
import { BookingFlow } from "@/components/pms/portal/booking-flow";
import { clinicPublicPaths } from "@/modules/pms/portal/paths";
import { bookingFlowData } from "@/server/pms/portal/booking-view";
import { manageContext } from "@/server/pms/portal/portal-views";
import { flowDeps, manageTokenFromCookie, publicClinicOr404, publicCtx } from "@/server/pms/portal/public-page";
import { manageMoveAction, manageSlotsAction } from "../actions";

export const dynamic = "force-dynamic";

/** Moving the booking of a "manage this booking" link to another free time (outside the notice period). */
export default async function ManageMovePage({ params }: { params: { clinicId: string } }) {
  const clinic = await publicClinicOr404(params.clinicId, "booking");
  const token = manageTokenFromCookie();
  const m = token ? await manageContext(publicCtx(), clinic, token) : null;
  if (!m || !m.appointment.serviceId || !m.appointment.rights.move.ok) notFound();
  const data = await bookingFlowData(clinic, flowDeps());
  const paths = clinicPublicPaths(clinic.tenantId);
  return (
    <BookingFlow
      mode="move"
      clinicId={clinic.tenantId}
      data={data}
      portalPath={paths.portal}
      homeHref={paths.manageHome}
      fixed={{ siteId: m.appointment.siteId, serviceId: m.appointment.serviceId, label: `${m.appointment.service}, ${m.appointment.when}` }}
      loadSlots={manageSlotsAction}
      book={manageMoveAction.bind(null, m.appointment.rev)}
    />
  );
}
