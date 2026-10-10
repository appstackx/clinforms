import type { Metadata } from "next";
import { HomeScreen } from "@/modules/medreport/ui/screens/home/home-screen";

/** A title template does not apply to the segment that defines it, so set the full title here. */
export const metadata: Metadata = { title: { absolute: "Studio · ClinForms" } };

/** The clinic's Studio home (tenant mode; guarded by the layout). */
export default function TenantStudioHomePage() {
  return <HomeScreen />;
}
