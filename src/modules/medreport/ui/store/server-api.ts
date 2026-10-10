/**
 * Transport of the "server" store backend: same-origin fetches to /api/reports/v1/store/** (the sign-in cookie
 * travels with them). No caching and no retries of record writes here – ui/store/server-store.ts owns the cache
 * and ui/store/write-queue.ts the ordering and retries. Every outcome is classified so the queue knows whether
 * to retry (network, 5xx, 429), wait for sign-in (401/403), reload the stored copy (409/404) or give up (other 4xx).
 */
import { CONTENT_TYPES, ProblemSchema } from "../../api/contract";
import {
  STORE_FILE_CHUNK_BYTES,
  STORE_MEMBER_HEADER,
  STORE_TENANT_HEADER,
  StoreConflictSchema,
  StoreFileCompleteResponseSchema,
  StoreFileInitResponseSchema,
  StoreFormResponseSchema,
  StoreReportResponseSchema,
  StoreSettingsSchema,
  StoreSnapshotResponseSchema,
  revTag,
  storeApiPaths,
  storeChunkCount,
  type ReferrerLinks,
  type StoreSnapshotResponse,
} from "../../api/store-contract";
import { sha256HexBytes } from "../../core/fingerprint";
import { FormMimeTypeSchema } from "../../core/schemas";
import type { FormDefinition, Report } from "../../core/types";
import type { StoreScope } from "./mode";
import type { StoredFormFile } from "./types";

/** keepalive requests may carry at most 64 KiB in flight (all of them together): stay well under it. */
const KEEPALIVE_MAX_BODY = 60_000;

export type FailureKind = "conflict" | "not_found" | "rejected" | "retry" | "blocked";

export type PutOutcome<T> =
  | { ok: true; rev: number; record: T; downgraded?: boolean }
  | { ok: false; kind: "conflict"; current: { rev: number; record: T } | null; message: string }
  | { ok: false; kind: Exclude<FailureKind, "conflict">; status: number; message: string };

export type DeleteOutcome = { ok: true } | { ok: false; kind: FailureKind; status: number; message: string };

export class StoreRequestError extends Error {
  readonly status: number;
  readonly kind: FailureKind;
  /** The problem code, when the server sent one. */
  readonly code?: string;
  constructor(status: number, kind: FailureKind, message: string, code?: string) {
    super(message);
    this.name = "StoreRequestError";
    this.status = status;
    this.kind = kind;
    if (code) this.code = code;
  }
}

/** The server refused the request because the page's sign-in changed (fix wave 2): never retried. */
export const SIGN_IN_CHANGED_CODES: readonly string[] = ["TENANT_MISMATCH", "SIGN_IN_CHANGED"];

export interface ServerApi {
  snapshot(): Promise<StoreSnapshotResponse>;
  getReport(id: string): Promise<{ rev: number; report: Report } | null>;
  putReport(report: Report, baseRev: number | null, opts?: { keepalive?: boolean }): Promise<PutOutcome<Report>>;
  deleteReport(id: string, opts?: { keepalive?: boolean }): Promise<DeleteOutcome>;
  getForm(id: string): Promise<{ rev: number; form: FormDefinition } | null>;
  putForm(form: FormDefinition, baseRev: number | null, opts?: { keepalive?: boolean }): Promise<PutOutcome<FormDefinition>>;
  deleteForm(id: string, opts?: { keepalive?: boolean }): Promise<DeleteOutcome>;
  putSettings(links: ReferrerLinks, opts?: { keepalive?: boolean }): Promise<PutOutcome<ReferrerLinks>>;
  /** Chunked, resumable upload; true once the clinic holds the file. */
  uploadFile(file: StoredFormFile, opts?: { signal?: AbortSignal }): Promise<boolean>;
  getFile(sha256: string, opts?: { signal?: AbortSignal }): Promise<StoredFormFile | null>;
}

/** Plain-English fallback messages (shown in the Studio's save status). */
const MESSAGES = {
  network: "The connection was lost. Changes will be saved when it is back.",
  server: "The server could not save the change just now. It will try again.",
  signedOut: "Your session has ended. Sign in again to save your changes.",
  notFound: "This item was deleted elsewhere.",
  conflict: "This item was changed elsewhere. The latest copy was loaded.",
  rejected: "The change could not be saved.",
} as const;

export function classifyStatus(status: number, code?: unknown): FailureKind {
  // A change made under another sign-in (another clinic or member) is refused for good, never kept for sign-in.
  if (status === 403 && typeof code === "string" && SIGN_IN_CHANGED_CODES.includes(code)) return "rejected";
  if (status === 401 || status === 403) return "blocked";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 408 || status === 425 || status === 429 || status >= 500) return "retry";
  return "rejected";
}

function defaultMessage(kind: FailureKind, status: number): string {
  switch (kind) {
    case "blocked":
      return MESSAGES.signedOut;
    case "not_found":
      return MESSAGES.notFound;
    case "conflict":
      return MESSAGES.conflict;
    case "retry":
      return status === 0 ? MESSAGES.network : MESSAGES.server;
    case "rejected":
      return MESSAGES.rejected;
  }
}

async function problemOf(res: Response): Promise<{ raw: unknown; detail: string | null; code?: string }> {
  try {
    const raw: unknown = await res.json();
    const parsed = ProblemSchema.safeParse(raw);
    return { raw, detail: parsed.success ? (parsed.data.detail ?? parsed.data.title) : null, ...(parsed.success ? { code: parsed.data.code } : {}) };
  } catch {
    return { raw: null, detail: null };
  }
}

export interface ServerApiOptions {
  /** The clinic and member the page was opened for: sent with every request (fix wave 2). */
  scope?: () => StoreScope | null;
}

export function createServerApi(fetchImpl: typeof fetch = (input, init) => fetch(input, init), apiOptions: ServerApiOptions = {}): ServerApi {
  async function call(url: string, init: RequestInit & { keepalive?: boolean } = {}): Promise<Response | null> {
    const headers = new Headers(init.headers);
    if (!headers.has("accept")) headers.set("accept", CONTENT_TYPES.json);
    const scope = apiOptions.scope?.() ?? null;
    if (scope) {
      headers.set(STORE_TENANT_HEADER, scope.tenantId);
      if (scope.userId) headers.set(STORE_MEMBER_HEADER, scope.userId);
    }
    const body = init.body;
    const keepalive = Boolean(init.keepalive) && (typeof body !== "string" || body.length <= KEEPALIVE_MAX_BODY);
    try {
      return await fetchImpl(url, { ...init, headers, keepalive, credentials: "same-origin", cache: "no-store" });
    } catch {
      return null; // network failure (or aborted)
    }
  }

  async function getJson<T>(url: string, parse: (raw: unknown) => T | null, signal?: AbortSignal): Promise<T | null> {
    const res = await call(url, { method: "GET", signal });
    if (!res) throw new StoreRequestError(0, "retry", MESSAGES.network);
    if (res.status === 404) return null;
    if (!res.ok) {
      const { detail, code } = await problemOf(res);
      const kind = classifyStatus(res.status, code);
      throw new StoreRequestError(res.status, kind, detail ?? defaultMessage(kind, res.status), code);
    }
    const parsed = parse(await res.json().catch(() => null));
    if (parsed === null) throw new StoreRequestError(res.status, "retry", MESSAGES.server);
    return parsed;
  }

  async function put<T>(
    url: string,
    body: unknown,
    baseRev: number | null,
    keepalive: boolean,
    read: (raw: unknown) => { rev: number; record: T; downgraded?: boolean } | null,
    readCurrent: (raw: unknown) => { rev: number; record: T } | null,
  ): Promise<PutOutcome<T>> {
    const headers: Record<string, string> = { "content-type": CONTENT_TYPES.json };
    if (baseRev !== null) headers["if-match"] = revTag(baseRev);
    const res = await call(url, { method: "PUT", headers, body: JSON.stringify(body), keepalive });
    if (!res) return { ok: false, kind: "retry", status: 0, message: MESSAGES.network };
    if (res.ok) {
      const parsed = read(await res.json().catch(() => null));
      return parsed ? { ok: true, ...parsed } : { ok: false, kind: "retry", status: res.status, message: MESSAGES.server };
    }
    const { raw, detail, code } = await problemOf(res);
    const kind = classifyStatus(res.status, code);
    if (kind === "conflict") return { ok: false, kind, current: readCurrent(raw), message: detail ?? MESSAGES.conflict };
    return { ok: false, kind, status: res.status, message: detail ?? defaultMessage(kind, res.status) };
  }

  async function del(url: string, keepalive: boolean): Promise<DeleteOutcome> {
    const res = await call(url, { method: "DELETE", keepalive });
    if (!res) return { ok: false, kind: "retry", status: 0, message: MESSAGES.network };
    if (res.ok || res.status === 404) return { ok: true };
    const { detail, code } = await problemOf(res);
    const kind = classifyStatus(res.status, code);
    return { ok: false, kind, status: res.status, message: detail ?? defaultMessage(kind, res.status) };
  }

  async function uploadOnce(file: StoredFormFile, signal?: AbortSignal): Promise<"stored" | "corrupt" | "failed"> {
    const size = file.bytes.byteLength;
    const meta = { size, name: file.fileName.slice(0, 255) || "form", mime: file.mimeType };
    const initRes = await call(storeApiPaths.files(), {
      method: "POST",
      headers: { "content-type": CONTENT_TYPES.json },
      body: JSON.stringify({ sha256: file.sha256, ...meta }),
      signal,
    });
    if (!initRes || !initRes.ok) return "failed";
    const init = StoreFileInitResponseSchema.safeParse(await initRes.json().catch(() => null));
    if (!init.success) return "failed";
    if (init.data.complete) return "stored";
    const chunkBytes = init.data.chunkBytes || STORE_FILE_CHUNK_BYTES;
    const sendChunks = async (indexes: number[]): Promise<boolean> => {
      for (const idx of indexes) {
        const part = file.bytes.slice(idx * chunkBytes, Math.min(size, (idx + 1) * chunkBytes));
        let sent = false;
        for (let attempt = 0; attempt < 3 && !sent; attempt++) {
          if (signal?.aborted) return false;
          const res = await call(storeApiPaths.fileChunk(file.sha256, idx, size), {
            method: "PUT",
            headers: { "content-type": "application/octet-stream" },
            body: part,
            signal,
          });
          if (res?.ok) sent = true;
          else if (res && classifyStatus(res.status) !== "retry") return false;
        }
        if (!sent) return false;
      }
      return true;
    };
    const present = new Set(init.data.present);
    const todo: number[] = [];
    for (let i = 0; i < storeChunkCount(size); i++) if (!present.has(i)) todo.push(i);
    if (!(await sendChunks(todo))) return "failed";
    for (let round = 0; round < 2; round++) {
      const res = await call(storeApiPaths.fileComplete(file.sha256), {
        method: "POST",
        headers: { "content-type": CONTENT_TYPES.json },
        body: JSON.stringify(meta),
        signal,
      });
      if (!res) return "failed";
      if (res.ok) return StoreFileCompleteResponseSchema.safeParse(await res.json().catch(() => null)).success ? "stored" : "failed";
      const { raw } = await problemOf(res);
      const code = (raw as { code?: unknown } | null)?.code;
      if (res.status === 409 && code === "UPLOAD_INCOMPLETE") {
        const missing = (raw as { missing?: unknown }).missing;
        if (!Array.isArray(missing) || !(await sendChunks(missing.filter((n): n is number => Number.isInteger(n))))) return "failed";
        continue;
      }
      return code === "UPLOAD_CORRUPT" ? "corrupt" : "failed";
    }
    return "failed";
  }

  return {
    snapshot: async () => {
      const snap = await getJson(storeApiPaths.snapshot(), (raw) => {
        const parsed = StoreSnapshotResponseSchema.safeParse(raw);
        return parsed.success ? parsed.data : null;
      });
      if (!snap) throw new StoreRequestError(404, "not_found", MESSAGES.notFound);
      return snap;
    },
    getReport: (id) =>
      getJson(storeApiPaths.report(id), (raw) => {
        const parsed = StoreReportResponseSchema.safeParse(raw);
        return parsed.success ? { rev: parsed.data.rev, report: parsed.data.report } : null;
      }),
    putReport: (report, baseRev, opts = {}) =>
      put<Report>(
        storeApiPaths.report(report.id),
        { report },
        baseRev,
        Boolean(opts.keepalive),
        (raw) => {
          const parsed = StoreReportResponseSchema.safeParse(raw);
          return parsed.success ? { rev: parsed.data.rev, record: parsed.data.report } : null;
        },
        (raw) => {
          const parsed = StoreConflictSchema.safeParse(raw);
          const current = parsed.success ? parsed.data.current : null;
          return current?.report ? { rev: current.rev, record: current.report } : null;
        },
      ),
    deleteReport: (id, opts = {}) => del(storeApiPaths.report(id), Boolean(opts.keepalive)),
    getForm: (id) =>
      getJson(storeApiPaths.form(id), (raw) => {
        const parsed = StoreFormResponseSchema.safeParse(raw);
        return parsed.success ? { rev: parsed.data.rev, form: parsed.data.form } : null;
      }),
    putForm: (form, baseRev, opts = {}) =>
      put<FormDefinition>(
        storeApiPaths.form(form.id),
        { form },
        baseRev,
        Boolean(opts.keepalive),
        (raw) => {
          const parsed = StoreFormResponseSchema.safeParse(raw);
          return parsed.success ? { rev: parsed.data.rev, record: parsed.data.form, downgraded: parsed.data.downgraded } : null;
        },
        (raw) => {
          const parsed = StoreConflictSchema.safeParse(raw);
          const current = parsed.success ? parsed.data.current : null;
          return current?.form ? { rev: current.rev, record: current.form } : null;
        },
      ),
    deleteForm: (id, opts = {}) => del(storeApiPaths.form(id), Boolean(opts.keepalive)),
    putSettings: (links, opts = {}) =>
      put<ReferrerLinks>(
        storeApiPaths.settings(),
        { referrerLinks: links },
        null,
        Boolean(opts.keepalive),
        (raw) => {
          const parsed = StoreSettingsSchema.safeParse(raw);
          return parsed.success ? { rev: 1, record: parsed.data.referrerLinks } : null;
        },
        () => null,
      ),
    uploadFile: async (file, opts = {}) => {
      const first = await uploadOnce(file, opts.signal);
      if (first !== "corrupt") return first === "stored";
      // The server threw the damaged upload away: one fresh attempt.
      return (await uploadOnce(file, opts.signal)) === "stored";
    },
    getFile: async (sha256, opts = {}) => {
      const res = await call(storeApiPaths.file(sha256), { method: "GET", signal: opts.signal, headers: { accept: "*/*" } });
      if (!res || !res.ok) return null;
      const mime = FormMimeTypeSchema.safeParse((res.headers.get("content-type") ?? "").split(";")[0].trim());
      if (!mime.success) return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if ((await sha256HexBytes(bytes)) !== sha256) return null;
      return { sha256, fileName: fileNameOf(res.headers.get("content-disposition")) ?? "form", mimeType: mime.data, bytes };
    },
  };
}

/** The file name from a Content-Disposition header (RFC 6266 filename*, else filename). */
function fileNameOf(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      // fall through
    }
  }
  const plain = /filename="([^"]*)"/i.exec(header);
  return plain ? plain[1] : null;
}
