/**
 * Tenancy: tenantId = the Better Auth organization's slug (docs/production-architecture.md §3).
 * Rules: ^[a-z0-9][a-z0-9-]*$, 3–63 characters, no trailing or double hyphen, never a reserved word, and
 * IMMUTABLE once the clinic exists (every stored row, key and ciphertext AAD carries it).
 */
import { TENANT_ID_PATTERN } from "../repos/context";

/** Reserved: the public demo tenant and words that would be confusing as a clinic id. */
export const RESERVED_TENANT_SLUGS: ReadonlySet<string> = new Set([
  "demo",
  "admin",
  "api",
  "app",
  "auth",
  "clinforms",
  "platform",
  "public",
  "reports",
  "root",
  "sandbox",
  "settings",
  "support",
  "system",
  "test",
  "www",
]);

export type SlugProblem = "format" | "length" | "reserved";

export function tenantSlugProblem(slug: unknown): SlugProblem | null {
  if (typeof slug !== "string") return "format";
  if (slug.length < 3 || slug.length > 63) return "length";
  if (!TENANT_ID_PATTERN.test(slug) || slug.endsWith("-") || slug.includes("--")) return "format";
  if (RESERVED_TENANT_SLUGS.has(slug)) return "reserved";
  return null;
}

export class TenantSlugError extends Error {
  readonly code = "INVALID_TENANT_SLUG";
  constructor(
    readonly problem: SlugProblem,
    slug: string,
  ) {
    super(
      problem === "reserved"
        ? `"${slug}" is reserved and cannot be a clinic id.`
        : problem === "length"
          ? "A clinic id is 3–63 characters."
          : "A clinic id uses lower-case letters, digits and single hyphens, and starts and ends with a letter or digit.",
    );
    this.name = "TenantSlugError";
  }
}

export function assertTenantSlug(slug: string): string {
  const problem = tenantSlugProblem(slug);
  if (problem) throw new TenantSlugError(problem, String(slug));
  return slug;
}
