/**
 * The go-live clean-up for payments (review fix 31/10/2026, "test-mode credits leak into live"). Run ONCE when the
 * ClinDesk payment account switches to live payments, BEFORE CLINDESK_BILLING_LIVE=1 is deployed – and safe to run
 * again (every step is idempotent):
 *
 *   1. every clinic's TEST customer and saved card at the card payment service are forgotten (references only) and
 *      automatic top-up is switched off – a live payment never reuses a test customer or card;
 *   2. every text credit pack bought in test mode (mode 'test', or recorded before migration 0145 – there was no
 *      live mode then) that is not reversed yet is taken off again by a support adjustment naming it
 *      (reverses_id = the purchase, so a second run reverses nothing twice) with the reason
 *      "Test-mode payment reversed at go-live". When fewer credits are left than the pack added, what is left is
 *      taken off (the balance never goes below 0); credits already used in test mode cost nothing real;
 *   3. subscriptions made in test mode (./billing-go-live-subscriptions in src/server/billing) – see BILLING.md.
 *
 * Preview by default (nothing written); `confirm` applies it. Every change is audited in the clinic's trail and the
 * platform's ("platform.billing_go_live"), ids and counts only.
 */
import type { Kysely } from "kysely";
import { PLATFORM_USER_ID } from "../auth/create-auth";
import type { Database } from "../db/schema";
import { appendAudit } from "../repos/audit";
import { adjustSmsCredits, clearTestCreditCustomer, getSmsCreditAccount, listCreditAccountTenants, listUnreversedTestPurchases } from "../repos/pms/comms/credits";
import { isMissingPmsTable } from "../pms/missing-table";

export const GO_LIVE_REASON = "Test-mode payment reversed at go-live";
const SYSTEM = { userId: PLATFORM_USER_ID, sessionId: null };

export interface CreditGoLiveClinic {
  tenantId: string;
  hadTestCustomer: boolean;
  testPurchases: number;
  creditsToTakeOff: number;
  creditsTakenOff: number;
}

export interface CreditGoLiveResult {
  dryRun: boolean;
  available: boolean;
  clinics: CreditGoLiveClinic[];
}

export async function goLiveTextCredits(db: Kysely<Database>, options: { confirm?: boolean } = {}): Promise<CreditGoLiveResult> {
  const ctx = { db };
  let tenants: string[];
  try {
    tenants = await listCreditAccountTenants(ctx);
  } catch (err) {
    if (isMissingPmsTable(err, "pms_sms_credit_accounts")) return { dryRun: !options.confirm, available: false, clinics: [] };
    throw err;
  }
  const clinics: CreditGoLiveClinic[] = [];
  for (const tenantId of tenants) {
    const acct = await getSmsCreditAccount(ctx, tenantId);
    const purchases = await listUnreversedTestPurchases(ctx, tenantId);
    const hadTestCustomer = Boolean(acct.customerRef) && acct.customerMode !== "live";
    const wanted = purchases.reduce((n, p) => n + p.credits, 0);
    const row: CreditGoLiveClinic = { tenantId, hadTestCustomer, testPurchases: purchases.length, creditsToTakeOff: Math.min(wanted, acct.balance), creditsTakenOff: 0 };
    if (!hadTestCustomer && purchases.length === 0) continue;
    clinics.push(row);
    if (!options.confirm) continue;
    if (hadTestCustomer) await clearTestCreditCustomer(ctx, tenantId, SYSTEM);
    for (const p of purchases) {
      const balance = (await getSmsCreditAccount(ctx, tenantId)).balance;
      const take = Math.min(p.credits, balance);
      // Nothing left to take off (the test credits were used up): no ledger entry (a change of 0 is not one); the
      // purchase stays in the history, marked test mode, and a later run finds nothing to take off either.
      if (take <= 0) continue;
      const r = await adjustSmsCredits(ctx, tenantId, { credits: -take, reason: GO_LIVE_REASON }, SYSTEM, { by: "go_live", purchase: p.id, paymentRef: p.paymentRef }, { reversesId: p.id });
      if (r.ok) row.creditsTakenOff += take;
    }
    await appendAudit(ctx, tenantId, {
      userId: PLATFORM_USER_ID,
      action: "clinic.billing_go_live",
      targetType: "clinic",
      targetId: tenantId,
      detail: { testCustomerCleared: hadTestCustomer, testPurchases: purchases.length, creditsTakenOff: row.creditsTakenOff },
    });
  }
  if (options.confirm && clinics.length) {
    await appendAudit(ctx, "platform", { userId: PLATFORM_USER_ID, action: "platform.billing_go_live", targetType: "platform", targetId: "text_credits", detail: { clinics: clinics.length, creditsTakenOff: clinics.reduce((n, c) => n + c.creditsTakenOff, 0) } });
  }
  return { dryRun: !options.confirm, available: true, clinics };
}
