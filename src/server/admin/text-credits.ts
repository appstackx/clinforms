/**
 * Text credits on the platform page (ClinForms staff only – /app/platform/text-credits): every clinic's balance and
 * settings, one clinic's history, and the support ADJUSTMENT (+ or − credits with a reason – goodwill, a refund
 * made by hand at the card payment service, a correction). Audited twice, like a package switch: the ledger entry and
 * `pms.sms_credit.adjust` in the clinic's own trail (by "ClinForms support"), `platform.sms_credit_adjust` in the
 * platform's trail (by the administrator). A negative adjustment never takes the balance below 0.
 */
import "server-only";
import type { Kysely } from "kysely";
import { CreditAdjustmentSchema } from "../../modules/pms/comms/credits";
import type { Database } from "../db/schema";
import { PLATFORM_USER_ID } from "../auth/create-auth";
import { RepoInputError, parseInput } from "../repos/pms/context";
import { adjustSmsCredits, getSmsCreditAccounts, ledgerCheck, listSmsCreditEntries, type SmsCreditAccount, type SmsCreditEntry } from "../repos/pms/comms/credits";
import { isMissingPmsTable } from "../pms/missing-table";
import { appendPlatformAudit, type PlatformAdmin } from "./platform-console";

export interface PlatformCreditRow {
  tenantId: string;
  name: string;
  account: SmsCreditAccount | null;
}

/** The open clinics' accounts (a clinic without one reads as no account). A database before 0143 reads as none. */
export async function listTextCreditsForPlatform(db: Kysely<Database>, clinics: readonly { tenantId: string; name: string }[]): Promise<{ available: boolean; rows: PlatformCreditRow[] }> {
  try {
    const accounts = await getSmsCreditAccounts({ db }, clinics.map((c) => c.tenantId));
    return { available: true, rows: clinics.map((c) => ({ ...c, account: accounts.get(c.tenantId) ?? null })) };
  } catch (err) {
    if (isMissingPmsTable(err, "pms_sms_credit_accounts")) return { available: false, rows: clinics.map((c) => ({ ...c, account: null })) };
    throw err;
  }
}

export async function clinicCreditHistory(db: Kysely<Database>, tenantId: string): Promise<{ entries: SmsCreditEntry[]; check: Awaited<ReturnType<typeof ledgerCheck>> }> {
  const [entries, check] = await Promise.all([listSmsCreditEntries({ db }, tenantId, { limit: 200 }), ledgerCheck({ db }, tenantId)]);
  return { entries, check };
}

export async function adjustTextCreditsAsPlatform(
  db: Kysely<Database>,
  admin: PlatformAdmin,
  input: { tenantId: string; credits: unknown; reason: unknown; requestId?: string | null },
): Promise<{ balance: number }> {
  const d = parseInput(CreditAdjustmentSchema, { credits: input.credits, reason: input.reason }, "Adjustment");
  const org = await db.selectFrom("organization").select(["id", "metadata"]).where("slug", "=", input.tenantId).executeTakeFirst();
  if (!org) throw new RepoInputError(`No clinic with the id "${input.tenantId}".`);
  if (org.metadata && /"offboardedAt"/.test(org.metadata)) throw new RepoInputError("That clinic account is closed.");
  // Review fix 31/10/2026: the form's one-time id makes a double submit one adjustment ("already recorded").
  const r = await adjustSmsCredits({ db }, input.tenantId, d, { userId: PLATFORM_USER_ID, sessionId: null }, { by: "platform" }, { requestId: input.requestId ?? null });
  if (!r.ok) throw new RepoInputError(r.reason === "insufficient" ? "The clinic does not have that many credits – an adjustment never takes the balance below 0." : "That adjustment was already recorded.");
  await appendPlatformAudit({ db }, admin, {
    action: "platform.sms_credit_adjust",
    targetType: "organization",
    targetId: org.id,
    detail: { tenantId: input.tenantId, credits: d.credits, entryId: r.entryId, balance: r.balance },
  });
  return { balance: r.balance };
}
