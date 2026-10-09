/**
 * The "browser" store backend – the public demo's storage, moved here unchanged from ui/store.ts (wave 2):
 * reports live in this browser's localStorage only, one key per report ("medreport.report.<id>"); form maps
 * (FormDefinition[]) under "medreport.forms"; the referrers' original files in IndexedDB ("medreport-forms",
 * keyed by SHA-256) with an in-memory fallback for this tab when IndexedDB is unavailable. Bundled sample forms
 * are seeded lazily from GET /forms/samples (ensureSampleForms). Every storage access is wrapped in try/catch
 * (private windows, blocked storage, SSR).
 *
 * ui/store.ts calls these functions while the store mode is "browser" (ui/store/mode.ts).
 */
import { STORAGE_PREFIX } from "../../config.public";
import { hasAttestedConfirmation } from "../../core/forms";
import { FormDefinitionSchema, FormMimeTypeSchema, ReportSchema } from "../../core/schemas";
import type { FormDefinition, Report } from "../../core/types";
import { notify } from "./events";
import { fetchSampleForms, resetSampleCache } from "./samples";
import type { StoredFormFile } from "./types";

export const REPORT_KEY_PREFIX = `${STORAGE_PREFIX}report.`;
/** localStorage key holding every FormDefinition (JSON array). */
export const FORMS_KEY = `${STORAGE_PREFIX}forms`;
/** localStorage key: {sampleId: updatedAt} of the sample form maps already seeded into this browser. */
export const FORMS_SEEDED_KEY = `${STORAGE_PREFIX}forms.seeded`;
/** IndexedDB database and object store for the referrers' original files. */
export const FORMS_DB_NAME = "medreport-forms";
export const FORMS_FILE_STORE = "files";

export function localStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function sessionStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readJson(storage: Storage | null, key: string): unknown {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function storageKeys(storage: Storage | null): string[] {
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

export function listReports(): Report[] {
  const storage = localStore();
  const reports: Report[] = [];
  for (const key of storageKeys(storage)) {
    if (!key.startsWith(REPORT_KEY_PREFIX)) continue;
    const parsed = ReportSchema.safeParse(readJson(storage, key));
    if (parsed.success) reports.push(parsed.data);
  }
  return reports.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

export function getReport(id: string): Report | null {
  const parsed = ReportSchema.safeParse(readJson(localStore(), REPORT_KEY_PREFIX + id));
  return parsed.success ? parsed.data : null;
}

export function saveReport(report: Report): boolean {
  const storage = localStore();
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
    localStore()?.removeItem(REPORT_KEY_PREFIX + id);
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
  for (const storage of [localStore(), sessionStore()]) {
    for (const key of storageKeys(storage)) {
      if (!key.startsWith(STORAGE_PREFIX)) continue;
      try {
        storage?.removeItem(key);
      } catch {
        // ignore
      }
    }
  }
  resetSampleCache();
  seedPromise = null;
  void clearFormFiles();
  notify();
}

/* ------------------------------------------------------------------------------------------------
 * Form maps
 * ----------------------------------------------------------------------------------------------*/

function sortForms(forms: FormDefinition[]): FormDefinition[] {
  return forms.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

function readForms(): FormDefinition[] {
  const raw = readJson(localStore(), FORMS_KEY);
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
  const storage = localStore();
  if (!storage) return false;
  try {
    storage.setItem(FORMS_KEY, JSON.stringify(forms));
    notify();
    return true;
  } catch {
    return false;
  }
}

export function listForms(): FormDefinition[] {
  return sortForms(readForms());
}

export function getForm(id: string): FormDefinition | null {
  return readForms().find((f) => f.id === id) ?? null;
}

export function saveForm(form: FormDefinition): boolean {
  const forms = readForms().filter((f) => f.id !== form.id);
  forms.push(form);
  return writeForms(forms);
}

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

export async function saveFormFile(file: StoredFormFile): Promise<boolean> {
  const bytes = new Uint8Array(file.bytes.byteLength);
  bytes.set(file.bytes);
  memoryFiles.set(file.sha256, { ...file, bytes });
  const record: FileRecord = { sha256: file.sha256, fileName: file.fileName, mimeType: file.mimeType, bytes: bytes.buffer };
  const saved = await idb("readwrite", (store) => store.put(record));
  notify();
  return saved !== null;
}

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

export async function clearFormFiles(): Promise<void> {
  memoryFiles.clear();
  await idb("readwrite", (store) => store.clear());
}

/* Sample forms ----------------------------------------------------------------------------------- */

let seedPromise: Promise<FormDefinition[]> | null = null;

/**
 * Seed the bundled sample form maps into this browser's library (lazy, once per page load).
 * A sample deleted by the user is not re-added (until resetDemo); a sample map re-recorded on the
 * server replaces the seeded copy only if the user has not changed it. Resolves to listForms().
 */
export function ensureSampleForms(): Promise<FormDefinition[]> {
  if (!seedPromise) {
    seedPromise = (async () => {
      const samples = await fetchSampleForms();
      const seededRaw = readJson(localStore(), FORMS_SEEDED_KEY);
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
          localStore()?.setItem(FORMS_SEEDED_KEY, JSON.stringify(seeded));
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
