import type { Metadata } from "next";
import { BatchScreen } from "@/modules/medreport/ui/screens/batch/batch-screen";

export const metadata: Metadata = { title: "Batch" };

/** In tenant mode the batch screen explains that batch needs a connected clinic system. */
export default function TenantBatchPage() {
  return <BatchScreen />;
}
