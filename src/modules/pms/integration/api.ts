/**
 * The public clinic API v1 (tracker xt03) – its pure rules: the platform switch, scopes, the key format, request
 * schemas, limits, cursors and the error codes. Browser-safe (the settings screen uses the scopes and copy too).
 * Server side: src/server/pms/integration/api/*, src/server/repos/pms/integration/api-*.ts. Docs:
 * docs/clinic-system/api.md.
 *
 * Off unless BOTH the platform switch CLINFORMS_CLINIC_API=on AND the clinic's own setting (pms_api_settings) are on.
 * Switch off: every /api/clinic/v1 route answers 404 and the settings screen does not exist.
 */
import { z } from "zod";
import { PmsIdSchema, IsoDateSchema } from "../core/schemas";
import { addDays, daysBetween, parseHhmm } from "../diary/time";

type Env = Readonly<Record<string, string | undefined>>;

export const CLINIC_API_ENV = "CLINFORMS_CLINIC_API";

/** The platform switch: "on" (any case, trimmed) – anything else is off. */
export function clinicApiSwitchOn(env: Env): boolean {
  return (
    String(env[CLINIC_API_ENV] ?? "")
      .trim()
      .toLowerCase() === "on"
  );
}

/* ------------------------------------------------------------------------------------------------
 * Scopes
 * ----------------------------------------------------------------------------------------------*/

export const API_SCOPES = ["appointments:read", "appointments:write", "patients:read", "invoices:read"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const API_SCOPE_LABELS: Readonly<Record<ApiScope, { label: string; hint: string }>> = {
  "appointments:read": { label: "Read appointments", hint: "Times, sites, practitioners and statuses. Never notes." },
  "appointments:write": { label: "Book appointments", hint: "Only into free online-bookable times, by the diary's own rules." },
  "patients:read": { label: "Read patients", hint: "Name, date of birth and contact details. Every read shows in the patient's history." },
  "invoices:read": { label: "Read invoices", hint: "Numbers, dates, amounts and balances. No descriptions or diagnoses." },
};

export function isApiScope(value: unknown): value is ApiScope {
  return typeof value === "string" && (API_SCOPES as readonly string[]).includes(value);
}

/** The scopes of a stored JSON array (unknown values dropped, order of API_SCOPES). */
export function parseScopes(json: string | null | undefined): ApiScope[] {
  try {
    const v = JSON.parse(json ?? "[]") as unknown;
    if (!Array.isArray(v)) return [];
    const set = new Set(v.filter(isApiScope));
    return API_SCOPES.filter((s) => set.has(s));
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------------------------------------
 * Key format
 * ----------------------------------------------------------------------------------------------*/

/**
 * "cdk_<clinic id>_<lookup: 16 × [a-z0-9]>_<secret: 43 base64url characters = 256 random bits>". The clinic id is
 * part of the key so every lookup is scoped to one clinic; the lookup names the key's row; only the SHA-256 of the
 * whole key is stored and compared (constant time) on the server.
 */
export const API_KEY_PREFIX = "cdk_";
export const API_KEY_LOOKUP = /^[a-z0-9]{16}$/;
const TENANT = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;
/** Longest key we even look at (prefix + 63 + 1 + 16 + 1 + 43). */
export const API_KEY_MAX_LENGTH = 128;

export interface ParsedApiKey {
  tenantId: string;
  lookup: string;
}

export function parseApiKey(key: unknown): ParsedApiKey | null {
  if (typeof key !== "string" || key.length > API_KEY_MAX_LENGTH || !key.startsWith(API_KEY_PREFIX)) return null;
  const rest = key.slice(API_KEY_PREFIX.length);
  const sep = rest.indexOf("_");
  if (sep <= 0) return null;
  const tenantId = rest.slice(0, sep);
  const lookup = rest.slice(sep + 1, sep + 17);
  const tail = rest.slice(sep + 17);
  if (!TENANT.test(tenantId) || !API_KEY_LOOKUP.test(lookup) || tail[0] !== "_" || !SECRET.test(tail.slice(1))) return null;
  return { tenantId, lookup };
}

/** What a key list shows: "cdk_<clinic>_<lookup>…<last4>" (enough to tell keys apart, nothing to use). */
export function apiKeyLabel(tenantId: string, lookup: string, last4: string): string {
  return `${API_KEY_PREFIX}${tenantId}_${lookup}…${last4}`;
}

/** Bearer token from an Authorization header value, or null ("Bearer <key>", scheme case-insensitive). */
export function bearerToken(header: string | null | undefined): string | null {
  if (typeof header !== "string" || header.length > API_KEY_MAX_LENGTH + 16) return null;
  const m = /^Bearer[ ]+(\S+)[ ]*$/i.exec(header);
  return m ? m[1] : null;
}

/* ------------------------------------------------------------------------------------------------
 * Limits
 * ----------------------------------------------------------------------------------------------*/

export const API_LIMITS = {
  /** Longest appointment date range (inclusive days). */
  appointmentRangeDays: 31,
  /** Longest invoice date range (inclusive days). */
  invoiceRangeDays: 366,
  /** Free-slot search: days at once. */
  slotDays: 14,
  /** Page size: default and maximum. */
  pageDefault: 50,
  pageMax: 100,
  /** Patients per page (each read is logged in the patient's history – one audit row each). */
  patientPageMax: 50,
  /** Request body (POST) and query string. */
  maxBodyBytes: 8 * 1024,
  maxQueryChars: 2048,
  /** Requests per key per minute (a right key is limited by this only). */
  perKeyPerMinute: 120,
  /** Requests without a usable key per network per minute (in memory, per server instance – no database write). */
  anonPerIpPerMinute: 60,
  /** Wrong keys per presented key (its lookup) and per network in 10 minutes; then wrong keys get 429. */
  failedPerKeyPer10Minutes: 20,
  failedPerIpPer10Minutes: 20,
  /** A key's name. */
  nameMax: 80,
  /** Idempotency-Key header length. */
  idempotencyMin: 8,
  idempotencyMax: 100,
  /** Booking note (reception only – never clinical). */
  noteMax: 500,
  /** Keys a clinic may hold at once (active). */
  activeKeysMax: 20,
} as const;

/** Expiry choices on the settings screen (days; 0 = no expiry). */
export const API_KEY_EXPIRY_DAYS = [30, 90, 180, 365, 0] as const;
export type ApiKeyExpiryDays = (typeof API_KEY_EXPIRY_DAYS)[number];
/** Rotation: the old key keeps working this long after its replacement is made. */
export const API_ROTATION_GRACE_HOURS = 24;

/* ------------------------------------------------------------------------------------------------
 * Errors (consistent body: {"error": {"code", "message"}})
 * ----------------------------------------------------------------------------------------------*/

export const API_ERRORS = {
  NOT_FOUND: { status: 404, message: "Not found." },
  HTTPS_REQUIRED: { status: 403, message: "Use HTTPS." },
  UNAUTHENTICATED: { status: 401, message: "Send a valid API key as 'Authorization: Bearer <key>'." },
  API_OFF: { status: 403, message: "The clinic's API is switched off." },
  READ_ONLY: { status: 403, message: "The clinic's account is read-only: nothing new can be created or changed." },
  INSUFFICIENT_SCOPE: { status: 403, message: "This API key does not have the scope for this request." },
  SITE_NOT_ALLOWED: { status: 403, message: "This API key cannot use that site." },
  INVALID_REQUEST: { status: 422, message: "The request is not valid." },
  IDEMPOTENCY_KEY_REQUIRED: { status: 422, message: "Send an Idempotency-Key header (8–100 characters) with every booking." },
  IDEMPOTENCY_MISMATCH: { status: 422, message: "This Idempotency-Key was used with a different request." },
  SLOT_NOT_FREE: { status: 422, message: "That time is not free. Choose a time from GET /slots." },
  PAYLOAD_TOO_LARGE: { status: 413, message: "The request is too large." },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, message: "Send the body as application/json." },
  METHOD_NOT_ALLOWED: { status: 405, message: "This method is not allowed here." },
  RATE_LIMITED: { status: 429, message: "Too many requests. Wait and try again." },
  SERVER_ERROR: { status: 500, message: "Something went wrong. Please try again." },
} as const;
export type ApiErrorCode = keyof typeof API_ERRORS;

/** Query problems: field names and plain messages (never values). */
export function issuesText(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues
    .slice(0, 3)
    .map((i) => (i.path.length ? `${i.path.map(String).join(".")}: ${i.message}` : i.message))
    .join("; ");
}

/* ------------------------------------------------------------------------------------------------
 * Cursors: opaque base64url JSON of the last row's keyset (validated on the way in)
 * ----------------------------------------------------------------------------------------------*/

function b64urlEncode(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(text: string): string | null {
  if (!/^[A-Za-z0-9_-]{1,400}$/.test(text)) return null;
  try {
    return atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return null;
  }
}

export interface ApiCursor {
  /** Sort value of the last row (e.g. the appointment's start), "" for id-only lists. */
  s: string;
  /** Id of the last row. */
  i: string;
}

export function encodeCursor(c: ApiCursor): string {
  return b64urlEncode(JSON.stringify({ s: c.s, i: c.i }));
}

export function decodeCursor(text: string | null | undefined): ApiCursor | null | "invalid" {
  if (text === null || text === undefined || text === "") return null;
  const raw = b64urlDecode(text);
  if (raw === null) return "invalid";
  try {
    const v = JSON.parse(raw) as { s?: unknown; i?: unknown };
    if (typeof v.s !== "string" || v.s.length > 40 || typeof v.i !== "string" || !PmsIdSchema.safeParse(v.i).success) return "invalid";
    if (v.s !== "" && !/^[0-9T:.Z+-]{10,40}$/.test(v.s)) return "invalid";
    return { s: v.s, i: v.i };
  } catch {
    return "invalid";
  }
}

/* ------------------------------------------------------------------------------------------------
 * Request schemas
 * ----------------------------------------------------------------------------------------------*/

const limitOf = (max: number) =>
  z.preprocess((v) => (v === undefined || v === null || v === "" ? undefined : Number(v)), z.number().int().min(1).max(max).optional());
const optionalId = z.preprocess((v) => (v === "" ? undefined : v), PmsIdSchema.optional());
const cursor = z.string().max(400).optional();

function rangeCheck(max: number) {
  return (v: { from?: string; to?: string }, ctx: z.RefinementCtx) => {
    if (!v.from || !v.to) return;
    const span = daysBetween(v.from, v.to);
    if (span < 0) ctx.addIssue({ code: "custom", path: ["to"], message: "must be on or after from" });
    else if (span + 1 > max) ctx.addIssue({ code: "custom", path: ["to"], message: `the range is at most ${max} days` });
  };
}

export const APPOINTMENT_API_STATUSES = ["booked", "arrived", "in_treatment", "attended", "dna", "late_cancelled", "cancelled"] as const;

export const AppointmentsQuerySchema = z
  .object({
    from: IsoDateSchema,
    to: IsoDateSchema,
    siteId: optionalId,
    practitionerId: optionalId,
    status: z.enum(APPOINTMENT_API_STATUSES).optional(),
    limit: limitOf(API_LIMITS.pageMax),
    cursor,
  })
  .strict()
  .superRefine(rangeCheck(API_LIMITS.appointmentRangeDays));
export type AppointmentsQuery = z.infer<typeof AppointmentsQuerySchema>;

export const PATIENT_API_STATUSES = ["active", "archived", "deceased", "any"] as const;

export const PatientsQuerySchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    dateOfBirth: IsoDateSchema.optional(),
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    status: z.enum(PATIENT_API_STATUSES).optional(),
    limit: limitOf(API_LIMITS.patientPageMax),
    cursor,
  })
  .strict();
export type PatientsQuery = z.infer<typeof PatientsQuerySchema>;

export const INVOICE_API_STATUSES = ["draft", "issued", "cancelled"] as const;

export const InvoicesQuerySchema = z
  .object({
    from: IsoDateSchema.optional(),
    to: IsoDateSchema.optional(),
    status: z.enum(INVOICE_API_STATUSES).optional(),
    patientId: optionalId,
    limit: limitOf(API_LIMITS.pageMax),
    cursor,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (Boolean(v.from) !== Boolean(v.to)) ctx.addIssue({ code: "custom", path: [v.from ? "to" : "from"], message: "send from and to together" });
  })
  .superRefine(rangeCheck(API_LIMITS.invoiceRangeDays));
export type InvoicesQuery = z.infer<typeof InvoicesQuerySchema>;

export const SlotsQuerySchema = z
  .object({
    siteId: PmsIdSchema,
    serviceId: PmsIdSchema,
    from: IsoDateSchema,
    days: z.preprocess((v) => (v === undefined || v === "" ? undefined : Number(v)), z.number().int().min(1).max(API_LIMITS.slotDays).optional()),
    practitionerId: optionalId,
    limit: limitOf(API_LIMITS.pageMax),
  })
  .strict();
export type SlotsQuery = z.infer<typeof SlotsQuerySchema>;

export const BookingBodySchema = z
  .object({
    patientId: PmsIdSchema,
    serviceId: PmsIdSchema,
    practitionerId: PmsIdSchema,
    siteId: PmsIdSchema,
    /** UK date and 24-hour time (Europe/London) of the start. */
    date: IsoDateSchema,
    startTime: z.string().refine((v) => /^\d{2}:\d{2}$/.test(v) && parseHhmm(v) !== null, "use HH:MM (24-hour, UK time)"),
    caseId: PmsIdSchema.optional(),
    /** A booking note for reception – never clinical detail. */
    note: z.string().trim().max(API_LIMITS.noteMax).optional(),
    /** Ask the messages module to send the usual booking confirmation (default false). */
    sendConfirmation: z.boolean().optional(),
  })
  .strict();
export type BookingBody = z.infer<typeof BookingBodySchema>;

/** The canonical form of a booking request (what the Idempotency-Key is bound to). */
export function canonicalBooking(b: BookingBody): string {
  return JSON.stringify([b.patientId, b.serviceId, b.practitionerId, b.siteId, b.date, b.startTime, b.caseId ?? null, b.note ?? null, b.sendConfirmation ?? false]);
}

export function validIdempotencyKey(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length >= API_LIMITS.idempotencyMin && value.length <= API_LIMITS.idempotencyMax && /^[A-Za-z0-9._:-]+$/.test(value);
}

/** Query parameters as a plain object (a repeated parameter = invalid: its value becomes an array). */
export function queryObject(params: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Array.from(params.entries())) {
    const prev = out[k];
    out[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Settings screen input
 * ----------------------------------------------------------------------------------------------*/

export const CreateApiKeySchema = z.object({
  name: z.string().trim().min(1, "Give the key a name").max(API_LIMITS.nameMax, `At most ${API_LIMITS.nameMax} characters`),
  scopes: z.array(z.enum(API_SCOPES)).min(1, "Choose at least one permission").max(API_SCOPES.length),
  /** Empty = every site. */
  siteIds: z.array(PmsIdSchema).max(90).default([]),
  expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(180), z.literal(365), z.literal(0)]),
});
export type CreateApiKeyInput = z.input<typeof CreateApiKeySchema>;

/** Expiry instant for a key made at `nowIso` (null = no expiry). */
export function expiryFrom(nowIso: string, days: number): string | null {
  if (!days) return null;
  return new Date(Date.parse(nowIso) + days * 86_400_000).toISOString();
}

/** First day after a date range (exclusive end) – for [from, to] inclusive ranges. */
export function dayAfter(date: string): string {
  return addDays(date, 1);
}

/** Wording for the settings screen (no vendor or technology names). */
export const API_COPY = {
  title: "API keys",
  intro: "Let another system the clinic uses read its appointments, patients and invoices, and book appointments into free times.",
  off: "The API is switched off for this clinic. No key works until an owner switches it on.",
  ownerOnly: "Only the clinic's owner can manage API keys.",
  shownOnce: "Copy the key now and store it in the other system's settings. It is shown only this once – only a fingerprint of it is kept.",
  revokeConfirm: (name: string) => `Revoke the key "${name}"? Anything using it stops working at once.`,
  rotateConfirm: (name: string) => `Make a new key to replace "${name}"? The old key keeps working for ${API_ROTATION_GRACE_HOURS} hours, then stops.`,
  tooMany: `A clinic can have at most ${API_LIMITS.activeKeysMax} active keys. Revoke one first.`,
} as const;
