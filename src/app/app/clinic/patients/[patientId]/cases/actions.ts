"use server";
/**
 * Cases and treatment authorisations of a patient (the shared record, through the foundation's repositories).
 * The case is always read from the member's own clinic AND must belong to the patient of the form.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AuthorisationInputSchema, AuthorisationPatchSchema, CaseInputSchema, CasePatchSchema, fieldErrors } from "@/modules/pms/core/schemas";
import type { RecordsActionState } from "@/modules/pms/records/types";
import { actorErrorMessage, clinicActionActor, type ClinicActor } from "@/server/pms/actor";
import { authorisationInputFromForm, caseInputFromForm, intField, renameErrors, text } from "@/server/pms/records/forms";
import { NOT_FOUND_MESSAGE, actionError, patientForAction, patientPath, saveError } from "@/server/pms/records/record";
import { createAuthorisation, createCase, getAuthorisation, getCase, updateAuthorisation, updateCase } from "@/server/repos/pms/cases";

const CASE_RENAMES = { excessPence: "excess" };
const AUTH_RENAMES = { valueAuthorisedPence: "valueAuthorised" };

async function caseOfPatient(actor: ClinicActor, form: FormData) {
  const patient = await patientForAction(actor, form.get("patientId"));
  if (!patient) return null;
  const c = await getCase(actor.repo(), actor.tenantId, text(form, "caseId"));
  return c && c.patientId === patient.id ? { patient, case: c } : null;
}

export async function openCase(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "patients.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const patient = await patientForAction(actor, form.get("patientId"));
  if (!patient) return { ok: false, error: NOT_FOUND_MESSAGE };
  const input = caseInputFromForm(form, patient.id);
  const parsed = CaseInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Some details need checking.", fieldErrors: renameErrors(fieldErrors(parsed.error), CASE_RENAMES) };
  let id: string;
  try {
    id = (await createCase(actor.repo(), actor.tenantId, input, actor.actor)).id;
  } catch (err) {
    return actionError(err, "open_case");
  }
  revalidatePath(patientPath(patient.id), "layout");
  redirect(patientPath(patient.id, `cases/${id}`));
}

export async function saveCase(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "patients.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const found = await caseOfPatient(actor, form);
  if (!found) return { ok: false, error: NOT_FOUND_MESSAGE };
  const { patientId: _patientId, ...patch } = caseInputFromForm(form, found.patient.id);
  void _patientId;
  const parsed = CasePatchSchema.safeParse(patch);
  if (!parsed.success) return { ok: false, error: "Some details need checking.", fieldErrors: renameErrors(fieldErrors(parsed.error), CASE_RENAMES) };
  try {
    const result = await updateCase(actor.repo(), actor.tenantId, found.case.id, intField(form, "expectedRev"), patch, actor.actor);
    if (!result.ok) return saveError(result);
  } catch (err) {
    return actionError(err, "save_case");
  }
  revalidatePath(patientPath(found.patient.id), "layout");
  return { ok: true, message: "The case is saved." };
}

export async function addAuthorisation(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "patients.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const found = await caseOfPatient(actor, form);
  if (!found) return { ok: false, error: NOT_FOUND_MESSAGE };
  const input = authorisationInputFromForm(form, found.case.id);
  const parsed = AuthorisationInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Some details need checking.", fieldErrors: renameErrors(fieldErrors(parsed.error), AUTH_RENAMES) };
  try {
    await createAuthorisation(actor.repo(), actor.tenantId, input, actor.actor);
  } catch (err) {
    return actionError(err, "add_authorisation");
  }
  revalidatePath(patientPath(found.patient.id), "layout");
  return { ok: true, message: "The authorisation is added." };
}

export async function saveAuthorisation(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "patients.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const found = await caseOfPatient(actor, form);
  if (!found) return { ok: false, error: NOT_FOUND_MESSAGE };
  const auth = await getAuthorisation(actor.repo(), actor.tenantId, text(form, "authorisationId"));
  if (!auth || auth.caseId !== found.case.id) return { ok: false, error: NOT_FOUND_MESSAGE };
  const { caseId: _caseId, ...patch } = authorisationInputFromForm(form, found.case.id);
  void _caseId;
  const parsed = AuthorisationPatchSchema.safeParse(patch);
  if (!parsed.success) return { ok: false, error: "Some details need checking.", fieldErrors: renameErrors(fieldErrors(parsed.error), AUTH_RENAMES) };
  try {
    const result = await updateAuthorisation(actor.repo(), actor.tenantId, auth.id, intField(form, "expectedRev"), patch, actor.actor);
    if (!result.ok) return saveError(result);
  } catch (err) {
    return actionError(err, "save_authorisation");
  }
  revalidatePath(patientPath(found.patient.id), "layout");
  return { ok: true, message: "The authorisation is saved." };
}

export async function setAuthorisationStatus(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "patients.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const found = await caseOfPatient(actor, form);
  if (!found) return { ok: false, error: NOT_FOUND_MESSAGE };
  const auth = await getAuthorisation(actor.repo(), actor.tenantId, text(form, "authorisationId"));
  if (!auth || auth.caseId !== found.case.id) return { ok: false, error: NOT_FOUND_MESSAGE };
  const status = text(form, "status") === "active" ? "active" : "cancelled";
  try {
    const result = await updateAuthorisation(actor.repo(), actor.tenantId, auth.id, intField(form, "expectedRev"), { status }, actor.actor);
    if (!result.ok) return saveError(result);
  } catch (err) {
    return actionError(err, "authorisation_status");
  }
  revalidatePath(patientPath(found.patient.id), "layout");
  return { ok: true, message: status === "cancelled" ? "The authorisation is cancelled (kept on the case)." : "The authorisation is in use again." };
}
