/**
 * Healthcode e-billing groundwork – the server layer of the insurer-bill screens (docs/clinic-system/healthcode.md):
 * diagnosis codes on cases and insurer invoices (HC10). Same rules as the billing services (./access.ts): the
 * permission first, ids read back from the member's clinic and site scope, inputs validated, plain results.
 *
 * A diagnosis is clinical: reading it needs clinical.view, changing it clinical.view plus patients.edit (a case) or
 * billing.edit (an invoice).
 */
import "server-only";
import type { InvoiceHealthcodeView } from "../../../modules/pms/billing/healthcode";
import { OptionalIcd10Schema } from "../../../modules/pms/billing/icd10";
import { getCase } from "../../repos/pms/cases";
import { caseDiagnoses, setCaseDiagnosis, setInvoiceDiagnosis } from "../../repos/pms/billing/healthcode";
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
