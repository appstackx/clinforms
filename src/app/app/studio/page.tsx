import type { Metadata } from "next";
import { HomeScreen } from "@/modules/medreport/ui/screens/home/home-screen";
import { activeClinicPackages, notFoundTitle, studioTitleName } from "@/server/brand-home";

/** A title template does not apply to the segment that defines it, so set the full title here (by host, R3). */
export async function generateMetadata(): Promise<Metadata> {
  const packages = await activeClinicPackages();
  return { title: { absolute: packages && !packages.reports ? notFoundTitle() : `Studio · ${studioTitleName()}` } };
}

/** The clinic's Studio home (tenant mode; guarded by the layout). */
export default function TenantStudioHomePage() {
  return <HomeScreen />;
}
