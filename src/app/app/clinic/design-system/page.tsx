import type { Metadata } from "next";
import { DesignSystemPreview } from "@/components/pms/design-system/preview";
import { CLINIC_SYSTEM_NAME } from "@/lib/brand";
import { requireClinicActor } from "@/server/pms/actor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Design system", robots: { index: false, follow: false } };

/**
 * /app/clinic/design-system – every component of the clinic system's kit (src/components/pms/ui) with the design's
 * fictional examples, to compare with docs/clinic-system/design/design-system-v1.pdf side by side.
 *
 * Who: the clinic package AND settings.manage (owners and administrators) – the same check as every clinic page,
 * so a clinic without the package gets the 404 page and reception/clinicians get the 404 page too. It is not in the
 * navigation. Not dev-only on purpose: Khuram reviews it on a local build and on a preview deployment, and it holds
 * no clinic data (only fixed fictional examples) – so it is safe to leave reachable for owners.
 */
export default async function DesignSystemPage() {
  await requireClinicActor({ permission: "settings.manage" });
  return <DesignSystemPreview productName={CLINIC_SYSTEM_NAME} />;
}
