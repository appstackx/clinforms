/**
 * Courses for the screens (PK02, docs/clinic-system/courses-giftcards-products.md). Same rules as the other billing
 * services (./access.ts): the permission first, ids read back from the member's clinic and site scope, inputs
 * validated, the repositories write with their audit rows, plain results.
 *
 *   Set-up → Courses (types)             settings.setup; changes by the owner or an admin with every site
 *   patient's courses (Invoices tab)     billing.view
 *   sell a course, use / reverse a visit billing.edit
 *   cancel a course (credits the line)   billing.edit + billing.refund (a credit note is money back)
 *   move a course's expiry               billing.edit, owner or admin
 */
import "server-only";
import {
  COURSE_STATE_LABELS,
  CourseTypeInputSchema,
  courseProgressLabel,
  courseSaleLine,
  courseState,
  courseTypeSummary,
  offerCourses,
  type CourseOffer,
  type CourseVatCode,
  type CourseTypesScreen,
  type PatientCoursesView,
} from "../../../modules/pms/billing/courses";
import { formatPence, ukToday } from "../../../modules/pms/core/text";
import { isPlausibleRecordId } from "../../../modules/pms/records/form-values";
import { pmsNow } from "../../../modules/pms/core/clock";
import type { RepoContext } from "../../repos/context";
import { cancelPatientCourse, courseCancelQuote } from "../../repos/pms/billing/course-cancel";
import {
  createCourseType,
  getCourseType,
  getPatientCourse,
  listCourseTypes,
  listCourseUses,
  listPatientCourses,
  pendingCourseSales,
  recordCourseUse,
  reverseCourseUse,
  setCourseExpiry,
  updateCourseType,
} from "../../repos/pms/billing/courses";
import { RepoInputError } from "../../repos/context";
import { createDraftInvoice, getInvoice, issueInvoice } from "../../repos/pms/billing/invoices";
import { getBillingSettings } from "../../repos/pms/billing/settings";
import { listCasesForPatient } from "../../repos/pms/cases";
import { listServices, listSites } from "../../repos/pms/directory";
import { patientVisibleInScope } from "../access";
import type { SetupActor, SetupResult } from "../reporting/setup";
import { attempt, fail, forbidden, notFound, ok, patientInClinic, type BillingActor, type Result } from "./access";
import { SETUP_FORBIDDEN, SETUP_NOT_FOUND, SETUP_WHOLE, invalidFields, plausibleId, setupAttempt, setupFail, setupOk } from "./healthcode-setup";

const todayOf = (ctx: RepoContext) => ukToday(ctx.now ? ctx.now() : pmsNow());
const COURSE_NOT_FOUND = "This course no longer exists in this clinic.";

/* ------------------------------------------------------------------------------------------------
 * Set-up → Courses
 * ----------------------------------------------------------------------------------------------*/

export async function courseTypesScreenFor(actor: SetupActor): Promise<SetupResult<CourseTypesScreen>> {
  if (!actor.can("settings.setup")) return SETUP_FORBIDDEN;
  return setupAttempt("setup.course_types", async () => {
    const ctx = actor.repo();
    const [types, services, settings] = await Promise.all([listCourseTypes(ctx, actor.tenantId, { includeArchived: true }), listServices(ctx, actor.tenantId, { includeInactive: true }), getBillingSettings(ctx, actor.tenantId)]);
    const names = new Map(services.map((s) => [s.id, s.name]));
    return setupOk({
      types: types.map((t) => ({ ...t, summary: courseTypeSummary(t, t.serviceIds.map((id) => names.get(id) ?? "a removed service")) })),
      services: services.map((s) => ({ id: s.id, name: s.name, active: s.active })),
      vatRegistered: settings.vatRegistered,
      canEdit: actor.siteIds === null,
    });
  });
}

export interface CourseTypeFields {
  courseTypeId?: string | null;
  rev?: number;
  name?: string;
  serviceIds?: string[];
  sessions?: string;
  price?: string;
  vatCode?: string;
  /** "" = no expiry. */
  validDays?: string;
  active?: boolean;
}

function poundsToPence(value: unknown): number {
  const v = String(value ?? "")
    .trim()
    .replace(/^£/, "")
    .replace(/,/g, "");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(v)) return Number.NaN;
  const [pounds, pence = ""] = v.split(".");
  return Number(pounds) * 100 + Number(pence.padEnd(2, "0"));
}

const whole = (v: unknown): number => (typeof v === "string" && /^\s*\d+\s*$/.test(v) ? Number(v.trim()) : Number.NaN);

export async function saveCourseTypeFor(actor: SetupActor, f: CourseTypeFields): Promise<SetupResult<{ id: string }>> {
  if (!actor.can("settings.setup")) return SETUP_FORBIDDEN;
  if (actor.siteIds !== null) return SETUP_WHOLE;
  const input = {
    name: typeof f.name === "string" ? f.name : "",
    serviceIds: Array.isArray(f.serviceIds) ? f.serviceIds.map(String).slice(0, 60) : [],
    sessions: whole(f.sessions),
    pricePence: poundsToPence(f.price),
    vatCode: (f.vatCode === "standard" || f.vatCode === "reduced" || f.vatCode === "zero" ? f.vatCode : "exempt") as CourseVatCode,
    validDays: typeof f.validDays === "string" && f.validDays.trim() === "" ? null : whole(f.validDays),
    active: f.active !== false,
  };
  const parsed = CourseTypeInputSchema.safeParse(input);
  if (!parsed.success) return invalidFields(parsed.error);
  return setupAttempt("setup.course_type_save", async () => {
    const ctx = actor.repo();
    if (f.courseTypeId) {
      if (!plausibleId(f.courseTypeId)) return SETUP_NOT_FOUND;
      const current = await getCourseType(ctx, actor.tenantId, f.courseTypeId);
      if (!current) return SETUP_NOT_FOUND;
      const r = await updateCourseType(ctx, actor.tenantId, current.id, typeof f.rev === "number" ? f.rev : current.rev, input, actor.actor);
      if (!r.ok) return r.reason === "conflict" ? setupFail("Someone else changed this course in the meantime. Reload the page and try again.") : SETUP_NOT_FOUND;
      return setupOk({ id: current.id });
    }
    const t = await createCourseType(ctx, actor.tenantId, input, actor.actor);
    return setupOk({ id: t.id });
  });
}

/* ------------------------------------------------------------------------------------------------
 * A patient's courses (the patient record → Invoices tab)
 * ----------------------------------------------------------------------------------------------*/

function canExtend(actor: BillingActor): boolean {
  return actor.role === "owner" || actor.role === "admin";
}

export async function patientCoursesFor(actor: BillingActor, patientId: string): Promise<Result<PatientCoursesView>> {
  if (!actor.can("billing.view")) return forbidden();
  return attempt("billing.patient_courses", async () => {
    const patient = await patientInClinic(actor, patientId);
    if (!patient) return notFound();
    const ctx = actor.repo();
    const t = actor.tenantId;
    const today = todayOf(ctx);
    const [courses, pending, types, cases, sites] = await Promise.all([
      listPatientCourses(ctx, t, [patient.id]),
      pendingCourseSales(ctx, t, patient.id),
      listCourseTypes(ctx, t, { includeArchived: true }),
      listCasesForPatient(ctx, t, patient.id),
      listSites(ctx, t),
    ]);
    const uses = await listCourseUses(
      ctx,
      t,
      courses.map((c) => c.id),
    );
    const typeNames = new Map(types.map((x) => [x.id, x.name]));
    const caseTitles = new Map(cases.map((c) => [c.id, c.title]));
    const services = await listServices(ctx, t, { includeInactive: true });
    const serviceNames = new Map(services.map((s) => [s.id, s.name]));
    const scope = actor.siteIds ?? null;
    const out: PatientCoursesView["courses"] = [];
    for (const c of courses) {
      const inv = await getInvoice(ctx, t, c.saleInvoiceId);
      const state = courseState(c, today);
      out.push({
        id: c.id,
        rev: c.rev,
        name: c.name,
        state,
        stateLabel: COURSE_STATE_LABELS[state],
        progress: courseProgressLabel(c),
        sessionsUsed: c.sessionsUsed,
        sessionsTotal: c.sessionsTotal,
        soldOn: c.soldOn,
        expiresOn: c.expiresOn,
        caseTitle: c.caseId ? (caseTitles.get(c.caseId) ?? null) : null,
        saleInvoiceId: c.saleInvoiceId,
        saleInvoiceNumber: inv?.number ?? null,
        uses: uses.filter((u) => u.patientCourseId === c.id).map((u) => ({ id: u.id, usedOn: u.usedOn, reversed: u.reversedAt !== null })),
        cancelQuote: c.status === "cancelled" ? null : await courseCancelQuote(ctx, t, c.id),
      });
    }
    return ok({
      courses: out,
      pending: pending.map((p) => ({ invoiceId: p.invoiceId, name: typeNames.get(p.courseTypeId) ?? "Course", totalPence: p.totalPence })),
      types: types.filter((x) => x.active).map((x) => ({ id: x.id, name: x.name, pricePence: x.pricePence, summary: `${formatPence(x.pricePence)} · ${courseTypeSummary(x, x.serviceIds.map((s) => serviceNames.get(s) ?? "a removed service"))}` })),
      cases: cases.filter((c) => c.status === "open").map((c) => ({ id: c.id, title: c.title, siteId: c.siteId })),
      sites: sites.filter((s) => scope === null || scope.has(s.id)).map((s) => ({ id: s.id, name: s.name })),
      siteRequired: scope !== null,
      canSell: actor.can("billing.edit"),
      canCancel: actor.can("billing.edit") && actor.can("billing.refund"),
      canExtend: actor.can("billing.edit") && canExtend(actor),
      today,
    });
  });
}

export interface SellCourseFields {
  courseTypeId: string;
  caseId?: string | null;
  siteId?: string | null;
  /** Issue the invoice at once (the course starts now). */
  issue?: boolean;
}

/** Sells a course: a draft invoice to the patient with the course's line (issued too when asked – the course starts). */
export async function sellCourseFor(actor: BillingActor, patientId: string, f: SellCourseFields): Promise<Result<{ invoiceId: string; number: string | null; issued: boolean }>> {
  if (!actor.can("billing.view") || !actor.can("billing.edit")) return forbidden();
  return attempt("billing.sell_course", async (): Promise<Result<{ invoiceId: string; number: string | null; issued: boolean }>> => {
    const patient = await patientInClinic(actor, patientId);
    if (!patient) return notFound();
    const ctx = actor.repo();
    const t = actor.tenantId;
    if (!isPlausibleRecordId(f.courseTypeId)) return fail("invalid", "Choose the course to sell.");
    const type = await getCourseType(ctx, t, f.courseTypeId);
    if (!type || !type.active) return fail("invalid", "That course is not on sale. Choose another.");
    let caseId: string | null = null;
    let caseSite: string | null = null;
    if (f.caseId) {
      const cases = await listCasesForPatient(ctx, t, patient.id);
      const c = cases.find((x) => x.id === f.caseId);
      if (!c) return fail("invalid", "That case is not one of this patient's cases.");
      caseId = c.id;
      caseSite = c.siteId;
    }
    const scope = actor.siteIds ?? null;
    let siteId: string | null = f.siteId && isPlausibleRecordId(f.siteId) ? f.siteId : null;
    if (siteId === null && caseSite && (scope === null || scope.has(caseSite))) siteId = caseSite;
    if (siteId === null && scope !== null && scope.size === 1) siteId = Array.from(scope)[0];
    if (siteId !== null && scope !== null && !scope.has(siteId)) return fail("invalid", "Choose one of your sites.");
    if (siteId === null && scope !== null) return fail("invalid", "Choose the site the course is sold at.");
    const { invoice } = await createDraftInvoice(ctx, t, { patientId: patient.id, caseId, siteId, billTo: "patient", lines: [courseSaleLine(type)] }, actor.actor, {
      lineRefs: [{ lineIndex: 0, refType: "course", refId: type.id }],
    });
    if (!f.issue) return ok({ invoiceId: invoice.id, number: null, issued: false });
    const issued = await issueInvoice(ctx, t, invoice.id, invoice.rev, {}, actor.actor);
    if (!issued.ok) return fail("invalid", "The invoice could not be issued. It is kept as a draft: issue it from the invoice page.");
    return ok({ invoiceId: invoice.id, number: issued.invoice.number, issued: true });
  });
}

/** A patient's course of the request, in the member's clinic and site scope (else null). */
async function courseInScope(actor: BillingActor, courseId: unknown) {
  if (!isPlausibleRecordId(courseId)) return null;
  const c = await getPatientCourse(actor.repo(), actor.tenantId, courseId);
  if (!c) return null;
  const scope = actor.siteIds ?? null;
  if (scope !== null && !(await patientVisibleInScope(actor.repo(), actor.tenantId, c.patientId, scope))) return null;
  return c;
}

export async function reverseCourseUseFor(actor: BillingActor, courseId: string, useId: string): Promise<Result<{ reversed: boolean }>> {
  if (!actor.can("billing.view") || !actor.can("billing.edit")) return forbidden();
  return attempt("billing.course_use_reverse", async () => {
    const c = await courseInScope(actor, courseId);
    if (!c || !isPlausibleRecordId(useId)) return fail("not_found", COURSE_NOT_FOUND);
    const uses = await listCourseUses(actor.repo(), actor.tenantId, [c.id]);
    if (!uses.some((u) => u.id === useId)) return fail("not_found", COURSE_NOT_FOUND);
    const r = await reverseCourseUse(actor.repo(), actor.tenantId, useId, actor.actor);
    return ok({ reversed: r.reversed });
  });
}

export async function cancelCourseFor(actor: BillingActor, courseId: string, f: { creditPence?: number; reason: string }): Promise<Result<{ creditNumber: string | null; creditPence: number }>> {
  if (!actor.can("billing.view") || !actor.can("billing.edit") || !actor.can("billing.refund")) return forbidden();
  return attempt("billing.course_cancel", async () => {
    const c = await courseInScope(actor, courseId);
    if (!c) return fail("not_found", COURSE_NOT_FOUND);
    const creditPence = typeof f.creditPence === "number" && Number.isFinite(f.creditPence) ? Math.round(f.creditPence) : undefined;
    const r = await cancelPatientCourse(actor.repo(), actor.tenantId, c.id, { creditPence, reason: String(f.reason ?? "") }, actor.actor);
    return ok({ creditNumber: r.creditNote?.number ?? null, creditPence: r.creditNote?.totalPence ?? 0 });
  });
}

export async function setCourseExpiryFor(actor: BillingActor, courseId: string, rev: number, expiresOn: string | null): Promise<Result<{ rev: number }>> {
  if (!actor.can("billing.view") || !actor.can("billing.edit") || !canExtend(actor)) return forbidden();
  return attempt("billing.course_expiry", async () => {
    const c = await courseInScope(actor, courseId);
    if (!c) return fail("not_found", COURSE_NOT_FOUND);
    const r = await setCourseExpiry(actor.repo(), actor.tenantId, c.id, rev, expiresOn && expiresOn.trim() ? expiresOn.trim() : null, actor.actor);
    if (!r.ok) return r.reason === "conflict" ? fail("conflict", "Someone else changed this course. Reload the page and try again.") : fail("not_found", COURSE_NOT_FOUND);
    return ok({ rev: r.rev });
  });
}

/* ------------------------------------------------------------------------------------------------
 * Visits: which course covers which visit, and using them
 * ----------------------------------------------------------------------------------------------*/

interface VisitForCourse {
  visit: { appointmentId: string; patientId: string; serviceId: string; caseId: string | null; date: string; startTime: string | null; status: string };
  billTo: "patient" | "payer";
  chargePence: number | null;
}

/** For the visits list: the course each visit can use (completed, self-pay, a course covering it). */
export async function courseOffersFor(ctx: RepoContext, tenantId: string, priced: readonly VisitForCourse[]): Promise<Map<string, CourseOffer>> {
  const eligible = priced.filter((p) => p.visit.status === "attended" && p.billTo === "patient");
  if (eligible.length === 0) return new Map();
  const courses = await listPatientCourses(
    ctx,
    tenantId,
    eligible.map((p) => p.visit.patientId),
    { active: true },
  );
  if (courses.length === 0) return new Map();
  return offerCourses(
    priced.map((p) => ({ ...p.visit, eligible: p.visit.status === "attended" && p.billTo === "patient" })),
    courses,
  );
}

/**
 * Uses a course for each of these visits that one covers (worked out again on the server, in date order). A visit
 * whose course ran out or was changed meanwhile is simply not used – it is invoiced as usual. Returns the
 * appointments used.
 */
export async function useCoursesForVisits(ctx: RepoContext, tenantId: string, priced: readonly VisitForCourse[], actor: BillingActor["actor"]): Promise<Set<string>> {
  const used = new Set<string>();
  const offers = await courseOffersFor(ctx, tenantId, priced);
  const byId = new Map(priced.map((p) => [p.visit.appointmentId, p.visit]));
  for (const [appointmentId, offer] of Array.from(offers.entries())) {
    const v = byId.get(appointmentId);
    if (!v) continue;
    try {
      await recordCourseUse(ctx, tenantId, { patientCourseId: offer.patientCourseId, appointmentId, usedOn: v.date, patientId: v.patientId, serviceId: v.serviceId, caseId: v.caseId }, actor);
      used.add(appointmentId);
    } catch (err) {
      if (!(err instanceof RepoInputError)) throw err;
    }
  }
  return used;
}
