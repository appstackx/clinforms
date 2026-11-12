/**
 * PK06 figures (pure): course and gift-card liability, product sales and stock – what the Finance reports "Course
 * liability", "Gift card liability" and "Products and stock" show (src/server/pms/reporting/service.ts). Facts come
 * from billing's reporting source (./facts.ts); amounts are whole pence, dates UK calendar dates.
 *
 * Course liability (deferred income): for each course still open on the "as at" date, what was paid for it net of
 * credit notes × unused sessions ÷ sessions sold (whole pence, halves away from zero – the same rounding as
 * cancelling a course pro rata). Used-up, expired and cancelled courses hold nothing.
 *
 * Gift-card liability: what valid cards hold at the end of the "as at" date. A card is valid on a day up to and
 * including its expiry date. The period's movement reconciles: opening (end of the day before the period) + sold −
 * spent − credited − expired = closing. "Expired" is what cards whose last valid day fell in the period still held –
 * worked out from the dates, so the figures are the same before and after the nightly expiry sweep has run.
 */
import { roundHalfAway } from "../billing/vat";
import type { CourseFact, CourseSaleFact, GiftCardFact, ProductSaleFact, ReportProduct, StockFact } from "./facts";
import { addDays } from "./periods";

/** Courses expiring within this many days of the "as at" date are counted apart. */
export const COURSE_EXPIRY_WINDOW_DAYS = 30;

/** Valid on `day`: no expiry, or the expiry date is that day or later (the expiry day itself still counts). */
export function validOn(expiresOn: string | null, day: string): boolean {
  return expiresOn === null || expiresOn >= day;
}

/** What one course's unused sessions are worth: net × unused ÷ total (whole pence, never below 0). */
export function unusedCourseValue(netPence: number, sessionsTotal: number, sessionsUsed: number): number {
  const unused = Math.max(0, sessionsTotal - sessionsUsed);
  if (sessionsTotal <= 0 || unused === 0 || netPence <= 0) return 0;
  return Math.max(0, roundHalfAway((netPence * Math.min(unused, sessionsTotal)) / sessionsTotal));
}

export interface CourseLiabilityRow {
  key: string;
  /** Courses with a session left. */
  courses: number;
  sessionsTotal: number;
  sessionsUsed: number;
  sessionsLeft: number;
  unusedPence: number;
  /** Of those, expiring within COURSE_EXPIRY_WINDOW_DAYS of the date. */
  expiringCourses: number;
  expiringSessions: number;
  expiringPence: number;
  /** Courses sold in the period (cancelled ones included) and what they were sold for. */
  soldCourses: number;
  soldPence: number;
}

function emptyCourseRow(key: string): CourseLiabilityRow {
  return { key, courses: 0, sessionsTotal: 0, sessionsUsed: 0, sessionsLeft: 0, unusedPence: 0, expiringCourses: 0, expiringSessions: 0, expiringPence: 0, soldCourses: 0, soldPence: 0 };
}

/** Course liability by site ("" = no site) and in total, as at `asAt`. */
export function courseLiability(open: readonly CourseFact[], sold: readonly CourseSaleFact[], asAt: string): { rows: CourseLiabilityRow[]; total: CourseLiabilityRow; expiringBy: string } {
  const expiringBy = addDays(asAt, COURSE_EXPIRY_WINDOW_DAYS);
  const by = new Map<string, CourseLiabilityRow>();
  const row = (siteId: string | null) => {
    const key = siteId ?? "";
    let r = by.get(key);
    if (!r) by.set(key, (r = emptyCourseRow(key)));
    return r;
  };
  for (const f of open) {
    const left = Math.max(0, f.sessionsTotal - f.sessionsUsed);
    if (left === 0 || f.courses === 0) continue;
    const value = unusedCourseValue(f.netPence, f.sessionsTotal, f.sessionsUsed) * f.courses;
    const r = row(f.siteId);
    r.courses += f.courses;
    r.sessionsTotal += f.sessionsTotal * f.courses;
    r.sessionsUsed += f.sessionsUsed * f.courses;
    r.sessionsLeft += left * f.courses;
    r.unusedPence += value;
    if (f.expiresOn !== null && f.expiresOn <= expiringBy) {
      r.expiringCourses += f.courses;
      r.expiringSessions += left * f.courses;
      r.expiringPence += value;
    }
  }
  for (const s of sold) {
    const r = row(s.siteId);
    r.soldCourses += s.courses;
    r.soldPence += s.amountPence;
  }
  const rows = Array.from(by.values());
  const total = emptyCourseRow("all");
  for (const r of rows) {
    for (const k of Object.keys(total) as (keyof CourseLiabilityRow)[]) if (k !== "key") (total[k] as number) += r[k] as number;
  }
  return { rows, total, expiringBy };
}

export interface GiftCardLiabilityRow {
  key: string;
  /** Held by valid cards at the end of the day before the period. */
  openingPence: number;
  soldPence: number;
  /** Spent in the period, less spends put back (payments reversed). */
  spentPence: number;
  /** Taken off by credit notes on the cards' sales. */
  creditedPence: number;
  /** Left on cards whose last valid day fell in the period. */
  expiredPence: number;
  /** Held by valid cards at the end of the "as at" date. */
  closingPence: number;
  /** Cards sold in the period. */
  cardsSold: number;
}

function emptyGiftRow(key: string): GiftCardLiabilityRow {
  return { key, openingPence: 0, soldPence: 0, spentPence: 0, creditedPence: 0, expiredPence: 0, closingPence: 0, cardsSold: 0 };
}

/** Gift-card liability by site ("" = no site) and in total: the period [from, asAt]. */
export function giftCardLiability(facts: readonly GiftCardFact[], from: string, asAt: string): { rows: GiftCardLiabilityRow[]; total: GiftCardLiabilityRow } {
  const dayBefore = addDays(from, -1);
  const by = new Map<string, GiftCardLiabilityRow>();
  const row = (siteId: string | null) => {
    const key = siteId ?? "";
    let r = by.get(key);
    if (!r) by.set(key, (r = emptyGiftRow(key)));
    return r;
  };
  for (const f of facts) {
    const r = row(f.siteId);
    // Cards that had already expired before the period play no part in it (a late put-back, the sweep's move).
    if (!validOn(f.expiresOn, dayBefore)) continue;
    const stillValid = validOn(f.expiresOn, asAt);
    if (f.kind !== "expire") {
      if (stillValid) r.closingPence += f.amountPence;
      else r.expiredPence += f.amountPence;
    }
    if (f.when === "before") {
      // The sweep's own "expire" move is never part of what was held (as for closing / spent / credited).
      if (f.kind !== "expire") r.openingPence += f.amountPence;
      continue;
    }
    if (f.kind === "sale") {
      r.soldPence += f.amountPence;
      r.cardsSold += f.moves;
    } else if (f.kind === "redeem" || f.kind === "refund") r.spentPence -= f.amountPence;
    else if (f.kind === "adjust") r.creditedPence -= f.amountPence;
  }
  const rows = Array.from(by.values()).filter((r) => Object.entries(r).some(([k, v]) => k !== "key" && v !== 0));
  const total = emptyGiftRow("all");
  for (const r of rows) {
    for (const k of Object.keys(total) as (keyof GiftCardLiabilityRow)[]) if (k !== "key") (total[k] as number) += r[k] as number;
  }
  return { rows, total };
}

export interface ProductSalesRow {
  productId: string;
  siteId: string | null;
  quantitySold: number;
  quantityReturned: number;
  netPence: number;
  vatPence: number;
}

/** Product sales by product and site: sold less credited (net and VAT), units sold and given back. */
export function productSales(facts: readonly ProductSaleFact[]): { rows: ProductSalesRow[]; total: Omit<ProductSalesRow, "productId" | "siteId"> } {
  const by = new Map<string, ProductSalesRow>();
  for (const f of facts) {
    const key = `${f.productId}|${f.siteId ?? ""}`;
    let r = by.get(key);
    if (!r) by.set(key, (r = { productId: f.productId, siteId: f.siteId, quantitySold: 0, quantityReturned: 0, netPence: 0, vatPence: 0 }));
    if (f.kind === "sold") {
      r.quantitySold += f.quantity;
      r.netPence += f.netPence;
      r.vatPence += f.vatPence;
    } else {
      r.quantityReturned += f.quantity;
      r.netPence -= f.netPence;
      r.vatPence -= f.vatPence;
    }
  }
  const rows = Array.from(by.values());
  const total = rows.reduce((t, r) => ({ quantitySold: t.quantitySold + r.quantitySold, quantityReturned: t.quantityReturned + r.quantityReturned, netPence: t.netPence + r.netPence, vatPence: t.vatPence + r.vatPence }), { quantitySold: 0, quantityReturned: 0, netPence: 0, vatPence: 0 });
  return { rows, total };
}

export interface StockRow {
  productId: string;
  siteId: string;
  onHand: number;
  /** On hand × the product's sale price (nothing for a negative count). */
  valuePence: number;
  low: boolean;
}

/** At or below the product's low-stock level (no level, no warning) – the same rule as Billing → Stock. */
export function lowStock(onHand: number, lowStockAt: number | null): boolean {
  return lowStockAt !== null && onHand <= lowStockAt;
}

export function stockRows(facts: readonly StockFact[], products: readonly ReportProduct[]): { rows: StockRow[]; valuePence: number; low: number } {
  const byId = new Map(products.map((p) => [p.id, p]));
  const rows: StockRow[] = [];
  for (const f of facts) {
    const p = byId.get(f.productId);
    if (!p) continue;
    rows.push({ productId: f.productId, siteId: f.siteId, onHand: f.onHand, valuePence: Math.max(0, f.onHand) * p.pricePence, low: lowStock(f.onHand, p.lowStockAt) });
  }
  return { rows, valuePence: rows.reduce((s, r) => s + r.valuePence, 0), low: rows.filter((r) => r.low).length };
}
