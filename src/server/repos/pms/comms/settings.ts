/**
 * `pms_comms_settings` – one row per clinic: booking confirmations and change notices on or off per channel,
 * the text sender name, the phone and email patients reply to, YES/NO replies, quiet hours for texts.
 * No row = the defaults (src/modules/pms/comms/defaults.ts). Updates carry the revision the editor saw.
 */
import { DEFAULT_COMMS_SETTINGS } from "../../../../modules/pms/comms/defaults";
import { CommsSettingsInputSchema, type CommsSettingsInput } from "../../../../modules/pms/comms/schemas";
import type { CommsSettings } from "../../../../modules/pms/comms/types";
import type { PmsActor, PmsSaveResult } from "../../../../modules/pms/core/types";
import { RepoInputError, assertTenantId, b01, isOn, nowIso, num, parseInput, pmsAuditQuery, writeWithAudit, type DbContext } from "../context";
import { changeWithAudit, commsAuditWhen } from "./shared";

const T = "pms_comms_settings";

export async function getCommsSettings(ctx: DbContext, tenantId: string): Promise<CommsSettings> {
  assertTenantId(tenantId);
  const r = await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).executeTakeFirst();
  if (!r) return { tenantId, ...DEFAULT_COMMS_SETTINGS };
  return {
    tenantId: r.tenant_id,
    rev: num(r.rev),
    confirmationsSms: isOn(r.confirmations_sms),
    confirmationsEmail: isOn(r.confirmations_email),
    changeNotices: isOn(r.change_notices),
    dnaFollowUp: isOn(r.dna_follow_up),
    smsSender: r.sms_sender,
    replyPhone: r.reply_phone,
    replyEmail: r.reply_email,
    repliesEnabled: isOn(r.replies_enabled),
    quietStart: r.quiet_start,
    quietEnd: r.quiet_end,
    updatedAt: r.updated_at,
  };
}

/**
 * Saves the settings with the revision the editor saw (0 = none saved yet). A stale form gets "conflict" and
 * changes nothing.
 */
export async function updateCommsSettings(ctx: DbContext, tenantId: string, expectedRev: number, input: CommsSettingsInput, actor: PmsActor): Promise<PmsSaveResult> {
  assertTenantId(tenantId);
  if (!Number.isInteger(expectedRev) || expectedRev < 0) throw new RepoInputError("expectedRev must be a whole number.");
  const d = parseInput(CommsSettingsInputSchema, input, "Message settings");
  const current = await getCommsSettings(ctx, tenantId);
  if (current.rev !== expectedRev) return { ok: false, reason: "conflict", currentRev: current.rev };
  const next = {
    confirmations_sms: b01(d.confirmationsSms ?? current.confirmationsSms),
    confirmations_email: b01(d.confirmationsEmail ?? current.confirmationsEmail),
    change_notices: b01(d.changeNotices ?? current.changeNotices),
    dna_follow_up: b01(d.dnaFollowUp ?? current.dnaFollowUp),
    sms_sender: d.smsSender === undefined ? current.smsSender : d.smsSender,
    reply_phone: d.replyPhone === undefined ? current.replyPhone : d.replyPhone,
    reply_email: d.replyEmail === undefined ? current.replyEmail : d.replyEmail,
    replies_enabled: b01(d.repliesEnabled ?? current.repliesEnabled),
    quiet_start: d.quietStart ?? current.quietStart,
    quiet_end: d.quietEnd ?? current.quietEnd,
  };
  const fields = Object.keys(d).filter((k) => (d as Record<string, unknown>)[k] !== undefined);
  const at = nowIso(ctx);
  const audit = { action: "pms.comms_settings.update", targetType: "pms_comms_settings", targetId: tenantId, detail: { fields, rev: expectedRev + 1 } };
  if (expectedRev === 0) {
    try {
      await writeWithAudit(ctx, [
        ctx.db.insertInto(T).values({ tenant_id: tenantId, rev: 1, ...next, updated_by: actor.userId, created_at: at, updated_at: at }),
        pmsAuditQuery(ctx, tenantId, actor, audit),
      ]);
    } catch (err) {
      if (err instanceof RepoInputError) {
        const now = await getCommsSettings(ctx, tenantId);
        return { ok: false, reason: "conflict", currentRev: now.rev };
      }
      throw err;
    }
    return { ok: true, rev: 1, updatedAt: at };
  }
  const changed = await changeWithAudit(ctx, [
    ctx.db
      .updateTable(T)
      .set({ ...next, rev: expectedRev + 1, updated_by: actor.userId, updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("rev", "=", expectedRev),
    commsAuditWhen(ctx, tenantId, actor, audit, ctx.db.selectFrom(T).select("tenant_id").where("tenant_id", "=", tenantId).where("rev", "=", expectedRev + 1).where("updated_at", "=", at)),
  ]);
  if (changed === 0) {
    const now = await getCommsSettings(ctx, tenantId);
    return { ok: false, reason: "conflict", currentRev: now.rev };
  }
  return { ok: true, rev: expectedRev + 1, updatedAt: at };
}
