"use server";
/**
 * Platform page – subscriptions (ClinForms staff in CLINFORMS_PLATFORM_ADMINS only, re-checked on every call with a
 * fresh session): the billing override on / off, and "Re-read" (the subscription read again from the payment service
 * and applied – the same as a webhook event). Audited in the clinic's trail and the platform's.
 */
import { revalidatePath } from "next/cache";
import { ACCOUNT_ERRORS } from "@/lib/account-copy";
import { setBillingOverride } from "@/server/admin/billing";
import { platformActionAdmin } from "@/server/admin/guards";
import { emailBillingNotifier } from "@/server/billing/notify";
import { subscriptionPaymentsFromEnv } from "@/server/billing/payments";
import { syncSubscription } from "@/server/billing/sync";
import { getDb } from "@/server/db";
import { getClinicSubscription } from "@/server/repos/clinic-subscription";
import { RepoInputError } from "@/server/repos/context";

export type PlatformBillingResult = { ok: true; message: string } | { ok: false; error: string };

async function resync(tenantId: string, force: boolean): Promise<string> {
  const db = getDb();
  const s = await getClinicSubscription({ db }, tenantId);
  const p = subscriptionPaymentsFromEnv();
  if (!s) return "No subscription.";
  if (!p.ok) return "Payments are not configured on this deployment – re-applied at the next payment event.";
  const r = await syncSubscription({ db, notify: emailBillingNotifier(getDb), alert: null }, p.payments, s.subscriptionRef, { forceApply: force });
  return r.status === "synced" ? `Re-read: ${r.subscription.state}${r.changed ? " (changed)" : " (no change)"}.` : `Re-read: ${r.status}${"why" in r ? ` (${r.why})` : ""}.`;
}

export async function billingOverrideAction(_prev: PlatformBillingResult | null, form: FormData): Promise<PlatformBillingResult> {
  const admin = await platformActionAdmin();
  if (!admin) return { ok: false, error: ACCOUNT_ERRORS.forbidden };
  const tenantId = String(form.get("tenantId") ?? "").trim().slice(0, 64);
  const on = form.get("on") === "1";
  try {
    const r = await setBillingOverride(getDb(), { kind: "platform", admin }, tenantId, on, String(form.get("note") ?? "").slice(0, 200) || null);
    const extra = !on && r.changed ? ` ${await resync(tenantId, true)}` : "";
    revalidatePath("/app/platform/billing");
    return { ok: true, message: `${r.changed ? "Done" : "Nothing to change"}: override ${on ? "on" : "off"} for ${tenantId}.${extra}` };
  } catch (err) {
    return { ok: false, error: err instanceof RepoInputError ? err.message : "The change could not be saved. Try again." };
  }
}

export async function resyncSubscriptionAction(_prev: PlatformBillingResult | null, form: FormData): Promise<PlatformBillingResult> {
  const admin = await platformActionAdmin();
  if (!admin) return { ok: false, error: ACCOUNT_ERRORS.forbidden };
  const tenantId = String(form.get("tenantId") ?? "").trim().slice(0, 64);
  try {
    const message = await resync(tenantId, false);
    revalidatePath("/app/platform/billing");
    return { ok: true, message };
  } catch {
    return { ok: false, error: "The payment service could not be reached. Try again." };
  }
}

