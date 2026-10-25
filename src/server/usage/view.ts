/**
 * What the usage pages show (25/10/2026), built from the database – pure functions over a handle (no Next imports):
 *
 * - clinicPlanUsage(): the clinic's "Plan & usage" page (/app/settings/plan). Owners and administrators get the
 *   package, this month against the allowance, extra reports, the last 6 months, the trial and drafting settings.
 *   Clinicians and staff get ONLY "This month: X of N reports" (no prices). No tokens or costs for anyone.
 * - platformUsage(): the platform usage page (/app/platform/usage, ClinForms staff only): every clinic's month with
 *   calls, tokens, estimated drafting cost and margin; totals; and platformUsageCsv() (formula-injection safe).
 *
 * Every clinic read is scoped to the clinic's own tenant id; only the platform builder reads across clinics.
 */
import type { Kysely } from "kysely";
import { effectiveTenantLimits } from "../../modules/medreport/ai/live-gate";
import { effectiveMonthlyPence, extraReports, packageLabel, periodLabel, type PackageId, type SetupFeeStatus } from "../../lib/packages";
import { listClinics } from "../auth/platform";
import { isManager, type MemberRole } from "../auth/roles";
import type { Database } from "../db/schema";
import { csvCell } from "../admin/activity";
import { readClinicPackage, readClinicPackages, type ClinicPackage } from "../repos/clinic-package";
import { clinicAccessOf, readClinicPlan, readClinicPlans, type ClinicAccess, type ClinicPlan } from "../repos/clinic-plan";
import { getClinicProfile } from "../repos/clinic-profile";
import { countCountedNotApprovedByTenant, emptyUsageMonth, listUsageForPeriod, readCountedNotApproved, readUsageMonths, type UsageMonth } from "../repos/usage";
import { isMissingUsageTable, noteMissingUsageTables, recentPeriods, ukPeriodOf } from "../repos/usage-period";
import { microUsdToPence } from "./pricing";

export const HISTORY_MONTHS = 6;

/** The package terms that applied to a month: the month's own record, else (this month) the current package. */
export interface MonthTerms {
  package: PackageId | null;
  pricePence: number | null;
  reportsIncluded: number | null;
  extraReportPence: number | null;
}

export function termsForMonth(month: UsageMonth | null, current: ClinicPackage | null, period: string, currentPeriod: string): MonthTerms {
  if (month && month.package) {
    return {
      package: month.package as PackageId,
      pricePence: month.planPricePence,
      reportsIncluded: month.planReportsIncluded,
      extraReportPence: month.planExtraReportPence,
    };
  }
  if (current && period === currentPeriod && (!month || month.package === null)) {
    return {
      package: current.package,
      pricePence: effectiveMonthlyPence(current, period),
      reportsIncluded: current.reportsIncluded,
      extraReportPence: current.extraReportPence,
    };
  }
  return {
    package: null,
    pricePence: null,
    reportsIncluded: null,
    extraReportPence: null,
  };
}

/* ------------------------------------------------------------------------------------------------
 * The clinic's page
 * ----------------------------------------------------------------------------------------------*/

export interface ClinicMonthLine {
  period: string;
  label: string;
  counted: number;
  approved: number;
  included: number | null;
  extra: number;
}

export interface ClinicPlanUsageManagerView {
  kind: "manager";
  period: string;
  periodLabel: string;
  package: {
    id: PackageId;
    label: string;
    /** This month's price (the founding price while it applies). */
    monthlyPricePence: number;
    listPricePence: number;
    foundingPricePence: number | null;
    foundingUntil: string | null;
    reportsIncluded: number;
    /** null = not agreed yet. */
    extraReportPence: number | null;
    setupFeePence: number | null;
    setupFeeStatus: SetupFeeStatus | null;
    startsOn: string;
  } | null;
  trial: {
    access: ClinicAccess;
    startsAt: string | null;
    endsAt: string | null;
  } | null;
  thisMonth: {
    counted: number;
    approved: number;
    inProgress: number;
    included: number | null;
    extra: number;
    extraReportPence: number | null;
    extraChargePence: number;
  };
  history: ClinicMonthLine[];
  drafting: {
    enabled: boolean;
    perMinute: number;
    perDay: number;
    ownLimits: boolean;
  };
}

export interface ClinicPlanUsageMemberView {
  kind: "member";
  period: string;
  periodLabel: string;
  counted: number;
  included: number | null;
}

export type ClinicPlanUsageView = ClinicPlanUsageManagerView | ClinicPlanUsageMemberView;

function trialOf(plan: ClinicPlan | null, now: Date): ClinicPlanUsageManagerView["trial"] {
  if (!plan || plan.status !== "trial") return null;
  return {
    access: clinicAccessOf(plan, now),
    startsAt: plan.trialStartsAt,
    endsAt: plan.trialEndsAt,
  };
}

export async function clinicPlanUsage(db: Kysely<Database>, membership: { tenantId: string; role: string }, now = new Date()): Promise<ClinicPlanUsageView> {
  const tenantId = membership.tenantId;
  const period = ukPeriodOf(now);
  const periods = recentPeriods(period, HISTORY_MONTHS);
  const ctx = { db };
  const [pkg, months] = await Promise.all([readClinicPackage(ctx, tenantId), readUsageMonths(ctx, tenantId, periods)]);
  const byPeriod = new Map(months.map((m) => [m.period, m] as const));
  const current = byPeriod.get(period) ?? null;
  const terms = termsForMonth(current, pkg, period, period);
  const counted = current?.billableReports ?? 0;
  if (!isManager(membership.role as MemberRole)) {
    return {
      kind: "member",
      period,
      periodLabel: periodLabel(period),
      counted,
      included: terms.reportsIncluded,
    };
  }
  const [plan, profile, inProgress] = await Promise.all([
    readClinicPlan(ctx, tenantId),
    getClinicProfile(ctx, tenantId),
    readCountedNotApproved(ctx, tenantId, period),
  ]);
  const extra = extraReports(counted, terms.reportsIncluded);
  const history: ClinicMonthLine[] = periods.map((p) => {
    const m = byPeriod.get(p) ?? null;
    const t = termsForMonth(m, pkg, p, period);
    const c = m?.billableReports ?? 0;
    return {
      period: p,
      label: periodLabel(p),
      counted: c,
      approved: m?.reportsApproved ?? 0,
      included: t.reportsIncluded,
      extra: extraReports(c, t.reportsIncluded),
    };
  });
  const own =
    plan && (plan.livePerMinute || plan.livePerDay)
      ? {
          ...(plan.livePerMinute ? { perMinute: plan.livePerMinute } : {}),
          ...(plan.livePerDay ? { perDay: plan.livePerDay } : {}),
        }
      : undefined;
  const limits = effectiveTenantLimits(own);
  return {
    kind: "manager",
    period,
    periodLabel: periodLabel(period),
    package: pkg
      ? {
          id: pkg.package,
          label: packageLabel(pkg.package),
          monthlyPricePence: effectiveMonthlyPence(pkg, period),
          listPricePence: pkg.monthlyPricePence,
          foundingPricePence: pkg.foundingPricePence,
          foundingUntil: pkg.foundingUntil,
          reportsIncluded: pkg.reportsIncluded,
          extraReportPence: pkg.extraReportPence,
          setupFeePence: pkg.setupFeePence,
          setupFeeStatus: pkg.setupFeeStatus,
          startsOn: pkg.startsOn,
        }
      : null,
    trial: trialOf(plan, now),
    thisMonth: {
      counted,
      approved: current?.reportsApproved ?? 0,
      inProgress,
      included: terms.reportsIncluded,
      extra,
      extraReportPence: terms.extraReportPence,
      extraChargePence: extra * (terms.extraReportPence ?? 0),
    },
    history,
    drafting: {
      enabled: profile?.draftingEnabled === true,
      perMinute: limits.perMinute,
      perDay: limits.perDay,
      ownLimits: Boolean(own),
    },
  };
}

/* ------------------------------------------------------------------------------------------------
 * The platform page
 * ----------------------------------------------------------------------------------------------*/

export interface PlatformUsageRow {
  tenantId: string;
  name: string;
  closed: boolean;
  /** A demo clinic (migration 0008, made-up data only): counted like any clinic – its drafting costs are real. */
  demoClinic: boolean;
  package: PackageId | null;
  packageLabel: string;
  pricePence: number;
  reportsIncluded: number | null;
  counted: number;
  approved: number;
  /** Approvals of amended versions (they never count again). */
  amendmentsApproved: number;
  countedNotApproved: number;
  extra: number;
  extraReportPence: number | null;
  extraChargePence: number;
  draftingCalls: number;
  failedCalls: number;
  readingCalls: number;
  formsRead: number;
  questionSets: number;
  reportsStarted: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costMicroUsd: number;
  costPence: number;
  marginPence: number;
}

export interface PlatformUsage {
  period: string;
  periodLabel: string;
  rate: number;
  rows: PlatformUsageRow[];
  /**
   * Totals of every row – except the money a clinic pays (price, extra reports and their charge), which leaves out demo
   * clinics (made-up packages) and clinics on a Trial package (nobody pays for either). The margin = that money − the
   * drafting cost of EVERY clinic (those drafting costs are real).
   */
  totals: Omit<PlatformUsageRow, "tenantId" | "name" | "closed" | "demoClinic" | "package" | "packageLabel" | "reportsIncluded" | "extraReportPence">;
  /** The demo clinics' share: how many rows, and their (real) drafting cost – included in the cost total. */
  demo: { rows: number; costPence: number; costMicroUsd: number };
  /** False when migration 0007 is not applied (everything reads as empty). */
  available: boolean;
}

const SUMMED = [
  "pricePence",
  "counted",
  "approved",
  "amendmentsApproved",
  "countedNotApproved",
  "extra",
  "extraChargePence",
  "draftingCalls",
  "failedCalls",
  "readingCalls",
  "formsRead",
  "questionSets",
  "reportsStarted",
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "costMicroUsd",
  "costPence",
  "marginPence",
] as const;

export async function platformUsage(db: Kysely<Database>, period: string, rate: number, now = new Date()): Promise<PlatformUsage> {
  const currentPeriod = ukPeriodOf(now);
  const ctx = { db };
  let available = true;
  let months: UsageMonth[] = [];
  let pending = new Map<string, number>();
  try {
    [months, pending] = await Promise.all([listUsageForPeriod(ctx, period), countCountedNotApprovedByTenant(ctx, period)]);
  } catch (err) {
    if (!isMissingUsageTable(err)) throw err;
    noteMissingUsageTables();
    available = false;
  }
  const [clinics, packages, plans] = await Promise.all([listClinics(db, now), readClinicPackages(ctx), readClinicPlans(ctx)]);
  const demo = new Set(plans.filter((p) => p.demoClinic).map((p) => p.tenantId));
  const monthOf = new Map(months.map((m) => [m.tenantId, m] as const));
  const pkgOf = new Map(packages.map((p) => [p.tenantId, p] as const));
  const rows: PlatformUsageRow[] = [];
  for (const c of clinics) {
    const m = monthOf.get(c.tenantId) ?? null;
    if (c.offboardedAt && !m) continue; // a closed clinic is listed only for a month it had usage
    const t = termsForMonth(m, pkgOf.get(c.tenantId) ?? null, period, currentPeriod);
    const u = m ?? emptyUsageMonth(c.tenantId, period);
    const extra = extraReports(u.billableReports, t.reportsIncluded);
    const extraChargePence = extra * (t.extraReportPence ?? 0);
    const pricePence = t.pricePence ?? 0;
    const costPence = microUsdToPence(u.costMicroUsd, rate);
    rows.push({
      tenantId: c.tenantId,
      name: c.name,
      closed: Boolean(c.offboardedAt),
      demoClinic: demo.has(c.tenantId),
      package: t.package,
      packageLabel: packageLabel(t.package),
      pricePence,
      reportsIncluded: t.reportsIncluded,
      counted: u.billableReports,
      approved: u.reportsApproved,
      amendmentsApproved: u.amendmentsApproved,
      countedNotApproved: pending.get(c.tenantId) ?? 0,
      extra,
      extraReportPence: t.extraReportPence,
      extraChargePence,
      draftingCalls: u.draftingCalls,
      failedCalls: u.failedCalls,
      readingCalls: u.readingCalls,
      formsRead: u.formsRead,
      questionSets: u.questionSets,
      reportsStarted: u.reportsStarted,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cacheReadTokens: u.cacheReadTokens,
      cacheWriteTokens: u.cacheWriteTokens,
      costMicroUsd: u.costMicroUsd,
      costPence,
      marginPence: pricePence + extraChargePence - costPence,
    });
  }
  // Usage of a clinic id that is no longer listed (a released id): shown so nothing is hidden.
  for (const m of months) {
    if (clinics.some((c) => c.tenantId === m.tenantId)) continue;
    const t = termsForMonth(m, null, period, currentPeriod);
    const extra = extraReports(m.billableReports, t.reportsIncluded);
    const costPence = microUsdToPence(m.costMicroUsd, rate);
    rows.push({
      tenantId: m.tenantId,
      name: "(no longer listed)",
      closed: true,
      demoClinic: false,
      package: t.package,
      packageLabel: packageLabel(t.package),
      pricePence: t.pricePence ?? 0,
      reportsIncluded: t.reportsIncluded,
      counted: m.billableReports,
      approved: m.reportsApproved,
      amendmentsApproved: m.amendmentsApproved,
      countedNotApproved: pending.get(m.tenantId) ?? 0,
      extra,
      extraReportPence: t.extraReportPence,
      extraChargePence: extra * (t.extraReportPence ?? 0),
      draftingCalls: m.draftingCalls,
      failedCalls: m.failedCalls,
      readingCalls: m.readingCalls,
      formsRead: m.formsRead,
      questionSets: m.questionSets,
      reportsStarted: m.reportsStarted,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      cacheReadTokens: m.cacheReadTokens,
      cacheWriteTokens: m.cacheWriteTokens,
      costMicroUsd: m.costMicroUsd,
      costPence,
      marginPence: (t.pricePence ?? 0) + extra * (t.extraReportPence ?? 0) - costPence,
    });
  }
  const PAID = new Set<(typeof SUMMED)[number]>(["pricePence", "extra", "extraChargePence"]);
  // Nobody pays for a demo clinic or during a trial: their package price and extra reports stay out of the money totals.
  const unpaid = (r: PlatformUsageRow) => r.demoClinic || r.package === "trial";
  const totals = Object.fromEntries(SUMMED.map((k) => [k, rows.reduce((n, r) => (PAID.has(k) && unpaid(r) ? n : n + r[k]), 0)])) as PlatformUsage["totals"];
  totals.marginPence = totals.pricePence + totals.extraChargePence - totals.costPence;
  const demoRows = rows.filter((r) => r.demoClinic);
  return {
    period,
    periodLabel: periodLabel(period),
    rate,
    rows,
    totals,
    demo: {
      rows: demoRows.length,
      costPence: demoRows.reduce((n, r) => n + r.costPence, 0),
      costMicroUsd: demoRows.reduce((n, r) => n + r.costMicroUsd, 0),
    },
    available,
  };
}

/**
 * Live drafting calls (successful and failed) per counted report, or null when nothing counted. A clinic far above
 * HIGH_CALLS_PER_REPORT drafts a lot without new reports counting (many re-drafts, amendments – or report ids being
 * reused): worth a look. Built-in reports draft 2 sections a call and forms up to 4 questions a call.
 */
export function callsPerCountedReport(r: Pick<PlatformUsageRow, "draftingCalls" | "failedCalls" | "counted">): number | null {
  return r.counted > 0 ? (r.draftingCalls + r.failedCalls) / r.counted : null;
}

export const HIGH_CALLS_PER_REPORT = 40;

export const PLATFORM_USAGE_CSV_COLUMNS = [
  "period",
  "clinic_id",
  "clinic_name",
  "package",
  "price_gbp",
  "reports_included",
  "reports_counted",
  "approved",
  "amendments_approved",
  "counted_not_approved",
  "extra_reports",
  "extra_price_gbp",
  "extra_charge_gbp",
  "reports_started",
  "forms_read",
  "question_sets",
  "drafting_calls",
  "failed_calls",
  "reading_calls",
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "est_cost_usd",
  "est_cost_gbp",
  "est_margin_gbp",
  "usd_gbp_rate",
  "demo_clinic",
] as const;

const gbp = (pence: number | null) => (pence === null ? "" : (pence / 100).toFixed(2));
const usd = (micro: number) => (micro / 1_000_000).toFixed(4);
/** A number cell: digits only (with an optional minus and decimals) – never text, so never a formula. */
function numCell(value: string): string {
  if (value === "") return "";
  if (!/^-?\d+(\.\d+)?$/.test(value)) throw new Error("usage CSV: not a number");
  return value;
}

/** The month as CSV: text cells through csvCell (quoted when needed, never read as a formula), number cells digits only. */
export function platformUsageCsv(usage: PlatformUsage): string {
  const lines = [PLATFORM_USAGE_CSV_COLUMNS.join(",")];
  for (const r of usage.rows) {
    lines.push(
      [
        csvCell(usage.period),
        csvCell(r.tenantId),
        csvCell(r.name),
        csvCell(r.packageLabel),
        ...[
          gbp(r.pricePence),
          r.reportsIncluded === null ? "" : String(r.reportsIncluded),
          String(r.counted),
          String(r.approved),
          String(r.amendmentsApproved),
          String(r.countedNotApproved),
          String(r.extra),
          gbp(r.extraReportPence),
          gbp(r.extraChargePence),
          String(r.reportsStarted),
          String(r.formsRead),
          String(r.questionSets),
          String(r.draftingCalls),
          String(r.failedCalls),
          String(r.readingCalls),
          String(r.inputTokens),
          String(r.outputTokens),
          String(r.cacheReadTokens),
          String(r.cacheWriteTokens),
          usd(r.costMicroUsd),
          gbp(r.costPence),
          gbp(r.marginPence),
          String(usage.rate),
          r.demoClinic ? "1" : "0",
        ].map(numCell),
      ].join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function platformUsageCsvFileName(period: string): string {
  return `clinforms-usage-${period}.csv`;
}
