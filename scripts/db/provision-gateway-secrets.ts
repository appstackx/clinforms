/**
 * Generates and distributes the data-layer secrets for ONE environment, without ever printing a value:
 *
 *   node --import tsx scripts/db/provision-gateway-secrets.ts --env preview [--rotate-gateway-secret]
 *   node --import tsx scripts/db/provision-gateway-secrets.ts --env production --yes   (orchestrator only)
 *
 * 1. Values (kept if already in the secrets file, so a re-run is harmless):
 *      GATEWAY secret      – 48 random bytes, base64url (new one with --rotate-gateway-secret)
 *      CLINFORMS_DATA_KEYS – {"k1": "<base64 32 bytes>"}, CLINFORMS_DATA_KEY_ID = k1 (NEVER regenerated here:
 *                            losing the key makes the data unreadable; rotation = add a kid, see docs/database.md)
 * 2. Saved FIRST to ~/.config/appstackx/clinforms.secrets.env (chmod 600) as <ENV>_NAME=value lines.
 * 3. `wrangler secret put GATEWAY_SECRET [--env preview]` (value on stdin).
 * 4. Vercel env (value on stdin, --force): CLINFORMS_DB=d1, CLINFORMS_D1_GATEWAY_URL, and the sensitive
 *    CLINFORMS_D1_GATEWAY_SECRET, CLINFORMS_DATA_KEYS, CLINFORMS_DATA_KEY_ID.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SECRETS_FILE = path.join(os.homedir(), ".config", "appstackx", "clinforms.secrets.env");
const MAIN_REPO = process.env.CLINFORMS_VERCEL_CWD || "/Users/khuram/Projects/Appstackx/clinforms";
const WORKER_DIR = path.resolve("workers/data-gateway");
const VERCEL = ["--yes", "vercel@63.1.0"];
const ACCOUNT_ID = "a04ab546d0f1be2aa339bafebcdb3ffa";
export const GATEWAY_URLS = {
  preview: "https://clinforms-data-preview.appstackx-demos.workers.dev",
  production: "https://clinforms-data.appstackx-demos.workers.dev",
} as const;

type Target = keyof typeof GATEWAY_URLS;

/** KEY=VALUE lines → map (values may contain '=' and JSON). */
export function readSecretsFile(file = SECRETS_FILE): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(file)) return map;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && !line.startsWith("#")) map.set(line.slice(0, i).trim(), line.slice(i + 1));
  }
  return map;
}

/** Upserts KEY=VALUE lines, keeping every other line; the file stays chmod 600. */
export function upsertSecrets(values: Record<string, string>, file = SECRETS_FILE): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n") : [];
  const pending = new Map(Object.entries(values));
  const out = lines.map((line) => {
    const i = line.indexOf("=");
    const key = i > 0 ? line.slice(0, i).trim() : "";
    if (key && pending.has(key)) {
      const v = pending.get(key) as string;
      pending.delete(key);
      return `${key}=${v}`;
    }
    return line;
  });
  while (out.length && out[out.length - 1] === "") out.pop();
  for (const [key, v] of Array.from(pending.entries())) out.push(`${key}=${v}`);
  fs.writeFileSync(file, `${out.join("\n")}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function run(cmd: string, args: string[], input: string, cwd: string, label: string): void {
  const result = spawnSync(cmd, args, {
    cwd,
    input,
    encoding: "utf8",
    env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false", CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID || ACCOUNT_ID },
  });
  // Never echo child output wholesale (it is not expected to contain values, but stay safe): status only.
  if (result.status !== 0) {
    const tail = `${result.stderr ?? ""}${result.stdout ?? ""}`.split("\n").filter((l) => /error|✘|fail/i.test(l)).slice(-3).join(" | ");
    throw new Error(`${label} failed (exit ${result.status}): ${tail.slice(0, 300)}`);
  }
  console.log(`ok  ${label}`);
}

function main(): void {
  const i = process.argv.indexOf("--env");
  const target = (i >= 0 ? process.argv[i + 1] : "") as Target;
  if (target !== "preview" && target !== "production") throw new Error("--env preview|production is required");
  if (target === "production" && !process.argv.includes("--yes")) throw new Error("Refusing to touch PRODUCTION without --yes.");
  const prefix = target === "preview" ? "PREVIEW_" : "PRODUCTION_";
  const existing = readSecretsFile();

  const gatewaySecret =
    !process.argv.includes("--rotate-gateway-secret") && existing.get(`${prefix}CLINFORMS_D1_GATEWAY_SECRET`)
      ? (existing.get(`${prefix}CLINFORMS_D1_GATEWAY_SECRET`) as string)
      : randomBytes(48).toString("base64url");
  const dataKeys = existing.get(`${prefix}CLINFORMS_DATA_KEYS`) ?? JSON.stringify({ k1: randomBytes(32).toString("base64") });
  const dataKeyId = existing.get(`${prefix}CLINFORMS_DATA_KEY_ID`) ?? "k1";
  const url = GATEWAY_URLS[target];

  upsertSecrets({
    [`${prefix}CLINFORMS_DB`]: "d1",
    [`${prefix}CLINFORMS_D1_GATEWAY_URL`]: url,
    [`${prefix}CLINFORMS_D1_GATEWAY_SECRET`]: gatewaySecret,
    [`${prefix}CLINFORMS_DATA_KEYS`]: dataKeys,
    [`${prefix}CLINFORMS_DATA_KEY_ID`]: dataKeyId,
  });
  console.log(`ok  saved ${prefix}* values to ${SECRETS_FILE} (chmod 600)`);

  const wranglerBin = path.join(WORKER_DIR, "node_modules", ".bin", "wrangler");
  const wranglerArgs = ["secret", "put", "GATEWAY_SECRET", ...(target === "preview" ? ["--env", "preview"] : [])];
  run(wranglerBin, wranglerArgs, gatewaySecret, WORKER_DIR, `wrangler secret put GATEWAY_SECRET (${target})`);

  const vercelEnv = target;
  const vars: [string, string, boolean][] = [
    ["CLINFORMS_DB", "d1", false],
    ["CLINFORMS_D1_GATEWAY_URL", url, false],
    ["CLINFORMS_D1_GATEWAY_SECRET", gatewaySecret, true],
    ["CLINFORMS_DATA_KEYS", dataKeys, true],
    ["CLINFORMS_DATA_KEY_ID", dataKeyId, true],
  ];
  for (const [name, value, sensitive] of vars) {
    const args = [...VERCEL, "env", "add", name, vercelEnv, sensitive ? "--sensitive" : "--no-sensitive", "--force", "--yes", "--cwd", MAIN_REPO];
    run("npx", args, value, os.tmpdir(), `vercel env add ${name} (${vercelEnv}${sensitive ? ", sensitive" : ""})`);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
