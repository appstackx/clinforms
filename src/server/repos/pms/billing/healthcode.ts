/**
 * Healthcode e-billing groundwork (migrations 0220–0229, docs/clinic-system/healthcode.md): the identifiers and codes
 * a clinic records for its insurer bills. Every write is audited in the same batch (details name the fields set,
 * never their values); rows are upserted and changed, never deleted, except the per-insurer number and code mappings
 * which are removed when cleared.
 *
 * A release can reach a database before these migrations: every read answers "nothing set up yet" when its table does
 * not exist (isMissingPmsTable), and only a save fails until the migration is applied.
 */
import { PayerHealthcodeInputSchema, type PayerHealthcode, type PayerHealthcodeInput } from "../../../../modules/pms/billing/healthcode";
import type { PmsActor } from "../../../../modules/pms/core/types";
import { isMissingPmsTable } from "../../../pms/missing-table";
import { assertId, assertTenantId, nowIso, num, parseInput, pmsAuditQuery, writeWithAudit, type RepoContext } from "../context";
import { chunks } from "./shared";

const PAYER = "pms_payer_healthcode";

/** Runs a read; a table these migrations have not created yet reads as `empty`. */
export async function readOrEmpty<T>(table: string, empty: T, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (isMissingPmsTable(err, table)) return empty;
    throw err;
  }
}

/* ------------------------------------------------------------------------------------------------
 * HC06 – payer accounts: the insurer's Healthcode identifier and the clinic's provider number
 * ----------------------------------------------------------------------------------------------*/

function toPayer(r: { referrer_id: string; rev: unknown; insurer_code: string | null; provider_number: string | null; diagnosis_required: unknown; updated_at: string }): PayerHealthcode {
  const d = r.diagnosis_required;
  return {
    referrerId: r.referrer_id,
    rev: num(r.rev),
    insurerCode: r.insurer_code,
    providerNumber: r.provider_number,
    diagnosisRequired: d === null || d === undefined ? null : Number(d) === 1,
    updatedAt: String(r.updated_at),
  };
}

/** The payer accounts' Healthcode details (accounts without a row are left out). */
export async function payerHealthcodes(ctx: RepoContext, tenantId: string, referrerIds?: readonly string[]): Promise<Map<string, PayerHealthcode>> {
  assertTenantId(tenantId);
  return readOrEmpty(PAYER, new Map<string, PayerHealthcode>(), async () => {
    const out = new Map<string, PayerHealthcode>();
    const cols = ["referrer_id", "rev", "insurer_code", "provider_number", "diagnosis_required", "updated_at"] as const;
    if (referrerIds === undefined) {
      const rows = await ctx.db.selectFrom(PAYER).select(cols).where("tenant_id", "=", tenantId).limit(2000).execute();
      for (const r of rows) out.set(r.referrer_id, toPayer(r));
      return out;
    }
    for (const group of chunks(Array.from(new Set(referrerIds)))) {
      if (group.length === 0) continue;
      const rows = await ctx.db.selectFrom(PAYER).select(cols).where("tenant_id", "=", tenantId).where("referrer_id", "in", group).execute();
      for (const r of rows) out.set(r.referrer_id, toPayer(r));
    }
    return out;
  });
}

export async function getPayerHealthcode(ctx: RepoContext, tenantId: string, referrerId: string): Promise<PayerHealthcode | null> {
  assertId(referrerId, "payer account id");
  return (await payerHealthcodes(ctx, tenantId, [referrerId])).get(referrerId) ?? null;
}

/** Sets a payer account's Healthcode details (all three fields; null clears one). */
export async function setPayerHealthcode(ctx: RepoContext, tenantId: string, referrerId: string, input: PayerHealthcodeInput, actor: PmsActor): Promise<void> {
  assertTenantId(tenantId);
  assertId(referrerId, "payer account id");
  const d = parseInput(PayerHealthcodeInputSchema, input, "Healthcode details");
  const values = {
    insurer_code: d.insurerCode ?? null,
    provider_number: d.providerNumber ?? null,
    diagnosis_required: typeof d.diagnosisRequired === "boolean" ? (d.diagnosisRequired ? 1 : 0) : null,
  };
  const at = nowIso(ctx);
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .insertInto(PAYER)
        .values({ tenant_id: tenantId, referrer_id: referrerId, rev: 1, ...values, updated_by: actor.userId, created_at: at, updated_at: at })
        .onConflict((oc) => oc.columns(["tenant_id", "referrer_id"]).doUpdateSet((eb) => ({ ...values, rev: eb(`${PAYER}.rev`, "+", 1), updated_by: actor.userId, updated_at: at }))),
      pmsAuditQuery(ctx, tenantId, actor, {
        action: "pms.payer_healthcode.set",
        targetType: "pms_referrer",
        targetId: referrerId,
        detail: { insurerCode: values.insurer_code !== null, providerNumber: values.provider_number !== null, diagnosisRequired: values.diagnosis_required === null ? "default" : values.diagnosis_required === 1 },
      }),
    ],
    { foreignKey: "That payer account does not exist in this clinic." },
  );
}
