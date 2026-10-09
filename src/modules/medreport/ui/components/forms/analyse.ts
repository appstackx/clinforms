/**
 * Upload → analyse → store a referrer's form (browser side of POST /forms/analyse).
 *
 * 1. Check the file locally (type from the bytes, size ≤ MAX_FORM_FILE_BYTES, old .doc rejected) and
 *    fingerprint it (SHA-256), so a form already in the library is offered instead of re-analysed.
 * 2. POST /forms/analyse (live Claude with the passcode; otherwise a recorded analysis of the same file
 *    or rules only – the server decides and says which in `form.analysis.mode`).
 * 3. Save the original file (IndexedDB, keyed by SHA-256) and the proposed form map (localStorage).
 *
 * Owner: studio-a agent.
 */
import type { FormsAnalyseResponse } from "../../../api/contract";
import { MAX_FORM_FILE_BYTES } from "../../../config.public";
import { sha256HexBytes } from "../../../core/fingerprint";
import { nowIso } from "../../../core/dates";
import type { FormDefinition, FormMimeType, ReferrerInfo } from "../../../core/types";
import { api, toBase64, type ApiClient } from "../../api-client";
import { listForms, saveForm, saveFormFile } from "../../store";
import { formatBytes } from "../shared/format";

export const DOCX_MIME: FormMimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const PDF_MIME: FormMimeType = "application/pdf";
export const FORM_ACCEPT = ".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export interface LocalFormFile {
  fileName: string;
  mimeType: FormMimeType;
  bytes: Uint8Array;
  sha256: string;
}

export class FormFileError extends Error {}

/** Detect the form type from the bytes (not the extension). */
export function sniffFormType(bytes: Uint8Array, fileName: string): FormMimeType {
  const b = bytes;
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return PDF_MIME; // %PDF
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return DOCX_MIME; // PK zip
  if (b.length >= 4 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) {
    throw new FormFileError(
      `“${fileName}” is an older Word .doc file. Open it in Word and use File → Save As → Word Document (.docx), then upload the .docx.`,
    );
  }
  throw new FormFileError(`“${fileName}” is not a Word (.docx) or PDF file.`);
}

/** Read and check a picked file. */
export async function readFormFile(file: File | { name: string; bytes: Uint8Array }): Promise<LocalFormFile> {
  const bytes = file instanceof Blob ? new Uint8Array(await file.arrayBuffer()) : file.bytes;
  if (bytes.byteLength === 0) throw new FormFileError(`“${file.name}” is empty.`);
  if (bytes.byteLength > MAX_FORM_FILE_BYTES) {
    throw new FormFileError(
      `“${file.name}” is ${formatBytes(bytes.byteLength)}; the limit is ${formatBytes(MAX_FORM_FILE_BYTES)}. Remove large images or logos and try again.`,
    );
  }
  const mimeType = sniffFormType(bytes, file.name);
  return { fileName: file.name, mimeType, bytes, sha256: await sha256HexBytes(bytes) };
}

/** A form map in this browser already bound to this exact file. */
export function findFormByFile(sha256: string): FormDefinition | null {
  return listForms().find((f) => f.file.sha256 === sha256) ?? null;
}

export interface AnalyseResult extends FormsAnalyseResponse {
  /** False when the original file could only be kept in memory for this tab. */
  fileStored: boolean;
}

export async function analyseAndStore(
  local: LocalFormFile,
  opts: { referrer?: ReferrerInfo; title?: string; signal?: AbortSignal; client?: Pick<ApiClient, "analyseForm"> } = {},
): Promise<AnalyseResult> {
  const client = opts.client ?? api;
  const res = await client.analyseForm(
    {
      fileBase64: await toBase64(local.bytes.slice().buffer),
      fileName: local.fileName.slice(0, 200),
      ...(opts.referrer?.name.trim() && { referrer: { ...opts.referrer, name: opts.referrer.name.trim() } }),
      ...(opts.title?.trim() && { title: opts.title.trim().slice(0, 200) }),
      prefer: "auto",
    },
    { signal: opts.signal },
  );
  if (res.form.file.sha256 !== local.sha256) {
    throw new FormFileError("The server analysed a different file from the one uploaded. Please try again.");
  }
  const fileStored = await saveFormFile({
    sha256: local.sha256,
    fileName: local.fileName,
    mimeType: res.form.file.mimeType,
    bytes: local.bytes,
  });
  const form: FormDefinition = { ...res.form, status: "proposed", updatedAt: nowIso() };
  delete form.confirmed;
  if (!saveForm(form)) throw new FormFileError("The form map could not be saved in this browser (storage is full or blocked).");
  return { ...res, form, fileStored };
}
