import { notFound, redirect } from "next/navigation";
import { PublicTop } from "@/components/pms/portal/public-shell";
import { clinicPublicPaths } from "@/modules/pms/portal/paths";
import { formatWhen } from "@/modules/pms/portal/time";
import { getPortalShare, markShareViewed } from "@/server/repos/pms/portal/shares";
import { portalViewer, publicClinicOr404, publicCtx } from "@/server/pms/portal/public-page";

export const dynamic = "force-dynamic";

/** A document the clinic shared with the patient (only theirs, only while shared). */
export default async function PortalDocumentPage({ params }: { params: { clinicId: string; shareId: string } }) {
  const clinic = await publicClinicOr404(params.clinicId, "portal");
  const paths = clinicPublicPaths(clinic.tenantId);
  const viewer = await portalViewer(clinic);
  if (!viewer) redirect(paths.portal);
  if (!/^psh_[0-9A-HJKMNP-TV-Z]{26}$/.test(params.shareId)) notFound();
  const ctx = publicCtx();
  const share = await getPortalShare(ctx, clinic.tenantId, params.shareId);
  if (!share || share.patientId !== viewer.patientId || share.withdrawnAt) notFound();
  if (!share.viewedAt) await markShareViewed(ctx, clinic.tenantId, share.id, viewer.actor);
  return (
    <>
      <PublicTop back={{ href: paths.portal, label: "My appointments" }} />
      <main className="space-y-3 px-4 pb-16 pt-5">
        <h1 className="text-[22px] font-bold text-foreground">{share.title}</h1>
        <p className="text-[13px] text-[#475569]">Shared {formatWhen(share.sharedAt)}</p>
        <div className="whitespace-pre-wrap rounded-[12px] border border-border bg-white p-4 text-[15px] leading-relaxed text-foreground">{share.body}</div>
      </main>
    </>
  );
}
