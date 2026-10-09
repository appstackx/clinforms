import type { Metadata } from "next";
import { SecurityScreen } from "@/modules/medreport/ui/screens/security/security-screen";

export const metadata: Metadata = { title: "Security & data protection" };

/** Owner: studio-a agent. */
export default function SecurityPage() {
  return <SecurityScreen />;
}
