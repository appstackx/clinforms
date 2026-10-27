/**
 * Safety corpus differential gate (W0.2): every input that BLOCKS on the production validators must still block on
 * this tree, unless allowlist.json records Khuram's approval for it.
 *
 *   node --import ./scripts/medreport/test-setup.mjs --import tsx scripts/medreport/corpus-diff.ts [options]
 *     --base <ref>       the production commit (default e132057 = main, what production runs)
 *     --base-dir <dir>   use an existing snapshot instead (a tree holding src/modules/medreport, e.g. the read-only
 *                        bh-quality/attr/basesnap copy) – the base ref is then not read from git
 *     --replay <dir>     also every recorded draft under <dir> (gitignored demo-assets/bh2-replay/: *.json, each
 *                        {report, form?}) – each box of each report is compared (see "Replay rows" below)
 *     --json <file>      write the comparison as JSON
 *
 * Inputs: every case and generated mutation whose paths include validate or reducer, built by this tree's harness
 * (the same report goes to both validator sets). "Blocks" = an unacknowledged blocking flag on the case's subject
 * (paragraph, box) – any code. The production snapshot is `git archive <base> src/modules/medreport` extracted into
 * node_modules/.cache/clinforms-corpus/<sha>/ (gitignored, reused). Fictional data only; prints case ids and codes.
 *
 * Replay rows (bh2 fix round 1, R1T-WA1-07 – a W0 tooling exception made by WA1): a recorded report is validated as its
 * approver would see it – the voice owner is Report.approver (else the author; a staff-prepared report has no author,
 * and reading it in strict mode raised voice flags its approver never sees) – and its blocking set is compared by code
 * and evidence ACROSS boxes:
 *   - a box that blocks on production still counts as blocked when the candidate blocks the same code with the same
 *     evidence on another box of the same report (a mail-merge code now raised on the box that replaces it);
 *   - a row that still differs is keyed to an approved allowlist entry when the difference IS that entry's approved
 *     behaviour: disabling the ledger hook the entry's case pins (its `hook:` tags, e.g. OPN-ok-f1 → statusRecorded) in
 *     the candidate brings the box's block back. No allowlist entry is added or widened by this – a row the approved
 *     hook does not explain stays a regression.
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
    const { reportFactsDate, withHookDisabled, HOOK_IDS } = await import("../../src/modules/medreport/core/validation");
    // R1T-WA1-07: the approved allowlist entries that name the ledger hook their behaviour comes from (the case's tags).
    const caseById = new Map(loaded.cases.map((l) => [l.case.id, l.case]));
    const classes = Object.keys(allow)
      .filter(approved)
      .map((entry) => ({ entry, hooks: (caseById.get(entry)?.tags ?? []).filter((t) => t.startsWith("hook:")).map((t) => t.slice(5)).filter((h) => HOOK_IDS.includes(h)) }))
      .filter((c) => c.hooks.length > 0);
    for (const f of fs.readdirSync(opts.replay).filter((x) => x.endsWith(".json")).sort()) {
      const rec = JSON.parse(fs.readFileSync(path.join(opts.replay, f), "utf8")) as { report: Report; form?: FormDefinition };
      const template = rec.form ? formToTemplate(rec.form) : getTemplate(rec.report.templateId);
      if (!template) continue;
      const computedFacts = computeFacts(rec.report.bundleSnapshot, { asOf: reportFactsDate(rec.report) });
      const owner = replayVoiceOwner(rec.report);
      const run = (engine: Engine) => engine.validate(rec.report, template, { computedFacts, form: rec.form ?? null, owner });
      const p = run(prod);
      const q = run(CANDIDATE_ENGINE);
      // The candidate with one approved class's hook disabled, worked out once per report and hook when a row needs it.
      const withoutHook = new Map<string, ReturnType<typeof run>>();
      const candidateWithout = async (hook: string) => {
        if (!withoutHook.has(hook)) withoutHook.set(hook, await withHookDisabled(hook, async () => run(CANDIDATE_ENGINE)));
        return withoutHook.get(hook) as ReturnType<typeof run>;
      };
      for (const s of rec.report.sections) {
        const id = `replay:${f}#${s.key}`;
        if (opts.filter && !opts.filter(id)) continue;
        const pb = p.blocking.filter((x) => x.sectionKey === s.key);
        const qb = q.blocking.filter((x) => x.sectionKey === s.key);
        // Compared by code and evidence across the report's boxes: the same block raised on another box still blocks.
        const movedTo = qb.length === 0 && pb.length > 0 ? movedBlocks(pb, q.blocking) : null;
        const regression = pb.length > 0 && qb.length === 0 && movedTo === null;
        let allowlisted = regression && approved(id);
        let keyedTo = "";
        if (regression && !allowlisted) {
          for (const c of classes) {
            for (const hook of c.hooks) {
              if ((await candidateWithout(hook)).blocking.some((x) => x.sectionKey === s.key)) {
                allowlisted = true;
                keyedTo = c.entry;
                break;
              }
            }
            if (allowlisted) break;
          }
        }
        const moved = movedTo ? ` (blocked on ${movedTo.join(", ")} with the same code and evidence)` : "";
        const keyed = keyedTo ? ` – the approved DIFF:${keyedTo} behaviour (its hook brings the block back)` : "";
        rows.push({ id, production: pb.length > 0, candidate: qb.length > 0 || movedTo !== null, regression, allowlisted, detail: `production: ${describeFlags(pb)} | candidate: ${describeFlags(qb)}${moved}${keyed}` });
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

/** Whose "I" a recorded report is read in (R1T-WA1-07): its approver, as the review and /sign read it; else its author. */
export function replayVoiceOwner(report: Pick<Report, "approver" | "author">): { name: string; hcpc: string } | null {
  const a = report.approver;
  if (a && a.name.trim()) return { name: a.name, hcpc: a.hcpc };
  return report.author ? { name: report.author.name, hcpc: report.author.hcpc } : null;
}

type Flag = import("../../src/modules/medreport/core/types").ReportFlag;

const evidenceOf = (f: Pick<Flag, "evidence">) => (f.evidence ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The boxes where the candidate blocks every one of `production`'s blocking flags with the same code and evidence
 * (R1T-WA1-07: a merge code raised on the box that replaces it), or null when one of them is blocked nowhere.
 */
export function movedBlocks(production: readonly Flag[], candidate: readonly Flag[]): string[] | null {
  const boxes = new Set<string>();
  for (const f of production) {
    const ev = evidenceOf(f);
    if (!ev) return null;
    const hit = candidate.find((x) => x.code === f.code && evidenceOf(x) === ev);
    if (!hit) return null;
    boxes.add(hit.sectionKey ?? "the report");
  }
  return Array.from(boxes).sort();
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
