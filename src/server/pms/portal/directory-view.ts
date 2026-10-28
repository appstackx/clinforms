/** Names of a clinic's sites, practitioners and appointment types by id (for the booking and portal pages). */
import "server-only";
import type { Practitioner, Service, Site } from "../../../modules/pms/core/types";
import type { DbContext } from "../../repos/context";
import { listPractitioners, listServices, listSites } from "../../repos/pms/directory";

export interface DirectoryView {
  sites: Map<string, Site>;
  practitioners: Map<string, Practitioner>;
  services: Map<string, Service>;
  siteName(id: string): string;
  practitionerName(id: string): string;
  serviceName(id: string): string;
}

export async function directoryView(ctx: DbContext, tenantId: string): Promise<DirectoryView> {
  const [sites, practitioners, services] = await Promise.all([
    listSites(ctx, tenantId, { includeInactive: true }),
    listPractitioners(ctx, tenantId, { includeInactive: true }),
    listServices(ctx, tenantId, { includeInactive: true }),
  ]);
  const s = new Map(sites.map((x) => [x.id, x]));
  const p = new Map(practitioners.map((x) => [x.id, x]));
  const v = new Map(services.map((x) => [x.id, x]));
  return {
    sites: s,
    practitioners: p,
    services: v,
    siteName: (id) => s.get(id)?.name ?? "the clinic",
    practitionerName: (id) => p.get(id)?.displayName ?? "a practitioner",
    serviceName: (id) => v.get(id)?.name ?? "Appointment",
  };
}
