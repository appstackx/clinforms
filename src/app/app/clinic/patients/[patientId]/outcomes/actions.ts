"use server";
/** Outcome measures: record one (scored on the server), or mark one as entered in error (kept, left out of charts). */
import { revalidatePath } from "next/cache";
import { OutcomeMeasureIdSchema, answersFromForm, scoreOutcome } from "@/modules/pms/records/outcomes";
import type { RecordsActionState } from "@/modules/pms/records/types";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { optional, text } from "@/server/pms/records/forms";
import { NOT_FOUND_MESSAGE, actionError, patientForAction, patientPath } from "@/server/pms/records/record";
import { getCase } from "@/server/repos/pms/cases";
import { getOutcome, markOutcomeInError, recordOutcome } from "@/server/repos/pms/records/outcomes";

export async function recordMeasure(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "clinical.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const patient = await patientForAction(actor, form.get("patientId"));
  if (!patient) return { ok: false, error: NOT_FOUND_MESSAGE };
  const measure = OutcomeMeasureIdSchema.safeParse(text(form, "measure"));
  if (!measure.success) return { ok: false, error: "Choose a measure." };
  const takenOn = text(form, "takenOn");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(takenOn)) return { ok: false, error: "Enter the date.", fieldErrors: { takenOn: "Enter the date." } };
  const caseId = optional(form, "caseId");
  if (caseId) {
    const c = await getCase(actor.repo(), actor.tenantId, caseId);
    if (!c || c.patientId !== patient.id) return { ok: false, error: NOT_FOUND_MESSAGE };
  }
  const answers = answersFromForm(measure.data, (name) => text(form, name));
  const scored = scoreOutcome(measure.data, answers);
  if (!scored.ok) return { ok: false, error: scored.error };
  try {
    await recordOutcome(actor.repo(), actor.tenantId, { patientId: patient.id, caseId, measure: measure.data, takenOn, answers }, actor.actor);
  } catch (err) {
    return actionError(err, "record_outcome");
  }
  revalidatePath(patientPath(patient.id, "outcomes"));
  return { ok: true, message: "The measure is recorded." };
}

export async function markMeasureInError(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "clinical.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const patient = await patientForAction(actor, form.get("patientId"));
  if (!patient) return { ok: false, error: NOT_FOUND_MESSAGE };
  const outcome = await getOutcome(actor.repo(), actor.tenantId, text(form, "outcomeId"));
  if (!outcome || outcome.patientId !== patient.id) return { ok: false, error: NOT_FOUND_MESSAGE };
  const reason = text(form, "reason").trim();
  if (!reason) return { ok: false, error: "Give the reason.", fieldErrors: { reason: "Give the reason." } };
  try {
    await markOutcomeInError(actor.repo(), actor.tenantId, outcome.id, reason, actor.actor);
  } catch (err) {
    return actionError(err, "outcome_error");
  }
  revalidatePath(patientPath(patient.id, "outcomes"));
  return { ok: true, message: "Marked as entered in error." };
}
