import type { Metadata } from "next";
import { PageHeader } from "@/components/account/shell";
import { PatientForm } from "@/components/pms/records/patient-form";
import { TextLinkTo } from "@/components/pms/records/ui";
import { requireClinicActor } from "@/server/pms/actor";
import { PATIENTS_PATH } from "@/server/pms/records/record";
import { registerPatient } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Register a patient" };

/** /app/clinic/patients/new – register a patient (the clinic gives the next patient number). */
export default async function NewPatientPage() {
  await requireClinicActor({ permission: "patients.edit" });
  return (
    <>
      <p className="mb-2 text-sm">
        <TextLinkTo href={PATIENTS_PATH}>← Patients</TextLinkTo>
      </p>
      <PageHeader title="Register a patient" description="Only the name is required. Fields marked * must be filled in. The patient number is given when you save." />
      <div className="max-w-3xl">
        <PatientForm action={registerPatient} submitLabel="Register patient" />
      </div>
    </>
  );
}
