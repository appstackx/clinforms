import type { Metadata } from "next";
import { BatchScreen } from "@/modules/medreport/ui/screens/batch/batch-screen";

export const metadata: Metadata = { title: "Batch" };

/** Owner: studio-a agent. */
export default function BatchPage() {
  return <BatchScreen />;
}
