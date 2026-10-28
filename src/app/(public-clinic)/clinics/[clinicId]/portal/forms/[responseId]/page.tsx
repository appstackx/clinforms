import { notFound, redirect } from "next/navigation";
import { FormFiller, SignedCopy } from "@/components/pms/portal/form-filler";
import { OutcomeFiller } from "@/components/pms/portal/outcome-filler";
import { PublicTop } from "@/components/pms/portal/public-shell";
import { clinicPublicPaths } from "@/modules/pms/portal/paths";
import { signatureLine, signedRows } from "@/server/pms/portal/form-page";
import { patientForm } from "@/server/pms/portal/portal-views";
import { portalViewer, publicClinicOr404, publicCtx } from "@/server/pms/portal/public-page";
import { portalSubmitFormAction } from "../../actions";

export const dynamic = "force-dynamic";

/** A form or outcome questionnaire of the signed-in patient: fill it in (verified), or read the sealed copy. */
export default async function PortalFormPage({ params }: { params: { clinicId: string; responseId: string } }) {
  const clinic = await publicClinicOr404(params.clinicId, "portal");
  const paths = clinicPublicPaths(clinic.tenantId);
  const viewer = await portalViewer(clinic);
  if (!viewer) redirect(paths.portal);
  const r = await patientForm(publicCtx(), clinic, { patientId: viewer.patientId }, params.responseId);
  if (!r) notFound();
  const submit = portalSubmitFormAction.bind(null, clinic.tenantId, r.id, r.rev);
  return (
    <>
      <PublicTop back={{ href: paths.portal, label: "My appointments" }} />
      <main className="px-4 pb-16 pt-5">
        {r.status === "submitted" ? (
          <SignedCopy title={r.name} rows={r.kind === "outcome" ? [] : signedRows(r)} signature={signatureLine(r)} />
        ) : r.kind === "outcome" ? (
          <OutcomeFiller title={r.name} form={r.form} submit={submit} doneHref={paths.portal} firstName={viewer.firstName} />
        ) : (
          <FormFiller title={r.name} form={r.form} requiresSignature={r.requiresSignature} signatureStatement={r.signatureStatement} submit={submit} doneHref={paths.portal} doneLabel="Back to my appointments" />
        )}
      </main>
    </>
  );
}
