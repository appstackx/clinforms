/**
 * Read schemas for STORED records – the rollback shim (fix/schema-forward-compat, review finding R-regression-9).
 *
 * A later release writes new optional fields and new enum members into stored reports, approval receipts and form
 * maps. If production is rolled back to a build that parses those records with the strict schemas (core/schemas.ts),
 * a report becomes unreadable (zod rejects a flag code or record path it does not know), and even where it parses,
 * zod drops the keys it does not know – so the report's fingerprint, the receipt's MAC and the form map's hash no
 * longer match what was signed or attested.
 *
 * So every read of a stored record parses with these schemas instead:
 * - every object keeps the keys it does not know (as written, untouched);
 * - the enums a later release extends (FORWARD_OPEN_ENUMS) also accept members this build does not know; the code
 *   shows them with a generic label (core/labels.ts) and never acts on them;
 * - a registration fill source's `part` accepts the later release's session lines (up to 30, and other shapes).
 * Everything else is exactly as strict as the write schemas: the same bounds, formats, literals and fill kinds (a
 * fill kind or anchor this build cannot write is still refused, never silently skipped).
 *
 * Writes stay strict: PUT bodies, /sign's report, /forms/confirm and everything this build creates use
 * core/schemas.ts, so this build never stores or signs a shape it does not understand.
 *
 * Pure (no React, no env, no Node built-ins), like core/schemas.ts.
 */
import { z } from "zod";
import {
  ConnectorIdSchema,
  FormDefinitionSchema,
  ParagraphOriginSchema,
  RegistrationPartSchema,
  RegistrationPathSchema,
  ReportFlagCodeSchema,
  ReportSchema,
  SignReceiptSchema,
} from "./schemas";
import type { FormDefinition, Report, SignReceipt } from "./types";

/** Longest enum member a later release may write that this build still reads (a flag code, an origin, a record path). */
export const MAX_FORWARD_ENUM_MEMBER = 80;

/**
 * The enums a later release adds members to (release/bh-trial-2: flag codes such as DRAFT_FIT or APPROVER_DECISION,
 * paragraph origin "staff", record paths such as episode.attendedDate; the clinic system, 10/2026: connector id
 * "native" – a report started from the clinic system's own patient record, on episodeRef and bundleSnapshot.source).
 * Every other enum stays closed.
 */
export const FORWARD_OPEN_ENUMS = [ReportFlagCodeSchema, ParagraphOriginSchema, RegistrationPathSchema, ConnectorIdSchema] as const;

/** release/bh-trial-2 prints session dates and times over up to 30 lines, and lists the sessions from a given one. */
const StoredRegistrationPartSchema = z.looseObject({
  index: z.number().int().min(1).max(30).optional(),
  of: z.number().int().min(1).max(30).optional(),
});

const READ_REPLACEMENTS = new Map<z.ZodType, z.ZodType>([
  ...FORWARD_OPEN_ENUMS.map((e): [z.ZodType, z.ZodType] => [e, e.or(z.string().min(1).max(MAX_FORWARD_ENUM_MEMBER))]),
  [RegistrationPartSchema, StoredRegistrationPartSchema],
]);

/** The parts of a zod definition this walk rebuilds (objects, arrays, optional/nullable, unions, records). */
interface CompositeDef {
  type: string;
  element?: z.ZodType;
  innerType?: z.ZodType;
  options?: z.ZodType[];
  valueType?: z.ZodType;
}

/**
 * The read version of a write schema: the same schema with every object loose and READ_REPLACEMENTS swapped in, at
 * any depth. Containers are cloned with their own definition, so their checks (sizes, bounds) stay as they are.
 */
export function forwardCompatible(schema: z.ZodType, seen = new Map<z.ZodType, z.ZodType>()): z.ZodType {
  const replaced = READ_REPLACEMENTS.get(schema);
  if (replaced) return replaced;
  const cached = seen.get(schema);
  if (cached) return cached;
  const def = schema._zod.def as unknown as CompositeDef;
  const read = (s: z.ZodType) => forwardCompatible(s, seen);
  const rebuild = (patch: Partial<CompositeDef> & Record<string, unknown>) =>
    schema.clone({ ...schema._zod.def, ...patch } as typeof schema._zod.def);
  let out: z.ZodType;
  switch (def.type) {
    case "object": {
      const shape = Object.fromEntries(Object.entries((schema as z.ZodObject).shape).map(([k, v]) => [k, read(v as z.ZodType)]));
      out = rebuild({ shape, catchall: z.unknown() });
      break;
    }
    case "array":
      out = rebuild({ element: read(def.element!) });
      break;
    case "optional":
    case "nullable":
      out = rebuild({ innerType: read(def.innerType!) });
      break;
    case "union": // z.union and z.discriminatedUnion (its discriminator stays in the definition)
      out = rebuild({ options: def.options!.map(read) });
      break;
    case "record":
      out = rebuild({ valueType: read(def.valueType!) });
      break;
    default: // strings, numbers, booleans, literals, template literals and closed enums: unchanged
      out = schema;
  }
  seen.set(schema, out);
  return out;
}

/*
 * Typed as the strict shapes on purpose: every caller is code written for those shapes. A member of a
 * FORWARD_OPEN_ENUMS enum this build does not know reaches it as a plain string; the code that shows or uses those
 * values has a fallback for it (core/labels.ts flagCodeLabel / registrationPathLabel / connectorIdLabel, review-model
 * originLabel, core/forms.ts resolveRegistrationValue). A connector id this build does not know names no connector it
 * has: anything that needs the connector (fetching the record again, filing back, reusing the notes) is refused with a
 * 4xx, never attempted.
 */

/** A stored report (clinic store, this browser's demo store, and the report a request carries for reading). */
export const StoredReportSchema = forwardCompatible(ReportSchema) as unknown as z.ZodType<Report, Report>;

/** A stored approval receipt: the MAC covers every key it holds, known or not. */
export const StoredSignReceiptSchema = forwardCompatible(SignReceiptSchema) as unknown as z.ZodType<SignReceipt, SignReceipt>;

/** A stored form map: its attested hash covers every key of its fields, known or not. */
export const StoredFormDefinitionSchema = forwardCompatible(FormDefinitionSchema) as unknown as z.ZodType<FormDefinition, FormDefinition>;
