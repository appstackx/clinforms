/**
 * Billing reads for the screens (./access.ts has the rules): the billing home (figures + invoice list), the
 * "Attended, not invoiced" visits, an invoice, the take-payment dialog, a patient's account card and invoices,
 * remittances, aged debt, statements and the print views. Every function checks billing.view first and applies
 * the member's site scope; lists never decrypt anything.
 */
import "server-only";
import { AGE_BUCKETS, agedDebt, ageBucket, type AgeBucket } from "../../../modules/pms/billing/aging";
import { CREDIT_NOTE_KIND_LABELS, PAYMENT_METHOD_LABELS } from "../../../modules/pms/billing/copy";
import { penceDecimal, toCsv } from "../../../modules/pms/billing/csv";
import { buildStatement } from "../../../modules/pms/billing/statements";
import { INVOICE_STATE_LABELS } from "../../../modules/pms/billing/status";
import { pmsAudit } from "../../repos/pms/context";
import { invoiceState, daysBetweenIso, addDaysIso } from "../../../modules/pms/billing/status";
import type { Invoice, InvoiceSummary, PaymentMethod } from "../../../modules/pms/billing/types";
import type {
  PayerAccountTermsView,
  AgedDebtView,
  BillingFiguresView,
  InvoiceDetailView,
  InvoiceLineView,
  InvoiceMoneyRow,
  InvoiceRowView,
  PatientAccountView,
  PrintClinic,
  RemittanceInvoiceView,
  StatementView,
  TakePaymentView,
  UninvoicedVisitView,
} from "../../../modules/pms/billing/view";
import { DEFAULT_CONTRIBUTION_MODE, patientShares, type ContributionMode } from "../../../modules/pms/billing/excess";
import { excessPerVisit, visitCharge, type BillableVisit } from "../../../modules/pms/billing/visits";
import { formatUkDate, ukToday } from "../../../modules/pms/core/text";
import type { PayerType } from "../../../modules/pms/core/types";
import type { RepoContext } from "../../repos/context";
import { getClinicProfile } from "../../repos/clinic-profile";
import { caseContributionOverrides, contributionModesForCases, payerContributionModes } from "../../repos/pms/billing/contribution-terms";
import { listCreditNotesForInvoice } from "../../repos/pms/billing/credit-notes";
import { billingFigures, excessBilledForCase, notOnAnInvoice, getInvoice, listInvoicesPage, type InvoiceListState } from "../../repos/pms/billing/invoices";
import { listPaymentLinks } from "../../repos/pms/billing/payment-links";
import { accountCredit, listAllocationsForInvoice, listPayments, openInvoicesFor, type PayerRef } from "../../repos/pms/billing/payments";
import { debtInvoices, statementEntries } from "../../repos/pms/billing/reports";
import { listSavedCards } from "../../repos/pms/billing/saved-cards";
import { getBillingSettings } from "../../repos/pms/billing/settings";
import { getAuthorisation } from "../../repos/pms/cases";
import { listPractitioners, listSites } from "../../repos/pms/directory";
import { getPatientSummaries } from "../../repos/pms/patients";
import { priceFor } from "../../repos/pms/price-lists";
import { patientVisibleInScope } from "../access";
import { BILLING_NOT_FOUND, attempt, fail, forbidden, invoiceInScope, invoiceSiteVisible, notFound, ok, patientInClinic, type BillingActor, type Result } from "./access";
import { paymentLinkProvider } from "./payments";
import { billableVisitSource } from "./visit-source";
import { pmsNow, pmsNowMs } from "../../../modules/pms/core/clock";

export const INVOICE_PAGE_SIZE = 25;
const ACCOUNT_KINDS = ["insurer", "mlc", "solicitor", "employer", "case_manager", "other"] as const;

/* ------------------------------------------------------------------------------------------------
 * Names (plain columns only – never decrypted)
 * ----------------------------------------------------------------------------------------------*/

export function nameOf(p: { firstName: string; lastName: string; preferredName: string | null }): string {
  return `${p.preferredName || p.firstName} ${p.lastName}`;
}

async function patientNames(ctx: RepoContext, tenantId: string, ids: string[]) {
  return getPatientSummaries(ctx, tenantId, Array.from(new Set(ids)));
}

export async function referrerNames(ctx: RepoContext, tenantId: string, ids: (string | null)[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(new Set(ids.filter((x): x is string => typeof x === "string")));
  for (let i = 0; i < unique.length; i += 90) {
    const rows = await ctx.db
      .selectFrom("pms_referrers")
      .select(["id", "name"])
      .where("tenant_id", "=", tenantId)
      .where("id", "in", unique.slice(i, i + 90))
      .execute();
    for (const r of rows) out.set(r.id, r.name);
  }
  return out;
}

function invoiceRow(inv: InvoiceSummary, patients: Map<string, { firstName: string; lastName: string; preferredName: string | null }>, payers: Map<string, string>, today: string): InvoiceRowView {
  const p = patients.get(inv.patientId);
  const patientName = p ? nameOf(p) : "Patient";
  return {
    id: inv.id,
    number: inv.number,
    state: invoiceState(inv, today),
    billTo: inv.billTo,
    billToName: inv.billTo === "payer" && inv.payerReferrerId ? (payers.get(inv.payerReferrerId) ?? "Payer account") : patientName,
    patientId: inv.patientId,
    patientName,
    issuedOn: inv.issuedOn,
    dueOn: inv.dueOn,
    totalPence: inv.totalPence,
    balancePence: inv.balancePence,
  };
}

async function rowsFor(ctx: RepoContext, tenantId: string, invoices: InvoiceSummary[], today: string): Promise<InvoiceRowView[]> {
  const [patients, payers] = await Promise.all([
    patientNames(
      ctx,
      tenantId,
      invoices.map((i) => i.patientId),
    ),
    referrerNames(
      ctx,
      tenantId,
      invoices.map((i) => i.payerReferrerId),
    ),
  ]);
  return invoices.map((i) => invoiceRow(i, patients, payers, today));
}

function todayOf(ctx: RepoContext): string {
  return ukToday(ctx.now ? ctx.now() : pmsNow());
}

/* ------------------------------------------------------------------------------------------------
 * Pricing chargeable visits (shared with ./writes.ts invoiceVisitsFor)
 * ----------------------------------------------------------------------------------------------*/

interface CaseBilling {
  payerType: PayerType;
  payerReferrerId: string | null;
  priceListId: string | null;
  excessPence: number | null;
}

export interface PricedVisit {
  visit: BillableVisit;
  serviceName: string;
  billTo: "patient" | "payer";
  chargePence: number | null;
  excessPence: number;
  /** Insured visits: how the case bills the patient's part. */
  contributionMode: ContributionMode | null;
  payerReferrerId: string | null;
}

/**
 * Prices visits the way their invoices will be: completed visits of a case with a payer account bill the payer
 * (the patient's part goes to the patient: the case's excess not billed yet, visit by visit in date order – or the
 * contribution on every visit, as the case or its payer account says); did-not-attend and late
 * cancellation fees, and every self-pay visit, bill the patient. Prices: case price list → default → service.
 */
export async function priceVisits(ctx: RepoContext, tenantId: string, visits: BillableVisit[]): Promise<PricedVisit[]> {
  const settings = await getBillingSettings(ctx, tenantId);
  const caseIds = Array.from(new Set(visits.map((v) => v.caseId).filter((c): c is string => typeof c === "string")));
  const cases = new Map<string, CaseBilling>();
  for (let i = 0; i < caseIds.length; i += 90) {
    const rows = await ctx.db
      .selectFrom("pms_cases")
      .select(["id", "payer_type", "payer_referrer_id", "price_list_id", "excess_pence"])
      .where("tenant_id", "=", tenantId)
      .where("id", "in", caseIds.slice(i, i + 90))
      .execute();
    for (const r of rows) cases.set(r.id, { payerType: r.payer_type as PayerType, payerReferrerId: r.payer_referrer_id, priceListId: r.price_list_id, excessPence: r.excess_pence === null ? null : Number(r.excess_pence) });
  }
  const serviceIds = Array.from(new Set(visits.map((v) => v.serviceId)));
  const names = new Map<string, string>();
  for (let i = 0; i < serviceIds.length; i += 90) {
    const rows = await ctx.db.selectFrom("pms_services").select(["id", "name"]).where("tenant_id", "=", tenantId).where("id", "in", serviceIds.slice(i, i + 90)).execute();
    for (const r of rows) names.set(r.id, r.name);
  }
  const priceCache = new Map<string, number | null>();
  const out: PricedVisit[] = [];
  for (const visit of visits) {
    const c = visit.caseId ? cases.get(visit.caseId) : undefined;
    const key = `${visit.serviceId}|${c?.priceListId ?? ""}`;
    if (!priceCache.has(key)) priceCache.set(key, (await priceFor(ctx, tenantId, visit.serviceId, c?.priceListId ?? null))?.pricePence ?? null);
    const list = priceCache.get(key) ?? null;
    const insured = Boolean(c && c.payerType !== "self_pay" && c.payerReferrerId);
    const billTo = insured && visit.status === "attended" ? "payer" : "patient";
    const charge = list === null ? (visit.status !== "attended" && typeof visit.feePence === "number" ? visit.feePence : null) : visitCharge(visit.status, list, settings, visit.feePence);
    out.push({ visit, serviceName: names.get(visit.serviceId) ?? "Appointment", billTo, chargePence: charge, excessPence: 0, contributionMode: null, payerReferrerId: billTo === "payer" ? (c?.payerReferrerId ?? null) : null });
  }
  // The patient's part, case by case, over that case's payer visits in date order.
  const insuredCases = caseIds.filter((id) => out.some((p) => p.visit.caseId === id && p.billTo === "payer"));
  const modes = await contributionModesForCases(
    ctx,
    tenantId,
    insuredCases.map((id) => ({ id, payerReferrerId: cases.get(id)?.payerReferrerId ?? null })),
  );
  for (const caseId of insuredCases) {
    const c = cases.get(caseId);
    const mode = modes.get(caseId) ?? "per_case";
    const payerVisits = out.filter((p) => p.visit.caseId === caseId && p.billTo === "payer" && p.chargePence !== null).sort((a, b) => a.visit.date.localeCompare(b.visit.date) || (a.visit.startTime ?? "").localeCompare(b.visit.startTime ?? ""));
    for (const p of payerVisits) p.contributionMode = mode;
    if (!c || !c.excessPence || payerVisits.length === 0) continue;
    const already = mode === "per_case" ? await excessBilledForCase(ctx, tenantId, caseId) : 0;
    const split = patientShares(
      payerVisits.map((p) => ({ key: p.visit.appointmentId, totalPence: p.chargePence ?? 0 })),
      mode,
      c.excessPence,
      already,
    );
    for (const p of payerVisits) p.excessPence = split.get(p.visit.appointmentId) ?? 0;
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * The billing home
 * ----------------------------------------------------------------------------------------------*/

export interface BillingHomeOptions {
  state?: InvoiceListState;
  q?: string;
  page?: number;
}

export interface BillingHomeView {
  figures: BillingFiguresView;
  rows: InvoiceRowView[];
  total: number;
  page: number;
  pageSize: number;
  today: string;
}

/** How many "Attended, not invoiced" visits one list shows (the newest; the rest are counted). */
export const UNINVOICED_LIST_MAX = 500;

/**
 * Chargeable visits from the last 90 days without an invoice, in the member's sites: the newest
 * UNINVOICED_LIST_MAX of them (shown oldest first) and how many there are in all. Filtered in the database
 * (the visit source's listUninvoicedVisits with billing's own notOnAnInvoice), so a busy clinic's already
 * invoiced visits never crowd out the ones still to invoice.
 */
async function uninvoicedVisits(actor: BillingActor, options: { limit?: number } = {}): Promise<{ visits: BillableVisit[]; total: number }> {
  const ctx = actor.repo();
  const source = billableVisitSource();
  if (!source.connected) return { visits: [], total: 0 };
  const today = todayOf(ctx);
  const r = await source.listUninvoicedVisits(ctx, actor.tenantId, {
    from: addDaysIso(today, -90),
    until: today,
    siteIds: actor.siteIds ?? null,
    notBilled: notOnAnInvoice,
    limit: Math.min(UNINVOICED_LIST_MAX, options.limit ?? UNINVOICED_LIST_MAX),
  });
  return { visits: r.visits.slice().reverse(), total: r.total };
}

export async function billingHomeFor(actor: BillingActor, options: BillingHomeOptions = {}): Promise<Result<BillingHomeView>> {
  if (!actor.can("billing.view")) return forbidden();
  return attempt("billing.home", async () => {
    const ctx = actor.repo();
    const page = Math.max(1, Math.floor(options.page ?? 1));
    const scope = actor.siteIds ?? null;
    const [figures, list, visits] = await Promise.all([
      billingFigures(ctx, actor.tenantId, { siteIds: scope }),
      listInvoicesPage(ctx, actor.tenantId, { state: options.state ?? "all", q: options.q, siteIds: scope, limit: INVOICE_PAGE_SIZE, offset: (page - 1) * INVOICE_PAGE_SIZE }),
      actor.can("billing.edit") ? uninvoicedVisits(actor, { limit: 1 }) : Promise.resolve({ visits: [] as BillableVisit[], total: 0 }),
    ]);
    const today = todayOf(ctx);
    return ok({
      figures: {
        outstandingPence: figures.outstandingPence,
        outstandingCount: figures.outstandingCount,
        outstandingPatientsPence: figures.outstandingPatientsPence,
        outstandingAccountsPence: figures.outstandingAccountsPence,
        overduePence: figures.overduePence,
        overdueCount: figures.overdueCount,
        takenTodayPence: figures.takenTodayPence,
        takenTodayByMethod: Object.entries(figures.takenTodayByMethod)
          .map(([method, pence]) => ({ method: method as PaymentMethod, label: PAYMENT_METHOD_LABELS[method as PaymentMethod] ?? method, pence }))
          .sort((a, b) => b.pence - a.pence),
        drafts: figures.drafts,
        uninvoicedVisits: visits.total,
      },
      rows: await rowsFor(ctx, actor.tenantId, list.rows, today),
      total: list.total,
      page,
      pageSize: INVOICE_PAGE_SIZE,
      today,
    });
  });
}

/** The "Attended, not invoiced" visits (billing.edit: only members who can invoice them see them). */
export async function uninvoicedVisitsFor(
  actor: BillingActor,
  options: { limit?: number } = {},
): Promise<Result<{ visits: UninvoicedVisitView[]; total: number; connected: boolean; from: string; until: string }>> {
  if (!actor.can("billing.view") || !actor.can("billing.edit")) return forbidden();
  return attempt("billing.uninvoiced", async () => {
    const ctx = actor.repo();
    const today = todayOf(ctx);
    const { visits, total } = await uninvoicedVisits(actor, options);
    const priced = await priceVisits(ctx, actor.tenantId, visits);
    const [patients, practitioners, payers] = await Promise.all([
      patientNames(
        ctx,
        actor.tenantId,
        visits.map((v) => v.patientId),
      ),
      listPractitioners(ctx, actor.tenantId, { includeInactive: true }),
      referrerNames(
        ctx,
        actor.tenantId,
        priced.map((p) => p.payerReferrerId),
      ),
    ]);
    const pracNames = new Map(practitioners.map((p) => [p.id, p.displayName]));
    const rows: UninvoicedVisitView[] = priced.map((p) => {
      const pat = patients.get(p.visit.patientId);
      const charge = p.chargePence;
      const payerPart = p.billTo === "payer" && charge !== null ? charge - p.excessPence : 0;
      return {
        appointmentId: p.visit.appointmentId,
        patientId: p.visit.patientId,
        patientName: pat ? nameOf(pat) : "Patient",
        date: p.visit.date,
        startTime: p.visit.startTime,
        status: p.visit.status,
        serviceName: p.serviceName,
        practitionerName: p.visit.practitionerId ? (pracNames.get(p.visit.practitionerId) ?? null) : null,
        payerLabel: p.billTo === "payer" && p.payerReferrerId ? (payers.get(p.payerReferrerId) ?? "Payer account") : "Self-pay",
        billTo: p.billTo,
        chargePence: charge,
        patientPence: charge === null ? 0 : p.billTo === "payer" ? p.excessPence : charge,
        payerPence: payerPart,
        excessPence: p.excessPence,
        contributionMode: p.contributionMode,
        caseId: p.visit.caseId,
        waivable: p.visit.status !== "attended",
      };
    });
    return ok({ visits: rows, total, connected: billableVisitSource().connected, from: addDaysIso(today, -90), until: today });
  });
}

/* ------------------------------------------------------------------------------------------------
 * One invoice
 * ----------------------------------------------------------------------------------------------*/

/**
 * The deduction of an insurer's invoice over its treatment lines (display only): the contribution on every line
 * (per visit), or the excess spread over the lines in date order (per case).
 */
export function lineExcess(inv: Pick<Invoice, "lines"> & { perVisitContributionPence?: number | null }): Map<string, number> {
  const deduction = -inv.lines.filter((l) => l.kind === "excess_deduction").reduce((a, l) => a + l.totalPence, 0);
  const treat = inv.lines.filter((l) => l.kind === "service" || l.kind === "item").sort((a, b) => (a.serviceOn ?? "").localeCompare(b.serviceOn ?? "") || a.lineNo - b.lineNo);
  if (deduction > 0 && inv.perVisitContributionPence) {
    return patientShares(
      treat.map((l) => ({ key: l.id, totalPence: l.totalPence })),
      "per_visit",
      inv.perVisitContributionPence,
    );
  }
  return excessPerVisit(
    treat.map((l) => ({ key: l.id, totalPence: l.totalPence })),
    deduction,
  );
}

function billToLines(snapshot: Invoice["billToSnapshot"]): string[] {
  if (!snapshot) return [];
  return [...(snapshot.attention ? [`For the attention of ${snapshot.attention}`] : []), ...(snapshot.address ?? []), ...(snapshot.postcode ? [snapshot.postcode] : [])];
}

export async function invoiceDetailFor(actor: BillingActor, invoiceId: string): Promise<Result<InvoiceDetailView>> {
  if (!actor.can("billing.view")) return forbidden();
  return attempt("billing.invoice", async () => {
    const inv = await invoiceInScope(actor, invoiceId);
    if (!inv) return fail("not_found", BILLING_NOT_FOUND);
    return ok(await detailOf(actor, inv));
  });
}

async function detailOf(actor: BillingActor, inv: Invoice): Promise<InvoiceDetailView> {
  const ctx = actor.repo();
  const t = actor.tenantId;
  const today = todayOf(ctx);
  const [patients, payers, practitioners, allocations, credits, links, settings, partner, sites] = await Promise.all([
    patientNames(ctx, t, [inv.patientId]),
    referrerNames(ctx, t, [inv.payerReferrerId]),
    listPractitioners(ctx, t, { includeInactive: true }),
    listAllocationsForInvoice(ctx, t, inv.id),
    listCreditNotesForInvoice(ctx, t, inv.id),
    listPaymentLinks(ctx, t, inv.id),
    getBillingSettings(ctx, t),
    inv.relatedInvoiceId ? getInvoice(ctx, t, inv.relatedInvoiceId) : Promise.resolve(null),
    listSites(ctx, t, { includeInactive: true }),
  ]);
  const p = patients.get(inv.patientId);
  const patientName = p ? nameOf(p) : "Patient";
  const pracs = new Map(practitioners.map((x) => [x.id, x]));
  const excess = lineExcess(inv);
  const caseRow = inv.caseId
    ? await ctx.db.selectFrom("pms_cases").select(["id", "title", "membership_number", "excess_pence", "payer_referrer_id"]).where("tenant_id", "=", t).where("id", "=", inv.caseId).executeTakeFirst()
    : undefined;
  const auth = inv.authorisationId ? await getAuthorisation(ctx, t, inv.authorisationId) : null;
  const lines: InvoiceLineView[] = inv.lines
    .filter((l) => l.kind !== "excess_deduction")
    .map((l) => {
      const prac = l.practitionerId ? pracs.get(l.practitionerId) : undefined;
      return {
        id: l.id,
        lineNo: l.lineNo,
        kind: l.kind,
        serviceOn: l.serviceOn,
        description: l.description ?? "",
        practitionerName: prac?.displayName ?? null,
        practitionerRegistration: prac?.registrationNumber ?? null,
        quantity: l.quantity,
        unitPricePence: l.unitPricePence,
        totalPence: l.totalPence,
        vatCode: l.vatCode,
        vatRateBp: l.vatRateBp,
        vatPence: l.vatPence,
        creditedPence: l.creditedPence,
        excessPence: excess.get(l.id) ?? 0,
        appointmentId: l.appointmentId,
      };
    });
  const money: InvoiceMoneyRow[] = [
    ...allocations.map((a) => ({
      id: a.id,
      on: a.receivedOn,
      label: a.kind === "refund" ? `Refund – ${PAYMENT_METHOD_LABELS[a.method].toLowerCase()}` : a.reference && inv.billTo === "payer" ? `Remittance ${a.reference} · ${PAYMENT_METHOD_LABELS[a.method].toLowerCase()}` : `Payment – ${PAYMENT_METHOD_LABELS[a.method].toLowerCase()}${a.reference ? ` (${a.reference})` : ""}`,
      amountPence: -a.amountPence,
      kind: a.kind,
      allocationId: a.id,
    })),
    ...credits.map((c) => ({ id: c.id, on: c.issuedOn, label: `${CREDIT_NOTE_KIND_LABELS[c.kind]} ${c.number}`, amountPence: -c.totalPence, kind: c.kind, allocationId: null })),
  ].sort((a, b) => a.on.localeCompare(b.on));
  const partnerView = partner
    ? {
        id: partner.id,
        number: partner.number,
        billToName: partner.billTo === "payer" && partner.payerReferrerId ? ((await referrerNames(ctx, t, [partner.payerReferrerId])).get(partner.payerReferrerId) ?? "Payer account") : patientName,
        totalPence: partner.totalPence,
        balancePence: partner.balancePence,
        state: invoiceState(partner, today),
        isExcess: partner.lines.some((l) => l.kind === "excess"),
      }
    : null;
  // How the patient's part was billed: kept on the invoice (per visit) or the case's excess (per case).
  const hasExcessLines = inv.lines.some((l) => l.kind === "excess");
  const hasDeduction = inv.lines.some((l) => l.kind === "excess_deduction");
  let contribution: InvoiceDetailView["contribution"] = null;
  if (hasExcessLines || hasDeduction || partner || inv.perVisitContributionPence !== null) {
    const insurerId = inv.payerReferrerId ?? partner?.payerReferrerId ?? caseRow?.payer_referrer_id ?? null;
    const insurerName = insurerId ? ((await referrerNames(ctx, t, [insurerId])).get(insurerId) ?? null) : null;
    const mode: ContributionMode = inv.perVisitContributionPence !== null ? "per_visit" : "per_case";
    contribution = {
      mode,
      amountPence: mode === "per_visit" ? inv.perVisitContributionPence : caseRow?.excess_pence === null || caseRow?.excess_pence === undefined ? null : Number(caseRow.excess_pence),
      insurerName,
      fullyPatient: inv.billTo === "patient" && !partner && hasExcessLines && inv.lines.some((l) => l.kind === "excess" && l.appointmentId !== null),
    };
  }
  return {
    id: inv.id,
    rev: inv.rev,
    number: inv.number,
    state: invoiceState(inv, today),
    status: inv.status,
    billTo: inv.billTo,
    billToName: inv.billToSnapshot?.name ?? (inv.billTo === "payer" && inv.payerReferrerId ? (payers.get(inv.payerReferrerId) ?? "Payer account") : patientName),
    billToLines: billToLines(inv.billToSnapshot),
    billToReferences: inv.billToSnapshot?.references ?? [],
    patient: { id: inv.patientId, name: patientName, number: p?.patientNumber ?? 0, dateOfBirth: p?.dateOfBirth ?? null, email: p?.email ?? null },
    payer: inv.payerReferrerId ? { id: inv.payerReferrerId, name: payers.get(inv.payerReferrerId) ?? "Payer account" } : null,
    case: caseRow ? { id: caseRow.id, title: caseRow.title, membershipNumber: caseRow.membership_number } : null,
    authorisation: auth ? { code: auth.code, sessionsUsed: auth.sessionsUsed, sessionsAuthorised: auth.sessionsAuthorised } : null,
    partner: partnerView,
    contribution,
    siteName: inv.siteId ? (sites.find((s) => s.id === inv.siteId)?.name ?? null) : null,
    issuedOn: inv.issuedOn,
    dueOn: inv.dueOn,
    netPence: inv.netPence,
    vatPence: inv.vatPence,
    totalPence: inv.totalPence,
    paidPence: inv.paidPence,
    creditedPence: inv.creditedPence,
    balancePence: inv.balancePence,
    lines,
    money,
    paymentLinks: links.map((l) => ({ id: l.id, url: l.url, amountPence: l.amountPence, status: l.status, createdAt: l.createdAt })),
    notes: inv.notes,
    vatRegistered: settings.vatRegistered,
    canTakePaymentHere: inv.status === "issued" && inv.billTo === "patient" && inv.balancePence > 0,
  };
}

/* ------------------------------------------------------------------------------------------------
 * A patient: the take-payment dialog, the record's Account card and Invoices tab
 * ----------------------------------------------------------------------------------------------*/

function cardLabel(c: { brand: string; last4: string; expMonth: number; expYear: number }): string {
  const brand = c.brand ? c.brand.charAt(0).toUpperCase() + c.brand.slice(1) : "Card";
  return `${brand} ending ${c.last4} · expires ${String(c.expMonth).padStart(2, "0")}/${String(c.expYear).slice(-2)}`;
}

export async function takePaymentViewFor(actor: BillingActor, patientId: string, context: string | null = null): Promise<Result<TakePaymentView>> {
  if (!actor.can("billing.view") || !actor.can("billing.pay")) return forbidden();
  return attempt("billing.take_payment_view", async () => {
    const patient = await patientInClinic(actor, patientId);
    if (!patient) return notFound();
    const ctx = actor.repo();
    const t = actor.tenantId;
    const [open, cards, settings] = await Promise.all([openInvoicesFor(ctx, t, { payerKind: "patient", patientId: patient.id }), listSavedCards(ctx, t, patient.id), getBillingSettings(ctx, t)]);
    const visible = open.filter((i) => invoiceSiteVisible(actor, i.siteId));
    const invoices = await Promise.all(
      visible.map(async (i) => {
        const full = await getInvoice(ctx, t, i.id);
        const first = full?.lines.find((l) => l.kind !== "excess_deduction");
        const what = first?.description ?? "Invoice";
        return { id: i.id, number: i.number, description: `${what}${i.firstServiceOn ? ` · ${formatUkDate(i.firstServiceOn)}` : ""}`, issuedOn: i.issuedOn, balancePence: i.balancePence };
      }),
    );
    const provider = paymentLinkProvider();
    return ok({
      patient: { id: patient.id, name: nameOf(patient), dateOfBirth: patient.dateOfBirth, email: patient.email },
      balancePence: invoices.reduce((a, i) => a + i.balancePence, 0),
      invoices,
      savedCards: cards.map((c) => ({ id: c.id, label: cardLabel(c) })),
      providerReady: provider.configured,
      providerNote: provider.configured ? "Test mode – no real card is charged." : provider.unavailableReason,
      linksEnabled: provider.configured && settings.paymentLinksEnabled,
      context,
    });
  });
}

export async function patientAccountFor(actor: BillingActor, patientId: string): Promise<Result<PatientAccountView>> {
  if (!actor.can("billing.view")) return forbidden();
  return attempt("billing.patient_account", async () => {
    const patient = await patientInClinic(actor, patientId);
    if (!patient) return notFound();
    const ctx = actor.repo();
    const t = actor.tenantId;
    const today = todayOf(ctx);
    const [mine, theirs, credit, cards] = await Promise.all([
      listInvoicesPage(ctx, t, { patientId: patient.id, billTo: "patient", state: "outstanding", siteIds: actor.siteIds ?? null, limit: 200 }),
      listInvoicesPage(ctx, t, { patientId: patient.id, billTo: "payer", state: "outstanding", siteIds: actor.siteIds ?? null, limit: 200 }),
      accountCredit(ctx, t, { payerKind: "patient", patientId: patient.id }),
      listSavedCards(ctx, t, patient.id),
    ]);
    const provider = paymentLinkProvider();
    return ok({
      patientBalancePence: mine.rows.reduce((a, i) => a + i.balancePence, 0),
      accountsBalancePence: theirs.rows.reduce((a, i) => a + i.balancePence, 0),
      creditOnAccountPence: credit,
      overdueCount: mine.rows.filter((i) => i.dueOn !== null && i.dueOn < today).length,
      savedCard: cards[0] ? { id: cards[0].id, label: cardLabel(cards[0]) } : null,
      canSaveTestCard: provider.configured && actor.can("billing.pay"),
    });
  });
}

export async function patientInvoicesFor(actor: BillingActor, patientId: string): Promise<Result<{ rows: InvoiceRowView[]; balancePence: number }>> {
  if (!actor.can("billing.view")) return forbidden();
  return attempt("billing.patient_invoices", async () => {
    const patient = await patientInClinic(actor, patientId);
    if (!patient) return notFound();
    const ctx = actor.repo();
    const list = await listInvoicesPage(ctx, actor.tenantId, { patientId: patient.id, siteIds: actor.siteIds ?? null, limit: 200 });
    const rows = await rowsFor(ctx, actor.tenantId, list.rows, todayOf(ctx));
    return ok({ rows, balancePence: list.rows.filter((r) => r.status === "issued" && r.billTo === "patient").reduce((a, r) => a + Math.max(0, r.balancePence), 0) });
  });
}

/* ------------------------------------------------------------------------------------------------
 * Remittances
 * ----------------------------------------------------------------------------------------------*/

export async function payerAccountsFor(actor: BillingActor): Promise<Result<{ id: string; name: string }[]>> {
  if (!actor.can("billing.view")) return forbidden();
  return attempt("billing.payers", async () => {
    const rows = await actor
      .repo()
      .db.selectFrom("pms_referrers")
      .select(["id", "name"])
      .where("tenant_id", "=", actor.tenantId)
      .where("kind", "in", ACCOUNT_KINDS as unknown as string[])
      .where("active", "=", 1)
      .orderBy("name")
      .limit(500)
      .execute();
    return ok(rows.map((r) => ({ id: r.id, name: r.name })));
  });
}

export async function remittanceInvoicesFor(actor: BillingActor, payerReferrerId: string): Promise<Result<RemittanceInvoiceView[]>> {
  if (!actor.can("billing.view") || !actor.can("billing.pay")) return forbidden();
  return attempt("billing.remittance_invoices", async () => {
    const ctx = actor.repo();
    const open = (await openInvoicesFor(ctx, actor.tenantId, { payerKind: "account", payerReferrerId })).filter((i) => invoiceSiteVisible(actor, i.siteId));
    const patients = await patientNames(
      ctx,
      actor.tenantId,
      open.map((i) => i.patientId),
    );
    return ok(
      open.map((i) => {
        const p = patients.get(i.patientId);
        return { id: i.id, number: i.number, issuedOn: i.issuedOn, patientName: p ? nameOf(p) : "Patient", balancePence: i.balancePence };
      }),
    );
  });
}

export async function recentRemittancesFor(actor: BillingActor): Promise<Result<{ id: string; on: string; payerName: string; reference: string | null; amountPence: number; allocatedPence: number; method: string }[]>> {
  if (!actor.can("billing.view")) return forbidden();
  return attempt("billing.remittances", async () => {
    const ctx = actor.repo();
    const pays = await listPayments(ctx, actor.tenantId, { payerKind: "account", kind: "payment", status: "recorded", limit: 50 });
    const names = await referrerNames(
      ctx,
      actor.tenantId,
      pays.map((p) => p.payerReferrerId),
    );
    return ok(pays.map((p) => ({ id: p.id, on: p.receivedOn, payerName: p.payerReferrerId ? (names.get(p.payerReferrerId) ?? "Payer account") : "Payer account", reference: p.reference, amountPence: p.amountPence, allocatedPence: p.allocatedPence, method: PAYMENT_METHOD_LABELS[p.method] })));
  });
}

/* ------------------------------------------------------------------------------------------------
 * Aged debt
 * ----------------------------------------------------------------------------------------------*/

export async function agedDebtFor(actor: BillingActor): Promise<Result<AgedDebtView>> {
  if (!actor.can("billing.view")) return forbidden();
  return attempt("billing.aged_debt", async () => {
    const ctx = actor.repo();
    const t = actor.tenantId;
    const asOf = todayOf(ctx);
    // The member's sites are filtered in the query (an invoice's site), so the totals are right at any size.
    const { rows } = await debtInvoices(ctx, t, { siteIds: actor.siteIds ?? null });
    const debt = agedDebt(rows, asOf);
    const empty = (): Record<AgeBucket, number> => ({ current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 });
    const patients = { label: "Patients", buckets: empty(), totalPence: 0 };
    const accounts = { label: "Insurers and other accounts", buckets: empty(), totalPence: 0 };
    for (const r of debt.rows) {
      const target = r.debtorKey.startsWith("patient:") ? patients : accounts;
      for (const b of AGE_BUCKETS) target.buckets[b] += r.buckets[b];
      target.totalPence += r.totalPence;
    }
    const oldestDue = new Map<string, string>();
    for (const r of rows) {
      if (r.balancePence <= 0) continue;
      const due = r.dueOn ?? r.issuedOn;
      const cur = oldestDue.get(r.debtorKey);
      if (!cur || due < cur) oldestDue.set(r.debtorKey, due);
    }
    // The 8 largest overdue debtors first, then the names of those 8 only (not of every debtor).
    const top = debt.rows
      .map((r) => ({ key: r.debtorKey, isPatient: r.debtorKey.startsWith("patient:"), id: r.debtorKey.slice(8), amountPence: r.totalPence - r.buckets.current, daysOverdue: Math.max(0, daysBetweenIso(oldestDue.get(r.debtorKey) ?? asOf, asOf)) }))
      .filter((x) => x.amountPence > 0)
      .sort((a, b) => b.amountPence - a.amountPence || b.daysOverdue - a.daysOverdue)
      .slice(0, 8);
    const [pn, an] = await Promise.all([
      patientNames(
        ctx,
        t,
        top.filter((x) => x.isPatient).map((x) => x.id),
      ),
      referrerNames(
        ctx,
        t,
        top.filter((x) => !x.isPatient).map((x) => x.id),
      ),
    ]);
    const largest = top.map((x) => {
      const p = x.isPatient ? pn.get(x.id) : undefined;
      return {
        key: x.key,
        name: x.isPatient ? (p ? nameOf(p) : "Patient") : (an.get(x.id) ?? "Payer account"),
        kind: (x.isPatient ? "patient" : "account") as "patient" | "account",
        daysOverdue: x.daysOverdue,
        amountPence: x.amountPence,
        patientId: x.isPatient ? x.id : null,
        payerReferrerId: x.isPatient ? null : x.id,
      };
    });
    return ok({
      asOf,
      rows: [patients, accounts],
      totals: { ...debt.totals },
      largest,
      refundsDuePence: debt.refundsDue.reduce((a, r) => a + r.amountPence, 0),
    });
  });
}

/* ------------------------------------------------------------------------------------------------
 * Print: the clinic's letterhead, an invoice, a statement
 * ----------------------------------------------------------------------------------------------*/

export async function printClinicOf(actor: BillingActor, siteId: string | null = null): Promise<PrintClinic> {
  const ctx = actor.repo();
  const [profile, settings, sites] = await Promise.all([getClinicProfile(ctx, actor.tenantId), getBillingSettings(ctx, actor.tenantId), listSites(ctx, actor.tenantId, { includeInactive: true })]);
  const site = siteId ? sites.find((s) => s.id === siteId) : undefined;
  const address = [...(profile?.address ?? []), ...(profile?.postcode ? [profile.postcode] : [])].join(", ");
  return {
    name: profile?.displayName ?? "Clinic",
    lines: [[site?.name, address].filter(Boolean).join(" · ")].filter((x) => x.length > 0),
    contact: [profile?.phone, profile?.email].filter(Boolean).join(" · ") || null,
    vatNumber: settings.vatRegistered ? settings.vatNumber : null,
  };
}

export async function howToPayLines(actor: BillingActor, reference: string, link: string | null): Promise<string[]> {
  const ctx = actor.repo();
  const [settings, profile] = await Promise.all([getBillingSettings(ctx, actor.tenantId), getClinicProfile(ctx, actor.tenantId)]);
  const out: string[] = [];
  if (link) out.push(`Online: ${link} (card)`);
  if (settings.bankDetails) out.push(`Bank transfer: ${settings.bankDetails.accountName} · sort code ${settings.bankDetails.sortCode} · account ${settings.bankDetails.accountNumber} · reference ${reference}`);
  if (settings.paymentInstructions) out.push(`${settings.paymentInstructions.replace(/\s+$/, "")} · reference ${reference}`);
  if (profile?.phone) out.push(`By phone or at reception: ${profile.phone}`);
  return Array.from(new Set(out));
}

export async function printInvoiceFor(actor: BillingActor, invoiceId: string): Promise<Result<{ clinic: PrintClinic; invoice: InvoiceDetailView; howToPay: string[]; printedBy: string; printedAt: string }>> {
  if (!actor.can("billing.view")) return forbidden();
  return attempt("billing.print_invoice", async () => {
    const inv = await invoiceInScope(actor, invoiceId);
    if (!inv || inv.status !== "issued") return fail("not_found", BILLING_NOT_FOUND);
    const detail = await detailOf(actor, inv);
    const active = detail.paymentLinks.find((l) => l.status === "active");
    return ok({
      clinic: await printClinicOf(actor, inv.siteId),
      invoice: detail,
      howToPay: detail.balancePence > 0 ? await howToPayLines(actor, inv.number ?? "", active?.url ?? null) : [],
      printedBy: actor.name || actor.email,
      printedAt: new Date(actor.repo().now ? (actor.repo().now as () => Date)().getTime() : pmsNowMs()).toISOString(),
    });
  });
}

export type StatementFor = { patientId: string } | { payerReferrerId: string };

export async function statementFor(actor: BillingActor, who: StatementFor, from: string, until: string): Promise<Result<{ clinic: PrintClinic; statement: StatementView; printedBy: string; printedAt: string }>> {
  if (!actor.can("billing.view")) return forbidden();
  return attempt("billing.statement", async () => {
    const ctx = actor.repo();
    const t = actor.tenantId;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(until) || from > until) return fail("invalid", "Choose a period: the start date on or before the end date.");
    let payer: PayerRef;
    let account: StatementView["account"];
    if ("patientId" in who) {
      const p = await patientInClinic(actor, who.patientId);
      if (!p) return notFound();
      payer = { payerKind: "patient", patientId: p.id };
      account = { name: [p.title, p.firstName, p.lastName].filter(Boolean).join(" "), lines: [...(p.address ?? []), ...(p.postcode ? [p.postcode] : [])].filter(Boolean).length ? [[...(p.address ?? []), p.postcode].filter(Boolean).join(", ")] : [], reference: `Patient no. ${p.patientNumber}` };
    } else {
      const r = await ctx.db
        .selectFrom("pms_referrers")
        .select(["id", "name", "contact_name", "address_json", "postcode"])
        .where("tenant_id", "=", t)
        .where("id", "=", who.payerReferrerId)
        .executeTakeFirst();
      if (!r) return notFound();
      payer = { payerKind: "account", payerReferrerId: r.id };
      let lines: string[] = [];
      try {
        lines = r.address_json ? (JSON.parse(r.address_json) as string[]) : [];
      } catch {
        lines = [];
      }
      account = { name: r.name, lines: [[...lines, r.postcode].filter(Boolean).join(", ")].filter((x) => x.length > 0), reference: null };
    }
    const { entries } = await statementEntries(ctx, t, payer, until);
    const st = buildStatement(entries, from, until);
    // Age of what is owed at the end of the period (patient statements: by invoice due date).
    const { rows: debts } = await debtInvoices(ctx, t, { debtor: payer });
    const key = payer.payerKind === "patient" ? `patient:${payer.patientId}` : `account:${payer.payerReferrerId}`;
    const ages = { current: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
    for (const d of debts) {
      if (d.debtorKey !== key || d.balancePence <= 0) continue;
      const b = ageBucket(d.dueOn, d.issuedOn, until);
      if (b === "current" || b === "d1_30") ages.current += d.balancePence;
      else ages[b] += d.balancePence;
    }
    const rows = st.rows.map((r) => ({ on: r.on, details: r.kind === "invoice" ? `${r.reference} ${r.description.replace(/^Invoice ?/, "").replace(/^\(treatment (.*)\)$/, "$1")}`.trim() : r.kind === "payment" ? `Payment${r.reference ? ` – ${r.reference}` : ""}` : r.kind === "refund" ? "Refund" : `${r.reference} ${r.description}`, chargePence: r.debitPence || null, paymentPence: r.creditPence || null, balancePence: r.balancePence }));
    const ref = account.reference ?? account.name;
    return ok({
      clinic: await printClinicOf(actor, null),
      statement: { title: "Statement", from, until, account, openingPence: st.openingPence, rows, closingPence: st.closingPence, ages, howToPay: await howToPayLines(actor, ref.replace(/^Patient no\. /, ""), null) },
      printedBy: actor.name || actor.email,
      printedAt: pmsNow().toISOString(),
    });
  });
}

/** For the patient list: whether a patient is visible (re-export for pages). */
export { patientVisibleInScope };

/** The statement form's accounts: payer accounts, then patients with invoices addressed to them (recent first). */
export async function statementAccountsFor(actor: BillingActor): Promise<Result<{ value: string; label: string }[]>> {
  if (!actor.can("billing.view")) return forbidden();
  return attempt("billing.statement_accounts", async () => {
    const ctx = actor.repo();
    const t = actor.tenantId;
    const [payers, recent] = await Promise.all([
      payerAccountsFor(actor),
      listInvoicesPage(ctx, t, { billTo: "patient", siteIds: actor.siteIds ?? null, limit: 200 }),
    ]);
    const patientIds = Array.from(new Set(recent.rows.filter((r) => r.status === "issued").map((r) => r.patientId)));
    const names = await patientNames(ctx, t, patientIds);
    const patients = patientIds
      .map((id) => ({ value: `patient:${id}`, label: `${names.get(id) ? nameOf(names.get(id)!) : "Patient"} (patient)` }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return ok([...patients, ...(payers.ok ? payers.value.map((p) => ({ value: `account:${p.id}`, label: p.name })) : [])]);
  });
}

/**
 * The invoice list as CSV (reports.export, as the patient list's export): the list's filters, at most 5,000 rows,
 * formula-looking cells defused (csv.ts), audited with the count and the filters' names – never patient data.
 */
export async function invoicesCsvFor(actor: BillingActor, filters: { state?: InvoiceListState; q?: string }): Promise<Result<{ csv: string; count: number }>> {
  if (!actor.can("billing.view") || !actor.can("reports.export")) return forbidden();
  return attempt("billing.invoices_csv", async () => {
    const ctx = actor.repo();
    const t = actor.tenantId;
    const today = todayOf(ctx);
    const rows: InvoiceRowView[] = [];
    for (let offset = 0; offset < 5000; offset += 200) {
      const page = await listInvoicesPage(ctx, t, { state: filters.state ?? "all", q: filters.q, siteIds: actor.siteIds ?? null, limit: 200, offset });
      rows.push(...(await rowsFor(ctx, t, page.rows, today)));
      if (page.rows.length < 200) break;
    }
    const csv = toCsv(
      ["Invoice", "Bill to", "Patient", "Issued", "Due", "Status", "Total", "Balance"],
      rows.map((r) => [r.number ?? "Draft", r.billToName, r.patientName, r.issuedOn ? formatUkDate(r.issuedOn) : "", r.dueOn ? formatUkDate(r.dueOn) : "", INVOICE_STATE_LABELS[r.state], penceDecimal(r.totalPence), penceDecimal(r.balancePence)]),
    );
    await pmsAudit(ctx, t, actor.actor, { action: "pms.invoice.csv_export", targetType: "pms_invoice", targetId: "list", detail: { count: rows.length, filters: Object.keys(filters).filter((k) => Boolean((filters as Record<string, unknown>)[k])) } });
    return ok({ csv, count: rows.length });
  });
}

/* ------------------------------------------------------------------------------------------------
 * How the patient's part is billed (payer accounts, cases)
 * ----------------------------------------------------------------------------------------------*/

/** The payer accounts (insurers, MLC companies, solicitors, employers, case managers) with their mode. */
export async function payerTermsFor(actor: BillingActor): Promise<Result<{ accounts: PayerAccountTermsView[]; canEdit: boolean }>> {
  if (!actor.can("billing.view")) return forbidden();
  return attempt("billing.payer_accounts", async () => {
    const ctx = actor.repo();
    const rows = await ctx.db
      .selectFrom("pms_referrers")
      .select(["id", "name", "kind", "active"])
      .where("tenant_id", "=", actor.tenantId)
      .where("kind", "in", ACCOUNT_KINDS as unknown as string[])
      .orderBy("name")
      .limit(500)
      .execute();
    const modes = await payerContributionModes(ctx, actor.tenantId);
    return ok({
      accounts: rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, active: Number(r.active) === 1, mode: modes.get(r.id) ?? DEFAULT_CONTRIBUTION_MODE })),
      canEdit: actor.can("settings.setup"),
    });
  });
}

/** For the case form: each payer account's mode, and the case's own override (null = as its account). */
export async function caseContributionFor(actor: BillingActor, caseId: string | null): Promise<{ payerModes: Record<string, ContributionMode>; caseMode: ContributionMode | null }> {
  const ctx = actor.repo();
  const [payers, own] = await Promise.all([payerContributionModes(ctx, actor.tenantId), caseId ? caseContributionOverrides(ctx, actor.tenantId, [caseId]) : Promise.resolve(new Map<string, ContributionMode>())]);
  return { payerModes: Object.fromEntries(payers), caseMode: caseId ? (own.get(caseId) ?? null) : null };
}
