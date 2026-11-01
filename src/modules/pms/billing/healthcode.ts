/**
 * Healthcode e-billing groundwork (docs/clinic-system/healthcode.md): the identifiers and codes a clinic records so
 * its insurer bills can go through Healthcode once file submission is switched on. Pure (browser-safe).
 *
 * Nothing here sends anything. The file format itself waits on Healthcode's specification; these are the facts every
 * bill needs whatever the format: the insurer's Healthcode identifier, the clinic's provider numbers, the Site ID,
 * the practitioners' numbers with each insurer and each treatment's insurer code.
 *
 * Formats are deliberately broad (letters, digits and a few separators): Healthcode and each insurer issue the values,
 * the clinic types them in as given. No real code values are built in.
 */
import { z } from "zod";

/** The insurer's Healthcode identifier, as Healthcode lists it (for example "bup"). Letters and digits, 2–12. */
export const INSURER_CODE_PATTERN = /^[A-Za-z0-9]{2,12}$/;
/** A provider number (the clinic's or a practitioner's, with one insurer): letters, digits, "/", "-", ".", up to 30. */
export const PROVIDER_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/.-]{0,29}$/;

const blankToNull = (v: unknown): unknown => (typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v);

/** An optional code: trimmed, "" = none, else it must match `pattern`. */
export function optionalCode(pattern: RegExp, message: string) {
  return z.preprocess(blankToNull, z.union([z.string().regex(pattern, message), z.null()]).optional());
}

export const InsurerCodeSchema = optionalCode(INSURER_CODE_PATTERN, "Letters and numbers only, 2 to 12 characters (as Healthcode lists it)");
export const ProviderNumberSchema = optionalCode(PROVIDER_NUMBER_PATTERN, "Letters, numbers, / - and . only, up to 30 characters");

/** A payer account's Healthcode details (Set-up → Referrers and insurers). */
export const PayerHealthcodeInputSchema = z.object({
  insurerCode: InsurerCodeSchema,
  providerNumber: ProviderNumberSchema,
  /** null = the default for the insurer's name (diagnosisRequiredByDefault). */
  diagnosisRequired: z.union([z.boolean(), z.null()]).optional(),
});
export type PayerHealthcodeInput = z.input<typeof PayerHealthcodeInputSchema>;

export interface PayerHealthcode {
  referrerId: string;
  rev: number;
  insurerCode: string | null;
  providerNumber: string | null;
  /** The clinic's own choice; null = the default for the insurer's name. */
  diagnosisRequired: boolean | null;
  updatedAt: string | null;
}

/** The Healthcode card of a payer account on Set-up → Referrers and insurers. */
export interface PayerHealthcodeView {
  referrerId: string;
  name: string;
  details: PayerHealthcode | null;
  /** Whether bills need a diagnosis code when the clinic leaves it at the default (by the insurer's name). */
  diagnosisDefault: boolean;
  canEdit: boolean;
}

/**
 * Insurers that ask for a diagnosis code on every bill unless the clinic says otherwise: Bupa, AXA Health and Vitality
 * (matched on the payer account's name). The clinic can switch it on or off per insurer.
 */
const DIAGNOSIS_BY_DEFAULT = /\b(bupa|axa|vitality)\b/i;

export function diagnosisRequiredByDefault(payerName: string): boolean {
  return DIAGNOSIS_BY_DEFAULT.test(payerName);
}

/** Whether bills to this insurer need a diagnosis code: the clinic's choice, else the default for its name. */
export function diagnosisRequired(payerName: string, own: boolean | null | undefined): boolean {
  return typeof own === "boolean" ? own : diagnosisRequiredByDefault(payerName);
}

/** Healthcode applies to insurers (payer accounts of kind "insurer"). */
export function isHealthcodePayerKind(kind: string): boolean {
  return kind === "insurer";
}

/* ------------------------------------------------------------------------------------------------
 * HC07 – the clinic's (and a site's) Healthcode Site ID and payee provider number
 * ----------------------------------------------------------------------------------------------*/

/** A Healthcode Site ID: letters, digits and "-", up to 20. */
export const SITE_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,19}$/;
export const SiteCodeSchema = optionalCode(SITE_CODE_PATTERN, "Letters, numbers and - only, up to 20 characters");

export const HealthcodeSiteInputSchema = z.object({
  siteCode: SiteCodeSchema,
  payeeProviderNumber: ProviderNumberSchema,
});
export type HealthcodeSiteInput = z.input<typeof HealthcodeSiteInputSchema>;

export interface HealthcodeSiteDetails {
  siteCode: string | null;
  payeeProviderNumber: string | null;
}

export interface HealthcodeSettings {
  /** The clinic's own (0 = not set up yet). */
  rev: number;
  clinic: HealthcodeSiteDetails;
  /** Sites registered separately (site id → their own; a null field = the clinic's). */
  sites: Record<string, HealthcodeSiteDetails>;
  updatedAt: string | null;
}

export const NO_HEALTHCODE_SETTINGS: HealthcodeSettings = { rev: 0, clinic: { siteCode: null, payeeProviderNumber: null }, sites: {}, updatedAt: null };

/** What bills from a site use: the site's own Site ID / payee provider number, else the clinic's. */
export function healthcodeForSite(settings: HealthcodeSettings, siteId: string | null): HealthcodeSiteDetails {
  const own = siteId ? settings.sites[siteId] : undefined;
  return {
    siteCode: own?.siteCode ?? settings.clinic.siteCode,
    payeeProviderNumber: own?.payeeProviderNumber ?? settings.clinic.payeeProviderNumber,
  };
}

/** The Healthcode card on Set-up → Billing settings. */
export interface HealthcodeSettingsView {
  settings: HealthcodeSettings;
  sites: { id: string; name: string }[];
  canEdit: boolean;
}
