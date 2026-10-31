import { redirect } from "next/navigation";
import { clinicPublicPaths } from "@/modules/pms/portal/paths";
import { publicClinicOr404 } from "@/server/pms/portal/public-page";

export const dynamic = "force-dynamic";

/** /clinics/<id>: the booking page when it is open, else the patient portal. */
export default async function ClinicHome({ params }: { params: { clinicId: string } }) {
  const clinic = await publicClinicOr404(params.clinicId);
  const paths = clinicPublicPaths(clinic.tenantId);
  redirect(clinic.settings.onlineBooking ? paths.book : paths.portal);
}
