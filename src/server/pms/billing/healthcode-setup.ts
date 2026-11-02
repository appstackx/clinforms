/**
 * Healthcode set-up (docs/clinic-system/healthcode.md) – the server layer of the Healthcode cards on the Set-up pages.
 * Same rules as Set-up (src/server/pms/reporting/setup.ts): settings.setup first, clinic-wide changes need every site,
 * ids read back from the member's clinic, inputs validated, the repository writes with its audit row, plain results.
 */
import "server-only";
export type { HealthcodeSettingsView, PayerHealthcodeView, PractitionerInsurerNumbersView } from "../../../modules/pms/billing/healthcode";
import { z } from "zod";
import {
  HealthcodeSiteInputSchema,
  PayerHealthcodeInputSchema,
  ProviderNumberSchema,
  diagnosisRequiredByDefault,
  pairKey,
  isHealthcodePayerKind,
  type HealthcodeSettingsView,
  type PayerHealthcodeView,
  type PractitionerInsurerNumbersView,
} from "../../../modules/pms/billing/healthcode";
import { fieldErrors } from "../../../modules/pms/core/schemas";
import { logAuthEvent } from "../../email/log";
import { RepoInputError } from "../../repos/context";
import {
  getHealthcodeSettings,
  getPayerHealthcode,
  practitionerInsurerNumbers,
  setClinicHealthcode,
  setPayerHealthcode,
  setPractitionerInsurerNumber,
  setSiteHealthcode,
} from "../../repos/pms/billing/healthcode";
import { getPractitioner, listSites } from "../../repos/pms/directory";
import { getReferrer, listReferrers } from "../../repos/pms/referrers";
import { SETUP_MESSAGES, type SetupActor, type SetupResult } from "../reporting/setup";

const ok = <T>(value: T): SetupResult<T> => ({ ok: true, value });
const fail = (error: string, fe?: Record<string, string>): SetupResult<never> => ({ ok: false, error, ...(fe ? { fieldErrors: fe } : {}) });
const FORBIDDEN = fail(SETUP_MESSAGES.forbidden);
const WHOLE = fail(SETUP_MESSAGES.wholeClinic);
const NOT_FOUND = fail(SETUP_MESSAGES.notFound);

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const plausibleId = (id: unknown): id is string => typeof id === "string" && ID.test(id);

export async function setupAttempt<T>(where: string, work: () => Promise<SetupResult<T>>): Promise<SetupResult<T>> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof RepoInputError) return fail(err.message);
    logAuthEvent("pms.setup_failed", { where, error: err instanceof Error ? err.name : "error" });
    return fail(SETUP_MESSAGES.generic);
  }
}

export function invalidFields(error: z.ZodError): SetupResult<never> {
  return fail(SETUP_MESSAGES.check, fieldErrors(error));
}

export { FORBIDDEN as SETUP_FORBIDDEN, WHOLE as SETUP_WHOLE, NOT_FOUND as SETUP_NOT_FOUND, ok as setupOk, fail as setupFail };

/* ------------------------------------------------------------------------------------------------
 * HC06 – a payer account's Healthcode details (Set-up → Referrers and insurers)
 * ----------------------------------------------------------------------------------------------*/


/** null for a referrer that is not an insurer (Healthcode bills insurers only). */
export async function payerHealthcodeFor(actor: SetupActor, referrerId: string | null): Promise<SetupResult<PayerHealthcodeView | null>> {
  if (!actor.can("settings.setup")) return FORBIDDEN;
  if (!referrerId || !plausibleId(referrerId)) return ok(null);
  return setupAttempt("setup.payer_healthcode", async () => {
    const ctx = actor.repo();
    const r = await getReferrer(ctx, actor.tenantId, referrerId);
    if (!r || !isHealthcodePayerKind(r.kind)) return ok(null);
    const details = await getPayerHealthcode(ctx, actor.tenantId, r.id);
    return ok({ referrerId: r.id, name: r.name, details, diagnosisDefault: diagnosisRequiredByDefault(r.name), canEdit: actor.siteIds === null });
  });
}

export interface PayerHealthcodeFields {
  insurerCode?: string;
  providerNumber?: string;
  /** "default" (by the insurer's name) | "yes" | "no" */
  diagnosis?: string;
}

export async function savePayerHealthcodeFor(actor: SetupActor, referrerId: string, f: PayerHealthcodeFields): Promise<SetupResult<{ id: string }>> {
  if (!actor.can("settings.setup")) return FORBIDDEN;
  if (actor.siteIds !== null) return WHOLE;
  if (!plausibleId(referrerId)) return NOT_FOUND;
  const input = {
    insurerCode: typeof f.insurerCode === "string" ? f.insurerCode : null,
    providerNumber: typeof f.providerNumber === "string" ? f.providerNumber : null,
    diagnosisRequired: f.diagnosis === "yes" ? true : f.diagnosis === "no" ? false : null,
  };
  const parsed = PayerHealthcodeInputSchema.safeParse(input);
  if (!parsed.success) return invalidFields(parsed.error);
  return setupAttempt("setup.payer_healthcode_save", async () => {
    const r = await getReferrer(actor.repo(), actor.tenantId, referrerId);
    if (!r || !isHealthcodePayerKind(r.kind)) return NOT_FOUND;
    await setPayerHealthcode(actor.repo(), actor.tenantId, r.id, input, actor.actor);
    return ok({ id: r.id });
  });
}

/* ------------------------------------------------------------------------------------------------
 * HC07 – Healthcode Site ID and payee provider number (Set-up → Billing settings)
 * ----------------------------------------------------------------------------------------------*/

export async function healthcodeSettingsFor(actor: SetupActor): Promise<SetupResult<HealthcodeSettingsView>> {
  if (!actor.can("settings.setup")) return FORBIDDEN;
  return setupAttempt("setup.healthcode_settings", async () => {
    const ctx = actor.repo();
    const [settings, sites] = await Promise.all([getHealthcodeSettings(ctx, actor.tenantId), listSites(ctx, actor.tenantId)]);
    return ok({ settings, sites: sites.map((s) => ({ id: s.id, name: s.name })), canEdit: actor.siteIds === null });
  });
}

export interface HealthcodeSettingsFields {
  siteCode?: string;
  payeeProviderNumber?: string;
  sites?: { siteId: string; siteCode?: string; payeeProviderNumber?: string }[];
}

/** Saves the clinic's Site ID and payee provider number, and each listed site's own (blank = the clinic's). */
export async function saveHealthcodeSettingsFor(actor: SetupActor, f: HealthcodeSettingsFields): Promise<SetupResult<{ saved: true }>> {
  if (!actor.can("settings.setup")) return FORBIDDEN;
  if (actor.siteIds !== null) return WHOLE;
  const clinic = { siteCode: typeof f.siteCode === "string" ? f.siteCode : null, payeeProviderNumber: typeof f.payeeProviderNumber === "string" ? f.payeeProviderNumber : null };
  const parsed = HealthcodeSiteInputSchema.safeParse(clinic);
  if (!parsed.success) return invalidFields(parsed.error);
  const rows = (Array.isArray(f.sites) ? f.sites.slice(0, 200) : []).map((s) => ({
    siteId: String(s?.siteId ?? ""),
    siteCode: typeof s?.siteCode === "string" ? s.siteCode : null,
    payeeProviderNumber: typeof s?.payeeProviderNumber === "string" ? s.payeeProviderNumber : null,
  }));
  const fe: Record<string, string> = {};
  for (const r of rows) {
    const p = HealthcodeSiteInputSchema.safeParse(r);
    if (!p.success) for (const [k, v] of Object.entries(fieldErrors(p.error))) fe[`${k}-${r.siteId}`] = v;
  }
  if (Object.keys(fe).length) return fail(SETUP_MESSAGES.check, fe);
  return setupAttempt("setup.healthcode_settings_save", async () => {
    const ctx = actor.repo();
    const known = new Set((await listSites(ctx, actor.tenantId, { includeInactive: true })).map((s) => s.id));
    if (rows.some((r) => !known.has(r.siteId))) return NOT_FOUND;
    const current = await getHealthcodeSettings(ctx, actor.tenantId);
    const same = (a: { siteCode: string | null; payeeProviderNumber: string | null }, b: { siteCode?: string | null; payeeProviderNumber?: string | null }) =>
      (a.siteCode ?? null) === (b.siteCode ?? null) && (a.payeeProviderNumber ?? null) === (b.payeeProviderNumber ?? null);
    if (current.rev === 0 || !same(current.clinic, parsed.data)) await setClinicHealthcode(ctx, actor.tenantId, clinic, actor.actor);
    for (const r of rows) {
      const p = HealthcodeSiteInputSchema.parse(r);
      const before = current.sites[r.siteId] ?? { siteCode: null, payeeProviderNumber: null };
      if (!same(before, p)) await setSiteHealthcode(ctx, actor.tenantId, r.siteId, r, actor.actor);
    }
    return ok({ saved: true as const });
  });
}

/* ------------------------------------------------------------------------------------------------
 * HC08 – a practitioner's provider number with each insurer (Set-up → Practitioners)
 * ----------------------------------------------------------------------------------------------*/

export async function practitionerInsurerNumbersFor(actor: SetupActor, practitionerId: string | null): Promise<SetupResult<PractitionerInsurerNumbersView | null>> {
  if (!actor.can("settings.setup")) return FORBIDDEN;
  if (!practitionerId || !plausibleId(practitionerId)) return ok(null);
  return setupAttempt("setup.practitioner_insurer_numbers", async () => {
    const ctx = actor.repo();
    const p = await getPractitioner(ctx, actor.tenantId, practitionerId);
    if (!p) return ok(null);
    const [insurers, numbers] = await Promise.all([listReferrers(ctx, actor.tenantId, { kind: "insurer", limit: 500 }), practitionerInsurerNumbers(ctx, actor.tenantId, [p.id])]);
    return ok({
      practitionerId: p.id,
      name: p.displayName,
      insurers: insurers.map((r) => ({ referrerId: r.id, name: r.name, providerNumber: numbers.get(pairKey(p.id, r.id))?.providerNumber ?? "" })),
      canEdit: actor.siteIds === null,
    });
  });
}

/** Saves the numbers given (blank = removed); only changed ones are written. */
export async function savePractitionerInsurerNumbersFor(actor: SetupActor, practitionerId: string, rows: { referrerId: string; providerNumber?: string }[]): Promise<SetupResult<{ id: string }>> {
  if (!actor.can("settings.setup")) return FORBIDDEN;
  if (actor.siteIds !== null) return WHOLE;
  if (!plausibleId(practitionerId)) return NOT_FOUND;
  const list = (Array.isArray(rows) ? rows.slice(0, 500) : []).map((r) => ({ referrerId: String(r?.referrerId ?? ""), providerNumber: typeof r?.providerNumber === "string" ? r.providerNumber : "" }));
  const fe: Record<string, string> = {};
  for (const r of list) {
    const p = ProviderNumberSchema.safeParse(r.providerNumber);
    if (!p.success) fe[`number-${r.referrerId}`] = p.error.issues[0]?.message ?? SETUP_MESSAGES.check;
  }
  if (Object.keys(fe).length) return fail(SETUP_MESSAGES.check, fe);
  return setupAttempt("setup.practitioner_insurer_numbers_save", async () => {
    const ctx = actor.repo();
    const p = await getPractitioner(ctx, actor.tenantId, practitionerId);
    if (!p) return NOT_FOUND;
    const insurers = new Set((await listReferrers(ctx, actor.tenantId, { kind: "insurer", includeInactive: true, limit: 500 })).map((r) => r.id));
    if (list.some((r) => !insurers.has(r.referrerId))) return NOT_FOUND;
    const current = await practitionerInsurerNumbers(ctx, actor.tenantId, [p.id]);
    for (const r of list) {
      const next = (ProviderNumberSchema.parse(r.providerNumber) as string | null | undefined) ?? null;
      const before = current.get(pairKey(p.id, r.referrerId))?.providerNumber ?? null;
      if (next !== before) await setPractitionerInsurerNumber(ctx, actor.tenantId, p.id, r.referrerId, next, actor.actor);
    }
    return ok({ id: p.id });
  });
}
