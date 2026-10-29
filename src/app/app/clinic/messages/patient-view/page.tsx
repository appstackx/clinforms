import Link from "next/link";
import { MESSAGES_PATH } from "@/components/pms/comms/format";
import { PatientFacing } from "@/components/pms/comms/patient-facing";
import { requireClinicActor } from "@/server/pms/actor";
import { patientFacingFor } from "@/server/pms/comms/views";
import { gatedMetadata } from "@/server/pms/page-gate";

export const dynamic = "force-dynamic";
export const generateMetadata = gatedMetadata({ title: "What patients receive" }, "messages.send");

/** /app/clinic/messages/patient-view (design round 3, "Patient-facing messages"). messages.send. */
export default async function PatientFacingPage() {
  const actor = await requireClinicActor({ permission: "messages.send" });
  const r = await patientFacingFor(actor);
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1180px] flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-sm text-[#475569]">
        <Link href={`${MESSAGES_PATH}?tab=templates`} className="text-primary-strong underline underline-offset-2">
          Messages
        </Link>
        <span aria-hidden> / </span>
        <span>What patients receive</span>
      </nav>
      <div>
        <h1 className="text-2xl font-semibold text-foreground">What patients receive</h1>
        <p className="text-sm text-[#475569]">Sent under the clinic&apos;s name. Shown with a fictional patient&apos;s details.</p>
      </div>
      {r.ok ? <PatientFacing view={r.value} /> : <p role="alert">{r.error}</p>}
    </div>
  );
}
