/**
 * Payer words for the diary's screens: "Self-pay", or the payer account's name ("Bluewell Health (fictional)"),
 * with the excess when the case has one. Reads names only (never a referrer's notes). Server only.
 */
import "server-only";
import { formatPence } from "../../../modules/pms/core/text";
import type { CaseSummary } from "../../../modules/pms/core/types";
import { PAYER_TYPE_LABELS } from "../../../modules/pms/records/copy";
import type { RepoContext } from "../../repos/context";

/** Names of payer accounts by id (groups of 90 ids – D1's parameter limit). */
export async function referrerNames(ctx: RepoContext, tenantId: string, ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(new Set(ids));
  for (let i = 0; i < unique.length; i += 90) {
    const rows = await ctx.db.selectFrom("pms_referrers").select(["id", "name"]).where("tenant_id", "=", tenantId).where("id", "in", unique.slice(i, i + 90)).execute();
    for (const r of rows) out.set(r.id, r.name);
  }
  return out;
}

/** "Self-pay", "Bluewell Health (fictional)", "Bluewell Health (fictional) – excess £20.00", or the payer type. */
export function payerLabel(c: Pick<CaseSummary, "payerType" | "payerReferrerId">, names: ReadonlyMap<string, string>, excessPence?: number | null): string {
  if (c.payerType === "self_pay") return PAYER_TYPE_LABELS.self_pay;
  const name = (c.payerReferrerId ? names.get(c.payerReferrerId) : undefined) ?? PAYER_TYPE_LABELS[c.payerType] ?? "Payer";
  return typeof excessPence === "number" && excessPence > 0 ? `${name} – excess ${formatPence(excessPence)}` : name;
}

/** Payer words for the cases of a list of appointments (case id → label). */
export async function payerLabelsForCases(ctx: RepoContext, tenantId: string, caseIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(new Set(caseIds));
  if (unique.length === 0) return out;
  const cases: { id: string; payer_type: string; payer_referrer_id: string | null }[] = [];
  for (let i = 0; i < unique.length; i += 90) {
    cases.push(...(await ctx.db.selectFrom("pms_cases").select(["id", "payer_type", "payer_referrer_id"]).where("tenant_id", "=", tenantId).where("id", "in", unique.slice(i, i + 90)).execute()));
  }
  const names = await referrerNames(ctx, tenantId, cases.map((c) => c.payer_referrer_id).filter((id): id is string => id !== null));
  for (const c of cases) out.set(c.id, payerLabel({ payerType: c.payer_type as CaseSummary["payerType"], payerReferrerId: c.payer_referrer_id }, names));
  return out;
}
