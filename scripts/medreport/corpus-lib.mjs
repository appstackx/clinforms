/**
 * Safety corpus (W0.2) – shared plain-JavaScript helpers for corpus-lock.mjs and corpus-guard.mjs.
 *
 * canonical() and caseLockHash() are the same functions as src/modules/medreport/core/validation/__corpus__/harness/
 * lock.ts (corpus-self.test.ts checks that both give the same hash for every case).
 */
import { createHash } from "node:crypto";

export const CORPUS_DIR = "src/modules/medreport/core/validation/__corpus__";
export const LOCK_FILE = `${CORPUS_DIR}/safety-corpus.lock.json`;
export const PENDING_FILE = `${CORPUS_DIR}/pending.json`;
export const CASES_DIR = `${CORPUS_DIR}/cases`;
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
