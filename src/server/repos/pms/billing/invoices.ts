/**
 * Invoices (`pms_invoices`) and their lines (`pms_invoice_lines`).
 *
 * Life of an invoice: DRAFT (lines can change, no number) → ISSUED (numbered, frozen; paid / part paid / overdue /
 * credited follow from payments and credit notes) – or a draft is CANCELLED. Nothing is deleted; the one exception
 * is a draft's own lines, which an edit replaces.
 *
 * - Bill to the patient, or to the case's payer account (insurer, MLC, solicitor, employer…). An insurer case with
 *   an excess can be split: the patient's share goes on its own invoice and is taken off the insurer's.
 * - Prices: given per line (the form fills them from the case's price list: payer list → default list → the
 *   appointment type's own price). VAT: none when the clinic is not VAT-registered; otherwise each line's code
 *   (default: the appointment type's, else exempt), worked out per line (src/modules/pms/billing/vat.ts).
 * - One active line per diary appointment (the database's billing_lock index): a cancelled draft or a fully
 *   credited line releases it.
 * - Numbers are given when the invoice is issued, by the database, in the issuing statement (gap-free).
 * - Line descriptions, the diagnosis code, notes and the bill-to snapshot are encrypted; lists never decrypt.
 */
import { sql, type RawBuilder, type Selectable } from "kysely";
import { EXCESS_DEDUCTION_TEXT, EXCESS_LINE_TEXT, splitExcess } from "../../../../modules/pms/billing/excess";
import { BILLING_ID_PREFIXES as P } from "../../../../modules/pms/billing/ids";
import { parseDocumentNumber } from "../../../../modules/pms/billing/numbers";
import {
  InvoiceDraftInputSchema,
  InvoiceDraftPatchSchema,
  IssueInvoiceInputSchema,
  type InvoiceDraftInput,
  type InvoiceDraftPatch,
  type IssueInvoiceInput,
  type ParsedInvoiceLine,
} from "../../../../modules/pms/billing/schemas";
import { dueDate } from "../../../../modules/pms/billing/status";
import type { BillTo, BillToSnapshot, BillingSettings, Invoice, InvoiceSummary } from "../../../../modules/pms/billing/types";
import { VAT_RATES_BP, lineAmounts, sumTotals, type VatCode } from "../../../../modules/pms/billing/vat";
import { formatUkDate } from "../../../../modules/pms/core/text";
import type { PayerType, PmsActor } from "../../../../modules/pms/core/types";
import { runBatch, type BatchQuery } from "../../../db/batch";
import type { PmsInvoicesTable } from "../../../db/pms-schema/billing";
import { recordAuthorisationUsage } from "../cases";
import { RepoInputError, assertId, assertTenantId, decryptField, encryptField, nowIso, num, numOrNull, parseInput, parseLines, pmsAudit, pmsAuditQuery, pmsId, translateDbError, type RepoContext } from "../context";
import { ensureSettingsQuery, getBillingSettings } from "./settings";
import { INV, LINES, PAY, SUMMARY_COLUMNS, affected, billingAuditWhen, billingBatch, chunks, editToken, isUniqueRefusal, todayOf, toInvoiceLine, toInvoiceSummary } from "./shared";

const MESSAGES = {
  unique: "An appointment on this invoice is already on another invoice (or the import reference is taken).",
  foreignKey: "The patient, case, payer, appointment type, practitioner or authorisation does not exist in this clinic.",
  check: "An amount on the invoice is outside what is allowed.",
};

/* ------------------------------------------------------------------------------------------------
 * What a draft needs to know: the patient, the case and its payer, prices, VAT
 * ----------------------------------------------------------------------------------------------*/

interface CaseFacts {
  id: string;
  patientId: string;
  payerType: PayerType;
  payerReferrerId: string | null;
  priceListId: string | null;
  excessPence: number | null;
  membershipNumber: string | null;
  claimReference: string | null;
}

async function caseFacts(ctx: RepoContext, tenantId: string, caseId: string): Promise<CaseFacts | null> {
  const r = await ctx.db
    .selectFrom("pms_cases")
    .select(["id", "patient_id", "payer_type", "payer_referrer_id", "price_list_id", "excess_pence", "membership_number", "claim_reference"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", caseId)
    .executeTakeFirst();
  if (!r) return null;
  return {
    id: r.id,
    patientId: r.patient_id,
    payerType: r.payer_type as PayerType,
    payerReferrerId: r.payer_referrer_id,
    priceListId: r.price_list_id,
    excessPence: numOrNull(r.excess_pence),
    membershipNumber: r.membership_number,
    claimReference: r.claim_reference,
  };
}

interface PreparedLine {
  id: string;
  lineNo: number;
  kind: ParsedInvoiceLine["kind"] & string;
  serviceId: string | null;
  appointmentId: string | null;
  visitStatus: string | null;
  practitionerId: string | null;
  serviceOn: string | null;
  description: string | null;
  billingCode: string | null;
  quantity: number;
  unitPricePence: number;
  discountPence: number;
  vatCode: VatCode;
  vatRateBp: number;
  netPence: number;
  vatPence: number;
  totalPence: number;
}

/** Names of the appointment types used, and the payer's billing codes from the case's price list. */
async function lineLookups(ctx: RepoContext, tenantId: string, serviceIds: string[], priceListId: string | null) {
  const names = new Map<string, string>();
  const codes = new Map<string, string>();
  for (const group of chunks(Array.from(new Set(serviceIds)))) {
    if (group.length === 0) continue;
    const rows = await ctx.db.selectFrom("pms_services").select(["id", "name"]).where("tenant_id", "=", tenantId).where("id", "in", group).execute();
    for (const r of rows) names.set(r.id, r.name);
    if (priceListId) {
      const items = await ctx.db
        .selectFrom("pms_price_list_items")
        .select(["service_id", "billing_code"])
        .where("tenant_id", "=", tenantId)
        .where("price_list_id", "=", priceListId)
        .where("service_id", "in", group)
        .execute();
      for (const i of items) if (i.billing_code) codes.set(i.service_id, i.billing_code);
    }
  }
  return { names, codes };
}

function vatFor(settings: BillingSettings, kind: string, serviceId: string | null, asked: VatCode | undefined): VatCode {
  if (!settings.vatRegistered) return "none";
  if (kind === "excess" || kind === "excess_deduction") return "exempt";
  const code = asked ?? (serviceId ? settings.serviceVat[serviceId] : undefined) ?? "exempt";
  return code === "none" ? "exempt" : code;
}

async function prepareLines(ctx: RepoContext, tenantId: string, lines: ParsedInvoiceLine[], settings: BillingSettings, priceListId: string | null): Promise<PreparedLine[]> {
  const serviceIds = lines.map((l) => l.serviceId).filter((s): s is string => typeof s === "string");
  const { names, codes } = await lineLookups(ctx, tenantId, serviceIds, priceListId);
  return lines.map((l, i) => {
    const kind = l.kind ?? "service";
    if (l.serviceId && !names.has(l.serviceId)) throw new RepoInputError(`Line ${i + 1}: that appointment type does not exist in this clinic.`);
    const description = l.description ?? (l.serviceId ? (names.get(l.serviceId) ?? null) : kind === "excess" ? EXCESS_LINE_TEXT : kind === "excess_deduction" ? EXCESS_DEDUCTION_TEXT : null);
    if (!description) throw new RepoInputError(`Line ${i + 1}: describe the item.`);
    const vatCode = vatFor(settings, kind, l.serviceId ?? null, l.vatCode);
    const vatRateBp = VAT_RATES_BP[vatCode];
    const quantity = l.quantity ?? 1;
    const discountPence = l.discountPence ?? 0;
    const amounts = lineAmounts({ unitPricePence: l.unitPricePence, quantity, discountPence, vatRateBp, pricesIncludeVat: settings.pricesIncludeVat });
    return {
      id: "",
      lineNo: i + 1,
      kind,
      serviceId: l.serviceId ?? null,
      appointmentId: l.appointmentId ?? null,
      visitStatus: l.visitStatus ?? null,
      practitionerId: l.practitionerId ?? null,
      serviceOn: l.serviceOn ?? null,
      description,
      billingCode: l.billingCode ?? (l.serviceId ? (codes.get(l.serviceId) ?? null) : null),
      quantity,
      unitPricePence: l.unitPricePence,
      discountPence,
      vatCode,
      vatRateBp,
      netPence: amounts.netPence,
      vatPence: amounts.vatPence,
      totalPence: amounts.totalPence,
    };
  });
}

function serviceDates(lines: PreparedLine[]): { first: string | null; last: string | null } {
  const dates = lines.map((l) => l.serviceOn).filter((d): d is string => typeof d === "string").sort();
  return { first: dates[0] ?? null, last: dates[dates.length - 1] ?? null };
}

function lineInsert(ctx: RepoContext, tenantId: string, invoiceId: string | RawBuilder<string>, l: PreparedLine, at: string) {
  return ctx.db.insertInto(LINES).values({
    tenant_id: tenantId,
    id: l.id,
    invoice_id: invoiceId,
    line_no: l.lineNo,
    kind: l.kind,
    service_id: l.serviceId,
    appointment_id: l.appointmentId,
    visit_status: l.visitStatus,
    practitioner_id: l.practitionerId,
    service_on: l.serviceOn,
    description_enc: encryptField(ctx, tenantId, LINES, "description_enc", l.id, l.description),
    billing_code: l.billingCode,
    quantity: l.quantity,
    unit_price_pence: l.unitPricePence,
    discount_pence: l.discountPence,
    vat_code: l.vatCode,
    vat_rate_bp: l.vatRateBp,
    net_pence: l.netPence,
    vat_pence: l.vatPence,
    total_pence: l.totalPence,
    credited_pence: 0,
    billing_lock: 1,
    created_at: at,
    updated_at: at,
  });
}

/** Appointment ids (of these) already on an active invoice line. */
export async function billedAppointmentIds(ctx: RepoContext, tenantId: string, appointmentIds: string[]): Promise<Set<string>> {
  assertTenantId(tenantId);
  const out = new Set<string>();
  for (const group of chunks(Array.from(new Set(appointmentIds)))) {
    if (group.length === 0) continue;
    const rows = await ctx.db
      .selectFrom(LINES)
      .select("appointment_id")
      .where("tenant_id", "=", tenantId)
      .where("billing_lock", "=", 1)
      .where("appointment_id", "in", group)
      .execute();
    for (const r of rows) if (r.appointment_id) out.add(r.appointment_id);
  }
  return out;
}

/** Excess already billed to the patient on a case (excess lines of draft or issued invoices, less credits). */
export async function excessBilledForCase(ctx: RepoContext, tenantId: string, caseId: string, excludeInvoiceId?: string): Promise<number> {
  assertTenantId(tenantId);
  let q = ctx.db
    .selectFrom("pms_invoice_lines as l")
    .innerJoin("pms_invoices as i", (j) => j.onRef("i.tenant_id", "=", "l.tenant_id").onRef("i.id", "=", "l.invoice_id"))
    .select((eb) => eb.fn.coalesce(eb.fn.sum<number>(sql<number>`l.total_pence - l.credited_pence`), sql<number>`0`).as("n"))
    .where("l.tenant_id", "=", tenantId)
    .where("i.case_id", "=", caseId)
    .where("l.kind", "=", "excess")
    .where("i.status", "in", ["draft", "issued"]);
  if (excludeInvoiceId) q = q.where("i.id", "<>", excludeInvoiceId);
  const row = await q.executeTakeFirst();
  return num(row?.n ?? 0);
}

/* ------------------------------------------------------------------------------------------------
 * Create a draft (optionally with the excess split)
 * ----------------------------------------------------------------------------------------------*/

export interface CreateDraftOptions {
  /** For a payer invoice on a case with an excess: bill the excess not billed yet to the patient. */
  applyExcess?: boolean;
}

export interface CreateDraftResult {
  invoice: Invoice;
  /** The patient's excess invoice (a draft), when the excess was split. */
  excessInvoice: Invoice | null;
}

function invoiceValues(
  ctx: RepoContext,
  tenantId: string,
  id: string,
  v: {
    patientId: string;
    caseId: string | null;
    siteId: string | null;
    billTo: BillTo;
    payerType: PayerType;
    payerReferrerId: string | null;
    authorisationId: string | null;
    relatedInvoiceId: string | null;
    lines: PreparedLine[];
    pricesIncludeVat: boolean;
    diagnosisCode: string | null;
    notes: string | null;
    importRef: string | null;
  },
  actor: PmsActor,
  at: string,
) {
  const totals = sumTotals(v.lines);
  if (totals.totalPence < 0) throw new RepoInputError("The invoice comes to less than nothing.");
  const dates = serviceDates(v.lines);
  return {
    tenant_id: tenantId,
    id,
    rev: 1,
    status: "draft",
    patient_id: v.patientId,
    case_id: v.caseId,
    site_id: v.siteId,
    bill_to: v.billTo,
    payer_type: v.payerType,
    payer_referrer_id: v.payerReferrerId,
    authorisation_id: v.authorisationId,
    related_invoice_id: v.relatedInvoiceId,
    first_service_on: dates.first,
    last_service_on: dates.last,
    net_pence: totals.netPence,
    vat_pence: totals.vatPence,
    total_pence: totals.totalPence,
    prices_include_vat: v.pricesIncludeVat ? 1 : 0,
    diagnosis_enc: encryptField(ctx, tenantId, INV, "diagnosis_enc", id, v.diagnosisCode),
    notes_enc: encryptField(ctx, tenantId, INV, "notes_enc", id, v.notes),
    import_ref: v.importRef,
    created_by: actor.userId,
    created_at: at,
    updated_at: at,
  };
}

async function checkAuthorisation(ctx: RepoContext, tenantId: string, authorisationId: string | null | undefined, caseId: string | null): Promise<void> {
  if (!authorisationId) return;
  const a = await ctx.db.selectFrom("pms_authorisations").select(["case_id", "status"]).where("tenant_id", "=", tenantId).where("id", "=", authorisationId).executeTakeFirst();
  if (!a) throw new RepoInputError("That authorisation does not exist in this clinic.");
  if (a.case_id !== caseId) throw new RepoInputError("That authorisation belongs to another case.");
  if (a.status !== "active") throw new RepoInputError("That authorisation has been cancelled.");
}

export async function createDraftInvoice(ctx: RepoContext, tenantId: string, input: InvoiceDraftInput, actor: PmsActor, options: CreateDraftOptions = {}): Promise<CreateDraftResult> {
  assertTenantId(tenantId);
  const d = parseInput(InvoiceDraftInputSchema, input, "Invoice");
  const billTo: BillTo = d.billTo ?? "patient";
  const settings = await getBillingSettings(ctx, tenantId);
  const patient = await ctx.db.selectFrom("pms_patients").select("id").where("tenant_id", "=", tenantId).where("id", "=", d.patientId).executeTakeFirst();
  if (!patient) throw new RepoInputError("That patient does not exist in this clinic.");
  const theCase = d.caseId ? await caseFacts(ctx, tenantId, d.caseId) : null;
  if (d.caseId && (!theCase || theCase.patientId !== d.patientId)) throw new RepoInputError("That case is not one of this patient's cases.");
  if (billTo === "payer" && (!theCase?.payerReferrerId || theCase.payerType === "self_pay")) throw new RepoInputError("This case has no payer account to bill. Bill the patient, or add the payer to the case.");
  await checkAuthorisation(ctx, tenantId, d.authorisationId, d.caseId ?? null);
  if (d.siteId) {
    const site = await ctx.db.selectFrom("pms_sites").select("id").where("tenant_id", "=", tenantId).where("id", "=", d.siteId).executeTakeFirst();
    if (!site) throw new RepoInputError("That site does not exist in this clinic.");
  }
  const appts = d.lines.map((l) => l.appointmentId).filter((a): a is string => typeof a === "string");
  if (appts.length && (await billedAppointmentIds(ctx, tenantId, appts)).size > 0) throw new RepoInputError("An appointment on this invoice is already on another invoice.");

  const lines = await prepareLines(ctx, tenantId, d.lines, settings, theCase?.priceListId ?? null);
  const at = nowIso(ctx);
  const id = pmsId(P.invoice, ctx);
  const payerType: PayerType = billTo === "payer" && theCase ? theCase.payerType : "self_pay";

  let excess: { id: string; line: PreparedLine } | null = null;
  if (options.applyExcess && billTo === "payer" && theCase && (theCase.excessPence ?? 0) > 0) {
    const already = await excessBilledForCase(ctx, tenantId, theCase.id);
    const split = splitExcess({ payerTotalPence: sumTotals(lines).totalPence, excessPence: theCase.excessPence, excessAlreadyBilledPence: already });
    if (split.patientPence > 0) {
      if (lines.some((l) => l.vatPence !== 0)) throw new RepoInputError("The excess can be split only on VAT-free treatment. Bill the excess by hand.");
      const vatCode: VatCode = settings.vatRegistered ? "exempt" : "none";
      lines.push({
        id: "",
        lineNo: lines.length + 1,
        kind: "excess_deduction",
        serviceId: null,
        appointmentId: null,
        visitStatus: null,
        practitionerId: null,
        serviceOn: null,
        description: EXCESS_DEDUCTION_TEXT,
        billingCode: null,
        quantity: 1,
        unitPricePence: -split.patientPence,
        discountPence: 0,
        vatCode,
        vatRateBp: 0,
        netPence: -split.patientPence,
        vatPence: 0,
        totalPence: -split.patientPence,
      });
      excess = {
        id: pmsId(P.invoice, ctx),
        line: {
          id: "",
          lineNo: 1,
          kind: "excess",
          serviceId: null,
          appointmentId: null,
          visitStatus: null,
          practitionerId: null,
          serviceOn: serviceDates(lines).first,
          description: EXCESS_LINE_TEXT,
          billingCode: null,
          quantity: 1,
          unitPricePence: split.patientPence,
          discountPence: 0,
          vatCode,
          vatRateBp: 0,
          netPence: split.patientPence,
          vatPence: 0,
          totalPence: split.patientPence,
        },
      };
    }
  }
  for (const l of lines) l.id = pmsId(P.invoiceLine, ctx);
  if (excess) excess.line.id = pmsId(P.invoiceLine, ctx);

  const common = { patientId: d.patientId, caseId: d.caseId ?? null, siteId: d.siteId ?? null, pricesIncludeVat: settings.pricesIncludeVat };
  const queries: BatchQuery[] = [];
  if (excess) {
    queries.push(
      ctx.db.insertInto(INV).values(
        invoiceValues(
          ctx,
          tenantId,
          excess.id,
          { ...common, billTo: "patient", payerType: "self_pay", payerReferrerId: null, authorisationId: null, relatedInvoiceId: null, lines: [excess.line], diagnosisCode: null, notes: null, importRef: null },
          actor,
          at,
        ),
      ),
      lineInsert(ctx, tenantId, excess.id, excess.line, at),
    );
  }
  queries.push(
    ctx.db.insertInto(INV).values(
      invoiceValues(
        ctx,
        tenantId,
        id,
        {
          ...common,
          billTo,
          payerType,
          payerReferrerId: billTo === "payer" ? (theCase?.payerReferrerId ?? null) : null,
          authorisationId: d.authorisationId ?? null,
          relatedInvoiceId: excess?.id ?? null,
          lines,
          diagnosisCode: d.diagnosisCode ?? null,
          notes: d.notes ?? null,
          importRef: d.importRef ?? null,
        },
        actor,
        at,
      ),
    ),
    ...lines.map((l) => lineInsert(ctx, tenantId, id, l, at)),
  );
  if (excess) queries.push(ctx.db.updateTable(INV).set({ related_invoice_id: id }).where("tenant_id", "=", tenantId).where("id", "=", excess.id));
  queries.push(pmsAuditQuery(ctx, tenantId, actor, { action: "pms.invoice.create", targetType: "pms_invoice", targetId: id, detail: { billTo, lines: lines.length, ...(excess ? { excessInvoiceId: excess.id } : {}) } }));
  if (excess) queries.push(pmsAuditQuery(ctx, tenantId, actor, { action: "pms.invoice.excess_split", targetType: "pms_invoice", targetId: excess.id, detail: { payerInvoiceId: id } }));
  await billingBatch(ctx, queries, MESSAGES);
  return { invoice: (await getInvoice(ctx, tenantId, id)) as Invoice, excessInvoice: excess ? await getInvoice(ctx, tenantId, excess.id) : null };
}

/* ------------------------------------------------------------------------------------------------
 * Edit or cancel a draft
 * ----------------------------------------------------------------------------------------------*/

export type DraftSaveResult = { ok: true; rev: number } | { ok: false; reason: "conflict"; currentRev: number } | { ok: false; reason: "not_found" | "not_draft" };

async function draftState(ctx: RepoContext, tenantId: string, id: string): Promise<DraftSaveResult | null> {
  const row = await ctx.db.selectFrom(INV).select(["rev", "status"]).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status !== "draft") return { ok: false, reason: "not_draft" };
  return { ok: false, reason: "conflict", currentRev: num(row.rev) };
}

/** Changes a draft (its lines are replaced when given). Optimistic: `expectedRev` must match. */
export async function updateDraftInvoice(ctx: RepoContext, tenantId: string, id: string, expectedRev: number, patch: InvoiceDraftPatch, actor: PmsActor): Promise<DraftSaveResult> {
  assertTenantId(tenantId);
  assertId(id, "invoice id");
  const d = parseInput(InvoiceDraftPatchSchema, patch, "Invoice");
  const current = await ctx.db.selectFrom(INV).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  if (!current) return { ok: false, reason: "not_found" };
  if (current.status !== "draft") return { ok: false, reason: "not_draft" };
  if (num(current.rev) !== expectedRev) return { ok: false, reason: "conflict", currentRev: num(current.rev) };
  const caseId = current.case_id;
  if (d.authorisationId !== undefined) await checkAuthorisation(ctx, tenantId, d.authorisationId, caseId);
  const at = nowIso(ctx);
  const token = editToken();
  const set: Record<string, unknown> = { rev: expectedRev + 1, edit_token: token, updated_at: at };
  const fields: string[] = [];
  if (d.authorisationId !== undefined) {
    set.authorisation_id = d.authorisationId;
    fields.push("authorisationId");
  }
  if (d.diagnosisCode !== undefined) {
    set.diagnosis_enc = encryptField(ctx, tenantId, INV, "diagnosis_enc", id, d.diagnosisCode);
    fields.push("diagnosisCode");
  }
  if (d.notes !== undefined) {
    set.notes_enc = encryptField(ctx, tenantId, INV, "notes_enc", id, d.notes);
    fields.push("notes");
  }
  let lines: PreparedLine[] | null = null;
  if (d.lines) {
    if (current.bill_to === "payer" && d.lines.some((l) => l.kind === "excess")) throw new RepoInputError("An excess line goes on the patient's invoice.");
    const appts = d.lines.map((l) => l.appointmentId).filter((a): a is string => typeof a === "string");
    if (appts.length) {
      const mine = new Set((await ctx.db.selectFrom(LINES).select("appointment_id").where("tenant_id", "=", tenantId).where("invoice_id", "=", id).execute()).map((r) => r.appointment_id));
      const taken = Array.from(await billedAppointmentIds(ctx, tenantId, appts)).filter((a) => !mine.has(a));
      if (taken.length) throw new RepoInputError("An appointment on this invoice is already on another invoice.");
    }
    const settings = await getBillingSettings(ctx, tenantId);
    const theCase = caseId ? await caseFacts(ctx, tenantId, caseId) : null;
    lines = await prepareLines(ctx, tenantId, d.lines, { ...settings, pricesIncludeVat: num(current.prices_include_vat) === 1 }, theCase?.priceListId ?? null);
    for (const l of lines) l.id = pmsId(P.invoiceLine, ctx);
    const totals = sumTotals(lines);
    if (totals.totalPence < 0) throw new RepoInputError("The invoice comes to less than nothing.");
    const dates = serviceDates(lines);
    Object.assign(set, { net_pence: totals.netPence, vat_pence: totals.vatPence, total_pence: totals.totalPence, first_service_on: dates.first, last_service_on: dates.last });
    fields.push("lines");
  }
  if (fields.length === 0) return { ok: true, rev: expectedRev };
  // Statement 1 applies only to the expected revision; every later statement checks statement 1's token, so a
  // stale edit changes nothing (its line inserts get a NULL invoice id and the batch is refused).
  const mineNow = sql<string>`(select id from pms_invoices where tenant_id = ${tenantId} and id = ${id} and edit_token = ${token} and status = 'draft')`;
  const queries: BatchQuery[] = [ctx.db.updateTable(INV).set(set).where("tenant_id", "=", tenantId).where("id", "=", id).where("rev", "=", expectedRev).where("status", "=", "draft")];
  if (lines) {
    queries.push(
      ctx.db
        .deleteFrom(LINES)
        .where("tenant_id", "=", tenantId)
        .where("invoice_id", "=", id)
        .where(sql<boolean>`exists ${mineNow}`),
    );
    for (const l of lines) queries.push(lineInsert(ctx, tenantId, mineNow, l, at));
  }
  queries.push(pmsAuditQuery(ctx, tenantId, actor, { action: "pms.invoice.update", targetType: "pms_invoice", targetId: id, detail: { fields, rev: expectedRev + 1 } }));
  try {
    const results = await billingBatch(ctx, queries, { ...MESSAGES, notNull: "stale" });
    if (affected(results[0]) === 0) return (await draftState(ctx, tenantId, id)) ?? { ok: false, reason: "not_found" };
  } catch (err) {
    if (err instanceof RepoInputError && err.message === "stale") return (await draftState(ctx, tenantId, id)) ?? { ok: false, reason: "not_found" };
    throw err;
  }
  return { ok: true, rev: expectedRev + 1 };
}

/** Cancels a draft (kept, never numbered) – and its excess partner if that is still a draft – releasing their appointments. */
export async function cancelDraftInvoice(ctx: RepoContext, tenantId: string, id: string, expectedRev: number, actor: PmsActor): Promise<DraftSaveResult> {
  assertTenantId(tenantId);
  assertId(id, "invoice id");
  const current = await ctx.db.selectFrom(INV).select(["status", "rev", "related_invoice_id"]).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  if (!current) return { ok: false, reason: "not_found" };
  if (current.status !== "draft") return { ok: false, reason: "not_draft" };
  if (num(current.rev) !== expectedRev) return { ok: false, reason: "conflict", currentRev: num(current.rev) };
  const at = nowIso(ctx);
  const ids = [id, ...(current.related_invoice_id ? [current.related_invoice_id] : [])];
  const queries: BatchQuery[] = [
    ctx.db.updateTable(INV).set({ status: "cancelled", cancelled_at: at, rev: expectedRev + 1, updated_at: at }).where("tenant_id", "=", tenantId).where("id", "=", id).where("rev", "=", expectedRev).where("status", "=", "draft"),
  ];
  if (current.related_invoice_id) {
    queries.push(
      ctx.db
        .updateTable(INV)
        .set((eb) => ({ status: "cancelled", cancelled_at: at, rev: eb("rev", "+", 1), updated_at: at }))
        .where("tenant_id", "=", tenantId)
        .where("id", "=", current.related_invoice_id)
        .where("status", "=", "draft")
        .where(sql<boolean>`exists (select 1 from pms_invoices where tenant_id = ${tenantId} and id = ${id} and status = 'cancelled' and cancelled_at = ${at})`),
    );
  }
  queries.push(
    ctx.db
      .updateTable(LINES)
      .set({ billing_lock: 0, updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("invoice_id", "in", ids)
      .where(sql<boolean>`exists (select 1 from pms_invoices i where i.tenant_id = ${tenantId} and i.id = pms_invoice_lines.invoice_id and i.status = 'cancelled')`),
    pmsAuditQuery(ctx, tenantId, actor, { action: "pms.invoice.cancel", targetType: "pms_invoice", targetId: id, detail: { rev: expectedRev + 1 } }),
  );
  const results = await billingBatch(ctx, queries, MESSAGES);
  if (affected(results[0]) === 0) return (await draftState(ctx, tenantId, id)) ?? { ok: false, reason: "not_found" };
  return { ok: true, rev: expectedRev + 1 };
}

/* ------------------------------------------------------------------------------------------------
 * Issue
 * ----------------------------------------------------------------------------------------------*/

export type IssueResult =
  | { ok: true; invoice: Invoice }
  | { ok: false; reason: "conflict"; currentRev: number }
  | { ok: false; reason: "not_found" | "not_draft" }
  | { ok: false; reason: "authorisation"; message: string };

async function billToSnapshot(ctx: RepoContext, tenantId: string, inv: Invoice): Promise<BillToSnapshot> {
  const p = await ctx.db
    .selectFrom("pms_patients")
    .select(["title", "first_name", "last_name", "patient_number", "date_of_birth", "address_json", "postcode", "email"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", inv.patientId)
    .executeTakeFirstOrThrow();
  const patientName = [p.title, p.first_name, p.last_name].filter(Boolean).join(" ");
  const theCase = inv.caseId ? await caseFacts(ctx, tenantId, inv.caseId) : null;
  const auth = inv.authorisationId
    ? await ctx.db.selectFrom("pms_authorisations").select("code").where("tenant_id", "=", tenantId).where("id", "=", inv.authorisationId).executeTakeFirst()
    : null;
  const references: { label: string; value: string }[] = [];
  if (inv.billTo === "payer") {
    references.push({ label: "Patient", value: `${patientName} (no. ${num(p.patient_number)})` });
    if (p.date_of_birth) references.push({ label: "Date of birth", value: formatUkDate(p.date_of_birth) });
  } else {
    references.push({ label: "Patient number", value: String(num(p.patient_number)) });
  }
  if (theCase?.membershipNumber && inv.billTo === "payer") references.push({ label: "Membership number", value: theCase.membershipNumber });
  if (theCase?.claimReference) references.push({ label: "Your reference", value: theCase.claimReference });
  if (auth?.code) references.push({ label: "Authorisation code", value: auth.code });
  if (inv.billTo === "payer" && inv.payerReferrerId) {
    const r = await ctx.db
      .selectFrom("pms_referrers")
      .select(["name", "contact_name", "address_json", "postcode", "email"])
      .where("tenant_id", "=", tenantId)
      .where("id", "=", inv.payerReferrerId)
      .executeTakeFirstOrThrow();
    return { name: r.name, attention: r.contact_name, address: parseLines(r.address_json), postcode: r.postcode, email: r.email, references };
  }
  return { name: patientName, attention: null, address: parseLines(p.address_json), postcode: p.postcode, email: p.email, references };
}

/**
 * Sessions an invoice uses on its authorisation: treatments added BY HAND only. A visit from the diary already
 * used its session when it was completed (the diary records it on the appointment's authorisation and gives it
 * back if the status is undone) – counting it again here would use two sessions for one visit. Did-not-attend
 * and late cancellation fees use none. The VALUE is always counted here (the diary counts no money).
 */
export function sessionsUsedBy(inv: Pick<Invoice, "lines">): number {
  return inv.lines.filter((l) => l.kind === "service" && l.appointmentId === null && (l.visitStatus === null || l.visitStatus === "attended")).reduce((a, l) => a + l.quantity, 0);
}

/**
 * Issues a draft: numbers it (the clinic's next number, in the same statement), freezes who it is addressed to,
 * sets the due date from the clinic's terms, and records the sessions and value it uses on its authorisation
 * (refused when that would go over what the insurer authorised).
 */
export async function issueInvoice(ctx: RepoContext, tenantId: string, id: string, expectedRev: number, input: IssueInvoiceInput, actor: PmsActor): Promise<IssueResult> {
  assertTenantId(tenantId);
  assertId(id, "invoice id");
  const d = parseInput(IssueInvoiceInputSchema, input, "Issue");
  const inv = await getInvoice(ctx, tenantId, id);
  if (!inv) return { ok: false, reason: "not_found" };
  if (inv.status !== "draft") return { ok: false, reason: "not_draft" };
  if (inv.rev !== expectedRev) return { ok: false, reason: "conflict", currentRev: inv.rev };
  const today = todayOf(ctx);
  const issuedOn = d.issuedOn ?? today;
  if (issuedOn > today) throw new RepoInputError("Issue: issuedOn: The invoice date cannot be in the future.");
  const settings = await getBillingSettings(ctx, tenantId);
  const dueOn = d.dueOn ?? dueDate(issuedOn, inv.billTo, settings);
  if (dueOn < issuedOn) throw new RepoInputError("Issue: dueOn: The due date is before the invoice date.");
  const snapshot = await billToSnapshot(ctx, tenantId, inv);

  const sessions = inv.authorisationId ? sessionsUsedBy(inv) : 0;
  const value = inv.authorisationId ? inv.totalPence : 0;
  let usageTaken = false;
  if (inv.authorisationId && (sessions > 0 || value > 0)) {
    const usage = await recordAuthorisationUsage(ctx, tenantId, inv.authorisationId, { sessions, valuePence: value }, actor, id);
    if (!usage.ok) {
      const message =
        usage.reason === "over_limit"
          ? "Issuing this invoice would go over what the insurer authorised (sessions or value). Change the lines, update the authorisation, or remove it from the invoice."
          : usage.reason === "not_active"
            ? "The authorisation on this invoice has been cancelled. Remove it or choose another."
            : "The authorisation on this invoice no longer exists.";
      return { ok: false, reason: "authorisation", message };
    }
    usageTaken = true;
  }

  const at = nowIso(ctx);
  const nextSeq = sql<number>`(select case when m.n + 1 > s.first_invoice_number then m.n + 1 else s.first_invoice_number end from pms_billing_settings s, (select coalesce(max(number_seq), 0) as n from pms_invoices where tenant_id = ${tenantId}) m where s.tenant_id = ${tenantId})`;
  const prefix = sql<string>`(select invoice_prefix from pms_billing_settings where tenant_id = ${tenantId})`;
  let issued = false;
  try {
    for (let attempt = 0; attempt < 4 && !issued; attempt++) {
      const token = editToken();
      const queries = [
        ensureSettingsQuery(ctx, tenantId, at),
        ctx.db
          .updateTable(INV)
          .set({
            status: "issued",
            number_seq: nextSeq,
            number_prefix: prefix,
            issued_on: issuedOn,
            due_on: dueOn,
            bill_to_enc: encryptField(ctx, tenantId, INV, "bill_to_enc", id, JSON.stringify(snapshot)),
            auth_sessions: usageTaken ? sessions : 0,
            auth_value_pence: usageTaken ? value : 0,
            issued_by: actor.userId,
            issued_at: at,
            edit_token: token,
            rev: expectedRev + 1,
            updated_at: at,
          })
          .where("tenant_id", "=", tenantId)
          .where("id", "=", id)
          .where("rev", "=", expectedRev)
          .where("status", "=", "draft"),
        // The audit row, written only when the issue above applied (its token is on the row).
        billingAuditWhen(
          ctx,
          tenantId,
          actor,
          { action: "pms.invoice.issue", targetType: "pms_invoice", targetId: id, detail: { rev: expectedRev + 1, ...(usageTaken ? { authorisationId: inv.authorisationId, sessions, valuePence: value } : {}) } },
          ctx.db.selectFrom(INV).select("id").where("tenant_id", "=", tenantId).where("id", "=", id).where("edit_token", "=", token).where("status", "=", "issued"),
        ),
      ];
      try {
        const results = await runBatch(ctx.db, queries);
        if (affected(results[1]) === 0) break;
        issued = true;
      } catch (err) {
        // Two issues at the same moment on Postgres can pick the same number: the unique index refuses one; try again.
        if (isUniqueRefusal(err) && attempt < 3) continue;
        throw translateDbError(err, { check: "The clinic has used every invoice number its prefix allows (999999). Change the prefix in the billing settings." });
      }
    }
  } finally {
    if (!issued && usageTaken && inv.authorisationId) {
      await recordAuthorisationUsage(ctx, tenantId, inv.authorisationId, { sessions: -sessions, valuePence: -value }, actor, id);
    }
  }
  if (!issued) return ((await draftState(ctx, tenantId, id)) as IssueResult | null) ?? { ok: false, reason: "not_found" };
  return { ok: true, invoice: (await getInvoice(ctx, tenantId, id)) as Invoice };
}

/* ------------------------------------------------------------------------------------------------
 * Read
 * ----------------------------------------------------------------------------------------------*/

function toInvoice(ctx: RepoContext, row: Selectable<PmsInvoicesTable>, lines: Invoice["lines"]): Invoice {
  const snapshotText = decryptField(ctx, row.tenant_id, INV, "bill_to_enc", row.id, row.bill_to_enc);
  let snapshot: BillToSnapshot | null = null;
  if (snapshotText) {
    try {
      snapshot = JSON.parse(snapshotText) as BillToSnapshot;
    } catch {
      snapshot = null;
    }
  }
  return {
    ...toInvoiceSummary(row),
    lines,
    diagnosisCode: decryptField(ctx, row.tenant_id, INV, "diagnosis_enc", row.id, row.diagnosis_enc),
    notes: decryptField(ctx, row.tenant_id, INV, "notes_enc", row.id, row.notes_enc),
    billToSnapshot: snapshot,
    pricesIncludeVat: num(row.prices_include_vat) === 1,
    issuedAt: row.issued_at,
    issuedBy: row.issued_by,
    authSessions: num(row.auth_sessions),
    authValuePence: num(row.auth_value_pence),
    importRef: row.import_ref,
    createdBy: row.created_by,
  };
}

/** One invoice with its lines, decrypted. */
export async function getInvoice(ctx: RepoContext, tenantId: string, id: string): Promise<Invoice | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom(INV).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  if (!row) return null;
  const lines = await ctx.db.selectFrom(LINES).selectAll().where("tenant_id", "=", tenantId).where("invoice_id", "=", id).orderBy("line_no").limit(100).execute();
  return toInvoice(ctx, row, lines.map((l) => toInvoiceLine(ctx, l)));
}

/**
 * The list's status chips (design round 2c): all, draft, issued (nothing paid, not overdue), part-paid, paid,
 * overdue, void – plus "outstanding" (anything owed), credited, refund due and cancelled drafts.
 */
export const INVOICE_LIST_STATES = ["all", "draft", "issued", "part_paid", "paid", "overdue", "void", "outstanding", "credited", "refund_due", "cancelled"] as const;
export type InvoiceListState = (typeof INVOICE_LIST_STATES)[number];

export interface ListInvoicesOptions {
  state?: InvoiceListState;
  patientId?: string;
  payerReferrerId?: string;
  caseId?: string;
  billTo?: BillTo;
  payerType?: PayerType;
  /** An invoice number ("RIV00042", "42"), or words of the patient's or the payer's name. */
  q?: string;
  /** An invoice number only ("RIV00042", "42"). */
  number?: string;
  /** The member's site scope (null/undefined = every site); invoices without a site are then left out. */
  siteIds?: ReadonlySet<string> | null;
  /** One site (the site switcher). */
  siteId?: string;
  /** Invoice date range (issued invoices). */
  from?: string;
  until?: string;
  /** Default 50, at most 200. */
  limit?: number;
  offset?: number;
}

const BALANCE = sql<number>`total_pence - paid_pence - credited_pence`;

/** Words of a search, lower case, for LIKE (wildcards escaped). */
function likeWords(q: string): string[] {
  return q
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[%_\\]/g, ""))
    .filter((w) => w.length > 0)
    .slice(0, 4)
    .map((w) => `%${w}%`);
}

/** Invoices (summaries, nothing decrypted), newest first; and how many match. */
export async function listInvoices(ctx: RepoContext, tenantId: string, options: ListInvoicesOptions = {}): Promise<InvoiceSummary[]> {
  return (await listInvoicesPage(ctx, tenantId, options)).rows;
}

export async function listInvoicesPage(ctx: RepoContext, tenantId: string, options: ListInvoicesOptions = {}): Promise<{ rows: InvoiceSummary[]; total: number }> {
  assertTenantId(tenantId);
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 50)), 200);
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  if (options.siteIds && options.siteIds.size === 0) return { rows: [], total: 0 };
  let q = ctx.db.selectFrom(INV).where("tenant_id", "=", tenantId);
  const today = todayOf(ctx);
  switch (options.state ?? "all") {
    case "draft":
      q = q.where("status", "=", "draft");
      break;
    case "cancelled":
      q = q.where("status", "=", "cancelled");
      break;
    case "issued":
      q = q.where("status", "=", "issued").where("voided_at", "is", null).where("paid_pence", "=", 0).where("credited_pence", "=", 0).where(BALANCE, ">", 0).where((eb) => eb.or([eb("due_on", "is", null), eb("due_on", ">=", today)]));
      break;
    case "part_paid":
      q = q.where("status", "=", "issued").where(BALANCE, ">", 0).where(sql<boolean>`(paid_pence > 0 or credited_pence > 0)`).where((eb) => eb.or([eb("due_on", "is", null), eb("due_on", ">=", today)]));
      break;
    case "outstanding":
      q = q.where("status", "=", "issued").where(BALANCE, ">", 0);
      break;
    case "overdue":
      q = q.where("status", "=", "issued").where(BALANCE, ">", 0).where("due_on", "<", today);
      break;
    case "paid":
      q = q.where("status", "=", "issued").where("voided_at", "is", null).where(BALANCE, "=", 0).where(sql<boolean>`(credited_pence < total_pence or total_pence = 0)`);
      break;
    case "credited":
      q = q.where("status", "=", "issued").where("voided_at", "is", null).where(sql<boolean>`credited_pence = total_pence and total_pence > 0`);
      break;
    case "void":
      q = q.where("status", "=", "issued").where("voided_at", "is not", null);
      break;
    case "refund_due":
      q = q.where("status", "=", "issued").where(BALANCE, "<", 0);
      break;
    default:
      break;
  }
  if (options.siteIds) q = q.where("site_id", "in", Array.from(options.siteIds).slice(0, 90));
  if (options.siteId) q = q.where("site_id", "=", options.siteId);
  if (options.patientId) q = q.where("patient_id", "=", options.patientId);
  if (options.payerReferrerId) q = q.where("payer_referrer_id", "=", options.payerReferrerId);
  if (options.caseId) q = q.where("case_id", "=", options.caseId);
  if (options.billTo) q = q.where("bill_to", "=", options.billTo);
  if (options.payerType) q = q.where("payer_type", "=", options.payerType);
  if (options.from) q = q.where("issued_on", ">=", options.from);
  if (options.until) q = q.where("issued_on", "<=", options.until);
  if (options.number) {
    const n = parseDocumentNumber(options.number);
    if (!n) return { rows: [], total: 0 };
    q = q.where("number_seq", "=", n.seq);
    if (n.prefix) q = q.where("number_prefix", "=", n.prefix);
  }
  const text = options.q?.trim();
  if (text) {
    const n = parseDocumentNumber(text);
    const words = likeWords(text);
    q = q.where((eb) => {
      const ors = [];
      if (n) ors.push(n.prefix ? eb.and([eb("number_seq", "=", n.seq), eb("number_prefix", "=", n.prefix)]) : eb("number_seq", "=", n.seq));
      if (words.length) {
        const patient = eb
          .selectFrom("pms_patients as pp")
          .select("pp.id")
          .whereRef("pp.tenant_id", "=", "pms_invoices.tenant_id")
          .whereRef("pp.id", "=", "pms_invoices.patient_id")
          .where("pp.tenant_id", "=", tenantId)
          .where((e2) => e2.and(words.map((w) => e2(sql<string>`lower(pp.first_name || ' ' || pp.last_name || ' ' || coalesce(pp.preferred_name, ''))`, "like", w))));
        const payer = eb
          .selectFrom("pms_referrers as pr")
          .select("pr.id")
          .whereRef("pr.tenant_id", "=", "pms_invoices.tenant_id")
          .whereRef("pr.id", "=", "pms_invoices.payer_referrer_id")
          .where("pr.tenant_id", "=", tenantId)
          .where((e2) => e2.and(words.map((w) => e2(sql<string>`lower(pr.name)`, "like", w))));
        ors.push(eb.exists(patient), eb.exists(payer));
      }
      return ors.length ? eb.or(ors) : eb.val(false);
    });
  }
  const [rows, count] = await Promise.all([
    q.select(SUMMARY_COLUMNS).orderBy("created_at", "desc").orderBy("id", "desc").limit(limit).offset(offset).execute(),
    q.select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirst(),
  ]);
  return { rows: rows.map(toInvoiceSummary), total: num(count?.n ?? 0) };
}

export interface BillingFigures {
  drafts: number;
  outstandingPence: number;
  outstandingCount: number;
  /** Of the outstanding: owed by patients / by payer accounts (insurers, solicitors…). */
  outstandingPatientsPence: number;
  outstandingAccountsPence: number;
  overduePence: number;
  overdueCount: number;
  refundsDuePence: number;
  invoicedThisMonthPence: number;
  /** Payments taken today (refunds and reversed payments left out), by method. */
  takenTodayPence: number;
  takenTodayByMethod: Record<string, number>;
}

/** Figures for the billing start page (in the member's site scope). */
export async function billingFigures(ctx: RepoContext, tenantId: string, scope: { siteIds?: ReadonlySet<string> | null; siteId?: string } = {}): Promise<BillingFigures> {
  assertTenantId(tenantId);
  const today = todayOf(ctx);
  const monthStart = `${today.slice(0, 7)}-01`;
  const sites = scope.siteIds ? Array.from(scope.siteIds).slice(0, 90) : null;
  let q = ctx.db
    .selectFrom(INV)
    .select([
      sql<number>`coalesce(sum(case when status = 'draft' then 1 else 0 end), 0)`.as("drafts"),
      sql<number>`coalesce(sum(case when status = 'issued' and total_pence - paid_pence - credited_pence > 0 then total_pence - paid_pence - credited_pence else 0 end), 0)`.as("outstanding"),
      sql<number>`coalesce(sum(case when status = 'issued' and bill_to = 'patient' and total_pence - paid_pence - credited_pence > 0 then total_pence - paid_pence - credited_pence else 0 end), 0)`.as("outstanding_p"),
      sql<number>`coalesce(sum(case when status = 'issued' and total_pence - paid_pence - credited_pence > 0 then 1 else 0 end), 0)`.as("outstanding_n"),
      sql<number>`coalesce(sum(case when status = 'issued' and total_pence - paid_pence - credited_pence > 0 and due_on < ${today} then total_pence - paid_pence - credited_pence else 0 end), 0)`.as("overdue"),
      sql<number>`coalesce(sum(case when status = 'issued' and total_pence - paid_pence - credited_pence > 0 and due_on < ${today} then 1 else 0 end), 0)`.as("overdue_n"),
      sql<number>`coalesce(sum(case when status = 'issued' and total_pence - paid_pence - credited_pence < 0 then paid_pence + credited_pence - total_pence else 0 end), 0)`.as("refunds"),
      sql<number>`coalesce(sum(case when status = 'issued' and voided_at is null and issued_on >= ${monthStart} then total_pence else 0 end), 0)`.as("month"),
    ])
    .where("tenant_id", "=", tenantId);
  if (sites) q = sites.length ? q.where("site_id", "in", sites) : q.where(sql<boolean>`1 = 0`);
  if (scope.siteId) q = q.where("site_id", "=", scope.siteId);
  let pq = ctx.db
    .selectFrom(PAY)
    .select(["method", (eb) => eb.fn.sum<number>("amount_pence").as("n")])
    .where("tenant_id", "=", tenantId)
    .where("kind", "=", "payment")
    .where("status", "=", "recorded")
    .where("received_on", "=", today);
  if (sites) pq = sites.length ? pq.where("site_id", "in", sites) : pq.where(sql<boolean>`1 = 0`);
  if (scope.siteId) pq = pq.where("site_id", "=", scope.siteId);
  const [row, taken] = await Promise.all([q.executeTakeFirst(), pq.groupBy("method").execute()]);
  const byMethod: Record<string, number> = {};
  for (const t of taken) byMethod[t.method] = num(t.n);
  const outstanding = num(row?.outstanding ?? 0);
  const outstandingPatients = num(row?.outstanding_p ?? 0);
  return {
    drafts: num(row?.drafts ?? 0),
    outstandingPence: outstanding,
    outstandingCount: num(row?.outstanding_n ?? 0),
    outstandingPatientsPence: outstandingPatients,
    outstandingAccountsPence: outstanding - outstandingPatients,
    overduePence: num(row?.overdue ?? 0),
    overdueCount: num(row?.overdue_n ?? 0),
    refundsDuePence: num(row?.refunds ?? 0),
    invoicedThisMonthPence: num(row?.month ?? 0),
    takenTodayPence: Object.values(byMethod).reduce((a, n) => a + n, 0),
    takenTodayByMethod: byMethod,
  };
}

/** What each patient owes on issued invoices addressed to them (the patient list's Balance column), for these patients. */
export async function patientBalances(ctx: RepoContext, tenantId: string, patientIds: readonly string[]): Promise<Map<string, number>> {
  assertTenantId(tenantId);
  const out = new Map<string, number>();
  for (const group of chunks(Array.from(new Set(patientIds)))) {
    if (group.length === 0) continue;
    const rows = await ctx.db
      .selectFrom(INV)
      .select(["patient_id", (eb) => eb.fn.sum<number>(BALANCE).as("n")])
      .where("tenant_id", "=", tenantId)
      .where("status", "=", "issued")
      .where("bill_to", "=", "patient")
      .where("patient_id", "in", group)
      .groupBy("patient_id")
      .execute();
    for (const r of rows) out.set(r.patient_id, num(r.n));
  }
  return out;
}

/** The patient ids (at most `limit`) that owe money on issued invoices addressed to them – the "Owes money" filter. */
export function owesMoneyPatientIds(ctx: RepoContext, tenantId: string) {
  assertTenantId(tenantId);
  return ctx.db
    .selectFrom(INV)
    .select("patient_id")
    .where("tenant_id", "=", tenantId)
    .where("status", "=", "issued")
    .where("bill_to", "=", "patient")
    .groupBy("patient_id")
    .having((eb) => eb(eb.fn.sum<number>(BALANCE), ">", 0));
}
