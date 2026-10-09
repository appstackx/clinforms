/**
 * npm run demo:red – the RED Physiotherapy insurer-form demo on THIS machine, with no API key needed:
 * `next build`, then `next start` on PORT 3000, with these defaults:
 *
 *   MEDREPORT_DEMO_ASSETS_DIR=demo-assets/insurers   the local insurer forms, maps and answers (gitignored)
 *   MEDREPORT_AI_MODE=demo                           no live drafting; prepared maps and answers only
 *   MEDREPORT_DEMO_ASSETS_ALLOW_PROD=1               `next start` is a production build, where the demo
 *                                                    assets are off unless this is set – this run is local
 *   PORT=3000                                        the app calls its own simulated TM3 API on this port
 *
 * The environment is read the way Next reads it (@next/env loadEnvConfig: .env.production.local,
 * .env.local, .env.production, .env – the files `next start` loads), so a value set in .env.local (or in
 * the shell) wins over these defaults; an empty value counts as unset. E.g. MEDREPORT_AI_MODE=auto in
 * .env.local, with a key and a passcode, allows live drafting during the demo.
 *
 *   npm run demo:red                    # build and start
 *   npm run demo:red -- --skip-build    # start the last build again
 *
 * Never use it for a deployment: third-party insurer material must not be served from production.
 * Check the prepared files first with `npm run demo:check`.
 */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import nextEnv from "@next/env";

const require = createRequire(import.meta.url);
const cwd = process.cwd();

nextEnv.loadEnvConfig(cwd, false, { info: () => undefined, error: (...args) => console.error(...args) });

const DEFAULTS = {
  MEDREPORT_DEMO_ASSETS_DIR: "demo-assets/insurers",
  MEDREPORT_AI_MODE: "demo",
  MEDREPORT_DEMO_ASSETS_ALLOW_PROD: "1",
  PORT: "3000",
};
for (const [name, value] of Object.entries(DEFAULTS)) {
  if (!process.env[name] || process.env[name].trim() === "") process.env[name] = value;
}

const nextBin = require.resolve("next/dist/bin/next");
const port = process.env.PORT;

if (!process.argv.includes("--skip-build")) {
  const build = spawnSync(process.execPath, [nextBin, "build"], { cwd, stdio: "inherit", env: process.env });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

console.log(
  `\nClinForms demo (local only): http://localhost:${port}/reports · drafting mode ${process.env.MEDREPORT_AI_MODE} · demo assets from ${process.env.MEDREPORT_DEMO_ASSETS_DIR}\n`,
);
const server = spawn(process.execPath, [nextBin, "start", "-p", port], { cwd, stdio: "inherit", env: process.env });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
server.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
