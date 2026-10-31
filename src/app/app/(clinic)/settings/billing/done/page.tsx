import type { Metadata } from "next";
import Link from "next/link";
import { Notice, PageHeader } from "@/components/account/shell";
import { requireAppContext } from "@/server/auth/session";
import { emailBillingNotifier } from "@/server/billing/notify";
import { billingClientsFromEnv, canManageBilling, completeCheckoutFor } from "@/server/billing/views";
import { getDb } from "@/server/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Payment – Plan and billing" };

/**
 * /app/settings/billing/done?session_id=… – back from the payment page. The checkout and its subscription are re-read
 * and applied here if the webhook has not done it yet (both idempotent). A Direct Debit is not active until its
 * payment clears – the page says so. A checkout of another clinic is refused.
 */
export default async function BillingDonePage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { session, membership } = await requireAppContext();
  const raw = searchParams.session_id;
  const sessionId = (Array.isArray(raw) ? raw[0] : raw) ?? "";
  const actor = { tenantId: membership.tenantId, clinicName: membership.clinicName, role: membership.role, userId: session.user.id, sessionId: session.session.id };
  const r = canManageBilling(membership.role) ? await completeCheckoutFor(getDb(), actor, sessionId, billingClientsFromEnv(), { notify: emailBillingNotifier(getDb), alert: null }) : ({ status: "unavailable" } as const);
  const state = r.status === "synced" ? r.subscription.state : null;
  const [tone, title, detail] =
    state === "active"
      ? (["success", "Payment received – your plan is active.", "Everything in your plan is switched on now."] as const)
      : state === "pending_payment"
        ? (["info", "Thank you – your Direct Debit is being set up.", "Your plan starts as soon as the first payment clears, usually within a few working days. We will email you if anything goes wrong."] as const)
        : (["info", "We could not confirm this payment yet.", "If you paid, your plan will appear on the Plan and billing page within a few minutes. Nothing was charged twice."] as const);
  return (
    <>
      <PageHeader title="Plan and billing" />
      <div data-testid="billing-done" data-state={state ?? "unknown"}>
        <Notice tone={tone}>
          <span className="font-semibold">{title}</span> {detail}
        </Notice>
      </div>
      <p className="mt-4">
        <Link href="/app/settings/billing" className="text-sm font-medium text-teal-800 underline" data-testid="back-to-billing">
          Back to Plan and billing
        </Link>
      </p>
    </>
  );
}
