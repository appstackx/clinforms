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
 * Callers that already resolved the signed-in member (the API slice's actor) pass `tenantId` so the sign-in is
 * not looked up twice.
 *
 * Owner: store slice (wave 2).
 */
import type { DecodedFormFile } from "../../forms/file";
import { decodeFormFile } from "../../forms/file";
import type { MedreportDeps } from "../deps";
import { HttpError, logEvent } from "../http";

/** The clinic's stored copy of the file, or null (no storage, nobody signed in, not held, or unreadable). */
export async function storedFormFile(
  req: Request,
  deps: MedreportDeps,
  sha256: string,
  opts: { tenantId?: string | null } = {},
): Promise<DecodedFormFile | null> {
  const store = deps.tenantStore;
  if (!store || !/^[0-9a-f]{64}$/.test(sha256)) return null;
  let tenantId = opts.tenantId ?? null;
  if (!tenantId) {
    // Nobody can be signed in without a cookie: skip the sign-in lookup (the public demo's requests).
    if (!deps.authenticate || !req.headers.get("cookie")) return null;
    const actor = await deps.authenticate(req).catch(() => null);
    if (!actor || !actor.twoFactorVerified) return null;
    tenantId = actor.tenantId;
  }
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
  req: Request,
  deps: MedreportDeps,
  input: { fileBase64?: string; sha256: string; tenantId?: string | null },
): Promise<DecodedFormFile> {
  const stored = await storedFormFile(req, deps, input.sha256, { tenantId: input.tenantId });
  if (stored) return stored;
  if (!input.fileBase64) {
    throw new HttpError(422, "The referrer's form file is missing", {
      code: "VALIDATION_FAILED",
      issues: [{ path: "fileBase64", message: "Send the referrer's original form file (from the forms library) as fileBase64." }],
    });
  }
  return decodeFormFile(input.fileBase64);
}
