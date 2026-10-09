import type { Metadata } from "next";
import { NewReportScreen } from "@/modules/medreport/ui/screens/new/new-report-screen";

export const metadata: Metadata = { title: "Complete a form" };

function param(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Reads `lt` (launch token) and `form` (preferred referrer form ID) from searchParams on the SERVER and
 * passes them as props, so the client needs no useSearchParams/Suspense. The client verifies the
 * launch token and strips it from the URL.
 *
 * Owner: studio-a agent.
 */
export default function NewReportPage({ searchParams }: { searchParams: { lt?: string | string[]; form?: string | string[] } }) {
  return <NewReportScreen launchToken={param(searchParams.lt)} initialFormId={param(searchParams.form)} />;
}
