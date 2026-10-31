/**
 * How the patient's part of an insured visit is billed (migration 0137, Khuram's decision 28/10/2026): per payer
 * account (`pms_payer_billing_terms`) with an override per case (`pms_case_billing_terms`, NULL = as the account).
 * No row = the default, "excess per case". The amount is the case's excess. Rows are changed, never deleted;
 * every change is audited in the same batch. The modes themselves: src/modules/pms/billing/excess.ts.
 */
import { DEFAULT_CONTRIBUTION_MODE, effectiveContributionMode, isContributionMode, type ContributionMode } from "../../../../modules/pms/billing/excess";
import type { PmsActor } from "../../../../modules/pms/core/types";
import { RepoInputError, assertId, assertTenantId, nowIso, pmsAuditQuery, writeWithAudit, type RepoContext } from "../context";
import { chunks } from "./shared";

const PAYER = "pms_payer_billing_terms";
const CASE = "pms_case_billing_terms";

/** The payer accounts' own modes (accounts without a row are left out: they use the default). */
export async function payerContributionModes(ctx: RepoContext, tenantId: string, referrerIds?: readonly string[]): Promise<Map<string, ContributionMode>> {
  assertTenantId(tenantId);
  const out = new Map<string, ContributionMode>();
  if (referrerIds === undefined) {
    const rows = await ctx.db.selectFrom(PAYER).select(["referrer_id", "contribution_mode"]).where("tenant_id", "=", tenantId).limit(2000).execute();
    for (const r of rows) if (isContributionMode(r.contribution_mode)) out.set(r.referrer_id, r.contribution_mode);
    return out;
  }
  for (const group of chunks(Array.from(new Set(referrerIds)))) {
    if (group.length === 0) continue;
    const rows = await ctx.db.selectFrom(PAYER).select(["referrer_id", "contribution_mode"]).where("tenant_id", "=", tenantId).where("referrer_id", "in", group).execute();
    for (const r of rows) if (isContributionMode(r.contribution_mode)) out.set(r.referrer_id, r.contribution_mode);
  }
  return out;
}

/** Cases' own overrides (a case without one – or with NULL – follows its payer account). */
export async function caseContributionOverrides(ctx: RepoContext, tenantId: string, caseIds: readonly string[]): Promise<Map<string, ContributionMode>> {
  assertTenantId(tenantId);
  const out = new Map<string, ContributionMode>();
  for (const group of chunks(Array.from(new Set(caseIds)))) {
    if (group.length === 0) continue;
    const rows = await ctx.db.selectFrom(CASE).select(["case_id", "contribution_mode"]).where("tenant_id", "=", tenantId).where("case_id", "in", group).execute();
    for (const r of rows) if (isContributionMode(r.contribution_mode)) out.set(r.case_id, r.contribution_mode);
  }
  return out;
}

/** The mode each case bills with (its override → its payer account's → the default). */
export async function contributionModesForCases(ctx: RepoContext, tenantId: string, cases: readonly { id: string; payerReferrerId: string | null }[]): Promise<Map<string, ContributionMode>> {
  const [own, payers] = await Promise.all([
    caseContributionOverrides(
      ctx,
      tenantId,
      cases.map((c) => c.id),
    ),
    payerContributionModes(
      ctx,
      tenantId,
      cases.map((c) => c.payerReferrerId).filter((r): r is string => typeof r === "string"),
    ),
  ]);
  return new Map(cases.map((c) => [c.id, effectiveContributionMode(own.get(c.id), c.payerReferrerId ? payers.get(c.payerReferrerId) : null)]));
}

/** One case's mode, and where it comes from. */
export async function contributionModeForCase(
  ctx: RepoContext,
  tenantId: string,
  caseId: string,
  payerReferrerId: string | null,
): Promise<{ mode: ContributionMode; source: "case" | "payer" | "default"; payerMode: ContributionMode }> {
  const own = (await caseContributionOverrides(ctx, tenantId, [caseId])).get(caseId) ?? null;
  const payer = payerReferrerId ? ((await payerContributionModes(ctx, tenantId, [payerReferrerId])).get(payerReferrerId) ?? null) : null;
  return { mode: effectiveContributionMode(own, payer), source: own ? "case" : payer ? "payer" : "default", payerMode: payer ?? DEFAULT_CONTRIBUTION_MODE };
}

/** Sets a payer account's mode (insurer, MLC company, solicitor, employer…). */
export async function setPayerContributionMode(ctx: RepoContext, tenantId: string, referrerId: string, mode: ContributionMode, actor: PmsActor): Promise<void> {
  assertTenantId(tenantId);
  assertId(referrerId, "payer account id");
  if (!isContributionMode(mode)) throw new RepoInputError("Choose how the patient's part is billed.");
  const at = nowIso(ctx);
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .insertInto(PAYER)
        .values({ tenant_id: tenantId, referrer_id: referrerId, rev: 1, contribution_mode: mode, updated_by: actor.userId, created_at: at, updated_at: at })
        .onConflict((oc) => oc.columns(["tenant_id", "referrer_id"]).doUpdateSet((eb) => ({ contribution_mode: mode, rev: eb(`${PAYER}.rev`, "+", 1), updated_by: actor.userId, updated_at: at }))),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.payer_terms.set", targetType: "pms_referrer", targetId: referrerId, detail: { mode } }),
    ],
    { foreignKey: "That payer account does not exist in this clinic." },
  );
}

/** Sets a case's own mode, or (null) makes it follow its payer account again. */
export async function setCaseContributionMode(ctx: RepoContext, tenantId: string, caseId: string, mode: ContributionMode | null, actor: PmsActor): Promise<void> {
  assertTenantId(tenantId);
  assertId(caseId, "case id");
  if (mode !== null && !isContributionMode(mode)) throw new RepoInputError("Choose how the patient's part is billed.");
  const at = nowIso(ctx);
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .insertInto(CASE)
        .values({ tenant_id: tenantId, case_id: caseId, rev: 1, contribution_mode: mode, updated_by: actor.userId, created_at: at, updated_at: at })
        .onConflict((oc) => oc.columns(["tenant_id", "case_id"]).doUpdateSet((eb) => ({ contribution_mode: mode, rev: eb(`${CASE}.rev`, "+", 1), updated_by: actor.userId, updated_at: at }))),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.case_terms.set", targetType: "pms_case", targetId: caseId, detail: { mode: mode ?? "payer" } }),
    ],
    { foreignKey: "That case does not exist in this clinic." },
  );
}
