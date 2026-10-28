/**
 * Portal module inputs (zod v4): booking settings and online hours (staff), the public booking request and the
 * portal sign-in request (patients), intake forms, typed signatures and shared documents. SOURCE OF TRUTH for what
 * the portal repositories and services accept. Pure – browser-safe.
 */
import { z } from "zod";
import { EmailSchema, PhoneSchema, PmsIdSchema, OptionalDateSchema, optionalText, requiredText } from "../core/schemas";
import { isIsoDate } from "../core/text";
import { FIELD_ID_PATTERN, FIELD_TYPES, FORM_LIMITS, RECORD_FIELD_KEYS, SIGNATURE_NAME_MAX, definitionProblems, type FormDefinition } from "./forms";
import { isIsoInstant } from "./time";

/* ------------------------------------------------------------------------------------------------
 * Booking settings and sites (staff with "settings.setup")
 * ----------------------------------------------------------------------------------------------*/

export const SLOT_STEPS = [5, 10, 15, 20, 30, 60] as const;

export const BookingSettingsInputSchema = z.object({
  /** The public booking page is open. */
  onlineBooking: z.boolean().optional(),
  /** Patients may sign in to the portal (one-time links to the email address on their record). */
  portal: z.boolean().optional(),
  /** People who are not yet patients may book (as new patients). */
  newPatients: z.boolean().optional(),
  minNoticeHours: z.number().int().min(0).max(336).optional(),
  maxDaysAhead: z.number().int().min(1).max(365).optional(),
  slotStepMinutes: z
    .number()
    .int()
    .refine((n) => (SLOT_STEPS as readonly number[]).includes(n), "Choose 5, 10, 15, 20, 30 or 60 minutes")
    .optional(),
  cancelNoticeHours: z.number().int().min(0).max(336).optional(),
  /** Patients may cancel or move a booking online (within the notice period). */
  patientCancel: z.boolean().optional(),
  /** Shown at the top of the booking page. Not for clinical detail. */
  introText: optionalText(600),
  cancellationPolicy: optionalText(1000),
  contactPhone: PhoneSchema,
  contactEmail: EmailSchema,
});
export type BookingSettingsInput = z.input<typeof BookingSettingsInputSchema>;

/** A site's online-booking switch and map position (Set-up → Online booking). */
export const BookingSiteInputSchema = z
  .object({
    siteId: PmsIdSchema,
    online: z.boolean(),
    latitude: z.number().min(49, "A latitude in the UK").max(61, "A latitude in the UK").nullable().optional(),
    longitude: z.number().min(-9, "A longitude in the UK").max(2, "A longitude in the UK").nullable().optional(),
  })
  .refine((v) => (v.latitude == null) === (v.longitude == null), { message: "Give both latitude and longitude, or neither", path: ["longitude"] });
export type BookingSiteInput = z.input<typeof BookingSiteInputSchema>;

/* ------------------------------------------------------------------------------------------------
 * Patients: the booking request and the portal sign-in request
 * ----------------------------------------------------------------------------------------------*/

const requiredEmail = z
  .string({ error: "Enter your email address" })
  .trim()
  .toLowerCase()
  .min(1, "Enter your email address")
  .max(254, "Enter a valid email address")
  .refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email address");

function dateOfBirth(today: string) {
  return z
    .string({ error: "Enter your date of birth" })
    .trim()
    .min(1, "Enter your date of birth")
    .refine(isIsoDate, "Enter a real date of birth")
    .refine((v) => v >= "1900-01-01" && v <= today, "Enter a date of birth in the past");
}

/** A booking from the public booking page (a new patient or an existing one – the response never says which). */
export function publicBookingSchema(today: string) {
  return z.object({
    siteId: PmsIdSchema,
    serviceId: PmsIdSchema,
    /** A practitioner, or "any" (the first one free at that time). */
    practitionerId: z.union([PmsIdSchema, z.literal("any")]),
    startsAt: z.string().refine(isIsoInstant, "Choose a time"),
    firstName: requiredText(80),
    lastName: requiredText(80),
    dateOfBirth: dateOfBirth(today),
    email: requiredEmail,
    phoneMobile: PhoneSchema.refine((v) => typeof v === "string" && v.length > 0, "Enter a mobile number"),
    /** Appointment reminders by text or email (service messages – the patient may opt out). */
    reminders: z.boolean().optional(),
    /** "self" = paying themselves, "insured" = health insurance (they bring the authorisation). */
    paying: z.enum(["self", "insured"]).optional(),
    /** Hidden field: people leave it empty. */
    website: z.string().max(500).optional(),
  });
}
export type PublicBookingInput = z.input<ReturnType<typeof publicBookingSchema>>;

/** A booking made by a signed-in portal patient (their details are on the record). */
export const PortalBookingSchema = z.object({
  siteId: PmsIdSchema,
  serviceId: PmsIdSchema,
  practitionerId: z.union([PmsIdSchema, z.literal("any")]),
  startsAt: z.string().refine(isIsoInstant, "Choose a time"),
});
export type PortalBookingInput = z.input<typeof PortalBookingSchema>;

/** The portal sign-in request (design: the email address only – the link goes to the address on the record). */
export const PortalSignInSchema = z.object({
  email: requiredEmail,
  website: z.string().max(500).optional(),
});
export type PortalSignInInput = z.input<typeof PortalSignInSchema>;

/* ------------------------------------------------------------------------------------------------
 * Intake and consent forms
 * ----------------------------------------------------------------------------------------------*/

export const INTAKE_FORM_KINDS = ["intake", "questionnaire", "consent"] as const;
export type IntakeFormKind = (typeof INTAKE_FORM_KINDS)[number];
/** A patient's copy: a form from a template, or an outcome questionnaire (no template – the records measures). */
export type IntakeResponseKind = IntakeFormKind | "outcome";
export const INTAKE_FORM_KIND_LABELS: Readonly<Record<IntakeFormKind, string>> = {
  intake: "Patient details",
  questionnaire: "Health questionnaire",
  consent: "Consent",
};

/** When the clinic sends a form by itself. */
export const SEND_WHEN = ["manual", "new_patient", "every_booking"] as const;
export type SendWhen = (typeof SEND_WHEN)[number];
export const SEND_WHEN_LABELS: Readonly<Record<SendWhen, string>> = {
  manual: "Only when staff send it",
  new_patient: "With a new patient's first online booking",
  every_booking: "With every online booking",
};

export const INTAKE_FORM_STATUSES = ["draft", "active", "archived"] as const;
export type IntakeFormStatus = (typeof INTAKE_FORM_STATUSES)[number];

export const FormFieldSchema = z.object({
  id: z.string().regex(FIELD_ID_PATTERN, "Use a–z, 0–9 and _ (start with a letter)"),
  type: z.enum(FIELD_TYPES),
  label: z.string().trim().min(1, "Add the question's wording").max(FORM_LIMITS.label),
  help: optionalText(FORM_LIMITS.help),
  required: z.boolean().optional(),
  options: z.array(z.string().trim().min(1).max(FORM_LIMITS.option)).max(FORM_LIMITS.options).optional(),
  sensitive: z.boolean().optional(),
  recordField: z.union([z.enum(RECORD_FIELD_KEYS as [string, ...string[]]), z.null()]).optional(),
});

export const FormDefinitionSchema = z
  .object({ fields: z.array(FormFieldSchema).max(FORM_LIMITS.fields) })
  .superRefine((def, ctx) => {
    for (const problem of definitionProblems(def as FormDefinition)) ctx.addIssue({ code: "custom", message: problem, path: ["fields"] });
  });

const templateShape = {
  name: requiredText(120),
  kind: z.enum(INTAKE_FORM_KINDS),
  description: optionalText(400),
  sendWhen: z.enum(SEND_WHEN).optional(),
  requiresSignature: z.boolean().optional(),
  /** Shown above the signature box. */
  signatureStatement: optionalText(600),
  /** Signing it (with every required box ticked) records consent to treatment on the patient's record. */
  setsTreatmentConsent: z.boolean().optional(),
  definition: FormDefinitionSchema,
};

export const IntakeTemplateInputSchema = z.object(templateShape).refine((v) => !v.setsTreatmentConsent || v.requiresSignature, {
  message: "A form that records consent must be signed",
  path: ["requiresSignature"],
});
export type IntakeTemplateInput = z.input<typeof IntakeTemplateInputSchema>;

export const IntakeTemplatePatchSchema = z.object({ ...templateShape, status: z.enum(INTAKE_FORM_STATUSES) }).partial();
export type IntakeTemplatePatch = z.input<typeof IntakeTemplatePatchSchema>;

export const SignatureInputSchema = z.object({
  typedName: z.string().trim().min(2, "Type your full name to sign").max(SIGNATURE_NAME_MAX),
  confirm: z.literal(true, { error: "Tick the box to confirm your signature" }),
});
export type SignatureInput = z.input<typeof SignatureInputSchema>;

/* ------------------------------------------------------------------------------------------------
 * Documents shared with the patient (exercise plans, letters – only what staff explicitly share)
 * ----------------------------------------------------------------------------------------------*/

export const PortalShareInputSchema = z.object({
  patientId: PmsIdSchema,
  title: requiredText(120),
  /** Plain text the patient reads in the portal. Encrypted at rest. */
  body: requiredText(20_000),
});
export type PortalShareInput = z.input<typeof PortalShareInputSchema>;

/** A file attached to the record, shared with the patient (PORTAL-004): a plain title and an optional message. */
export const PortalFileShareInputSchema = z.object({
  patientId: PmsIdSchema,
  attachmentId: PmsIdSchema,
  title: requiredText(120),
  /** Shown with the file in the portal. Encrypted at rest. */
  message: z.string().trim().max(2_000, "At most 2,000 characters").optional().nullable(),
});
export type PortalFileShareInput = z.input<typeof PortalFileShareInputSchema>;
