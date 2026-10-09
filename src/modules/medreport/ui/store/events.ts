/**
 * The store's same-tab change event. Every write (either backend) dispatches STORE_EVENT on window; the
 * hooks in ui/store.ts reload on it. Shared contract: the event name is re-exported by ui/store.ts.
 */
export const STORE_EVENT = "medreport:store";

export function notify(): void {
  try {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(STORE_EVENT));
  } catch {
    // ignore
  }
}
