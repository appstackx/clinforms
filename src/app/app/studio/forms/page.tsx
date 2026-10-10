import type { Metadata } from "next";
import { FormsLibraryScreen } from "@/modules/medreport/ui/screens/forms/forms-library-screen";

export const metadata: Metadata = { title: "Referrer forms" };

/** The clinic's referrer forms library. */
export default function TenantReferrerFormsPage() {
  return <FormsLibraryScreen />;
}
