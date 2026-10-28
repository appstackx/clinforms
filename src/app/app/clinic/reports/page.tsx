import { notFound, redirect } from "next/navigation";
import { reportsFor } from "@/modules/pms/reporting/catalogue";
import { requireClinicActor } from "@/server/pms/actor";

export const dynamic = "force-dynamic";

/**
 * /app/clinic/reports – opens the first report the member may see (design round 2c: the reports' own list sits in
 * the left navigation). "View all reports" or "See reports for own caseload"; anyone else gets the 404 page.
 */
export default async function ReportsStartPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const actor = await requireClinicActor();
  const first = reportsFor((p) => actor.can(p))[0]?.reports[0];
  if (!first) notFound();
  const site = typeof searchParams.site === "string" ? `?site=${encodeURIComponent(searchParams.site)}` : "";
  redirect(`${first.href}${site}`);
}
