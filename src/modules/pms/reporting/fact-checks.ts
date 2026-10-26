/**
 * Defensive checks on the facts a source hands the reports (pure). A fact that breaks the source contract –
 * a month outside the period, an unknown outcome, a negative count, a site outside the requested sites, another
 * practitioner when one was asked for – is LEFT OUT and counted, so a faulty source can never show figures of a
 * site the viewer may not see. The report logs the count (never the rows).
 */
import { PAYER_TYPES } from "../core/schemas";
import { isIsoDate } from "../core/text";
import { APPOINTMENT_OUTCOMES, REVENUE_KINDS, type AppointmentFact, type AvailabilityFact, type DebtFact, type RevenueFact } from "./facts";

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
      monthIn(a.month, f) &&
      (APPOINTMENT_OUTCOMES as readonly string[]).includes(a.outcome) &&
      count(a.appointments) &&
      count(a.minutes) &&
      siteOk(a.siteId, f) &&
      knownOrNull(a.roomId, f.known.roomIds) &&
      practitionerOk(a.practitionerId, f),
  );
}

export function checkAvailabilityFacts(facts: readonly AvailabilityFact[] | null | undefined, f: FactFilter): Checked<AvailabilityFact> {
  return keep(facts, (a) => typeof a.practitionerId === "string" && monthIn(a.month, f) && count(a.minutes) && siteOk(a.siteId, f) && practitionerOk(a.practitionerId, f));
}

export function checkRevenueFacts(facts: readonly RevenueFact[] | null | undefined, f: FactFilter): Checked<RevenueFact> {
  return keep(
    facts,
    (r) =>
      monthIn(r.month, f) &&
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
