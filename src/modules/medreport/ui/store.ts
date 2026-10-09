/**
 * Browser report store (demo-grade): reports live in this browser's localStorage only, one key per
 * report ("medreport.report.<id>"). The session token and live passcode live in sessionStorage.
 * Every storage access is wrapped in try/catch (private windows, blocked storage, SSR).
 *
 * Referrer forms library (Revision 2): form maps (FormDefinition[]) in localStorage under
 * "medreport.forms"; the referrers' original files in IndexedDB ("medreport-forms", keyed by SHA-256),
 * with an in-memory fallback for this tab when IndexedDB is unavailable. Bundled sample forms are
 * seeded lazily from GET /forms/samples (ensureSampleForms).
 *
 * Same-tab changes dispatch STORE_EVENT on window; other tabs sync via the 'storage' event.
 *
 * Shared contract (orchestrator-owned).
 */
import { useCallback, useEffect, useState } from "react";
import { FormSamplesResponseSchema, reportApiPaths, type FormSample } from "../api/contract";
import { PRODUCT, STORAGE_PREFIX } from "../config.public";
import { sha256HexBytes } from "../core/fingerprint";
import { hasAttestedConfirmation } from "../core/forms";
import {
  CASE_EXPORT_FORMAT,
  CaseExportSchema,
  FormDefinitionSchema,
  FormMimeTypeSchema,
  ReportSchema,
  SessionTokenSchema,
} from "../core/schemas";
import type { FormDefinition, FormMimeType, Report, SessionToken } from "../core/types";
import { CASE_EXPORT_FORMAT_VERSION, decodeCaseReport, encodeCaseReport, type CaseExport } from "../core/case-export";

export const REPORT_KEY_PREFIX = `${STORAGE_PREFIX}report.`;
export const SESSION_KEY = `${STORAGE_PREFIX}session`;
export const PASSCODE_KEY = `${STORAGE_PREFIX}passcode`;
/** Window event fired after any write by this module in the current tab. */
export const STORE_EVENT = "medreport:store";

function local(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function session(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function notify(): void {
  try {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(STORE_EVENT));
  } catch {
    // ignore
  }
}

function readJson(storage: Storage | null, key: string): unknown {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function storageKeys(storage: Storage | null): string[] {
  if (!storage) return [];
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key !== null) keys.push(key);
    }
    return keys;
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------------------------------------
 * Reports
 * ----------------------------------------------------------------------------------------------*/

/** All valid reports in this browser, most recently updated first. Invalid/old entries are skipped. */
export function listReports(): Report[] {
  const storage = local();
  const reports: Report[] = [];
  for (const key of storageKeys(storage)) {
    if (!key.startsWith(REPORT_KEY_PREFIX)) continue;
    const parsed = ReportSchema.safeParse(readJson(storage, key));
    if (parsed.success) reports.push(parsed.data);
  }
  return reports.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

/** A report by ID, or null if it is not in this browser ("This report is stored in another browser"). */
export function getReport(id: string): Report | null {
  const parsed = ReportSchema.safeParse(readJson(local(), REPORT_KEY_PREFIX + id));
  return parsed.success ? parsed.data : null;
}

/** Save (insert or replace). Returns false if storage is unavailable or full. Callers set updatedAt. */
export function saveReport(report: Report): boolean {
  const storage = local();
  if (!storage) return false;
  try {
    storage.setItem(REPORT_KEY_PREFIX + report.id, JSON.stringify(report));
    notify();
    return true;
  } catch {
    return false;
  }
}

export function deleteReport(id: string): void {
  try {
    local()?.removeItem(REPORT_KEY_PREFIX + id);
  } catch {
    // ignore
  }
  notify();
}

/**
 * Remove every "medreport.*" key from localStorage and sessionStorage, and the stored form files
 * (IndexedDB "medreport-forms" and the in-memory fallback). Sample forms are re-seeded on next use.
 */
export function resetDemo(): void {
  for (const storage of [local(), session()]) {
    for (const key of storageKeys(storage)) {
      if (!key.startsWith(STORAGE_PREFIX)) continue;
      try {
        storage?.removeItem(key);
      } catch {
        // ignore
      }
    }
  }
  samplesPromise = null;
  seedPromise = null;
  void clearFormFiles();
  notify();
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

/** JSON blob of one report for download, or null if the report is not in this browser. */
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
 * Session token and live passcode (sessionStorage)
 * ----------------------------------------------------------------------------------------------*/

/** The current session token, or null if missing or expired. */
export function getSession(now: Date = new Date()): SessionToken | null {
  const parsed = SessionTokenSchema.safeParse(readJson(session(), SESSION_KEY));
  if (!parsed.success) return null;
  return parsed.data.claims.exp * 1000 > now.getTime() ? parsed.data : null;
}

export function setSession(token: SessionToken): void {
  try {
    session()?.setItem(SESSION_KEY, JSON.stringify(token));
  } catch {
    // ignore
  }
  notify();
}

export function clearSession(): void {
  try {
    session()?.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
  notify();
}

export function getPasscode(): string | null {
  try {
    return session()?.getItem(PASSCODE_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Store (or clear with null/"") the live drafting passcode for this tab session. */
export function setPasscode(passcode: string | null): void {
  try {
    if (passcode) session()?.setItem(PASSCODE_KEY, passcode);
    else session()?.removeItem(PASSCODE_KEY);
  } catch {
    // ignore
  }
  notify();
}

/* ------------------------------------------------------------------------------------------------
 * Referrer forms library (Revision 2)
 * ----------------------------------------------------------------------------------------------*/

/** localStorage key holding every FormDefinition (JSON array). */
export const FORMS_KEY = `${STORAGE_PREFIX}forms`;
/** localStorage key: {sampleId: updatedAt} of the sample form maps already seeded into this browser. */
export const FORMS_SEEDED_KEY = `${STORAGE_PREFIX}forms.seeded`;
/** IndexedDB database and object store for the referrers' original files. */
export const FORMS_DB_NAME = "medreport-forms";
export const FORMS_FILE_STORE = "files";

/** A referrer's original file as stored in this browser. */
export interface StoredFormFile {
  sha256: string;
  fileName: string;
  mimeType: FormMimeType;
  bytes: Uint8Array;
}

function sortForms(forms: FormDefinition[]): FormDefinition[] {
  return forms.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

function readForms(): FormDefinition[] {
  const raw = readJson(local(), FORMS_KEY);
  if (!Array.isArray(raw)) return [];
  const forms: FormDefinition[] = [];
  for (const item of raw) {
    const parsed = FormDefinitionSchema.safeParse(item);
    if (!parsed.success) continue;
    const form = parsed.data;
    // A confirmation without the server's attestation (saved before confirmations were attested) is
    // not accepted by the server: show the map as needing confirmation again.
    if (form.status === "confirmed" && !hasAttestedConfirmation(form)) {
      const next: FormDefinition = { ...form, status: "proposed" };
      delete next.confirmed;
      forms.push(next);
      continue;
    }
    forms.push(form);
  }
  return forms;
}

function writeForms(forms: FormDefinition[]): boolean {
  const storage = local();
  if (!storage) return false;
  try {
    storage.setItem(FORMS_KEY, JSON.stringify(forms));
    notify();
    return true;
  } catch {
    return false;
  }
}

/** Every valid form map in this browser, most recently updated first. */
export function listForms(): FormDefinition[] {
  return sortForms(readForms());
}

export function getForm(id: string): FormDefinition | null {
  return readForms().find((f) => f.id === id) ?? null;
}

/** Insert or replace by ID. Returns false if storage is unavailable or full. Callers set updatedAt. */
export function saveForm(form: FormDefinition): boolean {
  const forms = readForms().filter((f) => f.id !== form.id);
  forms.push(form);
  return writeForms(forms);
}

/** Delete a form map, and its file when no other form map uses the same file. */
export function deleteForm(id: string): void {
  const forms = readForms();
  const target = forms.find((f) => f.id === id);
  const rest = forms.filter((f) => f.id !== id);
  writeForms(rest);
  if (target && !rest.some((f) => f.file.sha256 === target.file.sha256)) void deleteFormFile(target.file.sha256);
}

/* Files: IndexedDB with an in-memory fallback ------------------------------------------------- */

const memoryFiles = new Map<string, StoredFormFile>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openFormsDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(FORMS_DB_NAME, 1);
      req.onupgradeneeded = () => {
        try {
          if (!req.result.objectStoreNames.contains(FORMS_FILE_STORE)) {
            req.result.createObjectStore(FORMS_FILE_STORE, { keyPath: "sha256" });
          }
        } catch {
          // ignore: onerror/onsuccess resolves
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function idb<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openFormsDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const req = run(db.transaction(FORMS_FILE_STORE, mode).objectStore(FORMS_FILE_STORE));
          req.onsuccess = () => resolve(req.result ?? null);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

type FileRecord = { sha256: string; fileName: string; mimeType: string; bytes: ArrayBuffer };

/**
 * Store a referrer's original file (keyed by its SHA-256). Resolves true when it was saved to
 * IndexedDB, false when it is kept in memory for this tab only (storage unavailable or full).
 */
export async function saveFormFile(file: StoredFormFile): Promise<boolean> {
  const bytes = new Uint8Array(file.bytes.byteLength);
  bytes.set(file.bytes);
  memoryFiles.set(file.sha256, { ...file, bytes });
  const record: FileRecord = { sha256: file.sha256, fileName: file.fileName, mimeType: file.mimeType, bytes: bytes.buffer };
  const saved = await idb("readwrite", (store) => store.put(record));
  notify();
  return saved !== null;
}

/** A stored file by SHA-256 (memory first, then IndexedDB), or null. */
export async function getFormFile(sha256: string): Promise<StoredFormFile | null> {
  const cached = memoryFiles.get(sha256);
  if (cached) return cached;
  const record = await idb<FileRecord>("readonly", (store) => store.get(sha256) as IDBRequest<FileRecord>);
  if (!record || !(record.bytes instanceof ArrayBuffer)) return null;
  const mime = FormMimeTypeSchema.safeParse(record.mimeType);
  if (!mime.success) return null;
  const file: StoredFormFile = { sha256: record.sha256, fileName: record.fileName, mimeType: mime.data, bytes: new Uint8Array(record.bytes) };
  memoryFiles.set(sha256, file);
  return file;
}

export async function deleteFormFile(sha256: string): Promise<void> {
  memoryFiles.delete(sha256);
  await idb("readwrite", (store) => store.delete(sha256));
  notify();
}

/** Remove every stored form file (used by resetDemo). */
export async function clearFormFiles(): Promise<void> {
  memoryFiles.clear();
  await idb("readwrite", (store) => store.clear());
}

/**
 * The original file of a form map: from this browser, or – for a bundled sample – downloaded from
 * GET /forms/samples/{sampleId}/file, checked against form.file.sha256 and stored. Null if unavailable.
 */
export async function loadFormFile(form: FormDefinition, init?: { signal?: AbortSignal }): Promise<StoredFormFile | null> {
  const stored = await getFormFile(form.file.sha256);
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

/* Sample forms ----------------------------------------------------------------------------------- */

let samplesPromise: Promise<FormSample[]> | null = null;
let seedPromise: Promise<FormDefinition[]> | null = null;

/** GET /forms/samples, once per page load ([] when unreachable; retried on the next call). */
export function fetchSampleForms(): Promise<FormSample[]> {
  if (!samplesPromise) {
    samplesPromise = (async () => {
      const res = await fetch(reportApiPaths.formSamples(), { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = FormSamplesResponseSchema.safeParse(await res.json());
      if (!parsed.success) throw new Error("Unexpected /forms/samples response");
      return parsed.data.samples;
    })();
    samplesPromise.catch(() => {
      samplesPromise = null;
    });
  }
  return samplesPromise.catch(() => [] as FormSample[]);
}

/**
 * Seed the bundled sample form maps into this browser's library (lazy, once per page load).
 * A sample deleted by the user is not re-added (until resetDemo); a sample map re-recorded on the
 * server replaces the seeded copy only if the user has not changed it. Resolves to listForms().
 */
export function ensureSampleForms(): Promise<FormDefinition[]> {
  if (!seedPromise) {
    seedPromise = (async () => {
      const samples = await fetchSampleForms();
      const seededRaw = readJson(local(), FORMS_SEEDED_KEY);
      const seeded: Record<string, string> =
        seededRaw && typeof seededRaw === "object" && !Array.isArray(seededRaw) ? { ...(seededRaw as Record<string, string>) } : {};
      const forms = readForms();
      let changed = false;
      for (const sample of samples) {
        const form = sample.form;
        if (!form) continue;
        const existing = forms.find((f) => f.id === form.id);
        const seededAt = seeded[sample.id];
        const add = !existing && seededAt === undefined;
        const untouched = existing !== undefined && seededAt !== undefined && existing.updatedAt === seededAt;
        // Re-seed an untouched copy when the server's map is newer, or now carries the server's
        // attestation that the stored copy lacks.
        const refresh = untouched && (form.updatedAt > seededAt || (!hasAttestedConfirmation(existing) && hasAttestedConfirmation(form)));
        if (!add && !refresh) continue;
        const next = forms.filter((f) => f.id !== form.id);
        next.push({ ...form, builtIn: true, sampleId: sample.id });
        forms.splice(0, forms.length, ...next);
        seeded[sample.id] = form.updatedAt;
        changed = true;
      }
      if (changed) {
        writeForms(forms);
        try {
          local()?.setItem(FORMS_SEEDED_KEY, JSON.stringify(seeded));
        } catch {
          // ignore
        }
      }
      return listForms();
    })();
    seedPromise.catch(() => {
      seedPromise = null;
    });
  }
  return seedPromise.catch(() => listForms());
}

/* ------------------------------------------------------------------------------------------------
 * React hooks
 * ----------------------------------------------------------------------------------------------*/

function useStoreSubscription(load: () => void): void {
  useEffect(() => {
    load();
    const onStorage = (e: StorageEvent) => {
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

/** All reports, kept in sync across tabs. `ready` is false during SSR and the first client render. */
export function useReports(): { reports: Report[]; ready: boolean } {
  const [state, setState] = useState<{ reports: Report[]; ready: boolean }>({ reports: [], ready: false });
  const load = useCallback(() => setState({ reports: listReports(), ready: true }), []);
  useStoreSubscription(load);
  return state;
}

/** One report (null when not in this browser), kept in sync across tabs. */
export function useReport(id: string): { report: Report | null; ready: boolean } {
  const [state, setState] = useState<{ report: Report | null; ready: boolean }>({ report: null, ready: false });
  const load = useCallback(() => setState({ report: getReport(id), ready: true }), [id]);
  useStoreSubscription(load);
  return state;
}

/**
 * The forms library, kept in sync across tabs. Seeds the bundled sample forms on first use.
 * `ready` is false during SSR and until the first load.
 */
export function useForms(): { forms: FormDefinition[]; ready: boolean } {
  const [state, setState] = useState<{ forms: FormDefinition[]; ready: boolean }>({ forms: [], ready: false });
  const load = useCallback(() => setState({ forms: listForms(), ready: true }), []);
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
 * One form map (null when not in this browser), kept in sync across tabs. Waits for the sample forms
 * to be seeded before reporting `ready`, so a sample's ID resolves on a direct visit.
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
