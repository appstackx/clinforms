import { notFound } from "next/navigation";
import { AppointmentPanel } from "@/components/pms/portal/appointment-panel";
import { PublicTop } from "@/components/pms/portal/public-shell";
import { clinicPublicPaths } from "@/modules/pms/portal/paths";
import { panelData } from "@/server/pms/portal/appointment-panel-data";
import { appointmentCard } from "@/server/pms/portal/portal-views";
import { portalViewer, publicClinicOr404, publicCtx } from "@/server/pms/portal/public-page";
import { redirect } from "next/navigation";
import { portalCancelAction } from "../../actions";

export const dynamic = "force-dynamic";

/** One of the signed-in patient's appointments: cancel (late = fee flagged) or move (outside the notice period). */
export default async function PortalAppointmentPage({ params }: { params: { clinicId: string; appointmentId: string } }) {
  const clinic = await publicClinicOr404(params.clinicId, "portal");
  const paths = clinicPublicPaths(clinic.tenantId);
  const viewer = await portalViewer(clinic);
  if (!viewer) redirect(paths.portal);
  const card = await appointmentCard(publicCtx(), clinic, viewer.patientId, params.appointmentId);
  if (!card) notFound();
  const data = panelData(clinic, card);
  const cancel = portalCancelAction.bind(null, clinic.tenantId, card.id, card.rev);
  return (
    <>
      <PublicTop back={{ href: paths.portal, label: "My appointments" }} />
      <main className="px-4 pb-16 pt-5">
        <AppointmentPanel data={data} moveHref={clinic.settings.onlineBooking && card.serviceId ? `${paths.portalBook}?move=${encodeURIComponent(card.id)}` : null} cancel={cancel} />
      </main>
    </>
  );
}
