/**
 * Tenant storage API (`/api/reports/v1/store/**`) – the server backend of the Studio's store in a clinic's
 * own Studio (docs/production-architecture.md §5). Browser-safe (zod + core only), like api/contract.ts:
 * ui/store/server-api.ts and the handlers (api/handlers/store-*.ts) share these paths and schemas.
 *
 * Every endpoint needs a signed-in clinic member with two-step verification (the host's MedreportDeps.authenticate);
 * the clinic (tenant) always comes from the sign-in, never from the request. The public demo (/reports) never
 * calls these endpoints: it keeps its browser storage.
 *
 * Optimistic concurrency: every stored report and form map has a server revision `rev` (1, 2, …), separate
 * from Report.version (the amendment number) so case exports and content fingerprints are unchanged.
 * Responses carry `ETag: "<rev>"`; an update sends `If-Match: "<rev>"` (no If-Match = create). A stale or
 * clashing write gets 409 REV_CONFLICT with the stored copy in `current`.
 *
 * Form files: content-addressed by SHA-256 and uploaded in chunks of STORE_FILE_CHUNK_BYTES (Vercel caps a
 * request body at 4.5 MB): POST /store/files {sha256, size, name, mime} → PUT …/chunks/{n} (raw bytes as
 * application/octet-stream with ?size=<total>, or JSON {size, dataBase64}) → POST …/complete, which checks
 * the SHA-256 and the file type. Uploads are idempotent and resumable (init lists the chunks already held).
 */
import { z } from "zod";
import { MAX_FORM_FILE_BYTES } from "../config.public";
import { FormDefinitionSchema, FormMimeTypeSchema, ReportSchema, Sha256HexSchema } from "../core/schemas";
import { ProblemSchema, REPORT_API_BASE } from "./contract";

export const STORE_API_BASE = `${REPORT_API_BASE}/store` as const;

/** Raw bytes per uploaded chunk (= the server's encrypted chunk size, src/server/repos/form-files.ts). */
export const STORE_FILE_CHUNK_BYTES = 512 * 1024;
/** Largest stored report or form map (JSON bytes; a D1 row holds at most 2 MB of ciphertext). */
export const STORE_MAX_RECORD_BYTES = 1_400_000;
/** Largest PUT body for a report or form map (the record plus its JSON envelope). */
export const STORE_MAX_PUT_BYTES = STORE_MAX_RECORD_BYTES + 16_384;
/** Largest number of remembered referrer → form links. */
export const STORE_MAX_REFERRER_LINKS = 1000;

/**
 * The clinic and member the Studio page was opened for (fix wave 2): the Studio sends them with every store
 * request, and a request whose sign-in now belongs to another clinic or member is refused (403
 * TENANT_MISMATCH / SIGN_IN_CHANGED) – a change made under one sign-in is never stored under another.
 * Optional for other callers (the clinic always comes from the sign-in).
 */
export const STORE_TENANT_HEADER = "x-clinforms-tenant";
export const STORE_MEMBER_HEADER = "x-clinforms-member";

/** Store writes a member may make per minute, and a clinic per minute (all members together) – fix wave 2. */
export const STORE_WRITES_PER_MEMBER_PER_MINUTE = 120;
export const STORE_WRITES_PER_CLINIC_PER_MINUTE = 400;
/**
 * New data a clinic may add per day (new reports and form maps, uploaded form-file chunks), in kilobytes – a brake
 * on growth of the shared database (updates of an existing record do not count: a record is at most
 * STORE_MAX_RECORD_BYTES).
 */
export const STORE_NEW_KB_PER_CLINIC_PER_DAY = 250_000;

/** Record ids accepted by the store (reports, forms): printable, no whitespace, ≤ 128 characters. */
export const STORE_RECORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;
export const StoreRecordIdSchema = z.string().regex(STORE_RECORD_ID_PATTERN, "Record ids are letters, digits and . _ : @ -");

const e = encodeURIComponent;

export const storeApiPaths = {
  snapshot: () => `${STORE_API_BASE}/snapshot`,
  report: (id: string) => `${STORE_API_BASE}/reports/${e(id)}`,
  form: (id: string) => `${STORE_API_BASE}/forms/${e(id)}`,
  files: () => `${STORE_API_BASE}/files`,
  file: (sha256: string) => `${STORE_API_BASE}/files/${e(sha256)}`,
  fileChunk: (sha256: string, idx: number, size?: number) =>
    `${STORE_API_BASE}/files/${e(sha256)}/chunks/${idx}${size !== undefined ? `?size=${size}` : ""}`,
  fileComplete: (sha256: string) => `${STORE_API_BASE}/files/${e(sha256)}/complete`,
  settings: () => `${STORE_API_BASE}/settings`,
} as const;

/** `"3"` → 3 (also accepts `W/"3"` and a bare `3`); anything else → null. */
export function parseRevTag(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(?:W\/)?"?(\d{1,12})"?$/.exec(value.trim());
  if (!match) return null;
  const rev = Number(match[1]);
  return Number.isSafeInteger(rev) && rev >= 1 ? rev : null;
}

export function revTag(rev: number): string {
  return `"${rev}"`;
}

/** Number of chunks a file of `size` bytes is uploaded in. */
export function storeChunkCount(size: number): number {
  return Math.ceil(size / STORE_FILE_CHUNK_BYTES);
}

/** Exact byte length of chunk `idx` of a file of `size` bytes (0 when out of range). */
export function storeChunkLength(size: number, idx: number): number {
  if (!Number.isInteger(idx) || idx < 0 || idx >= storeChunkCount(size)) return 0;
  return Math.min(STORE_FILE_CHUNK_BYTES, size - idx * STORE_FILE_CHUNK_BYTES);
}

/* ------------------------------------------------------------------------------------------------
 * Endpoint table (route coverage test, README)
 * ----------------------------------------------------------------------------------------------*/

export interface StoreEndpointSpec {
  name: string;
  method: "GET" | "PUT" | "POST" | "DELETE";
  /** Next.js-style pattern with [params]. */
  path: string;
  /** Handler file in src/modules/medreport/api/handlers. */
  handler: string;
  /** The handler's export, bound in the route file with route(). */
  fn: string;
  summary: string;
}

export const STORE_API_ENDPOINTS: readonly StoreEndpointSpec[] = [
  { name: "storeSnapshot", method: "GET", path: "/api/reports/v1/store/snapshot", handler: "store-snapshot.ts", fn: "handleStoreSnapshot", summary: "Summaries of the clinic's reports and form maps, and its settings" },
  { name: "storeReportGet", method: "GET", path: "/api/reports/v1/store/reports/[id]", handler: "store-reports.ts", fn: "handleStoreReportGet", summary: "One report with its rev (ETag)" },
  { name: "storeReportPut", method: "PUT", path: "/api/reports/v1/store/reports/[id]", handler: "store-reports.ts", fn: "handleStoreReportPut", summary: "Create (no If-Match) or update (If-Match: rev) a report; 409 REV_CONFLICT with the stored copy" },
  { name: "storeReportDelete", method: "DELETE", path: "/api/reports/v1/store/reports/[id]", handler: "store-reports.ts", fn: "handleStoreReportDelete", summary: "Delete a report" },
  { name: "storeFormGet", method: "GET", path: "/api/reports/v1/store/forms/[id]", handler: "store-forms.ts", fn: "handleStoreFormGet", summary: "One form map with its rev (ETag)" },
  { name: "storeFormPut", method: "PUT", path: "/api/reports/v1/store/forms/[id]", handler: "store-forms.ts", fn: "handleStoreFormPut", summary: "Create or update a form map; an unattested confirmation is stored as proposed" },
  { name: "storeFormDelete", method: "DELETE", path: "/api/reports/v1/store/forms/[id]", handler: "store-forms.ts", fn: "handleStoreFormDelete", summary: "Delete a form map (and its file when no other map uses it)" },
  { name: "storeFileInit", method: "POST", path: "/api/reports/v1/store/files", handler: "store-files.ts", fn: "handleStoreFileInit", summary: "Start or resume a chunked form-file upload" },
  { name: "storeFileGet", method: "GET", path: "/api/reports/v1/store/files/[sha256]", handler: "store-files.ts", fn: "handleStoreFileGet", summary: "The stored form file (decrypted)" },
  { name: "storeFileChunk", method: "PUT", path: "/api/reports/v1/store/files/[sha256]/chunks/[idx]", handler: "store-files.ts", fn: "handleStoreFileChunk", summary: "Upload one chunk (≤ 512 KiB)" },
  { name: "storeFileComplete", method: "POST", path: "/api/reports/v1/store/files/[sha256]/complete", handler: "store-files.ts", fn: "handleStoreFileComplete", summary: "Finish an upload: checks the SHA-256 and the file type" },
  { name: "storeSettingsGet", method: "GET", path: "/api/reports/v1/store/settings", handler: "store-settings.ts", fn: "handleStoreSettingsGet", summary: "The clinic's Studio settings (referrer → form links)" },
  { name: "storeSettingsPut", method: "PUT", path: "/api/reports/v1/store/settings", handler: "store-settings.ts", fn: "handleStoreSettingsPut", summary: "Replace the referrer → form links" },
];

/* ------------------------------------------------------------------------------------------------
 * Schemas
 * ----------------------------------------------------------------------------------------------*/

const RevSchema = z.number().int().min(1);

export const StoreReportSummarySchema = z.object({
  id: z.string(),
  rev: RevSchema,
  status: z.string(),
  templateId: z.string(),
  formId: z.string().nullable(),
  createdAt: z.string(),
  /** When the server last stored it (not Report.updatedAt). */
  updatedAt: z.string(),
});

export const StoreFormSummarySchema = z.object({
  id: z.string(),
  rev: RevSchema,
  status: z.string(),
  title: z.string(),
  kind: z.string(),
  fileSha256: z.string(),
  sampleId: z.string().nullable(),
  updatedAt: z.string(),
});

/** Normalised referrer name → form map id. */
export const ReferrerLinksSchema = z
  .record(z.string().min(1).max(300), StoreRecordIdSchema)
  .refine((links) => Object.keys(links).length <= STORE_MAX_REFERRER_LINKS, `At most ${STORE_MAX_REFERRER_LINKS} referrer links`);

export const StoreSettingsSchema = z.object({
  referrerLinks: ReferrerLinksSchema,
  /** null until the clinic saves settings for the first time. */
  updatedAt: z.string().nullable(),
});

// GET /store/snapshot
export const StoreSnapshotResponseSchema = z.object({
  tenantId: z.string(),
  reports: z.array(StoreReportSummarySchema),
  forms: z.array(StoreFormSummarySchema),
  settings: StoreSettingsSchema,
  limits: z.object({ chunkBytes: z.number().int().positive(), maxFileBytes: z.number().int().positive() }),
});

// GET/PUT /store/reports/{id}
export const StoreReportPutRequestSchema = z.object({ report: ReportSchema });
export const StoreReportResponseSchema = z.object({
  rev: RevSchema,
  updatedAt: z.string(),
  /** The report as stored (the clinic is always the signed-in member's). */
  report: ReportSchema,
});

// GET/PUT /store/forms/{id}
export const StoreFormPutRequestSchema = z.object({ form: FormDefinitionSchema });
export const StoreFormResponseSchema = z.object({
  rev: RevSchema,
  updatedAt: z.string(),
  /** The map as stored: a confirmation without a valid server attestation for this clinic is stored as proposed. */
  form: FormDefinitionSchema,
  /** True when a "confirmed" map was stored as "proposed". */
  downgraded: z.boolean().optional(),
});

// DELETE /store/reports/{id}, /store/forms/{id}
export const StoreDeleteResponseSchema = z.object({ deleted: z.boolean() });

/** 409 REV_CONFLICT: problem+json plus the stored copy (null when the record is gone). */
export const StoreConflictSchema = ProblemSchema.extend({
  current: z
    .object({
      rev: RevSchema,
      updatedAt: z.string(),
      report: ReportSchema.optional(),
      form: FormDefinitionSchema.optional(),
    })
    .nullable()
    .optional(),
});

// POST /store/files
export const StoreFileInitRequestSchema = z.object({
  sha256: Sha256HexSchema,
  size: z.number().int().min(1).max(MAX_FORM_FILE_BYTES),
  name: z.string().trim().min(1).max(255),
  mime: FormMimeTypeSchema,
});
export const StoreFileInitResponseSchema = z.object({
  sha256: Sha256HexSchema,
  /** True when the clinic already holds this exact file: nothing to upload. */
  complete: z.boolean(),
  chunkBytes: z.number().int().positive(),
  chunkCount: z.number().int().positive(),
  /** Chunk indexes already received (resume). */
  present: z.array(z.number().int().nonnegative()),
});

// PUT /store/files/{sha256}/chunks/{idx} (JSON form; octet-stream sends the raw bytes with ?size=)
export const StoreFileChunkJsonSchema = z.object({
  size: z.number().int().min(1).max(MAX_FORM_FILE_BYTES),
  dataBase64: z.string().min(1),
});
export const StoreFileChunkResponseSchema = z.object({
  idx: z.number().int().nonnegative(),
  received: z.number().int().nonnegative(),
  /** True when the whole file is already stored (the chunk was not needed). */
  complete: z.boolean(),
});

// POST /store/files/{sha256}/complete
export const StoreFileCompleteRequestSchema = z.object({
  size: z.number().int().min(1).max(MAX_FORM_FILE_BYTES),
  name: z.string().trim().min(1).max(255),
  mime: FormMimeTypeSchema,
});
export const StoreFileCompleteResponseSchema = z.object({
  sha256: Sha256HexSchema,
  sizeBytes: z.number().int().positive(),
  /** The type read from the bytes (never the client's claim). */
  mimeType: FormMimeTypeSchema,
  fileName: z.string(),
});

// GET/PUT /store/settings
export const StoreSettingsPutRequestSchema = z.object({ referrerLinks: ReferrerLinksSchema });
export const StoreSettingsResponseSchema = StoreSettingsSchema;

/* ------------------------------------------------------------------------------------------------
 * Types
 * ----------------------------------------------------------------------------------------------*/

export type StoreReportSummary = z.infer<typeof StoreReportSummarySchema>;
export type StoreFormSummary = z.infer<typeof StoreFormSummarySchema>;
export type ReferrerLinks = z.infer<typeof ReferrerLinksSchema>;
export type StoreSettings = z.infer<typeof StoreSettingsSchema>;
export type StoreSnapshotResponse = z.infer<typeof StoreSnapshotResponseSchema>;
export type StoreReportPutRequest = z.infer<typeof StoreReportPutRequestSchema>;
export type StoreReportResponse = z.infer<typeof StoreReportResponseSchema>;
export type StoreFormPutRequest = z.infer<typeof StoreFormPutRequestSchema>;
export type StoreFormResponse = z.infer<typeof StoreFormResponseSchema>;
export type StoreDeleteResponse = z.infer<typeof StoreDeleteResponseSchema>;
export type StoreConflict = z.infer<typeof StoreConflictSchema>;
export type StoreFileInitRequest = z.infer<typeof StoreFileInitRequestSchema>;
export type StoreFileInitResponse = z.infer<typeof StoreFileInitResponseSchema>;
export type StoreFileChunkResponse = z.infer<typeof StoreFileChunkResponseSchema>;
export type StoreFileCompleteRequest = z.infer<typeof StoreFileCompleteRequestSchema>;
export type StoreFileCompleteResponse = z.infer<typeof StoreFileCompleteResponseSchema>;
export type StoreSettingsPutRequest = z.infer<typeof StoreSettingsPutRequestSchema>;
