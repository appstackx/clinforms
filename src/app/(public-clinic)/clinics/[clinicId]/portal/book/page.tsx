import { notFound, redirect } from "next/navigation";
import { BookingFlow } from "@/components/pms/portal/booking-flow";
import { clinicPublicPaths } from "@/modules/pms/portal/paths";
import { bookingFlowData } from "@/server/pms/portal/booking-view";
import { appointmentCard } from "@/server/pms/portal/portal-views";
import { flowDeps, portalViewer, publicClinicOr404, publicCtx } from "@/server/pms/portal/public-page";
import { portalBookAction, portalMoveAction, portalSlotsAction } from "../actions";

export const dynamic = "force-dynamic";

/** /clinics/<id>/portal/book[?move=<appointment>]: booking (or moving) as the signed-in patient – no details asked. */
export default async function PortalBookPage({ params, searchParams }: { params: { clinicId: string }; searchParams: { move?: string } }) {
  const clinic = await publicClinicOr404(params.clinicId, "portal");
  if (!clinic.settings.onlineBooking) notFound();
  const paths = clinicPublicPaths(clinic.tenantId);
  const viewer = await portalViewer(clinic);
  if (!viewer) redirect(paths.portal);
  const data = await bookingFlowData(clinic, flowDeps());
  if (typeof searchParams.move === "string") {
    const card = await appointmentCard(publicCtx(), clinic, viewer.patientId, searchParams.move);
    if (!card || !card.serviceId || !card.rights.move.ok) notFound();
    return (
      <BookingFlow
        mode="move"
        clinicId={clinic.tenantId}
        data={data}
        portalPath={paths.portal}
        homeHref={paths.portalAppointment(card.id)}
        fixed={{ siteId: card.siteId, serviceId: card.serviceId, label: `${card.service}, ${card.when}` }}
        loadSlots={portalSlotsAction}
        book={portalMoveAction.bind(null, card.id, card.rev)}
      />
    );
  }
  return <BookingFlow mode="portal" clinicId={clinic.tenantId} data={data} portalPath={paths.portal} homeHref={paths.portal} loadSlots={portalSlotsAction} book={portalBookAction} />;
}
