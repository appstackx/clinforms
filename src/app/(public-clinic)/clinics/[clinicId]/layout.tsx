import type { Metadata, Viewport } from "next";
import { brandIcons, brandMetadata, brandViewport } from "@/lib/brand";
import { currentBrand } from "@/server/brand";
import { PublicHeader } from "@/components/pms/portal/public-shell";
import { clinicInitials, loadPublicClinic } from "@/server/pms/portal/public-clinic";
import { deviceClinicOr404, publicCtx } from "@/server/pms/portal/public-page";

export const dynamic = "force-dynamic";

/**
 * The clinic's public pages (booking, patient portal, forms): the clinic's own name and badge, NOT the app shell; no
 * staff cookie; never indexed. A clinic without the clinic-system package has no public pages at all – the 404 page
 * (src/server/pms/portal/public-page.ts). With booking and the portal both off, only the clinic's DEVICE page (a form
 * handed to a patient in the clinic) exists: the other pages are the 404 page inside a bare frame – no clinic name –
 * so an outsider still cannot tell why.
 *
 * Brand (01/11/2026, F2): the host's – on ClinDesk's host the tab icon, theme colour, application name, share-card
 * names and description are ClinDesk's, not the root layout's ClinForms ones.
 */
export function generateViewport(): Viewport {
  return brandViewport(currentBrand());
}

export async function generateMetadata({ params }: { params: { clinicId: string } }): Promise<Metadata> {
  const open = await loadPublicClinic(publicCtx(), params.clinicId);
  const clinic = open ?? (await deviceClinicOr404(params.clinicId));
  const brand = currentBrand();
  const icons = brandIcons(brand);
  return {
    ...brandMetadata(brand),
    ...(icons ? { icons } : {}),
    title: { absolute: open ? clinic.name : "Clinic" },
    robots: { index: false, follow: false, nocache: true },
    referrer: "no-referrer",
  };
}

export default async function PublicClinicLayout({ params, children }: { params: { clinicId: string }; children: React.ReactNode }) {
  const open = await loadPublicClinic(publicCtx(), params.clinicId);
  if (!open) await deviceClinicOr404(params.clinicId);
  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <div className="mx-auto min-h-screen w-full max-w-[480px] bg-[#F8FAFC] sm:border-x sm:border-border">
        {open ? <PublicHeader name={open.name} initials={clinicInitials(open.name)} demo={open.isDemo} /> : null}
        {children}
      </div>
    </div>
  );
}
