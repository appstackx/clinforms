import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MESSAGES_PATH } from "@/components/pms/comms/format";
import { CampaignsHome } from "@/components/pms/comms/campaigns/campaigns-home";
import { bulkEmailAvailable, campaignsHomeFor, mayUseBulkEmail } from "@/server/pms/comms/campaigns/service";
import { requireClinicActor } from "@/server/pms/actor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bulk email" };

/** /app/clinic/messages/campaigns – the clinic's setting (owners/admins) and its bulk emails with their counts. */
export default async function CampaignsPage() {
  // The platform switch (CLINFORMS_BULK_EMAIL=on) first: off = the 404 page – the feature does not exist.
  if (!bulkEmailAvailable()) notFound();
  const actor = await requireClinicActor({ permission: "messages.templates" });
  // Never reception (a lock, even when a clinic grants it the permission).
  if (!mayUseBulkEmail(actor)) notFound();
  const r = await campaignsHomeFor(actor);
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1100px] flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-sm text-[#475569]">
        <Link href={MESSAGES_PATH} className="text-primary-strong underline underline-offset-2">
          Messages
        </Link>
        <span aria-hidden> / </span>
        <span>Bulk email</span>
      </nav>
      <h1 className="text-2xl font-semibold text-foreground">Bulk email</h1>
      {r.ok ? <CampaignsHome view={r.value} /> : <p role="alert">{r.error}</p>}
    </div>
  );
}
