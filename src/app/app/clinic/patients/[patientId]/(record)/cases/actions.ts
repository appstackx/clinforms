"use server";
/**
 * Cases and treatment authorisations of a patient. The records service (src/server/pms/records/cases-service.ts)
 * checks the permission again, reads the case from the member's own clinic and checks it is the patient's, checks the
 * payer account fits the payer type, and validates.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { RecordsActionState } from "@/modules/pms/records/types";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { actionState } from "@/server/pms/records/action-state";
import { addAuthorisationFor, openCaseFor, setAuthorisationStatusFor, updateAuthorisationFor, updateCaseFor } from "@/server/pms/records/cases-service";
import { authorisationInputFromForm, caseInputFromForm, intField, text } from "@/server/pms/records/forms";
import { patientPath } from "@/server/pms/records/record";
import { setCaseContributionModeFor } from "@/server/pms/billing/writes";
import type { ClinicActor } from "@/server/pms/actor";

/** Billing's field on the case form (only there when the member can see billing): the case's own mode. */
async function saveContributionMode(actor: ClinicActor, form: FormData, patientId: string, caseId: string): Promise<string | null> {
  if (!form.has("contributionMode") || !actor.can("billing.view")) return null;
  const r = await setCaseContributionModeFor(actor, patientId, caseId, text(form, "contributionMode"));
  return r.ok ? null : r.error;
}

export async function openCase(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "patients.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const patientId = text(form, "patientId");
  const { patientId: _p, ...input } = caseInputFromForm(form, patientId);
  void _p;
  const result = await openCaseFor(actor, patientId, input);
  if (!result.ok) return actionState(result, () => ({ ok: true }));
  const billingError = await saveContributionMode(actor, form, patientId, result.value.id);
  if (billingError) return { ok: false, error: `The case is opened, but how the patient's part is billed was not saved: ${billingError}` };
  revalidatePath(patientPath(patientId), "layout");
  redirect(patientPath(patientId, `cases/${result.value.id}`));
}

export async function saveCase(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "patients.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const patientId = text(form, "patientId");
  const { patientId: _p, ...patch } = caseInputFromForm(form, patientId);
  void _p;
  const result = await updateCaseFor(actor, patientId, text(form, "caseId"), intField(form, "expectedRev"), patch);
  if (result.ok) {
    const billingError = await saveContributionMode(actor, form, patientId, text(form, "caseId"));
    revalidatePath(patientPath(patientId), "layout");
    if (billingError) return { ok: false, error: `The case is saved, but how the patient's part is billed was not saved: ${billingError}` };
  }
  return actionState(result, (v) => ({ ok: true, rev: v.rev, message: "The case is saved." }));
}

export async function addAuthorisation(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "patients.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const patientId = text(form, "patientId");
  const caseId = text(form, "caseId");
  const { caseId: _c, ...input } = authorisationInputFromForm(form, caseId);
  void _c;
  const result = await addAuthorisationFor(actor, patientId, caseId, input);
  if (result.ok) revalidatePath(patientPath(patientId), "layout");
  return actionState(result, (v) => ({ ok: true, id: v.id, message: "The authorisation is added." }));
}

export async function saveAuthorisation(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "patients.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const patientId = text(form, "patientId");
  const caseId = text(form, "caseId");
  const { caseId: _c, ...patch } = authorisationInputFromForm(form, caseId);
  void _c;
  const result = await updateAuthorisationFor(actor, patientId, caseId, text(form, "authorisationId"), intField(form, "expectedRev"), patch);
  if (result.ok) revalidatePath(patientPath(patientId), "layout");
  return actionState(result, (v) => ({ ok: true, rev: v.rev, message: "The authorisation is saved." }));
}

export async function setAuthorisationStatus(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "patients.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const patientId = text(form, "patientId");
  const status = text(form, "status") === "active" ? "active" : "cancelled";
  const result = await setAuthorisationStatusFor(actor, patientId, text(form, "caseId"), text(form, "authorisationId"), intField(form, "expectedRev"), status);
  if (result.ok) revalidatePath(patientPath(patientId), "layout");
  return actionState(result, (v) => ({ ok: true, rev: v.rev, message: status === "cancelled" ? "The authorisation is cancelled (kept on the case)." : "The authorisation is in use again." }));
}
