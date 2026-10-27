import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PatientForm } from "@/components/pms/records/patient-form";
import { SectionHeader } from "@/components/pms/records/ui";
import { activityTime } from "@/server/admin/activity";
import { requireClinicActor } from "@/server/pms/actor";
import { patientOr404 } from "@/server/pms/records/record";
import { getAnonymisation } from "@/server/repos/pms/records/anonymise";
import { savePatientDetails } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit patient details" };

/** Edit the patient's details (revision-checked: a change made meanwhile by someone else is never overwritten). */
export default async function EditPatientPage({ params }: { params: { patientId: string } }) {
  const actor = await requireClinicActor({ permission: "patients.edit" });
  const patient = await patientOr404(actor, params.patientId);
  if ((await getAnonymisation(actor.repo(), actor.tenantId, patient.id))?.status === "done") notFound();
  return (
    <div className="max-w-3xl">
      <SectionHeader title="Edit details" description="Changes are saved to the record and shown in its history." />
      <PatientForm
        key={patient.rev}
        action={savePatientDetails}
        submitLabel="Save details"
        consentRecordedOn={patient.consentTreatmentAt ? activityTime(patient.consentTreatmentAt) : null}
        values={{
          ...patient,
          patientId: patient.id,
          rev: patient.rev,
        }}
      />
    </div>
  );
}
