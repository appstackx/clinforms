/**
 * Intake and consent forms: the clinic's templates (`pms_intake_templates`, no patient data) and each patient's
 * copy (`pms_intake_responses`).
 *
 * - A copy keeps a SNAPSHOT of the form it was sent with (name, questions, signature wording): editing the
 *   template later never changes what a patient answered or signed. Editing the questions bumps the version.
 * - Answers and the typed name are encrypted (answers_enc, signature_name_enc); lists never decrypt.
 * - Completing a copy checks the answers against its snapshot (src/modules/pms/portal/forms.ts), records the typed
 *   signature and the time, and seals the content with SHA-256 (form + answers + typed name + time + patient +
 *   copy id). The database refuses any later change to a completed copy (trigger "pms_intake_responses_sealed").
 * - Copies are never deleted: an unanswered one can be cancelled.
 */
import { createHash } from "node:crypto";
import type { Selectable } from "kysely";
import { checkAnswers, signatureNameProblem, signedContent, type Answers, type FormDefinition } from "../../../../modules/pms/portal/forms";
import { PORTAL_ID_PREFIXES as P } from "../../../../modules/pms/portal/ids";
import { IntakeTemplateInputSchema, IntakeTemplatePatchSchema, type IntakeFormKind, type IntakeFormStatus, type IntakeTemplateInput, type IntakeTemplatePatch, type SendWhen } from "../../../../modules/pms/portal/schemas";
import type { IntakeResponse, IntakeResponseStatus, IntakeResponseSummary, IntakeTemplate } from "../../../../modules/pms/portal/types";
import { ukToday } from "../../../../modules/pms/core/text";
import type { PmsActor, PmsSaveResult } from "../../../../modules/pms/core/types";
import type { BatchQuery } from "../../../db/batch";
import type { PmsIntakeResponsesTable, PmsIntakeTemplatesTable } from "../../../db/pms-schema/portal";
import { RepoInputError, assertId, assertTenantId, b01, decryptField, encryptField, guarded, isOn, nowIso, num, parseInput, pmsAudit, pmsAuditQuery, pmsId, writeWithAudit, type DbContext, type RepoContext } from "../context";

const TT = "pms_intake_templates";
const TR = "pms_intake_responses";

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function parseDefinition(json: string): FormDefinition {
  try {
    const parsed = JSON.parse(json) as FormDefinition;
    return parsed && Array.isArray(parsed.fields) ? parsed : { fields: [] };
  } catch {
    return { fields: [] };
  }
}

/* ------------------------------------------------------------------------------------------------
 * Templates
 * ----------------------------------------------------------------------------------------------*/

function toTemplate(r: Selectable<PmsIntakeTemplatesTable>): IntakeTemplate {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    rev: num(r.rev),
    version: num(r.version),
    name: r.name,
    kind: r.kind as IntakeFormKind,
    description: r.description,
    status: r.status as IntakeFormStatus,
    sendWhen: r.send_when as SendWhen,
    requiresSignature: isOn(r.requires_signature),
    signatureStatement: r.signature_statement,
    setsTreatmentConsent: isOn(r.sets_treatment_consent),
    definition: parseDefinition(r.definition_json),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const TEMPLATE_MESSAGES = { unique: "The clinic already has a form with this name." };

export async function createIntakeTemplate(ctx: DbContext, tenantId: string, input: IntakeTemplateInput & { status?: IntakeFormStatus }, actor: PmsActor): Promise<IntakeTemplate> {
  assertTenantId(tenantId);
  const d = parseInput(IntakeTemplateInputSchema, input, "Form");
  const status = input.status ?? "active";
  if (!["draft", "active", "archived"].includes(status)) throw new RepoInputError("Status must be draft, active or archived.");
  const id = pmsId(P.form, ctx);
  const at = nowIso(ctx);
  await writeWithAudit(
    ctx,
    [
      ctx.db.insertInto(TT).values({
        tenant_id: tenantId,
        id,
        rev: 1,
        version: 1,
        name: d.name,
        kind: d.kind,
        description: d.description ?? null,
        status,
        send_when: d.sendWhen ?? "manual",
        requires_signature: b01(d.requiresSignature ?? false),
        signature_statement: d.signatureStatement ?? null,
        sets_treatment_consent: b01(d.setsTreatmentConsent ?? false),
        definition_json: JSON.stringify(d.definition),
        created_by: actor.userId,
        created_at: at,
        updated_at: at,
      }),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.intake_form.create", targetType: "pms_intake_form", targetId: id, detail: { kind: d.kind, questions: d.definition.fields.length } }),
    ],
    TEMPLATE_MESSAGES,
  );
  return (await getIntakeTemplate(ctx, tenantId, id)) as IntakeTemplate;
}

/** Saves a template with the revision the editor saw. A change to the questions or the signature wording makes a new version. */
export async function updateIntakeTemplate(ctx: DbContext, tenantId: string, id: string, expectedRev: number, patch: IntakeTemplatePatch, actor: PmsActor): Promise<PmsSaveResult> {
  assertTenantId(tenantId);
  assertId(id, "form id");
  const d = parseInput(IntakeTemplatePatchSchema, patch, "Form");
  const current = await getIntakeTemplate(ctx, tenantId, id);
  if (!current) return { ok: false, reason: "not_found" };
  if (current.rev !== expectedRev) return { ok: false, reason: "conflict", currentRev: current.rev };
  const requiresSignature = d.requiresSignature ?? current.requiresSignature;
  const setsConsent = d.setsTreatmentConsent ?? current.setsTreatmentConsent;
  if (setsConsent && !requiresSignature) throw new RepoInputError("Form: requiresSignature: A form that records consent must be signed");
  const set: Record<string, unknown> = {};
  const fields: string[] = [];
  const put = (key: string, column: string, value: unknown) => {
    if (value === undefined) return;
    set[column] = value;
    fields.push(key);
  };
  put("name", "name", d.name);
  put("kind", "kind", d.kind);
  put("description", "description", d.description);
  put("status", "status", d.status);
  put("sendWhen", "send_when", d.sendWhen);
  put("requiresSignature", "requires_signature", d.requiresSignature === undefined ? undefined : b01(d.requiresSignature));
  put("signatureStatement", "signature_statement", d.signatureStatement);
  put("setsTreatmentConsent", "sets_treatment_consent", d.setsTreatmentConsent === undefined ? undefined : b01(d.setsTreatmentConsent));
  const definitionJson = d.definition ? JSON.stringify(d.definition) : undefined;
  const newVersion =
    (definitionJson !== undefined && definitionJson !== JSON.stringify(current.definition)) ||
    (d.signatureStatement !== undefined && d.signatureStatement !== current.signatureStatement) ||
    (d.requiresSignature !== undefined && d.requiresSignature !== current.requiresSignature);
  put("definition", "definition_json", definitionJson);
  if (fields.length === 0) return { ok: true, rev: expectedRev, updatedAt: current.updatedAt };
  const at = nowIso(ctx);
  const result = await guarded(
    () =>
      ctx.db
        .updateTable(TT)
        .set({ ...set, version: newVersion ? current.version + 1 : current.version, rev: expectedRev + 1, updated_at: at })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id)
        .where("rev", "=", expectedRev)
        .executeTakeFirst(),
    TEMPLATE_MESSAGES,
  );
  if (Number(result.numUpdatedRows) === 0) {
    const now = await getIntakeTemplate(ctx, tenantId, id);
    return now ? { ok: false, reason: "conflict", currentRev: now.rev } : { ok: false, reason: "not_found" };
  }
  await pmsAudit(ctx, tenantId, actor, { action: "pms.intake_form.update", targetType: "pms_intake_form", targetId: id, detail: { fields, version: newVersion ? current.version + 1 : current.version } });
  return { ok: true, rev: expectedRev + 1, updatedAt: at };
}

export async function getIntakeTemplate(ctx: DbContext, tenantId: string, id: string): Promise<IntakeTemplate | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom(TT).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return row ? toTemplate(row) : null;
}

export async function listIntakeTemplates(ctx: DbContext, tenantId: string, options: { status?: IntakeFormStatus | "any" } = {}): Promise<IntakeTemplate[]> {
  assertTenantId(tenantId);
  let q = ctx.db.selectFrom(TT).selectAll().where("tenant_id", "=", tenantId);
  const status = options.status ?? "any";
  if (status !== "any") q = q.where("status", "=", status);
  const rows = await q.orderBy("name").limit(200).execute();
  return rows.map(toTemplate);
}

/** Active forms the clinic sends by itself with an online booking. */
export async function formsToSendWithBooking(ctx: DbContext, tenantId: string, newPatient: boolean): Promise<IntakeTemplate[]> {
  const all = await listIntakeTemplates(ctx, tenantId, { status: "active" });
  return all.filter((t) => t.sendWhen === "every_booking" || (newPatient && t.sendWhen === "new_patient"));
}

/* ------------------------------------------------------------------------------------------------
 * Patients' copies
 * ----------------------------------------------------------------------------------------------*/

const SUMMARY = [
  "tenant_id",
  "id",
  "template_id",
  "template_version",
  "name",
  "kind",
  "patient_id",
  "booking_id",
  "status",
  "requires_signature",
  "signed_at",
  "trust",
  "requested_at",
  "submitted_at",
  "reviewed_at",
  "applied_at",
  "updated_at",
] as const;

type ResponseRow = Selectable<PmsIntakeResponsesTable>;

function toResponseSummary(r: Pick<ResponseRow, (typeof SUMMARY)[number]>): IntakeResponseSummary {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    templateId: r.template_id,
    templateVersion: num(r.template_version),
    name: r.name,
    kind: r.kind as IntakeFormKind,
    patientId: r.patient_id,
    bookingId: r.booking_id,
    status: r.status as IntakeResponseStatus,
    requiresSignature: isOn(r.requires_signature),
    signedAt: r.signed_at,
    trust: (r.trust as IntakeResponseSummary["trust"]) ?? null,
    requestedAt: r.requested_at,
    submittedAt: r.submitted_at,
    reviewedAt: r.reviewed_at,
    appliedAt: r.applied_at,
    updatedAt: r.updated_at,
  };
}

function toResponse(ctx: RepoContext, r: ResponseRow): IntakeResponse {
  const answersText = decryptField(ctx, r.tenant_id, TR, "answers_enc", r.id, r.answers_enc);
  return {
    ...toResponseSummary(r),
    rev: num(r.rev),
    form: parseDefinition(r.form_json),
    signatureStatement: r.signature_statement,
    setsTreatmentConsent: isOn(r.sets_treatment_consent),
    answers: answersText ? (JSON.parse(answersText) as Answers) : null,
    signatureName: decryptField(ctx, r.tenant_id, TR, "signature_name_enc", r.id, r.signature_name_enc),
    contentSha256: r.content_sha256,
    requestedBy: r.requested_by,
    reviewedBy: r.reviewed_by,
  };
}

/** The INSERT (snapshot of the template) and audit row for a new copy (send them in a batch). */
export function intakeRequestQueries(ctx: DbContext, tenantId: string, template: IntakeTemplate, target: { patientId: string; bookingId?: string | null }, actor: PmsActor): { id: string; queries: BatchQuery[] } {
  assertTenantId(tenantId);
  assertId(target.patientId, "patient id");
  if (template.tenantId !== tenantId) throw new RepoInputError("That form belongs to another clinic.");
  if (template.status !== "active") throw new RepoInputError("Only an active form can be sent.");
  const id = pmsId(P.response, ctx);
  const at = nowIso(ctx);
  return {
    id,
    queries: [
      ctx.db.insertInto(TR).values({
        tenant_id: tenantId,
        id,
        rev: 1,
        template_id: template.id,
        template_version: template.version,
        name: template.name,
        kind: template.kind,
        patient_id: target.patientId,
        booking_id: target.bookingId ?? null,
        status: "requested",
        form_json: JSON.stringify(template.definition),
        requires_signature: b01(template.requiresSignature),
        signature_statement: template.signatureStatement,
        sets_treatment_consent: b01(template.setsTreatmentConsent),
        answers_enc: null,
        signature_name_enc: null,
        signed_at: null,
        trust: null,
        content_sha256: null,
        requested_by: actor.userId,
        requested_at: at,
        created_at: at,
        updated_at: at,
      }),
      pmsAuditQuery(ctx, tenantId, actor, {
        action: "pms.intake_response.request",
        targetType: "pms_intake_response",
        targetId: id,
        detail: { formId: template.id, version: template.version, patientId: target.patientId, bookingId: target.bookingId ?? null },
      }),
    ],
  };
}

/** Sends a form to a patient (an unanswered copy of the same form is reused rather than sent twice). */
export async function requestIntakeForm(ctx: DbContext, tenantId: string, input: { templateId: string; patientId: string; bookingId?: string | null }, actor: PmsActor): Promise<{ response: IntakeResponseSummary; created: boolean }> {
  assertTenantId(tenantId);
  assertId(input.templateId, "form id");
  assertId(input.patientId, "patient id");
  const template = await getIntakeTemplate(ctx, tenantId, input.templateId);
  if (!template) throw new RepoInputError("That form does not exist in this clinic.");
  const open = await ctx.db
    .selectFrom(TR)
    .select(SUMMARY)
    .where("tenant_id", "=", tenantId)
    .where("patient_id", "=", input.patientId)
    .where("template_id", "=", input.templateId)
    .where("status", "=", "requested")
    .executeTakeFirst();
  if (open) return { response: toResponseSummary(open), created: false };
  const { id, queries } = intakeRequestQueries(ctx, tenantId, template, input, actor);
  await writeWithAudit(ctx, queries, { foreignKey: "That patient or booking does not exist in this clinic." });
  const row = await ctx.db.selectFrom(TR).select(SUMMARY).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirstOrThrow();
  return { response: toResponseSummary(row), created: true };
}

export async function listResponsesForPatient(ctx: DbContext, tenantId: string, patientId: string, options: { status?: IntakeResponseStatus | "any" } = {}): Promise<IntakeResponseSummary[]> {
  assertTenantId(tenantId);
  let q = ctx.db.selectFrom(TR).select(SUMMARY).where("tenant_id", "=", tenantId).where("patient_id", "=", patientId);
  const status = options.status ?? "any";
  if (status !== "any") q = q.where("status", "=", status);
  const rows = await q.orderBy("requested_at", "desc").limit(200).execute();
  return rows.map(toResponseSummary);
}

export async function listResponsesForBooking(ctx: DbContext, tenantId: string, bookingId: string): Promise<IntakeResponseSummary[]> {
  assertTenantId(tenantId);
  const rows = await ctx.db.selectFrom(TR).select(SUMMARY).where("tenant_id", "=", tenantId).where("booking_id", "=", bookingId).orderBy("requested_at").limit(50).execute();
  return rows.map(toResponseSummary);
}

/** Completed copies staff have not checked yet (newest first). */
export async function listResponsesToReview(ctx: DbContext, tenantId: string, options: { limit?: number } = {}): Promise<IntakeResponseSummary[]> {
  assertTenantId(tenantId);
  const rows = await ctx.db
    .selectFrom(TR)
    .select(SUMMARY)
    .where("tenant_id", "=", tenantId)
    .where("status", "=", "submitted")
    .where("reviewed_at", "is", null)
    .orderBy("submitted_at", "desc")
    .limit(Math.min(Math.max(1, options.limit ?? 100), 500))
    .execute();
  return rows.map(toResponseSummary);
}

/** Counts of copies by status for one form (the forms list). */
export async function countResponsesByTemplate(ctx: DbContext, tenantId: string): Promise<Map<string, { requested: number; submitted: number }>> {
  assertTenantId(tenantId);
  const rows = await ctx.db
    .selectFrom(TR)
    .select((eb) => ["template_id", "status", eb.fn.countAll<number>().as("n")])
    .where("tenant_id", "=", tenantId)
    .groupBy(["template_id", "status"])
    .execute();
  const out = new Map<string, { requested: number; submitted: number }>();
  for (const r of rows) {
    const entry = out.get(r.template_id) ?? { requested: 0, submitted: 0 };
    if (r.status === "requested") entry.requested += num(r.n);
    if (r.status === "submitted") entry.submitted += num(r.n);
    out.set(r.template_id, entry);
  }
  return out;
}

/** One copy with its answers and typed name decrypted. */
export async function getIntakeResponse(ctx: RepoContext, tenantId: string, id: string): Promise<IntakeResponse | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom(TR).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return row ? toResponse(ctx, row) : null;
}

/** The text sealed by content_sha256 for a completed copy (recomputed to show "unchanged since signing"). */
export function responseSealText(r: Pick<IntakeResponse, "id" | "patientId" | "form" | "answers" | "signatureName" | "signedAt">): string {
  return signedContent({ responseId: r.id, patientId: r.patientId, form: r.form, answers: r.answers ?? {}, signatureName: r.signatureName, signedAt: r.signedAt });
}

export function responseSealIntact(r: IntakeResponse): boolean {
  return r.status === "submitted" && r.contentSha256 !== null && sha256Hex(responseSealText(r)) === r.contentSha256;
}

export type SubmitResult =
  | { ok: true; response: IntakeResponse }
  | { ok: false; reason: "invalid"; errors: Record<string, string> }
  | { ok: false; reason: "conflict" | "not_found" | "closed" };

/**
 * Completes a copy: checks the answers against its snapshot, records the typed signature (when the form needs
 * one), seals it and marks it submitted – one conditional UPDATE (still "requested", same revision), then the
 * audit row. `trust` records how the patient reached the form (their own portal sign-in, or a booking link).
 */
export async function submitIntakeResponse(
  ctx: RepoContext,
  tenantId: string,
  id: string,
  expectedRev: number,
  input: { answers: Record<string, unknown>; signatureName?: string | null; trust: "verified" | "unverified" },
  actor: PmsActor,
): Promise<SubmitResult> {
  assertTenantId(tenantId);
  assertId(id, "form copy id");
  const current = await getIntakeResponse(ctx, tenantId, id);
  if (!current) return { ok: false, reason: "not_found" };
  if (current.status !== "requested") return { ok: false, reason: "closed" };
  if (current.rev !== expectedRev) return { ok: false, reason: "conflict" };
  const today = ukToday(ctx.now ? ctx.now() : new Date());
  const checked = checkAnswers(current.form, input.answers, today);
  const errors: Record<string, string> = checked.ok ? {} : { ...checked.errors };
  let signatureName: string | null = null;
  if (current.requiresSignature) {
    const problem = signatureNameProblem(input.signatureName ?? "");
    if (problem) errors.signature = problem;
    else signatureName = (input.signatureName ?? "").trim().replace(/\s+/g, " ");
  }
  if (!checked.ok || Object.keys(errors).length) return { ok: false, reason: "invalid", errors };
  const answers = checked.answers;
  const at = nowIso(ctx);
  const signedAt = current.requiresSignature ? at : null;
  const seal = sha256Hex(signedContent({ responseId: id, patientId: current.patientId, form: current.form, answers, signatureName, signedAt }));
  const result = await ctx.db
    .updateTable(TR)
    .set({
      status: "submitted",
      answers_enc: encryptField(ctx, tenantId, TR, "answers_enc", id, JSON.stringify(answers)),
      signature_name_enc: encryptField(ctx, tenantId, TR, "signature_name_enc", id, signatureName),
      signed_at: signedAt,
      trust: input.trust,
      content_sha256: seal,
      submitted_at: at,
      rev: expectedRev + 1,
      updated_at: at,
    })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .where("rev", "=", expectedRev)
    .where("status", "=", "requested")
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) === 0) return { ok: false, reason: "conflict" };
  await pmsAudit(ctx, tenantId, actor, {
    action: current.requiresSignature ? "pms.intake_response.sign" : "pms.intake_response.submit",
    targetType: "pms_intake_response",
    targetId: id,
    detail: { patientId: current.patientId, trust: input.trust, answered: Object.keys(answers).length },
  });
  return { ok: true, response: (await getIntakeResponse(ctx, tenantId, id)) as IntakeResponse };
}

/** Moves a booking's forms to the booking that replaced it (send it in the move's batch – no audit row of its own). */
export function moveResponsesQuery(ctx: DbContext, tenantId: string, fromBookingId: string, toBookingId: string): BatchQuery {
  assertTenantId(tenantId);
  assertId(fromBookingId, "booking id");
  assertId(toBookingId, "booking id");
  return ctx.db.updateTable(TR).set({ booking_id: toBookingId, updated_at: nowIso(ctx) }).where("tenant_id", "=", tenantId).where("booking_id", "=", fromBookingId);
}

/** Withdraws an unanswered copy. */
export async function cancelIntakeResponse(ctx: DbContext, tenantId: string, id: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(id, "form copy id");
  const at = nowIso(ctx);
  const result = await ctx.db
    .updateTable(TR)
    .set((eb) => ({ status: "cancelled", cancelled_at: at, rev: eb("rev", "+", 1), updated_at: at }))
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .where("status", "=", "requested")
    .executeTakeFirst();
  const changed = Number(result.numUpdatedRows) > 0;
  if (changed) await pmsAudit(ctx, tenantId, actor, { action: "pms.intake_response.cancel", targetType: "pms_intake_response", targetId: id });
  return changed;
}

/** Staff have read a completed copy. */
export async function markResponseReviewed(ctx: DbContext, tenantId: string, id: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(id, "form copy id");
  const at = nowIso(ctx);
  const result = await ctx.db
    .updateTable(TR)
    .set((eb) => ({ reviewed_at: at, reviewed_by: actor.userId, rev: eb("rev", "+", 1), updated_at: at }))
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .where("status", "=", "submitted")
    .where("reviewed_at", "is", null)
    .executeTakeFirst();
  const changed = Number(result.numUpdatedRows) > 0;
  if (changed) await pmsAudit(ctx, tenantId, actor, { action: "pms.intake_response.review", targetType: "pms_intake_response", targetId: id });
  return changed;
}

/**
 * Records that answers of a completed copy were copied to the patient's record (field names only in the audit).
 * Applied by a member of staff = checked by them; the patient's own verified consent still waits for a check.
 */
export async function markResponseApplied(ctx: DbContext, tenantId: string, id: string, fields: string[], actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(id, "form copy id");
  const at = nowIso(ctx);
  const staff = actor.userId;
  const result = await ctx.db
    .updateTable(TR)
    .set((eb) =>
      staff
        ? { applied_at: at, applied_by: staff, reviewed_at: eb.fn.coalesce("reviewed_at", eb.val(at)), reviewed_by: eb.fn.coalesce("reviewed_by", eb.val(staff)), rev: eb("rev", "+", 1), updated_at: at }
        : { applied_at: at, applied_by: null, rev: eb("rev", "+", 1), updated_at: at },
    )
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .where("status", "=", "submitted")
    .executeTakeFirst();
  const changed = Number(result.numUpdatedRows) > 0;
  if (changed) await pmsAudit(ctx, tenantId, actor, { action: "pms.intake_response.apply", targetType: "pms_intake_response", targetId: id, detail: { fields } });
  return changed;
}
