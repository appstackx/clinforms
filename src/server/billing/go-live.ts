/**
 * Go-live clean-up for subscriptions (review fix 31/10/2026, with src/server/admin/billing-go-live.ts for text
 * credits; run by npm run admin:billing-go-live BEFORE CLINDESK_BILLING_LIVE=1 is deployed): every TEST-mode
 * subscription row that is not ended yet is ended (state canceled), and the packages it switched on are cancelled –
 * unless ClinForms staff manage the clinic by hand (override), whose packages stay as set. Nothing at the payment
 * service is touched (test objects stay in test mode). Idempotent; preview by default. Audited (ids only).
 */
import type { Kysely } from "kysely";
import type { Database } from "../db/schema";
import { appendAudit } from "../repos/audit";
import { readClinicSubscriptions, type ClinicSubscription } from "../repos/clinic-subscription";
import { setEntitlement } from "../repos/pms/entitlements";
import { BILLING_ACTOR } from "./sync";

export interface SubscriptionGoLiveClinic {
  tenantId: string;
  subscriptionRef: string | null;
  status: string;
  /** Whether the subscription drove the packages (they are cancelled), or staff manage them (left as they are). */
  managed: boolean;
}

export async function goLiveSubscriptions(db: Kysely<Database>, options: { confirm?: boolean } = {}): Promise<{ dryRun: boolean; available: boolean; clinics: SubscriptionGoLiveClinic[] }> {
  const { available, rows } = await readClinicSubscriptions({ db });
  const test = rows.filter((s: ClinicSubscription) => s.mode === "test" && s.state !== "canceled" && s.state !== "expired");
  const clinics = test.map((s) => ({ tenantId: s.tenantId, subscriptionRef: s.subscriptionRef, status: s.state, managed: !s.override && Boolean(s.applied) }));
  if (!options.confirm) return { dryRun: true, available, clinics };
  const at = new Date().toISOString();
  for (const s of test) {
    const ctx = { db };
    if (!s.override && s.applied) {
      if (s.applied.clinic === "active") await setEntitlement(ctx, s.tenantId, "clinic", { status: "cancelled", note: "Test-mode subscription ended at go-live" }, BILLING_ACTOR);
      if (s.applied.reports === "active") await setEntitlement(ctx, s.tenantId, "reports", { status: "cancelled", note: "Test-mode subscription ended at go-live" }, BILLING_ACTOR);
    }
    const applied = s.applied ? { ...s.applied, clinic: s.applied.clinic === "active" ? "cancelled" : s.applied.clinic, reports: s.applied.reports === "active" ? "cancelled" : s.applied.reports } : null;
    await db
      .updateTable("clinic_subscription")
      .set({ state: "canceled", ended_at: at, grace_until: null, past_due_since: null, applied_json: s.override ? (s.applied ? JSON.stringify(s.applied) : null) : applied ? JSON.stringify(applied) : null, updated_at: at })
      .where("tenant_id", "=", s.tenantId)
      .where("mode", "=", "test")
      .execute();
    await appendAudit(ctx, s.tenantId, { userId: null, action: "clinic.billing_go_live", targetType: "clinic_subscription", targetId: s.subscriptionRef, detail: { testSubscriptionEnded: true, packagesCancelled: !s.override && Boolean(s.applied) } });
  }
  return { dryRun: false, available, clinics };
}
