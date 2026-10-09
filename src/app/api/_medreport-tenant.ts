import "server-only";

/**
 * Tenant-mode dependencies of the Report API (wave 2): who is signed in (Better Auth session → the member of the
 * active clinic, src/server/auth/medreport-actor.ts) and the clinic's server storage for the Studio
 * (src/server/store/tenant-store.ts over the encrypted repositories).
 *
 * Both are lazy: nothing reads the database, the auth settings or the data keys until a request needs them, so
 * the public demo (/reports, no sign-in configured) is unaffected – `authenticate` answers null there.
 *
 * Owner: store slice (wave 2). Integration note: the API slice also wires `authenticate` (auth/actor.ts); keep
 * ONE definition in getMedreportDeps() when merging.
 */
import type { MedreportDeps } from "@/modules/medreport/api/deps";
import { getAuth } from "@/server/auth/auth";
import { buildAuthContext } from "@/server/auth/medreport-actor";
import { getDb } from "@/server/db";
import { repoContext } from "@/server/repos";
import { createTenantStore } from "@/server/store/tenant-store";

export function tenantDeps(): Required<Pick<MedreportDeps, "authenticate" | "tenantStore">> {
  return {
    async authenticate(req) {
      try {
        return await buildAuthContext(getAuth(), getDb(), req.headers);
      } catch {
        // Sign-in not configured (the public demo) or the database is unreachable: nobody is signed in.
        return null;
      }
    },
    tenantStore: createTenantStore(repoContext),
  };
}
