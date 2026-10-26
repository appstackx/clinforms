/**
 * Test seams for the safety corpus ledger (W0.6, plan W0.2 "Ledger"; the contract in __corpus__/README.md).
 *
 * Every allow hook, exemption, pre-strip, threshold, acknowledgement rule and one-click generator listed in
 * __corpus__/ledger.json gets a seam: its owner names it once with defineHook(id) – in the owner's own file, at module
 * level – and asks hookEnabled(id) where the hook applies. The corpus runner then disables each hook in turn
 * (withHookDisabled) and requires at least one of its tagged PASS cases to turn red, so a hook that no case depends on
 * shows up. A ledger hook with no defineHook call stays pending as "no seam" (LEDGER-<id>-seam).
 *
 *   defineHook(id)               register a hook id (idempotent); returns the id, for `const HOOK = defineHook("…")`
 *   hookEnabled(id)              false only inside withHookDisabled(id, …) – the product's normal path is always true
 *   HOOK_IDS                     the ids registered so far (read by the corpus ledger)
 *   withHookDisabled(id, fn)     run fn with one hook disabled (tests only); restores it afterwards, also on a throw
 *
 * A leaf module (no imports), so a validator, the review reducer, assembly or the fill can import it without a cycle
 * through registry.ts, which re-exports it. Pure; browser and server.
 * Owner: W0 (shared; changes through the integrator) – docs/bh2-ownership.json.
 */

const registered: string[] = [];
const disabled = new Set<string>();

/** The hook ids the product has registered (each owner's defineHook call). The same array as it grows. */
export const HOOK_IDS: readonly string[] = registered;

/** Register a ledger hook id (as in __corpus__/ledger.json). Idempotent. */
export function defineHook(id: string): string {
  if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(id)) throw new Error(`hook id "${id}": letters, digits and "-" only, as in ledger.json`);
  if (!registered.includes(id)) registered.push(id);
  return id;
}

/** Whether a hook applies. Always true outside a test's withHookDisabled. */
export function hookEnabled(id: string): boolean {
  return disabled.size === 0 || !disabled.has(id);
}

/** Run `fn` with one registered hook disabled (the corpus ledger's seam). Tests only. */
export async function withHookDisabled<T>(id: string, fn: () => Promise<T>): Promise<T> {
  if (!registered.includes(id)) throw new Error(`no hook "${id}" is registered (defineHook)`);
  disabled.add(id);
  try {
    return await fn();
  } finally {
    disabled.delete(id);
  }
}
