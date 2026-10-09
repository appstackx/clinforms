import type { Metadata } from "next";
import { ReviewScreen } from "@/modules/medreport/ui/screens/review/review-screen";

export const metadata: Metadata = { title: "Review report" };

/** Reports live in the browser, so the server only passes the ID. Owner: studio-b agent. */
export default function ReportPage({ params }: { params: { id: string } }) {
  return <ReviewScreen reportId={params.id} />;
}
