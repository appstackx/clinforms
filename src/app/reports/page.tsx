import type { Metadata } from "next";
import { PRODUCT } from "@/modules/medreport/config.public";
import { HomeScreen } from "@/modules/medreport/ui/screens/home/home-screen";

/** A title template does not apply to the segment that defines it, so set the full title here. */
export const metadata: Metadata = { title: { absolute: `Studio · ${PRODUCT.name}` } };

/** Owner: studio-a agent. */
export default function ReportsHomePage() {
  return <HomeScreen />;
}
