/**
 * Outcome measures (NDI, ODI, NPRS, PSFS, QuickDASH) for the records screens: the scores over time per measure,
 * one measure's answers, record (scored on the server – a client's score is never trusted), mark as entered in
 * error (kept, left out of the charts). Rules: ./access.ts.
 *
 *   clinical.view – scores and series, one measure's answers
 *   clinical.write – record, mark in error
 */
import { OutcomeInputSchema, outcomeSeries, scoreOutcome, type OutcomeAnswers, type OutcomeMeasureId, type OutcomeSeries } from "../../../modules/pms/records/outcomes";
import type { OutcomeRecord, OutcomeSummary } from "../../../modules/pms/records/types";
import { fieldErrors } from "../../../modules/pms/core/schemas";
import { getCase } from "../../repos/pms/cases";
import { getNote } from "../../repos/pms/records/notes";
import { getOutcome, listOutcomesForPatient, markOutcomeInError, recordOutcome } from "../../repos/pms/records/outcomes";
import { attempt, fail, guard, notFound, ok, patientInClinic, type RecordsActor, type Result } from "./access";

export interface OutcomesView {
  /** Every recorded score (and, with includeErrors, those marked in error), oldest first per measure. */
  scores: OutcomeSummary[];
  /** One series per measure, errors left out (charts). */
  series: OutcomeSeries[];
}

export async function outcomesFor(actor: RecordsActor, patientId: string, options: { caseId?: string | null; includeErrors?: boolean } = {}): Promise<Result<OutcomesView>> {
  const denied = guard(actor, "clinical.view");
  if (denied) return denied;
  return attempt("list_outcomes", async () => {
    const patient = await patientInClinic(actor, patientId);
    if (!patient) return notFound();
    const all = await listOutcomesForPatient(actor.repo(), actor.tenantId, patient.id, { includeErrors: true });
    const scoped = options.caseId !== undefined ? all.filter((o) => o.caseId === options.caseId) : all;
    return ok({ scores: options.includeErrors ? scoped : scoped.filter((o) => o.status === "recorded"), series: outcomeSeries(all, options.caseId !== undefined ? { caseId: options.caseId } : {}) });
  });
}

export async function getOutcomeFor(actor: RecordsActor, patientId: string, outcomeId: string): Promise<Result<OutcomeRecord>> {
  const denied = guard(actor, "clinical.view");
  if (denied) return denied;
  return attempt("get_outcome", async () => {
    const patient = await patientInClinic(actor, patientId);
    if (!patient || !outcomeId) return notFound();
    const o = await getOutcome(actor.repo(), actor.tenantId, outcomeId);
    return o && o.patientId === patient.id ? ok(o) : notFound();
  });
}

export interface RecordOutcomeInput {
  measure: OutcomeMeasureId;
  takenOn: string;
  answers: OutcomeAnswers;
  caseId?: string | null;
  noteId?: string | null;
}

export async function recordOutcomeFor(actor: RecordsActor, patientId: string, input: RecordOutcomeInput): Promise<Result<OutcomeRecord>> {
  const denied = guard(actor, "clinical.write");
  if (denied) return denied;
  return attempt("record_outcome", async () => {
    const patient = await patientInClinic(actor, patientId);
    if (!patient) return notFound();
    const full = { ...input, patientId: patient.id };
    const parsed = OutcomeInputSchema.safeParse(full);
    if (!parsed.success) return fail("invalid", "Some details need checking.", { fieldErrors: fieldErrors(parsed.error) });
    const scored = scoreOutcome(parsed.data.measure, parsed.data.answers);
    if (!scored.ok) return fail("invalid", scored.error);
    if (input.caseId) {
      const c = await getCase(actor.repo(), actor.tenantId, input.caseId);
      if (!c || c.patientId !== patient.id) return fail("invalid", "That case is not part of this record.", { fieldErrors: { caseId: "Choose one of this patient's cases." } });
    }
    if (input.noteId) {
      const n = await getNote(actor.repo(), actor.tenantId, input.noteId);
      if (!n || n.patientId !== patient.id) return fail("invalid", "That note is not part of this record.");
    }
    return ok(await recordOutcome(actor.repo(), actor.tenantId, full, actor.actor));
  });
}

export async function markOutcomeInErrorFor(actor: RecordsActor, patientId: string, outcomeId: string, reason: string): Promise<Result<{ changed: boolean }>> {
  const denied = guard(actor, "clinical.write");
  if (denied) return denied;
  const text = String(reason ?? "").trim();
  if (!text) return fail("invalid", "Give the reason.", { fieldErrors: { reason: "Give the reason." } });
  return attempt("outcome_error", async () => {
    const patient = await patientInClinic(actor, patientId);
    if (!patient || !outcomeId) return notFound();
    const o = await getOutcome(actor.repo(), actor.tenantId, outcomeId);
    if (!o || o.patientId !== patient.id) return notFound();
    return ok({ changed: await markOutcomeInError(actor.repo(), actor.tenantId, o.id, text, actor.actor) });
  });
}
