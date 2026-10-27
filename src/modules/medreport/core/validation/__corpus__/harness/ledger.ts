/**
 * Safety corpus: the ledger. Every allow hook, exemption, pre-strip, threshold, acknowledgement rule and one-click
 * generator is registered in ledger.json and must have
 * (a) at least 5 hand-written must-block cases tagged `hook:<id>` (expect BLOCK, NOT_OFFERED or REFUSED_*), and
 * (b) a test seam: with the hook disabled through core/validation/registry.ts `withHookDisabled(id, fn)`, at least
 *     one of its tagged PASS cases must turn red – proof the hook is load-bearing and the PASS cases exercise it.
 * Each requirement is a ledger item (`LEDGER-<id>-count`, `LEDGER-<id>-seam`) that can be pending like a case.
 *
 * Seam contract for registry.ts (W0.6; each hook's owner wires its hook): export
 *   HOOK_IDS: readonly string[]
 *   withHookDisabled<T>(id: string, fn: () => Promise<T>): Promise<T>
 *
 * Pure apart from the registry import (dynamic, so a tree without it still loads).
 */
import type { CorpusCase, Owner } from "./types";

export interface LedgerHook {
  id: string;
  kind: "allow" | "exemption" | "prestrip" | "threshold" | "ack" | "one-click";
  where: string;
  owner: Owner;
  /** Who adds its seam (default: the owner). */
  seamOwner?: Owner;
  note: string;
}

export interface LedgerFile {
  _about?: string;
  minBlock: number;
  hooks: LedgerHook[];
}

const MUST_BLOCK = new Set(["BLOCK", "NOT_OFFERED", "REFUSED_403", "REFUSED_409"]);

export interface LedgerItem {
  id: string;
  hook: string;
  owner: Owner;
  ok: boolean;
  detail: string;
}

export function ledgerCountItems(ledger: LedgerFile, cases: readonly CorpusCase[]): LedgerItem[] {
  return ledger.hooks.map((h) => {
    const tagged = cases.filter((c) => c.tags.includes(`hook:${h.id}`));
    const block = tagged.filter((c) => MUST_BLOCK.has(c.expect));
    const pass = tagged.filter((c) => c.expect === "PASS");
    return {
      id: `LEDGER-${h.id}-count`,
      hook: h.id,
      owner: h.owner,
      ok: block.length >= ledger.minBlock,
      detail: `${block.length} must-block and ${pass.length} must-pass cases tagged hook:${h.id} (need ${ledger.minBlock} must-block)`,
    };
  });
}

/** Unknown tags: every `hook:<id>` tag must name a registered hook. */
export function unknownHookTags(ledger: LedgerFile, cases: readonly CorpusCase[]): string[] {
  const ids = new Set(ledger.hooks.map((h) => h.id));
  const out: string[] = [];
  for (const c of cases) for (const t of c.tags) if (t.startsWith("hook:") && !ids.has(t.slice(5))) out.push(`${c.id}: ${t}`);
  return out;
}

export interface SeamRegistry {
  HOOK_IDS: readonly string[];
  withHookDisabled<T>(id: string, fn: () => Promise<T>): Promise<T>;
}

/** core/validation/registry.ts (W0.6), loaded by a computed path so a tree without it still type-checks and loads. */
const REGISTRY_MODULE = ["..", "..", "registry"].join("/");

/** The registry's seam, when this tree has one. */
export async function loadSeamRegistry(): Promise<SeamRegistry | null> {
  let mod: Record<string, unknown>;
  try {
    mod = (await import(/* @vite-ignore */ REGISTRY_MODULE)) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!Array.isArray(mod.HOOK_IDS) || typeof mod.withHookDisabled !== "function") return null;
  return mod as unknown as SeamRegistry;
}

/**
 * For each hook: run its tagged PASS cases with the hook disabled; at least one must fail. `runPass` returns whether
 * a case still passes.
 */
export async function ledgerSeamItems(
  ledger: LedgerFile,
  cases: readonly CorpusCase[],
  registry: SeamRegistry | null,
  runPass: (c: CorpusCase) => Promise<boolean>,
): Promise<LedgerItem[]> {
  const out: LedgerItem[] = [];
  for (const h of ledger.hooks) {
    const id = `LEDGER-${h.id}-seam`;
    const owner = h.seamOwner ?? h.owner;
    if (!registry || !registry.HOOK_IDS.includes(h.id)) {
      out.push({ id, hook: h.id, owner, ok: false, detail: `no seam for ${h.id} in core/validation/registry.ts (withHookDisabled)` });
      continue;
    }
    const pass = cases.filter((c) => c.tags.includes(`hook:${h.id}`) && c.expect === "PASS");
    if (pass.length === 0) {
      out.push({ id, hook: h.id, owner, ok: false, detail: `no PASS case tagged hook:${h.id} to show the seam` });
      continue;
    }
    const turned: string[] = [];
    await registry.withHookDisabled(h.id, async () => {
      for (const c of pass) if (!(await runPass(c))) turned.push(c.id);
    });
    out.push({ id, hook: h.id, owner, ok: turned.length > 0, detail: turned.length ? `disabling ${h.id} turns ${turned.join(", ")} red` : `disabling ${h.id} turns no PASS case red` });
  }
  return out;
}
