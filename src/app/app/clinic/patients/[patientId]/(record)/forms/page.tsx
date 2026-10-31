import type { Metadata } from "next";
import { FiledFormsList } from "@/components/pms/integration/filed-forms-list";
import { PatientForms } from "@/components/pms/portal/patient-forms";
import { filedFormsForPatient } from "@/server/pms/integration/referrer-forms";
import { requireClinicActor } from "@/server/pms/actor";
import { patientOr404, patientPath } from "@/server/pms/records/record";
import { listCasesForPatient } from "@/server/repos/pms/cases";
import { patientFormsFor } from "@/server/pms/portal/staff";
import { sendFormAction, sendOutcomeAction, setPortalAccessAction, startHandoffAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Forms" };

/**
 * A patient's record → Forms (portal module; patients.view): forms sent, waiting and signed (the sealed copy opens),
 * Send a form (patients.edit), Send a questionnaire to the patient's portal (clinical.write – outcome measures),
 * portal access. Reception sees the forms and signatures, never health answers or outcome questionnaires' answers.
 * Above them (integration, 10/2026): referrer and insurer forms completed in ClinForms and filed back to a case.
 */
export default async function PatientFormsPage({
  params,
}: {
  params: { patientId: string };
}) {
  const actor = await requireClinicActor({ permission: "patients.view" });
  const patient = await patientOr404(actor, params.patientId);
  const r = await patientFormsFor(actor, patient.id);
  if (!r.ok) return <p role="alert">{r.error}</p>;
  const filed = await filedFormsForPatient(actor, patient.id);
  const cases = actor.can("clinical.write")
    ? (await listCasesForPatient(actor.repo(), actor.tenantId, patient.id))
        .filter((c) => c.status === "open")
        .map((c) => ({ id: c.id, title: c.title }))
    : [];
  return (
    <div className="space-y-6">
      {filed.ok && filed.value.rows.length > 0 ? (
        <FiledFormsList
          rows={filed.value.rows.map((r) => ({
            ...r,
            href: filed.value.canOpenFiles
              ? patientPath(patient.id, `filed-forms/${r.id}`)
              : null,
          }))}
        />
      ) : null}
      <PatientForms
        patientId={patient.id}
        view={r.value}
        cases={cases}
        canSeeClinical={actor.can("clinical.view")}
        sendForm={sendFormAction.bind(null, patient.id)}
        sendOutcome={sendOutcomeAction.bind(null, patient.id)}
        setPortal={setPortalAccessAction.bind(null, patient.id)}
        startHandoff={startHandoffAction.bind(null, patient.id)}
      />
    </div>
  );
}
