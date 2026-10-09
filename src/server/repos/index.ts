/**
 * Tenant-scoped repositories over getDb() + getDataCipher(). Every function takes the tenant (or, for
 * member profiles, the organization) explicitly. See src/server/repos/context.ts for the rules.
 */
import "server-only";
import { getDataCipher } from "../crypto";
import { getDb } from "../db";
import type { RepoContext } from "./context";

export * from "./access-requests";
export * from "./audit";
export * from "./clinic-profile";
export * from "./form-files";
export * from "./forms";
export * from "./launch-tokens";
export * from "./maintenance";
export * from "./member-profile";
export * from "./partner-keys";
export * from "./rate-limits";
export * from "./reports";
export * from "./tenant-settings";
export type { SaveResult } from "./versioned";
export { RepoInputError, TENANT_ID_PATTERN, assertTenantId, ulid, type DbContext, type RepoContext } from "./context";

/** The app's repository context: the process-wide database and data cipher. */
export function repoContext(): RepoContext {
  return { db: getDb(), cipher: getDataCipher() };
}
