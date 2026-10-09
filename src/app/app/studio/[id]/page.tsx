import type { Metadata } from "next";
import { ReviewScreen } from "@/modules/medreport/ui/screens/review/review-screen";

export const metadata: Metadata = { title: "Review report" };

/** Review, amend and approve one of the clinic's reports (the client loads it from the clinic's store). */
export default function TenantReportPage({ params }: { params: { id: string } }) {
  return <ReviewScreen reportId={params.id} />;
}
