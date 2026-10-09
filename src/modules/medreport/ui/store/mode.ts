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
