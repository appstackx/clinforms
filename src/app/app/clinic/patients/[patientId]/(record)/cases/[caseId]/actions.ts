"use server";
/**
 * "Complete referrer form" on a case: records the request and answers the ClinForms address that opens the chosen
 * form with this case loaded (src/server/pms/integration/referrer-forms.ts – permission, case of this patient in the
 * member's sites, both packages, the form confirmed in the clinic's own library). Nothing is taken from the browser
 * but the ids and the consent tick.
 */
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { revalidatePath } from "next/cache";
import { setCaseDiagnosisFor } from "@/server/pms/billing/healthcode";
import { startReferrerFormFor } from "@/server/pms/integration/referrer-forms";

export async function startReferrerFormAction(patientId: string, caseId: string, input: { formId: string; consentRecorded: boolean }): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const actor = await clinicActionActor({ permission: "patients.view" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await startReferrerFormFor(actor, {
    patientId: String(patientId ?? ""),
    caseId: String(caseId ?? ""),
    formId: typeof input?.formId === "string" ? input.formId : "",
    consentRecorded: input?.consentRecorded === true,
  });
  return r.ok ? { ok: true, url: r.value.url } : { ok: false, error: r.error };
}

/** The case's ICD-10 diagnosis code (HC10): clinical.view + patients.edit, checked again in the service. */
export async function setCaseDiagnosisAction(patientId: string, caseId: string, code: string): Promise<{ ok: true; code: string | null } | { ok: false; error: string }> {
  const actor = await clinicActionActor({ permission: "patients.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await setCaseDiagnosisFor(actor, String(patientId ?? ""), String(caseId ?? ""), typeof code === "string" ? code.slice(0, 20) : "");
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath(`/app/clinic/patients/${patientId}/cases/${caseId}`);
  return { ok: true, code: r.value.code };
}
