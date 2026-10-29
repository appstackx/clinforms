import { notFound } from "next/navigation";
import { PatientForm } from "@/components/pms/records/patient-form";
import { SectionHeader } from "@/components/pms/records/ui";
import { formatUkDateTime } from "@/modules/pms/core/access";
import { requireClinicActor } from "@/server/pms/actor";
import { patientOr404 } from "@/server/pms/records/record";
import { getAnonymisation } from "@/server/repos/pms/records/anonymise";
import { savePatientDetails, savePronouns } from "../../actions";
import { PronounsForm } from "@/components/pms/records/pronouns-form";
import { patientExtrasFor } from "@/server/pms/records/flags-service";
import { gatedMetadata } from "@/server/pms/page-gate";

export const dynamic = "force-dynamic";
export const generateMetadata = gatedMetadata({ title: "Edit patient details" }, "patients.edit");

/** Edit the patient's details (revision-checked: a change made meanwhile by someone else is never overwritten). */
export default async function EditPatientPage({ params }: { params: { patientId: string } }) {
  const actor = await requireClinicActor({ permission: "patients.edit" });
  const patient = await patientOr404(actor, params.patientId);
  if ((await getAnonymisation(actor.repo(), actor.tenantId, patient.id))?.status === "done") notFound();
  const extras = await patientExtrasFor(actor, patient.id);
  return (
    <div className="max-w-3xl space-y-6">
      <SectionHeader title="Edit details" description="Changes are saved to the record and shown in its history." />
      <div className="rounded-2xl border border-border bg-white p-4">
        <PronounsForm key={extras.ok ? extras.value.rev : 0} action={savePronouns} patientId={patient.id} rev={extras.ok ? extras.value.rev : 0} pronouns={extras.ok ? extras.value.pronouns : null} />
      </div>
      <PatientForm
        key={patient.rev}
        action={savePatientDetails}
        submitLabel="Save details"
        consentRecordedOn={patient.consentTreatmentAt ? formatUkDateTime(patient.consentTreatmentAt) : null}
        values={{
          ...patient,
          patientId: patient.id,
          rev: patient.rev,
        }}
      />
    </div>
  );
}
