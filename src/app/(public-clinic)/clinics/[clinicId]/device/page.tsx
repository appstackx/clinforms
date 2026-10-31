import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Lock } from "lucide-react";
import { FormFiller } from "@/components/pms/portal/form-filler";
import { PublicHeader } from "@/components/pms/portal/public-shell";
import { clinicPublicPaths } from "@/modules/pms/portal/paths";
import { DevicePairForm } from "@/components/pms/portal/device-pair-form";
import { DEVICE_COOKIE, deviceState } from "@/server/pms/portal/device-flow";
import { clinicInitials, loadPublicClinic } from "@/server/pms/portal/public-clinic";
import { deviceClinicOr404, publicCtx } from "@/server/pms/portal/public-page";
import { devicePairAction, deviceSubmitAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { absolute: "Your form" } };

/**
 * /clinics/<clinic>/device – a clinic device (a tablet at reception) showing ONE form a member of staff handed to the
 * patient (FORM-007). Only the form: no staff navigation, no other patient data, not even the patient's name. When
 * the patient has sent it, the device is locked on "Please hand the device back" until a member of staff verifies it
 * with their password ON THEIR OWN SCREEN (src/server/pms/portal/clinic-device.ts). M10 H3: the device is a browser
 * that is not signed in, paired by the code staff get on their screen; this page never links into the staff app.
 */
export default async function ClinicDevicePage({ params }: { params: { clinicId: string } }) {
  const clinic = await deviceClinicOr404(params.clinicId);
  const paths = clinicPublicPaths(clinic.tenantId);
  const state = await deviceState(publicCtx(), clinic.tenantId, cookies().get(DEVICE_COOKIE)?.value);
  // The layout shows the clinic's header only while booking or the portal is open; the device page always does.
  const headerShown = Boolean(await loadPublicClinic(publicCtx(), clinic.tenantId));
  return (
    <>
      {headerShown ? null : <PublicHeader name={clinic.name} initials={clinicInitials(clinic.name)} demo={clinic.isDemo} />}
      <main className="px-4 pb-16 pt-5">
        {state.state === "open" ? (
          <FormFiller
            title={state.response.name}
            form={state.response.form}
            requiresSignature={state.response.requiresSignature}
            signatureStatement={state.response.signatureStatement}
            submit={deviceSubmitAction.bind(null, clinic.tenantId, state.response.rev)}
            doneHref={paths.device}
            doneLabel="Done"
            replaceOnDone
          />
        ) : state.state === "completed" ? (
          <section aria-labelledby="dv-h" className="space-y-4 rounded-[12px] border border-border bg-white p-5 text-center">
            <span aria-hidden="true" className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#F1F5F9] text-[#334155]">
              <Lock className="h-6 w-6" />
            </span>
            <h1 id="dv-h" className="text-[22px] font-bold text-foreground">
              Thank you – your form has been {state.requiresSignature ? "signed and sent" : "sent"}
            </h1>
            <p className="text-[16px] text-[#334155]">Please hand the device back to a member of staff.</p>
            <p className="text-[13px] text-[#475569]">A member of staff checks it on their own screen.</p>
          </section>
        ) : (
          <DevicePairForm
            pair={devicePairAction.bind(null, clinic.tenantId)}
            heading={state.state === "finished" ? "All done" : "Your form"}
            lead={state.state === "finished" ? "Thank you. For another form, enter the new code from a member of staff." : "Enter the code a member of staff gives you to open your form."}
          />
        )}
      </main>
    </>
  );
}
