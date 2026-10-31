/**
 * The shared patient record and clinic directory: input schemas (zod v4). SOURCE OF TRUTH for what the
 * repositories (src/server/repos/pms/*) accept. Pure – browser-safe, used by forms on both sides.
 *
 * Conventions
 * - camelCase fields; dates "YYYY-MM-DD" (UK calendar dates); money in whole pence (integers);
 * - optional text: undefined = "not given / unchanged", null or "" = "clear it";
 * - free text that could hold clinical or personal detail (alerts, notes, referral reasons) is encrypted at rest
 *   by the repositories – the schemas only limit its size;
 * - shared contract (orchestrator-owned after the foundation): later modules may only ADD optional fields here,
 *   through the orchestrator (contract §4).
 */
import { z } from "zod";
import { isIsoDate, isPlausiblePhone, normalisePostcode } from "./text";

/* ------------------------------------------------------------------------------------------------
 * Primitives
 * ----------------------------------------------------------------------------------------------*/

/** A record id made by the repositories: "<prefix>_<ULID>" (or an id from an earlier system on import). */
export const PmsIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, "Not a valid id");

export const IsoDateSchema = z.string().refine(isIsoDate, "Enter a date as YYYY-MM-DD");

/** Optional text: trimmed; "" becomes null. */
export const optionalText = (max: number) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v))
    .refine((v) => v === undefined || v === null || v.length <= max, `At most ${max} characters`);

/** Required text, trimmed. */
export const requiredText = (max: number) => z.string().trim().min(1, "Required").max(max, `At most ${max} characters`);

export const PhoneSchema = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim().replace(/\s+/g, " ")) : v))
  .refine((v) => v === undefined || v === null || isPlausiblePhone(v), "Enter a UK phone number (or an international number starting with +)");

export const EmailSchema = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim().toLowerCase()) : v))
  .refine((v) => v === undefined || v === null || (v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)), "Enter a valid email address");

export const PostcodeSchema = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (typeof v !== "string") return v;
    if (v.trim() === "") return null;
    const normal = normalisePostcode(v);
    if (!normal) {
      ctx.addIssue({ code: "custom", message: "Enter a UK postcode" });
      return z.NEVER;
    }
    return normal;
  });

export const OptionalDateSchema = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => (typeof v === "string" && v.trim() === "" ? null : v))
  .refine((v) => v === undefined || v === null || isIsoDate(v), "Enter a date as YYYY-MM-DD");

/** Up to 6 address lines (street, locality, town, county…), the postcode separate. */
export const AddressLinesSchema = z
  .union([z.array(z.string()), z.null()])
  .optional()
  .transform((v) => (Array.isArray(v) ? v.map((l) => l.trim()).filter(Boolean) : v))
  .transform((v) => (Array.isArray(v) && v.length === 0 ? null : v))
  .refine((v) => !Array.isArray(v) || (v.length <= 6 && v.every((l) => l.length <= 120)), "At most 6 address lines of 120 characters");

export const MoneyPenceSchema = z.number().int("Whole pence only").min(0).max(100_000_000);
export const OptionalMoneySchema = z.union([MoneyPenceSchema, z.null()]).optional();

export const HexColourSchema = z.union([z.string().regex(/^#[0-9a-fA-F]{6}$/, "A colour like #0D9488"), z.null()]).optional();

export const SortOrderSchema = z.number().int().min(0).max(100_000).optional();

/** Reference of the same record in an earlier system (import de-duplication): unique per clinic. */
export const ImportRefSchema = optionalText(80);

/* ------------------------------------------------------------------------------------------------
 * Enumerations
 * ----------------------------------------------------------------------------------------------*/

export const SEX_VALUES = ["female", "male", "other", "unknown"] as const;
export const SexSchema = z.enum(SEX_VALUES);

export const PATIENT_STATUSES = ["active", "archived", "deceased"] as const;
export const PatientStatusSchema = z.enum(PATIENT_STATUSES);

/** Who pays for a case. */
export const PAYER_TYPES = ["self_pay", "insurer", "mlc", "solicitor", "employer", "other"] as const;
export const PayerTypeSchema = z.enum(PAYER_TYPES);

export const CASE_STATUSES = ["open", "discharged", "closed"] as const;
export const CaseStatusSchema = z.enum(CASE_STATUSES);

/** Referrers and payer accounts: the clinic's directory of organisations and people. */
export const REFERRER_KINDS = ["gp", "consultant", "insurer", "mlc", "solicitor", "employer", "case_manager", "self", "other"] as const;
export const ReferrerKindSchema = z.enum(REFERRER_KINDS);

export const PROFESSIONS = ["physiotherapist", "sports_therapist", "osteopath", "chiropractor", "podiatrist", "massage_therapist", "other"] as const;
export const ProfessionSchema = z.enum(PROFESSIONS);

export const SERVICE_CATEGORIES = ["initial", "follow_up", "assessment", "treatment", "class", "admin", "other"] as const;
export const ServiceCategorySchema = z.enum(SERVICE_CATEGORIES);

export const MARKETING_SOURCES = ["verbal", "written", "online", "import"] as const;
export const MarketingSourceSchema = z.enum(MARKETING_SOURCES);

export const AUTHORISATION_STATUSES = ["active", "cancelled"] as const;
export const AuthorisationStatusSchema = z.enum(AUTHORISATION_STATUSES);

/* ------------------------------------------------------------------------------------------------
 * Clinic directory: sites, rooms, practitioners, services (appointment types), price lists, referrers
 * ----------------------------------------------------------------------------------------------*/

export const SiteInputSchema = z.object({
  name: requiredText(120),
  /** Short code shown in the diary, e.g. "BLE". */
  code: z.union([z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,8}$/, "1–8 letters or digits"), z.null()]).optional(),
  address: AddressLinesSchema,
  postcode: PostcodeSchema,
  phone: PhoneSchema,
  email: EmailSchema,
  active: z.boolean().optional(),
  sortOrder: SortOrderSchema,
  importRef: ImportRefSchema,
});
export type SiteInput = z.input<typeof SiteInputSchema>;
export const SitePatchSchema = SiteInputSchema.partial();
export type SitePatch = z.input<typeof SitePatchSchema>;

export const RoomInputSchema = z.object({
  siteId: PmsIdSchema,
  name: requiredText(80),
  active: z.boolean().optional(),
  sortOrder: SortOrderSchema,
  importRef: ImportRefSchema,
});
export type RoomInput = z.input<typeof RoomInputSchema>;
export const RoomPatchSchema = RoomInputSchema.omit({ siteId: true }).partial();
export type RoomPatch = z.input<typeof RoomPatchSchema>;

export const PractitionerInputSchema = z.object({
  /** The member's account (Better Auth user id) when the practitioner signs in; null for diary-only rows. */
  userId: z.union([PmsIdSchema, z.null()]).optional(),
  displayName: requiredText(120),
  profession: ProfessionSchema.optional(),
  /** Professional registration number as shown on the register (fictional demo: PH-DEMO-0N). */
  registrationNumber: z
    .union([z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,20}$/, "Letters, digits and hyphens"), z.null()])
    .optional()
    .transform((v) => (v === "" ? null : v)),
  email: EmailSchema,
  phone: PhoneSchema,
  colour: HexColourSchema,
  defaultSiteId: z.union([PmsIdSchema, z.null()]).optional(),
  /** Shown as a column in the diary. */
  bookable: z.boolean().optional(),
  onlineBookable: z.boolean().optional(),
  active: z.boolean().optional(),
  sortOrder: SortOrderSchema,
  importRef: ImportRefSchema,
});
export type PractitionerInput = z.input<typeof PractitionerInputSchema>;
export const PractitionerPatchSchema = PractitionerInputSchema.partial();
export type PractitionerPatch = z.input<typeof PractitionerPatchSchema>;

export const ServiceInputSchema = z.object({
  name: requiredText(120),
  code: z.union([z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,20}$/, "Letters, digits and hyphens"), z.null()]).optional(),
  category: ServiceCategorySchema.optional(),
  durationMinutes: z.number().int().min(5).max(480).refine((n) => n % 5 === 0, "In steps of 5 minutes"),
  bufferMinutes: z.number().int().min(0).max(120).optional(),
  defaultPricePence: OptionalMoneySchema,
  colour: HexColourSchema,
  onlineBookable: z.boolean().optional(),
  active: z.boolean().optional(),
  sortOrder: SortOrderSchema,
  importRef: ImportRefSchema,
});
export type ServiceInput = z.input<typeof ServiceInputSchema>;
export const ServicePatchSchema = ServiceInputSchema.partial();
export type ServicePatch = z.input<typeof ServicePatchSchema>;

export const ReferrerInputSchema = z.object({
  kind: ReferrerKindSchema,
  name: requiredText(160),
  contactName: optionalText(120),
  email: EmailSchema,
  phone: PhoneSchema,
  address: AddressLinesSchema,
  postcode: PostcodeSchema,
  /** Free text, encrypted at rest. */
  notes: optionalText(4000),
  active: z.boolean().optional(),
  importRef: ImportRefSchema,
});
export type ReferrerInput = z.input<typeof ReferrerInputSchema>;
export const ReferrerPatchSchema = ReferrerInputSchema.partial();
export type ReferrerPatch = z.input<typeof ReferrerPatchSchema>;

const priceListShape = {
  name: requiredText(120),
  /** The payers this list is for (null = any). */
  payerType: z.union([PayerTypeSchema, z.null()]).optional(),
  /** One insurer's (or MLC's) own price list. */
  referrerId: z.union([PmsIdSchema, z.null()]).optional(),
  isDefault: z.boolean().optional(),
  validFrom: OptionalDateSchema,
  validTo: OptionalDateSchema,
  active: z.boolean().optional(),
};
export const PriceListInputSchema = z.object(priceListShape).refine((v) => !v.validFrom || !v.validTo || v.validFrom <= v.validTo, {
  message: "The end date is before the start date",
  path: ["validTo"],
});
export type PriceListInput = z.input<typeof PriceListInputSchema>;
export const PriceListPatchSchema = z.object(priceListShape).partial();
export type PriceListPatch = z.input<typeof PriceListPatchSchema>;

export const PriceListItemInputSchema = z.object({
  priceListId: PmsIdSchema,
  serviceId: PmsIdSchema,
  pricePence: MoneyPenceSchema,
  /** The payer's own code for the service (insurer billing). */
  billingCode: z.union([z.string().trim().toUpperCase().regex(/^[A-Z0-9.-]{1,20}$/, "Letters, digits, '.' and '-'"), z.null()]).optional(),
});
export type PriceListItemInput = z.input<typeof PriceListItemInputSchema>;

/* ------------------------------------------------------------------------------------------------
 * Patients
 * ----------------------------------------------------------------------------------------------*/

const patientShape = {
  title: optionalText(20),
  firstName: requiredText(80),
  lastName: requiredText(80),
  preferredName: optionalText(80),
  dateOfBirth: OptionalDateSchema,
  sex: z.union([SexSchema, z.null()]).optional(),
  email: EmailSchema,
  phoneMobile: PhoneSchema,
  phoneHome: PhoneSchema,
  phoneWork: PhoneSchema,
  address: AddressLinesSchema,
  postcode: PostcodeSchema,
  occupation: optionalText(120),
  employer: optionalText(160),
  emergencyName: optionalText(120),
  emergencyPhone: PhoneSchema,
  emergencyRelationship: optionalText(60),
  gpName: optionalText(120),
  gpPractice: optionalText(160),
  gpPhone: PhoneSchema,
  gpAddress: AddressLinesSchema,
  gpPostcode: PostcodeSchema,
  /** Consent to assessment and treatment recorded (date kept by the repository). */
  consentTreatment: z.boolean().optional(),
  /** May the clinic write to the patient's GP. */
  consentShareGp: z.boolean().optional(),
  /** Appointment reminders (service messages, not marketing): on unless the patient opts out. */
  reminderSms: z.boolean().optional(),
  reminderEmail: z.boolean().optional(),
  /** Marketing (PECR): opt-in only, never pre-ticked. */
  marketingEmail: z.boolean().optional(),
  marketingSms: z.boolean().optional(),
  /** How marketing consent was given (required when either marketing flag is on). */
  marketingConsentSource: z.union([MarketingSourceSchema, z.null()]).optional(),
  /** Medical alerts shown on the record (allergies, precautions). Encrypted. */
  alerts: optionalText(4000),
  /** Administrative notes. Encrypted. */
  notes: optionalText(8000),
  importRef: ImportRefSchema,
};

function checkPatient(v: { dateOfBirth?: string | null; marketingEmail?: boolean; marketingSms?: boolean; marketingConsentSource?: string | null }, ctx: z.RefinementCtx, today: string): void {
  if (v.dateOfBirth && (v.dateOfBirth > today || v.dateOfBirth < "1900-01-01")) {
    ctx.addIssue({ code: "custom", path: ["dateOfBirth"], message: "Enter a date of birth between 1900 and today" });
  }
  if ((v.marketingEmail || v.marketingSms) && !v.marketingConsentSource) {
    ctx.addIssue({ code: "custom", path: ["marketingConsentSource"], message: "Record how the patient agreed to marketing" });
  }
}

/** today = "YYYY-MM-DD" (UK) – passed in so the rule is testable. */
export function patientInputSchema(today: string) {
  return z.object(patientShape).superRefine((v, ctx) => checkPatient(v, ctx, today));
}
export function patientPatchSchema(today: string) {
  return z
    .object(patientShape)
    .partial()
    .superRefine((v, ctx) => checkPatient(v, ctx, today));
}
export type PatientInput = z.input<ReturnType<typeof patientInputSchema>>;
export type PatientPatch = z.input<ReturnType<typeof patientPatchSchema>>;

export const PatientStatusChangeSchema = z.object({
  status: PatientStatusSchema,
});

/* ------------------------------------------------------------------------------------------------
 * Cases (episodes of care) and their payer
 * ----------------------------------------------------------------------------------------------*/

const caseShape = {
  /** Short label shown in the diary and lists, e.g. "Right knee". Keep clinical detail for the notes. */
  title: requiredText(120),
  status: CaseStatusSchema.optional(),
  openedOn: IsoDateSchema,
  closedOn: OptionalDateSchema,
  practitionerId: z.union([PmsIdSchema, z.null()]).optional(),
  siteId: z.union([PmsIdSchema, z.null()]).optional(),
  payerType: PayerTypeSchema.optional(),
  /** The insurer / MLC / solicitor / employer account in the directory (null for self-pay). */
  payerReferrerId: z.union([PmsIdSchema, z.null()]).optional(),
  /** Insurer membership or policy number. */
  membershipNumber: optionalText(40),
  /** Claim number, or the MLC's / solicitor's reference. */
  claimReference: optionalText(60),
  /** Insurance excess the patient pays. */
  excessPence: OptionalMoneySchema,
  priceListId: z.union([PmsIdSchema, z.null()]).optional(),
  /** Who referred the patient (GP, consultant, insurer…). */
  referrerId: z.union([PmsIdSchema, z.null()]).optional(),
  referralReceivedOn: OptionalDateSchema,
  /** Date of the accident or injury (road traffic and workplace cases). */
  injuryOn: OptionalDateSchema,
  /** Reason for referral. Encrypted. */
  referralReason: optionalText(4000),
  /** Case notes (administrative). Encrypted. */
  notes: optionalText(8000),
  importRef: ImportRefSchema,
};

export const CaseInputSchema = z
  .object({ patientId: PmsIdSchema, ...caseShape })
  .refine((v) => !v.closedOn || v.closedOn >= v.openedOn, { message: "The case cannot close before it opens", path: ["closedOn"] });
export type CaseInput = z.input<typeof CaseInputSchema>;
export const CasePatchSchema = z.object(caseShape).partial();
export type CasePatch = z.input<typeof CasePatchSchema>;

/* ------------------------------------------------------------------------------------------------
 * Treatment authorisations (insurer pre-authorisations: code, sessions and/or value, expiry)
 * ----------------------------------------------------------------------------------------------*/

const authorisationShape = {
  /** Who issued it (usually the case's insurer). */
  referrerId: z.union([PmsIdSchema, z.null()]).optional(),
  code: requiredText(60),
  /** null = no session limit. */
  sessionsAuthorised: z.union([z.number().int().min(0).max(999), z.null()]).optional(),
  /** null = no value limit. */
  valueAuthorisedPence: OptionalMoneySchema,
  validFrom: OptionalDateSchema,
  expiresOn: OptionalDateSchema,
  status: AuthorisationStatusSchema.optional(),
  /** Encrypted. */
  notes: optionalText(4000),
  importRef: ImportRefSchema,
};

export const AuthorisationInputSchema = z
  .object({ caseId: PmsIdSchema, ...authorisationShape })
  .refine((v) => !v.validFrom || !v.expiresOn || v.validFrom <= v.expiresOn, { message: "It expires before it starts", path: ["expiresOn"] });
export type AuthorisationInput = z.input<typeof AuthorisationInputSchema>;
export const AuthorisationPatchSchema = z.object(authorisationShape).partial();
export type AuthorisationPatch = z.input<typeof AuthorisationPatchSchema>;

/** Sessions or value used (positive) or given back (negative, e.g. a cancelled invoice). */
export const AuthorisationUsageSchema = z
  .object({
    sessions: z.number().int().min(-999).max(999).optional(),
    valuePence: z.number().int().min(-100_000_000).max(100_000_000).optional(),
  })
  .refine((v) => (v.sessions ?? 0) !== 0 || (v.valuePence ?? 0) !== 0, "Nothing to record");
export type AuthorisationUsage = z.input<typeof AuthorisationUsageSchema>;

/* ------------------------------------------------------------------------------------------------
 * Clinic settings for the clinic system
 * ----------------------------------------------------------------------------------------------*/

export const PmsSettingsInputSchema = z.object({
  /** Clinical records of adults are kept at least this many years after the last treatment (minimum 8). */
  retentionAdultYears: z.number().int().min(8).max(100).optional(),
  /** Children's records: kept at least until this birthday (minimum 25). */
  retentionChildUntilAge: z.number().int().min(25).max(40).optional(),
});
export type PmsSettingsInput = z.input<typeof PmsSettingsInputSchema>;

/** Readable messages from a zod error, by field (forms show them next to the field). */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.map(String).join(".") : "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
