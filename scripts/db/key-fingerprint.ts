/**
 * Data key fingerprints – proves the secrets file and a deployment hold the same data keys, printing only key ids
 * and fingerprints (never a key, never the cron secret):
 *
 *   npm run ops:key-fingerprint -- --env production                                     # kid + fingerprint from the file
 *   npm run ops:key-fingerprint -- --env production --compare https://clinforms.co.uk   # + MATCH / MISMATCH per kid
 *
 * - Reads <ENV>_CLINFORMS_DATA_KEYS / <ENV>_CLINFORMS_DATA_KEY_ID from ~/.config/appstackx/clinforms.secrets.env and
 *   parses them with the data cipher's own parseKeyring (src/server/crypto/envelope.ts); fingerprint =
 *   src/server/crypto/fingerprint.ts (first 16 hex of HMAC-SHA256(raw key, "clinforms:key-fingerprint:v1")).
 * - --compare <baseUrl>: GET <origin>/api/ops/key-fingerprint with `Authorization: Bearer <ENV>_CRON_SECRET` (built in
 *   this process, never printed; https only, plain http only for localhost; redirects are not followed, so the secret
 *   never goes to another host), then one MATCH / MISMATCH row per kid and one for the active kid. A kid on one side
 *   only is a MISMATCH: the file is what gets piped into Vercel, so after every rotation both hold the same keys.
 * - Exit code: 0 = listed, or every row MATCH; 1 = at least one MISMATCH; 2 = could not check (usage, secrets file,
 *   network, HTTP status – each with a one-line reason).
 *
 * Runbook: docs/go-live.md §7.6 and docs/database.md §5 (key rotation).
 */
import path from "node:path";
import { CliError, parseArgs, str } from "../admin/cli";
import { DataCryptoError, parseKeyring } from "../../src/server/crypto/envelope";
import { KEY_FINGERPRINT_PATTERN, keyringFingerprints, type KeyringFingerprints } from "../../src/server/crypto/fingerprint";
import { readSecretsFile } from "./provision-gateway-secrets";

export const KEY_FINGERPRINT_PATH = "/api/ops/key-fingerprint";
const KID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type FingerprintEnv = "preview" | "production";

export interface CompareRow {
  status: "MATCH" | "MISMATCH";
  subject: string;
  file: string;
  deployment: string;
  note?: string;
}

export interface RunDeps {
  secrets: Map<string, string>;
  fetch: typeof fetch;
  out: (line: string) => void;
  err: (line: string) => void;
  timeoutMs?: number;
}

function prefixOf(env: FingerprintEnv): string {
  return env === "production" ? "PRODUCTION_" : "PREVIEW_";
}

/** Fingerprints of the <ENV>_ keyring in the secrets file, parsed exactly as the app parses CLINFORMS_DATA_KEYS. */
export function fileFingerprints(secrets: Map<string, string>, env: FingerprintEnv): KeyringFingerprints {
  const prefix = prefixOf(env);
  const keys = secrets.get(`${prefix}CLINFORMS_DATA_KEYS`);
  const kid = secrets.get(`${prefix}CLINFORMS_DATA_KEY_ID`);
  if (!keys) throw new CliError(`${prefix}CLINFORMS_DATA_KEYS is missing from the secrets file.`);
  if (!kid) throw new CliError(`${prefix}CLINFORMS_DATA_KEY_ID is missing from the secrets file.`);
  try {
    return keyringFingerprints(parseKeyring(keys, kid));
  } catch (error) {
    // The loader's message is not printed: it may quote a mistyped key id, which could be key material.
    if (error instanceof DataCryptoError) {
      throw new CliError(
        `${prefix}CLINFORMS_DATA_KEYS / ${prefix}CLINFORMS_DATA_KEY_ID fail the app's keyring check (${error.code}): ` +
          `expected JSON {"<kid>":"<base64 of 32 bytes>"} with the active kid listed in it.`,
      );
    }
    throw error;
  }
}

/** <origin>/api/ops/key-fingerprint; https only (plain http only for localhost), no credentials in the URL. */
export function fingerprintEndpoint(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new CliError("--compare needs the site's base URL, e.g. https://clinforms.co.uk.");
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new CliError("--compare must be an https:// URL (plain http only for localhost): the request carries the cron secret.");
  }
  if (url.username || url.password) throw new CliError("--compare must not contain a user name or password.");
  return new URL(KEY_FINGERPRINT_PATH, url.origin);
}

/** Validates the endpoint's JSON strictly, so nothing but kids and 16-hex fingerprints is ever printed from it. */
export function parseFingerprintBody(body: unknown): KeyringFingerprints {
  const bad = () => new CliError("The endpoint answered 200 but not with {activeKid, keys: [{kid, fingerprint}]}.");
  if (!body || typeof body !== "object" || Array.isArray(body)) throw bad();
  const { activeKid, keys } = body as { activeKid?: unknown; keys?: unknown };
  if (typeof activeKid !== "string" || !KID_PATTERN.test(activeKid) || !Array.isArray(keys)) throw bad();
  const seen = new Set<string>();
  const parsed = keys.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") throw bad();
    const { kid, fingerprint } = entry as { kid?: unknown; fingerprint?: unknown };
    if (typeof kid !== "string" || !KID_PATTERN.test(kid) || seen.has(kid)) throw bad();
    if (typeof fingerprint !== "string" || !KEY_FINGERPRINT_PATTERN.test(fingerprint)) throw bad();
    seen.add(kid);
    return { kid, fingerprint };
  });
  return { activeKid, keys: parsed };
}

function printable(text: string, max = 160): string {
  return text.replace(/[^\x20-\x7e]/g, "?").slice(0, max);
}

/** Calls the endpoint. Every failure becomes a CliError with a one-line reason that never contains the secret. */
export async function fetchDeploymentFingerprints(
  endpoint: URL,
  cronSecret: string,
  fetchImpl: typeof fetch,
  secretName: string,
  timeoutMs = 30_000,
): Promise<KeyringFingerprints> {
  let res: Response;
  try {
    res = await fetchImpl(endpoint, {
      method: "GET",
      headers: { authorization: `Bearer ${cronSecret}`, accept: "application/json" },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const cause = error instanceof Error ? ((error.cause as { code?: string } | undefined)?.code ?? error.name) : "error";
    throw new CliError(`Could not reach ${endpoint.href} (${printable(String(cause), 60)}).`);
  }
  const text = await res.text().catch(() => "");
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  const ours = !!body && typeof body === "object" && (body as { ok?: unknown }).ok === false;
  if (res.status === 200) return parseFingerprintBody(body);
  if (res.status >= 300 && res.status < 400) {
    const location = printable(res.headers.get("location") ?? "?");
    throw new CliError(`HTTP ${res.status}: redirected to ${location} – pass the final URL to --compare (the secret is not sent on).`);
  }
  if (res.status === 401 && ours) {
    throw new CliError(`HTTP 401: the deployment refused ${secretName} – the secrets file and the deployment's CRON_SECRET differ.`);
  }
  if (res.status === 401) {
    throw new CliError("HTTP 401 from something other than the endpoint (deployment protection in front of the app?).");
  }
  if (res.status === 503 && ours) throw new CliError("HTTP 503: CRON_SECRET is not set on the deployment, so the endpoint refuses every call.");
  if (res.status === 404) {
    throw new CliError(`HTTP 404: no ${KEY_FINGERPRINT_PATH} on that deployment (it predates the endpoint, or the URL is wrong).`);
  }
  if (res.status === 500 && ours) {
    const code = printable(String((body as { code?: unknown }).code ?? "UNKNOWN"), 40);
    throw new CliError(
      `HTTP 500: the deployment could not load its data keyring (${code}) – its CLINFORMS_DATA_KEYS / CLINFORMS_DATA_KEY_ID are ` +
        "malformed, so encrypted reads and writes fail there too.",
    );
  }
  throw new CliError(`HTTP ${res.status} from ${endpoint.href}.`);
}

/** One row per kid on either side (sorted) plus the active kid; any difference is a MISMATCH. */
export function compareFingerprints(file: KeyringFingerprints, deployment: KeyringFingerprints): { ok: boolean; rows: CompareRow[] } {
  const fileKeys = new Map(file.keys.map((k) => [k.kid, k.fingerprint]));
  const deployedKeys = new Map(deployment.keys.map((k) => [k.kid, k.fingerprint]));
  const kids = Array.from(new Set(Array.from(fileKeys.keys()).concat(Array.from(deployedKeys.keys())))).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const rows: CompareRow[] = kids.map((kid) => {
    const f = fileKeys.get(kid);
    const d = deployedKeys.get(kid);
    const note = !f ? "only on the deployment" : !d ? "only in the secrets file" : f !== d ? "different key bytes" : undefined;
    return { status: f && d && f === d ? "MATCH" : "MISMATCH", subject: `kid ${kid}`, file: f ?? "-", deployment: d ?? "-", ...(note ? { note } : {}) };
  });
  const activeMatch = file.activeKid === deployment.activeKid;
  rows.push({
    status: activeMatch ? "MATCH" : "MISMATCH",
    subject: "activeKid",
    file: file.activeKid,
    deployment: deployment.activeKid,
    ...(activeMatch ? {} : { note: "new data would be written with a different key" }),
  });
  return { ok: rows.every((r) => r.status === "MATCH"), rows };
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

/** The CLI. Returns the exit code (0 listed / all MATCH, 1 MISMATCH, 2 could not check). */
export async function run(argv: string[], deps: RunDeps): Promise<number> {
  try {
    const args = parseArgs(argv);
    for (const key of Array.from(args.keys())) if (key !== "env" && key !== "compare") throw new CliError(`Unknown option --${key}.`);
    const env = str(args, "env", true);
    if (env !== "production" && env !== "preview") throw new CliError("--env must be production or preview.");
    const compare = str(args, "compare");
    const prefix = prefixOf(env);

    const file = fileFingerprints(deps.secrets, env);
    deps.out(`Data keys in the secrets file (${prefix}CLINFORMS_DATA_KEYS, active ${prefix}CLINFORMS_DATA_KEY_ID):`);
    const width = Math.max(4, ...file.keys.map((k) => k.kid.length)) + 2;
    for (const k of file.keys) deps.out(`  ${pad(k.kid, width)}${k.fingerprint}${k.kid === file.activeKid ? "  (active)" : ""}`);
    if (compare === undefined) return 0;

    const endpoint = fingerprintEndpoint(compare);
    const secretName = `${prefix}CRON_SECRET`;
    const cronSecret = deps.secrets.get(secretName);
    if (!cronSecret) throw new CliError(`${secretName} is missing from the secrets file – the endpoint needs it.`);
    deps.out(`Comparing with ${endpoint.href} …`);
    const deployed = await fetchDeploymentFingerprints(endpoint, cronSecret, deps.fetch, secretName, deps.timeoutMs);
    const { ok, rows } = compareFingerprints(file, deployed);
    const subjectWidth = Math.max(...rows.map((r) => r.subject.length)) + 2;
    const valueWidth = Math.max(...rows.map((r) => r.file.length)) + 2;
    for (const r of rows) {
      deps.out(
        `  ${pad(r.status, 10)}${pad(r.subject, subjectWidth)}file ${pad(r.file, valueWidth)}deployment ${r.deployment}${r.note ? `  (${r.note})` : ""}`,
      );
    }
    const matched = rows.filter((r) => r.status === "MATCH").length;
    deps.out(
      ok
        ? `MATCH: the secrets file holds exactly the data keys ${endpoint.origin} uses (${matched}/${rows.length} rows).`
        : `MISMATCH: ${rows.length - matched} of ${rows.length} rows differ – stop and reconcile the secrets file with the deployment before anything else.`,
    );
    return ok ? 0 : 1;
  } catch (error) {
    if (error instanceof CliError) {
      deps.err(`Error: ${error.message}`);
      return 2;
    }
    deps.err(`Error: ${error instanceof Error ? error.name : "unknown failure"}.`);
    return 2;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  run(process.argv.slice(2), {
    secrets: readSecretsFile(),
    fetch: globalThis.fetch,
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  }).then((code) => {
    process.exitCode = code;
  });
}
