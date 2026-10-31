/**
 * Platform operations for packages and demonstration clinics, used by the admin scripts
 * (scripts/admin/set-entitlement.ts, scripts/pms/seed-demo.ts). Pure functions over a database handle – no Next
 * imports – so they are tested directly (src/server/pms/admin.test.ts).
 */
import type { Kysely } from "kysely";
import {
  isEntitlementStatus,
  isPackageId,
  isPriceSource,
  packageIsOn,
  type EntitlementStatus,
  type PackageId,
  type PriceSource,
} from "../../modules/pms/core/entitlements";
import { PLATFORM_USER_ID } from "../auth/create-auth";
import type { Database } from "../db/schema";
import { PLATFORM_AUDIT_TENANT } from "../admin/platform-console";
import { appendAudit } from "../repos/audit";
import { RepoInputError } from "../repos/context";
import { getEntitlement, setEntitlement } from "../repos/pms/entitlements";
import { pmsNow } from "../../modules/pms/core/clock";

export interface SetEntitlementPlanInput {
  slug: string;
  package: PackageId;
  on: boolean;
  /** Default: "active" when on, "paused" when off. */
  status?: EntitlementStatus;
  planCode?: string | null;
  priceSource?: PriceSource | null;
  note?: string | null;
  /** false (default) = preview only. */
  confirm?: boolean;
}

export interface SetEntitlementPlan {
  tenantId: string;
  clinicName: string;
  package: PackageId;
  before: { status: string | null; on: boolean };
  after: { status: EntitlementStatus; on: boolean };
  dryRun: boolean;
}

/** Previews (default) or applies a package change for one clinic. Refuses unknown or closed clinics. */
export async function setClinicEntitlement(db: Kysely<Database>, input: SetEntitlementPlanInput, now = pmsNow()): Promise<SetEntitlementPlan> {
  if (!isPackageId(input.package)) throw new RepoInputError("--package must be reports or clinic.");
  const status: EntitlementStatus = input.status ?? (input.on ? "active" : "paused");
  if (!isEntitlementStatus(status)) throw new RepoInputError("--status must be active, trial, paused or cancelled.");
  if (input.on !== (status === "active" || status === "trial")) throw new RepoInputError("--on goes with --status active or trial, --off with paused or cancelled.");
  if (input.priceSource !== undefined && input.priceSource !== null && !isPriceSource(input.priceSource)) {
    throw new RepoInputError("--price-source must be list, founding or design_partner.");
  }
  const org = await db.selectFrom("organization").select(["id", "name", "metadata"]).where("slug", "=", input.slug).executeTakeFirst();
  if (!org) throw new RepoInputError(`No clinic with the id "${input.slug}".`);
  if (org.metadata && /"offboardedAt"/.test(org.metadata)) throw new RepoInputError(`The clinic "${input.slug}" is closed.`);
  const ctx = { db, now: () => now };
  const current = await getEntitlement(ctx, input.slug, input.package);
  const plan: SetEntitlementPlan = {
    tenantId: input.slug,
    clinicName: org.name,
    package: input.package,
    before: { status: current?.status ?? null, on: packageIsOn(input.package, current, now) },
    after: { status, on: input.on },
    dryRun: !input.confirm,
  };
  if (!input.confirm) return plan;
  const result = await setEntitlement(
    ctx,
    input.slug,
    input.package,
    { status, planCode: input.planCode, priceSource: input.priceSource, note: input.note ?? "Set with the admin script" },
    { userId: PLATFORM_USER_ID, sessionId: null },
  );
  await appendAudit(ctx, PLATFORM_AUDIT_TENANT, {
    userId: PLATFORM_USER_ID,
    action: "platform.entitlement_set",
    targetType: "organization",
    targetId: org.id,
    detail: { tenantId: input.slug, package: input.package, on: result.isOn, wasOn: result.wasOn, via: "script" },
  });
  return { ...plan, after: { status, on: result.isOn } };
}
