/**
 * Safety corpus differential gate (W0.2): every input that BLOCKS on the production validators must still block on
 * this tree, unless allowlist.json records Khuram's approval for it.
 *
 *   node --import ./scripts/medreport/test-setup.mjs --import tsx scripts/medreport/corpus-diff.ts [options]
 *     --base <ref>       the production commit (default e132057 = main, what production runs)
 *     --base-dir <dir>   use an existing snapshot instead (a tree holding src/modules/medreport, e.g. the read-only
 *                        bh-quality/attr/basesnap copy) – the base ref is then not read from git
 *     --replay <dir>     also every recorded draft under <dir> (gitignored demo-assets/bh2-replay/: *.json, each
 *                        {report, form?}) – each box of each report is compared
 *     --json <file>      write the comparison as JSON
 *
 * Inputs: every case and generated mutation whose paths include validate or reducer, built by this tree's harness
 * (the same report goes to both validator sets). "Blocks" = an unacknowledged blocking flag on the case's subject
 * (paragraph, box) – any code. The production snapshot is `git archive <base> src/modules/medreport` extracted into
 * node_modules/.cache/clinforms-corpus/<sha>/ (gitignored, reused). Fictional data only; prints case ids and codes.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

process.env.MEDREPORT_AI_MODE = "demo";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const CORPUS = path.join(ROOT, "src/modules/medreport/core/validation/__corpus__");

type Engine = import("../../src/modules/medreport/core/validation/__corpus__/harness/engine").ValidatorEngine;
type Report = import("../../src/modules/medreport/core/types").Report;
type FormDefinition = import("../../src/modules/medreport/core/types").FormDefinition;

export interface DiffRow {
  id: string;
  production: boolean;
  candidate: boolean;
  /** Blocks on production, not on the candidate. */
  regression: boolean;
  allowlisted: boolean;
  detail: string;
}

export interface DiffReport {
  base: string;
  rows: DiffRow[];
  regressions: DiffRow[];
  /** Blocks on the candidate only (stricter – informational). */
  stricter: number;
  inputs: number;
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

/** The production snapshot's root (a tree with src/modules/medreport), extracted once per commit. */
export function snapshotDir(base: string): string {
  const sha = git(["rev-parse", "--verify", `${base}^{commit}`]).trim();
  const dir = path.join(ROOT, "node_modules/.cache/clinforms-corpus", sha);
  if (fs.existsSync(path.join(dir, "src/modules/medreport/core/validation/index.ts"))) return dir;
  fs.mkdirSync(dir, { recursive: true });
  const tar = execFileSync("git", ["archive", "--format=tar", sha, "src/modules/medreport"], { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 });
  execFileSync("tar", ["-x", "-C", dir], { input: tar });
  return dir;
}

export async function productionEngine(dir: string): Promise<Engine> {
  const { engineFrom } = await import("../../src/modules/medreport/core/validation/__corpus__/harness/engine");
  const mod = (await import(path.join(dir, "src/modules/medreport/core/validation/index.ts"))) as { validateReport: unknown; canAcknowledge: unknown; canSign: unknown };
  return engineFrom("production", mod);
}

function corpusFiles(): Array<{ name: string; text: string }> {
  return fs
    .readdirSync(path.join(CORPUS, "cases"))
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .map((f) => ({ name: `cases/${f}`, text: fs.readFileSync(path.join(CORPUS, "cases", f), "utf8") }));
}

export async function runDiff(opts: { base?: string; baseDir?: string; replay?: string; filter?: (id: string) => boolean } = {}): Promise<DiffReport> {
  const base = opts.base ?? "e132057";
  const dir = opts.baseDir ?? snapshotDir(base);
  const prod = await productionEngine(dir);
  const { CANDIDATE_ENGINE } = await import("../../src/modules/medreport/core/validation/__corpus__/harness/engine");
  const { parseCorpusFiles } = await import("../../src/modules/medreport/core/validation/__corpus__/harness/corpus");
  const { generateMutations } = await import("../../src/modules/medreport/core/validation/__corpus__/harness/mutations");
  const { buildCase } = await import("../../src/modules/medreport/core/validation/__corpus__/harness/build");
  const { runSteps } = await import("../../src/modules/medreport/core/validation/__corpus__/harness/reducer");
  const { validateBuilt } = await import("../../src/modules/medreport/core/validation/__corpus__/harness/evaluate");
  const { onSubject, describeFlags } = await import("../../src/modules/medreport/core/validation/__corpus__/harness/judge");
  const allow = (JSON.parse(fs.readFileSync(path.join(CORPUS, "allowlist.json"), "utf8")) as { entries: Record<string, { approvedBy?: string; approvedOn?: string; decision?: string }> }).entries ?? {};
  const approved = (id: string) => {
    const e = allow[id];
    return Boolean(e && e.approvedBy === "Khuram" && e.approvedOn && e.decision);
  };
  const loaded = parseCorpusFiles(corpusFiles());
  const cases = [...loaded.cases.map((l) => l.case), ...generateMutations(loaded.cases.map((l) => l.case))].filter((c) => c.paths.includes("validate") || c.paths.includes("reducer"));
  const rows: DiffRow[] = [];
  for (const c of cases) {
    if (opts.filter && !opts.filter(c.id)) continue;
    const built = await buildCase(c.input);
    let report: Report = built.report;
    let subject = { box: built.box, paragraphId: built.paragraphId };
    if (!c.paths.includes("validate") && c.input.steps?.length) {
      const steps = await runSteps(built, c.input.steps, CANDIDATE_ENGINE);
      report = steps.report;
      subject = { box: built.box, paragraphId: null };
    }
    const p = validateBuilt(built, prod, report);
    const q = validateBuilt(built, CANDIDATE_ENGINE, report);
    const pb = p.blocking.filter((f) => onSubject(f, subject));
    const qb = q.blocking.filter((f) => onSubject(f, subject));
    const regression = pb.length > 0 && qb.length === 0;
    rows.push({ id: c.id, production: pb.length > 0, candidate: qb.length > 0, regression, allowlisted: regression && approved(c.id), detail: `production: ${describeFlags(pb)} | candidate: ${describeFlags(qb)}` });
  }
  if (opts.replay && fs.existsSync(opts.replay)) {
    const { formToTemplate } = await import("../../src/modules/medreport/core/forms");
    const { getTemplate } = await import("../../src/modules/medreport/templates/registry");
    const { computeFacts } = await import("../../src/modules/medreport/core/computed-facts");
    const { reportFactsDate } = await import("../../src/modules/medreport/core/validation");
    for (const f of fs.readdirSync(opts.replay).filter((x) => x.endsWith(".json")).sort()) {
      const rec = JSON.parse(fs.readFileSync(path.join(opts.replay, f), "utf8")) as { report: Report; form?: FormDefinition };
      const template = rec.form ? formToTemplate(rec.form) : getTemplate(rec.report.templateId);
      if (!template) continue;
      const computedFacts = computeFacts(rec.report.bundleSnapshot, { asOf: reportFactsDate(rec.report) });
      const owner = rec.report.author ? { name: rec.report.author.name, hcpc: rec.report.author.hcpc } : null;
      const p = prod.validate(rec.report, template, { computedFacts, form: rec.form ?? null, owner });
      const q = CANDIDATE_ENGINE.validate(rec.report, template, { computedFacts, form: rec.form ?? null, owner });
      for (const s of rec.report.sections) {
        const id = `replay:${f}#${s.key}`;
        if (opts.filter && !opts.filter(id)) continue;
        const pb = p.blocking.filter((x) => x.sectionKey === s.key);
        const qb = q.blocking.filter((x) => x.sectionKey === s.key);
        const regression = pb.length > 0 && qb.length === 0;
        rows.push({ id, production: pb.length > 0, candidate: qb.length > 0, regression, allowlisted: regression && approved(id), detail: `production: ${describeFlags(pb)} | candidate: ${describeFlags(qb)}` });
      }
    }
  }
  return {
    base: opts.baseDir ? `dir:${opts.baseDir}` : base,
    rows,
    regressions: rows.filter((r) => r.regression && !r.allowlisted),
    stricter: rows.filter((r) => r.candidate && !r.production).length,
    inputs: rows.length,
  };
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main(): Promise<void> {
  const report = await runDiff({ base: arg("--base") ?? undefined, baseDir: arg("--base-dir") ?? undefined, replay: arg("--replay") ?? undefined });
  for (const r of report.rows.filter((x) => x.regression)) console.log(`${r.allowlisted ? "allowed   " : "REGRESSION"} ${r.id} – ${r.detail}`);
  console.log(`\ndifferential against ${report.base}: ${report.inputs} inputs; ${report.rows.filter((r) => r.production).length} block on production; ${report.regressions.length} regression(s) not allowlisted; ${report.stricter} stricter on the candidate`);
  const json = arg("--json");
  if (json) fs.writeFileSync(json, JSON.stringify(report, null, 1));
  if (report.regressions.length) process.exit(1);
}

if (process.argv[1] && /corpus-diff\.ts$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
