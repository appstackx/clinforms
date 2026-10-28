/**
 * Attachments to a patient's record (pure rules): which files are accepted, how large, and what their contents
 * really are. The file's type is taken from its first bytes, never from its name or the browser's word for it.
 *
 * Stored encrypted in the database (pms_attachment_chunks, see src/server/repos/pms/records/attachments.ts).
 * Removing an attachment withdraws it (hidden, kept): attachments are part of the clinical record.
 */

/** Largest file accepted: 4 MB (an upload must fit the hosting platform's request limit of 4.5 MB). */
export const MAX_ATTACHMENT_BYTES = 4_000_000;
/** Attachments per patient (withdrawn ones included). */
export const MAX_ATTACHMENTS_PER_PATIENT = 100;
export const MAX_DESCRIPTION_CHARS = 200;

export const ATTACHMENT_TYPES = {
  pdf: { mime: "application/pdf", extension: "pdf", label: "PDF document" },
  jpeg: { mime: "image/jpeg", extension: "jpg", label: "JPEG image" },
  png: { mime: "image/png", extension: "png", label: "PNG image" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extension: "docx", label: "Word document" },
} as const;
export type AttachmentType = keyof typeof ATTACHMENT_TYPES;

export const ACCEPT_ATTRIBUTE = ".pdf,.jpg,.jpeg,.png,.docx,application/pdf,image/jpeg,image/png,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((b, i) => bytes[offset + i] === b);
}

function asciiIncludes(bytes: Uint8Array, text: string, limit: number): boolean {
  const n = Math.min(bytes.length, limit);
  let s = "";
  for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[i]);
  return s.includes(text);
}

/** The type of a file from its contents, or null when it is not one we accept. */
export function sniffAttachmentType(bytes: Uint8Array): AttachmentType | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"; // %PDF-
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  // A Word document is a ZIP whose first entries include "[Content_Types].xml" and "word/".
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) && asciiIncludes(bytes, "[Content_Types].xml", 4096) && asciiIncludes(bytes, "word/", 65_536)) return "docx";
  return null;
}

export type AttachmentCheck = { ok: true; type: AttachmentType } | { ok: false; error: string };

export function checkAttachment(bytes: Uint8Array): AttachmentCheck {
  if (bytes.length === 0) return { ok: false, error: "The file is empty." };
  if (bytes.length > MAX_ATTACHMENT_BYTES) return { ok: false, error: `The file is larger than ${formatBytes(MAX_ATTACHMENT_BYTES)}.` };
  const type = sniffAttachmentType(bytes);
  if (!type) return { ok: false, error: "Only PDF, JPEG, PNG and Word (.docx) files can be attached." };
  return { ok: true, type };
}

/**
 * A safe file name for storage and download: no folders, no control or reserved characters, at most 120
 * characters, with the extension of the type the contents really are.
 */
export function safeFileName(name: string | null | undefined, type: AttachmentType): string {
  const ext = ATTACHMENT_TYPES[type].extension;
  const base = String(name ?? "")
    .split(/[\\/]/)
    .pop()!
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f<>:"|?*]+/g, "")
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 110);
  return `${base || "attachment"}.${ext}`;
}

/** An ASCII-only version for the Content-Disposition fallback. */
export function asciiFileName(name: string): string {
  const ascii = name
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/["\\;]/g, "")
    .trim();
  return ascii || "attachment";
}

/** 1 KB = 1000 bytes (as people read file sizes). */
export function formatBytes(n: number): string {
  if (n < 1000) return `${n} bytes`;
  if (n < 1_000_000) return `${Math.round(n / 100) / 10} KB`.replace(".0 ", " ");
  return `${Math.round(n / 100_000) / 10} MB`.replace(".0 ", " ");
}
