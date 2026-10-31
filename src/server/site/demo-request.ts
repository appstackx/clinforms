/**
 * ClinDesk's "Book a demo" form (clindesk.co.uk/demo → server action src/app/clindesk-site/demo/actions.ts).
 *
 * It is the existing access-request backend with a source tag (access-request.ts): the same `access_requests` table,
 * honeypot, rate limits (shared counters with ClinForms' "Request access") and optional notification email. The
 * table has no columns for the extra answers, so – exactly as "Request access" stores the number of sites – they go
 * at the top of the stored message, one "Label: value" line each, starting with "Source: clindesk":
 *
 *   Source: clindesk
 *   Sites: 2–5
 *   Practitioners: 8
 *   Current system: (the visitor's text)
 *   Interests: The diary, Billing and insurers
 *
 * The platform page reads the tag back with accessRequestSource() and labels the request "ClinDesk". No ClinForms
 * table or column changes. Every field is validated here, on the server; no patient information is asked for.
 *
 * Kept free of Next.js imports so it can be tested directly (demo-request.test.ts).
 */
import { z } from "zod";
import { createAccessRequest } from "../repos/access-requests";
import type { RepoContext } from "../repos/context";
import { accessRequestRateLimit, fieldErrorsOf, type NotificationPayload } from "./access-request";
import { DEMO_INTERESTS, DEMO_SITE_BANDS, type DemoInterest } from "@/lib/clindesk/demo-options";

export { DEMO_INTERESTS, DEMO_SITE_BANDS } from "@/lib/clindesk/demo-options";

const INTEREST_IDS = Object.keys(DEMO_INTERESTS) as [DemoInterest, ...DemoInterest[]];

/** The source tag of a ClinDesk request (first line of the stored message). */
export const CLINDESK_SOURCE = "clindesk";

/** Largest form accepted (characters across all fields). */
export const MAX_DEMO_REQUEST_CHARS = 4000;

const text = (label: string, max: number) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .min(2, `${label} is required.`)
    .max(max, `${label} must be at most ${max} characters.`);

/** No line breaks or control characters in one-line answers (each becomes one line of the stored message). */
const ONE_LINE = /^[^\u0000-\u001f\u007f]*$/;

export const DemoRequestSchema = z.object({
  name: text("Your name", 200).regex(ONE_LINE, "Your name must be on one line."),
  clinic: text("Clinic or group name", 200).regex(ONE_LINE, "Clinic or group name must be on one line."),
  email: z
    .string({ error: "Work email is required." })
    .trim()
    .min(1, "Work email is required.")
    .max(254, "Work email is too long.")
    .pipe(z.email("Enter a valid work email address, like name@clinic.co.uk.")),
  phone: z
    .string()
    .trim()
    .max(40, "Phone must be at most 40 characters.")
    .regex(/^[0-9+()\-.\s]*$/, "Phone may contain only digits, spaces and + ( ) - .")
    .optional()
    .default(""),
  sites: z.enum(DEMO_SITE_BANDS, { error: "Choose the number of sites." }),
  practitioners: z
    .string()
    .trim()
    .regex(/^\d{0,3}$/, "Number of practitioners must be a whole number from 1 to 999.")
    .refine((v) => v === "" || (Number(v) >= 1 && Number(v) <= 999), "Number of practitioners must be a whole number from 1 to 999.")
    .optional()
    .default(""),
  currentSystem: z
    .string()
    .trim()
    .max(120, "Your current system must be at most 120 characters.")
    .regex(ONE_LINE, "Your current system must be on one line.")
    .optional()
    .default(""),
  interests: z
    .array(z.enum(INTEREST_IDS, { error: "Choose from the list." }))
    .max(INTEREST_IDS.length)
    .optional()
    .default([])
    .transform((v) => INTEREST_IDS.filter((id) => v.includes(id))),
  /** Honeypot: hidden from people, filled by naive bots. */
  website: z.string().max(500).optional().default(""),
});

export type DemoRequestBody = z.infer<typeof DemoRequestSchema>;

/** The form's field names (input `name`s) for each schema key – error messages are keyed by these. */
export const DEMO_FIELD_NAMES = {
  name: "name",
  clinic: "clinic",
  email: "email",
  phone: "phone",
  sites: "sites",
  practitioners: "practitioners",
  currentSystem: "current_system",
  interests: "see",
  website: "website",
} as const satisfies Record<keyof DemoRequestBody, string>;

/** Reads the posted form (FormData or any record of strings) into the schema's input shape. */
export function demoRequestInput(form: FormData): Record<string, unknown> {
  const one = (name: string) => {
    const v = form.get(name);
    return typeof v === "string" ? v : undefined;
  };
  return {
    name: one(DEMO_FIELD_NAMES.name),
    clinic: one(DEMO_FIELD_NAMES.clinic),
    email: one(DEMO_FIELD_NAMES.email),
    phone: one(DEMO_FIELD_NAMES.phone),
    sites: one(DEMO_FIELD_NAMES.sites),
    practitioners: one(DEMO_FIELD_NAMES.practitioners),
    currentSystem: one(DEMO_FIELD_NAMES.currentSystem),
    interests: form.getAll(DEMO_FIELD_NAMES.interests).filter((v): v is string => typeof v === "string"),
    website: one(DEMO_FIELD_NAMES.website),
  };
}

/** The extra answers as "Label: value" rows (stored message head and notification email). */
export function demoDetails(body: DemoRequestBody): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  if (body.practitioners) rows.push(["Practitioners", body.practitioners]);
  if (body.currentSystem) rows.push(["Current system", body.currentSystem]);
  if (body.interests.length) rows.push(["Interests", body.interests.map((id) => DEMO_INTERESTS[id]).join(", ")]);
  return rows;
}

/** The stored message: the source tag, the number of sites and the extra answers, one line each. */
export function demoStoredMessage(body: DemoRequestBody): string {
  return [`Source: ${CLINDESK_SOURCE}`, `Sites: ${body.sites}`, ...demoDetails(body).map(([k, v]) => `${k}: ${v}`)].join("\n");
}

export type AccessRequestSource = "clinforms" | "clindesk";

/** Which form a stored request came from: "clindesk" when its message starts with the source line, else ClinForms. */
export function accessRequestSource(message: string | null | undefined): AccessRequestSource {
  return typeof message === "string" && message.split("\n", 1)[0] === `Source: ${CLINDESK_SOURCE}` ? "clindesk" : "clinforms";
}

export type DemoRequestOutcome =
  | { kind: "stored"; id: string; notified?: boolean }
  | { kind: "spam" }
  | { kind: "invalid"; fieldErrors: Record<string, string> }
  | { kind: "rate_limited"; retryAfterSeconds: number };

export interface DemoRequestDeps {
  ctx: RepoContext;
  /** Pseudonymous client key (hashClientIp), or null when the client address is unknown. */
  clientKey: string | null;
  /** Sends the notification; failures are reported but never undo the stored request. */
  notify?: (request: NotificationPayload) => Promise<void>;
  now?: () => Date;
  /** Product name for the notification ("ClinDesk"). */
  productName: string;
}

function totalChars(raw: Record<string, unknown>): number {
  return Object.values(raw).reduce<number>((n, v) => n + (typeof v === "string" ? v.length : Array.isArray(v) ? v.join("").length : 0), 0);
}

/** Validates, applies the honeypot and rate limits, stores the request and (optionally) sends the notification. */
export async function submitDemoRequest(raw: Record<string, unknown>, deps: DemoRequestDeps): Promise<DemoRequestOutcome> {
  const honeypot = typeof raw.website === "string" && raw.website.trim() !== "";
  if (honeypot) return { kind: "spam" };
  if (totalChars(raw) > MAX_DEMO_REQUEST_CHARS) return { kind: "invalid", fieldErrors: { form: "The form is too large." } };
  const parsed = DemoRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const byKey = fieldErrorsOf(parsed.error);
    const fieldErrors: Record<string, string> = {};
    for (const [key, message] of Object.entries(byKey)) {
      fieldErrors[(DEMO_FIELD_NAMES as Record<string, string>)[key] ?? "form"] = message;
    }
    return { kind: "invalid", fieldErrors };
  }
  const body = parsed.data;

  const ctx: RepoContext = deps.now ? { ...deps.ctx, now: deps.now } : deps.ctx;
  const limited = await accessRequestRateLimit(ctx, deps.clientKey);
  if (limited) return limited;

  const stored = await createAccessRequest(ctx, {
    clinicName: body.clinic,
    contactName: body.name,
    email: body.email,
    phone: body.phone || null,
    message: demoStoredMessage(body),
  });

  let notified: boolean | undefined;
  if (deps.notify) {
    try {
      await deps.notify({
        id: stored.id,
        clinicName: stored.clinicName,
        contactName: stored.contactName,
        email: stored.email,
        phone: stored.phone,
        sites: body.sites,
        message: null,
        createdAt: stored.createdAt,
        product: deps.productName,
        details: demoDetails(body),
      });
      notified = true;
    } catch {
      notified = false;
    }
  }
  return { kind: "stored", id: stored.id, notified };
}
