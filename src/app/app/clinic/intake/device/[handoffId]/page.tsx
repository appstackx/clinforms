import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HandoffVerify } from "@/components/pms/portal/handoff-verify";
import { STAFF_PORTAL_PATHS } from "@/modules/pms/portal/paths";
import { formatWhen } from "@/modules/pms/portal/time";
import { requireClinicActor } from "@/server/pms/actor";
import { handoffStaffViewFor } from "@/server/pms/portal/clinic-device";
import { endHandoffAction, newPairingCodeAction, verifyHandoffAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Form completed in the clinic" };

/**
 * /app/clinic/intake/device/<hand-off> – on the member of staff's own screen: a code pairs the clinic device (M10 H3);
 * once the device is handed back, the member checks it is the right patient and confirms with their password
 * ("Completed in the clinic, verified by …"), or ends the hand-off.
 * patients.edit (the service checks the patient's sites too).
 */
export default async function HandoffPage({ params }: { params: { handoffId: string } }) {
  const actor = await requireClinicActor({ permission: "patients.edit" });
  const r = await handoffStaffViewFor(actor, params.handoffId);
  if (!r.ok) notFound();
  const v = r.value;
  const h = v.handoff;
  return (
    <HandoffVerify
      patientName={v.patientName}
      formName={v.formName}
      formsHref={STAFF_PORTAL_PATHS.patientForms(v.patientId)}
      copyHref={STAFF_PORTAL_PATHS.patientResponse(v.patientId, h.responseId)}
      state={h.status === "open" ? (v.usable ? "open" : "expired") : h.status}
      startedAt={formatWhen(h.createdAt)}
      completedAt={h.completedAt ? formatWhen(h.completedAt) : null}
      verified={h.verifiedAt ? { by: v.verifiedByName ?? "", at: formatWhen(h.verifiedAt) } : null}
      memberName={actor.name}
      verify={verifyHandoffAction.bind(null, h.id)}
      end={endHandoffAction.bind(null, h.id)}
      paired={Boolean(v.pairing?.pairedAt)}
      devicePath={v.devicePath}
      newCode={newPairingCodeAction.bind(null, h.id)}
    />
  );
}
