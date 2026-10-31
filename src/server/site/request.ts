/**
 * Request helpers shared by the public request forms: POST /api/access-requests (ClinForms' "Request access") and
 * ClinDesk's "Book a demo" server action (src/app/clindesk-site/demo/actions.ts).
 */
import "server-only";
import { isAllowedAppOrigin } from "@/server/auth/config";
import { getDb } from "@/server/db";
import { getDataCipher } from "@/server/crypto";
import type { RepoContext } from "@/server/repos/context";

/**
 * Origin check for the public forms: a browser always sends Origin on a cross-site POST; it must be one of this
 * app's own origins (src/server/auth/config.ts allowedAppOrigins – BETTER_AUTH_URL + CLINFORMS_AUTH_ORIGINS, a
 * preview's own hostnames: the same list sign-in trusts), on either brand's host. No Origin at all (a same-origin
 * request from an older browser, a server-side call) passes as before.
 */
export function isSameOrigin(headers: Headers, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const origin = headers.get("origin");
  if (!origin) return true;
  return isAllowedAppOrigin(origin, env);
}

/** Repository context for a table without encrypted columns: the data cipher is resolved only if used. */
export function siteRepoContext(): RepoContext {
  const db = getDb();
  return {
    db,
    get cipher() {
      return getDataCipher();
    },
  };
}
