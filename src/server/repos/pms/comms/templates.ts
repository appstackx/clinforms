/**
 * `pms_message_templates` – the clinic's own message wording, plus the standard templates (not stored; ids
 * "standard:<key>"). Automatic messages use, for their kind and channel, the clinic's default template if it has
 * one, else the standard one. Templates are never deleted (switched inactive); one default per kind and channel
 * (unique index). Every write is audited.
 */
import type { Selectable } from "kysely";
import { STANDARD_MESSAGE_TEMPLATES, STANDARD_PREFIX, standardMessageTemplate, standardMessageTemplateByKey, type StandardMessageTemplate } from "../../../../modules/pms/comms/defaults";
import { COMMS_ID_PREFIXES as P } from "../../../../modules/pms/comms/ids";
import { MessageTemplateInputSchema, MessageTemplatePatchSchema, messageTemplateCheck, type MessageTemplateInput, type MessageTemplatePatch } from "../../../../modules/pms/comms/schemas";
import type { MessageChannel, MessageTemplate, TemplateKind } from "../../../../modules/pms/comms/types";
import type { PmsActor, PmsSaveResult } from "../../../../modules/pms/core/types";
import type { PmsMessageTemplatesTable } from "../../../db/pms-schema/comms";
import { runBatch } from "../../../db/batch";
import { RepoInputError, assertTenantId, b01, guarded, isOn, nowIso, num, parseInput, pmsAudit, pmsAuditQuery, pmsId, translateDbError, writeWithAudit, type DbContext } from "../context";

const T = "pms_message_templates";
const MESSAGES = { unique: "A message template with this name (or import reference) already exists." };

function toTemplate(r: Selectable<PmsMessageTemplatesTable>): MessageTemplate {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    rev: num(r.rev),
    kind: r.kind as TemplateKind,
    channel: r.channel as MessageChannel,
    name: r.name,
    subject: r.subject,
    body: r.body,
    isDefault: isOn(r.is_default),
    active: isOn(r.active),
    standard: false,
    importRef: r.import_ref,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function fromStandard(tenantId: string, s: StandardMessageTemplate, isDefault: boolean): MessageTemplate {
  return {
    tenantId,
    id: `${STANDARD_PREFIX}${s.key}`,
    rev: 0,
    kind: s.kind,
    channel: s.channel,
    name: s.name,
    subject: s.subject,
    body: s.body,
    isDefault,
    active: true,
    standard: true,
    importRef: null,
    createdAt: null,
    updatedAt: null,
  };
}

export interface ListTemplatesOptions {
  kind?: TemplateKind;
  channel?: MessageChannel;
  includeInactive?: boolean;
  /** Add the standard templates (default true). */
  includeStandard?: boolean;
}

/** The clinic's templates (by kind, channel, name), then the standard ones. */
export async function listMessageTemplates(ctx: DbContext, tenantId: string, options: ListTemplatesOptions = {}): Promise<MessageTemplate[]> {
  assertTenantId(tenantId);
  let q = ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId);
  if (options.kind) q = q.where("kind", "=", options.kind);
  if (options.channel) q = q.where("channel", "=", options.channel);
  if (!options.includeInactive) q = q.where("active", "=", 1);
  const rows = (await q.orderBy("kind").orderBy("channel").orderBy("name").limit(500).execute()).map(toTemplate);
  if (options.includeStandard === false) return rows;
  const defaults = new Set(rows.filter((t) => t.isDefault && t.active).map((t) => `${t.kind}:${t.channel}`));
  const standards = STANDARD_MESSAGE_TEMPLATES.filter((s) => (!options.kind || s.kind === options.kind) && (!options.channel || s.channel === options.channel)).map((s) =>
    fromStandard(tenantId, s, !defaults.has(`${s.kind}:${s.channel}`)),
  );
  return [...rows, ...standards];
}

/** One template (a clinic one, or a standard one by "standard:<key>"). */
export async function getMessageTemplate(ctx: DbContext, tenantId: string, id: string): Promise<MessageTemplate | null> {
  assertTenantId(tenantId);
  if (id.startsWith(STANDARD_PREFIX)) {
    const s = standardMessageTemplateByKey(id.slice(STANDARD_PREFIX.length));
    if (!s) return null;
    const own = await defaultTemplateRow(ctx, tenantId, s.kind, s.channel);
    return fromStandard(tenantId, s, !own);
  }
  const r = await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return r ? toTemplate(r) : null;
}

async function defaultTemplateRow(ctx: DbContext, tenantId: string, kind: TemplateKind, channel: MessageChannel): Promise<MessageTemplate | null> {
  const r = await ctx.db
    .selectFrom(T)
    .selectAll()
    .where("tenant_id", "=", tenantId)
    .where("kind", "=", kind)
    .where("channel", "=", channel)
    .where("is_default", "=", 1)
    .where("active", "=", 1)
    .executeTakeFirst();
  return r ? toTemplate(r) : null;
}

/**
 * The template an automatic message uses: the given one when it is active and of the right kind and channel,
 * else the clinic's default for the kind and channel, else the standard one (null only for kinds without one).
 */
export async function resolveTemplate(ctx: DbContext, tenantId: string, kind: TemplateKind, channel: MessageChannel, preferredId?: string | null): Promise<MessageTemplate | null> {
  assertTenantId(tenantId);
  if (preferredId && !preferredId.startsWith(STANDARD_PREFIX)) {
    const t = await getMessageTemplate(ctx, tenantId, preferredId);
    if (t && t.active && t.kind === kind && t.channel === channel) return t;
  }
  const own = await defaultTemplateRow(ctx, tenantId, kind, channel);
  if (own) return own;
  const s = standardMessageTemplate(kind, channel);
  return s ? fromStandard(tenantId, s, true) : null;
}

/** The query that takes the default flag off the other templates of a kind and channel (sent in a batch). */
function clearDefaultQuery(ctx: DbContext, tenantId: string, kind: string, channel: string, exceptId: string) {
  return ctx.db
    .updateTable(T)
    .set({ is_default: 0 })
    .where("tenant_id", "=", tenantId)
    .where("kind", "=", kind)
    .where("channel", "=", channel)
    .where("is_default", "=", 1)
    .where("id", "!=", exceptId);
}

export async function createMessageTemplate(ctx: DbContext, tenantId: string, input: MessageTemplateInput, actor: PmsActor): Promise<MessageTemplate> {
  assertTenantId(tenantId);
  const d = parseInput(MessageTemplateInputSchema, input, "Message template");
  const id = pmsId(P.messageTemplate, ctx);
  const at = nowIso(ctx);
  const isDefault = Boolean(d.isDefault) && d.active !== false;
  await writeWithAudit(
    ctx,
    [
      ...(isDefault ? [clearDefaultQuery(ctx, tenantId, d.kind, d.channel, id)] : []),
      ctx.db.insertInto(T).values({
        tenant_id: tenantId,
        id,
        rev: 1,
        kind: d.kind,
        channel: d.channel,
        name: d.name,
        subject: d.channel === "email" ? (d.subject ?? null) : null,
        body: d.body,
        is_default: b01(isDefault),
        active: b01(d.active ?? true),
        import_ref: d.importRef ?? null,
        created_by: actor.userId,
        created_at: at,
        updated_at: at,
      }),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.message_template.create", targetType: "pms_message_template", targetId: id, detail: { kind: d.kind, channel: d.channel, isDefault } }),
    ],
    MESSAGES,
  );
  return (await getMessageTemplate(ctx, tenantId, id)) as MessageTemplate;
}

/** A copy of a standard template the clinic can change (it becomes the default for its kind and channel). */
export async function copyStandardTemplate(ctx: DbContext, tenantId: string, key: string, actor: PmsActor, name?: string): Promise<MessageTemplate> {
  const s = standardMessageTemplateByKey(key);
  if (!s) throw new RepoInputError("There is no standard template with that name.");
  return createMessageTemplate(ctx, tenantId, { kind: s.kind, channel: s.channel, name: name ?? `${s.name} – our version`, subject: s.subject, body: s.body, isDefault: true }, actor);
}

/**
 * Changes a template with the revision the editor saw. Kind and channel never change. Making it the default
 * takes the flag off the others of its kind and channel in the same batch; switching it off takes its own flag
 * off (the standard template is used again).
 */
export async function updateMessageTemplate(ctx: DbContext, tenantId: string, id: string, expectedRev: number, patch: MessageTemplatePatch, actor: PmsActor): Promise<PmsSaveResult> {
  assertTenantId(tenantId);
  if (id.startsWith(STANDARD_PREFIX)) throw new RepoInputError("Standard templates cannot be changed: make a copy first.");
  if (!Number.isInteger(expectedRev) || expectedRev < 1) throw new RepoInputError("expectedRev must be a positive whole number.");
  const d = parseInput(MessageTemplatePatchSchema, patch, "Message template");
  const current = await getMessageTemplate(ctx, tenantId, id);
  if (!current) return { ok: false, reason: "not_found" };
  if (current.rev !== expectedRev) return { ok: false, reason: "conflict", currentRev: current.rev };
  const subject = current.channel === "email" ? (d.subject === undefined ? current.subject : d.subject) : null;
  const body = d.body ?? current.body;
  parseInput(messageTemplateCheck(current.kind, current.channel), { subject, body }, "Message template");
  const active = d.active ?? current.active;
  const isDefault = active && (d.isDefault ?? current.isDefault);
  const fields = Object.keys(d).filter((k) => (d as Record<string, unknown>)[k] !== undefined);
  if (fields.length === 0) return { ok: true, rev: expectedRev, updatedAt: current.updatedAt ?? "" };
  const at = nowIso(ctx);
  const update = ctx.db
    .updateTable(T)
    .set({ name: d.name ?? current.name, subject, body, active: b01(active), is_default: b01(isDefault), rev: expectedRev + 1, updated_at: at })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .where("rev", "=", expectedRev);
  // The flag comes off the others only while this row still has the revision the editor saw.
  const clear = isDefault && !current.isDefault
    ? [
        clearDefaultQuery(ctx, tenantId, current.kind, current.channel, id).where((eb) =>
          eb.exists(eb.selectFrom("pms_message_templates as cur").select("cur.id").where("cur.tenant_id", "=", tenantId).where("cur.id", "=", id).where("cur.rev", "=", expectedRev)),
        ),
      ]
    : [];
  let changed = false;
  try {
    const results = await runBatch(ctx.db, [...clear, update]);
    changed = Number(results[results.length - 1]?.numAffectedRows ?? 0) > 0;
  } catch (err) {
    throw translateDbError(err, MESSAGES);
  }
  if (!changed) {
    const now = await getMessageTemplate(ctx, tenantId, id);
    return now ? { ok: false, reason: "conflict", currentRev: now.rev } : { ok: false, reason: "not_found" };
  }
  await pmsAudit(ctx, tenantId, actor, { action: "pms.message_template.update", targetType: "pms_message_template", targetId: id, detail: { fields, rev: expectedRev + 1, isDefault } });
  return { ok: true, rev: expectedRev + 1, updatedAt: at };
}

/** Whether a template id is usable as a reminder rule's template for a channel. */
export async function isReminderTemplate(ctx: DbContext, tenantId: string, id: string, channel: MessageChannel): Promise<boolean> {
  const t = await guarded(() => getMessageTemplate(ctx, tenantId, id));
  return Boolean(t && !t.standard && t.active && t.kind === "reminder" && t.channel === channel);
}
