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
import { IntakeTemplateInputSchema, IntakeTemplatePatchSchema, type IntakeFormKind, type IntakeFormStatus, type IntakeResponseKind, type IntakeTemplateInput, type IntakeTemplatePatch, type SendWhen } from "../../../../modules/pms/portal/schemas";
import type { OutcomeMeasureId } from "../../../../modules/pms/records/outcomes";
import type { IntakeResponse, IntakeResponseStatus, IntakeResponseSummary, IntakeTemplate } from "../../../../modules/pms/portal/types";
import { ukToday } from "../../../../modules/pms/core/text";
import type { PmsActor, PmsSaveResult } from "../../../../modules/pms/core/types";
import type { BatchQuery } from "../../../db/batch";
import type { PmsIntakeResponsesTable, PmsIntakeTemplatesTable } from "../../../db/pms-schema/portal";
import { RepoInputError, assertId, assertTenantId, b01, decryptField, encryptField, isOn, nowIso, num, parseInput, pmsAuditQuery, pmsId, writeWithAudit, type DbContext, type RepoContext } from "../context";
import { changeWithAudit, newPortalWriteId, portalAuditWhen, portalAuditWhenWritten } from "./shared";
import { pmsNow } from "../../../../modules/pms/core/clock";

const TT = "pms_intake_templates";
const TR = "pms_intake_responses";

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Postgres hands timestamptz back as a Date; D1 as text – always ISO text here. */
function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
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
    createdAt: iso(r.created_at) as string,
    updatedAt: iso(r.updated_at) as string,
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
  const version = newVersion ? current.version + 1 : current.version;
  const next = expectedRev + 1;
  const changed = await changeWithAudit(
    ctx,
    [
      ctx.db.updateTable(TT).set({ ...set, version, rev: next, updated_at: at }).where("tenant_id", "=", tenantId).where("id", "=", id).where("rev", "=", expectedRev),
      portalAuditWhen(
        ctx,
        tenantId,
        actor,
        { action: "pms.intake_form.update", targetType: "pms_intake_form", targetId: id, detail: { fields, version } },
        ctx.db.selectFrom(TT).select("id").where("tenant_id", "=", tenantId).where("id", "=", id).where("rev", "=", next).where("updated_at", "=", at),
      ),
    ],
    0,
    TEMPLATE_MESSAGES,
  );
  if (changed === 0) {
    const now = await getIntakeTemplate(ctx, tenantId, id);
    return now ? { ok: false, reason: "conflict", currentRev: now.rev } : { ok: false, reason: "not_found" };
  }
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
  "appointment_id",
  "measure",
  "case_id",
  "outcome_id",
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
    kind: r.kind as IntakeResponseKind,
    patientId: r.patient_id,
    appointmentId: r.appointment_id,
    measure: (r.measure as OutcomeMeasureId | null) ?? null,
    caseId: r.case_id,
    outcomeId: r.outcome_id,
    status: r.status as IntakeResponseStatus,
    requiresSignature: isOn(r.requires_signature),
    signedAt: iso(r.signed_at),
    trust: (r.trust as IntakeResponseSummary["trust"]) ?? null,
    requestedAt: iso(r.requested_at) as string,
    submittedAt: iso(r.submitted_at),
    reviewedAt: iso(r.reviewed_at),
    appliedAt: iso(r.applied_at),
    updatedAt: iso(r.updated_at) as string,
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
export function intakeRequestQueries(ctx: DbContext, tenantId: string, template: IntakeTemplate, target: { patientId: string; appointmentId?: string | null }, actor: PmsActor): { id: string; queries: BatchQuery[] } {
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
        appointment_id: target.appointmentId ?? null,
        measure: null,
        case_id: null,
        outcome_id: null,
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
        detail: { formId: template.id, version: template.version, patientId: target.patientId, appointmentId: target.appointmentId ?? null },
      }),
    ],
  };
}

/**
 * The INSERT and audit row of an outcome questionnaire for a patient (no template: the form is made from the
 * records module's measure – src/modules/pms/portal/outcome-forms.ts). Answered in the portal; scored by records.
 */
export function outcomeRequestQueries(
  ctx: DbContext,
  tenantId: string,
  target: { patientId: string; caseId: string | null; measure: OutcomeMeasureId; name: string; form: FormDefinition },
  actor: PmsActor,
): { id: string; queries: BatchQuery[] } {
  assertTenantId(tenantId);
  assertId(target.patientId, "patient id");
  if (target.caseId) assertId(target.caseId, "case id");
  const id = pmsId(P.response, ctx);
  const at = nowIso(ctx);
  return {
    id,
    queries: [
      ctx.db.insertInto(TR).values({
        tenant_id: tenantId,
        id,
        rev: 1,
        template_id: null,
        template_version: 1,
        name: target.name,
        kind: "outcome",
        patient_id: target.patientId,
        appointment_id: null,
        measure: target.measure,
        case_id: target.caseId,
        outcome_id: null,
        status: "requested",
        form_json: JSON.stringify(target.form),
        requires_signature: 0,
        signature_statement: null,
        sets_treatment_consent: 0,
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
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.intake_response.request", targetType: "pms_intake_response", targetId: id, detail: { measure: target.measure, patientId: target.patientId, caseId: target.caseId } }),
    ],
  };
}

/** Sends a form to a patient (an unanswered copy of the same form is reused rather than sent twice). */
export async function requestIntakeForm(ctx: DbContext, tenantId: string, input: { templateId: string; patientId: string; appointmentId?: string | null }, actor: PmsActor): Promise<{ response: IntakeResponseSummary; created: boolean }> {
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
  await writeWithAudit(ctx, queries, { foreignKey: "That patient or appointment does not exist in this clinic." });
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

export async function listResponsesForAppointment(ctx: DbContext, tenantId: string, appointmentId: string): Promise<IntakeResponseSummary[]> {
  assertTenantId(tenantId);
  const rows = await ctx.db.selectFrom(TR).select(SUMMARY).where("tenant_id", "=", tenantId).where("appointment_id", "=", appointmentId).orderBy("requested_at").limit(50).execute();
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
        .where("template_id", "is not", null)
    .groupBy(["template_id", "status"])
    .execute();
  const out = new Map<string, { requested: number; submitted: number }>();
  for (const r of rows) {
    if (!r.template_id) continue;
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

export interface SubmitOptions {
  /**
   * Further statements of the SAME batch, given this write's id (e.g. the clinic device's hand-off marked finished) –
   * make them conditional on `writtenRow(…, "pms_intake_responses", id, writeId)` so they run only with the seal.
   */
  alsoWrite?: (writeId: string) => BatchQuery[];
  /** Extra ids for the audit row (never patient data). */
  auditDetail?: Record<string, string | number | boolean | null>;
}

/**
 * Completes a copy: checks the answers against its snapshot, records the typed signature (when the form needs
 * one), seals it and marks it submitted – one conditional UPDATE (still "requested", same revision) with its
 * audit row in the same batch. `trust` records how the patient reached the form (their own portal sign-in, or a booking link).
 */
export async function submitIntakeResponse(
  ctx: RepoContext,
  tenantId: string,
  id: string,
  expectedRev: number,
  input: { answers: Record<string, unknown>; signatureName?: string | null; trust: "verified" | "unverified" },
  actor: PmsActor,
  options: SubmitOptions = {},
): Promise<SubmitResult> {
  assertTenantId(tenantId);
  assertId(id, "form copy id");
  const current = await getIntakeResponse(ctx, tenantId, id);
  if (!current) return { ok: false, reason: "not_found" };
  if (current.status !== "requested") return { ok: false, reason: "closed" };
  if (current.rev !== expectedRev) return { ok: false, reason: "conflict" };
  const today = ukToday(ctx.now ? ctx.now() : pmsNow());
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
  const next = expectedRev + 1;
  const writeId = newPortalWriteId(ctx);
  // The seal and its audit row in ONE batch (the audit row only when this write completed the copy).
  const changed = await changeWithAudit(ctx, [
    ctx.db
      .updateTable(TR)
      .set({
        status: "submitted",
        answers_enc: encryptField(ctx, tenantId, TR, "answers_enc", id, JSON.stringify(answers)),
        signature_name_enc: encryptField(ctx, tenantId, TR, "signature_name_enc", id, signatureName),
        signed_at: signedAt,
        trust: input.trust,
        content_sha256: seal,
        submitted_at: at,
        rev: next,
        write_id: writeId,
        updated_at: at,
      })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .where("rev", "=", expectedRev)
      .where("status", "=", "requested"),
    portalAuditWhenWritten(
      ctx,
      tenantId,
      actor,
      {
        action: current.requiresSignature ? "pms.intake_response.sign" : "pms.intake_response.submit",
        targetType: "pms_intake_response",
        targetId: id,
        detail: { patientId: current.patientId, trust: input.trust, answered: Object.keys(answers).length, ...(current.measure ? { measure: current.measure } : {}), ...(options.auditDetail ?? {}) },
      },
      TR,
      id,
      writeId,
    ),
    ...(options.alsoWrite ? options.alsoWrite(writeId) : []),
  ]);
  if (changed === 0) return { ok: false, reason: "conflict" };
  return { ok: true, response: (await getIntakeResponse(ctx, tenantId, id)) as IntakeResponse };
}

/** Withdraws an unanswered copy. */
export async function cancelIntakeResponse(ctx: DbContext, tenantId: string, id: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(id, "form copy id");
  const at = nowIso(ctx);
  const writeId = newPortalWriteId(ctx);
  const changed =
    (await changeWithAudit(ctx, [
      ctx.db
        .updateTable(TR)
        .set((eb) => ({ status: "cancelled", cancelled_at: at, rev: eb("rev", "+", 1), write_id: writeId, updated_at: at }))
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id)
        .where("status", "=", "requested"),
      portalAuditWhenWritten(ctx, tenantId, actor, { action: "pms.intake_response.cancel", targetType: "pms_intake_response", targetId: id }, TR, id, writeId),
    ])) > 0;
  return changed;
}

/** Staff have read a completed copy. */
export async function markResponseReviewed(ctx: DbContext, tenantId: string, id: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(id, "form copy id");
  const at = nowIso(ctx);
  const writeId = newPortalWriteId(ctx);
  const changed =
    (await changeWithAudit(ctx, [
      ctx.db
        .updateTable(TR)
        .set((eb) => ({ reviewed_at: at, reviewed_by: actor.userId, rev: eb("rev", "+", 1), write_id: writeId, updated_at: at }))
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id)
        .where("status", "=", "submitted")
        .where("reviewed_at", "is", null),
      portalAuditWhenWritten(ctx, tenantId, actor, { action: "pms.intake_response.review", targetType: "pms_intake_response", targetId: id }, TR, id, writeId),
    ])) > 0;
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
  const writeId = newPortalWriteId(ctx);
  const changed =
    (await changeWithAudit(ctx, [
      ctx.db
        .updateTable(TR)
        .set((eb) =>
          staff
            ? { applied_at: at, applied_by: staff, reviewed_at: eb.fn.coalesce("reviewed_at", eb.val(at)), reviewed_by: eb.fn.coalesce("reviewed_by", eb.val(staff)), rev: eb("rev", "+", 1), write_id: writeId, updated_at: at }
            : { applied_at: at, applied_by: null, rev: eb("rev", "+", 1), write_id: writeId, updated_at: at },
        )
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id)
        .where("status", "=", "submitted"),
      portalAuditWhenWritten(ctx, tenantId, actor, { action: "pms.intake_response.apply", targetType: "pms_intake_response", targetId: id, detail: { fields } }, TR, id, writeId),
    ])) > 0;
  return changed;
}

/** Links a completed outcome questionnaire to the records module's outcome row its answers made. Audited. */
export async function setResponseOutcome(ctx: DbContext, tenantId: string, id: string, outcomeId: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(id, "form copy id");
  assertId(outcomeId, "outcome id");
  const at = nowIso(ctx);
  const writeId = newPortalWriteId(ctx);
  const changed = await changeWithAudit(
    ctx,
    [
      ctx.db.updateTable(TR).set({ outcome_id: outcomeId, write_id: writeId, updated_at: at }).where("tenant_id", "=", tenantId).where("id", "=", id).where("status", "=", "submitted").where("kind", "=", "outcome").where("outcome_id", "is", null),
      portalAuditWhenWritten(ctx, tenantId, actor, { action: "pms.intake_response.score", targetType: "pms_intake_response", targetId: id, detail: { outcomeId } }, TR, id, writeId),
    ],
    0,
    { foreignKey: "That outcome does not exist in this clinic." },
  );
  return changed > 0;
}
