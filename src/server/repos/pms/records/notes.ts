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
  NoteSectionsSchema,
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
import { updateWithAudit } from "./write";

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
  "appointment_id",
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
    appointmentId: r.appointment_id ?? null,
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

function assertRev(expectedRev: number): void {
  if (!Number.isInteger(expectedRev) || expectedRev < 1) throw new RepoInputError("expectedRev must be a positive whole number.");
}

/** The note exactly as an update leaves it (its audit row is written only when this finds it). */
function changedNote(ctx: RepoContext, tenantId: string, id: string, rev: number, at: string) {
  return ctx.db.selectFrom(N).select("id").where("tenant_id", "=", tenantId).where("id", "=", id).where("rev", "=", rev).where("updated_at", "=", at);
}

async function conflictOrMissing(ctx: RepoContext, tenantId: string, id: string): Promise<PmsSaveResult> {
  const now = await ctx.db.selectFrom(N).select("rev").where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return now ? { ok: false, reason: "conflict", currentRev: num(now.rev) } : { ok: false, reason: "not_found" };
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
  const anonymised = await ctx.db
    .selectFrom("pms_patient_anonymisations")
    .select("status")
    .where("tenant_id", "=", tenantId)
    .where("patient_id", "=", d.patientId)
    .executeTakeFirst();
  if (anonymised) throw new RepoInputError("This record has been anonymised. No new notes can be added.");
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
        appointment_id: d.appointmentId ?? null,
        template_id: template.id,
        template_name: template.name,
        note_type: template.noteType,
        template_json: JSON.stringify({ ...toSnapshot(template), version: template.rev }),
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
  assertRev(expectedRev);
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
  const sectionsEnc = encryptSections(ctx, tenantId, id, sections);
  const set: Record<string, unknown> = {
    sections_enc: sectionsEnc,
    body_chart_enc: encryptChart(ctx, tenantId, id, chart),
    rev: expectedRev + 1,
    updated_at: at,
  };
  if (d.seenOn !== undefined) set.seen_on = d.seenOn;
  if (d.caseId !== undefined) set.case_id = d.caseId;
  const changed = await updateWithAudit(
    ctx,
    tenantId,
    who,
    ctx.db
      .updateTable(N)
      .set(set)
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .where("rev", "=", expectedRev)
      .where("status", "=", "draft")
      .where("author_user_id", "=", who.userId as string),
    { action: "pms.note.save", targetType: "pms_note", targetId: id, detail: { rev: expectedRev + 1, sections: Object.keys(sections).length, markers: chart?.markers.length ?? 0 } },
    // The fresh ciphertext (random IV) makes the check exact; an empty draft falls back to revision + time.
    sectionsEnc ? changedNote(ctx, tenantId, id, expectedRev + 1, at).where("sections_enc", "=", sectionsEnc) : changedNote(ctx, tenantId, id, expectedRev + 1, at),
    MESSAGES,
  );
  if (!changed) return conflictOrMissing(ctx, tenantId, id);
  return { ok: true, rev: expectedRev + 1, updatedAt: at };
}

/** Throws the draft away (kept, hidden by default). Only the author, only a draft. */
export async function discardNoteDraft(ctx: RepoContext, tenantId: string, id: string, expectedRev: number, actor: PmsActor): Promise<PmsSaveResult> {
  assertTenantId(tenantId);
  assertId(id, "note id");
  const who = assertActor(actor);
  assertRev(expectedRev);
  const at = nowIso(ctx);
  const changed = await updateWithAudit(
    ctx,
    tenantId,
    who,
    ctx.db
      .updateTable(N)
      .set({ status: "discarded", discarded_at: at, rev: expectedRev + 1, updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .where("rev", "=", expectedRev)
      .where("status", "=", "draft")
      .where("author_user_id", "=", who.userId ?? ""),
    { action: "pms.note.discard", targetType: "pms_note", targetId: id, detail: { rev: expectedRev + 1 } },
    changedNote(ctx, tenantId, id, expectedRev + 1, at),
  );
  if (!changed) {
    const now = await ctx.db.selectFrom(N).select(["rev", "status", "author_user_id"]).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
    if (!now) return { ok: false, reason: "not_found" };
    if (now.status !== "draft") throw new RepoInputError("Only a draft can be discarded.");
    if (now.author_user_id !== who.userId) throw new RepoInputError("Only the note's author can discard a draft.");
    return { ok: false, reason: "conflict", currentRev: num(now.rev) };
  }
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
  assertRev(expectedRev);
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
  const changed = await updateWithAudit(
    ctx,
    tenantId,
    who,
    ctx.db
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
      .where("author_user_id", "=", who.userId as string),
    { action: "pms.note.sign", targetType: "pms_note", targetId: id, detail: { rev: expectedRev + 1, sections: Object.keys(sections).length } },
    changedNote(ctx, tenantId, id, expectedRev + 1, at),
  );
  if (!changed) return conflictOrMissing(ctx, tenantId, id);
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
 * Bulk loads (demo seed, data import)
 * ----------------------------------------------------------------------------------------------*/

/** A note written elsewhere (an earlier system, the demo seed): its author is not the member running the load. */
export interface ImportNoteInput {
  patientId: string;
  caseId?: string | null;
  appointmentId?: string | null;
  templateId: string;
  seenOn: string;
  practitionerId?: string | null;
  /** Who wrote (and, when signed, signed) it. userId null = not a member of this clinic (nobody can change a draft). */
  author: NoteAuthor & { userId?: string | null };
  sections: Record<string, string>;
  bodyChart?: BodyChart | null;
  signed: boolean;
  /** When it was signed (default: the consultation day, 18:00 UTC). */
  signedAt?: string;
  /** Required: a re-run or re-import is refused by the unique (tenant, import_ref) index, never duplicated. */
  importRef: string;
}

/**
 * Many notes at once – batches of 40 rows with one audit row per batch ("pms.note.bulk_create"). Signed notes are
 * inserted signed (fingerprint over their content, the same rule as signNote: content needed, consultation not in
 * the future); the 0121 lock applies to them from then on.
 */
export async function bulkImportNotes(ctx: RepoContext, tenantId: string, inputs: readonly ImportNoteInput[], actor: PmsActor, detail: Record<string, unknown> = {}): Promise<string[]> {
  assertTenantId(tenantId);
  const who = assertActor(actor);
  const today = ukToday(ctx.now ? ctx.now() : new Date());
  const at = nowIso(ctx);
  const templates = new Map<string, TemplateSnapshot & { rev: number }>();
  const rows: (Record<string, unknown> & { id: string })[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    const d = parseInput(NoteDraftInputSchema, { ...input, importRef: input.importRef }, `Note ${i + 1}`);
    if (!d.importRef) throw new RepoInputError(`Note ${i + 1}: an import reference is required.`);
    let template = templates.get(d.templateId);
    if (!template) {
      const t = await getNoteTemplate(ctx, tenantId, d.templateId);
      if (!t) throw new RepoInputError(`Note ${i + 1}: the template does not exist in this clinic.`);
      template = { ...toSnapshot(t), rev: t.rev };
      templates.set(d.templateId, template);
    }
    const sections = sectionsForTemplate(template, parseInput(NoteSectionsSchema, input.sections ?? {}, `Note ${i + 1}`));
    const chart = template.bodyChart && input.bodyChart ? parseInput(BodyChartSchema, input.bodyChart, `Note ${i + 1}`) : null;
    const id = pmsId(P.note, ctx);
    const authorUserId = input.author.userId ? assertId(input.author.userId, "author") : null;
    let signed: Record<string, unknown> = { status: "draft", content_hash: null, signed_at: null, signed_by_user_id: null, signed_by_name: null, signed_registration: null };
    if (input.signed) {
      if (d.seenOn > today) throw new RepoInputError(`Note ${i + 1}: the consultation date is in the future.`);
      if (!noteHasContent(sections, chart)) throw new RepoInputError(`Note ${i + 1}: a signed note needs content.`);
      const signedAt = input.signedAt ?? `${d.seenOn}T18:00:00.000Z`;
      if (Number.isNaN(Date.parse(signedAt))) throw new RepoInputError(`Note ${i + 1}: signedAt is not a time.`);
      signed = {
        status: "signed",
        content_hash: noteFingerprint(template.id, d.seenOn, sections, chart),
        signed_at: new Date(signedAt).toISOString(),
        signed_by_user_id: authorUserId,
        signed_by_name: authorName(input.author),
        signed_registration: registration(input.author),
      };
    }
    rows.push({
      tenant_id: tenantId,
      id,
      rev: 1,
      patient_id: d.patientId,
      case_id: d.caseId ?? null,
      appointment_id: d.appointmentId ?? null,
      template_id: template.id,
      template_name: template.name,
      note_type: template.noteType,
      template_json: JSON.stringify({ ...toSnapshot(template), version: template.rev }),
      seen_on: d.seenOn,
      practitioner_id: d.practitionerId ?? null,
      author_user_id: authorUserId,
      author_name: authorName(input.author),
      sections_enc: encryptSections(ctx, tenantId, id, sections),
      body_chart_enc: encryptChart(ctx, tenantId, id, chart),
      entered_in_error: 0,
      amendment_count: 0,
      discarded_at: null,
      anonymised_at: null,
      import_ref: d.importRef,
      created_at: at,
      updated_at: at,
      ...signed,
    });
  }
  const ids: string[] = [];
  for (let i = 0; i < rows.length; i += 40) {
    const batch = rows.slice(i, i + 40);
    ids.push(...batch.map((r) => r.id));
    await writeWithAudit(
      ctx,
      [
        ...batch.map((r) => ctx.db.insertInto(N).values(r as never)),
        pmsAuditQuery(ctx, tenantId, who, { action: "pms.note.bulk_create", targetType: "pms_note", targetId: batch[0].id, detail: { ...detail, count: batch.length } }),
      ],
      MESSAGES,
    );
  }
  return ids;
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
  appointmentId?: string;
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
  if (options.appointmentId) q = q.where("appointment_id", "=", options.appointmentId);
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

export interface UnsignedNotesOptions {
  /** One clinician's drafts; omitted = every author's (owner/admin view). */
  authorUserId?: string;
  /** Only drafts whose consultation date is on or before this date (YYYY-MM-DD): the overdue ones. */
  seenOnOrBefore?: string;
  /** Default 200, at most 500. */
  limit?: number;
}

/** Unsigned notes (drafts), oldest consultation first – the ones to finish (summaries: nothing decrypted). */
export async function listUnsignedNotes(ctx: RepoContext, tenantId: string, options: UnsignedNotesOptions = {}): Promise<NoteSummary[]> {
  assertTenantId(tenantId);
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 200)), 500);
  let q = ctx.db.selectFrom(N).select(SUMMARY_COLUMNS).where("tenant_id", "=", tenantId).where("status", "=", "draft");
  if (options.authorUserId !== undefined) q = q.where("author_user_id", "=", assertId(options.authorUserId, "author"));
  if (options.seenOnOrBefore !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(options.seenOnOrBefore)) throw new RepoInputError("seenOnOrBefore must be a date (YYYY-MM-DD).");
    q = q.where("seen_on", "<=", options.seenOnOrBefore);
  }
  const rows = await q.orderBy("seen_on").orderBy("id").limit(limit).execute();
  return rows.map(toSummary);
}

export interface UnsignedCount {
  authorUserId: string | null;
  authorName: string | null;
  drafts: number;
  /** Drafts whose consultation date is on or before the cut-off. */
  overdue: number;
}

/** Unsigned notes per author (the owner's overview and each clinician's own count). */
export async function countUnsignedNotesByAuthor(ctx: RepoContext, tenantId: string, options: { overdueOnOrBefore: string; authorUserId?: string }): Promise<UnsignedCount[]> {
  assertTenantId(tenantId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.overdueOnOrBefore)) throw new RepoInputError("overdueOnOrBefore must be a date (YYYY-MM-DD).");
  let q = ctx.db
    .selectFrom(N)
    .select((eb) => [
      "author_user_id",
      eb.fn.max("author_name").as("author_name"),
      eb.fn.countAll<number>().as("drafts"),
      eb.fn.sum<number>(eb.case().when("seen_on", "<=", options.overdueOnOrBefore).then(1).else(0).end()).as("overdue"),
    ])
    .where("tenant_id", "=", tenantId)
    .where("status", "=", "draft");
  if (options.authorUserId !== undefined) q = q.where("author_user_id", "=", assertId(options.authorUserId, "author"));
  const rows = await q.groupBy("author_user_id").orderBy("author_user_id").limit(500).execute();
  return rows.map((r) => ({ authorUserId: r.author_user_id, authorName: (r.author_name as string | null) ?? null, drafts: num(r.drafts), overdue: num(r.overdue ?? 0) }));
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
