/**
 * Subscription plans of ClinDesk and ClinForms (31/10/2026) – browser-safe and pure. One payment account for both
 * products (CLAUDE.md, the deliberate exception): ClinForms is sold as a Reports add-on on the ClinDesk subscription,
 * or on its own. Prices in GBP – no VAT is charged (AppstackX is not VAT registered, 01/11/2026); the payment account's prices are found by their LOOKUP KEYS and must match these
 * amounts (checked before every checkout – src/server/billing/payments.ts).
 *
 *   ClinDesk, by practitioner band (monthly; yearly = 10 × the monthly price, "two months free"):
 *     Solo 1 £39 · Small 2–5 £89 · Practice 6–10 £169 · Group 11–25 £299 · Multi-site 26–60 £499
 *       lookup keys clindesk_<band>_monthly / clindesk_<band>_yearly
 *   Reports add-on, billed with the plan's own interval (the payment page cannot mix intervals in one subscription;
 *   Khuram 01/11/2026: yearly add-on prices = 10 × monthly):
 *     25 £79 · 100 £159 · 250 £279 · 500 £439 a month       clindesk_reports_<n>_monthly
 *     25 £790 · 100 £1,590 · 250 £2,790 · 500 £4,390 a year  clindesk_reports_<n>_yearly   (the allowance stays a MONTH's)
 *   ClinForms on its own (monthly):
 *     Starter 25 £99 · Practice 100 £199 · Group 250 £349 · Group Plus 500 £549   clinforms_<tier>_monthly
 *   Extra report above the allowance £1.50 (extra_report, one-off – added to the next invoice).
 *
 * The practitioner band is a guide, never a block: more active practitioners than the band shows a warning with an
 * upgrade prompt; clinical work is never stopped by it.
 */

import { CLINFORMS_NAME, CLINIC_SYSTEM_NAME } from "../brand";

export type BillingInterval = "month" | "year";

export const CLINDESK_BANDS = [
  { key: "solo", label: "Solo", min: 1, max: 1, monthlyPence: 3_900 },
  { key: "small", label: "Small", min: 2, max: 5, monthlyPence: 8_900 },
  { key: "practice", label: "Practice", min: 6, max: 10, monthlyPence: 16_900 },
  { key: "group", label: "Group", min: 11, max: 25, monthlyPence: 29_900 },
  { key: "multisite", label: "Multi-site", min: 26, max: 60, monthlyPence: 49_900 },
] as const;
export type ClinDeskBandKey = (typeof CLINDESK_BANDS)[number]["key"];
export type ClinDeskBand = (typeof CLINDESK_BANDS)[number];

export const YEARLY_MONTHS = 10;

export const REPORTS_ADDONS = [
  { key: "25", reports: 25, monthlyPence: 7_900 },
  { key: "100", reports: 100, monthlyPence: 15_900 },
  { key: "250", reports: 250, monthlyPence: 27_900 },
  { key: "500", reports: 500, monthlyPence: 43_900 },
] as const;
export type ReportsAddonKey = (typeof REPORTS_ADDONS)[number]["key"];

export const CLINFORMS_TIERS = [
  { key: "starter", label: "Starter", reports: 25, monthlyPence: 9_900 },
  { key: "practice", label: "Practice", reports: 100, monthlyPence: 19_900 },
  { key: "group", label: "Group", reports: 250, monthlyPence: 34_900 },
  { key: "group_plus", label: "Group Plus", reports: 500, monthlyPence: 54_900 },
] as const;
export type ClinFormsTierKey = (typeof CLINFORMS_TIERS)[number]["key"];

export const EXTRA_REPORT_KEY = "extra_report";
export const EXTRA_REPORT_PENCE = 150;

export type PlanChoice =
  | { product: "clindesk"; band: ClinDeskBandKey; interval: BillingInterval; reports: ReportsAddonKey | null }
  | { product: "clinforms"; tier: ClinFormsTierKey };

export const clinDeskBand = (key: unknown): ClinDeskBand | null => CLINDESK_BANDS.find((b) => b.key === key) ?? null;
export const reportsAddon = (key: unknown) => REPORTS_ADDONS.find((a) => a.key === key) ?? null;
export const clinFormsTier = (key: unknown) => CLINFORMS_TIERS.find((t) => t.key === key) ?? null;

export function addonPence(addon: { monthlyPence: number }, interval: BillingInterval): number {
  return interval === "year" ? addon.monthlyPence * YEARLY_MONTHS : addon.monthlyPence;
}

export function bandPence(band: ClinDeskBand, interval: BillingInterval): number {
  return interval === "year" ? band.monthlyPence * YEARLY_MONTHS : band.monthlyPence;
}

/** One line of a subscription: the price's lookup key, its amount per interval and what it grants. */
export interface PlanItem {
  lookupKey: string;
  pence: number;
  interval: BillingInterval;
  kind: "clindesk_plan" | "reports_addon" | "clinforms_standalone";
  reportsIncluded: number | null;
}

/** Why a choice cannot be bought, or null. */
export function choiceProblem(choice: PlanChoice): string | null {
  if (choice.product === "clindesk") {
    if (!clinDeskBand(choice.band)) return "Choose a plan.";
    if (choice.interval !== "month" && choice.interval !== "year") return "Choose monthly or yearly billing.";
    if (choice.reports !== null && !reportsAddon(choice.reports)) return "Choose a Reports add-on, or none.";
    return null;
  }
  return clinFormsTier(choice.tier) ? null : "Choose a plan.";
}

/** The subscription's items for a choice (the first is the main plan). Throws on an invalid choice. */
export function choiceItems(choice: PlanChoice): PlanItem[] {
  const problem = choiceProblem(choice);
  if (problem) throw new Error(problem);
  if (choice.product === "clinforms") {
    const t = clinFormsTier(choice.tier)!;
    return [{ lookupKey: `clinforms_${t.key}_monthly`, pence: t.monthlyPence, interval: "month", kind: "clinforms_standalone", reportsIncluded: t.reports }];
  }
  const band = clinDeskBand(choice.band)!;
  const items: PlanItem[] = [
    { lookupKey: `clindesk_${band.key}_${choice.interval === "year" ? "yearly" : "monthly"}`, pence: bandPence(band, choice.interval), interval: choice.interval, kind: "clindesk_plan", reportsIncluded: null },
  ];
  const addon = choice.reports ? reportsAddon(choice.reports) : null;
  // The add-on follows the plan's interval (one subscription cannot mix them).
  if (addon) items.push({ lookupKey: `clindesk_reports_${addon.key}_${choice.interval === "year" ? "yearly" : "monthly"}`, pence: addonPence(addon, choice.interval), interval: choice.interval, kind: "reports_addon", reportsIncluded: addon.reports });
  return items;
}

/** Every recurring lookup key of the catalogue with what it is (the subscription's items are read back by these). */
export function catalogueItem(lookupKey: string | null | undefined): PlanItem | null {
  const k = String(lookupKey ?? "");
  let m = /^clindesk_([a-z]+)_(monthly|yearly)$/.exec(k);
  if (m && m[1] !== "reports") {
    const band = clinDeskBand(m[1]);
    if (!band) return null;
    const interval: BillingInterval = m[2] === "yearly" ? "year" : "month";
    return { lookupKey: k, pence: bandPence(band, interval), interval, kind: "clindesk_plan", reportsIncluded: null };
  }
  m = /^clindesk_reports_(\d+)_(monthly|yearly)$/.exec(k);
  if (m) {
    const a = reportsAddon(m[1]);
    const interval: BillingInterval = m[2] === "yearly" ? "year" : "month";
    return a ? { lookupKey: k, pence: addonPence(a, interval), interval, kind: "reports_addon", reportsIncluded: a.reports } : null;
  }
  m = /^clinforms_([a-z_]+)_monthly$/.exec(k);
  if (m) {
    const t = clinFormsTier(m[1]);
    return t ? { lookupKey: k, pence: t.monthlyPence, interval: "month", kind: "clinforms_standalone", reportsIncluded: t.reports } : null;
  }
  return null;
}

/** What a subscription's items amount to: the plan, or why they do not make one we sell. */
export function planOfItems(lookupKeys: readonly string[]): { ok: true; choice: PlanChoice; items: PlanItem[] } | { ok: false; why: string } {
  const items = lookupKeys.map((k) => catalogueItem(k));
  if (items.length === 0 || items.some((i) => !i)) return { ok: false, why: "unknown_price" };
  const plans = (items as PlanItem[]).filter((i) => i.kind === "clindesk_plan");
  const addons = (items as PlanItem[]).filter((i) => i.kind === "reports_addon");
  const standalone = (items as PlanItem[]).filter((i) => i.kind === "clinforms_standalone");
  if (standalone.length === 1 && plans.length === 0 && addons.length === 0) {
    const tier = /^clinforms_([a-z_]+)_monthly$/.exec(standalone[0].lookupKey)![1] as ClinFormsTierKey;
    return { ok: true, choice: { product: "clinforms", tier }, items: standalone };
  }
  if (plans.length === 1 && standalone.length === 0 && addons.length <= 1) {
    const m = /^clindesk_([a-z]+)_(monthly|yearly)$/.exec(plans[0].lookupKey)!;
    if (addons[0] && addons[0].interval !== plans[0].interval) return { ok: false, why: "mixed_intervals" };
    const reports = addons[0] ? (/^clindesk_reports_(\d+)_(?:monthly|yearly)$/.exec(addons[0].lookupKey)![1] as ReportsAddonKey) : null;
    return { ok: true, choice: { product: "clindesk", band: m[1] as ClinDeskBandKey, interval: m[2] === "yearly" ? "year" : "month", reports }, items: [plans[0], ...addons] };
  }
  return { ok: false, why: "not_one_plan" };
}

/** "ClinDesk Practice (6–10 practitioners), monthly, with Reports 100" – plain words for screens and emails. */
export function choiceLabel(choice: PlanChoice): string {
  if (choice.product === "clinforms") return `${CLINFORMS_NAME} ${clinFormsTier(choice.tier)?.label ?? ""}`.trim();
  const band = clinDeskBand(choice.band);
  const addon = choice.reports ? reportsAddon(choice.reports) : null;
  return `${CLINIC_SYSTEM_NAME} ${band?.label ?? ""}${addon ? ` with Reports (${addon.reports} a month)` : ""}`;
}

export function bandRange(band: Pick<ClinDeskBand, "min" | "max">): string {
  return band.min === band.max ? `${band.min} practitioner` : `${band.min}–${band.max} practitioners`;
}

/** The reports a month a choice includes (null: no ClinForms in it). */
export function choiceReports(choice: PlanChoice): number | null {
  if (choice.product === "clinforms") return clinFormsTier(choice.tier)?.reports ?? null;
  return choice.reports ? (reportsAddon(choice.reports)?.reports ?? null) : null;
}

/** The ClinForms package id (src/lib/packages.ts) that matches an allowance – for the clinic's "Plan & usage" page. */
export function packageIdForReports(reports: number): "starter" | "practice" | "group" | "group_plus" | "custom" {
  return reports === 25 ? "starter" : reports === 100 ? "practice" : reports === 250 ? "group" : reports === 500 ? "group_plus" : "custom";
}

/** The band a number of active practitioners needs (the smallest that fits; null above the largest). */
export function bandFor(practitioners: number): ClinDeskBand | null {
  return CLINDESK_BANDS.find((b) => practitioners <= b.max) ?? null;
}

/** Seat check: a warning (never a block) when more practitioners are active than the plan's band allows. */
export function seatWarning(choice: PlanChoice | null, activePractitioners: number): { over: boolean; max: number; suggested: ClinDeskBand | null } | null {
  if (!choice || choice.product !== "clindesk") return null;
  const band = clinDeskBand(choice.band);
  if (!band) return null;
  return { over: activePractitioners > band.max, max: band.max, suggested: activePractitioners > band.max ? bandFor(activePractitioners) : null };
}

/* ------------------------------------------------------------------------------------------------
 * Subscription state (ours – what the clinic can do)
 * ----------------------------------------------------------------------------------------------*/

/**
 *   none            no subscription
 *   pending_payment chosen, the first payment not cleared yet (a Direct Debit takes a few working days) – nothing
 *                   switched on by it yet
 *   active          paid (or a trial at the payment service)
 *   past_due        a payment failed: everything works during the grace period (7 days), then on hold (admin settings, invites, imports, marketing and new reports paused – never clinical work)
 *   canceled        ended (access ends at the end of the paid period)
 *   expired         the first payment never went through
 */
export const SUBSCRIPTION_STATES = ["none", "pending_payment", "active", "past_due", "canceled", "expired"] as const;
export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number];

export const GRACE_DAYS = 7;

/** From the payment service's subscription status and whether its first invoice is paid. */
export function stateOf(status: string, firstPaid: boolean): Exclude<SubscriptionState, "none"> {
  switch (status) {
    case "active":
    case "trialing":
      return firstPaid ? "active" : "pending_payment";
    case "incomplete":
      return "pending_payment";
    case "past_due":
    case "unpaid":
      return firstPaid ? "past_due" : "pending_payment";
    case "canceled":
    case "paused":
      return "canceled";
    case "incomplete_expired":
      return "expired";
    default:
      return "pending_payment";
  }
}

export const STATE_LABELS: Readonly<Record<SubscriptionState, string>> = {
  none: "No plan yet",
  pending_payment: "Waiting for the first payment",
  active: "Active",
  past_due: "Payment overdue",
  canceled: "Cancelled",
  expired: "Not started",
};

/** UK date DD/MM/YYYY from an ISO timestamp (Europe/London). */
export function ukDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

/** "£169", "£1,690", "£1.50". */
export function pounds(pence: number): string {
  const whole = pence % 100 === 0;
  return `£${(pence / 100).toLocaleString("en-GB", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** The billing banner's content (made on the server – src/server/billing/banner.ts). */
export interface BillingBanner {
  tone: "error" | "warning";
  text: string;
  /** Owners and admins: where to fix it. */
  href: string | null;
}
