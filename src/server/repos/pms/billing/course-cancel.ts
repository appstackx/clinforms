/**
 * Cancelling a patient's course (PK02): the course closes and the unused sessions are credited on the line that sold
 * it – pro rata by default (sale line × unused ÷ sessions), any amount up to what is left on the line – by an
 * ordinary credit note in ONE batch with the course's change. Nothing is credited when there is nothing to credit
 * (a £0 course, a line already credited, a draft never issued). Its own file: it needs both the courses and the
 * credit-note repositories.
 */
import { sql } from "kysely";
import { CancelCourseInputSchema, proRataCredit, type CancelCourseInput, type PatientCourse } from "../../../../modules/pms/billing/courses";
import type { CreditNote } from "../../../../modules/pms/billing/types";
import type { PmsActor } from "../../../../modules/pms/core/types";
import { RepoInputError, assertId, assertTenantId, nowIso, parseInput, type RepoContext } from "../context";
import { COURSES, getPatientCourse } from "./courses";
import { issueCreditNote } from "./credit-notes";
import { getInvoice } from "./invoices";
import { affected, billingAuditWhen, billingBatch } from "./shared";

export interface CancelCourseResult {
  course: PatientCourse;
  creditNote: CreditNote | null;
}

/** What cancelling would credit by default, and the most it can credit (for the form). */
export async function courseCancelQuote(ctx: RepoContext, tenantId: string, courseId: string): Promise<{ defaultPence: number; maxPence: number } | null> {
  const course = await getPatientCourse(ctx, tenantId, courseId);
  if (!course) return null;
  const inv = await getInvoice(ctx, tenantId, course.saleInvoiceId);
  const line = inv?.lines.find((l) => l.id === course.saleLineId);
  if (!inv || !line || inv.status !== "issued" || inv.voidedAt) return { defaultPence: 0, maxPence: 0 };
  return { defaultPence: proRataCredit(line, course.sessionsTotal, course.sessionsUsed), maxPence: Math.max(0, line.totalPence - line.creditedPence) };
}

export async function cancelPatientCourse(ctx: RepoContext, tenantId: string, courseId: string, input: CancelCourseInput, actor: PmsActor): Promise<CancelCourseResult> {
  assertTenantId(tenantId);
  assertId(courseId, "course id");
  const d = parseInput(CancelCourseInputSchema, input, "Cancel course");
  const course = await getPatientCourse(ctx, tenantId, courseId);
  if (!course) throw new RepoInputError("That course does not exist in this clinic.");
  if (course.status === "cancelled") throw new RepoInputError("That course is already cancelled.");
  const inv = await getInvoice(ctx, tenantId, course.saleInvoiceId);
  const line = inv?.lines.find((l) => l.id === course.saleLineId);
  const creditable = inv && line && inv.status === "issued" && !inv.voidedAt ? Math.max(0, line.totalPence - line.creditedPence) : 0;
  const amount = d.creditPence ?? (line ? Math.min(creditable, proRataCredit(line, course.sessionsTotal, course.sessionsUsed)) : 0);
  if (amount > creditable) throw new RepoInputError(`Cancel course: creditPence: At most ${creditable} pence is left to credit on the course's invoice line.`);
  const t = tenantId;
  const audit = (creditNoteId: string | null, at: string) =>
    billingAuditWhen(
      ctx,
      t,
      actor,
      { action: "pms.course.cancel", targetType: "pms_patient_course", targetId: courseId, detail: { creditNoteId, creditPence: amount, sessionsUsed: course.sessionsUsed, sessionsTotal: course.sessionsTotal } },
      ctx.db.selectFrom(COURSES).select("id").where("tenant_id", "=", t).where("id", "=", courseId).where("status", "=", "cancelled").where("cancelled_at", "=", at),
    );
  const close = (creditNoteId: string | null, at: string) =>
    ctx.db
      .updateTable(COURSES)
      .set((eb) => ({ status: "cancelled", cancelled_at: at, cancel_credit_note_id: creditNoteId, rev: eb("rev", "+", 1), updated_at: at }))
      .where("tenant_id", "=", t)
      .where("id", "=", courseId)
      .where("status", "<>", "cancelled");

  if (amount === 0 || !inv || !line) {
    const at = nowIso(ctx);
    const results = await billingBatch(ctx, [close(null, at), audit(null, at)]);
    if (affected(results[0]) === 0) throw new RepoInputError("That course is already cancelled.");
    return { course: (await getPatientCourse(ctx, t, courseId)) as PatientCourse, creditNote: null };
  }
  const creditNote = await issueCreditNote(
    ctx,
    t,
    inv,
    [{ invoiceLineId: line.id, totalPence: amount }],
    {
      kind: "credit",
      reason: d.reason,
      detail: { patientCourseId: courseId },
      extraRefusal: "That course was cancelled or changed meanwhile. Reload the page.",
      extra: (creditNoteId, at) => [
        close(creditNoteId, at),
        // Refused (NULL into a NOT NULL column, the whole credit note rolled back) unless THIS call closed the course.
        ctx.db
          .updateTable(COURSES)
          .set({ sessions_total: sql<number>`case when cancel_credit_note_id = ${creditNoteId} then sessions_total else null end` })
          .where("tenant_id", "=", t)
          .where("id", "=", courseId),
        audit(creditNoteId, at),
      ],
    },
    actor,
  );
  return { course: (await getPatientCourse(ctx, t, courseId)) as PatientCourse, creditNote };
}
