/**
 * Shared plumbing for the platform admin scripts (scripts/admin/*.ts):
 * - arguments: --flag value / --flag (boolean);
 * - target: no --env = the current environment (e.g. node --env-file=.env.local, or local SQLite);
 *   --env preview | production = the PREVIEW_* / PRODUCTION_* values of ~/.config/appstackx/clinforms.secrets.env
 *   (read into this process only, never printed). Production changes also need --yes.
 */
import os from "node:os";
import path from "node:path";
import { readSecretsFile, SECRETS_FILE } from "../db/provision-gateway-secrets";

export type Target = "current" | "preview" | "production";

/** Variables an admin script may take from the secrets file. */
export const TARGET_VARS = [
  "CLINFORMS_DB",
  "CLINFORMS_D1_GATEWAY_URL",
  "CLINFORMS_D1_GATEWAY_SECRET",
  "CLINFORMS_DATA_KEYS",
  "CLINFORMS_DATA_KEY_ID",
  "DATABASE_URL",
  "DATABASE_SSL",
  "DATABASE_CA_CERT",
  "BETTER_AUTH_URL",
  "BETTER_AUTH_SECRET",
  "CLINFORMS_EMAIL_PROVIDER",
  "MAILERSEND_API_KEY",
  "MAILERSEND_FROM_EMAIL",
] as const;

export const DEFAULT_APP_URLS: Record<Target, string | null> = {
  current: null,
  preview: null,
  production: "https://clinforms.co.uk",
};

export class CliError extends Error {}

export function parseArgs(argv: string[]): Map<string, string | true> {
  const args = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new CliError(`Unexpected argument: ${a}`);
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      args.set(key, next);
      i++;
    } else {
      args.set(key, true);
    }
  }
  return args;
}

export function str(args: Map<string, string | true>, key: string, required = false): string | undefined {
  const v = args.get(key);
  if (v === true) throw new CliError(`--${key} needs a value.`);
  if (required && !v) throw new CliError(`--${key} is required.`);
  return v;
}

export function flag(args: Map<string, string | true>, key: string): boolean {
  return args.get(key) === true || args.get(key) === "true";
}

export function resolveTarget(args: Map<string, string | true>): Target {
  const env = args.get("env");
  if (env === undefined) return "current";
  if (env === "preview" || env === "production") return env;
  throw new CliError("--env must be preview or production.");
}

/** Loads the target's values into process.env (only the listed names). Returns the names that were set. */
export function applyTarget(target: Target, env: Record<string, string | undefined> = process.env, file = SECRETS_FILE): string[] {
  if (target === "current") return [];
  const secrets = readSecretsFile(file);
  const prefix = target === "preview" ? "PREVIEW_" : "PRODUCTION_";
  const set: string[] = [];
  for (const name of TARGET_VARS) {
    const value = secrets.get(prefix + name);
    if (value !== undefined && value !== "") {
      env[name] = value;
      set.push(name);
    }
  }
  if (!env.CLINFORMS_DB) throw new CliError(`No ${prefix}CLINFORMS_DB in ${file}: is the ${target} database provisioned?`);
  return set;
}

export function requireYesForProduction(target: Target, args: Map<string, string | true>, what: string): void {
  if (target === "production" && !flag(args, "yes")) throw new CliError(`${what} on PRODUCTION needs --yes.`);
}

/** The app origin for links: --app-url, else BETTER_AUTH_URL, else the target's default. */
export function appUrl(target: Target, args: Map<string, string | true>, env: Record<string, string | undefined> = process.env): string {
  const raw = str(args, "app-url") ?? env.BETTER_AUTH_URL ?? DEFAULT_APP_URLS[target] ?? (target === "current" ? "http://localhost:3000" : null);
  if (!raw) throw new CliError("--app-url is required for preview (the origin of the deployment or local server that uses the preview database).");
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(url.hostname))) throw new Error();
    return url.origin;
  } catch {
    throw new CliError("--app-url must be an https URL (http only for localhost).");
  }
}

/** Exports hold decrypted patient data: never inside the repository (it could be committed). */
export function safeExportDir(dir: string | undefined, slug: string, repoRoot = process.cwd()): string {
  const chosen = path.resolve(dir ?? path.join(os.homedir(), "clinforms-exports", `${slug}-${new Date().toISOString().replace(/[:.]/g, "-")}`));
  const root = path.resolve(repoRoot);
  if (chosen === root || chosen.startsWith(root + path.sep)) {
    throw new CliError("--export-dir must be outside the repository (the export holds decrypted patient data).");
  }
  return chosen;
}

export async function runCli(main: () => Promise<void>): Promise<void> {
  try {
    await main();
  } catch (err) {
    console.error(err instanceof Error ? `Error: ${err.message}` : String(err));
    process.exitCode = 1;
  } finally {
    const { closeDb } = await import("../../src/server/db");
    await closeDb().catch(() => undefined);
  }
}
