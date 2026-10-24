/**
 * `pms_clinical_notes` + `pms_note_amendments` – clinical notes with sign and lock (rules:
 * src/modules/pms/records/notes.ts).
 *
 * - The note's text (one entry per template section) and its body chart are encrypted (sections_enc,
 *   body_chart_enc); lists return summaries and never decrypt.
 * - Only the author edits or signs a draft: every write names author_user_id, status and rev in its WHERE clause,
 *   so a stale form, another member or a signed note changes nothing.
 * - Signing stores a sha256 fingerprint of the canonical content and the signer's name and registration number
 *   as they were then. After signing the content is locked – here, and by a database trigger (migration 0121).
 * - Amendments are inserted, never changed (trigger too), in the same atomic batch as the note's amendment count
 *   and the audit row.
 * - Nothing here deletes: drafts are discarded (kept), signed notes are marked "entered in error" by an amendment.
 */
import { createHash } from "node:crypto";
import type { Selectable } from "kysely";
import { RECORDS_ID_PREFIXES as P } from "../../../../modules/pms/records/ids";
import { BodyChartSchema, normaliseChart, parseBodyChart, type BodyChart } from "../../../../modules/pms/records/body-chart";
import {
  AmendmentInputSchema,
  NoteContentSchema,
  NoteDraftInputSchema,
  canSign,
  canonicalNoteContent,
  noteHasContent,
  sectionsForTemplate,
  type AmendmentInput,
  type AmendmentKind,
  type NoteContentInput,
  type NoteDraftInput,
  type NoteStatus,
} from "../../../../modules/pms/records/notes";
import { parseSnapshot, toSnapshot, type NoteType, type TemplateSnapshot } from "../../../../modules/pms/records/templates";
import type { Amendment, ClinicalNote, NoteSummary } from "../../../../modules/pms/records/types";
import { ukToday } from "../../../../modules/pms/core/text";
import type { PmsActor, PmsSaveResult } from "../../../../modules/pms/core/types";
import { classifyDbError } from "../../../db/errors";
import type { PmsClinicalNotesTable, PmsNoteAmendmentsTable } from "../../../db/pms-schema/records";
import {
  RepoInputError,
  assertActor,
  assertId,
  assertTenantId,
  decryptField,
  encryptField,
  guarded,
  isOn,
  nowIso,
  num,
  parseInput,
  pmsAudit,
  pmsAuditQuery,
  pmsId,
  writeWithAudit,
  type RepoContext,
} from "../context";
import { getNoteTemplate } from "./templates";

const N = "pms_clinical_notes";
const AM = "pms_note_amendments";
const MESSAGES = {
  unique: "A note with this import reference already exists.",
  foreignKey: "The patient, case or practitioner does not exist in this clinic (a note's case must be the same patient's).",
};
/** The database trigger's words (migration 0121) → a plain message. */
const LOCKED = /is locked/i;

type NoteRow = Selectable<PmsClinicalNotesTable>;
type AmendmentRow = Selectable<PmsNoteAmendmentsTable>;

const SUMMARY_COLUMNS = [
  "tenant_id",
  "id",
  "rev",
  "patient_id",
  "case_id",
  "template_id",
  "template_name",
  "note_type",
  "seen_on",
  "practitioner_id",
  "author_user_id",
  "author_name",
  "status",
  "signed_at",
  "signed_by_name",
  "entered_in_error",
  "amendment_count",
  "created_at",
  "updated_at",
] as const;

function toSummary(r: Pick<NoteRow, (typeof SUMMARY_COLUMNS)[number]>): NoteSummary {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    rev: num(r.rev),
    patientId: r.patient_id,
    caseId: r.case_id,
    templateId: r.template_id,
    templateName: r.template_name,
    noteType: r.note_type as NoteType,
    seenOn: r.seen_on,
    practitionerId: r.practitioner_id,
    authorUserId: r.author_user_id,
    authorName: r.author_name,
    status: r.status as NoteStatus,
    signedAt: r.signed_at,
    signedByName: r.signed_by_name,
    enteredInError: isOn(r.entered_in_error),
    amendmentCount: num(r.amendment_count),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function decryptSections(ctx: RepoContext, r: NoteRow): Record<string, string> {
  const json = decryptField(ctx, r.tenant_id, N, "sections_enc", r.id, r.sections_enc);
  if (!json) return {};
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function decryptChart(ctx: RepoContext, r: NoteRow): BodyChart | null {
  return parseBodyChart(decryptField(ctx, r.tenant_id, N, "body_chart_enc", r.id, r.body_chart_enc));
}

function toAmendment(ctx: RepoContext, r: AmendmentRow): Amendment {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    noteId: r.note_id,
    kind: r.kind as AmendmentKind,
    sectionKey: r.section_key,
    text: decryptField(ctx, r.tenant_id, AM, "text_enc", r.id, r.text_enc),
    reason: decryptField(ctx, r.tenant_id, AM, "reason_enc", r.id, r.reason_enc),
    authorUserId: r.author_user_id,
    authorName: r.author_name,
    authorRegistration: r.author_registration,
    createdAt: r.created_at,
  };
}

function fallbackSnapshot(r: NoteRow): TemplateSnapshot {
  return { id: r.template_id, name: r.template_name, noteType: r.note_type as NoteType, sections: [], bodyChart: false };
}

/** The person writing or signing: their name (and registration number, when they are a practitioner) as of now. */
export interface NoteAuthor {
  name: string;
  registration?: string | null;
}

function authorName(author: NoteAuthor): string {
  const name = String(author?.name ?? "").trim();
  if (!name || name.length > 120) throw new RepoInputError("The author's name is missing.");
  return name;
}

function registration(author: NoteAuthor): string | null {
  const r = author?.registration;
  return typeof r === "string" && /^[A-Z0-9-]{3,20}$/.test(r) ? r : null;
}

function encryptChart(ctx: RepoContext, tenantId: string, id: string, chart: BodyChart | null | undefined): string | null {
  if (!chart || chart.markers.length === 0) return null;
  return encryptField(ctx, tenantId, N, "body_chart_enc", id, JSON.stringify(normaliseChart(chart)));
}

function encryptSections(ctx: RepoContext, tenantId: string, id: string, sections: Record<string, string>): string | null {
  return Object.keys(sections).length === 0 ? null : encryptField(ctx, tenantId, N, "sections_enc", id, JSON.stringify(sections));
}

/* ------------------------------------------------------------------------------------------------
 * Drafts
 * ----------------------------------------------------------------------------------------------*/

/** Starts a draft note for a patient from a template (built-in or the clinic's own). */
export async function createNoteDraft(ctx: RepoContext, tenantId: string, input: NoteDraftInput, author: NoteAuthor, actor: PmsActor): Promise<NoteSummary> {
  assertTenantId(tenantId);
  const who = assertActor(actor);
  if (!who.userId) throw new RepoInputError("A note needs a signed-in author.");
  const d = parseInput(NoteDraftInputSchema, input, "Note");
  const template = await getNoteTemplate(ctx, tenantId, d.templateId);
  if (!template || !template.active) throw new RepoInputError("Choose a template that is in use.");
  const id = pmsId(P.note, ctx);
  const at = nowIso(ctx);
  await writeWithAudit(
    ctx,
    [
      ctx.db.insertInto(N).values({
        tenant_id: tenantId,
        id,
        rev: 1,
        patient_id: d.patientId,
        case_id: d.caseId ?? null,
        template_id: template.id,
        template_name: template.name,
        note_type: template.noteType,
        template_json: JSON.stringify(toSnapshot(template)),
        seen_on: d.seenOn,
        practitioner_id: d.practitionerId ?? null,
        author_user_id: who.userId,
        author_name: authorName(author),
        status: "draft",
        sections_enc: null,
        body_chart_enc: null,
        content_hash: null,
        signed_at: null,
        signed_by_user_id: null,
        signed_by_name: null,
        signed_registration: null,
        entered_in_error: 0,
        amendment_count: 0,
        discarded_at: null,
        anonymised_at: null,
        import_ref: d.importRef ?? null,
        created_at: at,
        updated_at: at,
      }),
      pmsAuditQuery(ctx, tenantId, who, { action: "pms.note.create", targetType: "pms_note", targetId: id, detail: { patientId: d.patientId, templateId: template.id, noteType: template.noteType } }),
    ],
    MESSAGES,
  );
  const row = await ctx.db.selectFrom(N).select(SUMMARY_COLUMNS).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirstOrThrow();
  return toSummary(row);
}

/** Saves a draft's text, body chart, case and date. Only the author, only while it is a draft, revision-checked. */
export async function saveNoteDraft(ctx: RepoContext, tenantId: string, id: string, expectedRev: number, content: NoteContentInput, actor: PmsActor): Promise<PmsSaveResult> {
  assertTenantId(tenantId);
  assertId(id, "note id");
  const who = assertActor(actor);
  if (!Number.isInteger(expectedRev) || expectedRev < 1) throw new RepoInputError("expectedRev must be a positive whole number.");
  const d = parseInput(NoteContentSchema, content, "Note");
  const row = await ctx.db.selectFrom(N).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status !== "draft") throw new RepoInputError(row.status === "signed" ? "This note is signed and locked. Add an amendment instead." : "This draft was discarded.");
  if (!who.userId || row.author_user_id !== who.userId) throw new RepoInputError("Only the note's author can change a draft.");
  if (num(row.rev) !== expectedRev) return { ok: false, reason: "conflict", currentRev: num(row.rev) };
  const template = parseSnapshot(row.template_json) ?? fallbackSnapshot(row);
  const sections = sectionsForTemplate(template, d.sections);
  const chart = template.bodyChart && d.bodyChart ? parseInput(BodyChartSchema, d.bodyChart, "Body chart") : null;
  const at = nowIso(ctx);
  const set: Record<string, unknown> = {
    sections_enc: encryptSections(ctx, tenantId, id, sections),
    body_chart_enc: encryptChart(ctx, tenantId, id, chart),
    rev: expectedRev + 1,
    updated_at: at,
  };
  if (d.seenOn !== undefined) set.seen_on = d.seenOn;
  if (d.caseId !== undefined) set.case_id = d.caseId;
  const result = await guarded(
    () =>
      ctx.db
        .updateTable(N)
        .set(set)
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id)
        .where("rev", "=", expectedRev)
        .where("status", "=", "draft")
        .where("author_user_id", "=", who.userId as string)
        .executeTakeFirst(),
    MESSAGES,
  );
  if (Number(result.numUpdatedRows) === 0) {
    const now = await ctx.db.selectFrom(N).select("rev").where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
    return now ? { ok: false, reason: "conflict", currentRev: num(now.rev) } : { ok: false, reason: "not_found" };
  }
  await pmsAudit(ctx, tenantId, who, {
    action: "pms.note.save",
    targetType: "pms_note",
    targetId: id,
    detail: { rev: expectedRev + 1, sections: Object.keys(sections).length, markers: chart?.markers.length ?? 0 },
  });
  return { ok: true, rev: expectedRev + 1, updatedAt: at };
}

/** Throws the draft away (kept, hidden by default). Only the author, only a draft. */
export async function discardNoteDraft(ctx: RepoContext, tenantId: string, id: string, expectedRev: number, actor: PmsActor): Promise<PmsSaveResult> {
  assertTenantId(tenantId);
  assertId(id, "note id");
  const who = assertActor(actor);
  const at = nowIso(ctx);
  const result = await ctx.db
    .updateTable(N)
    .set({ status: "discarded", discarded_at: at, rev: expectedRev + 1, updated_at: at })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .where("rev", "=", expectedRev)
    .where("status", "=", "draft")
    .where("author_user_id", "=", who.userId ?? "")
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) === 0) {
    const now = await ctx.db.selectFrom(N).select(["rev", "status", "author_user_id"]).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
    if (!now) return { ok: false, reason: "not_found" };
    if (now.status !== "draft") throw new RepoInputError("Only a draft can be discarded.");
    if (now.author_user_id !== who.userId) throw new RepoInputError("Only the note's author can discard a draft.");
    return { ok: false, reason: "conflict", currentRev: num(now.rev) };
  }
  await pmsAudit(ctx, tenantId, who, { action: "pms.note.discard", targetType: "pms_note", targetId: id, detail: { rev: expectedRev + 1 } });
  return { ok: true, rev: expectedRev + 1, updatedAt: at };
}

/* ------------------------------------------------------------------------------------------------
 * Sign and lock
 * ----------------------------------------------------------------------------------------------*/

export function noteFingerprint(templateId: string, seenOn: string, sections: Record<string, string>, chart: BodyChart | null): string {
  return createHash("sha256").update(canonicalNoteContent({ templateId, seenOn, sections, bodyChart: chart }), "utf8").digest("hex");
}

/**
 * Signs a draft: the content is locked from now on. The signer must be the author; the note must hold something;
 * the consultation date may not be in the future. Revision-checked (sign exactly what the author last saw).
 */
export async function signNote(ctx: RepoContext, tenantId: string, id: string, expectedRev: number, signer: NoteAuthor, actor: PmsActor): Promise<PmsSaveResult> {
  assertTenantId(tenantId);
  assertId(id, "note id");
  const who = assertActor(actor);
  const row = await ctx.db.selectFrom(N).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  if (!row) return { ok: false, reason: "not_found" };
  if (num(row.rev) !== expectedRev) return { ok: false, reason: "conflict", currentRev: num(row.rev) };
  const sections = decryptSections(ctx, row);
  const chart = decryptChart(ctx, row);
  const today = ukToday(ctx.now ? ctx.now() : new Date());
  const check = canSign({ status: row.status as NoteStatus, authorUserId: row.author_user_id, seenOn: row.seen_on }, who.userId, today, noteHasContent(sections, chart));
  if (!check.ok) throw new RepoInputError(check.error);
  const hash = noteFingerprint(row.template_id, row.seen_on, sections, chart);
  const at = nowIso(ctx);
  const result = await ctx.db
    .updateTable(N)
    .set({
      status: "signed",
      signed_at: at,
      signed_by_user_id: who.userId,
      signed_by_name: authorName(signer),
      signed_registration: registration(signer),
      content_hash: hash,
      rev: expectedRev + 1,
      updated_at: at,
    })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .where("rev", "=", expectedRev)
    .where("status", "=", "draft")
    .where("author_user_id", "=", who.userId as string)
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) === 0) {
    const now = await ctx.db.selectFrom(N).select("rev").where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
    return now ? { ok: false, reason: "conflict", currentRev: num(now.rev) } : { ok: false, reason: "not_found" };
  }
  await pmsAudit(ctx, tenantId, who, { action: "pms.note.sign", targetType: "pms_note", targetId: id, detail: { rev: expectedRev + 1, sections: Object.keys(sections).length } });
  return { ok: true, rev: expectedRev + 1, updatedAt: at };
}

/* ------------------------------------------------------------------------------------------------
 * Amendments (signed notes only)
 * ----------------------------------------------------------------------------------------------*/

/** Adds an amendment to a signed note (locked as soon as it is written). Returns the amendment. */
export async function addAmendment(ctx: RepoContext, tenantId: string, noteId: string, input: AmendmentInput, author: NoteAuthor, actor: PmsActor): Promise<Amendment> {
  assertTenantId(tenantId);
  assertId(noteId, "note id");
  const who = assertActor(actor);
  if (!who.userId) throw new RepoInputError("An amendment needs a signed-in author.");
  const d = parseInput(AmendmentInputSchema, input, "Amendment");
  const note = await ctx.db
    .selectFrom(N)
    .select(["patient_id", "status", "template_json", "template_id", "template_name", "note_type", "entered_in_error", "anonymised_at"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", noteId)
    .executeTakeFirst();
  if (!note) throw new RepoInputError("The note does not exist in this clinic.");
  if (note.status !== "signed") throw new RepoInputError("Only a signed note is amended. Change the draft instead.");
  if (note.anonymised_at) throw new RepoInputError("This record has been anonymised.");
  if (d.kind === "entered_in_error" && isOn(note.entered_in_error)) throw new RepoInputError("This note is already marked as entered in error.");
  const template = parseSnapshot(note.template_json);
  if (d.sectionKey && !(template?.sections ?? []).some((s) => s.key === d.sectionKey)) throw new RepoInputError("That section is not part of this note.");
  const id = pmsId(P.amendment, ctx);
  const at = nowIso(ctx);
  await writeWithAudit(
    ctx,
    [
      ctx.db.insertInto(AM).values({
        tenant_id: tenantId,
        id,
        note_id: noteId,
        patient_id: note.patient_id,
        kind: d.kind,
        section_key: d.sectionKey ?? null,
        text_enc: encryptField(ctx, tenantId, AM, "text_enc", id, d.text || null),
        reason_enc: encryptField(ctx, tenantId, AM, "reason_enc", id, d.reason),
        author_user_id: who.userId,
        author_name: authorName(author),
        author_registration: registration(author),
        anonymised_at: null,
        created_at: at,
      }),
      ctx.db
        .updateTable(N)
        .set((eb) => ({
          amendment_count: eb("amendment_count", "+", 1),
          entered_in_error: d.kind === "entered_in_error" ? 1 : eb.ref("entered_in_error"),
          rev: eb("rev", "+", 1),
          updated_at: at,
        }))
        .where("tenant_id", "=", tenantId)
        .where("id", "=", noteId)
        .where("status", "=", "signed"),
      pmsAuditQuery(ctx, tenantId, who, { action: "pms.note.amend", targetType: "pms_note", targetId: noteId, detail: { amendmentId: id, kind: d.kind, sectionKey: d.sectionKey ?? null } }),
    ],
    MESSAGES,
  );
  const row = await ctx.db.selectFrom(AM).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirstOrThrow();
  return toAmendment(ctx, row);
}

/* ------------------------------------------------------------------------------------------------
 * Reads
 * ----------------------------------------------------------------------------------------------*/

/** One note, decrypted, with its amendments (oldest first). */
export async function getNote(ctx: RepoContext, tenantId: string, id: string): Promise<ClinicalNote | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom(N).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  if (!row) return null;
  const amendments = await ctx.db.selectFrom(AM).selectAll().where("tenant_id", "=", tenantId).where("note_id", "=", id).orderBy("id").limit(500).execute();
  return {
    ...toSummary(row),
    template: parseSnapshot(row.template_json) ?? fallbackSnapshot(row),
    sections: decryptSections(ctx, row),
    bodyChart: decryptChart(ctx, row),
    signedByUserId: row.signed_by_user_id,
    signedRegistration: row.signed_registration,
    contentHash: row.content_hash,
    anonymisedAt: row.anonymised_at,
    importRef: row.import_ref,
    amendments: amendments.map((a) => toAmendment(ctx, a)),
  };
}

export interface ListNotesOptions {
  includeDiscarded?: boolean;
  caseId?: string;
  /** Default 200, at most 500. */
  limit?: number;
}

/** A patient's notes, newest consultation first (summaries – nothing decrypted). */
export async function listNotesForPatient(ctx: RepoContext, tenantId: string, patientId: string, options: ListNotesOptions = {}): Promise<NoteSummary[]> {
  assertTenantId(tenantId);
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 200)), 500);
  let q = ctx.db.selectFrom(N).select(SUMMARY_COLUMNS).where("tenant_id", "=", tenantId).where("patient_id", "=", patientId);
  if (!options.includeDiscarded) q = q.where("status", "!=", "discarded");
  if (options.caseId) q = q.where("case_id", "=", options.caseId);
  const rows = await q.orderBy("seen_on", "desc").orderBy("id", "desc").limit(limit).execute();
  return rows.map(toSummary);
}

/** The signed-in member's own drafts (oldest first: the ones to finish). */
export async function listDraftsByAuthor(ctx: RepoContext, tenantId: string, userId: string, limit = 50): Promise<NoteSummary[]> {
  assertTenantId(tenantId);
  const rows = await ctx.db
    .selectFrom(N)
    .select(SUMMARY_COLUMNS)
    .where("tenant_id", "=", tenantId)
    .where("author_user_id", "=", userId)
    .where("status", "=", "draft")
    .orderBy("id")
    .limit(Math.min(Math.max(1, limit), 200))
    .execute();
  return rows.map(toSummary);
}

/** The latest consultation date of a signed note (record-keeping: the last treatment). */
export async function lastSignedNoteDate(ctx: RepoContext, tenantId: string, patientId: string): Promise<string | null> {
  assertTenantId(tenantId);
  const row = await ctx.db
    .selectFrom(N)
    .select((eb) => eb.fn.max("seen_on").as("last"))
    .where("tenant_id", "=", tenantId)
    .where("patient_id", "=", patientId)
    .where("status", "=", "signed")
    .executeTakeFirst();
  return (row?.last as string | null | undefined) ?? null;
}

/** Records that a member opened a note (the patient's history shows who read the clinical record). */
export async function recordNoteView(ctx: RepoContext, tenantId: string, noteId: string, actor: PmsActor): Promise<void> {
  assertTenantId(tenantId);
  assertId(noteId, "note id");
  await pmsAudit(ctx, tenantId, actor, { action: "pms.note.view", targetType: "pms_note", targetId: noteId });
}

/**
 * True when a write failed on the database's lock (migration 0121). The trigger's message says "append-only", so the
 * data gateway (D1) and Postgres both report it as APPEND_ONLY, like the audit log's own lock.
 */
export function isLockedError(err: unknown): boolean {
  return classifyDbError(err) === "APPEND_ONLY" || (err instanceof Error && LOCKED.test(err.message));
}
