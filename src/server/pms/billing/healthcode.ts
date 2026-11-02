/**
 * Healthcode e-billing groundwork – the server layer of the insurer-bill screens (docs/clinic-system/healthcode.md):
 * diagnosis codes on cases and insurer invoices (HC10), the claims page's Healthcode tab (HC12). Same rules as the billing services (./access.ts): the
 * permission first, ids read back from the member's clinic and site scope, inputs validated, plain results.
 *
 * A diagnosis is clinical: reading it needs clinical.view, changing it clinical.view plus patients.edit (a case) or
 * billing.edit (an invoice).
 */
import "server-only";
import { EXPORT_CHANNEL_INFO } from "../../../modules/pms/billing/ebilling";
import {
  HEALTHCODE_FILE_OFF_NOTE,
  HEALTHCODE_FILE_SUBMISSION_ENABLED,
  diagnosisRequired,
  healthcodeForSite,
  pairKey,
  type HealthcodeClaimRow,
  type HealthcodeClaimsView,
  type InvoiceHealthcodeView,
} from "../../../modules/pms/billing/healthcode";
import { checkHealthcodeBatch, type HealthcodeCheck, type HealthcodeInvoiceFacts } from "../../../modules/pms/billing/healthcode-check";
import { OptionalIcd10Schema } from "../../../modules/pms/billing/icd10";
import type { Invoice } from "../../../modules/pms/billing/types";
import { ukToday } from "../../../modules/pms/core/text";
import { getAuthorisation, getCase } from "../../repos/pms/cases";
import {
  caseDiagnoses,
  getHealthcodeSettings,
  listExportBatches,
  payerHealthcodes,
  practitionerInsurerNumbers,
  serviceInsurerCodes,
  setCaseDiagnosis,
  setInvoiceDiagnosis,
} from "../../repos/pms/billing/healthcode";
import { getInvoice, listInvoicesPage } from "../../repos/pms/billing/invoices";
import { listPractitioners, listServices } from "../../repos/pms/directory";
import { listReferrers } from "../../repos/pms/referrers";
import { attempt, fail, forbidden, invoiceInScope, notFound, ok, patientInClinic, BILLING_NOT_FOUND, type BillingActor, type Result } from "./access";

async function caseOfPatient(actor: BillingActor, patientId: string, caseId: string) {
  const patient = await patientInClinic(actor, patientId);
  if (!patient) return null;
  if (typeof caseId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(caseId)) return null;
  const c = await getCase(actor.repo(), actor.tenantId, caseId);
  return c && c.patientId === patient.id ? c : null;
}

/* ------------------------------------------------------------------------------------------------
 * HC10 – diagnosis codes
 * ----------------------------------------------------------------------------------------------*/

/** A case's diagnosis code (clinical.view), and whether the member may change it. */
export async function caseDiagnosisFor(actor: BillingActor, patientId: string, caseId: string): Promise<Result<{ code: string | null; canEdit: boolean }>> {
  if (!actor.can("clinical.view")) return forbidden();
  return attempt("healthcode.case_diagnosis", async () => {
    const c = await caseOfPatient(actor, patientId, caseId);
    if (!c) return notFound();
    const code = (await caseDiagnoses(actor.repo(), actor.tenantId, [c.id])).get(c.id) ?? null;
    return ok({ code, canEdit: actor.can("patients.edit") });
  });
}

export async function setCaseDiagnosisFor(actor: BillingActor, patientId: string, caseId: string, code: unknown): Promise<Result<{ code: string | null }>> {
  if (!actor.can("clinical.view") || !actor.can("patients.edit")) return forbidden();
  const parsed = OptionalIcd10Schema.safeParse(typeof code === "string" ? code : null);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message ?? "Check the diagnosis code.");
  return attempt("healthcode.case_diagnosis_set", async () => {
    const c = await caseOfPatient(actor, patientId, caseId);
    if (!c) return notFound();
    const saved = await setCaseDiagnosis(actor.repo(), actor.tenantId, c.id, parsed.data ?? null, actor.actor);
    return ok({ code: saved });
  });
}

/** An insurer invoice's own diagnosis code (billing.edit + clinical.view). Blank = use the case's. */
export async function setInvoiceDiagnosisFor(actor: BillingActor, invoiceId: string, code: unknown): Promise<Result<{ code: string | null }>> {
  if (!actor.can("billing.edit") || !actor.can("clinical.view")) return forbidden();
  const parsed = OptionalIcd10Schema.safeParse(typeof code === "string" ? code : null);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message ?? "Check the diagnosis code.");
  return attempt("healthcode.invoice_diagnosis_set", async () => {
    const inv = await invoiceInScope(actor, invoiceId);
    if (!inv) return fail("not_found", BILLING_NOT_FOUND);
    if (inv.billTo !== "payer") return fail("invalid", "Only an invoice to an insurer or other payer account carries a diagnosis code.");
    const r = await setInvoiceDiagnosis(actor.repo(), actor.tenantId, inv.id, parsed.data ?? null, actor.actor);
    if (!r.ok) return fail("invalid", "This invoice can no longer be changed (it is cancelled or voided).");
    return ok({ code: r.code });
  });
}

/** The Healthcode panel of an insurer invoice (null for a patient invoice). */
export async function invoiceHealthcodeFor(actor: BillingActor, invoiceId: string): Promise<Result<InvoiceHealthcodeView | null>> {
  if (!actor.can("billing.view")) return forbidden();
  return attempt("healthcode.invoice", async () => {
    const inv = await invoiceInScope(actor, invoiceId);
    if (!inv) return fail("not_found", BILLING_NOT_FOUND);
    if (inv.billTo !== "payer") return ok(null);
    const clinical = actor.can("clinical.view");
    const caseCode = clinical && inv.caseId ? ((await caseDiagnoses(actor.repo(), actor.tenantId, [inv.caseId])).get(inv.caseId) ?? null) : null;
    return ok({
      invoiceId: inv.id,
      showDiagnosis: clinical,
      diagnosisCode: clinical ? inv.diagnosisCode : null,
      caseDiagnosisCode: caseCode,
      canEditDiagnosis: clinical && actor.can("billing.edit") && inv.status !== "cancelled" && !inv.voidedAt,
    });
  });
}

/* ------------------------------------------------------------------------------------------------
 * HC12 – the claims page's Healthcode tab: insurer invoices, ready or needing review, and the export log
 * ----------------------------------------------------------------------------------------------*/

export const HEALTHCODE_MAX_CHECKED = 200;

const IsoDate = /^\d{4}-\d{2}-\d{2}$/;

function daysBefore(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** The facts the check needs for these issued insurer invoices (read in bulk; lines from each invoice). */
export async function healthcodeFactsFor(actor: BillingActor, invoices: readonly Invoice[], insurers: ReadonlyMap<string, { id: string; name: string }>): Promise<{ facts: HealthcodeInvoiceFacts[]; patientNames: Map<string, string> }> {
  const ctx = actor.repo();
  const t = actor.tenantId;
  const patientIds = Array.from(new Set(invoices.map((i) => i.patientId)));
  const caseIds = Array.from(new Set(invoices.map((i) => i.caseId).filter((c): c is string => !!c)));
  const authIds = Array.from(new Set(invoices.map((i) => i.authorisationId).filter((a): a is string => !!a)));
  const payerIds = Array.from(new Set(invoices.map((i) => i.payerReferrerId).filter((p): p is string => !!p)));
  const pracIds = Array.from(new Set(invoices.flatMap((i) => i.lines.map((l) => l.practitionerId)).filter((p): p is string => !!p)));
  const [patients, cases, auths, payerHc, settings, pracNumbers, isc, services, practitioners, caseDx] = await Promise.all([
    patientIds.length ? ctx.db.selectFrom("pms_patients").select(["id", "first_name", "last_name", "preferred_name", "date_of_birth", "postcode"]).where("tenant_id", "=", t).where("id", "in", patientIds).execute() : Promise.resolve([]),
    caseIds.length ? ctx.db.selectFrom("pms_cases").select(["id", "membership_number"]).where("tenant_id", "=", t).where("id", "in", caseIds).execute() : Promise.resolve([]),
    Promise.all(authIds.map((id) => getAuthorisation(ctx, t, id))),
    payerHealthcodes(ctx, t, payerIds),
    getHealthcodeSettings(ctx, t),
    practitionerInsurerNumbers(ctx, t, pracIds),
    serviceInsurerCodes(ctx, t, payerIds),
    listServices(ctx, t, { includeInactive: true }),
    listPractitioners(ctx, t, { includeInactive: true }),
    caseDiagnoses(ctx, t, caseIds),
  ]);
  const patientById = new Map(patients.map((p) => [p.id, p]));
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const authById = new Map(auths.filter((a): a is NonNullable<typeof a> => !!a).map((a) => [a.id, a]));
  const serviceName = new Map(services.map((s) => [s.id, s.name]));
  const pracName = new Map(practitioners.map((p) => [p.id, p.displayName]));
  const patientNames = new Map<string, string>();
  const facts = invoices.map((inv): HealthcodeInvoiceFacts => {
    const p = patientById.get(inv.patientId);
    if (p) patientNames.set(p.id, `${p.preferred_name || p.first_name} ${p.last_name}`.trim());
    const insurer = inv.payerReferrerId ? insurers.get(inv.payerReferrerId) : undefined;
    const hc = insurer ? payerHc.get(insurer.id) : undefined;
    const a = inv.authorisationId ? authById.get(inv.authorisationId) : undefined;
    const site = healthcodeForSite(settings, inv.siteId);
    return {
      invoiceId: inv.id,
      number: inv.number,
      status: inv.status,
      voided: !!inv.voidedAt,
      billTo: inv.billTo,
      patientId: inv.patientId,
      caseId: inv.caseId,
      siteId: inv.siteId,
      patient: { firstName: p?.first_name ?? null, lastName: p?.last_name ?? null, dateOfBirth: p?.date_of_birth ?? null, postcode: p?.postcode ?? null },
      membershipNumber: inv.caseId ? (caseById.get(inv.caseId)?.membership_number ?? null) : null,
      authorisation: a ? { code: a.code, status: a.status, validFrom: a.validFrom, expiresOn: a.expiresOn, sessionsAuthorised: a.sessionsAuthorised, sessionsUsed: a.sessionsUsed } : null,
      diagnosisCode: inv.diagnosisCode ?? (inv.caseId ? (caseDx.get(inv.caseId) ?? null) : null),
      payer: insurer ? { id: insurer.id, name: insurer.name, insurerCode: hc?.insurerCode ?? null, providerNumber: hc?.providerNumber ?? null, diagnosisRequired: diagnosisRequired(insurer.name, hc?.diagnosisRequired) } : null,
      siteCode: site.siteCode,
      payeeProviderNumber: site.payeeProviderNumber,
      lines: inv.lines.map((l) => ({
        id: l.id,
        lineNo: l.lineNo,
        kind: l.kind,
        serviceId: l.serviceId,
        serviceName: l.serviceId ? (serviceName.get(l.serviceId) ?? null) : null,
        serviceOn: l.serviceOn,
        practitionerId: l.practitionerId,
        practitionerName: l.practitionerId ? (pracName.get(l.practitionerId) ?? null) : null,
        practitionerNumber: l.practitionerId && insurer ? (pracNumbers.get(pairKey(l.practitionerId, insurer.id))?.providerNumber ?? null) : null,
        iscCode: l.serviceId && insurer ? (isc.get(pairKey(l.serviceId, insurer.id))?.iscCode ?? null) : null,
      })),
    };
  });
  return { facts, patientNames };
}

/** The Healthcode tab (billing.view): issued insurer invoices in the dates, checked; the export log. */
export async function healthcodeClaimsFor(actor: BillingActor, input: { payerReferrerId?: string; from?: string; until?: string } = {}): Promise<Result<HealthcodeClaimsView>> {
  if (!actor.can("billing.view")) return forbidden();
  return attempt("healthcode.claims", async () => {
    const ctx = actor.repo();
    const t = actor.tenantId;
    const today = ukToday(ctx.now ? ctx.now() : new Date());
    const from = input.from && IsoDate.test(input.from) ? input.from : daysBefore(today, 90);
    const until = input.until && IsoDate.test(input.until) ? input.until : today;
    if (from > until) return fail("invalid", "The start date is after the end date.");
    const insurerList = await listReferrers(ctx, t, { kind: "insurer", includeInactive: true, limit: 500 });
    const insurers = new Map(insurerList.map((r) => [r.id, { id: r.id, name: r.name }]));
    const payerReferrerId = input.payerReferrerId && insurers.has(input.payerReferrerId) ? input.payerReferrerId : null;
    const summaries = [];
    for (let offset = 0; offset < 2000; offset += 200) {
      const page = await listInvoicesPage(ctx, t, { state: "all", billTo: "payer", ...(payerReferrerId ? { payerReferrerId } : {}), from, until, siteIds: actor.siteIds ?? null, limit: 200, offset });
      summaries.push(...page.rows);
      if (page.rows.length < 200) break;
    }
    const chosen = summaries
      .filter((i) => i.status === "issued" && i.number && !i.voidedAt && i.payerReferrerId && insurers.has(i.payerReferrerId))
      .sort((a, b) => (a.issuedOn ?? "").localeCompare(b.issuedOn ?? "") || (a.numberSeq ?? 0) - (b.numberSeq ?? 0));
    const truncated = chosen.length > HEALTHCODE_MAX_CHECKED;
    const invoices = (await Promise.all(chosen.slice(0, HEALTHCODE_MAX_CHECKED).map((i) => getInvoice(ctx, t, i.id)))).filter((i): i is Invoice => !!i);
    const { facts, patientNames } = await healthcodeFactsFor(actor, invoices, insurers);
    const batch = checkHealthcodeBatch(facts);
    const byId = new Map(facts.map((f) => [f.invoiceId, f]));
    const invById = new Map(invoices.map((i) => [i.id, i]));
    const row = (c: HealthcodeCheck): HealthcodeClaimRow => {
      const f = byId.get(c.invoiceId) as HealthcodeInvoiceFacts;
      const inv = invById.get(c.invoiceId) as Invoice;
      return {
        invoiceId: inv.id,
        number: inv.number as string,
        issuedOn: inv.issuedOn as string,
        patientName: patientNames.get(inv.patientId) ?? "Patient",
        payerName: f.payer?.name ?? "Insurer",
        totalPence: inv.totalPence,
        siteCode: f.siteCode,
        issues: c.issues.map((i) => ({ message: i.message, fix: i.fix })),
      };
    };
    const batches = await listExportBatches(ctx, t, { limit: 20 });
    return ok({
      payers: insurerList.filter((r) => r.active || r.id === payerReferrerId).map((r) => ({ id: r.id, name: r.name })),
      query: { payerReferrerId, from, until },
      ready: batch.ready.map(row),
      needsReview: batch.needsReview.map(row),
      notes: batch.notes,
      truncated,
      batches: batches.map((b) => ({ ...b, channelLabel: b.channel in EXPORT_CHANNEL_INFO ? EXPORT_CHANNEL_INFO[b.channel as keyof typeof EXPORT_CHANNEL_INFO].label : b.channel })),
      fileEnabled: HEALTHCODE_FILE_SUBMISSION_ENABLED,
      fileNote: HEALTHCODE_FILE_OFF_NOTE,
    });
  });
}
