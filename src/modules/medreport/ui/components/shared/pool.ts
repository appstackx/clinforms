/**
 * Run async jobs with a concurrency cap (draft groups, batch items). Jobs start in order; each job's
 * failure is captured, never thrown, so one failed group does not stop the others. An aborted signal
 * stops new jobs from starting (jobs already running receive the same signal).
 *
 * Owner: studio-a agent.
 */
export type PoolResult<R> = { ok: true; value: R } | { ok: false; error: unknown; skipped?: boolean };

export async function runPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<PoolResult<R>[]> {
  const results: PoolResult<R>[] = new Array(items.length);
  let next = 0;
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));

  async function lane(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      if (signal?.aborted) {
        results[index] = { ok: false, error: new DOMException("Aborted", "AbortError"), skipped: true };
        continue;
      }
      try {
        results[index] = { ok: true, value: await worker(items[index], index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  }

  const lanes: Promise<void>[] = [];
  for (let i = 0; i < limit; i++) lanes.push(lane());
  await Promise.all(lanes);
  return results;
}
