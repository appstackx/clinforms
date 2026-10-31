/**
 * `pms_reminder_rules` – when reminders go: "N hours before" or "N days before at HH:MM", by text or email, for
 * every appointment type or some. Never deleted (switched off). A rule's template must be one of the clinic's
 * reminder templates of the same channel; a text's send time may not fall in the quiet hours.
 */
import type { Selectable } from "kysely";
import { COMMS_ID_PREFIXES as P } from "../../../../modules/pms/comms/ids";
import { isQuietTime } from "../../../../modules/pms/comms/schedule";
import { ReminderRuleInputSchema, ReminderRuleMergedSchema, ReminderRulePatchSchema, type ReminderRuleInput, type ReminderRulePatch } from "../../../../modules/pms/comms/schemas";
import type { MessageChannel, ReminderRule, ReminderTiming } from "../../../../modules/pms/comms/types";
import type { PmsActor, PmsSaveResult } from "../../../../modules/pms/core/types";
import type { PmsReminderRulesTable } from "../../../db/pms-schema/comms";
import { RepoInputError, assertTenantId, b01, isOn, nowIso, num, numOrNull, parseInput, pmsAuditQuery, pmsId, writeWithAudit, type DbContext } from "../context";
import { getCommsSettings } from "./settings";
import { changeWithAudit, commsAuditWhen } from "./shared";
import { isReminderTemplate } from "./templates";

const T = "pms_reminder_rules";
const MESSAGES = { unique: "A reminder with this name already exists.", foreignKey: "The template does not exist in this clinic." };

function parseIds(json: string | null): string[] | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;
  } catch {
    return null;
  }
}

function toRule(r: Selectable<PmsReminderRulesTable>): ReminderRule {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    rev: num(r.rev),
    name: r.name,
    channel: r.channel as MessageChannel,
    timing: r.timing as ReminderTiming,
    hoursBefore: numOrNull(r.hours_before),
    daysBefore: numOrNull(r.days_before),
    sendAt: r.send_at,
    templateId: r.template_id,
    serviceIds: parseIds(r.service_ids_json),
    active: isOn(r.active),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface RuleShape {
  channel: MessageChannel;
  timing: ReminderTiming;
  hoursBefore?: number | null;
  daysBefore?: number | null;
  sendAt?: string | null;
  templateId?: string | null;
  serviceIds?: string[] | null;
}

/** The checks that need the database: template, appointment types, quiet hours. */
async function checkAgainstClinic(ctx: DbContext, tenantId: string, rule: RuleShape): Promise<void> {
  if (rule.templateId && !(await isReminderTemplate(ctx, tenantId, rule.templateId, rule.channel))) {
    throw new RepoInputError(`Reminder: choose one of the clinic's active reminder templates for ${rule.channel === "sms" ? "texts" : "emails"}.`);
  }
  if (rule.serviceIds && rule.serviceIds.length > 0) {
    const unique = Array.from(new Set(rule.serviceIds));
    const found = await ctx.db.selectFrom("pms_services").select("id").where("tenant_id", "=", tenantId).where("id", "in", unique).execute();
    if (found.length !== unique.length) throw new RepoInputError("Reminder: an appointment type does not exist in this clinic.");
  }
  if (rule.channel === "sms" && rule.timing === "days_before" && rule.sendAt) {
    const s = await getCommsSettings(ctx, tenantId);
    if (isQuietTime(rule.sendAt, s.quietStart, s.quietEnd)) throw new RepoInputError(`Reminder: choose a time outside the quiet hours for texts (${s.quietStart}–${s.quietEnd}).`);
  }
}

function columns(d: RuleShape) {
  const hours = d.timing === "hours_before";
  return {
    channel: d.channel,
    timing: d.timing,
    hours_before: hours ? (d.hoursBefore ?? null) : null,
    days_before: hours ? null : (d.daysBefore ?? null),
    send_at: hours ? null : (d.sendAt ?? null),
    template_id: d.templateId ?? null,
    service_ids_json: d.serviceIds && d.serviceIds.length > 0 ? JSON.stringify(Array.from(new Set(d.serviceIds))) : null,
  };
}

export async function createReminderRule(ctx: DbContext, tenantId: string, input: ReminderRuleInput, actor: PmsActor): Promise<ReminderRule> {
  assertTenantId(tenantId);
  const d = parseInput(ReminderRuleInputSchema, input, "Reminder");
  await checkAgainstClinic(ctx, tenantId, d);
  const id = pmsId(P.reminderRule, ctx);
  const at = nowIso(ctx);
  await writeWithAudit(
    ctx,
    [
      ctx.db.insertInto(T).values({ tenant_id: tenantId, id, rev: 1, name: d.name, ...columns(d), active: b01(d.active ?? true), created_by: actor.userId, created_at: at, updated_at: at }),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.reminder_rule.create", targetType: "pms_reminder_rule", targetId: id, detail: { channel: d.channel, timing: d.timing } }),
    ],
    MESSAGES,
  );
  return (await getReminderRule(ctx, tenantId, id)) as ReminderRule;
}

export async function updateReminderRule(ctx: DbContext, tenantId: string, id: string, expectedRev: number, patch: ReminderRulePatch, actor: PmsActor): Promise<PmsSaveResult> {
  assertTenantId(tenantId);
  if (!Number.isInteger(expectedRev) || expectedRev < 1) throw new RepoInputError("expectedRev must be a positive whole number.");
  const d = parseInput(ReminderRulePatchSchema, patch, "Reminder");
  const current = await getReminderRule(ctx, tenantId, id);
  if (!current) return { ok: false, reason: "not_found" };
  if (current.rev !== expectedRev) return { ok: false, reason: "conflict", currentRev: current.rev };
  const merged = parseInput(
    ReminderRuleMergedSchema,
    {
      name: d.name ?? current.name,
      channel: d.channel ?? current.channel,
      timing: d.timing ?? current.timing,
      hoursBefore: d.hoursBefore === undefined ? current.hoursBefore : d.hoursBefore,
      daysBefore: d.daysBefore === undefined ? current.daysBefore : d.daysBefore,
      sendAt: d.sendAt === undefined ? current.sendAt : d.sendAt,
      templateId: d.templateId === undefined ? current.templateId : d.templateId,
      serviceIds: d.serviceIds === undefined ? current.serviceIds : d.serviceIds,
      active: d.active ?? current.active,
    },
    "Reminder",
  );
  await checkAgainstClinic(ctx, tenantId, merged);
  const fields = Object.keys(d).filter((k) => (d as Record<string, unknown>)[k] !== undefined);
  if (fields.length === 0) return { ok: true, rev: expectedRev, updatedAt: current.updatedAt };
  const at = nowIso(ctx);
  const changed = await changeWithAudit(
    ctx,
    [
      ctx.db
        .updateTable(T)
        .set({ name: merged.name, ...columns(merged), active: b01(merged.active ?? true), rev: expectedRev + 1, updated_at: at })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id)
        .where("rev", "=", expectedRev),
      commsAuditWhen(
        ctx,
        tenantId,
        actor,
        { action: "pms.reminder_rule.update", targetType: "pms_reminder_rule", targetId: id, detail: { fields, rev: expectedRev + 1 } },
        ctx.db.selectFrom(T).select("id").where("tenant_id", "=", tenantId).where("id", "=", id).where("rev", "=", expectedRev + 1).where("updated_at", "=", at),
      ),
    ],
    0,
    MESSAGES,
  );
  if (changed === 0) {
    const now = await getReminderRule(ctx, tenantId, id);
    return now ? { ok: false, reason: "conflict", currentRev: now.rev } : { ok: false, reason: "not_found" };
  }
  return { ok: true, rev: expectedRev + 1, updatedAt: at };
}

export async function getReminderRule(ctx: DbContext, tenantId: string, id: string): Promise<ReminderRule | null> {
  assertTenantId(tenantId);
  const r = await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return r ? toRule(r) : null;
}

export async function listReminderRules(ctx: DbContext, tenantId: string, options: { activeOnly?: boolean } = {}): Promise<ReminderRule[]> {
  assertTenantId(tenantId);
  let q = ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId);
  if (options.activeOnly) q = q.where("active", "=", 1);
  return (await q.orderBy("channel").orderBy("name").limit(100).execute()).map(toRule);
}
