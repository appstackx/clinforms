/**
 * Safety corpus: retired rows (retired.json, bh2-rc1 W0 decisions of 26/10/2026).
 *
 * The corpus is append-only, so a locked row that cannot hold as written – a case whose expectation contradicts an
 * approved design, a duplicate of another case with the opposite expectation, a generated mutation or one-click
 * variant that pins the wrong property – is never edited or deleted. It is RETIRED: listed in retired.json with the
 * reason, the decision (who decided, when) and the case(s) that supersede it. The line and its lock entry stay.
 *
 * What retirement means:
 * - the runner still runs a retired row and reports it, but its result counts neither as a failure nor as a hold;
 * - a retired hand-written case no longer counts for the ledger (must-block count, seam PASS cases) or as a PASS case's
 *   negativeTwin;
 * - every superseding case is a hand-written case that is not retired itself, and it must HOLD (not pending, not
 *   failing) – a retirement never lands without the corrected protection;
 * - a retired row is never pending;
 * - a retired id is never reused: the entry pins the lock hash of the retired case (kind "case") or of the case a
 *   generated row comes from (kinds "mutation" and "one-click"), so another case under that id – or a changed
 *   parent – is refused;
 * - retired.json is append-only: scripts/medreport/corpus-guard.mjs refuses a removed or changed entry and an entry
 *   without its decision record (corpus-lib.mjs checkRetiredFile is the same check in plain JavaScript).
 *
 * Pure.
 */
import type { LoadedCase } from "./corpus";
import { caseLockHash } from "./lock";
import type { PendingFile } from "./types";

export const RETIRED_KINDS = ["case", "mutation", "one-click"] as const;
export type RetiredKind = (typeof RETIRED_KINDS)[number];

export interface RetiredEntry {
  /** case = a hand-written case; mutation = a generated `<case>~<mutation>` row; one-click = a `<case>~fix-…` row. */
  kind: RetiredKind;
  /** kind "case": the lock hash of the retired case (its safety-corpus.lock.json entry). */
  lockHash?: string;
  /** kinds "mutation" and "one-click": the hand-written case the row is generated from, and its lock hash. */
  parent?: string;
  parentLockHash?: string;
  /** YYYY-MM-DD. */
  retiredOn: string;
  /** Who decided (and under whose authority). */
  decidedBy: string;
  decision: string;
  /** Why the row cannot hold as written. */
  reason: string;
  /** The hand-written case(s) that pin the intended property instead. */
  supersededBy: string[];
}

export interface RetiredFile {
  _about?: string;
  entries: Record<string, RetiredEntry>;
}

export const EMPTY_RETIRED: RetiredFile = { entries: {} };

/** The retired hand-written case ids. */
export function retiredCaseIds(retired: RetiredFile): Set<string> {
  return new Set(Object.entries(retired.entries ?? {}).filter(([, e]) => e?.kind === "case").map(([id]) => id));
}

/** Every retired row id (cases and generated rows). */
export function retiredIds(retired: RetiredFile): Set<string> {
  return new Set(Object.keys(retired.entries ?? {}));
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Problems with retired.json against the corpus as loaded (empty = ok). Needs the parsed cases (for ids, lock hashes,
 * negative twins) and pending.json.
 */
export async function checkRetired(retired: RetiredFile, cases: readonly LoadedCase[], pending: PendingFile): Promise<string[]> {
  const out: string[] = [];
  const entries = retired.entries ?? {};
  const byId = new Map(cases.map((c) => [c.case.id, c]));
  const retiredCases = retiredCaseIds(retired);
  for (const [id, e] of Object.entries(entries)) {
    const where = `retired ${id}`;
    if (!e || typeof e !== "object") {
      out.push(`${where}: not an entry`);
      continue;
    }
    if (!(RETIRED_KINDS as readonly string[]).includes(e.kind)) out.push(`${where}: kind must be one of ${RETIRED_KINDS.join(", ")}`);
    if (typeof e.retiredOn !== "string" || !DAY.test(e.retiredOn)) out.push(`${where}: retiredOn (YYYY-MM-DD)`);
    for (const k of ["decidedBy", "decision", "reason"] as const) {
      if (typeof e[k] !== "string" || e[k].trim().length < (k === "decidedBy" ? 3 : 20)) out.push(`${where}: needs ${k}`);
    }
    if (!Array.isArray(e.supersededBy) || e.supersededBy.length === 0) out.push(`${where}: needs supersededBy (at least one case)`);
    if (e.kind === "case") {
      const c = byId.get(id);
      if (id.includes("~")) out.push(`${where}: a generated id is kind "mutation" or "one-click"`);
      if (!c) out.push(`${where}: no such case – a retired case stays in the corpus (never removed)`);
      else if (!e.lockHash || e.lockHash !== (await caseLockHash(c.raw))) {
        out.push(`${where}: the case with this id is not the one retired (lock hash differs) – a retired id is never reused`);
      }
    } else if (e.kind === "mutation" || e.kind === "one-click") {
      const cut = id.indexOf("~");
      const parent = cut > 0 ? id.slice(0, cut) : "";
      const suffix = cut > 0 ? id.slice(cut + 1) : "";
      if (!parent) out.push(`${where}: a ${e.kind} id is <case>~<variant>`);
      else if (e.parent !== parent) out.push(`${where}: parent must be ${parent}`);
      if (e.kind === "one-click" && !suffix.startsWith("fix-")) out.push(`${where}: a one-click id is <case>~fix-<kind>-<n>`);
      if (e.kind === "mutation" && suffix.startsWith("fix-")) out.push(`${where}: <case>~fix-… is a one-click variant`);
      const p = parent ? byId.get(parent) : undefined;
      if (parent && !p) out.push(`${where}: its case ${parent} does not exist`);
      else if (p && (!e.parentLockHash || e.parentLockHash !== (await caseLockHash(p.raw)))) {
        out.push(`${where}: its case ${parent} is not the one the row was retired from (lock hash differs) – a retired id is never reused`);
      }
    }
    for (const s of Array.isArray(e.supersededBy) ? e.supersededBy : []) {
      if (s === id || s === e.parent) out.push(`${where}: cannot be superseded by ${s} itself`);
      else if (!byId.has(s)) out.push(`${where}: superseding case ${s} does not exist`);
      else if (retiredCases.has(s)) out.push(`${where}: superseding case ${s} is retired itself`);
      if (String(s).includes("~")) out.push(`${where}: superseding ${s} must be a hand-written case`);
    }
    if (pending.cases?.[id]) out.push(`${where} is also in pending.json – a retired row is never pending`);
  }
  for (const c of cases) {
    if (c.case.negativeTwin && retiredCases.has(c.case.negativeTwin)) out.push(`${c.case.id}: its negativeTwin ${c.case.negativeTwin} is retired – name its superseding case`);
  }
  return out;
}
