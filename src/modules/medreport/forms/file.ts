import "server-only";

/**
 * Decoding and checking a referrer's form file sent as base64 (POST /forms/analyse, /forms/fill-preview,
 * /render). Detects the type from the bytes (never from the file name), enforces MAX_FORM_FILE_BYTES and
 * computes the SHA-256 that binds a FormDefinition to its file.
 *
 * RTF (10/2026): with `convertRtf: true` (forms-analyse, and the fill / render file in
 * handlers/store-form-file.ts), an RTF upload – which no Word or PDF check below would accept – is
 * converted to .docx here (core/rtf, the same converter as the Studio's upload dialog) and from then on
 * IS a Word form: bytes, type and SHA-256 are the converted file's (`convertedFrom` says what came in).
 * Without the option RTF is refused exactly as before (the clinic store keeps only Word and PDF files).
 *
 * Errors are thrown as HttpError (bindHandler turns them into problem+json):
 * 413 PAYLOAD_TOO_LARGE · 422 FORM_INVALID (not .docx / PDF / RTF, an old .doc, or an RTF file that
 * cannot be converted) · 409 FORM_MISMATCH.
 *
 * Owner: forms-engine agent (contract-stage implementation; signatures are final).
 */
import { createHash } from "node:crypto";
import { MAX_FORM_FILE_BYTES } from "../config.public";
import type { FormMimeType } from "../core/types";
import { HttpError } from "../api/http";
import { RtfConversionError, convertRtfToDocx, isRtfBytes } from "../core/rtf";
import { ZipLimitError, assertPdfWithinLimits, openZipSafely } from "./zip-guard";

export const DOCX_MIME: FormMimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const PDF_MIME: FormMimeType = "application/pdf";

export interface DecodedFormFile {
  bytes: Uint8Array;
  mimeType: FormMimeType;
  sha256: string;
  sizeBytes: number;
  /** Set when the upload was an RTF file converted to Word here (decodeFormFile `convertRtf`). */
  convertedFrom?: { format: "rtf"; sizeBytes: number; sha256: string; notes: string[]; ms: number };
}

/** SHA-256 of the bytes as 64 lower-case hex characters. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return magic.every((b, i) => bytes[i] === b);
}

function containsAscii(bytes: Uint8Array, needle: string): boolean {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).indexOf(needle, 0, "latin1") >= 0;
}

/** "docx" / "pdf" MIME type from the bytes, "doc" for a legacy binary Word file, or null. */
export function sniffFormFile(bytes: Uint8Array): FormMimeType | "doc" | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return PDF_MIME; // %PDF-
  // Some PDFs carry a few junk bytes before the header (allowed in the first 1 KB).
  if (containsAscii(bytes.subarray(0, 1024), "%PDF-")) return PDF_MIME;
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) && containsAscii(bytes, "word/document.xml")) return DOCX_MIME;
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "doc";
  return null;
}

/** RTF → Word at the boundary (see the file comment). Throws HttpError (413 / 422 FORM_INVALID). */
function decodeRtfFormFile(rtf: Uint8Array, maxBytes: number): DecodedFormFile {
  const started = Date.now();
  let converted: ReturnType<typeof convertRtfToDocx>;
  try {
    converted = convertRtfToDocx(rtf, { maxBytes });
  } catch (err) {
    if (err instanceof RtfConversionError) {
      if (err.code === "RTF_TOO_LARGE") throw new HttpError(413, "Form file too large", { code: "PAYLOAD_TOO_LARGE", detail: err.message });
      throw new HttpError(422, "This RTF file could not be converted", { code: "FORM_INVALID", detail: err.message });
    }
    throw new HttpError(422, "This RTF file could not be converted", {
      code: "FORM_INVALID",
      detail: "Open the template in Word, save it as a Word Document (.docx) and upload that file.",
    });
  }
  const bytes = converted.docx;
  try {
    openZipSafely(bytes);
  } catch {
    throw new HttpError(422, "This RTF file could not be converted", { code: "FORM_INVALID", detail: "Save the template as a Word Document (.docx) and upload that file." });
  }
  return {
    bytes,
    mimeType: DOCX_MIME,
    sha256: sha256Hex(bytes),
    sizeBytes: bytes.byteLength,
    convertedFrom: { format: "rtf", sizeBytes: rtf.byteLength, sha256: sha256Hex(rtf), notes: converted.notes, ms: Date.now() - started },
  };
}

/**
 * Decode, size-check and type-check a base64 form file. Throws HttpError (413 / 422 FORM_INVALID).
 * `convertRtf`: accept an RTF file and convert it to Word (see the file comment); otherwise RTF is refused.
 */
export function decodeFormFile(base64: string, opts: { maxBytes?: number; convertRtf?: boolean } = {}): DecodedFormFile {
  const maxBytes = opts.maxBytes ?? MAX_FORM_FILE_BYTES;
  // Rough pre-check before allocating: 4 base64 chars → 3 bytes.
  if (Math.floor((base64.length * 3) / 4) > maxBytes + 3) {
    throw new HttpError(413, "Form file too large", {
      code: "PAYLOAD_TOO_LARGE",
      detail: `Form files can be up to ${Math.round(maxBytes / (1024 * 1024))} MB.`,
    });
  }
  const bytes = new Uint8Array(Buffer.from(base64.replace(/^data:[^,]*,/, ""), "base64"));
  if (bytes.byteLength === 0) {
    throw new HttpError(422, "The form file is empty", { code: "FORM_INVALID", detail: "Choose the referrer's .docx or PDF form." });
  }
  if (bytes.byteLength > maxBytes) {
    throw new HttpError(413, "Form file too large", {
      code: "PAYLOAD_TOO_LARGE",
      detail: `Form files can be up to ${Math.round(maxBytes / (1024 * 1024))} MB.`,
    });
  }
  const sniffed = sniffFormFile(bytes);
  if (sniffed === "doc") {
    throw new HttpError(422, "Older Word format (.doc)", {
      code: "FORM_INVALID",
      detail: "This is an older Word .doc file. Open it in Word, choose File → Save As → Word Document (.docx) – or Rich Text Format (.rtf) – and upload that file.",
    });
  }
  if (!sniffed && opts.convertRtf && isRtfBytes(bytes)) return decodeRtfFormFile(bytes, maxBytes);
  if (!sniffed) {
    throw new HttpError(422, "Not a Word or PDF form", {
      code: "FORM_INVALID",
      detail: opts.convertRtf
        ? "Upload the referrer's form as a Word document (.docx), a PDF or an RTF file."
        : "Upload the referrer's form as a Word document (.docx) or a PDF.",
    });
  }
  // Decompression limits before any parser touches the file (zip bombs, oversized PDF streams).
  try {
    if (sniffed === PDF_MIME) assertPdfWithinLimits(bytes);
    else openZipSafely(bytes);
  } catch (err) {
    if (err instanceof ZipLimitError) {
      throw new HttpError(422, "This file cannot be used", {
        code: "FORM_INVALID",
        detail: `${err.message} Upload the referrer's form as an ordinary Word document (.docx) or PDF.`,
      });
    }
    // Not a readable ZIP: the Word parser reports it in its own words.
  }
  return { bytes, mimeType: sniffed, sha256: sha256Hex(bytes), sizeBytes: bytes.byteLength };
}

/** Throws 409 FORM_MISMATCH unless the file is the one the form map (or report) was built from. */
export function assertFormFileMatches(file: Pick<DecodedFormFile, "sha256">, expectedSha256: string): void {
  if (file.sha256 !== expectedSha256) {
    throw new HttpError(409, "This is not the form the mapping was made for", {
      code: "FORM_MISMATCH",
      detail: "The uploaded file differs from the referrer form this report completes. Use the original form file from the forms library.",
    });
  }
}
