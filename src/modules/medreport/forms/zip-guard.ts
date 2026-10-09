import "server-only";

/**
 * Zip-bomb guard for every .docx the server opens (referrer forms in forms/docx-dom.ts, the built-in
 * Word templates and uploaded tagged templates in docgen/docx.ts and docgen/docx-validate.ts).
 *
 * A .docx is a ZIP package. PizZip trusts the sizes in the ZIP headers and inflates a part fully before
 * it checks them, so a 300 KB upload can expand to hundreds of MB. Before any part is read:
 * 1. the package may hold at most ZIP_LIMITS.maxEntries entries;
 * 2. each entry's DECLARED uncompressed size must be at most ZIP_LIMITS.maxEntryBytes, and all of them
 *    together at most ZIP_LIMITS.maxTotalBytes;
 * 3. headers can lie, so every compressed entry is inflated once through Node's zlib with a hard
 *    output cap (maxOutputLength = its declared size) – an entry that inflates beyond what it declares
 *    is rejected before PizZip ever allocates it. Stored entries must be exactly their declared size.
 *
 * Throws ZipLimitError; callers turn it into their own 422 (FORM_INVALID / TEMPLATE_INVALID).
 *
 * Owner: forms-engine agent.
 */
import { constants as zlibConstants, inflateRawSync, inflateSync } from "node:zlib";
import PizZip from "pizzip";

export const ZIP_LIMITS = {
  maxEntries: 500,
  maxEntryBytes: 20 * 1024 * 1024,
  maxTotalBytes: 60 * 1024 * 1024,
} as const;

export class ZipLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipLimitError";
  }
}

/** PizZip's internal compressed-entry record (pizzip/js/compressedObject.js). */
interface CompressedData {
  compressedSize?: number;
  uncompressedSize?: number;
  compressionMethod?: string | null;
  getCompressedContent?: () => unknown;
}

interface InternalZipObject {
  dir?: boolean;
  _data?: unknown;
}

const DEFLATE = "\x08\x00";
const STORE = "\x00\x00";

function toBuffer(content: unknown): Buffer | null {
  if (content instanceof Uint8Array) return Buffer.from(content.buffer, content.byteOffset, content.byteLength);
  if (typeof content === "string") return Buffer.from(content, "latin1");
  if (Array.isArray(content)) return Buffer.from(content as number[]);
  return null;
}

/**
 * Check a loaded package against ZIP_LIMITS (see the file comment). Entries added in memory after
 * loading (strings / buffers, not CompressedData) are skipped.
 */
export function assertZipWithinLimits(zip: PizZip, limits: typeof ZIP_LIMITS = ZIP_LIMITS): void {
  const names = Object.keys(zip.files);
  if (names.length > limits.maxEntries) {
    throw new ZipLimitError(`The file has too many parts (${names.length}; at most ${limits.maxEntries}).`);
  }
  let total = 0;
  for (const name of names) {
    const entry = zip.files[name] as unknown as InternalZipObject;
    if (entry.dir) continue;
    const data = entry._data as CompressedData | undefined;
    if (!data || typeof data !== "object" || typeof data.getCompressedContent !== "function") continue;
    const declared = Number(data.uncompressedSize ?? 0);
    if (!Number.isFinite(declared) || declared < 0 || declared > limits.maxEntryBytes) {
      throw new ZipLimitError("A part of the file is too large once unpacked.");
    }
    total += declared;
    if (total > limits.maxTotalBytes) throw new ZipLimitError("The file is too large once unpacked.");

    const compressed = toBuffer(data.getCompressedContent());
    if (!compressed) throw new ZipLimitError("A part of the file could not be read.");
    if (data.compressionMethod === STORE) {
      if (compressed.length !== declared) throw new ZipLimitError("A part of the file does not match its declared size.");
      continue;
    }
    if (data.compressionMethod !== DEFLATE) throw new ZipLimitError("The file uses an unsupported compression method.");
    let inflated: Buffer;
    try {
      // +1 so "exactly the declared size" passes and anything bigger throws (RangeError) at the cap.
      inflated = inflateRawSync(compressed, { maxOutputLength: Math.max(1, declared + 1) });
    } catch {
      throw new ZipLimitError("A part of the file is larger than it declares, or is damaged.");
    }
    if (inflated.length !== declared) throw new ZipLimitError("A part of the file does not match its declared size.");
  }
}

/** new PizZip(bytes) + assertZipWithinLimits. Throws ZipLimitError, or PizZip's own error for a non-ZIP. */
export function openZipSafely(bytes: Uint8Array | Buffer): PizZip {
  const zip = new PizZip(bytes);
  assertZipWithinLimits(zip);
  return zip;
}

/* ------------------------------------------------------------------------------------------------
 * PDFs: the same problem in Flate-compressed streams (pdf-lib and pdf.js inflate without a cap).
 * ----------------------------------------------------------------------------------------------*/

export const PDF_STREAM_LIMITS = {
  /** Largest single stream once inflated. */
  maxStreamBytes: 40 * 1024 * 1024,
  /** All Flate streams together once inflated. */
  maxTotalBytes: 120 * 1024 * 1024,
} as const;

/**
 * Inflate every stream of a PDF once with a hard output cap and reject the file when one would expand
 * beyond the limits. Streams that are not zlib data (images, other filters, damaged data) are ignored
 * here – only "too large" is an error. Throws ZipLimitError.
 */
export function assertPdfWithinLimits(bytes: Uint8Array, limits: typeof PDF_STREAM_LIMITS = PDF_STREAM_LIMITS): void {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let total = 0;
  let from = 0;
  for (;;) {
    const start = buf.indexOf("stream", from, "latin1");
    if (start < 0) break;
    // "endstream" contains "stream": skip it, and require a line break after the keyword.
    const isEnd = start >= 3 && buf.toString("latin1", start - 3, start) === "end";
    let dataStart = start + 6;
    if (buf[dataStart] === 0x0d) dataStart += 1;
    if (buf[dataStart] === 0x0a) dataStart += 1;
    if (isEnd || dataStart === start + 6) {
      from = start + 6;
      continue;
    }
    const end = buf.indexOf("endstream", dataStart, "latin1");
    if (end < 0) break;
    const data = buf.subarray(dataStart, end);
    from = end + 9;
    if (data.length < 2 || (data[0] & 0x0f) !== 8) continue; // not a zlib header
    try {
      const out = inflateSyncCapped(data, Math.min(limits.maxStreamBytes, limits.maxTotalBytes - total) + 1);
      total += out;
    } catch (err) {
      if (err instanceof ZipLimitError) throw err;
      // Not inflatable here (wrong filter, truncated…) – not our concern.
    }
    if (total > limits.maxTotalBytes) throw new ZipLimitError("The PDF is too large once its contents are unpacked.");
  }
}

function inflateSyncCapped(data: Buffer, cap: number): number {
  try {
    return inflateSync(data, { maxOutputLength: Math.max(1, cap), finishFlush: zlibConstants.Z_SYNC_FLUSH }).length;
  } catch (err) {
    if (err instanceof RangeError || (err as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") {
      throw new ZipLimitError("A part of the PDF is too large once unpacked.");
    }
    throw err;
  }
}
