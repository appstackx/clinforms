import type { Metadata } from "next";
import Link from "next/link";
import { PmsNotice } from "@/components/pms/ui";
import { MESSAGES_PATH } from "@/components/pms/comms/format";
import { CAMPAIGN_COPY } from "@/modules/pms/comms/campaigns";
import { notFound } from "next/navigation";
import { CampaignEditor } from "@/components/pms/comms/campaigns/campaign-editor";
import { bulkEmailAvailable, campaignEditorFor, mayUseBulkEmail } from "@/server/pms/comms/campaigns/service";
import { requireClinicActor } from "@/server/pms/actor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New bulk email" };

/** /app/clinic/messages/campaigns/new – write a bulk email (only while the clinic's setting is on). */
export default async function NewCampaignPage() {
  // The platform switch (CLINFORMS_BULK_EMAIL=on) first: off = the 404 page – the feature does not exist.
  if (!bulkEmailAvailable()) notFound();
  const actor = await requireClinicActor({ permission: "messages.templates" });
  // Never reception (a lock, even when a clinic grants it the permission).
  if (!mayUseBulkEmail(actor)) notFound();
  const r = await campaignEditorFor(actor, null);
  if (!r.ok) return <p role="alert">{r.error}</p>;
  // The clinic's own setting off: no editor (saving is refused on the server too).
  if (!r.value.settings.enabled)
    return (
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-3" data-testid="bulk-email-off">
        <h1 className="text-2xl font-semibold text-foreground">New bulk email</h1>
        <PmsNotice tone="warning" title={CAMPAIGN_COPY.off}>
          <Link href={`${MESSAGES_PATH}/campaigns`} className="text-primary-strong underline underline-offset-2">
            Back to Bulk email
          </Link>
        </PmsNotice>
      </div>
    );
  return <CampaignEditor view={r.value} />;
}
