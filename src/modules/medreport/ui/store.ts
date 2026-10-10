/**
 * The Studio's store. Every export and signature from before wave 2 is kept; behind them sit two backends
 * (docs/production-architecture.md §5), chosen by the host through HostHooks.storage (ui/store/mode.ts):
 *
 * - "browser" (default, the public demo at /reports): reports in this browser's localStorage, one key per report
 *   ("medreport.report.<id>"); form maps under "medreport.forms"; the referrers' original files in IndexedDB
 *   ("medreport-forms", keyed by SHA-256) with an in-memory fallback; bundled sample forms seeded lazily from
 *   GET /forms/samples (ensureSampleForms). Exactly the pre-wave-2 code (ui/store/browser-backend.ts). Same-tab
 *   changes dispatch STORE_EVENT on window; other tabs sync via the 'storage' event.
 * - "server" (a clinic's own Studio): the clinic's storage (/api/reports/v1/store/**) behind an in-memory cache
 *   and a per-record write queue (ui/store/server-store.ts). Reads stay synchronous (from the cache the hooks
 *   fill); saves update the cache at once and return true, then reach the server in order (If-Match revisions;
 *   a clash reloads the stored copy). Other tabs sync via BroadcastChannel and a refresh on focus. NOTHING from a
 *   report or form map is written to localStorage or IndexedDB. Sample forms are not seeded into a clinic.
 *
 * The session token and live passcode live in sessionStorage in both modes.
 *
 * Async extras (wave 2) for the places where a change must reach the server before moving on:
 * flushStore({keepalive}), saveReportDurable, saveFormDurable (in browser mode they resolve to the same result as
 * the synchronous call), and useStoreSync() {pending, failed, error} for a save indicator.
 *
 * Shared contract (orchestrator-owned).
 */
import { useCallback, useEffect, useState } from "react";
import { reportApiPaths, type FormSample } from "../api/contract";
import type { ReferrerLinks } from "../api/store-contract";
import { DEMO_TENANT_ID, PRODUCT, STORAGE_PREFIX } from "../config.public";
import { sha256HexBytes } from "../core/fingerprint";
import { CASE_EXPORT_FORMAT, CaseExportSchema, ReportSchema, SessionTokenSchema } from "../core/schemas";
import type { FormDefinition, Report, SessionToken } from "../core/types";
import { CASE_EXPORT_FORMAT_VERSION, decodeCaseReport, encodeCaseReport, type CaseExport } from "../core/case-export";
import * as browser from "./store/browser-backend";
import { STORE_EVENT, notify } from "./store/events";
import { getStoreMode, getStoreScope, onStoreScopeChange, setStoreMode, setStoreScope, type StoreMode, type StoreScope } from "./store/mode";
import { fetchSampleForms as fetchSamples } from "./store/samples";
import { createServerStore, type ServerStore, type StoreSyncState } from "./store/server-store";
import type { StoredFormFile } from "./store/types";

export { STORE_EVENT, getStoreMode, setStoreMode, getStoreScope, setStoreScope };
export type { StoreMode, StoreScope, StoreSyncState, StoredFormFile };
export const REPORT_KEY_PREFIX = browser.REPORT_KEY_PREFIX;
export const SESSION_KEY = `${STORAGE_PREFIX}session`;
export const PASSCODE_KEY = `${STORAGE_PREFIX}passcode`;

const server = (): boolean => getStoreMode() === "server";

let serverStore: ServerStore | null = null;
/** The server backend (created on first use; one per page load), scoped to the page's clinic and member. */
function srv(): ServerStore {
  if (!serverStore) {
    serverStore = createServerStore();
    serverStore.setScope(getStoreScope());
  }
  return serverStore;
}
// Another clinic or member (fix wave 2): the server backend forgets the previous scope's records and queue.
onStoreScopeChange((scope) => {
  serverStore?.setScope(scope);
});

/* ------------------------------------------------------------------------------------------------
 * Reports
 * ----------------------------------------------------------------------------------------------*/

/** All valid reports (this browser / the clinic's loaded reports), most recently updated first. */
export function listReports(): Report[] {
  return server() ? srv().listReports() : browser.listReports();
}

/** A report by ID, or null if it is not here ("This report is stored in another browser" in the demo). */
export function getReport(id: string): Report | null {
  return server() ? srv().getReport(id) : browser.getReport(id);
}

/**
 * Save (insert or replace). Browser: false if storage is unavailable or full. Server: true at once (the change is
 * queued; saveReportDurable / flushStore say when it reached the server). Callers set updatedAt.
 */
export function saveReport(report: Report): boolean {
  if (server()) return srv().saveReport(report);
  return demoRecord(report) && browser.saveReport(report);
}

/**
 * Browser storage only ever holds the public demo's records (tenant "demo"). A clinic's record reaching a browser
 * write – e.g. an unmount save racing a client-side switch from a clinic's Studio to the demo – is refused.
 */
function demoRecord(record: { tenantId?: unknown } | null | undefined): boolean {
  const tenantId = record?.tenantId;
  return tenantId === undefined || tenantId === DEMO_TENANT_ID;
}

export function deleteReport(id: string): void {
  if (server()) srv().deleteReport(id);
  else browser.deleteReport(id);
}

/**
 * Browser: remove every "medreport.*" key from localStorage and sessionStorage, and the stored form files
 * (IndexedDB "medreport-forms" and the in-memory fallback). Sample forms are re-seeded on next use.
 * Server: never touches the clinic's stored records – clears this tab's session keys and in-memory copies only.
 */
export function resetDemo(): void {
  if (!server()) {
    browser.resetDemo();
    return;
  }
  const storage = browser.sessionStore();
  for (const key of browser.storageKeys(storage)) {
    if (!key.startsWith(STORAGE_PREFIX)) continue;
    try {
      storage?.removeItem(key);
    } catch {
      // ignore
    }
  }
  srv().reset();
}

/* ------------------------------------------------------------------------------------------------
 * Case export / import ("Export case JSON")
 * ----------------------------------------------------------------------------------------------*/

/** The downloadable case file: the report in the public encoding (core/case-export.ts), no vendor or model names. */
export function buildCaseExport(report: Report, now: Date = new Date()): CaseExport {
  return {
    format: CASE_EXPORT_FORMAT,
    formatVersion: CASE_EXPORT_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    product: { name: PRODUCT.name, version: PRODUCT.version },
    report: encodeCaseReport(report),
  };
}

/** JSON blob of one report for download, or null if the report is not here. */
export function exportCase(reportId: string): Blob | null {
  const report = getReport(reportId);
  if (!report) return null;
  return new Blob([JSON.stringify(buildCaseExport(report), null, 2)], { type: "application/json" });
}

/** Suggested file name for an exported case, e.g. "Hart_case_rpt_3f9c….json". */
export function caseExportFileName(report: Report): string {
  const last = report.bundleSnapshot.registration.lastName.replace(/[^A-Za-z0-9-]/g, "");
  return `${last || "report"}_case_${report.id}.json`;
}

export type ImportCaseResult = { ok: true; report: Report } | { ok: false; error: string };

/** Parse an exported case file (does not save it). */
export function importCase(text: string): ImportCaseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "The file is not valid JSON." };
  }
  const envelope = CaseExportSchema.safeParse(raw);
  const notACase = { ok: false as const, error: `The file is not an exported ${PRODUCT.name} case.` };
  if (!envelope.success) return notACase;
  const { formatVersion, report } = envelope.data;
  const parsed = ReportSchema.safeParse(formatVersion === 1 ? report : decodeCaseReport(report));
  return parsed.success ? { ok: true, report: parsed.data } : notACase;
}

/* ------------------------------------------------------------------------------------------------
 * Session token and live passcode (sessionStorage, both modes)
 * ----------------------------------------------------------------------------------------------*/

/** The current session token, or null if missing or expired. */
export function getSession(now: Date = new Date()): SessionToken | null {
  const parsed = SessionTokenSchema.safeParse(browser.readJson(browser.sessionStore(), SESSION_KEY));
  if (!parsed.success) return null;
  return parsed.data.claims.exp * 1000 > now.getTime() ? parsed.data : null;
}

export function setSession(token: SessionToken): void {
  try {
    browser.sessionStore()?.setItem(SESSION_KEY, JSON.stringify(token));
  } catch {
    // ignore
  }
  notify();
}

export function clearSession(): void {
  try {
    browser.sessionStore()?.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
  notify();
}

export function getPasscode(): string | null {
  try {
    return browser.sessionStore()?.getItem(PASSCODE_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Store (or clear with null/"") the live drafting passcode for this tab session. */
export function setPasscode(passcode: string | null): void {
  try {
    if (passcode) browser.sessionStore()?.setItem(PASSCODE_KEY, passcode);
    else browser.sessionStore()?.removeItem(PASSCODE_KEY);
  } catch {
    // ignore
  }
  notify();
}

/* ------------------------------------------------------------------------------------------------
 * Referrer forms library (Revision 2)
 * ----------------------------------------------------------------------------------------------*/

/** localStorage key holding every FormDefinition (JSON array) – browser mode. */
export const FORMS_KEY = browser.FORMS_KEY;
/** localStorage key: {sampleId: updatedAt} of the sample form maps already seeded into this browser. */
export const FORMS_SEEDED_KEY = browser.FORMS_SEEDED_KEY;
/** IndexedDB database and object store for the referrers' original files – browser mode. */
export const FORMS_DB_NAME = browser.FORMS_DB_NAME;
export const FORMS_FILE_STORE = browser.FORMS_FILE_STORE;

/** Every valid form map, most recently updated first. */
export function listForms(): FormDefinition[] {
  return server() ? srv().listForms() : browser.listForms();
}

export function getForm(id: string): FormDefinition | null {
  return server() ? srv().getForm(id) : browser.getForm(id);
}

/** Insert or replace by ID. Browser: false if storage is unavailable or full. Server: queued, true. Callers set updatedAt. */
export function saveForm(form: FormDefinition): boolean {
  if (server()) return srv().saveForm(form);
  return demoRecord(form) && browser.saveForm(form);
}

/** Delete a form map, and its file when no other form map uses the same file. */
export function deleteForm(id: string): void {
  if (server()) srv().deleteForm(id);
  else browser.deleteForm(id);
}

/**
 * Store a referrer's original file (keyed by its SHA-256). Browser: true when saved to IndexedDB, false when
 * kept in memory for this tab only. Server: true once the clinic's storage holds it (chunked upload).
 */
export function saveFormFile(file: StoredFormFile): Promise<boolean> {
  return server() ? srv().saveFile(file) : browser.saveFormFile(file);
}

/** A stored file by SHA-256 (memory first, then IndexedDB / the clinic's storage), or null. */
export function getFormFile(sha256: string): Promise<StoredFormFile | null> {
  return server() ? srv().getFile(sha256) : browser.getFormFile(sha256);
}

export async function deleteFormFile(sha256: string): Promise<void> {
  if (server()) {
    // The clinic's stored file goes with its last form map (DELETE /store/forms/{id}); drop this tab's copy.
    srv().dropFile(sha256);
    notify();
    return;
  }
  await browser.deleteFormFile(sha256);
}

/** Remove every form file held by this tab (browser: also IndexedDB). */
export async function clearFormFiles(): Promise<void> {
  if (server()) {
    srv().clearFiles();
    return;
  }
  await browser.clearFormFiles();
}

/**
 * The original file of a form map: from here, or – for a bundled sample – downloaded from
 * GET /forms/samples/{sampleId}/file, checked against form.file.sha256 and stored. Null if unavailable.
 */
export async function loadFormFile(form: FormDefinition, init?: { signal?: AbortSignal }): Promise<StoredFormFile | null> {
  const stored = server() ? await srv().getFile(form.file.sha256, init?.signal) : await browser.getFormFile(form.file.sha256);
  if (stored) return stored;
  if (!form.sampleId) return null;
  try {
    const res = await fetch(reportApiPaths.formSampleFile(form.sampleId), { cache: "no-store", signal: init?.signal });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if ((await sha256HexBytes(bytes)) !== form.file.sha256) return null;
    const file: StoredFormFile = { sha256: form.file.sha256, fileName: form.file.fileName, mimeType: form.file.mimeType, bytes };
    await saveFormFile(file);
    return file;
  } catch {
    return null;
  }
}

/** GET /forms/samples, once per page load ([] when unreachable; retried on the next call). */
export function fetchSampleForms(): Promise<FormSample[]> {
  return fetchSamples();
}

/**
 * Browser: seed the bundled sample form maps into this browser's library (lazy, once per page load). A sample
 * deleted by the user is not re-added (until resetDemo); a sample map re-recorded on the server replaces the
 * seeded copy only if the user has not changed it. Server: loads the clinic's library (no fictional samples are
 * added to a clinic). Resolves to listForms().
 */
export function ensureSampleForms(): Promise<FormDefinition[]> {
  if (server()) return srv().hydrate().then(() => srv().listForms());
  return browser.ensureSampleForms();
}

/* ------------------------------------------------------------------------------------------------
 * Referrer → form links (server mode; the browser keeps them in ui/components/new/referrer-match.ts)
 * ----------------------------------------------------------------------------------------------*/

/** The clinic's remembered referrer → form links in server mode; null in browser mode. */
export function getStoredReferrerLinks(): Readonly<ReferrerLinks> | null {
  return server() ? srv().getReferrerLinks() : null;
}

/** Replace the clinic's referrer → form links (server mode; queued). False in browser mode. */
export function saveReferrerLinks(links: ReferrerLinks): boolean {
  if (!server()) return false;
  srv().setReferrerLinks(links);
  return true;
}

/* ------------------------------------------------------------------------------------------------
 * Durable saves and sync status (wave 2)
 * ----------------------------------------------------------------------------------------------*/

/**
 * Wait until every queued change has reached the server (true) or could not (false). `keepalive` (page hide)
 * sends what is waiting at once with fetch keepalive. Browser mode: true at once (writes are synchronous).
 */
export function flushStore(opts: { keepalive?: boolean } = {}): Promise<boolean> {
  return server() ? srv().flush(opts) : Promise.resolve(true);
}

/** saveReport, then wait until this report is stored on the server. Browser mode: saveReport's result. */
export function saveReportDurable(report: Report): Promise<boolean> {
  if (!server()) return Promise.resolve(saveReport(report));
  if (!srv().saveReport(report)) return Promise.resolve(false);
  return srv().reportSettled(report.id);
}

/** saveForm, then wait until this form map is stored on the server. Browser mode: saveForm's result. */
export function saveFormDurable(form: FormDefinition): Promise<boolean> {
  if (!server()) return Promise.resolve(saveForm(form));
  if (!srv().saveForm(form)) return Promise.resolve(false);
  return srv().formSettled(form.id);
}

const IDLE: StoreSyncState = { pending: 0, failed: false };

/** The save status now (non-hook; e.g. a beforeunload guard). Browser mode: always idle. */
export function getStoreSyncState(): StoreSyncState {
  return server() ? srv().syncState() : IDLE;
}

/** Try the changes that could not be saved again (a "Retry" button; also automatic on focus and when back online). */
export function retryStoreSync(): void {
  if (server()) srv().retryFailed();
}

/** {pending, failed, error} of the server store, kept current. Browser mode: {pending: 0, failed: false}. */
export function useStoreSync(): StoreSyncState {
  const [state, setState] = useState<StoreSyncState>(IDLE);
  useEffect(() => {
    if (!server()) return;
    const store = srv();
    const update = () =>
      setState((prev) => {
        const next = store.syncState();
        return prev.pending === next.pending && prev.failed === next.failed && prev.error === next.error ? prev : next;
      });
    update();
    return store.subscribe(update);
  }, []);
  return state;
}

/* ------------------------------------------------------------------------------------------------
 * React hooks
 * ----------------------------------------------------------------------------------------------*/

function useStoreSubscription(load: () => void): void {
  useEffect(() => {
    load();
    const onStorage = (e: StorageEvent) => {
      // Other tabs of the demo; a clinic's Studio syncs through BroadcastChannel and focus (server-store.ts).
      if (server()) return;
      if (e.key === null || e.key.startsWith(STORAGE_PREFIX)) load();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(STORE_EVENT, load);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(STORE_EVENT, load);
    };
  }, [load]);
}

/**
 * Browser mode: true from the first render (unchanged behaviour). Server mode: false until `task` (loading from
 * the clinic's storage) has settled – the hooks report `ready` only after hydration.
 */
function useServerLoad(task: () => Promise<unknown>, key: string): boolean {
  const [done, setDone] = useState<string | null>(() => (server() ? null : key));
  useEffect(() => {
    if (!server()) {
      setDone(key);
      return;
    }
    let live = true;
    void task()
      .catch(() => undefined)
      .then(() => {
        if (live) setDone(key);
      });
    return () => {
      live = false;
    };
    // `task` is derived from `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return done === key;
}

/** All reports, kept in sync. `ready` is false during SSR, the first client render and (server) loading. */
export function useReports(): { reports: Report[]; ready: boolean } {
  const loaded = useServerLoad(() => srv().loadAllReports(), "all");
  const [state, setState] = useState<{ reports: Report[]; ready: boolean }>({ reports: [], ready: false });
  const load = useCallback(() => {
    if (loaded) setState({ reports: listReports(), ready: true });
  }, [loaded]);
  useStoreSubscription(load);
  return state;
}

/** One report (null when not here), kept in sync. */
export function useReport(id: string): { report: Report | null; ready: boolean } {
  const loaded = useServerLoad(() => srv().ensureReport(id), id);
  const [state, setState] = useState<{ report: Report | null; ready: boolean }>({ report: null, ready: false });
  const load = useCallback(() => {
    if (loaded) setState({ report: getReport(id), ready: true });
  }, [id, loaded]);
  useStoreSubscription(load);
  return state;
}

/**
 * The forms library, kept in sync. Browser: seeds the bundled sample forms on first use. Server: the clinic's
 * library. `ready` is false during SSR and until the first load.
 */
export function useForms(): { forms: FormDefinition[]; ready: boolean } {
  const loaded = useServerLoad(() => srv().hydrate(), "forms");
  const [state, setState] = useState<{ forms: FormDefinition[]; ready: boolean }>({ forms: [], ready: false });
  const load = useCallback(() => {
    if (loaded) setState({ forms: listForms(), ready: true });
  }, [loaded]);
  useStoreSubscription(load);
  useEffect(() => {
    let live = true;
    void ensureSampleForms().then((forms) => {
      if (live) setState({ forms, ready: true });
    });
    return () => {
      live = false;
    };
  }, []);
  return state;
}

/**
 * One form map (null when not here), kept in sync. Waits for the sample forms to be seeded (browser) or the
 * library to load (server) before reporting `ready`, so a sample's ID resolves on a direct visit.
 */
export function useForm(id: string): { form: FormDefinition | null; ready: boolean } {
  const [state, setState] = useState<{ form: FormDefinition | null; ready: boolean }>({ form: null, ready: false });
  const [seeded, setSeeded] = useState(false);
  const load = useCallback(() => {
    if (seeded) setState({ form: getForm(id), ready: true });
  }, [id, seeded]);
  useStoreSubscription(load);
  useEffect(() => {
    let live = true;
    void ensureSampleForms().then(() => {
      if (live) setSeeded(true);
    });
    return () => {
      live = false;
    };
  }, []);
  return state;
}
