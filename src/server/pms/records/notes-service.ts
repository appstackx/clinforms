/**
 * Clinical notes for the records screens: list, read (each opening is recorded in the patient's history), start a
 * draft from a template, save, sign and lock, discard, amend a signed note, and the unsigned-notes list.
 * Rules: ./access.ts. Reception (staff) holds none of the clinical permissions, so every function here refuses
 * them BEFORE reading anything.
 *
 *   clinical.view  – list and read notes; the unsigned-notes list (own drafts; all authors' for settings.setup)
 *   clinical.write – start, save, discard and sign one's OWN drafts (the repository checks the author too)
 *   signing and amending also need a registration number on the member's practitioner profile (Khuram, 28/10/2026):
 *   without one the draft is still saved, but signNote / addAmendment are never reached ("registration" failure)
 *   clinical.amend – add an amendment to a signed note: a clinician only to notes they wrote or signed; owners and
 *                    admins holding it to anyone's (mayAmendNote, roles design round 2)
 */
import { mayAmendNote } from "../../../modules/pms/core/permissions";
import { ukToday } from "../../../modules/pms/core/text";
import type { PatientSummary } from "../../../modules/pms/core/types";
import { BodyChartSchema, type BodyChart } from "../../../modules/pms/records/body-chart";
import { AmendmentInputSchema, NoteSectionsSchema, type AmendmentInput } from "../../../modules/pms/records/notes";
import { daysSince, overdueCutoff } from "../../../modules/pms/records/settings";
import type { NoteTemplate } from "../../../modules/pms/records/templates";
import type { Amendment, ClinicalNote, NoteSummary } from "../../../modules/pms/records/types";
import { fieldErrors } from "../../../modules/pms/core/schemas";
import { getCase } from "../../repos/pms/cases";
import { getPatientSummaries } from "../../repos/pms/patients";
import {
  addAmendment,
  countUnsignedNotesByAuthor,
  createNoteDraft,
  discardNoteDraft,
  getNote,
  latestSignedNoteId,
  listNotesForPatient,
  listUnsignedNotes,
  recordNoteView,
  saveNoteDraft,
  setDraftTemplate,
  signNote,
  type UnsignedCount,
} from "../../repos/pms/records/notes";
import { getRecordsSettings } from "../../repos/pms/records/settings";
import { listNoteTemplates } from "../../repos/pms/records/templates";
import { attempt, fail, forbidden, guard, noteAuthorOf, notFound, ok, patientInClinic, registrationFailure, saveFailure, type RecordsActor, type Result } from "./access";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function listNotesFor(actor: RecordsActor, patientId: string, options: { includeDiscarded?: boolean; caseId?: string } = {}): Promise<Result<NoteSummary[]>> {
  const denied = guard(actor, "clinical.view");
  if (denied) return denied;
  return attempt("list_notes", async () => {
    const patient = await patientInClinic(actor, patientId);
    if (!patient) return notFound();
    return ok(await listNotesForPatient(actor.repo(), actor.tenantId, patient.id, { includeDiscarded: options.includeDiscarded === true, caseId: options.caseId }));
  });
}

export interface NoteView {
  note: ClinicalNote;
  /** The member wrote it. */
  mine: boolean;
  /** The member may change it now (their own draft, clinical.write). */
  editable: boolean;
  /** The member may sign it now (their own draft, clinical.write). */
  signable: boolean;
  /** The member may add an amendment (a signed, not anonymised note, clinical.amend – own notes for clinicians). */
  amendable: boolean;
}

/** The member wrote or signed the note. */
function ownNote(actor: RecordsActor, note: ClinicalNote): boolean {
  return note.authorUserId === actor.userId || note.signedByUserId === actor.userId;
}

async function noteOfPatient(actor: RecordsActor, patientId: string, noteId: string): Promise<ClinicalNote | null> {
  const patient = await patientInClinic(actor, patientId);
  if (!patient || typeof noteId !== "string" || !noteId) return null;
  const note = await getNote(actor.repo(), actor.tenantId, noteId);
  return note && note.patientId === patient.id ? note : null;
}

/** One note, decrypted, with its amendments. The opening is recorded in the patient's history. */
export async function getNoteFor(actor: RecordsActor, patientId: string, noteId: string): Promise<Result<NoteView>> {
  const denied = guard(actor, "clinical.view");
  if (denied) return denied;
  return attempt("get_note", async () => {
    const note = await noteOfPatient(actor, patientId, noteId);
    if (!note) return notFound();
    await recordNoteView(actor.repo(), actor.tenantId, note.id, actor.actor);
    const mine = note.authorUserId === actor.userId;
    const draft = note.status === "draft";
    return ok({
      note,
      mine,
      editable: draft && mine && actor.can("clinical.write"),
      signable: draft && mine && actor.can("clinical.write"),
      amendable: note.status === "signed" && !note.anonymisedAt && mayAmendNote(actor.role, actor.can, ownNote(actor, note)),
    });
  });
}

/** The templates a new note can start from (built-in first, then the clinic's own in use). */
export async function templatesForNewNote(actor: RecordsActor): Promise<Result<NoteTemplate[]>> {
  const denied = guard(actor, "clinical.write");
  if (denied) return denied;
  return attempt("note_templates", async () => ok(await listNoteTemplates(actor.repo(), actor.tenantId)));
}

export interface StartNoteInput {
  templateId: string;
  /** The consultation date (YYYY-MM-DD). */
  seenOn: string;
  caseId?: string | null;
  appointmentId?: string | null;
}

/** Starts a draft from a template for the patient; the member is the author. */
export async function startNoteFor(actor: RecordsActor, patientId: string, input: StartNoteInput): Promise<Result<NoteSummary>> {
  const denied = guard(actor, "clinical.write");
  if (denied) return denied;
  if (!ISO_DATE.test(String(input.seenOn ?? ""))) return fail("invalid", "Enter the consultation date.", { fieldErrors: { seenOn: "Enter the consultation date." } });
  if (!input.templateId) return fail("invalid", "Choose a template.", { fieldErrors: { templateId: "Choose a template." } });
  return attempt("start_note", async () => {
    const patient = await patientInClinic(actor, patientId);
    if (!patient) return notFound();
    if (input.caseId) {
      const c = await getCase(actor.repo(), actor.tenantId, input.caseId);
      if (!c || c.patientId !== patient.id) return fail("invalid", "That case is not part of this record.", { fieldErrors: { caseId: "Choose one of this patient's cases." } });
    }
    const author = await noteAuthorOf(actor);
    return ok(
      await createNoteDraft(
        actor.repo(),
        actor.tenantId,
        { patientId: patient.id, caseId: input.caseId ?? null, appointmentId: input.appointmentId ?? null, templateId: input.templateId, seenOn: input.seenOn, practitionerId: author.practitionerId },
        author,
        actor.actor,
      ),
    );
  });
}

export interface SaveNoteInput {
  expectedRev: number;
  sections: Record<string, string>;
  bodyChart?: BodyChart | null;
  seenOn?: string;
  caseId?: string | null;
  /** Sign straight after saving (needs a registration number on the member's profile). */
  sign?: boolean;
}

/**
 * Saves the member's own draft and, when asked, signs it (content locked from then on, fingerprint stored). When the
 * save worked but the signing did not (e.g. an empty note), the failure says so and carries the new revision.
 */
export async function saveNoteFor(actor: RecordsActor, patientId: string, noteId: string, input: SaveNoteInput): Promise<Result<{ rev: number; signed: boolean }>> {
  const denied = guard(actor, "clinical.write");
  if (denied) return denied;
  if (input.seenOn !== undefined && !ISO_DATE.test(input.seenOn)) return fail("invalid", "Enter the consultation date.", { fieldErrors: { seenOn: "Enter the consultation date." } });
  const sections = NoteSectionsSchema.safeParse(input.sections ?? {});
  if (!sections.success) return fail("invalid", "Some sections need checking.", { fieldErrors: fieldErrors(sections.error) });
  let chart: BodyChart | null | undefined = undefined;
  if (input.bodyChart !== undefined) {
    if (input.bodyChart === null) chart = null;
    else {
      const parsed = BodyChartSchema.safeParse(input.bodyChart);
      if (!parsed.success) return fail("invalid", "The body chart could not be read. Reload the page and try again.");
      chart = parsed.data;
    }
  }
  let rev = input.expectedRev;
  let saved = false;
  const result = await attempt("save_note", async () => {
    const note = await noteOfPatient(actor, patientId, noteId);
    if (!note) return notFound();
    if (input.caseId) {
      const c = await getCase(actor.repo(), actor.tenantId, input.caseId);
      if (!c || c.patientId !== note.patientId) return fail("invalid", "That case is not part of this record.", { fieldErrors: { caseId: "Choose one of this patient's cases." } });
    }
    const s = await saveNoteDraft(actor.repo(), actor.tenantId, note.id, input.expectedRev, { sections: input.sections, bodyChart: chart, seenOn: input.seenOn, caseId: input.caseId }, actor.actor);
    if (!s.ok) return saveFailure(s);
    rev = s.rev;
    saved = true;
    if (!input.sign) return ok({ rev, signed: false });
    const signer = await noteAuthorOf(actor);
    const noRegistration = registrationFailure(signer);
    if (noRegistration) return noRegistration;
    const signed = await signNote(actor.repo(), actor.tenantId, note.id, rev, signer, actor.actor);
    if (!signed.ok) return saveFailure(signed);
    return ok({ rev: signed.rev, signed: true });
  });
  if (!result.ok && saved && input.sign) return { ...result, rev, error: `Your changes are saved, but the note is not signed: ${result.error}` };
  return result;
}

/** Switches the member's own draft to another template (text under shared section keys is kept). */
export async function changeNoteTemplateFor(actor: RecordsActor, patientId: string, noteId: string, expectedRev: number, templateId: string): Promise<Result<{ rev: number }>> {
  const denied = guard(actor, "clinical.write");
  if (denied) return denied;
  if (typeof templateId !== "string" || !templateId) return fail("invalid", "Choose a template.", { fieldErrors: { templateId: "Choose a template." } });
  return attempt("note_template_change", async () => {
    const note = await noteOfPatient(actor, patientId, noteId);
    if (!note) return notFound();
    const r = await setDraftTemplate(actor.repo(), actor.tenantId, note.id, expectedRev, templateId, actor.actor);
    return r.ok ? ok({ rev: r.rev }) : saveFailure(r);
  });
}

export interface LastNoteCopy {
  noteId: string;
  seenOn: string;
  templateName: string;
  /** Section key → text (the editor fills the sections the current note shares). */
  sections: Record<string, string>;
}

/**
 * "Copy from last note": the text of the patient's latest signed note other than this one (decrypted – the
 * opening is recorded in the patient's history, like any note read). null when there is none.
 */
export async function lastNoteForCopyFor(actor: RecordsActor, patientId: string, excludeNoteId?: string): Promise<Result<LastNoteCopy | null>> {
  const denied = guard(actor, "clinical.write");
  if (denied) return denied;
  return attempt("copy_last_note", async () => {
    const patient = await patientInClinic(actor, patientId);
    if (!patient) return notFound();
    const id = await latestSignedNoteId(actor.repo(), actor.tenantId, patient.id, excludeNoteId);
    if (!id) return ok(null);
    const note = await getNote(actor.repo(), actor.tenantId, id);
    if (!note || note.patientId !== patient.id) return ok(null);
    await recordNoteView(actor.repo(), actor.tenantId, note.id, actor.actor);
    return ok({ noteId: note.id, seenOn: note.seenOn, templateName: note.templateName, sections: note.sections });
  });
}

/** Signs the member's own draft as it was last saved. */
export async function signNoteFor(actor: RecordsActor, patientId: string, noteId: string, expectedRev: number): Promise<Result<{ rev: number }>> {
  const denied = guard(actor, "clinical.write");
  if (denied) return denied;
  return attempt("sign_note", async () => {
    const note = await noteOfPatient(actor, patientId, noteId);
    if (!note) return notFound();
    const signer = await noteAuthorOf(actor);
    const noRegistration = registrationFailure(signer);
    if (noRegistration) return noRegistration;
    const signed = await signNote(actor.repo(), actor.tenantId, note.id, expectedRev, signer, actor.actor);
    return signed.ok ? ok({ rev: signed.rev }) : saveFailure(signed);
  });
}

/** Throws the member's own draft away (kept, hidden by default). */
export async function discardNoteFor(actor: RecordsActor, patientId: string, noteId: string, expectedRev: number): Promise<Result<{ rev: number }>> {
  const denied = guard(actor, "clinical.write");
  if (denied) return denied;
  return attempt("discard_note", async () => {
    const note = await noteOfPatient(actor, patientId, noteId);
    if (!note) return notFound();
    const r = await discardNoteDraft(actor.repo(), actor.tenantId, note.id, expectedRev, actor.actor);
    return r.ok ? ok({ rev: r.rev }) : saveFailure(r);
  });
}

/** Adds an amendment (addendum, correction of a section, or "entered in error") to a signed note; the original stays. */
export async function amendNoteFor(actor: RecordsActor, patientId: string, noteId: string, input: AmendmentInput): Promise<Result<Amendment>> {
  const denied = guard(actor, "clinical.amend");
  if (denied) return denied;
  const parsed = AmendmentInputSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", "Some details need checking.", { fieldErrors: fieldErrors(parsed.error) });
  return attempt("amend_note", async () => {
    const note = await noteOfPatient(actor, patientId, noteId);
    if (!note) return notFound();
    if (!mayAmendNote(actor.role, actor.can, ownNote(actor, note))) return forbidden();
    const signer = await noteAuthorOf(actor);
    const noRegistration = registrationFailure(signer);
    if (noRegistration) return noRegistration;
    return ok(await addAmendment(actor.repo(), actor.tenantId, note.id, input, signer, actor.actor));
  });
}

/* ------------------------------------------------------------------------------------------------
 * Unsigned notes (K2-NOTE-008)
 * ----------------------------------------------------------------------------------------------*/

export interface UnsignedNote extends NoteSummary {
  patient: Pick<PatientSummary, "id" | "patientNumber" | "firstName" | "lastName" | "preferredName"> | null;
  daysSinceSeen: number;
  overdue: boolean;
}

export interface UnsignedNotesView {
  /** Days after which a draft counts as overdue (the clinic's setting). */
  days: number;
  cutoff: string;
  /** "mine" for a clinician; "all" for an owner/administrator who asked for every author. */
  scope: "mine" | "all";
  notes: UnsignedNote[];
  counts: UnsignedCount[];
}

/**
 * The unsigned-notes list: a clinician's own drafts, or – for owners/administrators (settings.setup) – every
 * author's, with a count per author and the overdue ones (consultation N or more days ago, N per clinic) flagged.
 */
export async function unsignedNotesFor(actor: RecordsActor, options: { scope?: "mine" | "all"; overdueOnly?: boolean; limit?: number } = {}): Promise<Result<UnsignedNotesView>> {
  const denied = guard(actor, "clinical.view");
  if (denied) return denied;
  const scope = options.scope === "all" ? "all" : "mine";
  if (scope === "all" && !actor.can("settings.setup")) return forbidden();
  return attempt("unsigned_notes", async () => {
    const ctx = actor.repo();
    const today = ukToday(ctx.now ? ctx.now() : new Date());
    const { unsignedNoteDays: days } = await getRecordsSettings(ctx, actor.tenantId);
    const cutoff = overdueCutoff(today, days);
    const author = scope === "mine" ? actor.userId : undefined;
    const [notes, counts] = await Promise.all([
      listUnsignedNotes(ctx, actor.tenantId, { authorUserId: author, seenOnOrBefore: options.overdueOnly ? cutoff : undefined, limit: options.limit }),
      countUnsignedNotesByAuthor(ctx, actor.tenantId, { overdueOnOrBefore: cutoff, authorUserId: author }),
    ]);
    const patients = await getPatientSummaries(ctx, actor.tenantId, Array.from(new Set(notes.map((n) => n.patientId))));
    return ok({
      days,
      cutoff,
      scope,
      counts,
      notes: notes.map((n) => {
        const p = patients.get(n.patientId);
        return {
          ...n,
          patient: p ? { id: p.id, patientNumber: p.patientNumber, firstName: p.firstName, lastName: p.lastName, preferredName: p.preferredName } : null,
          daysSinceSeen: daysSince(n.seenOn, today),
          overdue: n.seenOn <= cutoff,
        };
      }),
    });
  });
}
