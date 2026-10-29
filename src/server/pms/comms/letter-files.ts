/**
 * Letters as files, and the discharge letter from a discharge note – the server functions the letter routes and
 * the note page call. Same rules as ./views.ts and ./writes.ts: the permission FIRST (messages.letters – reception
 * can never have it; the discharge letter also clinical.view, since it reads a clinical note), every id read back
 * from the member's own clinic and site scope, plain answers.
 */
import "server-only";
import { z } from "zod";
import { STANDARD_PREFIX } from "../../../modules/pms/comms/defaults";
import { PmsIdSchema } from "../../../modules/pms/core/schemas";
import { isPlausibleRecordId } from "../../../modules/pms/records/form-values";
import { pmsAudit } from "../../repos/pms/context";
import { listLetterTemplates } from "../../repos/pms/comms/letters";
import { findPractitionerByUser } from "../../repos/pms/directory";
import { getNote } from "../../repos/pms/records/notes";
import { attempt, fail, forbidden, notFound, ok, patientInClinic, type Result } from "../records/access";
import { DOCX_MIME, renderLetterDocx, renderLetterPdf, type LetterDocument } from "./letter-output";
import { latestOutcomesText, startLetter } from "./letters";
import { letterFor, type CommsActor } from "./views";

export type LetterFileFormat = "docx" | "pdf";

export interface LetterFile {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}

/**
 * The letter as a Word or PDF file (messages.letters; the letter in the member's sites). Each download is recorded
 * in the audit trail (ids and the format only – never the letter's text).
 */
export async function letterFileFor(actor: CommsActor, letterId: unknown, format: LetterFileFormat): Promise<Result<LetterFile>> {
  if (!actor.can("messages.letters")) return forbidden();
  const r = await letterFor(actor, letterId);
  if (!r.ok) return r;
  return attempt("comms.letter_file", async () => {
    const { letter: l, clinic } = r.value;
    const doc: LetterDocument = {
      clinic,
      letterOn: l.letterOn,
      recipient: { name: l.recipientName, address: l.recipientAddress, postcode: l.recipientPostcode },
      subject: l.subject,
      body: l.body,
      signature: l.signatureText,
      draft: l.status === "draft",
      withdrawn: l.status === "void",
    };
    const bytes = format === "docx" ? renderLetterDocx(doc) : await renderLetterPdf(doc);
    await pmsAudit(actor.repo(), actor.tenantId, actor.actor, { action: "pms.letter.download", targetType: "pms_letter", targetId: l.id, detail: { format, status: l.status } });
    return ok({ fileName: `letter-${l.id}.${format}`, mimeType: format === "docx" ? DOCX_MIME : "application/pdf", bytes });
  });
}

/* ------------------------------------------------------------------------------------------------
 * Discharge letter from the discharge note (K2-LTR-006)
 * ----------------------------------------------------------------------------------------------*/

/** The discharge template's gaps the note fills (the standard "Discharge letter to the GP"; a clinic's copy keeps them). */
const OUTCOME_GAP = /\[\[[^\]]*(progress|outcome)[^\]]*\]\]/i;
const ADVICE_GAP = /\[\[[^\]]*(advice|exercise|home programme)[^\]]*\]\]/i;

/** Pure: writes a discharge note's sections into the template's gaps (a section left empty keeps its gap). */
export function fillDischargeGaps(body: string, sections: Readonly<Record<string, string>>, outcomes: string): string {
  const clean = (t: string | undefined) => (t ?? "").trim();
  const outcome = [clean(sections.reason) ? `Reason for discharge: ${clean(sections.reason)}` : "", clean(sections.summary), clean(sections.outcome), outcomes ? `Outcome measures: ${outcomes}` : ""].filter(Boolean).join("\n\n");
  const advice = [clean(sections.advice), clean(sections.onward)].filter(Boolean).join("\n\n");
  let out = body;
  if (outcome) out = out.replace(OUTCOME_GAP, () => outcome);
  if (advice) out = out.replace(ADVICE_GAP, () => advice);
  return out;
}

const DischargeSchema = z.object({ patientId: PmsIdSchema, noteId: PmsIdSchema });

/**
 * Starts the discharge letter to the GP from a SIGNED discharge note: the clinic's own active discharge template
 * to the GP (else the standard one), for the note's case, with the note's summary, outcome and advice written into
 * the template's gaps and the case's outcome scores. messages.letters AND clinical.view.
 */
export async function startDischargeLetterFor(actor: CommsActor, input: unknown): Promise<Result<{ id: string }>> {
  if (!actor.can("messages.letters") || !actor.can("clinical.view")) return forbidden();
  const parsed = DischargeSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", "Open the discharge note again.");
  return attempt("comms.discharge_letter", async () => {
    const ctx = actor.repo();
    const p = await patientInClinic(actor, parsed.data.patientId);
    if (!p || !isPlausibleRecordId(parsed.data.noteId)) return notFound();
    const note = await getNote(ctx, actor.tenantId, parsed.data.noteId);
    if (!note || note.patientId !== p.id || note.enteredInError) return notFound();
    if (note.noteType !== "discharge" || note.status !== "signed") return fail("invalid", "A discharge letter is written from a signed discharge note.");
    const templates = await listLetterTemplates(ctx, actor.tenantId);
    const own = templates.find((t) => t.active && !t.standard && t.recipientKind === "gp" && /discharge/i.test(t.name));
    const templateId = own?.id ?? `${STANDARD_PREFIX}gp-discharge`;
    const outcomes = await latestOutcomesText(ctx, actor.tenantId, p.id, note.caseId);
    const me = await findPractitionerByUser(ctx, actor.tenantId, actor.userId);
    const letter = await startLetter(
      ctx,
      actor.tenantId,
      {
        patientId: p.id,
        templateId,
        caseId: note.caseId,
        practitionerId: me?.id ?? note.practitionerId ?? null,
        recipientKind: "gp",
        bodyFill: (body) => fillDischargeGaps(body, note.sections, outcomes),
      },
      actor.actor,
      actor.name,
    );
    return ok({ id: letter.id });
  });
}
