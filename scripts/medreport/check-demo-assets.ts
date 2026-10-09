/**
 * npm run demo:check – check the local demonstration assets (ai/demo-assets.ts) before a demo: every
 * prepared map against its form file, and every prepared answer file with the same checks the bundled
 * demo drafts get in CI (scripts/medreport/demo-draft-quality.test.ts). See ./demo-assets-check.ts.
 *
 *   npm run demo:check                      # MEDREPORT_DEMO_ASSETS_DIR (shell or .env.local), else demo-assets/insurers
 *   npm run demo:check -- --dir=<folder>    # another folder
 *
 * Exits 0 quietly when the folder does not exist (a fresh clone has no demo assets: they are never in
 * git), 0 with a one-line summary when everything passes, 1 with one line per problem otherwise.
 * Reads .env.local the way Next does (@next/env), without printing anything about it.
 */
import { loadEnvConfig } from "@next/env";
import { checkDemoAssets } from "./demo-assets-check";

const DEFAULT_DIR = "demo-assets/insurers";

async function main(): Promise<number> {
  loadEnvConfig(process.cwd(), false, { info: () => undefined, error: (...args: unknown[]) => console.error(...args) });
  const arg = process.argv.find((a) => a.startsWith("--dir="))?.slice("--dir=".length).trim();
  const dir = arg || process.env.MEDREPORT_DEMO_ASSETS_DIR?.trim() || DEFAULT_DIR;
  const report = await checkDemoAssets(dir);
  if (!report.present) return 0;
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
