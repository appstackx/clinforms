import type { Metadata } from "next";
import Link from "next/link";
import { Notice, PageHeader } from "@/components/account/shell";
import { CLINIC_SYSTEM_NAME } from "@/lib/brand";
import { requireAppContext } from "@/server/auth/session";
import { emailBillingNotifier } from "@/server/billing/notify";
import { billingClientsFromEnv, canManageBilling, checkoutDoneView, completeCheckoutFor } from "@/server/billing/views";
import { getDb } from "@/server/db";
import { hasPackage } from "@/server/pms/entitlements";
import { otherBrandSignIn } from "@/server/brand-home";
import { currentBrand } from "@/server/brand";

export const dynamic = "force-dynamic";
/** The tab title (V-02): "… · ClinDesk" on the clinic brand's host; on ClinForms' hosts without a product name – the
 * page may be the hand-off to the clinic system just bought, so it names neither brand there. */
const DONE_TITLE = "Payment – Plan and billing";
export function generateMetadata(): Metadata {
  return currentBrand().id === "clinic" ? { title: DONE_TITLE } : { title: { absolute: DONE_TITLE } };
}

/**
 * /app/settings/billing/done?session_id=… – back from the payment page. The checkout and its subscription are re-read
 * and applied here if the webhook has not done it yet (both idempotent). A Direct Debit is not active until its
 * payment clears – the page says so and offers no way into the clinic system yet. A checkout of another clinic is
 * refused. 01/11/2026: the plan bought, and "Open ClinDesk" once the clinic package is on (checkoutDoneView).
 */
export default async function BillingDonePage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { session, membership } = await requireAppContext();
  const raw = searchParams.session_id;
  const sessionId = (Array.isArray(raw) ? raw[0] : raw) ?? "";
  const actor = { tenantId: membership.tenantId, clinicName: membership.clinicName, role: membership.role, userId: session.user.id, sessionId: session.session.id };
  const r = canManageBilling(membership.role) ? await completeCheckoutFor(getDb(), actor, sessionId, billingClientsFromEnv(), { notify: emailBillingNotifier(getDb), alert: null }) : ({ status: "unavailable" } as const);
  // Read after the sync above, so a plan that has just switched the clinic system on is seen.
  const clinicOn = r.status === "synced" && r.subscription.state === "active" ? await hasPackage(membership.tenantId, "clinic") : false;
  const view = checkoutDoneView(r, clinicOn);
  const back = "/app/settings/billing";
  // 01/11/2026 (R3): bought on ClinForms' host – the clinic system lives on its own host (sessions are host-only), so
  // "Open ClinDesk" goes to its sign-in page there, with a line saying so.
  const elsewhere = view.openClinicSystem ? otherBrandSignIn("clinic") : null;
  return (
    <>
      <PageHeader title={view.state === "active" ? "Your plan is active" : "Plan and billing"} />
      <div data-testid="billing-done" data-state={view.state}>
        <Notice tone={view.tone}>
          <span className="font-semibold">{view.title}</span> {view.detail}
        </Notice>
      </div>
      {view.planLabel && view.state !== "unknown" ? (
        <p className="mt-4 text-sm text-slate-700" data-testid="billing-done-plan">
          Plan: <span className="font-semibold text-slate-900">{view.planLabel}</span>
        </p>
      ) : null}
      {elsewhere ? (
        <p className="mt-4 text-sm text-slate-700" data-testid="billing-done-elsewhere">
          {CLINIC_SYSTEM_NAME} has its own address: sign in there with the same email and password (and your two-step code).
          Your clinic is used there from now on.
        </p>
      ) : null}
      <div className="mt-6 flex flex-wrap items-center gap-4">
        {view.openClinicSystem ? (
          <a
            href={elsewhere ?? "/app/clinic"}
            className="inline-flex h-10 items-center rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2"
            data-testid="open-clinic-system"
          >
            {elsewhere ? `Sign in to ${CLINIC_SYSTEM_NAME}` : `Open ${CLINIC_SYSTEM_NAME}`}
          </a>
        ) : null}
        <Link
          href={back}
          className={
            view.openClinicSystem
              ? "inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2"
              : "text-sm font-medium text-teal-800 underline"
          }
          data-testid="back-to-billing"
        >
          Back to Plan and billing
        </Link>
      </div>
    </>
  );
}
