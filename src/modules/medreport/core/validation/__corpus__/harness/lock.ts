/**
 * Safety corpus lock: sha256 over the canonical JSON of each case's locked part (types.ts lockedPartOf).
 *
 * The canonical form is the corpus's own (not core/fingerprint.ts, so a product refactor can never re-key the lock):
 * object keys sorted by code point, `undefined` members dropped, arrays kept in order. scripts/medreport/corpus-guard.mjs
 * and scripts/medreport/corpus-lock.mjs implement the same function in plain JavaScript; corpus-self.test.ts checks
 * that the two agree.
 *
 * Browser-safe and pure (WebCrypto).
 */
import { lockedPartOf } from "./types";

export function canonical(value: unknown): string {
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
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
    }
    default:
      throw new TypeError(`canonical: unsupported type ${typeof value}`);
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The lock hash of one case line (as written). */
export async function caseLockHash(raw: Record<string, unknown>): Promise<string> {
  return sha256Hex(canonical(lockedPartOf(raw)));
}

export interface LockFile {
  _about?: string;
  algorithm: string;
  entries: Record<string, string>;
}

export const LOCK_ALGORITHM = "sha256(canonical({id, input, expect: {expect, ack, blockBy, check, paths, negativeTwin, mutate}}))";

export interface LockProblem {
  id: string;
  problem: "missing" | "changed" | "orphan";
}

/** Every case has its lock entry with the right hash; no entry without a case. */
export async function checkLock(raws: ReadonlyArray<Record<string, unknown>>, lock: LockFile): Promise<LockProblem[]> {
  const out: LockProblem[] = [];
  const ids = new Set<string>();
  for (const raw of raws) {
    const id = String(raw.id);
    ids.add(id);
    const want = lock.entries[id];
    if (!want) out.push({ id, problem: "missing" });
    else if (want !== (await caseLockHash(raw))) out.push({ id, problem: "changed" });
  }
  for (const id of Object.keys(lock.entries)) if (!ids.has(id)) out.push({ id, problem: "orphan" });
  return out;
}
