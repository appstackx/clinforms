/** The billing banner (server-safe): read-only, payment overdue, too many practitioners (src/server/billing/banner.ts). */
import Link from "next/link";
import type { BillingBanner } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";

export function BillingBannerBar({ banner, className }: { banner: BillingBanner | null; className?: string }) {
  if (!banner) return null;
  return (
    <div
      role={banner.tone === "error" ? "alert" : "status"}
      data-testid="billing-banner"
      className={cn("border-b px-4 py-2 text-center text-sm", banner.tone === "error" ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900", className)}
    >
      {banner.text}
      {banner.href ? (
        <>
          {" "}
          <Link href={banner.href} className="font-medium underline underline-offset-2">
            Plan and billing
          </Link>
        </>
      ) : null}
    </div>
  );
}
