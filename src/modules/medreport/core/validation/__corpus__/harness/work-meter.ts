/**
 * Test-only work meters for the cost guards (scripts/medreport/wb-fix2-cost, wc-fix2-store, wc-fix2b-store,
 * forms/docx-choices). Fictional data only; never imported by product code.
 *
 * Why: those guards used to compare wall-clock (or whole-process CPU) milliseconds with a fixed ceiling, so they
 * failed whenever the machine was busy – the parallel test runner, other suites, CPU hogs – although the code did the
 * same work. The meters here measure the work itself:
 *
 * - countValidatorPasses(): how many full validator passes (validateReport / runValidators) ran. Every pass runs every
 *   entry of the VALIDATORS registry, so the calls of its first entry are the passes. Deterministic.
 * - countAttributionGenerators(): how many times WB's attribution fix generators (ATTRIBUTION_FIX_GENERATORS – the
 *   engine's per-flag candidate generation) were called. Deterministic.
 * - threadCpuMs(): the CPU time of this thread alone (process.threadCpuUsage). Unlike wall time it does not grow while
 *   the process waits for a core, and unlike process.cpuUsage it leaves out V8's and libuv's helper threads. It still
 *   varies a little with load (an efficiency core, shared caches – up to about 2x seen with 24 CPU hogs), so a ceiling
 *   in it is a backstop against an order-of-magnitude regression, not the precise guard; the counts are.
 *
 * Each meter wraps the shared registries in place, once per process (node:test runs each file in its own process).
 */
import { ATTRIBUTION_FIX_GENERATORS, nameInstead } from "../../attribution-fixes";
import { VALIDATORS } from "../../registry";

type Wrapped<T> = T & { readonly __metered?: true };

let passes = 0;
let validatorsWrapped = false;

/** Full validator passes run so far in this process (call before and after an operation and subtract). */
export function countValidatorPasses(): () => number {
  if (!validatorsWrapped) {
    validatorsWrapped = true;
    const first = VALIDATORS[0] as { run: (typeof VALIDATORS)[number]["run"] };
    const run = first.run;
    first.run = (input) => {
      passes += 1;
      return run(input);
    };
  }
  return () => passes;
}

let generatorCalls = 0;
let generatorsWrapped = false;

/** WB's attribution fix generator calls so far in this process. */
export function countAttributionGenerators(): () => number {
  if (!generatorsWrapped) {
    generatorsWrapped = true;
    const list = ATTRIBUTION_FIX_GENERATORS as Array<Wrapped<(typeof ATTRIBUTION_FIX_GENERATORS)[number]>>;
    for (let i = 0; i < list.length; i++) {
      const gen = list[i];
      // fixes.ts skips "Name X instead" by identity (gen === nameInstead): it is never called there, so it stays as is.
      if (gen === nameInstead || gen.__metered) continue;
      const metered = ((input: Parameters<typeof gen>[0]) => {
        generatorCalls += 1;
        return gen(input);
      }) as Wrapped<typeof gen>;
      Object.defineProperty(metered, "__metered", { value: true });
      list[i] = metered;
    }
  }
  return () => generatorCalls;
}

/** This thread's CPU time in milliseconds (user + system). process.threadCpuUsage: Node 23.9 / 22.19 and later (not yet in the installed @types/node). */
export function threadCpuMs(): number {
  // .nvmrc says "22": an older 22.x has no threadCpuUsage – the whole process's CPU then (helper threads too).
  const thread = (process as unknown as { threadCpuUsage?: () => NodeJS.CpuUsage }).threadCpuUsage;
  const { user, system } = thread ? thread.call(process) : process.cpuUsage();
  return (user + system) / 1000;
}

/** Runs `fn` and returns its result with the work it did: validator passes, generator calls and this thread's CPU ms. */
export async function metered<T>(fn: () => Promise<T> | T): Promise<{ value: T; passes: number; generators: number; cpuMs: number }> {
  const p = countValidatorPasses();
  const g = countAttributionGenerators();
  const p0 = p();
  const g0 = g();
  const c0 = threadCpuMs();
  const value = await fn();
  return { value, passes: p() - p0, generators: g() - g0, cpuMs: threadCpuMs() - c0 };
}
