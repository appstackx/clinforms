"use server";
/**
 * Settings → Plan and billing – server actions (owners and admins only, re-checked with a fresh session:
 * actionContext({ manage: true })). The payment page's return address is this deployment's own origin (the
 * request's, when it is one of the app's own – else the configured one). Logic: src/server/billing/views.ts.
 */
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { ACCOUNT_ERRORS } from "@/lib/account-copy";
import { isAllowedAppOrigin } from "@/server/auth/config";
import { actionContext } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { commsLinkOrigin } from "@/server/pms/comms/links";
import { emailBillingNotifier, BILLING_PAGE_PATH } from "@/server/billing/notify";
import { billingClientsFromEnv, changePlan, openBillingPortal, parseChoice, startPlanCheckout, type BillingActor } from "@/server/billing/views";
import { readClinicSubscription } from "@/server/repos/clinic-subscription";

export type BillingActionResult = { ok: true; url?: string; message?: string } | { ok: false; error: string };

function ownOrigin(): string {
  const origin = headers().get("origin");
  return origin && isAllowedAppOrigin(origin) ? new URL(origin).origin : commsLinkOrigin();
}

const key = () => `plan-${randomBytes(12).toString("base64url")}`;

async function billingActor(): Promise<BillingActor | null> {
  const ctx = await actionContext({ manage: true });
  if ("error" in ctx) return null;
  return { tenantId: ctx.membership.tenantId, clinicName: ctx.membership.clinicName, role: ctx.membership.role, userId: ctx.session.user.id, sessionId: ctx.session.session.id };
}

/** Choose a plan: the payment page (no plan yet) or the running plan changed. */
export async function choosePlanAction(_prev: BillingActionResult | null, form: FormData): Promise<BillingActionResult> {
  const actor = await billingActor();
  if (!actor) return { ok: false, error: ACCOUNT_ERRORS.forbidden };
  const choice = parseChoice({ product: form.get("product"), band: form.get("band"), interval: form.get("interval"), reports: form.get("reports"), tier: form.get("tier") });
  const db = getDb();
  const clients = billingClientsFromEnv();
  const sub = await readClinicSubscription({ db }, actor.tenantId);
  if (sub && (sub.state === "active" || sub.state === "past_due") && clients && sub.mode === clients.subs.mode) {
    const r = await changePlan(db, actor, { choice, idempotencyKey: key() }, clients, { notify: emailBillingNotifier(getDb), alert: null });
    revalidatePath(BILLING_PAGE_PATH);
    return r.ok ? { ok: true, message: r.value.message } : { ok: false, error: r.error };
  }
  const r = await startPlanCheckout(db, actor, { choice, origin: ownOrigin(), idempotencyKey: key() }, clients);
  return r.ok ? { ok: true, url: r.value.url } : { ok: false, error: r.error };
}

/** Manage billing: the hosted billing page. */
export async function manageBillingAction(): Promise<BillingActionResult> {
  const actor = await billingActor();
  if (!actor) return { ok: false, error: ACCOUNT_ERRORS.forbidden };
  const r = await openBillingPortal(getDb(), actor, { origin: ownOrigin() }, billingClientsFromEnv());
  return r.ok ? { ok: true, url: r.value.url } : { ok: false, error: r.error };
}

