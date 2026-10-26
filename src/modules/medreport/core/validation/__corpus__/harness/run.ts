/**
 * Safety corpus: run everything – the hand-written cases, their generated mutations, the one-click variants and the
 * ledger items – and compare with pending.json.
 *
 * Result per id: ok, or failing. A failing id not in pending.json fails the corpus; a pending id that passes is
 * reported as "stale pending" (the integrator removes it; with `strictPending` it fails too).
 */
import { parseCorpusFiles, type LoadedCase } from "./corpus";
import { CANDIDATE_ENGINE, type ValidatorEngine } from "./engine";
import { evaluateCase, evaluateOneClicks } from "./evaluate";
import { ledgerCountItems, ledgerSeamItems, loadSeamRegistry, unknownHookTags, type LedgerFile } from "./ledger";
import { generateMutations } from "./mutations";
import type { CasePath, CorpusCase, Owner, PendingFile, RunCase } from "./types";

export interface ResultRow {
  id: string;
  kind: "case" | "mutation" | "one-click" | "ledger";
  owner: Owner;
  group: string;
  ok: boolean;
  detail: string;
  parent?: string;
}

export interface RunReport {
  rows: ResultRow[];
  loadErrors: string[];
  /** Failing and not pending. */
  unexpectedFailures: ResultRow[];
  /** Pending and passing. */
  stalePending: ResultRow[];
  /** Pending ids that name nothing that ran. */
  unknownPending: string[];
  counts: { cases: number; mutations: number; oneClicks: number; ledger: number; pass: number; fail: number; pending: number };
}

export interface RunOptions {
  files: ReadonlyArray<{ name: string; text: string }>;
  pending: PendingFile;
  ledger: LedgerFile;
  engine?: ValidatorEngine;
  onlyPaths?: readonly CasePath[];
  /** Skip the one-click variants (corpus-diff). */
  oneClicks?: boolean;
  /** Skip the ledger (corpus-diff). */
  ledgerItems?: boolean;
  filter?: (id: string) => boolean;
}

async function runCases(cases: readonly RunCase[], engine: ValidatorEngine, onlyPaths?: readonly CasePath[]) {
  const rows: ResultRow[] = [];
  for (const c of cases) {
    const out = await evaluateCase(c, { engine, ...(onlyPaths ? { onlyPaths } : {}) });
    if (out.paths.length === 0) continue;
    rows.push({
      id: c.id,
      kind: c.parent ? "mutation" : "case",
      owner: c.owner,
      group: c.group,
      ok: out.ok,
      detail: out.paths.map((p) => `${p.ok ? "ok" : "FAIL"} ${p.path}: ${p.detail}`).join(" || "),
      ...(c.parent ? { parent: c.parent } : {}),
    });
  }
  return rows;
}

export async function runCorpus(opts: RunOptions): Promise<RunReport> {
  const engine = opts.engine ?? CANDIDATE_ENGINE;
  const loaded = parseCorpusFiles(opts.files);
  const loadErrors = [...loaded.errors, ...unknownHookTags(opts.ledger, loaded.cases.map((l) => l.case))];
  const keep = (id: string) => !opts.filter || opts.filter(id);
  const base: CorpusCase[] = loaded.cases.map((l: LoadedCase) => l.case);
  const mutations = generateMutations(base);
  const rows: ResultRow[] = [];
  rows.push(...(await runCases(base.filter((c) => keep(c.id)), engine, opts.onlyPaths)));
  rows.push(...(await runCases(mutations.filter((c) => keep(c.id)), engine, opts.onlyPaths)));
  if (opts.oneClicks !== false) {
    for (const c of base) {
      if (!c.paths.includes("validate") || c.expect === "NOT_OFFERED" || c.mutate?.oneClick === false) continue;
      for (const r of await evaluateOneClicks(c, engine)) {
        if (!keep(r.id)) continue;
        rows.push({ id: r.id, kind: "one-click", owner: c.owner, group: c.group, ok: r.ok, detail: r.detail, parent: c.id });
      }
    }
  }
  if (opts.ledgerItems !== false) {
    for (const item of ledgerCountItems(opts.ledger, base)) if (keep(item.id)) rows.push({ id: item.id, kind: "ledger", owner: item.owner, group: "LEDGER", ok: item.ok, detail: item.detail });
    const registry = await loadSeamRegistry();
    const seams = await ledgerSeamItems(opts.ledger, base, registry, async (c) => (await evaluateCase(c, { engine })).ok);
    for (const item of seams) if (keep(item.id)) rows.push({ id: item.id, kind: "ledger", owner: item.owner, group: "LEDGER", ok: item.ok, detail: item.detail });
  }
  const pending = opts.pending.cases ?? {};
  const ran = new Set(rows.map((r) => r.id));
  const unexpectedFailures = rows.filter((r) => !r.ok && !pending[r.id]);
  const stalePending = rows.filter((r) => r.ok && pending[r.id]);
  // DIFF:<id> items belong to the differential gate (scripts/medreport/corpus-diff.test.ts).
  const unknownPending = Object.keys(pending).filter((id) => !id.startsWith("DIFF:") && !ran.has(id) && keep(id));
  return {
    rows,
    loadErrors,
    unexpectedFailures,
    stalePending,
    unknownPending,
    counts: {
      cases: rows.filter((r) => r.kind === "case").length,
      mutations: rows.filter((r) => r.kind === "mutation").length,
      oneClicks: rows.filter((r) => r.kind === "one-click").length,
      ledger: rows.filter((r) => r.kind === "ledger").length,
      pass: rows.filter((r) => r.ok).length,
      fail: rows.filter((r) => !r.ok).length,
      pending: rows.filter((r) => !r.ok && pending[r.id]).length,
    },
  };
}
