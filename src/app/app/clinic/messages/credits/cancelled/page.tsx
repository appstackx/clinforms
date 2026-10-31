import type { Metadata } from "next";
import Link from "next/link";
import { PmsNotice, pmsButtonVariants } from "@/components/pms/ui";
import { requireClinicActor } from "@/server/pms/actor";
import { CREDITS_PAGE_PATH } from "@/server/pms/comms/credits/notify";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Card payment cancelled – Text credits" };

/** /app/clinic/messages/credits/cancelled – the card payment page was left without paying. Nothing was charged. */
export default async function CreditsCancelledRoute() {
  await requireClinicActor({ permission: "messages.send" });
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[700px] flex-col gap-4">
      <h1 className="text-2xl font-semibold text-foreground">Text credits</h1>
      <PmsNotice tone="info" title="Payment cancelled. Nothing was charged." role="status" />
      <div>
        <Link href={CREDITS_PAGE_PATH} className={pmsButtonVariants({ variant: "primary" })} data-testid="back-to-credits">
          Back to text credits
        </Link>
      </div>
    </div>
  );
}
