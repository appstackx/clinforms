import "server-only";

/**
 * Tenant-mode storage of the Report API (wave 2): the clinic's server storage for the Studio
 * (src/server/store/tenant-store.ts over the encrypted repositories).
 *
 * Lazy: nothing reads the database or the data keys until a /store request from a signed-in member needs them,
 * so the public demo (/reports, browser storage) is unaffected.
 *
 * Who is calling is NOT decided here: `authenticate` comes from the glue's hostCapabilities() (Better Auth
 * session read from the database, never the cookie cache), and the /store handlers resolve the caller through
 * the module's requireActor (auth/actor.ts) like every other endpoint.
 *
 * Owner: store slice (wave 2), unified with the API slice's actor seam at integration.
 */
import type { MedreportDeps } from "@/modules/medreport/api/deps";
import { repoContext } from "@/server/repos";
import { createTenantStore } from "@/server/store/tenant-store";

export function tenantDeps(): Required<Pick<MedreportDeps, "tenantStore">> {
  return {
    tenantStore: createTenantStore(repoContext),
  };
}
