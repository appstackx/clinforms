import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CampaignEditor } from "@/components/pms/comms/campaigns/campaign-editor";
import { bulkEmailAvailable, campaignEditorFor, mayUseBulkEmail } from "@/server/pms/comms/campaigns/service";
import { requireClinicActor } from "@/server/pms/actor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bulk email" };

/** /app/clinic/messages/campaigns/[id] – a draft to edit, test and send; else what was sent and its counts. */
export default async function CampaignPage({ params }: { params: { campaignId: string } }) {
  // The platform switch (CLINFORMS_BULK_EMAIL=on) first: off = the 404 page – the feature does not exist.
  if (!bulkEmailAvailable()) notFound();
  const actor = await requireClinicActor({ permission: "messages.templates" });
  // Never reception (a lock, even when a clinic grants it the permission).
  if (!mayUseBulkEmail(actor)) notFound();
  const r = await campaignEditorFor(actor, params.campaignId);
  if (!r.ok) {
    if (r.code === "not_found") notFound();
    return <p role="alert">{r.error}</p>;
  }
  return <CampaignEditor view={r.value} />;
}
