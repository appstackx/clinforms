/**
 * Packages per clinic (25/10/2026), for ClinForms staff: the platform page (/app/platform) and admin:set-package call
 * these – never a clinic's own pages. Every change is audited twice, like trials and limits
 * (src/server/admin/clinic-plan.ts auditPlanChange): "clinic.package_set" / "clinic.package_removed" under the
 * clinic (who acted = ClinForms) and "platform.package_set" / "platform.package_removed" naming the administrator.
 * The internal notes are never written to an audit row (only whether they changed).
 *
 * Pure functions over a database handle (no Next imports).
 */
import type { Kysely } from "kysely";
import type { Database } from "../db/schema";
import { deleteClinicPackage, getClinicPackage, setClinicPackage, type ClinicPackage, type PackageInput } from "../repos/clinic-package";
import { RepoInputError } from "../repos/context";
import { auditPlanChange, requireOpenClinic, type PlanActor } from "./clinic-plan";

/** The audit detail of a package (no notes). */
function packageDetail(p: ClinicPackage | null): Record<string, unknown> | null {
  if (!p) return null;
  return {
    package: p.package,
    monthlyPricePence: p.monthlyPricePence,
    reportsIncluded: p.reportsIncluded,
    extraReportPence: p.extraReportPence,
    foundingPricePence: p.foundingPricePence,
    foundingUntil: p.foundingUntil,
    setupFeePence: p.setupFeePence,
    setupFeeStatus: p.setupFeeStatus,
    startsOn: p.startsOn,
  };
}

export async function setPackage(db: Kysely<Database>, actor: PlanActor, tenantId: string, input: PackageInput, now = new Date()): Promise<ClinicPackage> {
  await requireOpenClinic(db, tenantId);
  const before = await getClinicPackage({ db }, tenantId);
  const saved = await setClinicPackage({ db, now: () => now }, tenantId, input);
  await auditPlanChange(db, actor, tenantId, "package_set", {
    ...packageDetail(saved),
    before: packageDetail(before),
    notesChanged: (before?.notes ?? null) !== saved.notes,
  });
  return saved;
}

export async function removePackage(db: Kysely<Database>, actor: PlanActor, tenantId: string, now = new Date()): Promise<void> {
  await requireOpenClinic(db, tenantId);
  const before = await getClinicPackage({ db }, tenantId);
  if (!before) throw new RepoInputError(`The clinic "${String(tenantId).trim()}" has no package to remove.`);
  await deleteClinicPackage({ db, now: () => now }, tenantId);
  await auditPlanChange(db, actor, tenantId, "package_removed", { before: packageDetail(before) });
}
