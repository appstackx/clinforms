/**
 * Per-record, coalescing write queue of the "server" store backend.
 *
 * - One slot per key ("report:<id>", "form:<id>", "settings"). At most ONE request per key is in flight; a
 *   newer payload enqueued meanwhile replaces any older pending one (coalescing), and is sent when the
 *   in-flight request settles – so writes of one record always reach the server in order, with the revision
 *   the previous write returned (generateReport's parallel draft groups save the same report many times).
 * - Outcomes (from `send`): ok · conflict / gone (the stored copy was reloaded by the sender: the pending payload
 *   is dropped) · rejected (this payload is refused; a newer pending one is still sent) · retry (network, 5xx,
 *   429: exponential back-off, then "failed" after maxAttempts) · blocked (401/403: kept, waits for sign-in).
 * - Failed and blocked slots keep their latest payload and are sent again by retryFailed() (the store calls it
 *   on focus, when the browser comes back online, and on the next save of that record).
 * - settled(key) / settledAll() resolve when the slot is idle (true = its last write succeeded) or has failed
 *   (false). flush({keepalive}) sends every pending payload at once (keepalive on page hide) and waits.
 *
 * Nothing is persisted: the queue lives in memory only (no patient data in browser storage in server mode).
 */

export type SendOutcome =
  | { kind: "ok" }
  | { kind: "conflict" | "gone" | "rejected" | "retry" | "blocked"; message: string };

export interface WriteQueueState {
  /** Records with a write waiting or in flight. */
  pending: number;
  /** Some record could not be saved (failed after retries, refused, waiting for sign-in, or reloaded after a clash). */
  failed: boolean;
  /** The latest problem, in plain English. */
  error?: string;
}

export interface WriteQueueOptions<P> {
  send(key: string, payload: P, opts: { keepalive: boolean }): Promise<SendOutcome>;
  /** Called after every state change (the store notifies its subscribers). */
  onChange?(): void;
  /** Automatic attempts before a slot is marked failed (default 5). */
  maxAttempts?: number;
  /** Back-off before attempt n+1 (default 500 ms · 2^(n-1), at most 15 s). */
  backoffMs?(attempt: number): number;
  /** Timer (tests inject a manual one). */
  schedule?(run: () => void, ms: number): () => void;
}

interface Slot<P> {
  /** The next payload to send (null when none). */
  payload: P | null;
  inflight: boolean;
  /** Cancels a scheduled retry. */
  cancelTimer: (() => void) | null;
  attempts: number;
  /** Stopped after maxAttempts or a 401/403: waits for retryFailed() or a new payload. */
  stopped: boolean;
  /** The last settled write's result (null before the first). */
  lastOk: boolean | null;
  /** A problem that stays visible until the record's next successful write. */
  error: string | null;
  waiters: Array<(ok: boolean) => void>;
}

const defaultSchedule = (run: () => void, ms: number) => {
  const t = setTimeout(run, ms);
  return () => clearTimeout(t);
};

export class WriteQueue<P> {
  private readonly slots = new Map<string, Slot<P>>();
  private readonly opts: WriteQueueOptions<P>;
  private readonly allWaiters: Array<() => void> = [];

  constructor(opts: WriteQueueOptions<P>) {
    this.opts = opts;
  }

  private slot(key: string): Slot<P> {
    let slot = this.slots.get(key);
    if (!slot) {
      slot = { payload: null, inflight: false, cancelTimer: null, attempts: 0, stopped: false, lastOk: null, error: null, waiters: [] };
      this.slots.set(key, slot);
    }
    return slot;
  }

  /** Queue the latest payload of `key` (replaces an older pending one). */
  enqueue(key: string, payload: P): void {
    const slot = this.slot(key);
    slot.payload = payload;
    if (slot.stopped) {
      // A new edit restarts a stopped slot (the user is active; try again now).
      slot.stopped = false;
      slot.attempts = 0;
    }
    if (!slot.inflight && !slot.cancelTimer) this.pump(key, false);
    this.changed();
  }

  /** True while `key` has a payload waiting, in flight or scheduled for retry (the cache must not overwrite it). */
  isBusy(key: string): boolean {
    const slot = this.slots.get(key);
    return Boolean(slot && (slot.inflight || slot.payload !== null));
  }

  /** The payload waiting to be sent for `key`, if any. */
  pendingPayload(key: string): P | null {
    return this.slots.get(key)?.payload ?? null;
  }

  state(): WriteQueueState {
    let pending = 0;
    let failed = false;
    let error: string | undefined;
    Array.from(this.slots.values()).forEach((slot) => {
      if (slot.inflight || slot.payload !== null) pending += 1;
      if (slot.stopped || slot.error !== null) {
        failed = true;
        if (slot.error) error = slot.error;
      }
    });
    return { pending, failed, ...(error ? { error } : {}) };
  }

  /** Resolves when `key` is idle (true = its last write succeeded) or stopped (false). */
  settled(key: string): Promise<boolean> {
    const slot = this.slots.get(key);
    if (!slot) return Promise.resolve(true);
    if (this.isIdle(slot)) return Promise.resolve(slot.lastOk !== false && slot.error === null);
    if (slot.stopped) return Promise.resolve(false);
    return new Promise((resolve) => slot.waiters.push(resolve));
  }

  /** Resolves when every slot is idle or stopped: true when nothing failed. */
  settledAll(): Promise<boolean> {
    return new Promise((resolve) => {
      const check = (): void => {
        const busy = Array.from(this.slots.values()).some((s) => !this.isIdle(s) && !s.stopped);
        if (busy) {
          this.allWaiters.push(check); // look again after the next change
          return;
        }
        resolve(Array.from(this.slots.values()).every((s) => !s.stopped && s.error === null && s.lastOk !== false));
      };
      check();
    });
  }

  /** Send every pending payload now (cancelling back-off; keepalive on page hide) and wait for all of them. */
  flush(opts: { keepalive?: boolean } = {}): Promise<boolean> {
    Array.from(this.slots.entries()).forEach(([key, slot]) => {
      if (slot.payload === null || slot.inflight) return;
      if (slot.cancelTimer) {
        slot.cancelTimer();
        slot.cancelTimer = null;
      }
      slot.stopped = false;
      this.pump(key, Boolean(opts.keepalive));
    });
    this.changed();
    return this.settledAll();
  }

  /** Try failed / blocked slots again (focus, back online, manual retry). */
  retryFailed(): void {
    Array.from(this.slots.entries()).forEach(([key, slot]) => {
      if (!slot.stopped || slot.payload === null || slot.inflight) return;
      slot.stopped = false;
      slot.attempts = 0;
      this.pump(key, false);
    });
    this.changed();
  }

  /** Forget a stale problem for `key` (e.g. after a reload that the user has seen). */
  clearError(key: string): void {
    const slot = this.slots.get(key);
    if (slot && slot.error !== null) {
      slot.error = null;
      this.changed();
    }
  }

  /** Drop everything (another clinic, or the store reset). Waiters resolve false. */
  clear(): void {
    Array.from(this.slots.values()).forEach((slot) => {
      slot.cancelTimer?.();
      slot.waiters.splice(0).forEach((w) => w(false));
    });
    this.slots.clear();
    this.changed();
  }

  private isIdle(slot: Slot<P>): boolean {
    return !slot.inflight && slot.payload === null;
  }

  private changed(): void {
    this.allWaiters.splice(0).forEach((w) => w());
    try {
      this.opts.onChange?.();
    } catch {
      // ignore
    }
  }

  private settle(slot: Slot<P>, ok: boolean): void {
    slot.waiters.splice(0).forEach((w) => w(ok));
  }

  private pump(key: string, keepalive: boolean): void {
    const slot = this.slot(key);
    slot.cancelTimer = null;
    if (slot.inflight || slot.payload === null || slot.stopped) return;
    const payload = slot.payload;
    slot.payload = null;
    slot.inflight = true;
    let outcome: Promise<SendOutcome>;
    try {
      outcome = this.opts.send(key, payload, { keepalive });
    } catch (err) {
      outcome = Promise.resolve({ kind: "retry", message: err instanceof Error ? err.message : "Could not save." });
    }
    void outcome
      .catch((err: unknown): SendOutcome => ({ kind: "retry", message: err instanceof Error ? err.message : "Could not save." }))
      .then((result) => this.after(key, slot, payload, result));
  }

  private after(key: string, slot: Slot<P>, sent: P, result: SendOutcome): void {
    if (this.slots.get(key) !== slot) return; // cleared meanwhile
    slot.inflight = false;
    switch (result.kind) {
      case "ok":
        slot.attempts = 0;
        slot.lastOk = true;
        slot.error = null;
        break;
      case "conflict":
      case "gone":
        // The sender reloaded the stored copy: what was waiting was based on the old one.
        slot.payload = null;
        slot.attempts = 0;
        slot.lastOk = false;
        slot.error = result.message;
        break;
      case "rejected":
        slot.attempts = 0;
        slot.lastOk = false;
        slot.error = result.message;
        break;
      case "retry":
      case "blocked": {
        if (slot.payload === null) slot.payload = sent; // a newer pending payload supersedes the one that failed
        slot.attempts += 1;
        slot.error = result.message;
        const max = this.opts.maxAttempts ?? 5;
        if (result.kind === "blocked" || slot.attempts >= max) {
          slot.stopped = true;
          slot.lastOk = false;
          this.settle(slot, false);
        } else {
          const delay = this.opts.backoffMs ? this.opts.backoffMs(slot.attempts) : Math.min(15_000, 500 * 2 ** (slot.attempts - 1));
          const schedule = this.opts.schedule ?? defaultSchedule;
          slot.cancelTimer = schedule(() => this.pump(key, false), delay);
        }
        break;
      }
    }
    if (slot.payload !== null && !slot.cancelTimer && !slot.stopped) {
      this.pump(key, false);
    } else if (this.isIdle(slot)) {
      this.settle(slot, slot.lastOk !== false && slot.error === null);
    }
    this.changed();
  }
}
