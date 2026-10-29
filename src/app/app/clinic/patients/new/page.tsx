import { NewPatientPage } from "@/components/pms/records/new-patient-page";
import { requireClinicActor } from "@/server/pms/actor";
import { registerPatient } from "../actions";
import { gatedMetadata } from "@/server/pms/page-gate";

export const dynamic = "force-dynamic";
export const generateMetadata = gatedMetadata({ title: "New patient" }, "patients.edit");

/** /app/clinic/patients/new – the new-patient form on its own page (the list opens the same form in a drawer). */
export default async function NewPatient({ searchParams }: { searchParams: { name?: string } }) {
  await requireClinicActor({ permission: "patients.edit" });
  return <NewPatientPage action={registerPatient} initialName={typeof searchParams.name === "string" ? searchParams.name.slice(0, 120) : undefined} />;
}
