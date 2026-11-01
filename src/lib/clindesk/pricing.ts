/**
 * ClinDesk website – the prices it shows, in words (01/11/2026). No number is typed here: every amount comes from the
 * same tables checkout uses and checks the payment account against before every payment –
 *   - plans and the Reports add-on: src/lib/billing/plans.ts (CLINDESK_BANDS, REPORTS_ADDONS, YEARLY_MONTHS,
 *     EXTRA_REPORT_PENCE);
 *   - text message packs: src/modules/pms/comms/credits.ts (SMS_PACKS).
 * Change a price there (and at the payment account) and the website follows on the next build.
 *
 * Browser-safe and pure; the pages are server components.
 */
import {
  CLINDESK_BANDS,
  EXTRA_REPORT_PENCE,
  REPORTS_ADDONS,
  YEARLY_MONTHS,
  bandPence,
  addonPence,
  pounds,
  type BillingInterval,
} from "@/lib/billing/plans";
import { SMS_PACKS, pencePerCredit } from "@/modules/pms/comms/credits";

const n = (v: number) => v.toLocaleString("en-GB");

/** Months a yearly plan saves ("2 months free"). */
export const FREE_MONTHS = 12 - YEARLY_MONTHS;
export const FREE_MONTHS_TEXT = `${FREE_MONTHS} months free`;

/** One plan card: the band's name, who it is for and its price on each billing interval. */
export interface PlanCard {
  key: string;
  name: string;
  practitioners: string;
  price: Record<BillingInterval, string>;
}

export const PLAN_CARDS: readonly PlanCard[] = CLINDESK_BANDS.map((b) => ({
  key: b.key,
  name: b.label,
  practitioners: b.min === b.max ? `${n(b.min)} practitioner` : `${n(b.min)}–${n(b.max)} practitioners`,
  price: { month: pounds(bandPence(b, "month")), year: pounds(bandPence(b, "year")) },
}));

/** The most practitioners a listed plan covers (above it: "Talk to us"). */
export const LARGEST_BAND_MAX = Math.max(...CLINDESK_BANDS.map((b) => b.max));

const cheapestBand = CLINDESK_BANDS.reduce((a, b) => (b.monthlyPence < a.monthlyPence ? b : a));

/** "£39 a month" – the lowest price (closing call to action on every page: "From … · Reports is an add-on"). */
export const FROM_PRICE = `${pounds(cheapestBand.monthlyPence)} a month`;

/** One Reports add-on tier. */
export interface ReportsTier {
  key: string;
  reports: string;
  price: Record<BillingInterval, string>;
}

export const REPORTS_TIERS: readonly ReportsTier[] = REPORTS_ADDONS.map((a) => ({
  key: a.key,
  reports: n(a.reports),
  price: { month: pounds(addonPence(a, "month")), year: pounds(addonPence(a, "year")) },
}));

const smallestAddon = REPORTS_ADDONS.reduce((a, b) => (b.monthlyPence < a.monthlyPence ? b : a));

/** "From £79 a month for up to 25 reports" – the Reports add-on in one line (Home, Features, Reports, Pricing). */
export const REPORTS_FROM = `From ${pounds(smallestAddon.monthlyPence)} a month for up to ${n(smallestAddon.reports)} reports`;

/** "£1.50" – each report above the allowance. */
export const EXTRA_REPORT_PRICE = pounds(EXTRA_REPORT_PENCE);

/** "25, 100, 250 or 500" – the allowances on offer. */
export const REPORTS_ALLOWANCES = (() => {
  const all = REPORTS_ADDONS.map((a) => n(a.reports));
  return all.length > 1 ? `${all.slice(0, -1).join(", ")} or ${all[all.length - 1]}` : all.join("");
})();

/** One text message pack: "1,000 texts", "£75", "7.5p a text". */
export interface TextPack {
  key: string;
  credits: string;
  price: string;
  perText: string;
}

export const TEXT_PACKS: readonly TextPack[] = SMS_PACKS.map((p) => ({
  key: p.key,
  credits: n(p.credits),
  price: pounds(p.pricePence),
  perText: `${pencePerCredit(p).toLocaleString("en-GB", { maximumFractionDigits: 1 })}p a text`,
}));
