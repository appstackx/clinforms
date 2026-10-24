/**
 * Completing intake and consent forms, and what they may change on the patient's record.
 *
 * - The patient completes a copy through their portal sign-in ("verified": the link went to the email address on
 *   the record), through the booking link ("unverified": whoever booked), or in the clinic with a member of staff
 *   ("verified", recorded under that member).
 * - A signed consent form records consent on the record straight away only when "verified". Everything else a
 *   form may change (contact details, GP, emergency contact) waits for a member of staff to check and apply it.
 */
import "server-only";
import { consentComplete, questions, recordUpdates, type FormDefinition, type RecordField, type RecordUpdate } from "../../../modules/pms/portal/forms";
import type { PatientPatch } from "../../../modules/pms/core/schemas";
import type { PmsActor } from "../../../modules/pms/core/types";
import type { IntakeResponse } from "../../../modules/pms/portal/types";
import type { RepoContext } from "../../repos/context";
import { getPatient, updatePatient } from "../../repos/pms/patients";
import { getIntakeResponse, markResponseApplied, submitIntakeResponse, type SubmitResult } from "../../repos/pms/portal/intake";

/** A form post → raw answers for checkAnswers (lists for "any choices", "on" for ticks). */
export function answersFromForm(form: FormData, def: FormDefinition): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of questions(def)) {
    const key = `q_${f.id}`;
    if (f.type === "multi") out[f.id] = form.getAll(key).map(String);
    else {
      const v = form.get(key);
      if (typeof v === "string") out[f.id] = v;
    }
  }
  return out;
}

function patchFrom(updates: RecordUpdate[]): PatientPatch {
  const patch: Record<string, unknown> = {};
  for (const u of updates) patch[u.field] = u.value;
  return patch as PatientPatch;
}

/** Applies a patch to the patient's record with the current revision (retried once if someone saved meanwhile). */
async function patchPatient(ctx: RepoContext, tenantId: string, patientId: string, patch: PatientPatch, actor: PmsActor): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const p = await getPatient(ctx, tenantId, patientId);
    if (!p) return false;
    const r = await updatePatient(ctx, tenantId, patientId, p.rev, patch, actor);
    if (r.ok) return true;
    if (r.reason === "not_found") return false;
  }
  return false;
}

/** The consent fields of a signed consent form (consent to treatment, writing to the GP). */
export function consentUpdates(response: Pick<IntakeResponse, "form" | "answers" | "setsTreatmentConsent" | "status">): RecordUpdate[] {
  if (response.status !== "submitted" || !response.answers || !response.setsTreatmentConsent || !consentComplete(response.form, response.answers)) return [];
  return recordUpdates(response.form, response.answers).filter((u) => u.field === "consentTreatment" || u.field === "consentShareGp");
}

export type PatientSubmitOutcome = SubmitResult & { consentRecorded?: boolean };

/** Completes a copy; a verified, signed consent form also records the consent on the patient's record. */
export async function submitForm(
  ctx: RepoContext,
  tenantId: string,
  responseId: string,
  expectedRev: number,
  input: { answers: Record<string, unknown>; signatureName?: string | null; trust: "verified" | "unverified" },
  actor: PmsActor,
): Promise<PatientSubmitOutcome> {
  const result = await submitIntakeResponse(ctx, tenantId, responseId, expectedRev, input, actor);
  if (!result.ok || input.trust !== "verified") return result;
  const updates = consentUpdates(result.response);
  if (updates.length === 0) return result;
  const done = await patchPatient(ctx, tenantId, result.response.patientId, patchFrom(updates), actor);
  if (done) await markResponseApplied(ctx, tenantId, responseId, updates.map((u) => u.field), actor);
  return { ...result, consentRecorded: done };
}

export type ApplyOutcome = { ok: true; fields: RecordField[] } | { ok: false; error: string };

/** Staff copy chosen answers of a completed copy to the patient's record. */
export async function applyToRecord(ctx: RepoContext, tenantId: string, responseId: string, chosen: RecordField[], actor: PmsActor): Promise<ApplyOutcome> {
  const response = await getIntakeResponse(ctx, tenantId, responseId);
  if (!response || response.status !== "submitted" || !response.answers) return { ok: false, error: "This form has not been completed." };
  const wanted = new Set(chosen);
  const updates = recordUpdates(response.form, response.answers).filter((u) => wanted.has(u.field));
  // Consent to treatment comes only from a signed consent form with every required box ticked.
  const safe = updates.filter((u) => u.field !== "consentTreatment" || consentUpdates(response).some((c) => c.field === "consentTreatment"));
  if (safe.length === 0) return { ok: false, error: "Choose at least one detail to copy to the record." };
  const done = await patchPatient(ctx, tenantId, response.patientId, patchFrom(safe), actor);
  if (!done) return { ok: false, error: "The patient's record could not be updated. Please try again." };
  await markResponseApplied(ctx, tenantId, responseId, safe.map((u) => u.field), actor);
  return { ok: true, fields: safe.map((u) => u.field) };
}
