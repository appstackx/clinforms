/**
 * Healthcode e-billing groundwork (migrations 0220–0229, docs/clinic-system/healthcode.md): the identifiers and codes
 * a clinic records for its insurer bills. Every write is audited in the same batch (details name the fields set,
 * never their values); rows are upserted and changed, never deleted, except the per-insurer number and code mappings
 * which are removed when cleared.
 *
 * A release can reach a database before these migrations: every read answers "nothing set up yet" when its table does
 * not exist (isMissingPmsTable), and only a save fails until the migration is applied.
 */
import {
  HealthcodeBillStatusSchema,
  HealthcodeSiteInputSchema,
  isHealthcodeBillStatus,
  PayerHealthcodeInputSchema,
  ProviderNumberSchema,
  TreatmentCodeSchema,
  pairKey,
  type HealthcodeBillStatus,
  type HealthcodeSettings,
  type PractitionerInsurerNumber,
  type ServiceInsurerCode,
  type HealthcodeSiteInput,
  type PayerHealthcode,
  type PayerHealthcodeInput,
} from "../../../../modules/pms/billing/healthcode";
import { OptionalIcd10Schema } from "../../../../modules/pms/billing/icd10";
import type { PmsActor } from "../../../../modules/pms/core/types";
import { isMissingPmsTable } from "../../../pms/missing-table";
import { assertId, assertTenantId, decryptField, encryptField, nowIso, num, parseInput, pmsAudit, pmsAuditQuery, writeWithAudit, type RepoContext } from "../context";
import { chunks } from "./shared";

const PAYER = "pms_payer_healthcode";

/** Runs a read; a table these migrations have not created yet reads as `empty`. */
export async function readOrEmpty<T>(table: string, empty: T, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (isMissingPmsTable(err, table)) return empty;
    throw err;
  }
}

/* ------------------------------------------------------------------------------------------------
 * HC06 – payer accounts: the insurer's Healthcode identifier and the clinic's provider number
 * ----------------------------------------------------------------------------------------------*/

function toPayer(r: { referrer_id: string; rev: unknown; insurer_code: string | null; provider_number: string | null; diagnosis_required: unknown; updated_at: string }): PayerHealthcode {
  const d = r.diagnosis_required;
  return {
    referrerId: r.referrer_id,
    rev: num(r.rev),
    insurerCode: r.insurer_code,
    providerNumber: r.provider_number,
    diagnosisRequired: d === null || d === undefined ? null : Number(d) === 1,
    updatedAt: String(r.updated_at),
  };
}

/** The payer accounts' Healthcode details (accounts without a row are left out). */
export async function payerHealthcodes(ctx: RepoContext, tenantId: string, referrerIds?: readonly string[]): Promise<Map<string, PayerHealthcode>> {
  assertTenantId(tenantId);
  return readOrEmpty(PAYER, new Map<string, PayerHealthcode>(), async () => {
    const out = new Map<string, PayerHealthcode>();
    const cols = ["referrer_id", "rev", "insurer_code", "provider_number", "diagnosis_required", "updated_at"] as const;
    if (referrerIds === undefined) {
      const rows = await ctx.db.selectFrom(PAYER).select(cols).where("tenant_id", "=", tenantId).limit(2000).execute();
      for (const r of rows) out.set(r.referrer_id, toPayer(r));
      return out;
    }
    for (const group of chunks(Array.from(new Set(referrerIds)))) {
      if (group.length === 0) continue;
      const rows = await ctx.db.selectFrom(PAYER).select(cols).where("tenant_id", "=", tenantId).where("referrer_id", "in", group).execute();
      for (const r of rows) out.set(r.referrer_id, toPayer(r));
    }
    return out;
  });
}

export async function getPayerHealthcode(ctx: RepoContext, tenantId: string, referrerId: string): Promise<PayerHealthcode | null> {
  assertId(referrerId, "payer account id");
  return (await payerHealthcodes(ctx, tenantId, [referrerId])).get(referrerId) ?? null;
}

/** Sets a payer account's Healthcode details (all three fields; null clears one). */
export async function setPayerHealthcode(ctx: RepoContext, tenantId: string, referrerId: string, input: PayerHealthcodeInput, actor: PmsActor): Promise<void> {
  assertTenantId(tenantId);
  assertId(referrerId, "payer account id");
  const d = parseInput(PayerHealthcodeInputSchema, input, "Healthcode details");
  const values = {
    insurer_code: d.insurerCode ?? null,
    provider_number: d.providerNumber ?? null,
    diagnosis_required: typeof d.diagnosisRequired === "boolean" ? (d.diagnosisRequired ? 1 : 0) : null,
  };
  const at = nowIso(ctx);
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .insertInto(PAYER)
        .values({ tenant_id: tenantId, referrer_id: referrerId, rev: 1, ...values, updated_by: actor.userId, created_at: at, updated_at: at })
        .onConflict((oc) => oc.columns(["tenant_id", "referrer_id"]).doUpdateSet((eb) => ({ ...values, rev: eb(`${PAYER}.rev`, "+", 1), updated_by: actor.userId, updated_at: at }))),
      pmsAuditQuery(ctx, tenantId, actor, {
        action: "pms.payer_healthcode.set",
        targetType: "pms_referrer",
        targetId: referrerId,
        detail: { insurerCode: values.insurer_code !== null, providerNumber: values.provider_number !== null, diagnosisRequired: values.diagnosis_required === null ? "default" : values.diagnosis_required === 1 },
      }),
    ],
    { foreignKey: "That payer account does not exist in this clinic." },
  );
}

/* ------------------------------------------------------------------------------------------------
 * HC07 – the clinic's Healthcode Site ID and payee provider number (and a site's own)
 * ----------------------------------------------------------------------------------------------*/

const SETTINGS = "pms_healthcode_settings";
const SITES = "pms_site_healthcode";

export async function getHealthcodeSettings(ctx: RepoContext, tenantId: string): Promise<HealthcodeSettings> {
  assertTenantId(tenantId);
  const [clinic, sites] = await Promise.all([
    readOrEmpty(SETTINGS, undefined, () => ctx.db.selectFrom(SETTINGS).select(["rev", "site_code", "payee_provider_number", "updated_at"]).where("tenant_id", "=", tenantId).executeTakeFirst()),
    readOrEmpty(SITES, [] as { site_id: string; site_code: string | null; payee_provider_number: string | null }[], () =>
      ctx.db.selectFrom(SITES).select(["site_id", "site_code", "payee_provider_number"]).where("tenant_id", "=", tenantId).limit(500).execute(),
    ),
  ]);
  const out: HealthcodeSettings = {
    rev: clinic ? num(clinic.rev) : 0,
    clinic: { siteCode: clinic?.site_code ?? null, payeeProviderNumber: clinic?.payee_provider_number ?? null },
    sites: {},
    updatedAt: clinic ? String(clinic.updated_at) : null,
  };
  for (const s of sites) out.sites[s.site_id] = { siteCode: s.site_code, payeeProviderNumber: s.payee_provider_number };
  return out;
}

/** The clinic's Site ID and payee provider number. */
export async function setClinicHealthcode(ctx: RepoContext, tenantId: string, input: HealthcodeSiteInput, actor: PmsActor): Promise<void> {
  assertTenantId(tenantId);
  const d = parseInput(HealthcodeSiteInputSchema, input, "Healthcode settings");
  const values = { site_code: d.siteCode ?? null, payee_provider_number: d.payeeProviderNumber ?? null };
  const at = nowIso(ctx);
  await writeWithAudit(ctx, [
    ctx.db
      .insertInto(SETTINGS)
      .values({ tenant_id: tenantId, rev: 1, ...values, updated_by: actor.userId, created_at: at, updated_at: at })
      .onConflict((oc) => oc.column("tenant_id").doUpdateSet((eb) => ({ ...values, rev: eb(`${SETTINGS}.rev`, "+", 1), updated_by: actor.userId, updated_at: at }))),
    pmsAuditQuery(ctx, tenantId, actor, { action: "pms.healthcode_settings.set", targetType: "pms_billing_settings", targetId: tenantId, detail: { siteCode: values.site_code !== null, payeeProviderNumber: values.payee_provider_number !== null } }),
  ]);
}

/** A site's own Site ID and payee provider number; both blank = the site uses the clinic's (its row is removed). */
export async function setSiteHealthcode(ctx: RepoContext, tenantId: string, siteId: string, input: HealthcodeSiteInput, actor: PmsActor): Promise<void> {
  assertTenantId(tenantId);
  assertId(siteId, "site id");
  const d = parseInput(HealthcodeSiteInputSchema, input, "Healthcode settings");
  const values = { site_code: d.siteCode ?? null, payee_provider_number: d.payeeProviderNumber ?? null };
  const at = nowIso(ctx);
  const audit = pmsAuditQuery(ctx, tenantId, actor, { action: "pms.site_healthcode.set", targetType: "pms_site", targetId: siteId, detail: { siteCode: values.site_code !== null, payeeProviderNumber: values.payee_provider_number !== null } });
  if (values.site_code === null && values.payee_provider_number === null) {
    await writeWithAudit(ctx, [ctx.db.deleteFrom(SITES).where("tenant_id", "=", tenantId).where("site_id", "=", siteId), audit]);
    return;
  }
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .insertInto(SITES)
        .values({ tenant_id: tenantId, site_id: siteId, rev: 1, ...values, updated_by: actor.userId, created_at: at, updated_at: at })
        .onConflict((oc) => oc.columns(["tenant_id", "site_id"]).doUpdateSet((eb) => ({ ...values, rev: eb(`${SITES}.rev`, "+", 1), updated_by: actor.userId, updated_at: at }))),
      audit,
    ],
    { foreignKey: "That site does not exist in this clinic." },
  );
}

/* ------------------------------------------------------------------------------------------------
 * HC08 – practitioners' provider numbers with each insurer
 * ----------------------------------------------------------------------------------------------*/

const PRAC = "pms_practitioner_insurer_numbers";

/** The numbers recorded, optionally for some practitioners only (key: pairKey(practitionerId, referrerId)). */
export async function practitionerInsurerNumbers(ctx: RepoContext, tenantId: string, practitionerIds?: readonly string[]): Promise<Map<string, PractitionerInsurerNumber>> {
  assertTenantId(tenantId);
  return readOrEmpty(PRAC, new Map<string, PractitionerInsurerNumber>(), async () => {
    const out = new Map<string, PractitionerInsurerNumber>();
    const cols = ["practitioner_id", "referrer_id", "provider_number"] as const;
    const add = (rows: { practitioner_id: string; referrer_id: string; provider_number: string }[]) => {
      for (const r of rows) out.set(pairKey(r.practitioner_id, r.referrer_id), { practitionerId: r.practitioner_id, referrerId: r.referrer_id, providerNumber: r.provider_number });
    };
    if (practitionerIds === undefined) {
      add(await ctx.db.selectFrom(PRAC).select(cols).where("tenant_id", "=", tenantId).limit(5000).execute());
      return out;
    }
    for (const group of chunks(Array.from(new Set(practitionerIds)))) {
      if (group.length) add(await ctx.db.selectFrom(PRAC).select(cols).where("tenant_id", "=", tenantId).where("practitioner_id", "in", group).execute());
    }
    return out;
  });
}

/** Sets (or, with null / blank, removes) a practitioner's provider number with one insurer. */
export async function setPractitionerInsurerNumber(ctx: RepoContext, tenantId: string, practitionerId: string, referrerId: string, providerNumber: string | null, actor: PmsActor): Promise<void> {
  assertTenantId(tenantId);
  assertId(practitionerId, "practitioner id");
  assertId(referrerId, "payer account id");
  const value = parseInput(ProviderNumberSchema, providerNumber, "Provider number") ?? null;
  const at = nowIso(ctx);
  const audit = pmsAuditQuery(ctx, tenantId, actor, { action: "pms.practitioner_insurer_number.set", targetType: "pms_practitioner", targetId: practitionerId, detail: { referrerId, set: value !== null } });
  if (value === null) {
    await writeWithAudit(ctx, [ctx.db.deleteFrom(PRAC).where("tenant_id", "=", tenantId).where("practitioner_id", "=", practitionerId).where("referrer_id", "=", referrerId), audit]);
    return;
  }
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .insertInto(PRAC)
        .values({ tenant_id: tenantId, practitioner_id: practitionerId, referrer_id: referrerId, rev: 1, provider_number: value, updated_by: actor.userId, created_at: at, updated_at: at })
        .onConflict((oc) => oc.columns(["tenant_id", "practitioner_id", "referrer_id"]).doUpdateSet((eb) => ({ provider_number: value, rev: eb(`${PRAC}.rev`, "+", 1), updated_by: actor.userId, updated_at: at }))),
      audit,
    ],
    { foreignKey: "That practitioner or insurer does not exist in this clinic." },
  );
}

/* ------------------------------------------------------------------------------------------------
 * HC09 – a service's CCSD code and each insurer's treatment code (ISC) for it
 * ----------------------------------------------------------------------------------------------*/

const SVC = "pms_service_codes";
const ISC = "pms_service_insurer_codes";

/** CCSD codes by service id (services without one are left out). */
export async function serviceCcsdCodes(ctx: RepoContext, tenantId: string): Promise<Map<string, string>> {
  assertTenantId(tenantId);
  return readOrEmpty(SVC, new Map<string, string>(), async () => {
    const rows = await ctx.db.selectFrom(SVC).select(["service_id", "ccsd_code"]).where("tenant_id", "=", tenantId).limit(2000).execute();
    return new Map(rows.filter((r) => r.ccsd_code).map((r) => [r.service_id, r.ccsd_code as string]));
  });
}

export async function setServiceCcsdCode(ctx: RepoContext, tenantId: string, serviceId: string, code: string | null, actor: PmsActor): Promise<void> {
  assertTenantId(tenantId);
  assertId(serviceId, "service id");
  const value = parseInput(TreatmentCodeSchema, code, "CCSD code") ?? null;
  const at = nowIso(ctx);
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .insertInto(SVC)
        .values({ tenant_id: tenantId, service_id: serviceId, rev: 1, ccsd_code: value, updated_by: actor.userId, created_at: at, updated_at: at })
        .onConflict((oc) => oc.columns(["tenant_id", "service_id"]).doUpdateSet((eb) => ({ ccsd_code: value, rev: eb(`${SVC}.rev`, "+", 1), updated_by: actor.userId, updated_at: at }))),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.service_ccsd.set", targetType: "pms_service", targetId: serviceId, detail: { set: value !== null } }),
    ],
    { foreignKey: "That service does not exist in this clinic." },
  );
}

/** Insurer treatment codes (key: pairKey(serviceId, referrerId)), optionally for some insurers only. */
export async function serviceInsurerCodes(ctx: RepoContext, tenantId: string, referrerIds?: readonly string[]): Promise<Map<string, ServiceInsurerCode>> {
  assertTenantId(tenantId);
  return readOrEmpty(ISC, new Map<string, ServiceInsurerCode>(), async () => {
    const out = new Map<string, ServiceInsurerCode>();
    const cols = ["service_id", "referrer_id", "isc_code"] as const;
    const add = (rows: { service_id: string; referrer_id: string; isc_code: string }[]) => {
      for (const r of rows) out.set(pairKey(r.service_id, r.referrer_id), { serviceId: r.service_id, referrerId: r.referrer_id, iscCode: r.isc_code });
    };
    if (referrerIds === undefined) {
      add(await ctx.db.selectFrom(ISC).select(cols).where("tenant_id", "=", tenantId).limit(10000).execute());
      return out;
    }
    for (const group of chunks(Array.from(new Set(referrerIds)))) {
      if (group.length) add(await ctx.db.selectFrom(ISC).select(cols).where("tenant_id", "=", tenantId).where("referrer_id", "in", group).execute());
    }
    return out;
  });
}

/** Sets (or, blank, removes) an insurer's treatment code for a service. */
export async function setServiceInsurerCode(ctx: RepoContext, tenantId: string, serviceId: string, referrerId: string, code: string | null, actor: PmsActor): Promise<void> {
  assertTenantId(tenantId);
  assertId(serviceId, "service id");
  assertId(referrerId, "payer account id");
  const value = parseInput(TreatmentCodeSchema, code, "Insurer treatment code") ?? null;
  const at = nowIso(ctx);
  const audit = pmsAuditQuery(ctx, tenantId, actor, { action: "pms.service_insurer_code.set", targetType: "pms_service", targetId: serviceId, detail: { referrerId, set: value !== null } });
  if (value === null) {
    await writeWithAudit(ctx, [ctx.db.deleteFrom(ISC).where("tenant_id", "=", tenantId).where("service_id", "=", serviceId).where("referrer_id", "=", referrerId), audit]);
    return;
  }
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .insertInto(ISC)
        .values({ tenant_id: tenantId, service_id: serviceId, referrer_id: referrerId, rev: 1, isc_code: value, updated_by: actor.userId, created_at: at, updated_at: at })
        .onConflict((oc) => oc.columns(["tenant_id", "service_id", "referrer_id"]).doUpdateSet((eb) => ({ isc_code: value, rev: eb(`${ISC}.rev`, "+", 1), updated_by: actor.userId, updated_at: at }))),
      audit,
    ],
    { foreignKey: "That service or insurer does not exist in this clinic." },
  );
}

/* ------------------------------------------------------------------------------------------------
 * HC10 – ICD-10 diagnosis codes: a case's (new table) and an insurer invoice's (pms_invoices.diagnosis_enc)
 * ----------------------------------------------------------------------------------------------*/

const CASE_DX = "pms_case_diagnosis";

/** Cases' diagnosis codes, decrypted (cases without one are left out). */
export async function caseDiagnoses(ctx: RepoContext, tenantId: string, caseIds: readonly string[]): Promise<Map<string, string>> {
  assertTenantId(tenantId);
  return readOrEmpty(CASE_DX, new Map<string, string>(), async () => {
    const out = new Map<string, string>();
    for (const group of chunks(Array.from(new Set(caseIds)))) {
      if (group.length === 0) continue;
      const rows = await ctx.db.selectFrom(CASE_DX).select(["id", "diagnosis_enc"]).where("tenant_id", "=", tenantId).where("id", "in", group).execute();
      for (const r of rows) {
        const code = decryptField(ctx, tenantId, CASE_DX, "diagnosis_enc", r.id, r.diagnosis_enc);
        if (code) out.set(r.id, code);
      }
    }
    return out;
  });
}

/** Sets (or clears) a case's ICD-10 diagnosis code (format checked and normalised). */
export async function setCaseDiagnosis(ctx: RepoContext, tenantId: string, caseId: string, code: string | null, actor: PmsActor): Promise<string | null> {
  assertTenantId(tenantId);
  assertId(caseId, "case id");
  const value = parseInput(OptionalIcd10Schema, code, "Diagnosis code") ?? null;
  const enc = encryptField(ctx, tenantId, CASE_DX, "diagnosis_enc", caseId, value);
  const at = nowIso(ctx);
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .insertInto(CASE_DX)
        .values({ tenant_id: tenantId, id: caseId, rev: 1, diagnosis_enc: enc, updated_by: actor.userId, created_at: at, updated_at: at })
        .onConflict((oc) => oc.columns(["tenant_id", "id"]).doUpdateSet((eb) => ({ diagnosis_enc: enc, rev: eb(`${CASE_DX}.rev`, "+", 1), updated_by: actor.userId, updated_at: at }))),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.case_diagnosis.set", targetType: "pms_case", targetId: caseId, detail: { set: value !== null } }),
    ],
    { foreignKey: "That case does not exist in this clinic." },
  );
  return value;
}

/**
 * Sets (or clears) an insurer invoice's own ICD-10 diagnosis code – a draft or an issued invoice addressed to a payer
 * account (not cancelled or voided). The amounts are untouched; the change is audited. Returns false when no such
 * invoice exists in this clinic.
 */
export async function setInvoiceDiagnosis(ctx: RepoContext, tenantId: string, invoiceId: string, code: string | null, actor: PmsActor): Promise<{ ok: boolean; code: string | null }> {
  assertTenantId(tenantId);
  assertId(invoiceId, "invoice id");
  const value = parseInput(OptionalIcd10Schema, code, "Diagnosis code") ?? null;
  const enc = encryptField(ctx, tenantId, "pms_invoices", "diagnosis_enc", invoiceId, value);
  const at = nowIso(ctx);
  const r = await ctx.db
    .updateTable("pms_invoices")
    .set((eb) => ({ diagnosis_enc: enc, rev: eb("rev", "+", 1), updated_at: at }))
    .where("tenant_id", "=", tenantId)
    .where("id", "=", invoiceId)
    .where("bill_to", "=", "payer")
    .where("status", "in", ["draft", "issued"])
    .where("voided_at", "is", null)
    .executeTakeFirst();
  if (Number(r.numUpdatedRows ?? 0) === 0) return { ok: false, code: null };
  await pmsAudit(ctx, tenantId, actor, { action: "pms.invoice.diagnosis_set", targetType: "pms_invoice", targetId: invoiceId, detail: { set: value !== null } });
  return { ok: true, code: value };
}

/* ------------------------------------------------------------------------------------------------
 * HC12 – the export log by batch (pms_invoice_exports, 0130)
 * ----------------------------------------------------------------------------------------------*/

export interface ExportBatch {
  batchRef: string;
  channel: string;
  invoices: number;
  createdAt: string;
  createdBy: string | null;
}

/** The latest export batches, newest first (counts only – no patient data). */
export async function listExportBatches(ctx: RepoContext, tenantId: string, options: { limit?: number } = {}): Promise<ExportBatch[]> {
  assertTenantId(tenantId);
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 20)), 100);
  const rows = await ctx.db
    .selectFrom("pms_invoice_exports")
    .select((eb) => ["batch_ref", "channel", eb.fn.countAll<number>().as("n"), eb.fn.min("created_at").as("at"), eb.fn.min("created_by").as("by")])
    .where("tenant_id", "=", tenantId)
    .groupBy(["batch_ref", "channel"])
    .orderBy("at", "desc")
    .limit(limit)
    .execute();
  return rows.map((r) => ({ batchRef: r.batch_ref, channel: r.channel, invoices: Number(r.n), createdAt: (r.at as unknown) instanceof Date ? (r.at as unknown as Date).toISOString() : new Date(String(r.at)).toISOString(), createdBy: (r.by as string | null) ?? null }));
}

/* ------------------------------------------------------------------------------------------------
 * HC13 – an insurer invoice's bill status (set by hand for now)
 * ----------------------------------------------------------------------------------------------*/

const STATUS = "pms_invoice_bill_status";

export async function billStatuses(ctx: RepoContext, tenantId: string, invoiceIds: readonly string[]): Promise<Map<string, HealthcodeBillStatus>> {
  assertTenantId(tenantId);
  return readOrEmpty(STATUS, new Map<string, HealthcodeBillStatus>(), async () => {
    const out = new Map<string, HealthcodeBillStatus>();
    for (const group of chunks(Array.from(new Set(invoiceIds)))) {
      if (group.length === 0) continue;
      const rows = await ctx.db.selectFrom(STATUS).select(["invoice_id", "status"]).where("tenant_id", "=", tenantId).where("invoice_id", "in", group).execute();
      for (const r of rows) if (isHealthcodeBillStatus(r.status)) out.set(r.invoice_id, r.status);
    }
    return out;
  });
}

/** Sets (or, null, clears) an invoice's bill status; the audit row names the old and new status. */
export async function setBillStatus(ctx: RepoContext, tenantId: string, invoiceId: string, status: HealthcodeBillStatus | null, actor: PmsActor): Promise<void> {
  assertTenantId(tenantId);
  assertId(invoiceId, "invoice id");
  const next = parseInput(HealthcodeBillStatusSchema, status, "Bill status");
  const before = (await billStatuses(ctx, tenantId, [invoiceId])).get(invoiceId) ?? null;
  const at = nowIso(ctx);
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .insertInto(STATUS)
        .values({ tenant_id: tenantId, invoice_id: invoiceId, rev: 1, status: next, updated_by: actor.userId, created_at: at, updated_at: at })
        .onConflict((oc) => oc.columns(["tenant_id", "invoice_id"]).doUpdateSet((eb) => ({ status: next, rev: eb(`${STATUS}.rev`, "+", 1), updated_by: actor.userId, updated_at: at }))),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.invoice.bill_status", targetType: "pms_invoice", targetId: invoiceId, detail: { from: before ?? "none", to: next ?? "none" } }),
    ],
    { foreignKey: "That invoice does not exist in this clinic." },
  );
}
