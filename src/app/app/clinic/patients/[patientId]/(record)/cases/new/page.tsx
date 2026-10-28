import type { Metadata } from "next";
import { CaseForm } from "@/components/pms/records/case-forms";
import { SectionHeader, TextLinkTo } from "@/components/pms/records/ui";
import { ukToday } from "@/modules/pms/core/text";
import { requireClinicActor } from "@/server/pms/actor";
import { directoryOptions } from "@/server/pms/records/directory-options";
import { currentPractitionerId } from "@/server/pms/actor";
import { patientOr404, patientPath } from "@/server/pms/records/record";
import { openCase } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Open a case" };

export default async function NewCasePage({ params }: { params: { patientId: string } }) {
  const actor = await requireClinicActor({ permission: "patients.edit" });
  const patient = await patientOr404(actor, params.patientId);
  const [options, practitionerId] = await Promise.all([directoryOptions(actor), currentPractitionerId(actor)]);
  return (
    <div className="max-w-3xl">
      <p className="mb-2 text-sm">
        <TextLinkTo href={patientPath(patient.id, "cases")}>← Cases</TextLinkTo>
      </p>
      <SectionHeader title="Open a case" />
      <CaseForm action={openCase} patientId={patient.id} options={options} values={{ openedOn: ukToday(), practitionerId }} submitLabel="Open case" />
    </div>
  );
}
