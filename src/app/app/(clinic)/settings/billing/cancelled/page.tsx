import type { Metadata } from "next";
import Link from "next/link";
import { Notice, PageHeader } from "@/components/account/shell";
import { requireAppContext } from "@/server/auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Payment cancelled – Plan and billing" };

/** /app/settings/billing/cancelled – the member left the payment page without paying. Nothing changed. */
export default async function BillingCancelledPage() {
  await requireAppContext();
  return (
    <>
      <PageHeader title="Plan and billing" />
      <Notice tone="info">No payment was taken and your plan has not changed. You can choose a plan again at any time.</Notice>
      <p className="mt-4">
        <Link href="/app/settings/billing" className="text-sm font-medium text-teal-800 underline">
          Back to Plan and billing
        </Link>
      </p>
    </>
  );
}
