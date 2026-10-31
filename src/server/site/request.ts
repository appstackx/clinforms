/**
 * Request helpers shared by the public request forms: POST /api/access-requests (ClinForms' "Request access") and
 * ClinDesk's "Book a demo" server action (src/app/clindesk-site/demo/actions.ts).
 */
import "server-only";
import { getDb } from "@/server/db";
import { getDataCipher } from "@/server/crypto";
import type { RepoContext } from "@/server/repos/context";

/** Same-origin check: a browser always sends Origin on a cross-site POST; it must name this host. */
export function isSameOrigin(headers: Headers, requestUrl?: string): boolean {
  const origin = headers.get("origin");
  if (!origin) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? (requestUrl ? new URL(requestUrl).host : "");
  return originHost === host.split(",")[0].trim();
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
