/**
 * Courses (PK02, docs/clinic-system/courses-giftcards-products.md): a block of sessions a patient pays for up front.
 * Pure, browser-safe: types, zod inputs, the plain-English labels and the rules the screens and the server share.
 *
 * - A course TYPE (Set-up → Courses) names the services it covers, how many sessions, the price and how long it is
 *   valid from the sale (optional).
 * - Selling one = a draft invoice with an ordinary `item` line; the course starts when that invoice is ISSUED
 *   (sold = issued). Unpaid courses can still be used – the balance shows as owed.
 * - A visit the course covers is "used from the course" instead of becoming an invoice line (no £0 invoices).
 * - Cancelling closes the course and credits the unused sessions (pro rata by default) on the sale line.
 */
import { z } from "zod";
import { formatUkDate } from "../core/text";
import { PmsIdSchema, optionalText } from "../core/schemas";
import { roundHalfAway, type VatCode } from "./vat";

export const COURSE_STATUSES = ["active", "used_up", "expired", "cancelled"] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

/** VAT codes a course can carry (the clinic's own VAT rules; "none" is applied when the clinic is not registered). */
export const COURSE_VAT_CODES = ["exempt", "standard", "reduced", "zero"] as const;
export type CourseVatCode = (typeof COURSE_VAT_CODES)[number];

export const MAX_COURSE_SESSIONS = 100;
export const MAX_COURSE_VALID_DAYS = 3650;

export interface CourseType {
  id: string;
  rev: number;
  name: string;
  serviceIds: string[];
  sessions: number;
  pricePence: number;
  vatCode: CourseVatCode;
  /** null = no expiry. */
  validDays: number | null;
  active: boolean;
  updatedAt: string;
}

export interface PatientCourse {
  id: string;
  rev: number;
  patientId: string;
  courseTypeId: string;
  /** The course type's name (plain, not clinical). */
  name: string;
  /** The services the course covers (from its type). */
  serviceIds: string[];
  caseId: string | null;
  saleInvoiceId: string;
  saleLineId: string;
  sessionsTotal: number;
  /** Uses not reversed. */
  sessionsUsed: number;
  soldOn: string;
  expiresOn: string | null;
  status: CourseStatus;
  cancelledAt: string | null;
  cancelCreditNoteId: string | null;
}

export interface CourseUse {
  id: string;
  patientCourseId: string;
  appointmentId: string;
  usedOn: string;
  reversedAt: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------------------------------------
 * Inputs
 * ----------------------------------------------------------------------------------------------*/

export const CourseTypeInputSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(120, "At most 120 characters"),
  serviceIds: z.array(PmsIdSchema).min(1, "Choose at least one service the course covers").max(50, "At most 50 services"),
  sessions: z.number({ error: "Enter the number of sessions" }).int("Whole sessions only").min(1, "At least 1 session").max(MAX_COURSE_SESSIONS, `At most ${MAX_COURSE_SESSIONS} sessions`),
  pricePence: z.number({ error: "Enter the price" }).int("Whole pence only").min(0, "A price cannot be negative").max(100_000_000),
  vatCode: z.enum(COURSE_VAT_CODES).optional(),
  validDays: z.union([z.number().int("Whole days only").min(1, "At least 1 day").max(MAX_COURSE_VALID_DAYS, "At most 10 years"), z.null()]).optional(),
  active: z.boolean().optional(),
});
export type CourseTypeInput = z.input<typeof CourseTypeInputSchema>;

export const CancelCourseInputSchema = z.object({
  /** What is credited on the sale line (whole pence, VAT included); default: the unused sessions pro rata. */
  creditPence: z.number().int("Whole pence only").min(0).max(100_000_000).optional(),
  reason: z.string().trim().min(3, "Say why the course is cancelled").max(300),
});
export type CancelCourseInput = z.input<typeof CancelCourseInputSchema>;

export const CourseExpiryInputSchema = z.object({ expiresOn: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date"), z.null()]), reason: optionalText(300) });

/* ------------------------------------------------------------------------------------------------
 * Rules
 * ----------------------------------------------------------------------------------------------*/

/** "YYYY-MM-DD" plus whole days. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The expiry of a course sold on `soldOn` (null = no expiry). Valid for N days: the last day is sold + N − 1. */
export function courseExpiry(soldOn: string, validDays: number | null): string | null {
  return validDays === null ? null : addDays(soldOn, validDays - 1);
}

export function sessionsLeft(c: Pick<PatientCourse, "sessionsTotal" | "sessionsUsed">): number {
  return Math.max(0, c.sessionsTotal - c.sessionsUsed);
}

/** The state shown on screen: the stored status, with an active course past its expiry shown as expired. */
export function courseState(c: Pick<PatientCourse, "status" | "expiresOn" | "sessionsTotal" | "sessionsUsed">, today: string): CourseStatus {
  if (c.status === "cancelled") return "cancelled";
  if (c.status === "used_up" || sessionsLeft(c) === 0) return "used_up";
  if (c.status === "expired" || (c.expiresOn !== null && c.expiresOn < today)) return "expired";
  return "active";
}

export const COURSE_STATE_LABELS: Readonly<Record<CourseStatus, string>> = {
  active: "Active",
  used_up: "Used up",
  expired: "Expired",
  cancelled: "Cancelled",
};

/** "3 of 6 used · expires 12/03/2027" (or "· no expiry"). */
export function courseProgressLabel(c: Pick<PatientCourse, "sessionsTotal" | "sessionsUsed" | "expiresOn">): string {
  return `${c.sessionsUsed} of ${c.sessionsTotal} used · ${c.expiresOn ? `expires ${formatUkDate(c.expiresOn)}` : "no expiry"}`;
}

/** "Use course (3 of 6 left)" – the visit suggestion's tick box. */
export function courseOfferLabel(left: number, total: number): string {
  return `Use course (${left} of ${total} left)`;
}

/** "6 sessions · Follow-up, Sports massage · valid 180 days" – a course type in Set-up and the sell form. */
export function courseTypeSummary(t: Pick<CourseType, "sessions" | "validDays">, serviceNames: string[]): string {
  const covers = serviceNames.length ? serviceNames.join(", ") : "no services";
  return `${t.sessions} session${t.sessions === 1 ? "" : "s"} · ${covers} · ${t.validDays === null ? "no expiry" : `valid ${t.validDays} day${t.validDays === 1 ? "" : "s"}`}`;
}

/**
 * What cancelling credits by default: what is left on the sale line (its total less what was already credited, e.g.
 * a discount given after the sale) × unused ÷ total sessions – so the patient gets back the unused share of what
 * they were actually charged – never more than is left to credit (whole pence, halves away from zero).
 */
export function proRataCredit(line: { totalPence: number; creditedPence: number }, sessionsTotal: number, sessionsUsed: number): number {
  const unused = Math.max(0, sessionsTotal - sessionsUsed);
  const creditable = Math.max(0, line.totalPence - line.creditedPence);
  if (sessionsTotal <= 0 || unused === 0 || creditable === 0) return 0;
  const share = roundHalfAway((creditable * Math.min(unused, sessionsTotal)) / sessionsTotal);
  return Math.max(0, Math.min(share, creditable));
}

/** Whether a course covers a visit: active, not cancelled, a session left, the service covered, the case agrees, in date. */
export function courseCovers(c: Pick<PatientCourse, "status" | "serviceIds" | "caseId" | "expiresOn" | "sessionsTotal" | "sessionsUsed" | "patientId">, visit: { patientId: string; serviceId: string; caseId: string | null; date: string }): boolean {
  if (c.status !== "active") return false;
  if (c.patientId !== visit.patientId) return false;
  if (sessionsLeft(c) <= 0) return false;
  if (!c.serviceIds.includes(visit.serviceId)) return false;
  if (c.caseId !== null && c.caseId !== visit.caseId) return false;
  if (c.expiresOn !== null && visit.date > c.expiresOn) return false;
  return true;
}

export interface CourseOffer {
  patientCourseId: string;
  /** Sessions left BEFORE this visit uses one. */
  left: number;
  total: number;
  label: string;
}

/**
 * Which course each visit can use, visits in date order: the course that runs out first (earliest expiry, then
 * the oldest sale), counting down as visits take sessions – so the offers never add up to more than is left.
 * Only completed visits the patient pays for themselves are offered (insured visits bill their payer).
 */
export function offerCourses(
  visits: readonly { appointmentId: string; patientId: string; serviceId: string; caseId: string | null; date: string; startTime?: string | null; eligible: boolean }[],
  courses: readonly PatientCourse[],
): Map<string, CourseOffer> {
  const left = new Map(courses.map((c) => [c.id, sessionsLeft(c)]));
  const order = courses.slice().sort((a, b) => (a.expiresOn ?? "9999-12-31").localeCompare(b.expiresOn ?? "9999-12-31") || a.soldOn.localeCompare(b.soldOn) || a.id.localeCompare(b.id));
  const out = new Map<string, CourseOffer>();
  const sorted = visits.slice().sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? "").localeCompare(b.startTime ?? "") || a.appointmentId.localeCompare(b.appointmentId));
  for (const v of sorted) {
    if (!v.eligible) continue;
    const c = order.find((x) => courseCovers({ ...x, sessionsUsed: x.sessionsTotal - (left.get(x.id) ?? 0) }, v));
    if (!c) continue;
    const n = left.get(c.id) ?? 0;
    out.set(v.appointmentId, { patientCourseId: c.id, left: n, total: c.sessionsTotal, label: courseOfferLabel(n, c.sessionsTotal) });
    left.set(c.id, n - 1);
  }
  return out;
}

/** The invoice line that sells a course (an ordinary item line; VAT as the course type says). */
export function courseSaleLine(t: Pick<CourseType, "name" | "pricePence" | "vatCode">): { kind: "item"; description: string; quantity: 1; unitPricePence: number; vatCode: VatCode } {
  return { kind: "item", description: `Course: ${t.name}`.slice(0, 200), quantity: 1, unitPricePence: t.pricePence, vatCode: t.vatCode };
}

/** Parses service_ids_json (bad JSON → no services). */
export function parseServiceIds(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------------------------------------
 * What the screens receive (src/server/pms/billing/courses.ts)
 * ----------------------------------------------------------------------------------------------*/

export interface CourseTypeView extends CourseType {
  /** "6 sessions · Follow-up, Sports massage · valid 180 days" */
  summary: string;
}

export interface CourseTypesScreen {
  types: CourseTypeView[];
  services: { id: string; name: string; active: boolean }[];
  vatRegistered: boolean;
  canEdit: boolean;
}

export interface PatientCourseView {
  id: string;
  rev: number;
  name: string;
  state: CourseStatus;
  stateLabel: string;
  /** "3 of 6 used · expires 12/03/2027" */
  progress: string;
  sessionsUsed: number;
  sessionsTotal: number;
  soldOn: string;
  expiresOn: string | null;
  caseTitle: string | null;
  saleInvoiceId: string;
  saleInvoiceNumber: string | null;
  uses: { id: string; usedOn: string; reversed: boolean }[];
  /**
   * The sale was voided or its line credited in full: the visits used from it are no longer paid for, so each can be
   * reversed and invoiced on its own (Reverse to invoice).
   */
  saleCreditedInFull: boolean;
  /** What cancelling credits by default and at most (pence); null once cancelled. */
  cancelQuote: { defaultPence: number; maxPence: number } | null;
}

export interface PatientCoursesView {
  courses: PatientCourseView[];
  /** Draft invoices that sell a course (it starts when the invoice is issued). */
  pending: { invoiceId: string; name: string; totalPence: number }[];
  /** Course types on sale (Sell a course). */
  types: { id: string; name: string; pricePence: number; summary: string }[];
  cases: { id: string; title: string; siteId: string | null }[];
  /** The sites the member may put the invoice at (empty = the clinic-wide default). */
  sites: { id: string; name: string }[];
  /** A site must be chosen (the member works at some sites only). */
  siteRequired: boolean;
  canSell: boolean;
  canCancel: boolean;
  canExtend: boolean;
  today: string;
}
