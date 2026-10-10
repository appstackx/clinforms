/**
 * Typed browser client for the Report API (/api/reports/v1). Responses are validated against the
 * contract schemas; errors arrive as ApiError carrying the parsed problem+json.
 *
 * Attaches `Authorization: Bearer <session>` when a session token is available and
 * `x-medreport-passcode` when a passcode is provided (per call or via getPasscode()).
 * Never import the Anthropic SDK, docx or react-pdf here.
 *
 * Shared contract (orchestrator-owned): add methods only.
 */
import type { z } from "zod";
import {
  BundleResponseSchema,
  CONTENT_TYPES,
  ConnectorsResponseSchema,
  DemoSessionResponseSchema,
  DocumentsResponseSchema,
  DraftsResponseSchema,
  FormSamplesResponseSchema,
  FormsAnalyseResponseSchema,
  FormsConfirmResponseSchema,
  AiPayloadPreviewResponseSchema,
  HEADERS,
  HealthResponseSchema,
  FileImportReadResponseSchema,
  LaunchResponseSchema,
  LaunchVerifyResponseSchema,
  PatientsResponseSchema,
  ProblemSchema,
  SignResponseSchema,
  TemplateGetResponseSchema,
  TemplatesListResponseSchema,
  TemplatesValidateResponseSchema,
  ValidateResponseSchema,
  reportApiPaths,
  type BundleResponse,
  type ConnectorsResponse,
  type DemoSessionRequest,
  type DemoSessionResponse,
  type DocumentsRequest,
  type DocumentsResponse,
  type DraftsRequest,
  type DraftsResponse,
  type FileImportBundleRequest,
  type FileImportConfirmRequest,
  type FileImportReadResponse,
  type FormFillPreviewRequest,
  type FormSamplesResponse,
  type FormsAnalyseRequest,
  type FormsAnalyseResponse,
  type FormsConfirmRequest,
  type FormsConfirmResponse,
  type AiPayloadPreviewRequest,
  type AiPayloadPreviewResponse,
  type HealthResponse,
  type LaunchRequest,
  type LaunchResponse,
  type LaunchVerifyResponse,
  type PatientsResponse,
  type Problem,
  type RenderFormat,
  type RenderRequest,
  type SignRequest,
  type SignResponse,
  type TemplateGetResponse,
  type TemplatesListResponse,
  type TemplatesValidateRequest,
  type TemplatesValidateResponse,
  type ValidateRequest,
  type ValidateResponse,
} from "../api/contract";
import { DEMO_TENANT_ID, MAX_FORM_REQUEST_BYTES } from "../config.public";
import { getPasscode, getSession, getStoreMode, setSession } from "./store";

/** A failed API call. `problem` is the server's problem+json (or a synthesised one). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly problem: Problem;

  constructor(problem: Problem) {
    super(problem.detail ? `${problem.title}: ${problem.detail}` : problem.title);
    this.name = "ApiError";
    this.status = problem.status;
    this.code = problem.code;
    this.problem = problem;
  }

  get retryable(): boolean {
    return this.problem.retryable ?? (this.status === 429 || this.status >= 500 || this.status === 0);
  }
}

export interface ApiClientOptions {
  /** Prefix for every path, e.g. "" (same origin, default) or "https://reports.example". */
  baseUrl?: string;
  fetch?: typeof fetch;
  getSessionToken?: () => string | null;
  getPasscode?: () => string | null;
  /**
   * Wave 2: when a call that needs a caller (anything but health, connectors, templates, sample forms,
   * launch, launch/verify and sessions/demo) has no session token, get one first – e.g. a public-demo
   * session (the default `api` client). Return null to send the call without one (a clinic's signed-in
   * member is recognised by the sign-in cookie, which the server prefers to any demo session).
   */
  ensureSessionToken?: () => Promise<string | null>;
}

/** Paths that never need a caller (the rest of the Report API needs a signed-in member or a session). */
const PUBLIC_PATH_PATTERNS: readonly RegExp[] = [
  /\/health$/,
  /\/connectors$/,
  /\/templates(\/(?!validate$)[^/]+(\/docx)?)?$/,
  /\/forms\/samples(\/[^/]+\/file)?$/,
  /\/launch(\/verify)?$/,
  /\/sessions\/demo$/,
];

function needsCaller(path: string): boolean {
  const bare = path.split("?")[0];
  return !PUBLIC_PATH_PATTERNS.some((re) => re.test(bare));
}

export interface CallOptions {
  signal?: AbortSignal;
  /** Override the session token for this call (e.g. right after /launch/verify). */
  sessionToken?: string | null;
  /** Override the passcode for this call. */
  passcode?: string | null;
}

export interface FileDownload {
  blob: Blob;
  fileName: string;
  /** From x-medreport-render ("final" | "draft"); "draft" if absent. */
  kind: "final" | "draft";
  /** From x-medreport-content-sha256, or null. */
  contentSha256: string | null;
  /** The response content type without parameters, e.g. CONTENT_TYPES.docx or CONTENT_TYPES.pdf. */
  contentType: string;
  /** From x-medreport-fill-warnings (form fills): plain-English warnings, [] if none. */
  warnings: string[];
  /** From x-medreport-file-token (FINAL renders only): required to file this exact file to the record. */
  fileToken: string | null;
}

function parseWarnings(header: string | null): string[] {
  if (!header) return [];
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(header));
    return Array.isArray(parsed) ? parsed.filter((w): w is string => typeof w === "string") : [];
  } catch {
    return [];
  }
}

function extensionFor(contentType: string): string {
  if (contentType === CONTENT_TYPES.docx) return "docx";
  if (contentType === CONTENT_TYPES.pdf) return "pdf";
  return "bin";
}

function fileNameFrom(res: Response, fallback: string): string {
  const cd = res.headers.get("content-disposition") ?? "";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  if (star) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      // fall through
    }
  }
  const plain = /filename="([^"]+)"/i.exec(cd);
  return plain ? plain[1] : fallback;
}

export function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl = options.baseUrl ?? "";
  const doFetch = (input: string, init: RequestInit) => (options.fetch ?? globalThis.fetch)(input, init);

  function headersFor(opts: CallOptions | undefined, json: boolean): Headers {
    const headers = new Headers();
    headers.set("accept", `${CONTENT_TYPES.json}, ${CONTENT_TYPES.problem}`);
    if (json) headers.set("content-type", CONTENT_TYPES.json);
    const token = opts?.sessionToken !== undefined ? opts.sessionToken : (options.getSessionToken?.() ?? null);
    if (token) headers.set("authorization", `Bearer ${token}`);
    const passcode = opts?.passcode !== undefined ? opts.passcode : (options.getPasscode?.() ?? null);
    if (passcode) headers.set(HEADERS.passcode, passcode);
    return headers;
  }

  async function send(path: string, init: RequestInit): Promise<Response> {
    // Wave 2: endpoints that need a caller get a session first when there is none (the public demo).
    if (options.ensureSessionToken && needsCaller(path)) {
      const headers = new Headers(init.headers);
      if (!headers.has("authorization")) {
        const token = await options.ensureSessionToken().catch(() => null);
        if (token) {
          headers.set("authorization", `Bearer ${token}`);
          init = { ...init, headers };
        }
      }
    }
    // Requests carrying a form file and a report must stay under the platform's 4.5 MB body limit:
    // say so clearly instead of letting the platform answer with a bare 413.
    if (typeof init.body === "string" && init.body.length > MAX_FORM_REQUEST_BYTES) {
      throw new ApiError({
        type: "about:blank",
        title: "This request is too large to send",
        status: 413,
        code: "PAYLOAD_TOO_LARGE",
        detail: `The form file and the report together are over ${(MAX_FORM_REQUEST_BYTES / (1024 * 1024)).toFixed(1)} MB. Use a smaller copy of the referrer's form (for example, save the PDF without embedded images), then try again.`,
      });
    }
    let res: Response;
    try {
      res = await doFetch(baseUrl + path, { ...init, cache: "no-store" });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      throw new ApiError({
        type: "about:blank",
        title: "Network error",
        status: 0,
        code: "NETWORK_ERROR",
        detail: "Could not reach the server. Check your connection and try again.",
        retryable: true,
      });
    }
    if (!res.ok) throw await toApiError(res);
    return res;
  }

  async function toApiError(res: Response): Promise<ApiError> {
    try {
      const parsed = ProblemSchema.safeParse(await res.json());
      if (parsed.success) return new ApiError(parsed.data);
    } catch {
      // not JSON
    }
    return new ApiError({
      type: "about:blank",
      title: res.statusText || `HTTP ${res.status}`,
      status: res.status,
      code: `HTTP_${res.status}`,
    });
  }

  async function parseJson<S extends z.ZodType>(res: Response, schema: S): Promise<z.output<S>> {
    const parsed = schema.safeParse(await res.json());
    if (!parsed.success) {
      throw new ApiError({
        type: "about:blank",
        title: "Unexpected response from the server",
        status: res.status,
        code: "BAD_RESPONSE",
        detail: parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.map(String).join(".")}: ${i.message}`)
          .join("; "),
      });
    }
    return parsed.data;
  }

  async function getJson<S extends z.ZodType>(path: string, schema: S, opts?: CallOptions): Promise<z.output<S>> {
    const res = await send(path, { method: "GET", headers: headersFor(opts, false), signal: opts?.signal });
    return parseJson(res, schema);
  }

  async function postJson<S extends z.ZodType>(
    path: string,
    body: unknown,
    schema: S,
    opts?: CallOptions,
    extraHeaders?: Record<string, string>,
  ): Promise<z.output<S>> {
    const headers = headersFor(opts, true);
    for (const [k, v] of Object.entries(extraHeaders ?? {})) headers.set(k, v);
    const res = await send(path, { method: "POST", headers, body: JSON.stringify(body), signal: opts?.signal });
    return parseJson(res, schema);
  }

  /** `fallbackName` without an extension gets one from the content type ("report" → "report.docx"). */
  async function download(path: string, init: RequestInit, fallbackName: string): Promise<FileDownload> {
    const res = await send(path, init);
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const fallback = /\.[a-z0-9]{2,5}$/i.test(fallbackName) ? fallbackName : `${fallbackName}.${extensionFor(contentType)}`;
    return {
      blob: await res.blob(),
      fileName: fileNameFrom(res, fallback),
      kind: res.headers.get(HEADERS.renderKind) === "final" ? "final" : "draft",
      contentSha256: res.headers.get(HEADERS.contentSha256),
      contentType,
      warnings: parseWarnings(res.headers.get(HEADERS.fillWarnings)),
      fileToken: res.headers.get(HEADERS.fileToken),
    };
  }

  return {
    /** GET /health */
    health: (opts?: CallOptions): Promise<HealthResponse> => getJson(reportApiPaths.health(), HealthResponseSchema, opts),

    /** GET /connectors */
    connectors: (opts?: CallOptions): Promise<ConnectorsResponse> =>
      getJson(reportApiPaths.connectors(), ConnectorsResponseSchema, opts),

    /**
     * POST /launch – SERVER-TO-SERVER ONLY (the clinic system's server sends its partner key).
     * Provided for completeness and tests; never call it from a browser with a real partner key.
     */
    launch: (body: LaunchRequest, partnerKey: string, opts?: CallOptions): Promise<LaunchResponse> =>
      postJson(reportApiPaths.launch(), body, LaunchResponseSchema, { ...opts, sessionToken: null }, {
        [HEADERS.partnerKey]: partnerKey,
      }),

    /** POST /launch/verify */
    verifyLaunch: (token: string, opts?: CallOptions): Promise<LaunchVerifyResponse> =>
      postJson(reportApiPaths.launchVerify(), { token }, LaunchVerifyResponseSchema, { ...opts, sessionToken: null }),

    /** POST /sessions/demo */
    demoSession: (body: DemoSessionRequest, opts?: CallOptions): Promise<DemoSessionResponse> =>
      postJson(reportApiPaths.sessionsDemo(), body, DemoSessionResponseSchema, { ...opts, sessionToken: null }),

    /** GET /connectors/{id}/patients?search= (session) */
    patients: (connectorId: string, search?: string, opts?: CallOptions): Promise<PatientsResponse> =>
      getJson(reportApiPaths.patients(connectorId, search), PatientsResponseSchema, opts),

    /** GET /connectors/{id}/patients/{pid}/episodes/{eid}/bundle (session) */
    bundle: (connectorId: string, patientId: string, episodeId: string, opts?: CallOptions): Promise<BundleResponse> =>
      getJson(reportApiPaths.bundle(connectorId, patientId, episodeId), BundleResponseSchema, opts),

    /** POST /connectors/file-import/bundle (session) */
    fileImportBundle: (body: FileImportBundleRequest, opts?: CallOptions): Promise<BundleResponse> =>
      postJson(reportApiPaths.fileImportBundle(), body, BundleResponseSchema, opts),

    /** POST /connectors/file-import/read (wave 3): the bundle, or ordinary clinic notes to check first */
    fileImportRead: (body: FileImportBundleRequest, opts?: CallOptions): Promise<FileImportReadResponse> =>
      postJson(reportApiPaths.fileImportRead(), body, FileImportReadResponseSchema, opts),

    /** POST /connectors/file-import/confirm (wave 3): the checked notes → the bundle */
    fileImportConfirm: (body: FileImportConfirmRequest, opts?: CallOptions): Promise<BundleResponse> =>
      postJson(reportApiPaths.fileImportConfirm(), body, BundleResponseSchema, opts),

    /** GET /templates */
    templates: (opts?: CallOptions): Promise<TemplatesListResponse> =>
      getJson(reportApiPaths.templates(), TemplatesListResponseSchema, opts),

    /** GET /templates/{id} */
    template: (id: string, opts?: CallOptions): Promise<TemplateGetResponse> =>
      getJson(reportApiPaths.template(id), TemplateGetResponseSchema, opts),

    /** GET /templates/{id}/docx – the tagged Word template */
    templateDocx: (id: string, opts?: CallOptions): Promise<FileDownload> =>
      download(reportApiPaths.templateDocx(id), { method: "GET", headers: headersFor(opts, false), signal: opts?.signal }, `${id}.docx`),

    /** POST /templates/validate */
    validateTemplate: (body: TemplatesValidateRequest, opts?: CallOptions): Promise<TemplatesValidateResponse> =>
      postJson(reportApiPaths.templatesValidate(), body, TemplatesValidateResponseSchema, opts),

    /** POST /drafts (sends the passcode when available; required for live AI) */
    drafts: (body: DraftsRequest, opts?: CallOptions): Promise<DraftsResponse> =>
      postJson(reportApiPaths.drafts(), body, DraftsResponseSchema, opts),

    /** POST /validate */
    validate: (body: ValidateRequest, opts?: CallOptions): Promise<ValidateResponse> =>
      postJson(reportApiPaths.validate(), body, ValidateResponseSchema, opts),

    /** POST /sign (409 SIGNOFF_BLOCKED → ApiError with problem.flags) */
    sign: (body: SignRequest, opts?: CallOptions): Promise<SignResponse> =>
      postJson(reportApiPaths.sign(), body, SignResponseSchema, opts),

    /**
     * POST /render?format=docx|pdf|original → file (kind "final" only with a verified receipt).
     * Form reports: send `form` + `fileBase64` and format "original" (the referrer's own file type) or
     * "pdf" (503 PDF_CONVERSION_UNAVAILABLE where Word → PDF cannot run: offer the Word download).
     */
    render: (format: RenderFormat, body: RenderRequest, opts?: CallOptions): Promise<FileDownload> =>
      download(
        reportApiPaths.render(format),
        { method: "POST", headers: headersFor(opts, true), body: JSON.stringify(body), signal: opts?.signal },
        format === "original" ? "report" : `report.${format}`,
      ),

    /** POST /connectors/{id}/documents (session) – write-back of a signed file */
    attachDocument: (connectorId: string, body: DocumentsRequest, opts?: CallOptions): Promise<DocumentsResponse> =>
      postJson(reportApiPaths.documents(connectorId), body, DocumentsResponseSchema, opts),

    /* Referrer forms (Revision 2) */

    /** POST /forms/analyse → proposed form map (sends the passcode when available; required for live AI) */
    analyseForm: (body: FormsAnalyseRequest, opts?: CallOptions): Promise<FormsAnalyseResponse> =>
      postJson(reportApiPaths.formsAnalyse(), body, FormsAnalyseResponseSchema, opts),

    /** GET /forms/samples → bundled fictional referrer forms (with pre-confirmed maps where recorded) */
    formSamples: (opts?: CallOptions): Promise<FormSamplesResponse> =>
      getJson(reportApiPaths.formSamples(), FormSamplesResponseSchema, opts),

    /** GET /forms/samples/{id}/file → the sample's original .docx / .pdf */
    formSampleFile: (id: string, opts?: CallOptions): Promise<FileDownload> =>
      download(reportApiPaths.formSampleFile(id), { method: "GET", headers: headersFor(opts, false), signal: opts?.signal }, id),

    /** POST /forms/confirm (session) → the map confirmed, with the server's attestation of exactly that map */
    confirmForm: (body: FormsConfirmRequest, opts?: CallOptions): Promise<FormsConfirmResponse> =>
      postJson(reportApiPaths.formsConfirm(), body, FormsConfirmResponseSchema, opts),

    /** POST /ai/payload-preview → exactly what a drafting call would send to Claude (no AI call) */
    aiPayloadPreview: (body: AiPayloadPreviewRequest, opts?: CallOptions): Promise<AiPayloadPreviewResponse> =>
      postJson(reportApiPaths.aiPayloadPreview(), body, AiPayloadPreviewResponseSchema, opts),

    /** POST /forms/fill-preview → the referrer's form filled with the current answers, marked DRAFT */
    fillPreview: (body: FormFillPreviewRequest, opts?: CallOptions): Promise<FileDownload> =>
      download(
        reportApiPaths.formsFillPreview(),
        { method: "POST", headers: headersFor(opts, true), body: JSON.stringify(body), signal: opts?.signal },
        "form-preview",
      ),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

let pendingDemoSession: Promise<string | null> | null = null;
let demoSessionUnavailableUntil = 0;

/**
 * The stored session token, else a new public-demo session (stored like the picker's, so the tab reuses
 * it). Null when the public demo is off on this site (sessions/demo answers 404): then calls go without
 * one and a clinic's sign-in cookie identifies the caller. Retried at most once a minute after a failure.
 */
async function ensureDemoSessionToken(): Promise<string | null> {
  const current = getSession();
  if (getStoreMode() === "server") {
    // A clinic's own Studio: the sign-in cookie is the caller. Only a launch session of a clinic (it narrows the
    // member to one episode) is worth sending; a public-demo session is never minted or sent here.
    return current && current.claims.tenantId !== DEMO_TENANT_ID ? current.token : null;
  }
  if (current) return current.token;
  if (Date.now() < demoSessionUnavailableUntil) return null;
  if (!pendingDemoSession) {
    const plain = createApiClient({});
    pendingDemoSession = plain
      .demoSession({ purpose: "picker" })
      .then(({ session }) => {
        setSession(session);
        return session.token;
      })
      .catch(() => {
        demoSessionUnavailableUntil = Date.now() + 60_000;
        return null;
      })
      .finally(() => {
        pendingDemoSession = null;
      });
  }
  return pendingDemoSession;
}

/**
 * The stored session token for a call. In a clinic's own Studio (server storage) a public-demo session left in
 * this tab (e.g. by an earlier visit to /reports) is not sent: the sign-in cookie identifies the caller.
 */
function storedSessionToken(): string | null {
  const current = getSession();
  if (!current) return null;
  if (getStoreMode() === "server" && current.claims.tenantId === DEMO_TENANT_ID) return null;
  return current.token;
}

/** Default same-origin client using the stored session token and passcode. */
export const api: ApiClient = createApiClient({
  getSessionToken: storedSessionToken,
  getPasscode,
  ensureSessionToken: ensureDemoSessionToken,
});

/** Base64 of a Blob/ArrayBuffer (for template uploads and write-back). */
export async function toBase64(data: Blob | ArrayBuffer): Promise<string> {
  const buffer = data instanceof Blob ? await data.arrayBuffer() : data;
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

/** Trigger a browser download of a Blob. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
