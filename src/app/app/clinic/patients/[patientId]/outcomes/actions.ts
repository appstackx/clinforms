"use server";
/**
 * Outcome measures: record one (scored on the server), or mark one as entered in error (kept, left out of charts).
 * The records service (src/server/pms/records/outcomes-service.ts) checks the clinical permission again first.
 */
import { revalidatePath } from "next/cache";
import { OutcomeMeasureIdSchema, answersFromForm } from "@/modules/pms/records/outcomes";
import type { RecordsActionState } from "@/modules/pms/records/types";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { actionState } from "@/server/pms/records/action-state";
import { optional, text } from "@/server/pms/records/forms";
import { markOutcomeInErrorFor, recordOutcomeFor } from "@/server/pms/records/outcomes-service";
import { patientPath } from "@/server/pms/records/record";

export async function recordMeasure(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "clinical.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const patientId = text(form, "patientId");
  const measure = OutcomeMeasureIdSchema.safeParse(text(form, "measure"));
  if (!measure.success) return { ok: false, error: "Choose a measure." };
  const result = await recordOutcomeFor(actor, patientId, {
    measure: measure.data,
    takenOn: text(form, "takenOn"),
    answers: answersFromForm(measure.data, (name) => text(form, name)),
    caseId: optional(form, "caseId"),
    noteId: optional(form, "noteId"),
  });
  if (result.ok) revalidatePath(patientPath(patientId, "outcomes"));
  return actionState(result, (v) => ({ ok: true, id: v.id, message: "The measure is recorded." }));
}

export async function markMeasureInError(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "clinical.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const patientId = text(form, "patientId");
  const result = await markOutcomeInErrorFor(actor, patientId, text(form, "outcomeId"), text(form, "reason"));
  if (result.ok) revalidatePath(patientPath(patientId, "outcomes"));
  return actionState(result, () => ({ ok: true, message: "Marked as entered in error." }));
}
