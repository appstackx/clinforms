import { test } from "node:test";
import assert from "node:assert/strict";
import { WriteQueue, type SendOutcome } from "./write-queue";

interface Deferred {
  key: string;
  payload: number;
  keepalive: boolean;
  resolve(outcome: SendOutcome): void;
}

/** A queue whose sends wait until the test answers them, with a manual timer. */
function harness(opts: { maxAttempts?: number } = {}) {
  const sent: Deferred[] = [];
  const timers: Array<{ run: () => void; ms: number; cancelled: boolean }> = [];
  let active = 0;
  let peak = 0;
  const queue = new WriteQueue<number>({
    maxAttempts: opts.maxAttempts ?? 3,
    schedule: (run, ms) => {
      const t = { run, ms, cancelled: false };
      timers.push(t);
      return () => {
        t.cancelled = true;
      };
    },
    send: (key, payload, { keepalive }) =>
      new Promise<SendOutcome>((resolve) => {
        active += 1;
        peak = Math.max(peak, active);
        sent.push({
          key,
          payload,
          keepalive,
          resolve: (o) => {
            active -= 1;
            resolve(o);
          },
        });
      }),
  });
  const tick = () => new Promise((r) => setImmediate(r));
  const fireTimers = async () => {
    timers.splice(0).forEach((t) => {
      if (!t.cancelled) t.run();
    });
    await tick();
  };
  return { queue, sent, timers, tick, fireTimers, peak: () => peak };
}

test("one write per record in flight; newer saves coalesce into one pending write, sent in order", async () => {
  const h = harness();
  h.queue.enqueue("report:1", 1);
  h.queue.enqueue("report:1", 2);
  h.queue.enqueue("report:1", 3);
  assert.deepEqual(h.sent.map((s) => s.payload), [1], "only the first is in flight");
  assert.equal(h.queue.state().pending, 1);
  assert.equal(h.queue.isBusy("report:1"), true);
  assert.equal(h.queue.pendingPayload("report:1"), 3);
  const settled = h.queue.settled("report:1");
  h.sent[0].resolve({ kind: "ok" });
  await h.tick();
  assert.deepEqual(h.sent.map((s) => s.payload), [1, 3], "2 was superseded by 3");
  h.sent[1].resolve({ kind: "ok" });
  assert.equal(await settled, true);
  assert.equal(h.queue.state().pending, 0);
  assert.equal(h.peak(), 1);
});

test("generateReport-style bursts: many saves of one report from 3 parallel groups reach the server in order", async () => {
  const sent: number[] = [];
  let inflight = 0;
  let maxInflight = 0;
  const queue = new WriteQueue<number>({
    send: async (_key, payload) => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((r) => setTimeout(r, 1 + (payload % 3)));
      sent.push(payload);
      inflight -= 1;
      return { kind: "ok" };
    },
  });
  let version = 0;
  const group = async (delay: number) => {
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, delay));
      queue.enqueue("report:r", ++version); // each save carries the latest accumulated report
    }
  };
  queue.enqueue("report:r", ++version);
  await Promise.all([group(1), group(2), group(3)]);
  assert.equal(await queue.settledAll(), true);
  assert.equal(maxInflight, 1);
  assert.deepEqual(sent.slice().sort((a, b) => a - b), sent, "never an older snapshot after a newer one");
  assert.equal(sent[sent.length - 1], version, "the last save is the one stored");
  assert.ok(sent.length < version, "coalesced");
});

test("different records are saved in parallel", async () => {
  const h = harness();
  h.queue.enqueue("report:1", 1);
  h.queue.enqueue("form:2", 2);
  assert.deepEqual(h.sent.map((s) => s.key), ["report:1", "form:2"]);
  h.sent.forEach((s) => s.resolve({ kind: "ok" }));
  assert.equal(await h.queue.settledAll(), true);
});

test("409: the stored copy wins – the waiting payload is dropped and the save reports false until the next success", async () => {
  const h = harness();
  h.queue.enqueue("report:1", 1);
  h.queue.enqueue("report:1", 2);
  const settled = h.queue.settled("report:1");
  h.sent[0].resolve({ kind: "conflict", message: "Changed elsewhere." });
  assert.equal(await settled, false);
  await h.tick();
  assert.equal(h.sent.length, 1, "the pending payload based on the old copy is not sent");
  assert.deepEqual(h.queue.state(), { pending: 0, failed: true, error: "Changed elsewhere." });
  h.queue.enqueue("report:1", 3);
  h.sent[1].resolve({ kind: "ok" });
  assert.equal(await h.queue.settled("report:1"), true);
  assert.deepEqual(h.queue.state(), { pending: 0, failed: false });
});

test("network failures retry with back-off, then stop; retryFailed and a new save start again", async () => {
  const h = harness({ maxAttempts: 2 });
  h.queue.enqueue("report:1", 1);
  const settled = h.queue.settled("report:1");
  h.sent[0].resolve({ kind: "retry", message: "Offline." });
  await h.tick();
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0].ms, 500);
  assert.equal(h.queue.state().pending, 1, "kept while waiting");
  await h.fireTimers();
  assert.deepEqual(h.sent.map((s) => s.payload), [1, 1]);
  h.sent[1].resolve({ kind: "retry", message: "Offline." });
  assert.equal(await settled, false, "stopped after maxAttempts");
  assert.equal(h.timers.length, 0);
  assert.deepEqual(h.queue.state(), { pending: 1, failed: true, error: "Offline." });

  h.queue.retryFailed();
  assert.equal(h.sent.length, 3);
  h.sent[2].resolve({ kind: "ok" });
  assert.equal(await h.queue.settled("report:1"), true);
  assert.deepEqual(h.queue.state(), { pending: 0, failed: false });
});

test("a newer save while waiting to retry replaces the failed payload", async () => {
  const h = harness();
  h.queue.enqueue("report:1", 1);
  h.sent[0].resolve({ kind: "retry", message: "Offline." });
  await h.tick();
  h.queue.enqueue("report:1", 2);
  assert.equal(h.sent.length, 1, "still waiting for the back-off");
  await h.fireTimers();
  assert.deepEqual(h.sent.map((s) => s.payload), [1, 2]);
  h.sent[1].resolve({ kind: "ok" });
  assert.equal(await h.queue.settledAll(), true);
});

test("401/403 stops at once and keeps the change; the next save tries again", async () => {
  const h = harness();
  h.queue.enqueue("report:1", 1);
  const settled = h.queue.settled("report:1");
  h.sent[0].resolve({ kind: "blocked", message: "Sign in again." });
  assert.equal(await settled, false);
  assert.equal(h.timers.length, 0);
  assert.equal(h.queue.state().pending, 1);
  h.queue.enqueue("report:1", 2);
  assert.deepEqual(h.sent.map((s) => s.payload), [1, 2]);
  h.sent[1].resolve({ kind: "ok" });
  assert.equal(await h.queue.settled("report:1"), true);
});

test("a refused payload is dropped but a newer one is still sent", async () => {
  const h = harness();
  h.queue.enqueue("form:1", 1);
  h.queue.enqueue("form:1", 2);
  h.sent[0].resolve({ kind: "rejected", message: "Too large." });
  await h.tick();
  assert.deepEqual(h.sent.map((s) => s.payload), [1, 2]);
  h.sent[1].resolve({ kind: "ok" });
  assert.equal(await h.queue.settled("form:1"), true);
});

test("flush sends what waits for a retry at once (keepalive on page hide) and waits for it", async () => {
  const h = harness();
  h.queue.enqueue("report:1", 1);
  h.sent[0].resolve({ kind: "retry", message: "Offline." });
  await h.tick();
  const flushed = h.queue.flush({ keepalive: true });
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent[1].keepalive, true);
  assert.equal(h.timers[0].cancelled, true);
  h.sent[1].resolve({ kind: "ok" });
  assert.equal(await flushed, true);
  assert.equal(await new WriteQueue<number>({ send: async () => ({ kind: "ok" }) }).flush(), true, "nothing to send");
});

test("clear drops everything and releases waiters", async () => {
  const h = harness();
  h.queue.enqueue("report:1", 1);
  const settled = h.queue.settled("report:1");
  h.queue.clear();
  assert.equal(await settled, false);
  assert.deepEqual(h.queue.state(), { pending: 0, failed: false });
  h.sent[0].resolve({ kind: "ok" }); // a late answer for a cleared slot is ignored
  await h.tick();
  assert.deepEqual(h.queue.state(), { pending: 0, failed: false });
});
