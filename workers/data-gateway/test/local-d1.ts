/**
 * Real local D1 (workerd) for the integration tests: wrangler applies the migrations exactly as it does for
 * the remote databases, getPlatformProxy() gives the D1 binding, and the gateway handler runs against it.
 * `available` is false when the Worker's dependencies are not installed (`npm ci` in workers/data-gateway).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { Kysely } from "kysely";
import { D1HttpDialect } from "../../../src/server/db/dialects/d1-http";
import type { Database } from "../../../src/server/db/schema";
import type { D1DatabaseLike } from "../src/d1";
import { handleRequest } from "../src/index";

export const WORKER_DIR = path.resolve("workers/data-gateway");
const WRANGLER_BIN = path.join(WORKER_DIR, "node_modules", ".bin", "wrangler");
export const available = fs.existsSync(WRANGLER_BIN);
export const SECRET = "local-d1-secret-".padEnd(48, "q");

export interface Proxy {
  env: { DB: D1DatabaseLike };
  dispose: () => Promise<void>;
}

export async function startLocalD1(): Promise<{ proxy: Proxy; dir: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clinforms-d1-"));
  execFileSync(WRANGLER_BIN, ["d1", "migrations", "apply", "clinforms-preview", "--local", "--env", "preview", "--persist-to", dir], {
    cwd: WORKER_DIR,
    env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false", CLOUDFLARE_ACCOUNT_ID: "a04ab546d0f1be2aa339bafebcdb3ffa" },
    stdio: "pipe",
  });
  const require = createRequire(path.join(WORKER_DIR, "package.json"));
  const wrangler = (await import(require.resolve("wrangler"))) as {
    getPlatformProxy: (opts: unknown) => Promise<Proxy>;
  };
  const proxy = await wrangler.getPlatformProxy({
    configPath: path.join(WORKER_DIR, "wrangler.jsonc"),
    environment: "preview",
    // wrangler's --persist-to <dir> keeps state in <dir>/v3; getPlatformProxy takes that v3 folder.
    persist: { path: path.join(dir, "v3") },
    remoteBindings: false,
  });
  return { proxy, dir };
}

export function gatewayDb(DB: D1DatabaseLike): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new D1HttpDialect({
      url: "https://gateway.test",
      secret: SECRET,
      fetch: (url, init) => handleRequest(new Request(url, init), { DB, GATEWAY_SECRET: SECRET }),
    }),
  });
}

