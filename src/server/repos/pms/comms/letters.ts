/**
 * Letters (`pms_letters`) and letter templates (`pms_letter_templates`, plus the standard ones – ids
 * "standard:<key>", not stored).
 *
 * - A letter is clinical correspondence: subject and body are encrypted (AAD bound to the row); lists never
 *   decrypt.
 * - draft → final (locked: no more edits; needs no "[not recorded: …]" marker, no merge field and no "[[…]]" gap)
 *   → sent (post, email or by hand). A letter written in error is withdrawn (void) and kept. Never deleted.
 * - Its case must be one of the same patient's cases (composite foreign key), its author a practitioner and its
 *   recipient a referrer of the same clinic.
 */
import type { Selectable } from "kysely";
import { STANDARD_LETTER_TEMPLATES, STANDARD_PREFIX, standardLetterTemplateByKey, type StandardLetterTemplate } from "../../../../modules/pms/comms/defaults";
import { COMMS_ID_PREFIXES as P } from "../../../../modules/pms/comms/ids";
import { hasUnfilledFields } from "../../../../modules/pms/comms/merge-fields";
import {
  LetterInputSchema,
  LetterPatchSchema,
  LetterSentViaSchema,
  LetterTemplateInputSchema,
  LetterTemplatePatchSchema,
  type LetterInput,
  type LetterPatch,
  type LetterTemplateInput,
  type LetterTemplatePatch,
} from "../../../../modules/pms/comms/schemas";
import type { Letter, LetterRecipientKind, LetterSentVia, LetterStatus, LetterSummary, LetterTemplate } from "../../../../modules/pms/comms/types";
import type { PmsActor, PmsSaveResult } from "../../../../modules/pms/core/types";
import type { PmsLetterTemplatesTable, PmsLettersTable } from "../../../db/pms-schema/comms";
import { changeWithAudit, commsAuditWhen } from "./shared";
import {
  RepoInputError,
  assertId,
  assertTenantId,
  b01,
  decryptField,
  encryptField,
  isOn,
  jsonLines,
  nowIso,
  num,
  parseInput,
  parseLines,
  pmsAuditQuery,
  pmsId,
  writeWithAudit,
  type DbContext,
  type RepoContext,
} from "../context";

const TT = "pms_letter_templates";
const L = "pms_letters";
const TEMPLATE_MESSAGES = { unique: "A letter template with this name (or import reference) already exists." };
const LETTER_MESSAGES = { foreignKey: "The case, author or recipient does not exist for this patient in this clinic." };

/* ------------------------------------------------------------------------------------------------
 * Letter templates
 * ----------------------------------------------------------------------------------------------*/

function toTemplate(r: Selectable<PmsLetterTemplatesTable>): LetterTemplate {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    rev: num(r.rev),
    name: r.name,
    recipientKind: r.recipient_kind as LetterRecipientKind,
    subject: r.subject,
    body: r.body,
    active: isOn(r.active),
    standard: false,
    importRef: r.import_ref,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function fromStandard(tenantId: string, s: StandardLetterTemplate): LetterTemplate {
  return { tenantId, id: `${STANDARD_PREFIX}${s.key}`, rev: 0, name: s.name, recipientKind: s.recipientKind, subject: s.subject, body: s.body, active: true, standard: true, importRef: null, createdAt: null, updatedAt: null };
}

/** The clinic's letter templates (by name), then the standard ones. */
export async function listLetterTemplates(ctx: DbContext, tenantId: string, options: { includeInactive?: boolean; includeStandard?: boolean } = {}): Promise<LetterTemplate[]> {
  assertTenantId(tenantId);
  let q = ctx.db.selectFrom(TT).selectAll().where("tenant_id", "=", tenantId);
  if (!options.includeInactive) q = q.where("active", "=", 1);
  const rows = (await q.orderBy("name").limit(300).execute()).map(toTemplate);
  return options.includeStandard === false ? rows : [...rows, ...STANDARD_LETTER_TEMPLATES.map((s) => fromStandard(tenantId, s))];
}

export async function getLetterTemplate(ctx: DbContext, tenantId: string, id: string): Promise<LetterTemplate | null> {
  assertTenantId(tenantId);
  if (id.startsWith(STANDARD_PREFIX)) {
    const s = standardLetterTemplateByKey(id.slice(STANDARD_PREFIX.length));
    return s ? fromStandard(tenantId, s) : null;
  }
  const r = await ctx.db.selectFrom(TT).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return r ? toTemplate(r) : null;
}

export async function createLetterTemplate(ctx: DbContext, tenantId: string, input: LetterTemplateInput, actor: PmsActor): Promise<LetterTemplate> {
  assertTenantId(tenantId);
  const d = parseInput(LetterTemplateInputSchema, input, "Letter template");
  const id = pmsId(P.letterTemplate, ctx);
  const at = nowIso(ctx);
  await writeWithAudit(
    ctx,
    [
      ctx.db.insertInto(TT).values({
        tenant_id: tenantId,
        id,
        rev: 1,
        name: d.name,
        recipient_kind: d.recipientKind,
        subject: d.subject,
        body: d.body,
        active: b01(d.active ?? true),
        import_ref: d.importRef ?? null,
        created_by: actor.userId,
        created_at: at,
        updated_at: at,
      }),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.letter_template.create", targetType: "pms_letter_template", targetId: id, detail: { recipientKind: d.recipientKind } }),
    ],
    TEMPLATE_MESSAGES,
  );
  return (await getLetterTemplate(ctx, tenantId, id)) as LetterTemplate;
}

export async function updateLetterTemplate(ctx: DbContext, tenantId: string, id: string, expectedRev: number, patch: LetterTemplatePatch, actor: PmsActor): Promise<PmsSaveResult> {
  assertTenantId(tenantId);
  if (id.startsWith(STANDARD_PREFIX)) throw new RepoInputError("Standard templates cannot be changed: make a copy first.");
  if (!Number.isInteger(expectedRev) || expectedRev < 1) throw new RepoInputError("expectedRev must be a positive whole number.");
  const d = parseInput(LetterTemplatePatchSchema, patch, "Letter template");
  const fields = Object.keys(d).filter((k) => (d as Record<string, unknown>)[k] !== undefined && k !== "importRef");
  const current = await getLetterTemplate(ctx, tenantId, id);
  if (!current) return { ok: false, reason: "not_found" };
  if (current.rev !== expectedRev) return { ok: false, reason: "conflict", currentRev: current.rev };
  if (fields.length === 0) return { ok: true, rev: expectedRev, updatedAt: current.updatedAt ?? "" };
  const at = nowIso(ctx);
  const changed = await changeWithAudit(
    ctx,
    [
      ctx.db
        .updateTable(TT)
        .set({
          name: d.name ?? current.name,
          recipient_kind: d.recipientKind ?? current.recipientKind,
          subject: d.subject ?? current.subject,
          body: d.body ?? current.body,
          active: b01(d.active ?? current.active),
          rev: expectedRev + 1,
          updated_at: at,
        })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id)
        .where("rev", "=", expectedRev),
      commsAuditWhen(
        ctx,
        tenantId,
        actor,
        { action: "pms.letter_template.update", targetType: "pms_letter_template", targetId: id, detail: { fields, rev: expectedRev + 1 } },
        ctx.db.selectFrom(TT).select("id").where("tenant_id", "=", tenantId).where("id", "=", id).where("rev", "=", expectedRev + 1).where("updated_at", "=", at),
      ),
    ],
    0,
    TEMPLATE_MESSAGES,
  );
  if (changed === 0) {
    const now = await getLetterTemplate(ctx, tenantId, id);
    return now ? { ok: false, reason: "conflict", currentRev: now.rev } : { ok: false, reason: "not_found" };
  }
  return { ok: true, rev: expectedRev + 1, updatedAt: at };
}

/** A copy of a standard letter template the clinic can change. */
export async function copyStandardLetterTemplate(ctx: DbContext, tenantId: string, key: string, actor: PmsActor, name?: string): Promise<LetterTemplate> {
  const s = standardLetterTemplateByKey(key);
  if (!s) throw new RepoInputError("There is no standard letter template with that name.");
  return createLetterTemplate(ctx, tenantId, { name: name ?? `${s.name} – our version`, recipientKind: s.recipientKind, subject: s.subject, body: s.body }, actor);
}

/* ------------------------------------------------------------------------------------------------
 * Letters
 * ----------------------------------------------------------------------------------------------*/

const SUMMARY_COLUMNS = [
  "tenant_id",
  "id",
  "rev",
  "patient_id",
  "case_id",
  "template_id",
  "template_name",
  "practitioner_id",
  "recipient_kind",
  "recipient_referrer_id",
  "recipient_name",
  "letter_on",
  "status",
  "finalised_at",
  "finalised_by",
  "signature_text",
  "sent_at",
  "sent_via",
  "created_by",
  "created_at",
  "updated_at",
] as const;

type LetterRow = Selectable<PmsLettersTable>;

function toSummary(r: Pick<LetterRow, (typeof SUMMARY_COLUMNS)[number]>): LetterSummary {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    rev: num(r.rev),
    patientId: r.patient_id,
    caseId: r.case_id,
    templateId: r.template_id,
    templateName: r.template_name ?? null,
    practitionerId: r.practitioner_id,
    recipientKind: r.recipient_kind as LetterRecipientKind,
    recipientReferrerId: r.recipient_referrer_id,
    recipientName: r.recipient_name,
    letterOn: r.letter_on,
    status: r.status as LetterStatus,
    finalisedAt: r.finalised_at,
    finalisedBy: r.finalised_by,
    signatureText: r.signature_text ?? null,
    sentAt: r.sent_at,
    sentVia: (r.sent_via as LetterSentVia | null) ?? null,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toLetter(ctx: Pick<RepoContext, "cipher">, r: LetterRow): Letter {
  return {
    ...toSummary(r),
    recipientAddress: parseLines(r.recipient_address_json),
    recipientPostcode: r.recipient_postcode,
    recipientEmail: r.recipient_email,
    subject: decryptField(ctx, r.tenant_id, L, "subject_enc", r.id, r.subject_enc) ?? "",
    body: decryptField(ctx, r.tenant_id, L, "body_enc", r.id, r.body_enc) ?? "",
    voidedAt: r.voided_at,
  };
}

/** Starts a letter (a draft). The text is usually the merged template (src/server/pms/comms/letters.ts). */
export async function createLetter(ctx: RepoContext, tenantId: string, input: LetterInput, actor: PmsActor): Promise<Letter> {
  assertTenantId(tenantId);
  const d = parseInput(LetterInputSchema, input, "Letter");
  const id = pmsId(P.letter, ctx);
  const at = nowIso(ctx);
  // Standard templates are not rows: only a clinic template's id is kept.
  const templateId = d.templateId && !d.templateId.startsWith(STANDARD_PREFIX) ? d.templateId : null;
  await writeWithAudit(
    ctx,
    [
      ctx.db.insertInto(L).values({
        tenant_id: tenantId,
        id,
        rev: 1,
        patient_id: d.patientId,
        case_id: d.caseId ?? null,
        template_id: templateId,
        template_name: d.templateName ?? null,
        practitioner_id: d.practitionerId ?? null,
        recipient_kind: d.recipientKind,
        recipient_referrer_id: d.recipientReferrerId ?? null,
        recipient_name: d.recipientName ?? null,
        recipient_address_json: jsonLines(d.recipientAddress),
        recipient_postcode: d.recipientPostcode ?? null,
        recipient_email: d.recipientEmail ?? null,
        letter_on: d.letterOn,
        subject_enc: encryptField(ctx, tenantId, L, "subject_enc", id, d.subject) as string,
        body_enc: encryptField(ctx, tenantId, L, "body_enc", id, d.body) as string,
        status: "draft",
        finalised_at: null,
        finalised_by: null,
        signature_text: null,
        sent_at: null,
        sent_via: null,
        voided_at: null,
        voided_by: null,
        created_by: actor.userId,
        created_at: at,
        updated_at: at,
      }),
      pmsAuditQuery(ctx, tenantId, actor, {
        action: "pms.letter.create",
        targetType: "pms_letter",
        targetId: id,
        detail: { patientId: d.patientId, caseId: d.caseId ?? null, recipientKind: d.recipientKind, template: d.templateId ?? null },
      }),
    ],
    LETTER_MESSAGES,
  );
  return (await getLetter(ctx, tenantId, id)) as Letter;
}

/** Edits a DRAFT with the revision the editor saw (a final or withdrawn letter no longer changes). */
export async function updateLetter(ctx: RepoContext, tenantId: string, id: string, expectedRev: number, patch: LetterPatch, actor: PmsActor): Promise<PmsSaveResult | { ok: false; reason: "locked" }> {
  assertTenantId(tenantId);
  assertId(id, "letter id");
  if (!Number.isInteger(expectedRev) || expectedRev < 1) throw new RepoInputError("expectedRev must be a positive whole number.");
  const d = parseInput(LetterPatchSchema, patch, "Letter");
  const current = await ctx.db.selectFrom(L).select(["rev", "status", "updated_at"]).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  if (!current) return { ok: false, reason: "not_found" };
  if (current.status !== "draft") return { ok: false, reason: "locked" };
  if (num(current.rev) !== expectedRev) return { ok: false, reason: "conflict", currentRev: num(current.rev) };
  const set: Record<string, unknown> = {};
  const fields: string[] = [];
  const put = (key: keyof typeof d, column: string, value: unknown) => {
    if (d[key] === undefined) return;
    set[column] = value;
    fields.push(key);
  };
  put("caseId", "case_id", d.caseId ?? null);
  put("practitionerId", "practitioner_id", d.practitionerId ?? null);
  put("recipientReferrerId", "recipient_referrer_id", d.recipientReferrerId ?? null);
  put("recipientName", "recipient_name", d.recipientName ?? null);
  put("recipientAddress", "recipient_address_json", jsonLines(d.recipientAddress));
  put("recipientPostcode", "recipient_postcode", d.recipientPostcode ?? null);
  put("recipientEmail", "recipient_email", d.recipientEmail ?? null);
  put("letterOn", "letter_on", d.letterOn);
  put("subject", "subject_enc", d.subject === undefined ? undefined : encryptField(ctx, tenantId, L, "subject_enc", id, d.subject));
  put("body", "body_enc", d.body === undefined ? undefined : encryptField(ctx, tenantId, L, "body_enc", id, d.body));
  if (fields.length === 0) return { ok: true, rev: expectedRev, updatedAt: current.updated_at };
  const at = nowIso(ctx);
  const changed = await changeWithAudit(
    ctx,
    [
      ctx.db
        .updateTable(L)
        .set({ ...set, rev: expectedRev + 1, updated_at: at })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id)
        .where("rev", "=", expectedRev)
        .where("status", "=", "draft"),
      commsAuditWhen(ctx, tenantId, actor, { action: "pms.letter.update", targetType: "pms_letter", targetId: id, detail: { fields, rev: expectedRev + 1 } }, revMarked(ctx, tenantId, id, expectedRev + 1, at)),
    ],
    0,
    LETTER_MESSAGES,
  );
  if (changed === 0) {
    const now = await ctx.db.selectFrom(L).select(["rev", "status"]).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
    if (!now) return { ok: false, reason: "not_found" };
    return now.status !== "draft" ? { ok: false, reason: "locked" } : { ok: false, reason: "conflict", currentRev: num(now.rev) };
  }
  return { ok: true, rev: expectedRev + 1, updatedAt: at };
}

export type LetterStepResult = { ok: true } | { ok: false; reason: "not_found" | "conflict" | "locked" | "unfilled" | "not_final" };

/** The row a change just marked: its new revision and time (the audit row's condition). */
function revMarked(ctx: DbContext, tenantId: string, id: string, rev: number, at: string) {
  return ctx.db.selectFrom(L).select("id").where("tenant_id", "=", tenantId).where("id", "=", id).where("rev", "=", rev).where("updated_at", "=", at);
}

/**
 * Signs and finalises a draft (locks it): `signature` is the signer's name, profession and registration number as
 * printed under the letter (design round 3, "Letter editor": "Signature from <name>'s signing details. Added when
 * she sends."). Refused while the letter has gaps to fill.
 */
export async function finaliseLetter(ctx: RepoContext, tenantId: string, id: string, expectedRev: number, actor: PmsActor, signature: string | null = null): Promise<LetterStepResult> {
  assertTenantId(tenantId);
  const letter = await getLetter(ctx, tenantId, id);
  if (!letter) return { ok: false, reason: "not_found" };
  if (letter.status !== "draft") return { ok: false, reason: "locked" };
  if (letter.rev !== expectedRev) return { ok: false, reason: "conflict" };
  if (hasUnfilledFields(letter.subject) || hasUnfilledFields(letter.body)) return { ok: false, reason: "unfilled" };
  const at = nowIso(ctx);
  const changed = await changeWithAudit(ctx, [
    ctx.db
      .updateTable(L)
      .set({ status: "final", finalised_at: at, finalised_by: actor.userId, signature_text: signature ? signature.slice(0, 300) : null, rev: expectedRev + 1, updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .where("rev", "=", expectedRev)
      .where("status", "=", "draft"),
    commsAuditWhen(ctx, tenantId, actor, { action: "pms.letter.finalise", targetType: "pms_letter", targetId: id, detail: { rev: expectedRev + 1, signed: Boolean(signature) } }, revMarked(ctx, tenantId, id, expectedRev + 1, at)),
  ]);
  if (changed === 0) return { ok: false, reason: "conflict" };
  return { ok: true };
}

/** Records how a final letter went out. */
export async function markLetterSent(ctx: DbContext, tenantId: string, id: string, via: LetterSentVia, actor: PmsActor): Promise<LetterStepResult> {
  assertTenantId(tenantId);
  const how = parseInput(LetterSentViaSchema, via, "Sent by");
  const at = nowIso(ctx);
  const changed = await changeWithAudit(ctx, [
    ctx.db
      .updateTable(L)
      .set((eb) => ({ sent_at: at, sent_via: how, rev: eb("rev", "+", 1), updated_at: at }))
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .where("status", "=", "final")
      .where("sent_at", "is", null),
    commsAuditWhen(
      ctx,
      tenantId,
      actor,
      { action: "pms.letter.sent", targetType: "pms_letter", targetId: id, detail: { via: how } },
      ctx.db.selectFrom(L).select("id").where("tenant_id", "=", tenantId).where("id", "=", id).where("sent_at", "=", at).where("sent_via", "=", how),
    ),
  ]);
  if (changed === 0) {
    const now = await ctx.db.selectFrom(L).select(["status", "sent_at"]).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
    if (!now) return { ok: false, reason: "not_found" };
    return now.status !== "final" ? { ok: false, reason: "not_final" } : { ok: false, reason: "locked" };
  }
  return { ok: true };
}

/** Withdraws a letter written in error (draft or final). It is kept, marked withdrawn. */
export async function voidLetter(ctx: DbContext, tenantId: string, id: string, actor: PmsActor): Promise<LetterStepResult> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  const changed = await changeWithAudit(ctx, [
    ctx.db
      .updateTable(L)
      .set((eb) => ({ status: "void", voided_at: at, voided_by: actor.userId, rev: eb("rev", "+", 1), updated_at: at }))
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .where("status", "in", ["draft", "final"]),
    commsAuditWhen(
      ctx,
      tenantId,
      actor,
      { action: "pms.letter.void", targetType: "pms_letter", targetId: id },
      ctx.db.selectFrom(L).select("id").where("tenant_id", "=", tenantId).where("id", "=", id).where("status", "=", "void").where("voided_at", "=", at),
    ),
  ]);
  if (changed === 0) {
    const now = await ctx.db.selectFrom(L).select("status").where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
    return now ? { ok: false, reason: "locked" } : { ok: false, reason: "not_found" };
  }
  return { ok: true };
}

/** One letter, subject and body decrypted. */
export async function getLetter(ctx: RepoContext, tenantId: string, id: string): Promise<Letter | null> {
  assertTenantId(tenantId);
  const r = await ctx.db.selectFrom(L).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return r ? toLetter(ctx, r) : null;
}

export interface ListLettersOptions {
  patientId?: string;
  status?: LetterStatus;
  beforeId?: string;
  /** Default 50, at most 200. */
  limit?: number;
}

/** Letters, newest first (summaries – nothing decrypted). */
export async function listLetters(ctx: DbContext, tenantId: string, options: ListLettersOptions = {}): Promise<LetterSummary[]> {
  assertTenantId(tenantId);
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 50)), 200);
  let q = ctx.db.selectFrom(L).select(SUMMARY_COLUMNS).where("tenant_id", "=", tenantId);
  if (options.patientId) q = q.where("patient_id", "=", options.patientId);
  if (options.status) q = q.where("status", "=", options.status);
  if (options.beforeId) q = q.where("id", "<", options.beforeId);
  return (await q.orderBy("id", "desc").limit(limit).execute()).map(toSummary);
}
