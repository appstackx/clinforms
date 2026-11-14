/**
 * The OpenAPI 3.1 document of the public clinic API v1 (served at /api/clinic/v1/openapi.json while the platform
 * switch is on). Pure: the title comes from the caller (the product name lives in src/lib/brand.ts). Kept in step with
 * the endpoints by src/modules/pms/integration/api.test.ts (every route has a path here, every path a route).
 */
import { API_ERRORS, API_LIMITS, API_SCOPES, APPOINTMENT_API_STATUSES, INVOICE_API_STATUSES, PATIENT_API_STATUSES } from "./api";

type Json = Record<string, unknown>;

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const str = (description?: string, extra: Json = {}): Json => ({ type: "string", ...(description ? { description } : {}), ...extra });
const nullable = (schema: Json): Json => ({ anyOf: [schema, { type: "null" }] });
const date = (description: string): Json => str(description, { format: "date" });
const dateTime = (description: string): Json => str(description, { format: "date-time" });
const pence = (description: string): Json => ({ type: "integer", description: `${description} (pence)` });
const q = (name: string, schema: Json, description: string, required = false): Json => ({ name, in: "query", required, description, schema });
const idParam: Json = { name: "id", in: "path", required: true, schema: { type: "string" } };
const cursorParam = q("cursor", { type: "string" }, "The nextCursor of the previous page.");
const limitParam = (max: number) => q("limit", { type: "integer", minimum: 1, maximum: max }, `Rows per page (default ${Math.min(max, API_LIMITS.pageDefault)}, at most ${max}).`);

function errors(...codes: (keyof typeof API_ERRORS)[]): Json {
  const out: Json = {};
  for (const code of codes) {
    const e = API_ERRORS[code];
    const key = String(e.status);
    const prev = out[key] as { description: string } | undefined;
    out[key] = { description: prev ? `${prev.description} / ${code}` : code, content: { "application/json": { schema: ref("Error") } } };
  }
  return out;
}
const COMMON = ["UNAUTHENTICATED", "API_OFF", "RATE_LIMITED", "SERVER_ERROR"] as const;

const list = (item: string): Json => ({
  type: "object",
  required: ["data", "nextCursor"],
  properties: { data: { type: "array", items: ref(item) }, nextCursor: nullable(str("Pass as ?cursor= for the next page; null on the last page.")) },
});
const one = (item: string): Json => ({ type: "object", required: ["data"], properties: { data: ref(item) } });
const ok = (schema: Json, description = "OK"): Json => ({ description, content: { "application/json": { schema } } });

export function clinicApiOpenApi(options: { title: string; serverUrl?: string }): Json {
  const security = (scope: string) => [{ bearer: [scope] }];
  return {
    openapi: "3.1.0",
    info: {
      title: `${options.title} clinic API`,
      version: "1.0.0",
      description:
        "Read a clinic's appointments, patients and invoices, and book appointments into free times. Every request sends an API key " +
        "created by the clinic's owner as `Authorization: Bearer <key>` over HTTPS. A key belongs to one clinic, may be limited to some " +
        "of its sites, and has scopes. Records of other clinics or sites answer 404. Dates are ISO 8601 (UK dates for `date`, UTC " +
        "instants for `*At`), money is in pence. Lists are paged with `cursor`. Errors: `{\"error\": {\"code\", \"message\"}}`.",
    },
    ...(options.serverUrl ? { servers: [{ url: options.serverUrl }] } : {}),
    components: {
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer", description: `Scopes: ${API_SCOPES.join(", ")}.` },
      },
      schemas: {
        Error: {
          type: "object",
          required: ["error"],
          properties: { error: { type: "object", required: ["code", "message"], properties: { code: str(undefined, { enum: Object.keys(API_ERRORS) }), message: str() } } },
        },
        Appointment: {
          type: "object",
          properties: {
            id: str(),
            status: str(undefined, { enum: [...APPOINTMENT_API_STATUSES] }),
            date: date("UK date of the start"),
            startsAt: dateTime("Start (UTC)"),
            endsAt: dateTime("End (UTC)"),
            siteId: str(),
            practitionerId: nullable(str()),
            roomId: nullable(str()),
            patientId: nullable(str()),
            caseId: nullable(str()),
            serviceId: nullable(str()),
            source: str(undefined, { enum: ["staff", "online", "import"] }),
            feeDue: { type: "boolean", description: "A late-cancellation or did-not-attend fee is due" },
            cancelledAt: nullable(dateTime("When it was cancelled")),
            createdAt: dateTime("Created"),
            updatedAt: dateTime("Last changed"),
          },
        },
        Slot: {
          type: "object",
          properties: { date: date("UK date"), startTime: str("HH:MM, UK time"), startsAt: dateTime("Start (UTC)"), endsAt: dateTime("End (UTC)"), siteId: str(), practitionerId: str(), serviceId: str() },
        },
        Booking: {
          type: "object",
          additionalProperties: false,
          required: ["patientId", "serviceId", "practitionerId", "siteId", "date", "startTime"],
          properties: {
            patientId: str(),
            serviceId: str(),
            practitionerId: str(),
            siteId: str(),
            date: date("UK date"),
            startTime: str("HH:MM, 24-hour, UK time – one of GET /slots"),
            caseId: str("Optional: the patient's case"),
            note: str(`Optional booking note for reception (never clinical detail), at most ${API_LIMITS.noteMax} characters`),
            sendConfirmation: { type: "boolean", description: "Send the clinic's usual booking confirmation (default false)" },
          },
        },
        PatientSummary: {
          type: "object",
          properties: { id: str(), patientNumber: { type: "integer" }, firstName: str(), lastName: str(), preferredName: nullable(str()), dateOfBirth: nullable(date("Date of birth")), status: str(undefined, { enum: ["active", "archived", "deceased"] }) },
        },
        Patient: {
          allOf: [
            ref("PatientSummary"),
            {
              type: "object",
              properties: {
                title: nullable(str()),
                email: nullable(str()),
                phoneMobile: nullable(str()),
                postcode: nullable(str()),
                reminderSms: { type: "boolean" },
                reminderEmail: { type: "boolean" },
                createdAt: dateTime("Registered"),
                updatedAt: dateTime("Last changed"),
              },
            },
          ],
        },
        InvoiceSummary: {
          type: "object",
          properties: {
            id: str(),
            number: nullable(str("The clinic's invoice number once issued")),
            status: str(undefined, { enum: [...INVOICE_API_STATUSES] }),
            patientId: str(),
            caseId: nullable(str()),
            siteId: nullable(str()),
            billTo: str(undefined, { enum: ["patient", "payer"] }),
            payerType: str(),
            payerReferrerId: nullable(str()),
            issuedOn: nullable(date("Issue date")),
            dueOn: nullable(date("Due date")),
            firstServiceOn: nullable(date("First visit billed")),
            lastServiceOn: nullable(date("Last visit billed")),
            netPence: pence("Net"),
            vatPence: pence("VAT"),
            totalPence: pence("Total"),
            paidPence: pence("Paid"),
            creditedPence: pence("Credited"),
            balancePence: pence("Still to pay (issued invoices)"),
            voidedAt: nullable(dateTime("Voided")),
            createdAt: dateTime("Created"),
            updatedAt: dateTime("Last changed"),
          },
        },
        Invoice: {
          allOf: [
            ref("InvoiceSummary"),
            {
              type: "object",
              properties: {
                lines: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      lineNo: { type: "integer" },
                      kind: str(),
                      serviceId: nullable(str()),
                      appointmentId: nullable(str()),
                      practitionerId: nullable(str()),
                      serviceOn: nullable(date("Visit date")),
                      billingCode: nullable(str()),
                      quantity: { type: "number" },
                      unitPricePence: pence("Unit price"),
                      discountPence: pence("Discount"),
                      vatRateBasisPoints: { type: "integer", description: "VAT rate in basis points (2000 = 20%)" },
                      netPence: pence("Net"),
                      vatPence: pence("VAT"),
                      totalPence: pence("Total"),
                      creditedPence: pence("Credited"),
                    },
                  },
                },
              },
            },
          ],
        },
      },
    },
    paths: {
      "/appointments": {
        get: {
          summary: "List appointments",
          description: `Appointments starting between two UK dates (at most ${API_LIMITS.appointmentRangeDays} days), by start time.`,
          security: security("appointments:read"),
          parameters: [
            q("from", { type: "string", format: "date" }, "First UK date", true),
            q("to", { type: "string", format: "date" }, "Last UK date (inclusive)", true),
            q("siteId", { type: "string" }, "Only this site"),
            q("practitionerId", { type: "string" }, "Only this practitioner"),
            q("status", { type: "string", enum: [...APPOINTMENT_API_STATUSES] }, "Only this status"),
            limitParam(API_LIMITS.pageMax),
            cursorParam,
          ],
          responses: { "200": ok(list("Appointment")), ...errors(...COMMON, "INSUFFICIENT_SCOPE", "SITE_NOT_ALLOWED", "INVALID_REQUEST") },
        },
        post: {
          summary: "Book an appointment",
          description:
            "Books one appointment into a free time (one of GET /slots: online-bookable hours, nothing else booked). Send a unique " +
            "Idempotency-Key per booking; repeating a request with the same key returns the same appointment (200, header " +
            "Idempotent-Replayed) and never books twice.",
          security: security("appointments:write"),
          parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", minLength: API_LIMITS.idempotencyMin, maxLength: API_LIMITS.idempotencyMax, pattern: "^[A-Za-z0-9._:-]+$" } }],
          requestBody: { required: true, content: { "application/json": { schema: ref("Booking") } } },
          responses: {
            "201": ok(one("Appointment"), "Booked"),
            "200": ok(one("Appointment"), "Replay of an earlier request with the same Idempotency-Key"),
            ...errors(...COMMON, "READ_ONLY", "INSUFFICIENT_SCOPE", "SITE_NOT_ALLOWED", "NOT_FOUND", "INVALID_REQUEST", "IDEMPOTENCY_KEY_REQUIRED", "IDEMPOTENCY_MISMATCH", "SLOT_NOT_FREE", "PAYLOAD_TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE"),
          },
        },
      },
      "/appointments/{id}": {
        get: { summary: "One appointment", security: security("appointments:read"), parameters: [idParam], responses: { "200": ok(one("Appointment")), ...errors(...COMMON, "INSUFFICIENT_SCOPE", "NOT_FOUND") } },
      },
      "/slots": {
        get: {
          summary: "Free times to book",
          description: `Free online-bookable times for an appointment type at a site (at most ${API_LIMITS.slotDays} days from \`from\`).`,
          security: security("appointments:write"),
          parameters: [
            q("siteId", { type: "string" }, "Site", true),
            q("serviceId", { type: "string" }, "Appointment type", true),
            q("from", { type: "string", format: "date" }, "First UK date", true),
            q("days", { type: "integer", minimum: 1, maximum: API_LIMITS.slotDays }, "Days to look at (default 7)"),
            q("practitionerId", { type: "string" }, "Only this practitioner"),
            limitParam(API_LIMITS.pageMax),
          ],
          responses: { "200": ok({ type: "object", properties: { data: { type: "array", items: ref("Slot") } } }), ...errors(...COMMON, "INSUFFICIENT_SCOPE", "SITE_NOT_ALLOWED", "NOT_FOUND", "INVALID_REQUEST") },
        },
      },
      "/patients": {
        get: {
          summary: "Find patients",
          description: "Search by name, date of birth or email. Minimal fields. Every patient returned is recorded in that patient's history.",
          security: security("patients:read"),
          parameters: [
            q("name", { type: "string", minLength: 2 }, "Words of the name"),
            q("dateOfBirth", { type: "string", format: "date" }, "Date of birth"),
            q("email", { type: "string", format: "email" }, "Email address (exact)"),
            q("status", { type: "string", enum: [...PATIENT_API_STATUSES] }, "Default active"),
            limitParam(API_LIMITS.patientPageMax),
            cursorParam,
          ],
          responses: { "200": ok(list("PatientSummary")), ...errors(...COMMON, "INSUFFICIENT_SCOPE", "INVALID_REQUEST") },
        },
      },
      "/patients/{id}": {
        get: { summary: "One patient", description: "Recorded in the patient's history.", security: security("patients:read"), parameters: [idParam], responses: { "200": ok(one("Patient")), ...errors(...COMMON, "INSUFFICIENT_SCOPE", "NOT_FOUND") } },
      },
      "/invoices": {
        get: {
          summary: "List invoices",
          description: `Optionally issued between two UK dates (at most ${API_LIMITS.invoiceRangeDays} days).`,
          security: security("invoices:read"),
          parameters: [
            q("from", { type: "string", format: "date" }, "Issued on or after"),
            q("to", { type: "string", format: "date" }, "Issued on or before"),
            q("status", { type: "string", enum: [...INVOICE_API_STATUSES] }, "Only this status"),
            q("patientId", { type: "string" }, "Only this patient's"),
            limitParam(API_LIMITS.pageMax),
            cursorParam,
          ],
          responses: { "200": ok(list("InvoiceSummary")), ...errors(...COMMON, "INSUFFICIENT_SCOPE", "INVALID_REQUEST") },
        },
      },
      "/invoices/{id}": {
        get: { summary: "One invoice with its lines", security: security("invoices:read"), parameters: [idParam], responses: { "200": ok(one("Invoice")), ...errors(...COMMON, "INSUFFICIENT_SCOPE", "NOT_FOUND") } },
      },
    },
  };
}

/** The API's paths (relative to /api/clinic/v1) – the routes test compares them with the route files. */
export const CLINIC_API_PATHS = ["/appointments", "/appointments/{id}", "/slots", "/patients", "/patients/{id}", "/invoices", "/invoices/{id}"] as const;
