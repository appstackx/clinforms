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
  HealthcodeSiteInputSchema,
  PayerHealthcodeInputSchema,
  ProviderNumberSchema,
  pairKey,
  type HealthcodeSettings,
  type PractitionerInsurerNumber,
  type HealthcodeSiteInput,
  type PayerHealthcode,
  type PayerHealthcodeInput,
} from "../../../../modules/pms/billing/healthcode";
import type { PmsActor } from "../../../../modules/pms/core/types";
import { isMissingPmsTable } from "../../../pms/missing-table";
import { assertId, assertTenantId, nowIso, num, parseInput, pmsAuditQuery, writeWithAudit, type RepoContext } from "../context";
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
