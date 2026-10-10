/**
 * Provisions the identity settings of a Vercel environment (values never printed):
 *
 *   npm run admin:provision-auth -- --env preview
 *   npm run admin:provision-auth -- --env production --yes        (orchestrator only)
 *
 * - BETTER_AUTH_SECRET: generated with node crypto (48 random bytes, base64url) unless the secrets file
 *   (~/.config/appstackx/clinforms.secrets.env, chmod 600) already has <ENV>_BETTER_AUTH_SECRET – re-runs keep
 *   it (rotating it signs everyone out and makes the stored two-step secrets unreadable: never casually).
 * - CLINFORMS_EMAIL_PROVIDER: kept from the file, else "none" (until a MailerSend key exists).
 * - BETTER_AUTH_URL: production only, https://clinforms.co.uk. Previews leave it UNSET on purpose: the base
 *   URL then comes from the request, restricted to the deployment's own Vercel hostnames
 *   (src/server/auth/config.ts).
 * The file is written first, then each value goes to `vercel env add … --force` on stdin.
 */
import { randomBytes } from "node:crypto";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { readSecretsFile, SECRETS_FILE, upsertSecrets } from "../db/provision-gateway-secrets";
import { CliError, parseArgs, requireYesForProduction, resolveTarget } from "./cli";

const MAIN_REPO = process.env.CLINFORMS_VERCEL_CWD || "/Users/khuram/Projects/Appstackx/clinforms";
const VERCEL = ["--yes", "vercel@63.1.0"];
export const PRODUCTION_URL = "https://clinforms.co.uk";

export function planAuthSettings(target: "preview" | "production", existing: Map<string, string>, generate = () => randomBytes(48).toString("base64url")) {
  const prefix = target === "preview" ? "PREVIEW_" : "PRODUCTION_";
  const secret = existing.get(`${prefix}BETTER_AUTH_SECRET`) || generate();
  const provider = existing.get(`${prefix}CLINFORMS_EMAIL_PROVIDER`) || "none";
  const file: Record<string, string> = {
    [`${prefix}BETTER_AUTH_SECRET`]: secret,
    [`${prefix}CLINFORMS_EMAIL_PROVIDER`]: provider,
    ...(target === "production" ? { [`${prefix}BETTER_AUTH_URL`]: PRODUCTION_URL } : {}),
  };
  const vercel: [string, string, boolean][] = [
    ["BETTER_AUTH_SECRET", secret, true],
    ["CLINFORMS_EMAIL_PROVIDER", provider, false],
    ...(target === "production" ? ([["BETTER_AUTH_URL", PRODUCTION_URL, false]] as [string, string, boolean][]) : []),
  ];
  return { file, vercel, generated: !existing.get(`${prefix}BETTER_AUTH_SECRET`) };
}

function vercelEnvAdd(name: string, value: string, environment: string, sensitive: boolean): void {
  const args = [...VERCEL, "env", "add", name, environment, sensitive ? "--sensitive" : "--no-sensitive", "--force", "--yes", "--cwd", MAIN_REPO];
  const result = spawnSync("npx", args, { cwd: os.tmpdir(), input: value, encoding: "utf8" });
  if (result.status !== 0) {
    const tail = `${result.stderr ?? ""}${result.stdout ?? ""}`.split("\n").filter((l) => /error|fail/i.test(l)).slice(-3).join(" | ");
    throw new Error(`vercel env add ${name} failed (exit ${result.status}): ${tail.slice(0, 300)}`);
  }
  console.log(`ok  vercel env add ${name} (${environment}${sensitive ? ", sensitive" : ""})`);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const target = resolveTarget(args);
  if (target === "current") throw new CliError("--env preview or --env production is required.");
  requireYesForProduction(target, args, "Provisioning auth settings");
  const plan = planAuthSettings(target, readSecretsFile());
  upsertSecrets(plan.file);
  console.log(`ok  ${plan.generated ? "generated and saved" : "kept"} ${target.toUpperCase()}_BETTER_AUTH_SECRET in ${SECRETS_FILE} (chmod 600)`);
  for (const [name, value, sensitive] of plan.vercel) vercelEnvAdd(name, value, target, sensitive);
  if (target === "preview") console.log("ok  BETTER_AUTH_URL left unset for preview (dynamic base URL, this deployment's own hosts only)");
}

if (process.argv[1] && /provision-auth-secrets\.ts$/.test(process.argv[1])) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? `Error: ${err.message}` : String(err));
    process.exit(1);
  }
}
