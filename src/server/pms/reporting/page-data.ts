/**
 * What every report page and download needs after its own access check: the clinic's directory, the member's
 * site access, and the request built from the query string (period, site, practitioner – values outside the
 * member's access are ignored).
 */
import "server-only";
import { ukToday } from "../../../modules/pms/core/text";
import { parseReportFilter, type QuerySource } from "../../../modules/pms/reporting/schemas";
import type { SiteScope } from "../../../modules/pms/reporting/staff";
import type { RepoContext } from "../../repos/context";
import type { ClinicActor } from "../actor";
import { buildReportRequest, loadDirectory, type BuiltRequest, type ReportDirectory } from "./reports";
import { siteScopeOf } from "./scope";

export interface ReportPageData extends BuiltRequest {
  ctx: RepoContext;
  directory: ReportDirectory;
  scope: SiteScope;
  /** The query string that reproduces this view (for the download link), without a leading "?". */
  query: string;
}

export function filterQuery(built: Pick<BuiltRequest, "request">, extra: Record<string, string | number | null | undefined> = {}): string {
  const { request } = built;
  const q = new URLSearchParams();
  q.set("period", request.period.preset);
  if (request.period.preset === "custom") {
    q.set("from", request.period.from);
    q.set("to", request.period.to);
  }
  if (request.siteId) q.set("site", request.siteId);
  if (request.practitionerId) q.set("practitioner", request.practitionerId);
  for (const [k, v] of Object.entries(extra)) if (v !== null && v !== undefined && v !== "") q.set(k, String(v));
  return q.toString();
}

export async function reportPageData(actor: ClinicActor, params: QuerySource, now: Date = new Date()): Promise<ReportPageData> {
  const ctx = actor.repo();
  const [directory, scope] = await Promise.all([loadDirectory(ctx, actor.tenantId), siteScopeOf(actor)]);
  const built = buildReportRequest({ tenantId: actor.tenantId, params: parseReportFilter(params), today: ukToday(now), now: now.toISOString(), scope, directory });
  return { ...built, ctx, directory, scope, query: filterQuery(built) };
}
