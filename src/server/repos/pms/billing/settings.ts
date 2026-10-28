/**
 * `pms_billing_settings` (one row per clinic: numbering, payment terms, VAT, charges for missed appointments, what
 * invoices say about paying) and `pms_service_vat` (the VAT code of each appointment type). A clinic without a row
 * gets the defaults: prefixes INV / CN from 1, patients pay on the day, accounts in 30 days, not VAT-registered,
 * did-not-attend charged in full and late cancellations at half.
 */
import { BillingSettingsInputSchema, ServiceVatInputSchema, type BillingSettingsInput } from "../../../../modules/pms/billing/schemas";
import type { BillingSettings } from "../../../../modules/pms/billing/types";
import type { VatCode } from "../../../../modules/pms/billing/vat";
import type { PmsActor, PmsSaveResult } from "../../../../modules/pms/core/types";
import type { DbContext } from "../context";
import { RepoInputError, assertId, assertTenantId, b01, guarded, isOn, nowIso, num, parseInput, patchColumns, pmsAudit, pmsAuditQuery, writeWithAudit } from "../context";

const S = "pms_billing_settings";

export const BILLING_DEFAULTS: Omit<BillingSettings, "tenantId" | "serviceVat" | "updatedAt"> = {
  rev: 0,
  invoicePrefix: "INV",
  creditNotePrefix: "CN",
  firstInvoiceNumber: 1,
  firstCreditNoteNumber: 1,
  selfPayTermsDays: 0,
  accountTermsDays: 30,
  vatRegistered: false,
  vatNumber: null,
  pricesIncludeVat: true,
  dnaChargePercent: 100,
  lateCancelChargePercent: 50,
  paymentInstructions: null,
  paymentLinksEnabled: false,
};

/** The settings row's INSERT … ON CONFLICT DO NOTHING (put first in a batch that reads the row in SQL). */
export function ensureSettingsQuery(ctx: DbContext, tenantId: string, at: string) {
  return ctx.db
    .insertInto(S)
    .values({ tenant_id: tenantId, created_at: at, updated_at: at })
    .onConflict((oc) => oc.column("tenant_id").doNothing());
}

export async function getBillingSettings(ctx: DbContext, tenantId: string): Promise<BillingSettings> {
  assertTenantId(tenantId);
  const [row, vat] = await Promise.all([
    ctx.db.selectFrom(S).selectAll().where("tenant_id", "=", tenantId).executeTakeFirst(),
    ctx.db.selectFrom("pms_service_vat").select(["service_id", "vat_code"]).where("tenant_id", "=", tenantId).limit(500).execute(),
  ]);
  const serviceVat: Record<string, VatCode> = Object.fromEntries(vat.map((v) => [v.service_id, v.vat_code as VatCode]));
  if (!row) return { tenantId, ...BILLING_DEFAULTS, serviceVat, updatedAt: null };
  return {
    tenantId,
    rev: num(row.rev),
    invoicePrefix: row.invoice_prefix,
    creditNotePrefix: row.credit_note_prefix,
    firstInvoiceNumber: num(row.first_invoice_number),
    firstCreditNoteNumber: num(row.first_credit_note_number),
    selfPayTermsDays: num(row.self_pay_terms_days),
    accountTermsDays: num(row.account_terms_days),
    vatRegistered: isOn(row.vat_registered),
    vatNumber: row.vat_number,
    pricesIncludeVat: isOn(row.prices_include_vat),
    dnaChargePercent: num(row.dna_charge_percent),
    lateCancelChargePercent: num(row.late_cancel_charge_percent),
    paymentInstructions: row.payment_instructions,
    paymentLinksEnabled: isOn(row.payment_links_enabled),
    serviceVat,
    updatedAt: row.updated_at,
  };
}

/**
 * Changes the settings (owners and administrators). `expectedRev` is the rev the form was opened with (0 when the
 * clinic had no row yet). VAT-registered needs a VAT number.
 */
export async function updateBillingSettings(ctx: DbContext, tenantId: string, expectedRev: number, input: BillingSettingsInput, actor: PmsActor): Promise<PmsSaveResult> {
  assertTenantId(tenantId);
  if (!Number.isInteger(expectedRev) || expectedRev < 0) throw new RepoInputError("expectedRev must be a whole number.");
  const d = parseInput(BillingSettingsInputSchema, input, "Billing settings");
  const current = await getBillingSettings(ctx, tenantId);
  if (current.rev !== expectedRev) return { ok: false, reason: "conflict", currentRev: current.rev };
  const vatRegistered = d.vatRegistered ?? current.vatRegistered;
  const vatNumber = d.vatNumber === undefined ? current.vatNumber : d.vatNumber;
  if (vatRegistered && !vatNumber) throw new RepoInputError("Billing settings: vatNumber: Enter the clinic's VAT number");
  const invoicePrefix = d.invoicePrefix ?? current.invoicePrefix;
  const creditPrefix = d.creditNotePrefix ?? current.creditNotePrefix;
  if (invoicePrefix === creditPrefix) throw new RepoInputError("Billing settings: creditNotePrefix: Use a different prefix from invoices");
  const set: Record<string, unknown> = {};
  const fields = patchColumns(
    d,
    {
      invoicePrefix: "invoice_prefix",
      creditNotePrefix: "credit_note_prefix",
      firstInvoiceNumber: "first_invoice_number",
      firstCreditNoteNumber: "first_credit_note_number",
      selfPayTermsDays: "self_pay_terms_days",
      accountTermsDays: "account_terms_days",
      vatRegistered: ["vat_registered", (v: boolean) => b01(v)],
      vatNumber: "vat_number",
      pricesIncludeVat: ["prices_include_vat", (v: boolean) => b01(v)],
      dnaChargePercent: "dna_charge_percent",
      lateCancelChargePercent: "late_cancel_charge_percent",
      paymentInstructions: "payment_instructions",
      paymentLinksEnabled: ["payment_links_enabled", (v: boolean) => b01(v)],
    },
    set,
  );
  const at = nowIso(ctx);
  if (fields.length === 0) return { ok: true, rev: expectedRev, updatedAt: at };
  if (expectedRev === 0) {
    // First save: the row does not exist yet (a second save racing this one hits the primary key).
    await writeWithAudit(
      ctx,
      [
        ctx.db.insertInto(S).values({ tenant_id: tenantId, ...set, rev: 1, updated_by: actor.userId, created_at: at, updated_at: at }),
        pmsAuditQuery(ctx, tenantId, actor, { action: "pms.billing_settings.update", targetType: "pms_billing_settings", targetId: tenantId, detail: { fields, rev: 1 } }),
      ],
      { unique: "The settings were changed by someone else. Reload the page." },
    );
    return { ok: true, rev: 1, updatedAt: at };
  }
  const result = await guarded(() =>
    ctx.db
      .updateTable(S)
      .set({ ...set, rev: expectedRev + 1, updated_by: actor.userId, updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("rev", "=", expectedRev)
      .executeTakeFirst(),
  );
  if (Number(result.numUpdatedRows) === 0) return { ok: false, reason: "conflict", currentRev: (await getBillingSettings(ctx, tenantId)).rev };
  await pmsAudit(ctx, tenantId, actor, { action: "pms.billing_settings.update", targetType: "pms_billing_settings", targetId: tenantId, detail: { fields, rev: expectedRev + 1 } });
  return { ok: true, rev: expectedRev + 1, updatedAt: at };
}

/** Sets an appointment type's VAT code ("exempt" by default for every type without a row). */
export async function setServiceVat(ctx: DbContext, tenantId: string, serviceId: string, vatCode: string, actor: PmsActor): Promise<void> {
  assertTenantId(tenantId);
  assertId(serviceId, "service id");
  const d = parseInput(ServiceVatInputSchema, { serviceId, vatCode }, "VAT code");
  if (d.vatCode === "none") throw new RepoInputError("VAT code: choose exempt, standard, reduced or zero.");
  const at = nowIso(ctx);
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .insertInto("pms_service_vat")
        .values({ tenant_id: tenantId, service_id: d.serviceId, vat_code: d.vatCode, created_at: at, updated_at: at })
        .onConflict((oc) => oc.columns(["tenant_id", "service_id"]).doUpdateSet({ vat_code: d.vatCode, updated_at: at })),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.service_vat.set", targetType: "pms_service", targetId: d.serviceId, detail: { vatCode: d.vatCode } }),
    ],
    { foreignKey: "That appointment type does not exist in this clinic." },
  );
}
