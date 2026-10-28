import type { Metadata } from "next";
import { PatientForms } from "@/components/pms/portal/patient-forms";
import { requireClinicActor } from "@/server/pms/actor";
import { patientOr404 } from "@/server/pms/records/record";
import { listCasesForPatient } from "@/server/repos/pms/cases";
import { patientFormsFor } from "@/server/pms/portal/staff";
import { sendFormAction, sendOutcomeAction, setPortalAccessAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Forms" };

/**
 * A patient's record → Forms (portal module; patients.view): forms sent, waiting and signed (the sealed copy opens),
 * Send a form (patients.edit), Send a questionnaire to the patient's portal (clinical.write – outcome measures),
 * portal access. Reception sees the forms and signatures, never health answers or outcome questionnaires' answers.
 */
export default async function PatientFormsPage({ params }: { params: { patientId: string } }) {
  const actor = await requireClinicActor({ permission: "patients.view" });
  const patient = await patientOr404(actor, params.patientId);
  const r = await patientFormsFor(actor, patient.id);
  if (!r.ok) return <p role="alert">{r.error}</p>;
  const cases = actor.can("clinical.write") ? (await listCasesForPatient(actor.repo(), actor.tenantId, patient.id)).filter((c) => c.status === "open").map((c) => ({ id: c.id, title: c.title })) : [];
  return (
    <PatientForms
      patientId={patient.id}
      view={r.value}
      cases={cases}
      canSeeClinical={actor.can("clinical.view")}
      sendForm={sendFormAction.bind(null, patient.id)}
      sendOutcome={sendOutcomeAction.bind(null, patient.id)}
      setPortal={setPortalAccessAction.bind(null, patient.id)}
    />
  );
}
