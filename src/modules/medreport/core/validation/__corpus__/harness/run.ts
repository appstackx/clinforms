/**
 * Safety corpus: run everything – the hand-written cases, their generated mutations, the one-click variants and the
 * ledger items – and compare with pending.json.
 *
 * Result per id: ok, or failing. A failing id not in pending.json fails the corpus; a pending id that passes is
 * reported as "stale pending" (the integrator removes it; with `strictPending` it fails too). A retired id
 * (retired.json, harness/retired.ts) still runs and is reported, but counts neither as a failure nor as a hold; its
 * superseding cases must hold, and retired hand-written cases do not count for the ledger.
 */
import { parseCorpusFiles, type LoadedCase } from "./corpus";
import { CANDIDATE_ENGINE, type ValidatorEngine } from "./engine";
import { evaluateCase, evaluateOneClicks } from "./evaluate";
import { ledgerCountItems, ledgerSeamItems, loadSeamRegistry, unknownHookTags, type LedgerFile } from "./ledger";
import { generateMutations } from "./mutations";
import { checkRetired, EMPTY_RETIRED, retiredCaseIds, retiredIds, type RetiredFile } from "./retired";
import type { CasePath, CorpusCase, Owner, PendingFile, RunCase } from "./types";

export interface ResultRow {
  id: string;
  kind: "case" | "mutation" | "one-click" | "ledger";
  owner: Owner;
  group: string;
  ok: boolean;
  detail: string;
  parent?: string;
  /** Listed in retired.json: reported, never a failure or a hold. */
  retired?: boolean;
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
  /** Retired rows that ran (each still reported with what it saw). */
  retiredRows: ResultRow[];
  /** Retired generated rows (mutations, one-click variants) that no longer run – informational. */
  retiredNotRun: string[];
  /** A retirement whose superseding case does not hold (failing or pending). */
  retiredUncovered: string[];
  counts: { cases: number; mutations: number; oneClicks: number; ledger: number; pass: number; fail: number; pending: number; retired: number };
}

export interface RunOptions {
  files: ReadonlyArray<{ name: string; text: string }>;
  pending: PendingFile;
  ledger: LedgerFile;
  /** retired.json (default: none retired). */
  retired?: RetiredFile;
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
  const retired = opts.retired ?? EMPTY_RETIRED;
  const loadErrors = [...loaded.errors, ...unknownHookTags(opts.ledger, loaded.cases.map((l) => l.case)), ...(await checkRetired(retired, loaded.cases, opts.pending))];
  const keep = (id: string) => !opts.filter || opts.filter(id);
  const base: CorpusCase[] = loaded.cases.map((l: LoadedCase) => l.case);
  const retiredCases = retiredCaseIds(retired);
  const isRetired = retiredIds(retired);
  // A retired hand-written case counts for nothing in the ledger (must-block count, seam PASS cases).
  const active = base.filter((c) => !retiredCases.has(c.id));
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
    for (const item of ledgerCountItems(opts.ledger, active)) if (keep(item.id)) rows.push({ id: item.id, kind: "ledger", owner: item.owner, group: "LEDGER", ok: item.ok, detail: item.detail });
    const registry = await loadSeamRegistry();
    const seams = await ledgerSeamItems(opts.ledger, active, registry, async (c) => (await evaluateCase(c, { engine })).ok);
    for (const item of seams) if (keep(item.id)) rows.push({ id: item.id, kind: "ledger", owner: item.owner, group: "LEDGER", ok: item.ok, detail: item.detail });
  }
  for (const r of rows) if (isRetired.has(r.id)) r.retired = true;
  const pending = opts.pending.cases ?? {};
  const ran = new Map(rows.map((r) => [r.id, r]));
  const live = rows.filter((r) => !r.retired);
  const unexpectedFailures = live.filter((r) => !r.ok && !pending[r.id]);
  const stalePending = live.filter((r) => r.ok && pending[r.id]);
  // DIFF:<id> items belong to the differential gate (scripts/medreport/corpus-diff.test.ts).
  const unknownPending = Object.keys(pending).filter((id) => !id.startsWith("DIFF:") && !ran.has(id) && keep(id));
  const retiredNotRun = Object.entries(retired.entries ?? {})
    .filter(([id, e]) => e?.kind !== "case" && !ran.has(id) && keep(id))
    .map(([id]) => id);
  const retiredUncovered: string[] = [];
  for (const [id, e] of Object.entries(retired.entries ?? {})) {
    for (const s of e?.supersededBy ?? []) {
      const row = ran.get(s);
      if (!row) continue; // filtered out of this run (checkRetired refuses an id that does not exist)
      if (!row.ok) retiredUncovered.push(`retired ${id}: its superseding case ${s} does not hold${pending[s] ? " (pending)" : ""} – ${row.detail.slice(0, 200)}`);
      else if (pending[s]) retiredUncovered.push(`retired ${id}: its superseding case ${s} is pending`);
    }
  }
  return {
    rows,
    loadErrors,
    unexpectedFailures,
    stalePending,
    unknownPending,
    retiredRows: rows.filter((r) => r.retired),
    retiredNotRun,
    retiredUncovered,
    counts: {
      cases: live.filter((r) => r.kind === "case").length,
      mutations: live.filter((r) => r.kind === "mutation").length,
      oneClicks: live.filter((r) => r.kind === "one-click").length,
      ledger: live.filter((r) => r.kind === "ledger").length,
      pass: live.filter((r) => r.ok).length,
      fail: live.filter((r) => !r.ok).length,
      pending: live.filter((r) => !r.ok && pending[r.id]).length,
      retired: rows.length - live.length,
    },
  };
}
