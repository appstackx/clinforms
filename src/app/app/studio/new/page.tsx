import type { Metadata } from "next";
import { NewReportScreen } from "@/modules/medreport/ui/screens/new/new-report-screen";

export const metadata: Metadata = { title: "Complete a form" };

function param(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** "Complete a form" in the clinic's Studio: `form` preselects a referrer form, `lt` is a launch token. */
export default function TenantNewReportPage({ searchParams }: { searchParams: { lt?: string | string[]; form?: string | string[] } }) {
  return <NewReportScreen launchToken={param(searchParams.lt)} initialFormId={param(searchParams.form)} />;
}
