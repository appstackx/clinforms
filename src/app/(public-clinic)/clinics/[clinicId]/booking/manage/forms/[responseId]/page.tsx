import { notFound } from "next/navigation";
import { FormFiller } from "@/components/pms/portal/form-filler";
import { PublicTop } from "@/components/pms/portal/public-shell";
import { clinicPublicPaths } from "@/modules/pms/portal/paths";
import { manageFormView } from "@/server/pms/portal/portal-views";
import { manageTokenFromCookie, publicClinicOr404, publicCtx } from "@/server/pms/portal/public-page";
import { manageSubmitFormAction } from "../../actions";

export const dynamic = "force-dynamic";

/**
 * A form sent with the booking, completed through the booking's link (recorded as "unverified"). Once sent, the link
 * shows "Sent" only – never the answers (M10 M5: a booking matched to an existing record must not show that
 * patient's answers to whoever holds the link; the patient reads their copies in the portal).
 */
export default async function ManageFormPage({ params }: { params: { clinicId: string; responseId: string } }) {
  const clinic = await publicClinicOr404(params.clinicId);
  const token = manageTokenFromCookie();
  const v = token ? await manageFormView(publicCtx(), clinic, token, params.responseId) : null;
  if (!v) notFound();
  const back = clinicPublicPaths(clinic.tenantId).manageHome;
  return (
    <>
      <PublicTop back={{ href: back, label: "Your booking" }} />
      <main className="px-4 pb-16 pt-5">
        {v.state === "sent" ? (
          <section aria-labelledby="mf-h" className="space-y-2 rounded-[12px] border border-border bg-white p-5">
            <h1 id="mf-h" className="text-[20px] font-bold text-foreground">
              {v.name}
            </h1>
            <p className="text-[16px] text-[#166534]">Sent. Thank you.</p>
            <p className="text-[14px] text-[#334155]">{clinic.settings.portal ? "You can read your copy in the patient portal." : "The clinic has your answers."}</p>
          </section>
        ) : (
          <FormFiller title={v.response.name} form={v.response.form} requiresSignature={v.response.requiresSignature} signatureStatement={v.response.signatureStatement} submit={manageSubmitFormAction.bind(null, clinic.tenantId, v.response.id, v.response.rev)} doneHref={back} doneLabel="Back to your booking" />
        )}
      </main>
    </>
  );
}
