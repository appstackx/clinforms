/**
 * `pms_intake_device_pairings` (0190, M10 H3) – a clinic device is PAIRED with a hand-off by a short code:
 *
 * - the member of staff asks for a code on their own screen (`setPairingCode`: a new code replaces the earlier one
 *   while the device is not paired yet) – only the code's SHA-256 is stored, valid PAIR minutes;
 * - the device, a browser that is NOT signed in, enters it on /clinics/<clinic>/device (`pairDevice`): while the code
 *   is unexpired and unused and the hand-off is still open, the pairing is marked used and the hand-off's token_hash
 *   becomes the hash of the device's own new secret – in one batch, with its audit row. A code works once.
 *
 * No staff session or cookie is ever placed on the device.
 */
import type { PmsActor } from "../../../../modules/pms/core/types";
import type { BatchQuery } from "../../../db/batch";
import { RepoInputError, assertId, assertTenantId, nowIso, type DbContext } from "../context";
import { changeWithAudit, newPortalWriteId, portalAuditWhen } from "./shared";

const T = "pms_intake_device_pairings";
const H = "pms_intake_handoffs";
const HASH = /^[0-9a-f]{64}$/;

export interface DevicePairing {
  handoffId: string;
  expiresAt: string;
  pairedAt: string | null;
}

function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
}

export async function getPairing(ctx: DbContext, tenantId: string, handoffId: string): Promise<DevicePairing | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom(T).select(["handoff_id", "expires_at", "paired_at"]).where("tenant_id", "=", tenantId).where("handoff_id", "=", handoffId).executeTakeFirst();
  return row ? { handoffId: row.handoff_id, expiresAt: iso(row.expires_at) as string, pairedAt: iso(row.paired_at) } : null;
}

/**
 * Gives an OPEN hand-off a new pairing code (its hash), valid until `expiresAt`; the earlier code stops working.
 * Refused (false) once a device is paired or the hand-off is no longer open. Audited (no code).
 */
export async function setPairingCode(ctx: DbContext, tenantId: string, handoffId: string, codeHash: string, expiresAt: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(handoffId, "hand-off id");
  if (!HASH.test(codeHash)) throw new RepoInputError("The pairing code must be a SHA-256 hash.");
  if (!actor.userId) throw new RepoInputError("Only a member of staff can pair a clinic device.");
  const at = nowIso(ctx);
  const writeId = newPortalWriteId(ctx);
  const open = ctx.db.selectFrom(H).select("id").where("tenant_id", "=", tenantId).where("id", "=", handoffId).where("status", "=", "open").where("expires_at", ">", at);
  const existing = await getPairing(ctx, tenantId, handoffId);
  if (existing?.pairedAt) return false;
  const written = ctx.db.selectFrom(T).select("handoff_id").where("tenant_id", "=", tenantId).where("handoff_id", "=", handoffId).where("write_id", "=", writeId);
  const change: BatchQuery = existing
    ? ctx.db
        .updateTable(T)
        .set({ code_hash: codeHash, expires_at: expiresAt, write_id: writeId, updated_at: at })
        .where("tenant_id", "=", tenantId)
        .where("handoff_id", "=", handoffId)
        .where("paired_at", "is", null)
        .where((eb) => eb.exists(open))
    : (() => {
        const row = { tenant_id: tenantId, handoff_id: handoffId, code_hash: codeHash, expires_at: expiresAt, paired_at: null, write_id: writeId, created_at: at, updated_at: at };
        const columns = Object.keys(row) as (keyof typeof row)[];
        return ctx.db
          .insertInto(T)
          .columns(columns)
          .expression(ctx.db.selectNoFrom((eb) => columns.map((c) => eb.val(row[c]).as(c)) as never).where((eb) => eb.exists(open)) as never);
      })();
  const changed = await changeWithAudit(
    ctx,
    [change, portalAuditWhen(ctx, tenantId, actor, { action: "pms.intake_handoff.pair_code", targetType: "pms_intake_handoff", targetId: handoffId, detail: { expiresAt } }, written)],
    0,
    { unique: "Please ask for another code." },
  );
  return changed > 0;
}

/**
 * The device enters a code: pairs it (once) with the open hand-off the code belongs to – the hand-off's token_hash
 * becomes `deviceTokenHash`. Answers the hand-off id, or null (wrong, used or expired code; hand-off not open).
 */
export async function pairDevice(ctx: DbContext, tenantId: string, codeHash: string, deviceTokenHash: string): Promise<string | null> {
  assertTenantId(tenantId);
  if (!HASH.test(codeHash) || !HASH.test(deviceTokenHash)) return null;
  const at = nowIso(ctx);
  const row = await ctx.db.selectFrom(T).select(["handoff_id"]).where("tenant_id", "=", tenantId).where("code_hash", "=", codeHash).where("paired_at", "is", null).where("expires_at", ">", at).executeTakeFirst();
  if (!row) return null;
  const handoffId = row.handoff_id;
  const writeId = newPortalWriteId(ctx);
  const open = ctx.db.selectFrom(H).select("id").where("tenant_id", "=", tenantId).where("id", "=", handoffId).where("status", "=", "open").where("expires_at", ">", at);
  const written = ctx.db.selectFrom(T).select("handoff_id").where("tenant_id", "=", tenantId).where("handoff_id", "=", handoffId).where("write_id", "=", writeId);
  const device: PmsActor = { userId: null, sessionId: handoffId };
  const changed = await changeWithAudit(
    ctx,
    [
      ctx.db
        .updateTable(T)
        .set({ paired_at: at, write_id: writeId, updated_at: at })
        .where("tenant_id", "=", tenantId)
        .where("handoff_id", "=", handoffId)
        .where("code_hash", "=", codeHash)
        .where("paired_at", "is", null)
        .where("expires_at", ">", at)
        .where((eb) => eb.exists(open)),
      ctx.db
        .updateTable(H)
        .set({ token_hash: deviceTokenHash, updated_at: at })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", handoffId)
        .where((eb) => eb.exists(written)),
      portalAuditWhen(ctx, tenantId, device, { action: "pms.intake_handoff.paired", targetType: "pms_intake_handoff", targetId: handoffId, detail: { via: "clinic_device" } }, written),
    ],
    0,
  );
  return changed > 0 ? handoffId : null;
}
