/**
 * npm run demo:check – check the local demonstration assets (ai/demo-assets.ts) before a demo: every
 * prepared map against its form file, and every prepared answer file with the same checks the bundled
 * demo drafts get in CI (scripts/medreport/demo-draft-quality.test.ts). See ./demo-assets-check.ts.
 *
 *   npm run demo:check                      # MEDREPORT_DEMO_ASSETS_DIR (shell or .env.local), else demo-assets/insurers
 *   npm run demo:check -- --dir=<folder>    # another folder
 *
 * The default folder missing is fine (exit 0 with one line: a fresh clone has no demo assets – they
 * are never in git); a folder named by --dir or MEDREPORT_DEMO_ASSETS_DIR that does not exist is an
 * error (exit 1: e.g. a git worktree, where the relative path finds nothing – use an absolute path).
 * Exit 0 with a one-line summary when everything passes, 1 with one line per problem otherwise (a
 * folder of forms without a single prepared map is a problem). Reads .env.local the way Next does
 * (@next/env, resolved through next itself), without printing anything about it.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { checkDemoAssets } from "./demo-assets-check";

const DEFAULT_DIR = "demo-assets/insurers";

/** @next/env as next itself depends on it (it is not a direct dependency of this package). */
function loadEnvConfig(dir: string): void {
  const fromNext = createRequire(createRequire(path.join(dir, "package.json")).resolve("next/package.json"));
  const nextEnv = fromNext("@next/env") as typeof import("@next/env");
  nextEnv.loadEnvConfig(dir, false, { info: () => undefined, error: (...args: unknown[]) => console.error(...args) });
}

async function main(): Promise<number> {
  loadEnvConfig(process.cwd());
  const arg = process.argv.find((a) => a.startsWith("--dir="))?.slice("--dir=".length).trim();
  const configured = arg || process.env.MEDREPORT_DEMO_ASSETS_DIR?.trim() || "";
  const dir = configured || DEFAULT_DIR;
  const report = await checkDemoAssets(dir);
  if (!report.present) {
    if (!configured) {
      console.log(`No demo assets folder at ${report.dir} – nothing to check.`);
      return 0;
    }
    console.error(`problem: the demo assets folder ${report.dir} does not exist. Set MEDREPORT_DEMO_ASSETS_DIR (in .env.local) to the folder's absolute path – in a git worktree the relative path finds nothing.`);
    return 1;
  }
  for (const note of report.notes) console.log(`note: ${note}`);
  for (const problem of report.problems) console.error(`problem: ${problem}`);
  const summary = `${report.maps} map${report.maps === 1 ? "" : "s"}, ${report.drafts} answer file${report.drafts === 1 ? "" : "s"}, ${report.files} form file${report.files === 1 ? "" : "s"} in ${report.dir}`;
  if (report.problems.length > 0) {
    console.error(`Demo assets: ${report.problems.length} problem${report.problems.length === 1 ? "" : "s"} (${summary}).`);
    return 1;
  }
  console.log(`Demo assets OK: ${summary}.`);
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  },
);
