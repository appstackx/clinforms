/**
 * GET /api/ops/key-fingerprint – proves which data keys the deployment holds without revealing them.
 *
 * - Auth: `Authorization: Bearer $CRON_SECRET` (the retention cron's constant-time helper, ../cron/auth.ts).
 *   503 while CRON_SECRET is unset (or under 16 characters), 401 for anything else that is not an exact match.
 *   An unauthorised call never loads the keyring.
 * - 200: `{ activeKid, keys: [{ kid, fingerprint }] }` (../crypto/fingerprint.ts), from the keyring loaded by the
 *   same loader as the data cipher (keyringFromEnv → parseKeyring), so a malformed keyring fails here exactly as it
 *   fails for every encrypted read and write: 500 with the loader's error code (BAD_KEYRING).
 * - Never returns or logs key bytes; logs event names, reasons, error codes and the number of keys only. The
 *   loader's error message is not passed on (it may quote a mistyped key id, which could be key material).
 * - Compared with the secrets file by `npm run ops:key-fingerprint -- --env production --compare <baseUrl>`.
 */
import { DataCryptoError, type Keyring } from "../crypto/envelope";
import { keyringFingerprints } from "../crypto/fingerprint";
import { cronAuthorized, cronSecretConfigured } from "../cron/auth";

export interface KeyFingerprintDeps {
  secret: string | undefined;
  /** Loaded only after the caller is authorised (keyringFromEnv in the route). */
  keyring: () => Keyring;
  log?: (event: string, detail: Record<string, unknown>) => void;
}

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, max-age=0",
  "x-robots-tag": "noindex, nofollow",
} as const;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

export async function handleKeyFingerprint(req: Request, deps: KeyFingerprintDeps): Promise<Response> {
  const log = deps.log ?? ((event, detail) => console.info(JSON.stringify({ event, ...detail })));
  if (!cronSecretConfigured(deps.secret)) {
    log("ops.key_fingerprint.refused", { reason: "not_configured" });
    return json(503, { ok: false, error: "Not configured." });
  }
  if (!cronAuthorized(req.headers.get("authorization"), deps.secret)) {
    log("ops.key_fingerprint.refused", { reason: "unauthorized" });
    return json(401, { ok: false, error: "Unauthorized." });
  }
  let keyring: Keyring;
  try {
    keyring = deps.keyring();
  } catch (error) {
    const code = error instanceof DataCryptoError ? error.code : "UNKNOWN";
    log("ops.key_fingerprint.failed", { code });
    return json(500, { ok: false, error: "The data keyring could not be loaded.", code });
  }
  const body = keyringFingerprints(keyring);
  log("ops.key_fingerprint.served", { activeKid: body.activeKid, keys: body.keys.length });
  return json(200, body);
}
