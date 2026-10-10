/**
 * The "server" store backend: a clinic's own Studio (docs/production-architecture.md §5).
 *
 * - In-memory cache per clinic (tenant): reports and form maps by id with their server revisions, the
 *   snapshot's summaries, the referrer → form links, and form files fetched this page load. Filled by the hooks
 *   (hydrate: the snapshot plus every form map; reports on demand – one when a report opens, all for the home
 *   list). Synchronous reads (listReports, getReport, listForms, getForm…) answer from it, so every screen keeps
 *   its synchronous calls. NOTHING here is written to localStorage or IndexedDB.
 * - Writes are optimistic: the cache changes at once (and STORE_EVENT fires), then the per-record write queue
 *   (ui/store/write-queue.ts) sends them in order with If-Match: "<rev>". A 409 reloads the stored copy into the
 *   cache and notifies; a 404 on update means deleted elsewhere. A server-normalised copy (clinic set from the
 *   sign-in, an unattested confirmation stored as proposed) replaces the cached one when nothing newer is waiting.
 * - Cross-tab: a BroadcastChannel message after each stored write ({tenantId, kind, id, rev}) and a refresh of the
 *   snapshot when the tab regains focus (replaces the 'storage' event of the browser backend).
 * - A record with a write waiting or in flight is never overwritten by a fetch (the local copy is newer).
 * - Scope (fix wave 2): the cache belongs to ONE clinic and member (setScope, from HostHooks via ui/store/mode.ts).
 *   A new scope forgets every record and queued change; every request names the scope and the server refuses a
 *   request whose sign-in is no longer that clinic and member (403 TENANT_MISMATCH / SIGN_IN_CHANGED), which
 *   also empties the cache – one clinic's records are never shown to, or stored by, another sign-in.
 */
import type { ReferrerLinks, StoreFormSummary, StoreReportSummary, StoreSnapshotResponse } from "../../api/store-contract";
import type { FormDefinition, Report } from "../../core/types";
import { notify as notifyWindow } from "./events";
import type { StoreScope } from "./mode";
import { createServerApi, SIGN_IN_CHANGED_CODES, StoreRequestError, type ServerApi } from "./server-api";
import type { StoredFormFile } from "./types";
import { WriteQueue, type SendOutcome, type WriteQueueOptions } from "./write-queue";

export interface StoreSyncState {
  /** Records with a change waiting to reach the server. */
  pending: number;
  /** Something could not be saved or loaded. */
  failed: boolean;
  /** The latest problem, in plain English. */
  error?: string;
}

type Op =
  | { type: "put-report"; report: Report }
  | { type: "delete-report"; id: string }
  | { type: "put-form"; form: FormDefinition }
  | { type: "delete-form"; id: string; sha256: string | null }
  | { type: "put-settings"; links: ReferrerLinks };

interface BroadcastMessage {
  v: 1;
  tenantId: string;
  kind: "report" | "form" | "settings";
  id: string;
  /** null = deleted. */
  rev: number | null;
}

export interface ServerStoreOptions {
  api?: ServerApi;
  /** fetch() for the default transport (which sends the store's scope with every request). */
  fetch?: typeof fetch;
  /** BroadcastChannel and focus / online listeners (default: on in a browser). */
  browserEvents?: boolean;
  /** Same-tab change event (default: STORE_EVENT on window). */
  notify?: () => void;
  /** Queue timing (tests). */
  queue?: Pick<WriteQueueOptions<Op>, "maxAttempts" | "backoffMs" | "schedule">;
  /** Parallel fetches while loading (default 4). */
  concurrency?: number;
}

const CHANNEL = "medreport-store";
/** A focus within this long of the last refresh does not refresh again. */
const REFRESH_MIN_INTERVAL_MS = 3000;

const LOAD_FAILED = "The clinic's records could not be loaded. Check the connection; the page will try again.";
const SIGN_IN_CHANGED = "You are now signed in as someone else or to another clinic. Reload the page to open the right records.";

const reportKey = (id: string) => `report:${id}`;
const formKey = (id: string) => `form:${id}`;
const SETTINGS_KEY = "settings";

function byUpdatedDesc<T extends { updatedAt: string }>(a: T, b: T): number {
  return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;
}

async function pool<T>(items: T[], concurrency: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await run(item).catch(() => undefined);
    }
  });
  await Promise.all(workers);
}

function sameJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export type ServerStore = ReturnType<typeof createServerStore>;

export function createServerStore(options: ServerStoreOptions = {}) {
  /** The clinic and member this cache belongs to (null = not set: the server's sign-in decides). */
  let scope: StoreScope | null = null;
  /** Bumped by every reset: a load that started before it is not applied after it. */
  let generation = 0;
  const api = options.api ?? createServerApi(options.fetch, { scope: () => scope });
  const concurrency = options.concurrency ?? 4;
  const notifyWindow_ = options.notify ?? notifyWindow;

  let tenantId: string | null = null;
  let hydrated = false;
  let hydratedAt = 0;
  let hydratePromise: Promise<void> | null = null;
  let hydrateSeq = 0;
  let loadError: string | null = null;

  const reports = new Map<string, Report>();
  const reportRevs = new Map<string, number>();
  const reportSummaries = new Map<string, StoreReportSummary>();
  const forms = new Map<string, FormDefinition>();
  const formRevs = new Map<string, number>();
  const formSummaries = new Map<string, StoreFormSummary>();
  let links: ReferrerLinks = {};
  const files = new Map<string, StoredFormFile>();
  /** When this tab's last write of a record (by queue key) was stored – newer than any snapshot requested before. */
  const writtenAt = new Map<string, number>();

  const subscribers = new Set<() => void>();
  let channel: BroadcastChannel | null = null;
  let listening = false;

  const emitSync = () => {
    Array.from(subscribers).forEach((fn) => {
      try {
        fn();
      } catch {
        // ignore
      }
    });
  };
  const notify = () => {
    notifyWindow_();
    emitSync();
  };

  const queue = new WriteQueue<Op>({
    ...options.queue,
    send: (key, op, opts) => send(op, opts.keepalive),
    onChange: emitSync,
  });

  const busy = (key: string) => queue.isBusy(key);

  function broadcast(kind: BroadcastMessage["kind"], id: string, rev: number | null): void {
    if (!channel || !tenantId) return;
    const message: BroadcastMessage = { v: 1, tenantId, kind, id, rev };
    try {
      channel.postMessage(message);
    } catch {
      // ignore
    }
  }

  /* Sending ------------------------------------------------------------------------------------- */

  function reportSummaryOf(report: Report, rev: number): StoreReportSummary {
    return {
      id: report.id,
      rev,
      status: report.status,
      templateId: report.templateId,
      formId: report.form?.formId ?? null,
      createdAt: report.createdAt,
      updatedAt: new Date().toISOString(),
    };
  }

  function formSummaryOf(form: FormDefinition, rev: number): StoreFormSummary {
    return {
      id: form.id,
      rev,
      status: form.status,
      title: form.title,
      kind: form.kind,
      fileSha256: form.file.sha256,
      sampleId: form.sampleId ?? null,
      updatedAt: new Date().toISOString(),
    };
  }

  async function send(op: Op, keepalive: boolean): Promise<SendOutcome> {
    const outcome = await sendOnce(op, keepalive);
    if (outcome.kind === "ok") writtenAt.set(keyOf(op), Date.now());
    return outcome;
  }

  function keyOf(op: Op): string {
    switch (op.type) {
      case "put-report":
        return reportKey(op.report.id);
      case "delete-report":
        return reportKey(op.id);
      case "put-form":
        return formKey(op.form.id);
      case "delete-form":
        return formKey(op.id);
      case "put-settings":
        return SETTINGS_KEY;
    }
  }

  async function sendOnce(op: Op, keepalive: boolean): Promise<SendOutcome> {
    switch (op.type) {
      case "put-report": {
        const id = op.report.id;
        const res = await api.putReport(op.report, reportRevs.get(id) ?? null, { keepalive });
        if (res.ok) {
          reportRevs.set(id, res.rev);
          reportSummaries.set(id, reportSummaryOf(res.record, res.rev));
          // The server's copy (its clinic set from the sign-in) replaces ours unless a newer edit is waiting.
          if (queue.pendingPayload(reportKey(id)) === null && reports.get(id) === op.report && !sameJson(res.record, op.report)) {
            reports.set(id, res.record);
            notify();
          }
          broadcast("report", id, res.rev);
          return { kind: "ok" };
        }
        if (res.kind === "conflict") {
          if (res.current && res.current.record.updatedAt === op.report.updatedAt) {
            // Our own earlier write reached the server although its answer did not reach us.
            reportRevs.set(id, res.current.rev);
            return { kind: "ok" };
          }
          const current = res.current ?? (await api.getReport(id).then((r) => (r ? { rev: r.rev, record: r.report } : null)).catch(() => null));
          if (current) {
            reports.set(id, current.record);
            reportRevs.set(id, current.rev);
            reportSummaries.set(id, reportSummaryOf(current.record, current.rev));
          }
          notify();
          return { kind: "conflict", message: res.message };
        }
        if (res.kind === "not_found") {
          dropReport(id);
          notify();
          return { kind: "gone", message: res.message };
        }
        if (res.kind === "rejected" && !reportRevs.has(id) && queue.pendingPayload(reportKey(id)) === null && reports.get(id) === op.report) {
          // Refused and never stored (e.g. an imported case with another clinic's approval): do not show it as held.
          reports.delete(id);
          notify();
        }
        return { kind: res.kind, message: res.message };
      }
      case "delete-report": {
        const res = await api.deleteReport(op.id, { keepalive });
        if (res.ok) {
          reportRevs.delete(op.id);
          reportSummaries.delete(op.id);
          broadcast("report", op.id, null);
          return { kind: "ok" };
        }
        return { kind: res.kind === "conflict" || res.kind === "not_found" ? "gone" : res.kind, message: res.message };
      }
      case "put-form": {
        const id = op.form.id;
        const res = await api.putForm(op.form, formRevs.get(id) ?? null, { keepalive });
        if (res.ok) {
          formRevs.set(id, res.rev);
          formSummaries.set(id, formSummaryOf(res.record, res.rev));
          // E.g. an unattested confirmation stored as proposed: show what the clinic now holds.
          if (queue.pendingPayload(formKey(id)) === null && forms.get(id) === op.form && !sameJson(res.record, op.form)) {
            forms.set(id, res.record);
            notify();
          }
          broadcast("form", id, res.rev);
          return { kind: "ok" };
        }
        if (res.kind === "conflict") {
          if (res.current && res.current.record.updatedAt === op.form.updatedAt) {
            formRevs.set(id, res.current.rev);
            return { kind: "ok" };
          }
          const current = res.current ?? (await api.getForm(id).then((r) => (r ? { rev: r.rev, record: r.form } : null)).catch(() => null));
          if (current) {
            forms.set(id, current.record);
            formRevs.set(id, current.rev);
            formSummaries.set(id, formSummaryOf(current.record, current.rev));
          }
          notify();
          return { kind: "conflict", message: res.message };
        }
        if (res.kind === "not_found") {
          dropForm(id);
          notify();
          return { kind: "gone", message: res.message };
        }
        if (res.kind === "rejected" && !formRevs.has(id) && queue.pendingPayload(formKey(id)) === null && forms.get(id) === op.form) {
          forms.delete(id);
          notify();
        }
        return { kind: res.kind, message: res.message };
      }
      case "delete-form": {
        const res = await api.deleteForm(op.id, { keepalive });
        if (res.ok) {
          formRevs.delete(op.id);
          formSummaries.delete(op.id);
          broadcast("form", op.id, null);
          return { kind: "ok" };
        }
        return { kind: res.kind === "conflict" || res.kind === "not_found" ? "gone" : res.kind, message: res.message };
      }
      case "put-settings": {
        const res = await api.putSettings(op.links, { keepalive });
        if (res.ok) {
          broadcast("settings", SETTINGS_KEY, 1);
          return { kind: "ok" };
        }
        if (res.kind === "conflict" || res.kind === "not_found") return { kind: "rejected", message: res.message };
        return { kind: res.kind, message: res.message };
      }
    }
  }

  function dropReport(id: string): void {
    reports.delete(id);
    reportRevs.delete(id);
    reportSummaries.delete(id);
  }

  function dropForm(id: string): void {
    const form = forms.get(id);
    forms.delete(id);
    formRevs.delete(id);
    formSummaries.delete(id);
    if (form && !Array.from(forms.values()).some((f) => f.file.sha256 === form.file.sha256)) files.delete(form.file.sha256);
  }

  /* Loading ------------------------------------------------------------------------------------- */

  function resetCache(): void {
    generation++;
    hydratePromise = null; // a load already under way belongs to the previous generation
    queue.clear();
    reports.clear();
    reportRevs.clear();
    reportSummaries.clear();
    forms.clear();
    formRevs.clear();
    formSummaries.clear();
    files.clear();
    writtenAt.clear();
    links = {};
    hydrated = false;
  }

  async function fetchReport(id: string): Promise<void> {
    const gen = generation;
    const got = await api.getReport(id);
    if (gen !== generation) return; // the cache was reset meanwhile (another sign-in)
    if (busy(reportKey(id))) return; // a local edit is newer
    if (!got) {
      if (reportRevs.has(id)) dropReport(id); // deleted elsewhere
      return;
    }
    reports.set(id, got.report);
    reportRevs.set(id, got.rev);
    if (!reportSummaries.has(id)) reportSummaries.set(id, reportSummaryOf(got.report, got.rev));
  }

  async function fetchForm(id: string): Promise<void> {
    const gen = generation;
    const got = await api.getForm(id);
    if (gen !== generation) return;
    if (busy(formKey(id))) return;
    if (!got) {
      if (formRevs.has(id)) dropForm(id);
      return;
    }
    forms.set(id, got.form);
    formRevs.set(id, got.rev);
    if (!formSummaries.has(id)) formSummaries.set(id, formSummaryOf(got.form, got.rev));
  }

  /**
   * Apply a snapshot requested at `requestedAt`. A record this tab stored (or deleted) after that moment is newer
   * than the snapshot's view of it and is left as it is (the snapshot may not list a report created a moment ago).
   */
  async function applySnapshot(snap: StoreSnapshotResponse, requestedAt: number): Promise<void> {
    if (scope && scope.tenantId !== snap.tenantId) {
      // The sign-in now belongs to another clinic than this page: show none of either clinic's records here.
      resetCache();
      tenantId = null;
      throw new StoreRequestError(403, "rejected", SIGN_IN_CHANGED, "TENANT_MISMATCH");
    }
    if (tenantId !== null && tenantId !== snap.tenantId) resetCache(); // another clinic: start afresh
    tenantId = snap.tenantId;
    const fresher = (key: string) => busy(key) || (writtenAt.get(key) ?? 0) >= requestedAt;
    const keptReports = Array.from(reportSummaries.values()).filter((s) => fresher(reportKey(s.id)));
    const keptForms = Array.from(formSummaries.values()).filter((s) => fresher(formKey(s.id)));
    reportSummaries.clear();
    snap.reports.forEach((s) => {
      if (!fresher(reportKey(s.id))) reportSummaries.set(s.id, s);
    });
    keptReports.forEach((s) => reportSummaries.set(s.id, s));
    formSummaries.clear();
    snap.forms.forEach((s) => {
      if (!fresher(formKey(s.id))) formSummaries.set(s.id, s);
    });
    keptForms.forEach((s) => formSummaries.set(s.id, s));

    // Reports already loaded: drop those deleted elsewhere, reload those changed elsewhere.
    const staleReports: string[] = [];
    Array.from(reports.keys()).forEach((id) => {
      if (fresher(reportKey(id))) return;
      const summary = reportSummaries.get(id);
      if (!summary) {
        if (reportRevs.has(id)) dropReport(id);
        return;
      }
      if (reportRevs.get(id) !== summary.rev) staleReports.push(id);
    });
    // Form maps: all of them are loaded (the forms library, matching an upload to its map, the wizard).
    const staleForms: string[] = [];
    Array.from(forms.keys()).forEach((id) => {
      if (!fresher(formKey(id)) && !formSummaries.has(id) && formRevs.has(id)) dropForm(id);
    });
    snap.forms.forEach((s) => {
      if (!fresher(formKey(s.id)) && formRevs.get(s.id) !== s.rev) staleForms.push(s.id);
    });
    if (!fresher(SETTINGS_KEY)) links = { ...snap.settings.referrerLinks };
    await Promise.all([pool(staleForms, concurrency, fetchForm), pool(staleReports, concurrency, fetchReport)]);
  }

  function listen(): void {
    if (listening || options.browserEvents === false || typeof window === "undefined") return;
    listening = true;
    try {
      if (typeof BroadcastChannel !== "undefined") {
        channel = new BroadcastChannel(CHANNEL);
        channel.onmessage = (event: MessageEvent) => void onBroadcast(event.data as BroadcastMessage);
      }
    } catch {
      channel = null;
    }
    // Reload first, then retry: a sign-in that changed meanwhile empties the cache and the queue (hydrate's
    // 403) before anything waiting is sent again – and the server refuses it anyway (the scope headers).
    const refresh = () => {
      if (hydrated && Date.now() - hydratedAt > REFRESH_MIN_INTERVAL_MS) void hydrate({ force: true }).then(() => queue.retryFailed());
      else queue.retryFailed();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", () => queue.retryFailed());
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") refresh();
      });
    }
  }

  async function onBroadcast(message: BroadcastMessage): Promise<void> {
    if (!message || message.v !== 1 || message.tenantId !== tenantId) return;
    if (message.kind === "settings") {
      await hydrate({ force: true });
      return;
    }
    const key = message.kind === "report" ? reportKey(message.id) : formKey(message.id);
    if (busy(key)) return;
    const revs = message.kind === "report" ? reportRevs : formRevs;
    if (message.rev === null) {
      if (message.kind === "report") dropReport(message.id);
      else dropForm(message.id);
      notify();
      return;
    }
    if (revs.get(message.id) === message.rev) return;
    // Forms are all loaded; a report only when this tab has it (or lists it).
    if (message.kind === "form") await fetchForm(message.id).catch(() => undefined);
    else if (reports.has(message.id) || reportSummaries.has(message.id)) await fetchReport(message.id).catch(() => undefined);
    notify();
  }

  /** The snapshot and every form map (once; again with force – focus, another tab's settings). */
  function hydrate(opts: { force?: boolean } = {}): Promise<void> {
    listen();
    if (hydrated && !opts.force) return Promise.resolve();
    if (hydratePromise) return hydratePromise;
    const seq = ++hydrateSeq;
    hydratePromise = (async () => {
      try {
        const requestedAt = Date.now();
        const gen = generation;
        const snap = await api.snapshot();
        if (gen !== generation) return; // reset meanwhile: the next hook loads afresh
        await applySnapshot(snap, requestedAt);
        hydrated = true;
        hydratedAt = Date.now();
        loadError = null;
      } catch (err) {
        if (err instanceof StoreRequestError && err.code && SIGN_IN_CHANGED_CODES.includes(err.code)) {
          // Signed in as someone else (or to another clinic) since this page opened: forget this page's records
          // and every change still waiting – none of it may reach, or be shown under, the new sign-in.
          resetCache();
          tenantId = null;
          loadError = SIGN_IN_CHANGED;
        } else {
          loadError = err instanceof StoreRequestError ? err.message : LOAD_FAILED;
        }
      } finally {
        if (seq === hydrateSeq) hydratePromise = null;
        notify();
      }
    })();
    return hydratePromise;
  }

  return {
    /* Scope (fix wave 2) */
    /**
     * The clinic and member this page was opened for. A different scope forgets every record and queued change
     * held in memory (the previous sign-in's); true when it changed.
     */
    setScope(next: StoreScope | null): boolean {
      const same = next === null ? scope === null : scope !== null && scope.tenantId === next.tenantId && (scope.userId ?? null) === (next.userId ?? null);
      if (same) return false;
      const hadScope = scope !== null || tenantId !== null || hydrated;
      scope = next ? { tenantId: next.tenantId, userId: next.userId ?? null } : null;
      if (hadScope) {
        resetCache();
        tenantId = null;
        loadError = null;
        // Called while the host renders: tell the screens after this render (they reload on their own).
        void Promise.resolve().then(notify);
      }
      return hadScope;
    },
    scope: (): StoreScope | null => scope,

    /* Hydration */
    hydrate,
    isHydrated: () => hydrated,
    tenantId: () => tenantId,
    /** Every report of the clinic (the home list). */
    async loadAllReports(): Promise<void> {
      await hydrate();
      const todo = Array.from(reportSummaries.values())
        .filter((s) => !busy(reportKey(s.id)) && (!reports.has(s.id) || reportRevs.get(s.id) !== s.rev))
        .map((s) => s.id);
      await pool(todo, concurrency, fetchReport);
      if (todo.length) notify();
    },
    /** One report (opening it): from the cache when current, else from the server. */
    async ensureReport(id: string): Promise<Report | null> {
      await hydrate();
      const summary = reportSummaries.get(id);
      const cached = reports.get(id) ?? null;
      if (busy(reportKey(id))) return cached;
      if (cached && (!summary ? !reportRevs.has(id) : reportRevs.get(id) === summary.rev)) return cached;
      await fetchReport(id).catch(() => undefined);
      notify();
      return reports.get(id) ?? null;
    },

    /* Reads (synchronous, from the cache) */
    listReports: (): Report[] => Array.from(reports.values()).sort(byUpdatedDesc),
    getReport: (id: string): Report | null => reports.get(id) ?? null,
    listForms: (): FormDefinition[] => Array.from(forms.values()).sort(byUpdatedDesc),
    getForm: (id: string): FormDefinition | null => forms.get(id) ?? null,
    getReferrerLinks: (): ReferrerLinks => links,

    /* Writes (optimistic; queued) */
    saveReport(report: Report): boolean {
      if (!report || typeof report.id !== "string" || report.id === "") return false;
      reports.set(report.id, report);
      queue.enqueue(reportKey(report.id), { type: "put-report", report });
      notify();
      return true;
    },
    deleteReport(id: string): void {
      dropReport(id);
      queue.enqueue(reportKey(id), { type: "delete-report", id });
      notify();
    },
    saveForm(form: FormDefinition): boolean {
      if (!form || typeof form.id !== "string" || form.id === "" || !form.file) return false;
      forms.set(form.id, form);
      queue.enqueue(formKey(form.id), { type: "put-form", form });
      notify();
      return true;
    },
    deleteForm(id: string): void {
      const sha256 = forms.get(id)?.file.sha256 ?? null;
      dropForm(id);
      queue.enqueue(formKey(id), { type: "delete-form", id, sha256 });
      notify();
    },
    setReferrerLinks(next: ReferrerLinks): void {
      links = { ...next };
      queue.enqueue(SETTINGS_KEY, { type: "put-settings", links });
      notify();
    },

    /* Durable writes */
    reportSettled: (id: string) => queue.settled(reportKey(id)),
    formSettled: (id: string) => queue.settled(formKey(id)),
    flush: (opts: { keepalive?: boolean } = {}) => queue.flush(opts),
    retryFailed: () => queue.retryFailed(),

    /* Form files (memory only in this mode) */
    async saveFile(file: StoredFormFile): Promise<boolean> {
      const bytes = new Uint8Array(file.bytes.byteLength);
      bytes.set(file.bytes);
      const copy: StoredFormFile = { ...file, bytes };
      files.set(file.sha256, copy);
      const stored = await api.uploadFile(copy).catch(() => false);
      notify();
      return stored;
    },
    async getFile(sha256: string, signal?: AbortSignal): Promise<StoredFormFile | null> {
      const cached = files.get(sha256);
      if (cached) return cached;
      const got = await api.getFile(sha256, { signal }).catch(() => null);
      if (got) files.set(sha256, got);
      return got;
    },
    dropFile(sha256: string): void {
      files.delete(sha256);
    },
    clearFiles(): void {
      files.clear();
    },

    /* Status */
    syncState(): StoreSyncState {
      const q = queue.state();
      const error = q.error ?? loadError ?? undefined;
      return { pending: q.pending, failed: q.failed || loadError !== null, ...(error ? { error } : {}) };
    },
    subscribe(fn: () => void): () => void {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
    /** Forget everything held in memory (never the clinic's stored data); the next hook loads afresh. */
    reset(): void {
      resetCache();
      tenantId = null;
      loadError = null;
      notify();
    },
  };
}
