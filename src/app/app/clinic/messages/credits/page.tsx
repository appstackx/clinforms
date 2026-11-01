import type { Metadata } from "next";
import Link from "next/link";
import { MESSAGES_PATH } from "@/components/pms/comms/format";
import { TextCreditsPage } from "@/components/pms/comms/text-credits";
import { requireClinicActor } from "@/server/pms/actor";
import { textCreditsFor } from "@/server/pms/comms/credits/views";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Text credits" };

/**
 * /app/clinic/messages/credits – prepaid text credits: the balance, buying a pack (card payment), automatic top-up,
 * the history. messages.send sees it; buying and the settings are for the owner and admins.
 */
export default async function TextCreditsRoute() {
  const actor = await requireClinicActor({ permission: "messages.send" });
  const r = await textCreditsFor(actor);
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[900px] flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-sm text-[#475569]">
        <Link href={MESSAGES_PATH} className="text-primary-strong underline underline-offset-2">
          Messages
        </Link>
        <span aria-hidden> / </span>
        <span>Text credits</span>
      </nav>
      <h1 className="text-2xl font-semibold text-foreground">Text credits</h1>
      {r.ok ? <TextCreditsPage view={r.value} /> : <p role="alert">{r.error}</p>}
    </div>
  );
}
