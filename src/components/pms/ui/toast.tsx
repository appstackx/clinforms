"use client";
import * as React from "react";
import { CheckCircle, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Toasts (design system v1): bottom right, 5 seconds, paused while the pointer or keyboard focus is on them, with
 * an optional action ("Undo", "Retry"). The repo has no toaster, so this is a small one with no new dependency.
 * The shell mounts <ToastProvider>; any client component below it calls useToast().
 *
 *   const toast = useToast();
 *   toast.success("Margaret Ellis marked as arrived", { action: { label: "Undo", onClick: undo } });
 *   toast.error("Reminder to 07700 900412 failed to send", { action: { label: "Retry", onClick: retry } });
 */

export const TOAST_DURATION_MS = 5000;

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  action?: ToastAction;
  /** Milliseconds; default 5000. */
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
  tone: "success" | "error";
  message: string;
}

export interface ToastApi {
  success: (message: string, options?: ToastOptions) => void;
  error: (message: string, options?: ToastOptions) => void;
  dismiss: (id?: number) => void;
}

const ToastContext = React.createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = React.useContext(ToastContext);
  if (!api) throw new Error("useToast() needs a <ToastProvider> above it (the clinic shell mounts one).");
  return api;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const nextId = React.useRef(1);
  const dismiss = React.useCallback((id?: number) => setItems((list) => (id === undefined ? [] : list.filter((t) => t.id !== id))), []);
  const push = React.useCallback((tone: ToastItem["tone"], message: string, options: ToastOptions = {}) => {
    const id = nextId.current++;
    // At most three on screen; the oldest goes first.
    setItems((list) => [...list.slice(-2), { id, tone, message, ...options }]);
  }, []);
  const api = React.useMemo<ToastApi>(
    () => ({ success: (m, o) => push("success", m, o), error: (m, o) => push("error", m, o), dismiss }),
    [push, dismiss],
  );
  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport items={items} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(360px,calc(100vw-32px))] flex-col gap-2">
      {/* Two live regions, present before any toast appears, so screen readers announce what is added. */}
      <div role="status" aria-live="polite" className="flex flex-col gap-2">
        {items.filter((t) => t.tone === "success").map((t) => (
          <ToastCard key={t.id} item={t} onDismiss={onDismiss} />
        ))}
      </div>
      <div role="alert" aria-live="assertive" className="flex flex-col gap-2">
        {items.filter((t) => t.tone === "error").map((t) => (
          <ToastCard key={t.id} item={t} onDismiss={onDismiss} />
        ))}
      </div>
    </div>
  );
}

export function ToastCard({ item, onDismiss }: { item: Pick<ToastItem, "id" | "tone" | "message" | "action" | "duration">; onDismiss?: (id: number) => void }) {
  const [paused, setPaused] = React.useState(false);
  const remaining = React.useRef(item.duration ?? TOAST_DURATION_MS);
  React.useEffect(() => {
    if (!onDismiss || paused) return;
    const started = Date.now();
    const timer = window.setTimeout(() => onDismiss(item.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(800, remaining.current - (Date.now() - started));
    };
  }, [paused, item.id, onDismiss]);
  const dark = item.tone === "success";
  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cn(
        "pointer-events-auto flex items-center gap-2.5 rounded-xl px-3.5 py-3 text-sm",
        dark ? "bg-[#0F172A] text-white shadow-[0_12px_32px_rgba(15,23,42,0.2)]" : "border border-[#FECACA] bg-white text-foreground shadow-[0_12px_32px_rgba(15,23,42,0.12)]",
      )}
    >
      {dark ? <CheckCircle className="h-4 w-4 shrink-0 text-[#5EEAD4]" aria-hidden /> : <XCircle className="h-4 w-4 shrink-0 text-destructive-strong" aria-hidden />}
      <span className="min-w-0 flex-1">{item.message}</span>
      {item.action ? (
        <button
          type="button"
          onClick={() => {
            item.action?.onClick();
            onDismiss?.(item.id);
          }}
          className={cn(
            "shrink-0 rounded px-1 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
            dark ? "text-[#5EEAD4] focus-visible:outline-[#5EEAD4]" : "text-primary-strong focus-visible:outline-primary",
          )}
        >
          {item.action.label}
        </button>
      ) : null}
      {onDismiss ? (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => onDismiss(item.id)}
          className={cn("-mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded focus-visible:outline focus-visible:outline-2", dark ? "text-white/70 hover:text-white focus-visible:outline-[#5EEAD4]" : "text-[#64748B] hover:text-foreground focus-visible:outline-primary")}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
