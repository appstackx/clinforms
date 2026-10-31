/**
 * Which brand's host a link in an email (or a link shown to an administrator) goes to – contract.md §2, docs/auth.md
 * "Two brand hosts". The rule is the CLINIC's, not the request's: a clinic with the clinic package is sent to the
 * clinic brand's host (clindesk.co.uk), every other clinic to ClinForms (clinforms.co.uk). The origin itself comes from
 * the auth settings (config.ts brandOrigin): a deployment that does not serve the clinic brand's host (previews,
 * production before CLINFORMS_AUTH_ORIGINS is set) keeps every link on its own origin.
 *
 *   invitation          the inviting clinic's brand
 *   password reset      the brand of the person's clinics; if they belong to clinics of both brands, the brand of the
 *                       host they asked on (when it is one of the app's own origins), else ClinForms
 *   withLinkBrand(b, f) an explicit brand for links built inside f (an administrator's reset link for a member of a
 *                       named clinic, the platform's owner reset link, a clinic created for the clinic brand)
 *
 * Never throws: a package that cannot be read (a deployment ahead of its migration) counts as ClinForms, exactly as
 * src/server/pms/entitlements.ts treats it.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Kysely } from "kysely";
import type { BrandId } from "../../lib/brand";
import { pmsNow } from "../../modules/pms/core/clock";
import { packageIsOn } from "../../modules/pms/core/entitlements";
import type { Database } from "../db/schema";
import { logAuthEvent } from "../email/log";
import { listEntitlements } from "../repos/pms/entitlements";

const hint = new AsyncLocalStorage<BrandId>();

/** Runs fn with links built inside it going to `brand`'s host (overrides the clinic / person rule). */
export function withLinkBrand<T>(brand: BrandId, fn: () => Promise<T>): Promise<T> {
  return hint.run(brand, fn);
}

/** The brand set by withLinkBrand around the current call, if any. */
export function linkBrandHint(): BrandId | undefined {
  return hint.getStore();
}

/** "clinic" when the clinic (tenant id = organization slug) has the clinic package on, else "clinforms". */
export async function clinicLinkBrand(db: Kysely<Database>, tenantId: string | null | undefined): Promise<BrandId> {
  if (!tenantId) return "clinforms";
  try {
    const rows = await listEntitlements({ db }, tenantId);
    return packageIsOn("clinic", rows.find((e) => e.package === "clinic") ?? null, pmsNow()) ? "clinic" : "clinforms";
  } catch (err) {
    logAuthEvent("auth.link_brand_unreadable", { error: err instanceof Error ? err.name : "error" });
    return "clinforms";
  }
}

/** clinicLinkBrand by Better Auth organization id. */
export async function organizationLinkBrand(db: Kysely<Database>, organizationId: string | null | undefined): Promise<BrandId> {
  if (!organizationId) return "clinforms";
  try {
    const org = await db.selectFrom("organization").select("slug").where("id", "=", organizationId).executeTakeFirst();
    return clinicLinkBrand(db, org?.slug);
  } catch {
    return "clinforms";
  }
}

/**
 * The brand for a person's own links (password reset): the brand all their clinics share; with clinics of both
 * brands, `requestBrand` (the brand of the host they asked on, already checked against the app's own origins) or
 * ClinForms; with no clinic, `requestBrand` or ClinForms.
 */
export async function userLinkBrand(db: Kysely<Database>, userId: string, requestBrand: BrandId | null = null): Promise<BrandId> {
  let tenants: string[] = [];
  try {
    const rows = await db
      .selectFrom("member")
      .innerJoin("organization", "organization.id", "member.organizationId")
      .select("organization.slug")
      .where("member.userId", "=", userId)
      .execute();
    tenants = rows.map((r) => r.slug);
  } catch {
    return requestBrand ?? "clinforms";
  }
  const brands = new Set(await Promise.all(tenants.map((t) => clinicLinkBrand(db, t))));
  if (brands.size === 1) return Array.from(brands)[0];
  return requestBrand ?? "clinforms";
}
