import type { Metadata } from "next";
import { NewReportScreen } from "@/modules/medreport/ui/screens/new/new-report-screen";

export const metadata: Metadata = { title: "Complete a form" };

function param(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * "Complete a form" in the clinic's Studio: `form` preselects a referrer form, `lt` is a launch token, `from` (25/10/2026)
 * is an earlier report of the clinic whose checked notes start a new report on another form ("Complete another form
 * for this patient" – the server reads the record from the clinic's own copy of that report).
 *
 * The screen is keyed by `from` (review fix 25/10/2026): Next keeps a page mounted when only its search parameters
 * change, so without the key "Complete a form" in the top bar (/app/studio/new) would keep the earlier report's notes
 * on screen. A new `from` (or none) starts the wizard afresh.
 */
export default function TenantNewReportPage({
  searchParams,
}: {
  searchParams: { lt?: string | string[]; form?: string | string[]; from?: string | string[] };
}) {
  const from = param(searchParams.from);
  return <NewReportScreen key={from ?? ""} launchToken={param(searchParams.lt)} initialFormId={param(searchParams.form)} reuseReportId={from} />;
}
