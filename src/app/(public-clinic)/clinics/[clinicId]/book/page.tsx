import { BookingFlow } from "@/components/pms/portal/booking-flow";
import { clinicPublicPaths } from "@/modules/pms/portal/paths";
import { bookingFlowData } from "@/server/pms/portal/booking-view";
import { flowDeps, publicClinicOr404 } from "@/server/pms/portal/public-page";
import { bookAction, loadSlotsAction } from "./actions";

export const dynamic = "force-dynamic";

/** /clinics/<id>/book: the public booking page (design round 2g, 6 steps) at 375 px and up. */
export default async function BookPage({ params }: { params: { clinicId: string } }) {
  const clinic = await publicClinicOr404(params.clinicId, "booking");
  const data = await bookingFlowData(clinic, flowDeps());
  const paths = clinicPublicPaths(clinic.tenantId);
  return (
    <BookingFlow
      mode={clinic.settings.newPatients ? "public" : "closed_to_new"}
      clinicId={clinic.tenantId}
      data={data}
      portalPath={paths.portal}
      loadSlots={loadSlotsAction}
      book={bookAction}
    />
  );
}
