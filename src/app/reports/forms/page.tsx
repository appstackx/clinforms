import type { Metadata } from "next";
import { FormsLibraryScreen } from "@/modules/medreport/ui/screens/forms/forms-library-screen";

export const metadata: Metadata = { title: "Referrer forms" };

/** Referrer forms library. Owner: studio-a agent. */
export default function ReferrerFormsPage() {
  return <FormsLibraryScreen />;
}
