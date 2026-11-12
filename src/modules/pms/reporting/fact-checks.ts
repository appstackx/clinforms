/**
 * Defensive checks on the facts a source hands the reports (pure). A fact that breaks the source contract –
 * a month outside the period, an unknown outcome, a negative count, a site outside the requested sites, another
 * practitioner when one was asked for – is LEFT OUT and counted, so a faulty source can never show figures of a
 * site the viewer may not see. The report logs the count (never the rows).
 */
import { PAYER_TYPES } from "../core/schemas";
import { isIsoDate } from "../core/text";
import {
  APPOINTMENT_OUTCOMES,
  GIFT_CARD_FACT_KINDS,
  REVENUE_KINDS,
  type AppointmentFact,
  type AvailabilityFact,
  type CourseFact,
  type CourseSaleFact,
  type DebtFact,
  type GiftCardFact,
  type ProductSaleFact,
  type RevenueFact,
  type StockFact,
  type VisitFact,
} from "./facts";

export interface FactFilter {
  from: string;
  to: string;
  /** The sites asked for (null = the whole clinic). */
  siteIds: readonly string[] | null;
  practitionerId: string | null;
  /** The clinic's own sites, rooms and practitioners: anything else is not this clinic's and is left out. */
  known: KnownIds;
}

export interface KnownIds {
  siteIds: readonly string[];
  roomIds: readonly string[];
  practitionerIds: readonly string[];
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthIn(month: string, f: Pick<FactFilter, "from" | "to">): boolean {
  return MONTH.test(month) && month >= f.from.slice(0, 7) && month <= f.to.slice(0, 7);
}

/** A fact's month (and its date, when it has one – inside the period and in that month). */
function whenIn(fact: { month: string; date?: string }, f: Pick<FactFilter, "from" | "to">): boolean {
  if (!monthIn(fact.month, f)) return false;
  if (fact.date === undefined) return true;
  return isIsoDate(fact.date) && fact.date.slice(0, 7) === fact.month && fact.date >= f.from && fact.date <= f.to;
}

/** A site the viewer asked for; without a site only when the whole clinic was asked for. */
function siteOk(siteId: string | null, f: Pick<FactFilter, "siteIds" | "known">): boolean {
  if (siteId === null) return f.siteIds === null;
  return f.known.siteIds.includes(siteId) && (f.siteIds === null || f.siteIds.includes(siteId));
}

function knownOrNull(id: string | null, known: readonly string[]): boolean {
  return id === null || known.includes(id);
}

function practitionerOk(id: string | null, f: Pick<FactFilter, "practitionerId" | "known">): boolean {
  return knownOrNull(id, f.known.practitionerIds) && (f.practitionerId === null || id === f.practitionerId);
}

function count(n: unknown): boolean {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

function money(n: unknown): boolean {
  return typeof n === "number" && Number.isInteger(n);
}

export interface Checked<T> {
  facts: T[];
  dropped: number;
}

function keep<T>(facts: readonly T[] | null | undefined, ok: (f: T) => boolean): Checked<T> {
  const out: T[] = [];
  let dropped = 0;
  for (const f of Array.isArray(facts) ? facts : []) {
    if (f && typeof f === "object" && ok(f)) out.push(f);
    else dropped += 1;
  }
  return { facts: out, dropped };
}

export function checkAppointmentFacts(facts: readonly AppointmentFact[] | null | undefined, f: FactFilter): Checked<AppointmentFact> {
  return keep(
    facts,
    (a) =>
      whenIn(a, f) &&
      (a.serviceId === undefined || a.serviceId === null || typeof a.serviceId === "string") &&
      (APPOINTMENT_OUTCOMES as readonly string[]).includes(a.outcome) &&
      count(a.appointments) &&
      count(a.minutes) &&
      siteOk(a.siteId, f) &&
      knownOrNull(a.roomId, f.known.roomIds) &&
      practitionerOk(a.practitionerId, f),
  );
}

export function checkAvailabilityFacts(facts: readonly AvailabilityFact[] | null | undefined, f: FactFilter): Checked<AvailabilityFact> {
  return keep(
    facts,
    (a) =>
      typeof a.practitionerId === "string" &&
      whenIn(a, f) &&
      count(a.minutes) &&
      (a.bookedMinutes === undefined || (count(a.bookedMinutes) && a.bookedMinutes <= a.minutes)) &&
      (a.blockedMinutes === undefined || count(a.blockedMinutes)) &&
      siteOk(a.siteId, f) &&
      practitionerOk(a.practitionerId, f),
  );
}

export function checkVisitFacts(facts: readonly VisitFact[] | null | undefined, f: FactFilter): Checked<VisitFact> {
  return keep(facts, (v) => typeof v.date === "string" && whenIn(v, f) && typeof v.firstVisit === "boolean" && count(v.appointments) && siteOk(v.siteId, f) && practitionerOk(v.practitionerId, f));
}

export function checkRevenueFacts(facts: readonly RevenueFact[] | null | undefined, f: FactFilter): Checked<RevenueFact> {
  return keep(
    facts,
    (r) =>
      whenIn(r, f) &&
      (REVENUE_KINDS as readonly string[]).includes(r.kind) &&
      (PAYER_TYPES as readonly string[]).includes(r.payerType) &&
      count(r.count) &&
      money(r.amountPence) &&
      siteOk(r.siteId, f) &&
      practitionerOk(r.practitionerId, f),
  );
}

/** Debt is "now": the period does not apply, the sites do (payer accounts are checked by the report). */
export function checkDebtFacts(facts: readonly DebtFact[] | null | undefined, f: Pick<FactFilter, "siteIds" | "known">): Checked<DebtFact> {
  return keep(facts, (d) => (PAYER_TYPES as readonly string[]).includes(d.payerType) && isIsoDate(d.dueOn) && count(d.invoices) && money(d.outstandingPence) && siteOk(d.siteId, f));
}

/* ------------------------------------------------------------------------------------------------
 * PK06 – courses, gift cards, products and stock
 * ----------------------------------------------------------------------------------------------*/

function whole(n: unknown): boolean {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

function dateOrNull(v: unknown): boolean {
  return v === null || (typeof v === "string" && isIsoDate(v));
}

/** Open courses on the "as at" date (`asAt`): none past its expiry on that date, used ≤ sold. */
export function checkCourseFacts(facts: readonly CourseFact[] | null | undefined, f: Pick<FactFilter, "siteIds" | "known"> & { asAt: string }): Checked<CourseFact> {
  return keep(
    facts,
    (c) =>
      dateOrNull(c.expiresOn) &&
      (c.expiresOn === null || c.expiresOn >= f.asAt) &&
      whole(c.sessionsTotal) &&
      c.sessionsTotal > 0 &&
      whole(c.sessionsUsed) &&
      c.sessionsUsed <= c.sessionsTotal &&
      money(c.netPence) &&
      whole(c.courses) &&
      siteOk(c.siteId, f),
  );
}

export function checkCourseSaleFacts(facts: readonly CourseSaleFact[] | null | undefined, f: Pick<FactFilter, "from" | "to" | "siteIds" | "known">): Checked<CourseSaleFact> {
  return keep(facts, (c) => typeof c.date === "string" && isIsoDate(c.date) && c.date >= f.from && c.date <= f.to && whole(c.courses) && money(c.amountPence) && siteOk(c.siteId, f));
}

export function checkGiftCardFacts(facts: readonly GiftCardFact[] | null | undefined, f: Pick<FactFilter, "siteIds" | "known">): Checked<GiftCardFact> {
  return keep(
    facts,
    (g) => (GIFT_CARD_FACT_KINDS as readonly string[]).includes(g.kind) && (g.when === "before" || g.when === "in") && dateOrNull(g.expiresOn) && whole(g.moves) && money(g.amountPence) && siteOk(g.siteId, f),
  );
}

/** Product sales in the period, of the clinic's own products. */
export function checkProductSaleFacts(facts: readonly ProductSaleFact[] | null | undefined, f: Pick<FactFilter, "from" | "to" | "siteIds" | "known"> & { productIds: readonly string[] }): Checked<ProductSaleFact> {
  return keep(
    facts,
    (p) =>
      typeof p.date === "string" &&
      isIsoDate(p.date) &&
      p.date >= f.from &&
      p.date <= f.to &&
      (p.kind === "sold" || p.kind === "credited") &&
      f.productIds.includes(p.productId) &&
      whole(p.lines) &&
      whole(p.quantity) &&
      money(p.netPence) &&
      money(p.vatPence) &&
      siteOk(p.siteId, f),
  );
}

/** Stock is "now" and always at a site; the clinic's own products only. */
export function checkStockFacts(facts: readonly StockFact[] | null | undefined, f: Pick<FactFilter, "siteIds" | "known"> & { productIds: readonly string[] }): Checked<StockFact> {
  return keep(facts, (s) => typeof s.siteId === "string" && f.productIds.includes(s.productId) && Number.isInteger(s.onHand) && siteOk(s.siteId, f));
}
