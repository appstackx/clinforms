import { notFound } from "next/navigation";
import { FormFiller, SignedCopy } from "@/components/pms/portal/form-filler";
import { PublicTop } from "@/components/pms/portal/public-shell";
import { clinicPublicPaths } from "@/modules/pms/portal/paths";
import { signatureLine, signedRows } from "@/server/pms/portal/form-page";
import { manageContext, patientForm } from "@/server/pms/portal/portal-views";
import { publicClinicOr404, publicCtx } from "@/server/pms/portal/public-page";
import { manageSubmitFormAction } from "../../actions";

export const dynamic = "force-dynamic";

/** A form sent with the booking, completed through the booking's link (recorded as "unverified"). */
export default async function ManageFormPage({ params }: { params: { clinicId: string; token: string; responseId: string } }) {
  const clinic = await publicClinicOr404(params.clinicId);
  const ctx = publicCtx();
  const m = await manageContext(ctx, clinic, params.token);
  if (!m) notFound();
  const r = await patientForm(ctx, clinic, { patientId: m.booking.patientId, appointmentId: m.booking.appointmentId }, params.responseId);
  if (!r || r.kind === "outcome") notFound();
  const back = clinicPublicPaths(clinic.tenantId).manage(m.token);
  return (
    <>
      <PublicTop back={{ href: back, label: "Your booking" }} />
      <main className="px-4 pb-16 pt-5">
        {r.status === "submitted" ? (
          <SignedCopy title={r.name} rows={signedRows(r)} signature={signatureLine(r)} />
        ) : (
          <FormFiller title={r.name} form={r.form} requiresSignature={r.requiresSignature} signatureStatement={r.signatureStatement} submit={manageSubmitFormAction.bind(null, clinic.tenantId, m.token, r.id, r.rev)} doneHref={back} doneLabel="Back to your booking" />
        )}
      </main>
    </>
  );
}
