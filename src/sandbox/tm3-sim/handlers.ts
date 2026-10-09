/**
 * Simulated TM3 API handlers (/api/tm3-sim/v1). Framework-agnostic (Request → Response).
 * Demo scaffolding, NOT the product, and not affiliated with TM3. The shapes are our assumption, not
 * TM3's schema (see wire-types.ts).
 *
 * - Bearer TM3_SIM_TOKEN required (401 otherwise; fixed demo fallback in demo mode – server-config.ts).
 * - Every response carries header `X-Simulated: true` and body `_simulated: true`.
 * - Lists are paged: `?page=` (default 1) and `?page_size=` (default 50, capped at 100). The body has
 *   `next_page`, and a `Link: <…>; rel="next"` header points at the next page.
 * - Errors are `application/problem+json` with the sim error shape:
 *   `{type, title, status, detail, error: {code, message}, _simulated: true}`.
 * - POST /patients/{id}/documents checks the token and payload (incl. the SHA-256 of the bytes) and
 *   returns a receipt; it stores nothing (there is no database – the browser keeps the filed copy).
 * - A small artificial latency (50–150 ms) makes the Integration Log look like a network call.
 *   `TM3_SIM_LATENCY_MS=0` turns it off (tests).
 * - `dispatchSimRequest` routes a Request by path for the in-process transport used by the module's
 *   connector when HTTP to the deployment is blocked (e.g. preview protection).
 *
 * Owner: sandbox agent.
 */
import { z } from "zod";
import { SIM_API_BASE } from "./config";
import { SIM_APPOINTMENTS, SIM_EPISODES, SIM_NOTES, SIM_OUTCOME_MEASURES, SIM_PATIENTS } from "./fixtures";
import { constantTimeEqual, getSandboxSecret } from "./server-config";
import type {
  SimAttachDocumentRequest,
  SimAttachDocumentResponse,
  SimError,
  SimPage,
  SimPatient,
} from "./wire-types";

export type SimHandlerContext = { params: Record<string, string> };
export type SimHandler = (req: Request, ctx: SimHandlerContext) => Promise<Response>;

/* ------------------------------------------------------------------------------------------------
 * Limits
 * ----------------------------------------------------------------------------------------------*/

export const SIM_DEFAULT_PAGE_SIZE = 50;
export const SIM_MAX_PAGE_SIZE = 100;
/** Largest decoded document accepted by POST /patients/{id}/documents. */
export const SIM_MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const MAX_SEARCH_LENGTH = 100;

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MIME = "application/pdf";

/* ------------------------------------------------------------------------------------------------
 * Responses
 * ----------------------------------------------------------------------------------------------*/

function baseHeaders(contentType: string): Headers {
  return new Headers({
    "content-type": contentType,
    "x-simulated": "true",
    "cache-control": "no-store",
  });
}

function simJson(body: unknown, status = 200, extra?: Record<string, string>): Response {
  const headers = baseHeaders("application/json; charset=utf-8");
  if (extra) Object.keys(extra).forEach((k) => headers.set(k, extra[k]));
  return new Response(JSON.stringify(body), { status, headers });
}

const ERROR_TITLES: Record<number, string> = {
  400: "Bad request",
  401: "Unauthorised",
  404: "Not found",
  405: "Method not allowed",
  413: "Payload too large",
  415: "Unsupported media type",
  422: "Unprocessable payload",
  500: "Internal error",
  503: "Not configured",
};

type SimProblem = SimError & { type: string; title: string; status: number; detail: string };

function simError(status: number, code: string, message: string, extra?: Record<string, string>): Response {
  const body: SimProblem = {
    type: `https://appstackx.example/problems/tm3-sim/${code}`,
    title: ERROR_TITLES[status] ?? "Error",
    status,
    detail: message,
    error: { code, message },
    _simulated: true,
  };
  const headers = baseHeaders("application/problem+json; charset=utf-8");
  if (extra) Object.keys(extra).forEach((k) => headers.set(k, extra[k]));
  return new Response(JSON.stringify(body), { status, headers });
}

/* ------------------------------------------------------------------------------------------------
 * Auth, latency, paging
 * ----------------------------------------------------------------------------------------------*/

/** null when the Bearer token is valid; otherwise the error response. */
function checkAuth(req: Request): Response | null {
  const expected = getSandboxSecret("TM3_SIM_TOKEN");
  if (!expected) {
    return simError(503, "not_configured", "TM3_SIM_TOKEN is not configured on this deployment.");
  }
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const challenge = { "www-authenticate": 'Bearer realm="tm3-sim"' };
  if (!match) {
    return simError(401, "unauthorised", "Missing Bearer token. Send Authorization: Bearer <TM3_SIM_TOKEN>.", challenge);
  }
  if (!constantTimeEqual(match[1].trim(), expected)) {
    return simError(401, "unauthorised", "The Bearer token is not valid for the simulated TM3 API.", {
      "www-authenticate": 'Bearer realm="tm3-sim", error="invalid_token"',
    });
  }
  return null;
}

function latencyMs(): number {
  const raw = typeof process !== "undefined" ? process.env.TM3_SIM_LATENCY_MS : undefined;
  if (raw !== undefined && raw.trim() !== "") {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 2000) : 0;
  }
  return 50 + Math.floor(Math.random() * 101);
}

function simulateLatency(): Promise<void> {
  const ms = latencyMs();
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

type Paging = { page: number; pageSize: number };

function parsePositiveInt(raw: string | null): number | null | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  if (!/^\d{1,6}$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return n >= 1 ? n : null;
}

function parsePaging(url: URL): Paging | Response {
  const page = parsePositiveInt(url.searchParams.get("page"));
  const size = parsePositiveInt(url.searchParams.get("page_size"));
  if (page === null) return simError(422, "invalid_paging", "page must be a whole number of 1 or more.");
  if (size === null) return simError(422, "invalid_paging", "page_size must be a whole number of 1 or more.");
  return { page: page ?? 1, pageSize: Math.min(size ?? SIM_DEFAULT_PAGE_SIZE, SIM_MAX_PAGE_SIZE) };
}

function pageResponse<T>(url: URL, items: T[], paging: Paging): Response {
  const start = (paging.page - 1) * paging.pageSize;
  const data = items.slice(start, start + paging.pageSize);
  const nextPage = start + paging.pageSize < items.length ? paging.page + 1 : null;
  const body: SimPage<T> = {
    data,
    page: paging.page,
    page_size: paging.pageSize,
    total: items.length,
    next_page: nextPage,
    _simulated: true,
  };
  const extra: Record<string, string> = { "x-total-count": String(items.length) };
  if (nextPage !== null) {
    const next = new URL(url.toString());
    next.searchParams.set("page", String(nextPage));
    next.searchParams.set("page_size", String(paging.pageSize));
    extra.link = `<${next.pathname}${next.search}>; rel="next"`;
  }
  return simJson(body, 200, extra);
}

/** Auth → latency → handler body, with a catch-all 500. */
function simEndpoint(fn: (req: Request, url: URL, params: Record<string, string>) => Promise<Response> | Response): SimHandler {
  return async (req, ctx) => {
    try {
      const denied = checkAuth(req);
      if (denied) return denied;
      await simulateLatency();
      return await fn(req, new URL(req.url), ctx?.params ?? {});
    } catch {
      return simError(500, "internal_error", "The simulated TM3 API hit an unexpected error.");
    }
  };
}

/* ------------------------------------------------------------------------------------------------
 * Lookups
 * ----------------------------------------------------------------------------------------------*/

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function findPatient(id: string | undefined): SimPatient | undefined {
  return id ? SIM_PATIENTS.find((p) => p.id === id) : undefined;
}

function isoToUk(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Case-insensitive; every word must match the name, ID, date of birth (ISO or DD/MM/YYYY) or postcode. */
export function matchesPatientSearch(patient: SimPatient, search: string): boolean {
  const words = normalise(search).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalise(
    [
      patient.first_name,
      patient.last_name,
      `${patient.first_name} ${patient.last_name}`,
      `${patient.last_name}, ${patient.first_name}`,
      patient.id,
      patient.date_of_birth,
      isoToUk(patient.date_of_birth),
      patient.address.postcode,
      patient.address.postcode.replace(/\s+/g, ""),
    ].join(" | "),
  );
  return words.every((w) => haystack.includes(w));
}

function episodeEndpoint<T extends { episode_id: string }>(collection: T[]): SimHandler {
  return simEndpoint((_req, url, params) => {
    const episode = SIM_EPISODES.find((e) => e.id === params.id);
    if (!episode) return simError(404, "episode_not_found", "No episode of care with that ID.");
    const paging = parsePaging(url);
    if (paging instanceof Response) return paging;
    return pageResponse(url, clone(collection.filter((item) => item.episode_id === episode.id)), paging);
  });
}

/* ------------------------------------------------------------------------------------------------
 * GET endpoints
 * ----------------------------------------------------------------------------------------------*/

/** GET /patients?search=&page=&page_size= */
export const simListPatients: SimHandler = simEndpoint((_req, url) => {
  const search = url.searchParams.get("search") ?? "";
  if (search.length > MAX_SEARCH_LENGTH) {
    return simError(422, "invalid_search", `search must be ${MAX_SEARCH_LENGTH} characters or fewer.`);
  }
  const paging = parsePaging(url);
  if (paging instanceof Response) return paging;
  const patients = SIM_PATIENTS.filter((p) => matchesPatientSearch(p, search));
  return pageResponse(url, clone(patients), paging);
});

/** GET /patients/{id} */
export const simGetPatient: SimHandler = simEndpoint((_req, _url, params) => {
  const patient = findPatient(params.id);
  if (!patient) return simError(404, "patient_not_found", "No patient with that ID.");
  return simJson(clone(patient));
});

/** GET /patients/{id}/episodes */
export const simListEpisodes: SimHandler = simEndpoint((_req, url, params) => {
  const patient = findPatient(params.id);
  if (!patient) return simError(404, "patient_not_found", "No patient with that ID.");
  const paging = parsePaging(url);
  if (paging instanceof Response) return paging;
  return pageResponse(url, clone(SIM_EPISODES.filter((e) => e.patient_id === patient.id)), paging);
});

/** GET /episodes/{id}/notes */
export const simListNotes: SimHandler = episodeEndpoint(SIM_NOTES);
/** GET /episodes/{id}/appointments */
export const simListAppointments: SimHandler = episodeEndpoint(SIM_APPOINTMENTS);
/** GET /episodes/{id}/outcome-measures */
export const simListOutcomeMeasures: SimHandler = episodeEndpoint(SIM_OUTCOME_MEASURES);

/* ------------------------------------------------------------------------------------------------
 * POST /patients/{id}/documents
 * ----------------------------------------------------------------------------------------------*/

const Hex64 = z.string().regex(/^[a-f0-9]{64}$/i, "must be a 64-character hex SHA-256");
const NonEmpty = z.string().trim().min(1, "is required");

const AttachDocumentSchema = z.object({
  episode_id: NonEmpty,
  title: NonEmpty.max(300),
  file_name: NonEmpty.max(255),
  mime_type: z.enum([DOCX_MIME, PDF_MIME]),
  content_base64: z.string().min(1, "is required"),
  sha256: Hex64,
  sign_receipt: z.object({
    report_id: NonEmpty,
    content_sha256: Hex64,
    signer_name: NonEmpty,
    signer_hcpc: NonEmpty,
    signed_at: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "must be an ISO date-time"),
    mac: NonEmpty,
  }),
});

function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "The payload is not valid.";
  const path = issue.path.length ? issue.path.join(".") : "body";
  return `${path}: ${issue.message}`;
}

function decodeBase64(b64: string): Uint8Array<ArrayBuffer> | null {
  const clean = b64.replace(/\s+/g, "");
  if (clean.length === 0 || clean.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) return null;
  return new Uint8Array(Buffer.from(clean, "base64"));
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function newDocumentId(): string {
  const hex = crypto.randomUUID().replace(/-/g, "");
  return `sim-doc-${hex.slice(0, 12)}`;
}

/** POST /patients/{id}/documents – checks token and payload, returns a receipt, stores nothing. */
export const simAttachDocument: SimHandler = simEndpoint(async (req, _url, params) => {
  const patient = findPatient(params.id);
  if (!patient) return simError(404, "patient_not_found", "No patient with that ID.");

  const contentType = req.headers.get("content-type");
  if (contentType && !/^application\/(.+\+)?json\b/i.test(contentType)) {
    return simError(415, "unsupported_media_type", "Send the document as application/json.");
  }
  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (declaredLength > Math.ceil(SIM_MAX_DOCUMENT_BYTES * 1.4) + 64 * 1024) {
    return simError(413, "payload_too_large", "The document is larger than the simulated API accepts (10 MB).");
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return simError(400, "invalid_json", "The request body is not valid JSON.");
  }
  const parsed = AttachDocumentSchema.safeParse(raw);
  if (!parsed.success) return simError(422, "invalid_payload", describeIssue(parsed.error));
  const body: SimAttachDocumentRequest = parsed.data;

  const episode = SIM_EPISODES.find((e) => e.id === body.episode_id);
  if (!episode || episode.patient_id !== patient.id) {
    return simError(422, "episode_mismatch", "episode_id is not an episode of care of this patient.");
  }
  const expectedExt = body.mime_type === PDF_MIME ? ".pdf" : ".docx";
  if (!body.file_name.toLowerCase().endsWith(expectedExt)) {
    return simError(422, "file_name_mismatch", `file_name must end in ${expectedExt} for ${body.mime_type}.`);
  }

  const bytes = decodeBase64(body.content_base64);
  if (!bytes || bytes.length === 0) {
    return simError(422, "invalid_content", "content_base64 is not valid base64.");
  }
  if (bytes.length > SIM_MAX_DOCUMENT_BYTES) {
    return simError(413, "payload_too_large", "The document is larger than the simulated API accepts (10 MB).");
  }
  const actual = await sha256Hex(bytes);
  if (actual !== body.sha256.toLowerCase()) {
    return simError(422, "sha256_mismatch", "sha256 does not match the SHA-256 of the decoded content.");
  }

  const receipt: SimAttachDocumentResponse = {
    external_document_id: newDocumentId(),
    received_at: new Date().toISOString(),
    sha256: actual,
    _simulated: true,
  };
  return simJson(receipt, 201);
});

/* ------------------------------------------------------------------------------------------------
 * In-process dispatch
 * ----------------------------------------------------------------------------------------------*/

type SimRoute = { method: "GET" | "POST"; pattern: RegExp; handler: SimHandler };

const SEGMENT = "([^/]+)";
const SIM_ROUTES: SimRoute[] = [
  { method: "GET", pattern: /^\/patients$/, handler: simListPatients },
  { method: "GET", pattern: new RegExp(`^/patients/${SEGMENT}$`), handler: simGetPatient },
  { method: "GET", pattern: new RegExp(`^/patients/${SEGMENT}/episodes$`), handler: simListEpisodes },
  { method: "POST", pattern: new RegExp(`^/patients/${SEGMENT}/documents$`), handler: simAttachDocument },
  { method: "GET", pattern: new RegExp(`^/episodes/${SEGMENT}/notes$`), handler: simListNotes },
  { method: "GET", pattern: new RegExp(`^/episodes/${SEGMENT}/appointments$`), handler: simListAppointments },
  { method: "GET", pattern: new RegExp(`^/episodes/${SEGMENT}/outcome-measures$`), handler: simListOutcomeMeasures },
];

function safeDecode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** Route any /api/tm3-sim/v1/... Request to its handler (in-process transport). 404 for unknown paths. */
export async function dispatchSimRequest(req: Request): Promise<Response> {
  let pathname: string;
  try {
    pathname = new URL(req.url).pathname;
  } catch {
    return simError(400, "invalid_url", "The request URL is not valid.");
  }
  if (!pathname.startsWith(`${SIM_API_BASE}/`)) {
    return simError(404, "not_found", "Not a simulated TM3 API path.");
  }
  const rest = pathname.slice(SIM_API_BASE.length).replace(/\/+$/, "");
  const matches = SIM_ROUTES.map((r) => ({ route: r, m: r.pattern.exec(rest) })).filter((x) => x.m !== null);
  if (matches.length === 0) return simError(404, "not_found", "No simulated TM3 endpoint at this path.");

  const method = req.method.toUpperCase();
  const hit = matches.find((x) => x.route.method === method);
  if (!hit || !hit.m) {
    return simError(405, "method_not_allowed", `${method} is not supported here.`, {
      allow: Array.from(new Set(matches.map((x) => x.route.method))).join(", "),
    });
  }
  const params: Record<string, string> = {};
  if (hit.m[1] !== undefined) {
    const id = safeDecode(hit.m[1]);
    if (id === null) return simError(400, "invalid_url", "The path contains an invalid escape sequence.");
    params.id = id;
  }
  return hit.route.handler(req, { params });
}
