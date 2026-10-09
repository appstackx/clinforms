import "server-only";

/**
 * Authenticated, paged HTTP client for the simulated TM3 API (`/api/tm3-sim/v1`).
 *
 * - Every call sends `Authorization: Bearer <TM3_SIM_TOKEN>` (from ctx.credentials) to ctx.baseUrl.
 * - List endpoints are paged (`?page=&page_size=`); the client follows `next_page` up to MAX_PAGES.
 * - Every upstream call appends one TraceEntry to ctx.trace: method, URL path (no host, no token),
 *   status, duration and transport ("in-process" when the glue's fallback served it, detected via
 *   TRANSPORT_HEADER). Never note text.
 * - Responses are validated against the wire schemas; failures become ConnectorError
 *   (401/403 → UNAUTHORIZED, 404 → NOT_FOUND, network/5xx → UPSTREAM_ERROR, bad shape → INVALID_DATA).
 *
 * Owner: integration agent.
 */
import type { z } from "zod";
import { tm3SimPaths } from "../../api/contract";
import { ConnectorError, TRANSPORT_HEADER, type ConnectorContext, type TraceEntry } from "../types";
import {
  SimAttachDocumentResponseSchema,
  SimAppointmentsPageSchema,
  SimEpisodesPageSchema,
  SimErrorSchema,
  SimNotesPageSchema,
  SimOutcomeMeasuresPageSchema,
  SimPatientSchema,
  SimPatientsPageSchema,
  type SimAppointment,
  type SimAttachDocumentRequest,
  type SimAttachDocumentResponse,
  type SimEpisode,
  type SimNote,
  type SimOutcomeMeasure,
  type SimPatient,
} from "./wire";

export interface Tm3SimClient {
  searchPatients(search?: string): Promise<SimPatient[]>;
  getPatient(patientId: string): Promise<SimPatient>;
  listEpisodes(patientId: string): Promise<SimEpisode[]>;
  listNotes(episodeId: string): Promise<SimNote[]>;
  listAppointments(episodeId: string): Promise<SimAppointment[]>;
  listOutcomeMeasures(episodeId: string): Promise<SimOutcomeMeasure[]>;
  attachDocument(patientId: string, body: SimAttachDocumentRequest): Promise<SimAttachDocumentResponse>;
}

/** Page size requested from list endpoints (the simulated API allows up to 100). */
export const TM3_SIM_PAGE_SIZE = 50;
/** Safety stop for runaway paging. */
const MAX_PAGES = 20;

type PageSchema<T> = z.ZodType<{ data: T[]; next_page: number | null; total: number }>;

export function createTm3SimClient(ctx: ConnectorContext): Tm3SimClient {
  const base = ctx.baseUrl.replace(/\/+$/, "");

  async function call<T>(
    method: "GET" | "POST",
    path: string,
    schema: z.ZodType<T>,
    opts: { body?: unknown; describe?: (data: T) => string | undefined } = {},
  ): Promise<T> {
    const headers = new Headers({ accept: "application/json" });
    if (ctx.credentials.kind === "bearer") headers.set("authorization", `Bearer ${ctx.credentials.token}`);
    if (opts.body !== undefined) headers.set("content-type", "application/json");

    const started = Date.now();
    // Reserve the trace slot now so parallel calls are logged in the order they were made.
    const entry: TraceEntry = { method, url: path, status: 0, ms: 0, transport: "http" };
    ctx.trace.push(entry);
    const finish = (fields: Partial<TraceEntry>) => {
      Object.assign(entry, { ms: Date.now() - started }, fields);
      if (entry.note === undefined) delete entry.note;
    };
    let res: Response;
    try {
      res = await ctx.fetch(base + path, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      });
    } catch {
      finish({ note: "Network error – no response" });
      throw new ConnectorError("UPSTREAM_ERROR", "The simulated TM3 API could not be reached.");
    }

    const transport = res.headers.get(TRANSPORT_HEADER) === "in-process" ? "in-process" : "http";
    let payload: unknown = undefined;
    let parseFailed = false;
    try {
      payload = await res.json();
    } catch {
      parseFailed = true;
    }

    if (!res.ok) {
      const simError = SimErrorSchema.safeParse(payload);
      const code = simError.success ? simError.data.error.code : undefined;
      finish({ status: res.status, transport, note: code ? `Error: ${code}` : undefined });
      throw httpFailure(res.status, simError.success ? simError.data.error.message : undefined);
    }

    const parsed = parseFailed ? null : schema.safeParse(payload);
    if (!parsed || !parsed.success) {
      finish({ status: res.status, transport, note: "Unexpected response shape" });
      throw new ConnectorError(
        "INVALID_DATA",
        "The simulated TM3 API returned data in an unexpected format.",
        res.status,
      );
    }
    const described = opts.describe?.(parsed.data);
    const fallback = "in-process fallback (HTTP unavailable)";
    finish({
      status: res.status,
      transport,
      note: transport === "in-process" ? (described ? `${described} · ${fallback}` : fallback) : described,
    });
    return parsed.data;
  }

  /** GET every page of a list endpoint. */
  async function getAll<T>(path: string, schema: PageSchema<T>): Promise<T[]> {
    const out: T[] = [];
    let page: number | null = 1;
    let pages = 0;
    while (page !== null && pages < MAX_PAGES) {
      const sep = path.indexOf("?") >= 0 ? "&" : "?";
      const current: number = page;
      const data = await call("GET", `${path}${sep}page=${current}&page_size=${TM3_SIM_PAGE_SIZE}`, schema, {
        describe: (d) => `page ${current} · ${d.data.length} of ${d.total} item${d.total === 1 ? "" : "s"}`,
      });
      out.push(...data.data);
      page = data.next_page;
      pages += 1;
    }
    return out;
  }

  return {
    searchPatients: (search) => getAll(tm3SimPaths.patients(search?.trim() || undefined), SimPatientsPageSchema),
    getPatient: (patientId) => call("GET", tm3SimPaths.patient(patientId), SimPatientSchema),
    listEpisodes: (patientId) => getAll(tm3SimPaths.patientEpisodes(patientId), SimEpisodesPageSchema),
    listNotes: (episodeId) => getAll(tm3SimPaths.episodeNotes(episodeId), SimNotesPageSchema),
    listAppointments: (episodeId) => getAll(tm3SimPaths.episodeAppointments(episodeId), SimAppointmentsPageSchema),
    listOutcomeMeasures: (episodeId) =>
      getAll(tm3SimPaths.episodeOutcomeMeasures(episodeId), SimOutcomeMeasuresPageSchema),
    attachDocument: (patientId, body) =>
      call("POST", tm3SimPaths.patientDocuments(patientId), SimAttachDocumentResponseSchema, {
        body,
        describe: (d) => `document ${d.external_document_id} received`,
      }),
  };
}

function httpFailure(status: number, message?: string): ConnectorError {
  if (status === 401 || status === 403) {
    return new ConnectorError(
      "UNAUTHORIZED",
      "The simulated TM3 API rejected our credentials (check TM3_SIM_TOKEN).",
      status,
    );
  }
  if (status === 404) return new ConnectorError("NOT_FOUND", message ?? "Not found in the simulated TM3 record.", status);
  if (status === 400 || status === 422) {
    return new ConnectorError("INVALID_DATA", message ?? "The simulated TM3 API rejected the request.", status);
  }
  return new ConnectorError("UPSTREAM_ERROR", `The simulated TM3 API returned an error (HTTP ${status}).`, status);
}
