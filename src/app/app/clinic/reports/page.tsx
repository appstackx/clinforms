import { notFound, redirect } from "next/navigation";
import { reportsFor } from "@/modules/pms/reporting/catalogue";
import { requireClinicActor } from "@/server/pms/actor";

export const dynamic = "force-dynamic";

type Props = { searchParams: Record<string, string | string[] | undefined> };

/**
 * /app/clinic/reports – opens the first report the member may see (design round 2c: the reports' own list sits in
 * the left navigation). "View all reports" or "See reports for own caseload"; anyone else gets the 404 page.
 * The same runs in generateMetadata, so the redirect (or the 404) is answered before the section's loading
 * skeleton streams (src/server/pms/page-gate.ts).
 */
async function openFirstReport({ searchParams }: Props): Promise<never> {
  const actor = await requireClinicActor();
  const first = reportsFor((p) => actor.can(p))[0]?.reports[0];
  if (!first) notFound();
  const site = typeof searchParams.site === "string" ? `?site=${encodeURIComponent(searchParams.site)}` : "";
  redirect(`${first.href}${site}`);
}

export const generateMetadata = openFirstReport;

export default async function ReportsStartPage(props: Props) {
  return openFirstReport(props);
}
