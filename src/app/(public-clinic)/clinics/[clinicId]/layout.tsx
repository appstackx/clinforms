import type { Metadata } from "next";
import { PublicHeader } from "@/components/pms/portal/public-shell";
import { clinicInitials } from "@/server/pms/portal/public-clinic";
import { publicClinicOr404 } from "@/server/pms/portal/public-page";

export const dynamic = "force-dynamic";

/**
 * The clinic's public pages (booking, patient portal, forms): the clinic's own name and badge, NOT the app shell; no
 * staff cookie; never indexed. A clinic without the clinic-system package (or with booking and the portal both off)
 * has no public pages at all – the 404 page (src/server/pms/portal/public-page.ts).
 */
export async function generateMetadata({ params }: { params: { clinicId: string } }): Promise<Metadata> {
  const clinic = await publicClinicOr404(params.clinicId);
  return { title: { absolute: clinic.name }, robots: { index: false, follow: false, nocache: true }, referrer: "no-referrer" };
}

export default async function PublicClinicLayout({ params, children }: { params: { clinicId: string }; children: React.ReactNode }) {
  const clinic = await publicClinicOr404(params.clinicId);
  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <div className="mx-auto min-h-screen w-full max-w-[480px] bg-[#F8FAFC] sm:border-x sm:border-border">
        <PublicHeader name={clinic.name} initials={clinicInitials(clinic.name)} demo={clinic.isDemo} />
        {children}
      </div>
    </div>
  );
}
