import type { Metadata } from "next";
import Link from "next/link";
import { CREDIT_COPY, creditsText } from "@/modules/pms/comms/credits";
import { PmsNotice, pmsButtonVariants } from "@/components/pms/ui";
import { requireClinicActor } from "@/server/pms/actor";
import { CREDITS_PAGE_PATH } from "@/server/pms/comms/credits/notify";
import { cardPaymentsFromEnv, completeCheckoutFor } from "@/server/pms/comms/credits/views";
import { getSmsCreditAccount } from "@/server/repos/pms/comms/credits";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Card payment – Text credits" };

/**
 * /app/clinic/messages/credits/done?session_id=… – back from the card payment page. The payment is re-read from the
 * card payment service and credited here if the webhook has not done it yet (both are idempotent: whichever comes
 * first adds the credits, the other changes nothing). A checkout of another clinic is refused.
 */
export default async function CreditsDoneRoute({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const actor = await requireClinicActor({ permission: "messages.send" });
  const raw = searchParams.session_id;
  const sessionId = (Array.isArray(raw) ? raw[0] : raw) ?? "";
  const p = cardPaymentsFromEnv();
  const r = await completeCheckoutFor(actor, sessionId, p.ok ? p.payments : null);
  const balance = (await getSmsCreditAccount(actor.repo(), actor.tenantId)).balance;
  const ok = r.status === "credited" || r.status === "already" || r.status === "card_saved";
  const title =
    r.status === "credited"
      ? `Payment received: ${creditsText(r.credits)} added.`
      : r.status === "already"
        ? "Payment received. The credits are on your account."
        : r.status === "card_saved"
          ? "Card saved for automatic top-up."
          : r.status === "not_paid"
            ? "The payment has not gone through yet."
            : "We could not confirm this payment.";
  const detail = ok
    ? `Balance: ${creditsText(balance)}.`
    : r.status === "not_paid"
      ? "If you paid, the credits will appear on the Text credits page within a few minutes."
      : "If you paid, the credits will appear on the Text credits page within a few minutes. Nothing was charged twice.";
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[700px] flex-col gap-4">
      <h1 className="text-2xl font-semibold text-foreground">Text credits</h1>
      <PmsNotice tone={ok ? "success" : "info"} title={title} role="status">
        <p data-testid="credits-done-detail">{detail}</p>
        {ok && r.status !== "card_saved" ? <p className="mt-1 text-sm">{CREDIT_COPY.nonRefundable}</p> : null}
      </PmsNotice>
      <div>
        <Link href={CREDITS_PAGE_PATH} className={pmsButtonVariants({ variant: "primary" })} data-testid="back-to-credits">
          Back to text credits
        </Link>
      </div>
    </div>
  );
}
