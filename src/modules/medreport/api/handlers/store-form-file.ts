import "server-only";

/**
 * The referrer's form file for POST /render and POST /forms/fill-preview.
 *
 * In a clinic's own Studio the server reads the file from the clinic's storage by (tenant, SHA-256) and
 * PREFERS that copy over the `fileBase64` the browser sends: the stored copy was checked when it was
 * uploaded, and the request stays small. The public demo (no tenant storage, nobody signed in) and a clinic
 * that does not hold the file use `fileBase64` exactly as before. Additive: the request contract only
 * gained "fileBase64 may be left out when the clinic holds the file".
 *
 * The caller passes the clinic it already resolved (auth/actor.ts requireActor): a clinic member's tenantId, or
 * null for the public demo (whose requests never read the database).
 *
 * Owner: store slice (wave 2); takes the API slice's actor since integration.
 */
import type { DecodedFormFile } from "../../forms/file";
import { decodeFormFile } from "../../forms/file";
import type { MedreportDeps } from "../deps";
import { HttpError, logEvent } from "../http";

/** The clinic's stored copy of the file, or null (no storage, the demo, not held, or unreadable). */
export async function storedFormFile(deps: MedreportDeps, sha256: string, tenantId: string | null): Promise<DecodedFormFile | null> {
  const store = deps.tenantStore;
  if (!store || !tenantId || !/^[0-9a-f]{64}$/.test(sha256)) return null;
  try {
    const file = await store.getFile(tenantId, sha256);
    if (!file) return null;
    // Same checks as an uploaded file (type from the bytes, size and decompression limits).
    return decodeFormFile(Buffer.from(file.bytes).toString("base64"));
  } catch (err) {
    logEvent("store_form_file_unreadable", { error: err instanceof Error ? err.name : typeof err });
    return null;
  }
}

/**
 * The form file for a fill: the clinic's stored copy of `sha256` when it holds one, else the request's
 * `fileBase64` (decoded and checked), else 422 VALIDATION_FAILED. The caller still checks the SHA-256 against
 * the form map / report (assertFormFileMatches).
 */
export async function formFileForRequest(
  deps: MedreportDeps,
  input: { fileBase64?: string; sha256: string; tenantId: string | null },
): Promise<DecodedFormFile> {
  const stored = await storedFormFile(deps, input.sha256, input.tenantId);
  if (stored) return stored;
  if (!input.fileBase64) {
    throw new HttpError(422, "The referrer's form file is missing", {
      code: "VALIDATION_FAILED",
      issues: [{ path: "fileBase64", message: "Send the referrer's original form file (from the forms library) as fileBase64." }],
    });
  }
  return decodeFormFile(input.fileBase64);
}
