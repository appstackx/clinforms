import { test } from "node:test";
import assert from "node:assert/strict";
import { runPool } from "./pool";

test("runs with a concurrency cap, keeps order and captures failures", async () => {
  let running = 0;
  let peak = 0;
  const results = await runPool([1, 2, 3, 4, 5], 2, async (n) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running -= 1;
    if (n === 3) throw new Error("boom");
    return n * 10;
  });
  assert.equal(peak, 2);
  assert.deepEqual(
    results.map((r) => (r.ok ? r.value : "x")),
    [10, 20, "x", 40, 50],
  );
});

test("an aborted signal stops new jobs from starting", async () => {
  const controller = new AbortController();
  const started: number[] = [];
  const results = await runPool(
    [1, 2, 3],
    1,
    async (n) => {
      started.push(n);
      controller.abort();
      return n;
    },
    controller.signal,
  );
  assert.deepEqual(started, [1]);
  assert.equal(results[1].ok, false);
  assert.equal(results[2].ok === false && results[2].skipped, true);
});

test("an empty list resolves to []", async () => {
  assert.deepEqual(await runPool([], 3, async () => 1), []);
});
