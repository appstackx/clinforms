/**
 * Which backend the Studio's store uses (docs/production-architecture.md §5):
 * - "browser" (default): the public demo at /reports – reports and form maps in this browser's localStorage,
 *   form files in IndexedDB (ui/store/browser-backend.ts), exactly as before wave 2;
 * - "server": a clinic's own Studio – the clinic's server storage (/api/reports/v1/store/**) behind an
 *   in-memory cache and a write queue (ui/store/server-store.ts). Nothing from a report or form map is ever
 *   written to localStorage or IndexedDB in this mode.
 *
 * The host chooses it through HostHooks.storage; <HostHooksProvider> applies it before its children render
 * (setStoreMode), so the first store call of any screen already uses the right backend.
 */
export type StoreMode = "browser" | "server";

let current: StoreMode = "browser";
const listeners = new Set<(mode: StoreMode) => void>();

export function getStoreMode(): StoreMode {
  return current;
}

export function setStoreMode(mode: StoreMode): void {
  const next: StoreMode = mode === "server" ? "server" : "browser";
  if (next === current) return;
  current = next;
  Array.from(listeners).forEach((listener) => {
    try {
      listener(next);
    } catch {
      // ignore
    }
  });
}

export function onStoreModeChange(listener: (mode: StoreMode) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Whose records the "server" backend holds in memory (fix wave 2): the clinic and member the Studio page was
 * opened for (HostHooks.clinic.tenantId, HostHooks.member.userId). <HostHooksProvider> applies it; when it
 * changes (another member signs in, or the member switches clinic, without a full page load) the server store
 * forgets every record and queued change of the previous scope, and sends the scope with each request so the
 * server refuses a change made under another sign-in (api/store-contract.ts STORE_TENANT_HEADER).
 */
export interface StoreScope {
  tenantId: string;
  userId?: string | null;
}

let currentScope: StoreScope | null = null;
const scopeListeners = new Set<(scope: StoreScope | null) => void>();

export function getStoreScope(): StoreScope | null {
  return currentScope;
}

export function setStoreScope(scope: StoreScope | null): void {
  const next = scope && scope.tenantId ? { tenantId: scope.tenantId, userId: scope.userId ?? null } : null;
  if (next === null && currentScope === null) return;
  if (next && currentScope && next.tenantId === currentScope.tenantId && next.userId === (currentScope.userId ?? null)) return;
  currentScope = next;
  Array.from(scopeListeners).forEach((listener) => {
    try {
      listener(next);
    } catch {
      // ignore
    }
  });
}

export function onStoreScopeChange(listener: (scope: StoreScope | null) => void): () => void {
  scopeListeners.add(listener);
  return () => {
    scopeListeners.delete(listener);
  };
}
