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
 * the shell) wins over these defaults; an empty value counts as unset – EXCEPT MEDREPORT_AI_MODE, which
 * is always "demo" unless --live is given. A .env.local made for live work (MEDREPORT_AI_MODE=auto with a
 * key and a passcode) would otherwise turn the demo live: the Studio shows a passcode field, and once the
 * passcode is typed an upload is analysed live instead of getting its checked prepared map, and drafts
 * are live (longer than the prepared answers – they overflow the insurer forms' boxes). With --live the
 * .env.local / shell value is used (e.g. auto: live drafting once the passcode is typed in the Studio).
 *
 *   npm run demo:red                    # build and start (demo mode)
 *   npm run demo:red -- --skip-build    # start the last build again
 *   npm run demo:red -- --live          # let .env.local's MEDREPORT_AI_MODE (e.g. auto) allow live calls
 *   npm run demo:red -- --allow-no-maps # start although no map is prepared (layout rules only)
 *
 * It refuses to start when the demo-assets folder does not exist (no demonstration footer, no prepared
 * maps – e.g. in a git worktree, where the relative default finds nothing: set the absolute path in
 * .env.local) or holds no prepared map (maps/*.json), unless --allow-no-maps is given.
 *
 * Never use it for a deployment: third-party insurer material must not be served from production.
 * Check the prepared files first with `npm run demo:check`.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
// @next/env as next itself depends on it (it is not a direct dependency of this package).
const nextEnv = createRequire(require.resolve("next/package.json"))("@next/env");
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
// Demo mode unless asked otherwise: a live-ready .env.local must not change what the prepared demo shows.
if (!process.argv.includes("--live")) process.env.MEDREPORT_AI_MODE = "demo";

const assetsDir = path.resolve(cwd, process.env.MEDREPORT_DEMO_ASSETS_DIR);
const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
if (!isDir(assetsDir)) {
  console.error(
    `\nThe demo assets folder ${assetsDir} does not exist, so uploaded insurer forms would get no demonstration footer and no prepared map.\n` +
      "Set MEDREPORT_DEMO_ASSETS_DIR in .env.local to the folder's absolute path (in a git worktree the relative default finds nothing).\n",
  );
  process.exit(1);
}
const forms = readdirSync(assetsDir).filter((n) => /\.(pdf|docx)$/i.test(n));
const maps = isDir(path.join(assetsDir, "maps")) ? readdirSync(path.join(assetsDir, "maps")).filter((n) => n.endsWith(".json")) : [];
if (forms.length === 0 || (maps.length === 0 && !process.argv.includes("--allow-no-maps"))) {
  console.error(
    `\nThe demo assets folder ${assetsDir} holds ${forms.length} form file${forms.length === 1 ? "" : "s"} and ${maps.length} prepared map${maps.length === 1 ? "" : "s"}.\n` +
      (forms.length === 0
        ? "Put the insurer forms (PDF / Word) in it first.\n"
        : "Without maps every upload is mapped by layout rules only. Add maps/<sampleId>.json (npm run demo:check), or run with --allow-no-maps.\n"),
  );
  process.exit(1);
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
