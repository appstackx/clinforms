/**
 * Healthcode set-up (docs/clinic-system/healthcode.md) – the server layer of the Healthcode cards on the Set-up pages.
 * Same rules as Set-up (src/server/pms/reporting/setup.ts): settings.setup first, clinic-wide changes need every site,
 * ids read back from the member's clinic, inputs validated, the repository writes with its audit row, plain results.
 */
import "server-only";
export type { PayerHealthcodeView } from "../../../modules/pms/billing/healthcode";
import { z } from "zod";
import { PayerHealthcodeInputSchema, diagnosisRequiredByDefault, isHealthcodePayerKind, type PayerHealthcodeView } from "../../../modules/pms/billing/healthcode";
import { fieldErrors } from "../../../modules/pms/core/schemas";
import { logAuthEvent } from "../../email/log";
import { RepoInputError } from "../../repos/context";
import { getPayerHealthcode, setPayerHealthcode } from "../../repos/pms/billing/healthcode";
import { getReferrer } from "../../repos/pms/referrers";
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
