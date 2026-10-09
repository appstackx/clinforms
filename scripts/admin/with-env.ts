/**
 * Runs a command with a target's settings from ~/.config/appstackx/clinforms.secrets.env in its environment
 * (values never printed) – e.g. the app locally against the PREVIEW database:
 *
 *   npm run admin:with-env -- --env preview --port 3111 -- npx next start -p 3111
 *
 * Sets the data, encryption and identity variables of that target, BETTER_AUTH_URL=http://localhost:<port>
 * (local cookies), and CLINFORMS_EMAIL_PROVIDER from the file (default none).
 */
import { spawn } from "node:child_process";
import { readSecretsFile } from "../db/provision-gateway-secrets";
import { CliError, TARGET_VARS } from "./cli";

const argv = process.argv.slice(2);
const split = argv.indexOf("--");
if (split < 0) throw new CliError("Usage: --env preview|production [--port N] -- <command …>");
const own = argv.slice(0, split);
const command = argv.slice(split + 1);
const envName = own[own.indexOf("--env") + 1];
if (own.indexOf("--env") < 0 || (envName !== "preview" && envName !== "production")) throw new CliError("--env preview|production is required.");
const port = own.includes("--port") ? own[own.indexOf("--port") + 1] : "3000";
const prefix = envName === "preview" ? "PREVIEW_" : "PRODUCTION_";
const secrets = readSecretsFile();
const childEnv: Record<string, string | undefined> = { ...process.env, PORT: port, BETTER_AUTH_URL: `http://localhost:${port}` };
for (const name of [...TARGET_VARS, "BETTER_AUTH_SECRET"]) {
  if (name === "BETTER_AUTH_URL") continue;
  const value = secrets.get(prefix + name);
  if (value) childEnv[name] = value;
}
childEnv.CLINFORMS_EMAIL_PROVIDER ??= "none";
if (!childEnv.CLINFORMS_DB || !childEnv.BETTER_AUTH_SECRET) {
  console.error(`Missing ${prefix}CLINFORMS_DB or ${prefix}BETTER_AUTH_SECRET in the secrets file (run admin:provision-auth).`);
  process.exit(1);
}
const child = spawn(command[0], command.slice(1), { env: childEnv as NodeJS.ProcessEnv, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => child.kill(sig));
