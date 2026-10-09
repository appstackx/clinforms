/**
 * Creates the ClinForms Supabase project (London, eu-west-2) through the Supabase Management API:
 *
 *   SUPABASE_ACCESS_TOKEN=… SUPABASE_ORG_ID=<organization slug> npm run db:provision-supabase -- [--name clinforms-prod] [--dry-run]
 *
 * - POST /v1/projects {name, organization_slug, db_pass, region_selection: {type: "specific", code: "eu-west-2"}}
 *   (field names checked against https://api.supabase.com/api/v1-json on 09/10/2026: `organization_id` and
 *   `region` are deprecated in favour of `organization_slug` and `region_selection`);
 * - the database password is generated here and saved to ~/.config/appstackx/clinforms.supabase.env
 *   (chmod 600) together with DATABASE_URL (transaction pooler) and DATABASE_URL_SESSION (session pooler,
 *   for migrations) – it is never printed;
 * - waits until the project is ACTIVE_HEALTHY and its db + pooler services are healthy;
 * - prints the pooler connection strings with the password replaced by [YOUR-PASSWORD].
 * --dry-run prints the planned requests (password redacted) and changes nothing.
 * Next steps (docs/database.md): CLINFORMS_DB=postgres DATABASE_URL=… npm run db:migrate, then the copy.
 */
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { upsertSecrets } from "./provision-gateway-secrets";

export const SUPABASE_API = "https://api.supabase.com";
export const SUPABASE_ENV_FILE = path.join(os.homedir(), ".config", "appstackx", "clinforms.supabase.env");
export const REGION = "eu-west-2";

export interface PlannedRequest {
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
}

export function createProjectBody(name: string, organizationSlug: string, dbPass: string): Record<string, unknown> {
  return {
    name,
    organization_slug: organizationSlug,
    db_pass: dbPass,
    region_selection: { type: "specific", code: REGION },
  };
}

export function planRequests(name: string, organizationSlug: string): PlannedRequest[] {
  return [
    { method: "GET", path: "/v1/projects" },
    { method: "POST", path: "/v1/projects", body: createProjectBody(name, organizationSlug, "[GENERATED – saved to the env file, never printed]") },
    { method: "GET", path: "/v1/projects/{ref}  (poll until status ACTIVE_HEALTHY)" },
    { method: "GET", path: "/v1/projects/{ref}/health?services=db,pooler  (poll until ACTIVE_HEALTHY)" },
    { method: "GET", path: "/v1/projects/{ref}/config/database/pooler" },
  ];
}

/** Replaces any password in a postgres URL with [YOUR-PASSWORD]. */
export function scrubConnectionString(value: string): string {
  return value.replace(/^(postgres(?:ql)?:\/\/[^:/@]+):[^@]*@/i, "$1:[YOUR-PASSWORD]@");
}

export interface PoolerConfig {
  db_user?: string;
  db_host?: string;
  db_port?: number;
  db_name?: string;
  pool_mode?: string;
  database_type?: string;
  connection_string?: string;
}

export function poolerUrl(cfg: PoolerConfig, password: string, port?: number): string {
  if (!cfg.db_user || !cfg.db_host || !cfg.db_name) throw new Error("The pooler configuration is incomplete.");
  return `postgresql://${encodeURIComponent(cfg.db_user)}:${encodeURIComponent(password)}@${cfg.db_host}:${port ?? cfg.db_port ?? 6543}/${cfg.db_name}`;
}

async function api<T>(token: string, method: "GET" | "POST", apiPath: string, body?: unknown): Promise<T> {
  const res = await fetch(`${SUPABASE_API}${apiPath}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${apiPath} → ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const nameArg = process.argv.indexOf("--name");
  const name = nameArg >= 0 ? process.argv[nameArg + 1] : "clinforms-prod";
  const org = process.env.SUPABASE_ORG_ID || process.env.SUPABASE_ORG_SLUG || "";
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) {
    console.log(`Dry run: project "${name}" in organization "${org || "<SUPABASE_ORG_ID>"}", region ${REGION}`);
    for (const r of planRequests(name, org || "<SUPABASE_ORG_ID>")) {
      console.log(`${r.method} ${SUPABASE_API}${r.path}${r.body ? `\n  ${JSON.stringify(r.body)}` : ""}`);
    }
    console.log(`Would save SUPABASE_PROJECT_REF, SUPABASE_DB_PASSWORD, DATABASE_URL, DATABASE_URL_SESSION to ${SUPABASE_ENV_FILE} (chmod 600).`);
    return;
  }
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error("SUPABASE_ACCESS_TOKEN is not set (Supabase dashboard → Account → Access tokens).");
  if (!org) throw new Error("SUPABASE_ORG_ID (the organization slug) is not set.");

  const projects = await api<{ name: string; ref: string; organization_slug?: string }[]>(token, "GET", "/v1/projects");
  const clash = projects.find((p) => p.name === name && (!p.organization_slug || p.organization_slug === org));
  if (clash) throw new Error(`A project named "${name}" already exists (ref ${clash.ref}). Nothing created.`);

  const password = randomBytes(32).toString("base64url");
  const created = await api<{ ref: string; status: string; region: string }>(token, "POST", "/v1/projects", createProjectBody(name, org, password));
  upsertSecrets(
    { SUPABASE_PROJECT_REF: created.ref, SUPABASE_DB_PASSWORD: password, SUPABASE_REGION: REGION },
    SUPABASE_ENV_FILE,
  );
  console.log(`Created project ${created.ref} (${created.region}); password saved to ${SUPABASE_ENV_FILE}`);

  const deadline = Date.now() + 15 * 60_000;
  for (;;) {
    const project = await api<{ status: string }>(token, "GET", `/v1/projects/${created.ref}`);
    if (project.status === "ACTIVE_HEALTHY") break;
    if (/FAILED|REMOVED/.test(project.status)) throw new Error(`Project status ${project.status}`);
    if (Date.now() > deadline) throw new Error(`Still ${project.status} after 15 minutes – check the dashboard.`);
    console.log(`  status ${project.status} – waiting…`);
    await wait(15_000);
  }
  for (;;) {
    const services = await api<{ name: string; status: string }[]>(token, "GET", `/v1/projects/${created.ref}/health?services=db,pooler`);
    if (services.length > 0 && services.every((s) => s.status === "ACTIVE_HEALTHY")) break;
    if (Date.now() > deadline) throw new Error("db/pooler not healthy after 15 minutes – check the dashboard.");
    console.log(`  services ${services.map((s) => `${s.name}=${s.status}`).join(", ")} – waiting…`);
    await wait(10_000);
  }

  const poolers = await api<PoolerConfig[]>(token, "GET", `/v1/projects/${created.ref}/config/database/pooler`);
  const primary = poolers.find((p) => (p.database_type ?? "PRIMARY") === "PRIMARY") ?? poolers[0];
  if (!primary) throw new Error("No pooler configuration returned.");
  const transactionUrl = poolerUrl(primary, password, 6543);
  const sessionUrl = poolerUrl(primary, password, 5432);
  upsertSecrets({ DATABASE_URL: transactionUrl, DATABASE_URL_SESSION: sessionUrl }, SUPABASE_ENV_FILE);
  console.log("Project healthy. Pooler connection strings (password in the env file):");
  console.log(`  transaction (app, port 6543): ${scrubConnectionString(transactionUrl)}`);
  console.log(`  session (migrations, 5432):   ${scrubConnectionString(sessionUrl)}`);
  console.log("Next: CLINFORMS_DB=postgres DATABASE_URL=<session URL> npm run db:migrate   (see docs/database.md)");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
