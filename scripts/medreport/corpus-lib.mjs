/**
 * Safety corpus (W0.2) – shared plain-JavaScript helpers for corpus-lock.mjs and corpus-guard.mjs.
 *
 * canonical() and caseLockHash() are the same functions as src/modules/medreport/core/validation/__corpus__/harness/
 * lock.ts (corpus-self.test.ts checks that both give the same hash for every case). checkRetiredFile() is the same
 * check as harness/retired.ts checkRetired (retired.json: retired rows, their decision record and superseding cases).
 */
import { createHash } from "node:crypto";

export const CORPUS_DIR = "src/modules/medreport/core/validation/__corpus__";
export const LOCK_FILE = `${CORPUS_DIR}/safety-corpus.lock.json`;
export const PENDING_FILE = `${CORPUS_DIR}/pending.json`;
export const CASES_DIR = `${CORPUS_DIR}/cases`;
export const RETIRED_FILE = `${CORPUS_DIR}/retired.json`;
export const LOCK_ALGORITHM = "sha256(canonical({id, input, expect: {expect, ack, blockBy, check, paths, negativeTwin, mutate}}))";

export function canonical(value) {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("canonical: non-finite number");
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonical(v))).join(",")}]`;
      const keys = Object.keys(value)
        .filter((k) => value[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
    }
    default:
      throw new TypeError(`canonical: unsupported type ${typeof value}`);
  }
}

export function lockedPartOf(raw) {
  return {
    id: raw.id,
    input: raw.input,
    expect: {
      expect: raw.expect,
      ack: raw.ack,
      blockBy: raw.blockBy,
      check: raw.check,
      paths: raw.paths,
      negativeTwin: raw.negativeTwin,
      mutate: raw.mutate,
    },
  };
}

export function caseLockHash(raw) {
  return createHash("sha256").update(canonical(lockedPartOf(raw)), "utf8").digest("hex");
}

/** Parse the JSONL texts of cases/*.jsonl ({name, text}[]) into {id → raw case}; throws on a bad line or duplicate. */
export function parseCases(files) {
  const out = new Map();
  for (const f of files) {
    f.text.split("\n").forEach((line, i) => {
      const t = line.trim();
      if (!t || t.startsWith("//")) return;
      let raw;
      try {
        raw = JSON.parse(t);
      } catch (e) {
        throw new Error(`${f.name}:${i + 1}: not JSON (${e.message})`);
      }
      if (typeof raw.id !== "string") throw new Error(`${f.name}:${i + 1}: no id`);
      if (out.has(raw.id)) throw new Error(`${f.name}:${i + 1}: duplicate id ${raw.id}`);
      out.set(raw.id, raw);
    });
  }
  return out;
}

const RETIRED_KINDS = ["case", "mutation", "one-click"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Problems with retired.json ({entries}) against the cases ({id → raw case}) and pending.json's `cases` (empty = ok):
 * every entry has its decision record (retiredOn, decidedBy, decision, reason) and at least one superseding case; it
 * pins what it retires (kind "case": that case's lock hash; "mutation" / "one-click": the parent case's lock hash), so
 * a retired id is never reused; superseding cases exist, are hand-written and not retired; a retired row is never
 * pending; no PASS case keeps a retired case as its negativeTwin.
 */
export function checkRetiredFile(retired, cases, pending) {
  const out = [];
  const entries = retired?.entries ?? {};
  const retiredCases = new Set(Object.entries(entries).filter(([, e]) => e?.kind === "case").map(([id]) => id));
  for (const [id, e] of Object.entries(entries)) {
    const where = `retired ${id}`;
    if (!e || typeof e !== "object") {
      out.push(`${where}: not an entry`);
      continue;
    }
    if (!RETIRED_KINDS.includes(e.kind)) out.push(`${where}: kind must be one of ${RETIRED_KINDS.join(", ")}`);
    if (typeof e.retiredOn !== "string" || !DAY.test(e.retiredOn)) out.push(`${where}: retiredOn (YYYY-MM-DD)`);
    for (const k of ["decidedBy", "decision", "reason"]) {
      if (typeof e[k] !== "string" || e[k].trim().length < (k === "decidedBy" ? 3 : 20)) out.push(`${where}: needs ${k}`);
    }
    if (!Array.isArray(e.supersededBy) || e.supersededBy.length === 0) out.push(`${where}: needs supersededBy (at least one case)`);
    if (e.kind === "case") {
      const raw = cases.get(id);
      if (id.includes("~")) out.push(`${where}: a generated id is kind "mutation" or "one-click"`);
      if (!raw) out.push(`${where}: no such case – a retired case stays in the corpus (never removed)`);
      else if (!e.lockHash || e.lockHash !== caseLockHash(raw)) out.push(`${where}: the case with this id is not the one retired (lock hash differs) – a retired id is never reused`);
    } else if (e.kind === "mutation" || e.kind === "one-click") {
      const cut = id.indexOf("~");
      const parent = cut > 0 ? id.slice(0, cut) : "";
      const suffix = cut > 0 ? id.slice(cut + 1) : "";
      if (!parent) out.push(`${where}: a ${e.kind} id is <case>~<variant>`);
      else if (e.parent !== parent) out.push(`${where}: parent must be ${parent}`);
      if (e.kind === "one-click" && !suffix.startsWith("fix-")) out.push(`${where}: a one-click id is <case>~fix-<kind>-<n>`);
      if (e.kind === "mutation" && suffix.startsWith("fix-")) out.push(`${where}: <case>~fix-… is a one-click variant`);
      const raw = parent ? cases.get(parent) : undefined;
      if (parent && !raw) out.push(`${where}: its case ${parent} does not exist`);
      else if (raw && (!e.parentLockHash || e.parentLockHash !== caseLockHash(raw))) out.push(`${where}: its case ${parent} is not the one the row was retired from (lock hash differs) – a retired id is never reused`);
    }
    for (const s of Array.isArray(e.supersededBy) ? e.supersededBy : []) {
      if (s === id || s === e.parent) out.push(`${where}: cannot be superseded by ${s} itself`);
      else if (!cases.has(s)) out.push(`${where}: superseding case ${s} does not exist`);
      else if (retiredCases.has(s)) out.push(`${where}: superseding case ${s} is retired itself`);
      if (String(s).includes("~")) out.push(`${where}: superseding ${s} must be a hand-written case`);
    }
    if (pending?.[id]) out.push(`${where} is also in pending.json – a retired row is never pending`);
  }
  for (const [id, raw] of cases) {
    if (raw.negativeTwin && retiredCases.has(raw.negativeTwin)) out.push(`${id}: its negativeTwin ${raw.negativeTwin} is retired – name its superseding case`);
  }
  return out;
}
