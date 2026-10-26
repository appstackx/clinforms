/**
 * Safety corpus, for people: run every case and print one line per result (the test, safety-corpus.test.ts, runs the
 * same and asserts).
 *
 *   node --import ./scripts/medreport/test-setup.mjs --import tsx scripts/medreport/corpus-run.ts [options]
 *     --only <regex>       run the ids that match
 *     --failing            print failing results only
 *     --json <file>        write every result as JSON
 *     --suggest-pending    print a pending.json `cases` object for every failing id (the integrator reviews it; only
 *                          the integrator edits pending.json)
 *
 * Fictional data only; prints case ids, owners and what each path saw.
 */
import fs from "node:fs";
import path from "node:path";

process.env.MEDREPORT_AI_MODE = "demo";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
export const CORPUS_DIR = path.join(ROOT, "src/modules/medreport/core/validation/__corpus__");

export function readCorpusFiles(dir = CORPUS_DIR): Array<{ name: string; text: string }> {
  return fs
    .readdirSync(path.join(dir, "cases"))
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .map((f) => ({ name: `cases/${f}`, text: fs.readFileSync(path.join(dir, "cases", f), "utf8") }));
}

export function readJson<T>(name: string, dir = CORPUS_DIR): T {
  return JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as T;
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? "") : null;
}

async function main(): Promise<void> {
  const { runCorpus } = await import("../../src/modules/medreport/core/validation/__corpus__/harness/run");
  const only = arg("--only");
  const re = only ? new RegExp(only) : null;
  const report = await runCorpus({
    files: readCorpusFiles(),
    pending: readJson("pending.json"),
    ledger: readJson("ledger.json"),
    ...(re ? { filter: (id: string) => re.test(id) } : {}),
  });
  const pending = readJson<{ cases: Record<string, { owner: string }> }>("pending.json").cases;
  const failingOnly = process.argv.includes("--failing");
  for (const r of report.rows) {
    if (failingOnly && r.ok) continue;
    const mark = r.ok ? (pending[r.id] ? "STALE" : "ok   ") : pending[r.id] ? "pend " : "FAIL ";
    console.log(`${mark} ${r.id.padEnd(44)} [${r.owner}] ${r.detail}`);
  }
  const c = report.counts;
  console.log(`\n${c.cases} cases, ${c.mutations} mutations, ${c.oneClicks} one-click variants, ${c.ledger} ledger items: ${c.pass} hold, ${c.fail} fail (${c.pending} pending, ${report.unexpectedFailures.length} unexpected), ${report.stalePending.length} stale pending`);
  if (report.loadErrors.length) console.log(`load errors:\n${report.loadErrors.join("\n")}`);
  const json = arg("--json");
  if (json) fs.writeFileSync(json, JSON.stringify(report, null, 1));
  if (process.argv.includes("--suggest-pending")) {
    const out: Record<string, { owner: string; reason: string }> = {};
    for (const r of report.rows.filter((x) => !x.ok)) out[r.id] = { owner: r.owner, reason: r.detail.replace(/\s+/g, " ").slice(0, 300) };
    console.log(JSON.stringify(out, null, 1));
  }
}

if (process.argv[1] && /corpus-run\.ts$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
