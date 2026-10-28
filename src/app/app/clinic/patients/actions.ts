"use server";
/**
 * Patients → register a patient (the record's own changes are in [patientId]/actions.ts). The rules live in the
 * records service (src/server/pms/records/patients-service.ts): it checks the permission again, validates, and
 * answers possible duplicates instead of registering a second record for the same person – the form registers
 * anyway only when the member ticks "This is a different person" (confirmNotDuplicate).
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { displayName } from "@/modules/pms/records/form-values";
import { DUPLICATE_REASON_LABELS } from "@/modules/pms/records/duplicates";
import type { RecordsActionState } from "@/modules/pms/records/types";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { actionState } from "@/server/pms/records/action-state";
import { checked, patientInputFromForm, text } from "@/server/pms/records/forms";
import { registerPatientFor } from "@/server/pms/records/patients-service";
import { savePronounsFor } from "@/server/pms/records/flags-service";
import { PATIENTS_PATH, patientPath } from "@/server/pms/records/record";
import { CLINIC_BASE_PATH } from "@/modules/pms/core/modules";

/**
 * The new-patient drawer and page. Besides the shared record's fields: pronouns (records' own table, saved right
 * after the patient is registered), "News and offers by email" recorded as marketing consent given in person
 * ("verbal") when ticked without a source, and intent=book → the diary to book the first appointment.
 */
export async function registerPatient(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "patients.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const input = patientInputFromForm(form);
  if ((input.marketingEmail || input.marketingSms) && !input.marketingConsentSource) input.marketingConsentSource = "verbal";
  const result = await registerPatientFor(actor, input, { confirmNotDuplicate: checked(form, "confirmNotDuplicate") });
  if (result.ok && result.value.kind === "possible_duplicates") {
    return {
      ok: false,
      error: "This patient may already be registered. Open the existing record, or tick “This is a different person” and register again.",
      duplicates: result.value.duplicates.map((d) => ({
        id: d.patient.id,
        patientNumber: d.patient.patientNumber,
        name: displayName(d.patient),
        dateOfBirth: d.patient.dateOfBirth,
        status: d.patient.status,
        reasons: d.reasons.map((r) => DUPLICATE_REASON_LABELS[r]),
      })),
    };
  }
  if (!result.ok) return actionState(result, () => ({ ok: true }));
  const id = result.value.kind === "created" ? result.value.patient.id : "";
  const pronouns = text(form, "pronouns").trim();
  // The patient exists now; a refused pronouns save (too long) is left for the record's edit page.
  if (id && pronouns) await savePronounsFor(actor, id, 0, pronouns);
  revalidatePath(PATIENTS_PATH);
  // TODO(diary): the diary's booking screen (feat/cs-diary) – until it is merged this is the diary's start address.
  if (text(form, "intent") === "book") redirect(`${CLINIC_BASE_PATH}/diary?patient=${encodeURIComponent(id)}`);
  redirect(patientPath(id));
}
