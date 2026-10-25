/**
 * `clinic_package` (migration 0007) – the clinic's package: name, monthly price, reports included, the price of each
 * extra report, an optional founding price fixed until a date, an optional set-up fee and its status, the start
 * date and internal notes. Written by ClinForms staff only (the platform page and admin:set-package, both through
 * src/server/admin/clinic-package.ts, which audits every change). Read by the clinic's "Plan & usage" page and the
 * platform usage page.
 *
 * One row per clinic (tenant_id = organization slug). No row = no package yet: every clinic made before this table
 * works exactly as before (usage is still counted, nothing is shown as an allowance).
 *
 * Setting a package also refreshes the CURRENT month's usage row (clinic_usage.package / plan_*), in the same atomic
 * batch, so this month is measured against the new package; earlier months keep the package they had.
 *
 * Pure database code (no Next imports); the clock comes from ctx.now (tests pin it).
 */
import { FOUNDING_MONTHS, SETUP_FEE_STATUSES, effectiveMonthlyPence, isPackageId, type PackageId, type SetupFeeStatus } from "../../lib/packages";
import { runBatch } from "../db/batch";
import { RepoInputError, assertTenantId, nowIso, toInt, type DbContext } from "./context";
import { isMissingUsageTable, noteMissingUsageTables, ukDateOf, ukPeriodOf } from "./usage-period";

export interface ClinicPackage {
  tenantId: string;
  package: PackageId;
  monthlyPricePence: number;
  reportsIncluded: number;
  extraReportPence: number;
  foundingPricePence: number | null;
  /** "YYYY-MM-DD" inclusive, or null. */
  foundingUntil: string | null;
  setupFeePence: number | null;
  setupFeeStatus: SetupFeeStatus | null;
  /** "YYYY-MM-DD" */
  startsOn: string;
  /** Internal only. */
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export const PACKAGE_NOTES_MAX = 1000;
export const MAX_MONTHLY_PENCE = 100_000_000;
export const MAX_EXTRA_PENCE = 10_000_000;
export const MAX_REPORTS_INCLUDED = 1_000_000;

type PackageRow = {
  tenant_id: string;
  package: string;
  monthly_price_pence: number;
  reports_included: number;
  extra_report_pence: number;
  founding_price_pence: number | null;
  founding_until: string | null;
  setup_fee_pence: number | null;
  setup_fee_status: string | null;
  starts_on: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

function toPackage(row: PackageRow): ClinicPackage {
  const status =
    row.setup_fee_status && (SETUP_FEE_STATUSES as readonly string[]).indexOf(row.setup_fee_status) >= 0 ? (row.setup_fee_status as SetupFeeStatus) : null;
  return {
    tenantId: row.tenant_id,
    package: isPackageId(row.package) ? row.package : "custom",
    monthlyPricePence: toInt(row.monthly_price_pence),
    reportsIncluded: toInt(row.reports_included),
    extraReportPence: toInt(row.extra_report_pence),
    foundingPricePence: row.founding_price_pence === null ? null : toInt(row.founding_price_pence),
    foundingUntil: row.founding_until,
    setupFeePence: row.setup_fee_pence === null ? null : toInt(row.setup_fee_pence),
    setupFeeStatus: status,
    startsOn: row.starts_on,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getClinicPackage(ctx: DbContext, tenantId: string): Promise<ClinicPackage | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom("clinic_package").selectAll().where("tenant_id", "=", tenantId).executeTakeFirst();
  return row ? toPackage(row) : null;
}

export async function listClinicPackages(ctx: DbContext): Promise<ClinicPackage[]> {
  const rows = await ctx.db.selectFrom("clinic_package").selectAll().orderBy("tenant_id").execute();
  return rows.map(toPackage);
}

/** getClinicPackage for the app's pages: a database before migration 0007 reads as "no package". */
export async function readClinicPackage(ctx: DbContext, tenantId: string): Promise<ClinicPackage | null> {
  try {
    return await getClinicPackage(ctx, tenantId);
  } catch (err) {
    if (!isMissingUsageTable(err)) throw err;
    noteMissingUsageTables();
    return null;
  }
}

export async function readClinicPackages(ctx: DbContext): Promise<ClinicPackage[]> {
  try {
    return await listClinicPackages(ctx);
  } catch (err) {
    if (!isMissingUsageTable(err)) throw err;
    noteMissingUsageTables();
    return [];
  }
}

export interface PackageInput {
  package: PackageId;
  monthlyPricePence: number;
  reportsIncluded: number;
  extraReportPence: number;
  foundingPricePence?: number | null;
  /** Default with a founding price: FOUNDING_MONTHS from the start, less a day. */
  foundingUntil?: string | null;
  setupFeePence?: number | null;
  setupFeeStatus?: SetupFeeStatus | null;
  /** Default: today (UK). */
  startsOn?: string | null;
  notes?: string | null;
}

function wholePence(value: unknown, what: string, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) {
    throw new RepoInputError(`${what} must be a whole number of pence from 0 to ${max.toLocaleString("en-GB")}.`);
  }
  return value;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date "YYYY-MM-DD" (2000–2100). */
export function assertUkDate(value: unknown, what: string): string {
  const m = typeof value === "string" ? DATE.exec(value.trim()) : null;
  if (!m) throw new RepoInputError(`${what} must be a date (YYYY-MM-DD).`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (y < 2000 || y > 2100 || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) throw new RepoInputError(`${what} is not a real date.`);
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** "YYYY-MM-DD" + n months − 1 day (a 12-month founding period from 25/10/2026 ends 24/10/2027). */
export function foundingEnd(startsOn: string, months = FOUNDING_MONTHS): string {
  const m = DATE.exec(startsOn);
  if (!m) throw new RepoInputError("The start date must be YYYY-MM-DD.");
  const start = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const target = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(start.getUTCDate(), lastDay));
  target.setUTCDate(target.getUTCDate() - 1);
  return target.toISOString().slice(0, 10);
}

/** The package as it will be stored (validated, defaults applied). */
export function normalisePackageInput(input: PackageInput, now: Date): Omit<ClinicPackage, "tenantId" | "createdAt" | "updatedAt"> {
  if (!isPackageId(input.package)) throw new RepoInputError("Choose a package: Starter, Practice, Group, Group Plus, Custom or Trial.");
  const monthly = wholePence(input.monthlyPricePence, "The monthly price", MAX_MONTHLY_PENCE);
  const extra = wholePence(input.extraReportPence, "The price of an extra report", MAX_EXTRA_PENCE);
  const included = input.reportsIncluded;
  if (typeof included !== "number" || !Number.isInteger(included) || included < 0 || included > MAX_REPORTS_INCLUDED) {
    throw new RepoInputError(`Reports included must be a whole number from 0 to ${MAX_REPORTS_INCLUDED.toLocaleString("en-GB")}.`);
  }
  const startsOn = input.startsOn ? assertUkDate(input.startsOn, "The start date") : ukDateOf(now);
  const founding =
    input.foundingPricePence === null || input.foundingPricePence === undefined
      ? null
      : wholePence(input.foundingPricePence, "The founding price", MAX_MONTHLY_PENCE);
  let foundingUntil: string | null = null;
  if (founding !== null) {
    foundingUntil = input.foundingUntil ? assertUkDate(input.foundingUntil, "The founding price's end date") : foundingEnd(startsOn);
    if (foundingUntil < startsOn) throw new RepoInputError("The founding price's end date is before the package starts.");
  } else if (input.foundingUntil) {
    throw new RepoInputError("A founding end date needs a founding price.");
  }
  const setupFee =
    input.setupFeePence === null || input.setupFeePence === undefined ? null : wholePence(input.setupFeePence, "The set-up fee", MAX_MONTHLY_PENCE);
  const setupStatus = input.setupFeeStatus ?? null;
  if (setupStatus !== null && (SETUP_FEE_STATUSES as readonly string[]).indexOf(setupStatus) < 0)
    throw new RepoInputError("The set-up fee is due, paid or waived.");
  if (setupStatus !== null && setupFee === null) throw new RepoInputError("Give the set-up fee with its status.");
  const notes = input.notes === null || input.notes === undefined || input.notes.trim() === "" ? null : input.notes.trim();
  if (notes !== null && notes.length > PACKAGE_NOTES_MAX) throw new RepoInputError(`Notes must be at most ${PACKAGE_NOTES_MAX} characters.`);
  return {
    package: input.package,
    monthlyPricePence: monthly,
    reportsIncluded: included,
    extraReportPence: extra,
    foundingPricePence: founding,
    foundingUntil,
    setupFeePence: setupFee,
    setupFeeStatus: setupFee === null ? null : (setupStatus ?? "due"),
    startsOn,
    notes,
  };
}

/**
 * Saves the clinic's package (insert or replace) and, in the same atomic batch, measures the current UK month against
 * it (the month's usage row, when it exists, gets the new package; a later first event of the month copies it).
 */
export async function setClinicPackage(ctx: DbContext, tenantId: string, input: PackageInput): Promise<ClinicPackage> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  const now = new Date(at);
  const v = normalisePackageInput(input, now);
  const row = {
    package: v.package,
    monthly_price_pence: v.monthlyPricePence,
    reports_included: v.reportsIncluded,
    extra_report_pence: v.extraReportPence,
    founding_price_pence: v.foundingPricePence,
    founding_until: v.foundingUntil,
    setup_fee_pence: v.setupFeePence,
    setup_fee_status: v.setupFeeStatus,
    starts_on: v.startsOn,
    notes: v.notes,
  };
  const period = ukPeriodOf(now);
  await runBatch(ctx.db, [
    ctx.db
      .insertInto("clinic_package")
      .values({ tenant_id: tenantId, ...row, created_at: at, updated_at: at })
      .onConflict((oc) => oc.column("tenant_id").doUpdateSet({ ...row, updated_at: at })),
    ctx.db
      .updateTable("clinic_usage")
      .set({
        package: v.package,
        plan_price_pence: effectiveMonthlyPence(v, period),
        plan_reports_included: v.reportsIncluded,
        plan_extra_report_pence: v.extraReportPence,
        updated_at: at,
      })
      .where("tenant_id", "=", tenantId)
      .where("period", "=", period),
  ]);
  const saved = await getClinicPackage(ctx, tenantId);
  if (!saved) throw new Error("clinic_package write did not persist.");
  return saved;
}

/** Removes the clinic's package (no package from now on); this month's usage row stops naming one. */
export async function deleteClinicPackage(ctx: DbContext, tenantId: string): Promise<boolean> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  const period = ukPeriodOf(new Date(at));
  const existed = await getClinicPackage(ctx, tenantId);
  if (!existed) return false;
  await runBatch(ctx.db, [
    ctx.db
      .updateTable("clinic_usage")
      .set({ package: null, plan_price_pence: null, plan_reports_included: null, plan_extra_report_pence: null, updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("period", "=", period),
    ctx.db.deleteFrom("clinic_package").where("tenant_id", "=", tenantId),
  ]);
  return true;
}
