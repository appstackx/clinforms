/**
 * A patient's history (who did what, when) from the clinic's audit log. Rules: ./access.ts.
 *
 *   patients.view – the history. For a member WITHOUT clinical.view (reception) the rows about clinical records
 *                   (notes, outcome measures, attached files) keep only what happened and when – their details
 *                   (note type, sections written, amendment kind, measure, file type) are removed, so nothing of the
 *                   clinical content can be inferred from the history either.
 */
import type { AuditEntry } from "../../repos/audit";
import { listPatientHistory } from "../../repos/pms/records/history";
import { attempt, guard, notFound, ok, patientInClinic, type RecordsActor, type Result } from "./access";

/** Audit target types whose details are clinical. */
export const CLINICAL_TARGET_TYPES: readonly string[] = ["pms_note", "pms_outcome", "pms_attachment"];

export function redactClinicalDetail(entries: readonly AuditEntry[], canSeeClinical: boolean): AuditEntry[] {
  if (canSeeClinical) return entries.slice();
  return entries.map((e) => (e.targetType && CLINICAL_TARGET_TYPES.includes(e.targetType) ? { ...e, detail: null } : e));
}

export async function patientHistoryFor(actor: RecordsActor, patientId: string, options: { limit?: number; extraTargetIds?: readonly string[] } = {}): Promise<Result<AuditEntry[]>> {
  const denied = guard(actor, "patients.view");
  if (denied) return denied;
  return attempt("patient_history", async () => {
    const patient = await patientInClinic(actor, patientId);
    if (!patient) return notFound();
    const rows = await listPatientHistory(actor.repo(), actor.tenantId, patient.id, { limit: options.limit, extraTargetIds: options.extraTargetIds });
    return ok(redactClinicalDetail(rows, actor.can("clinical.view")));
  });
}
