import { notFound, redirect } from "next/navigation";
import { Download, FileText } from "lucide-react";
import { PublicTop } from "@/components/pms/portal/public-shell";
import { clinicPublicPaths } from "@/modules/pms/portal/paths";
import { formatWhen } from "@/modules/pms/portal/time";
import { markShareViewed } from "@/server/repos/pms/portal/shares";
import { patientShare } from "@/server/pms/portal/portal-views";
import { portalViewer, publicClinicOr404, publicCtx } from "@/server/pms/portal/public-page";

export const dynamic = "force-dynamic";

/** A document the clinic shared with the patient (only theirs, only while shared) – a written one, or a file to download. */
export default async function PortalDocumentPage({ params }: { params: { clinicId: string; shareId: string } }) {
  const clinic = await publicClinicOr404(params.clinicId, "portal");
  const paths = clinicPublicPaths(clinic.tenantId);
  const viewer = await portalViewer(clinic);
  if (!viewer) redirect(paths.portal);
  const ctx = publicCtx();
  const found = await patientShare(ctx, clinic.tenantId, viewer.patientId, params.shareId);
  if (!found) notFound();
  const { share, file } = found;
  if (!share.viewedAt) await markShareViewed(ctx, clinic.tenantId, share.id, viewer.actor);
  return (
    <>
      <PublicTop back={{ href: paths.portal, label: "My appointments" }} />
      <main className="space-y-3 px-4 pb-16 pt-5">
        <h1 className="text-[22px] font-bold text-foreground">{share.title}</h1>
        <p className="text-[13px] text-[#475569]">Shared {formatWhen(share.sharedAt)}</p>
        {share.body ? <div className="whitespace-pre-wrap rounded-[12px] border border-border bg-white p-4 text-[15px] leading-relaxed text-foreground">{share.body}</div> : null}
        {file ? (
          <div className="flex items-center gap-3 rounded-[12px] border border-border bg-white p-4">
            <FileText className="h-6 w-6 shrink-0 text-[#475569]" aria-hidden="true" />
            <div className="min-w-0 flex-1 text-[14px] text-[#334155]">
              {file.label}, {file.size}
            </div>
            <a
              href={paths.portalDocumentFile(share.id)}
              className="inline-flex h-11 items-center gap-1.5 rounded-[10px] bg-primary-strong px-4 text-[15px] font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Download<span className="sr-only"> {share.title}</span>
            </a>
          </div>
        ) : null}
      </main>
    </>
  );
}
