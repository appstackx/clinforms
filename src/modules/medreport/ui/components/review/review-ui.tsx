"use client";

/**
 * Small building blocks of the review screen: pills, status dots, citation chips, an auto-growing
 * textarea, inline alerts and toasts. Host UI comes only through ui/primitives.ts.
 *
 * Owner: studio-b agent.
 */
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import type { EpisodeBundle, ParagraphOrigin } from "../../../core/types";
import { cn } from "../../primitives";
import {
  ORIGIN_PILL_CLASSES,
  QUESTION_STATUS_META,
  citationAriaLabel,
  citationLabel,
  sourceKind,
  type QuestionStatus,
} from "./review-model";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/* Pills and dots ------------------------------------------------------------------------------- */

export function Pill({ className, children, title }: { className?: string; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cn("inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-[11px] font-medium leading-none", className)}
    >
      {children}
    </span>
  );
}

export function OriginPill({ origin, label }: { origin: ParagraphOrigin; label: string }) {
  return <Pill className={ORIGIN_PILL_CLASSES[origin]}>{label}</Pill>;
}

export function StatusDot({ status, className }: { status: QuestionStatus; className?: string }) {
  return <span aria-hidden className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", QUESTION_STATUS_META[status].dot, className)} />;
}

/* Citation chips -------------------------------------------------------------------------------- */

export function CitationChip({
  id,
  bundle,
  onOpen,
  active,
}: {
  id: string;
  bundle: Pick<EpisodeBundle, "notes">;
  onOpen?: (id: string) => void;
  active?: boolean;
}) {
  const kind = sourceKind(id);
  const known = kind !== "unknown" && (kind !== "note" || bundle.notes.some((n) => n.id === id));
  return (
    <button
      type="button"
      onClick={() => onOpen?.(id)}
      disabled={!onOpen}
      aria-label={citationAriaLabel(id, bundle)}
      className={cn(
        "inline-flex h-6 items-center rounded-md border px-1.5 font-mono text-[11px] leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488] focus-visible:ring-offset-1 disabled:cursor-default",
        known
          ? "border-slate-200 bg-white text-slate-700 hover:border-teal-400 hover:bg-teal-50 hover:text-teal-900"
          : "border-red-200 bg-red-50 text-red-700",
        active && "border-teal-500 bg-teal-50 text-teal-900",
      )}
    >
      {citationLabel(id, bundle)}
    </button>
  );
}

/* Auto-growing textarea ------------------------------------------------------------------------- */

export const AutoTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number }>(
  function AutoTextarea({ className, minRows = 2, value, ...props }, ref) {
    const inner = useRef<HTMLTextAreaElement | null>(null);
    const setRefs = useCallback(
      (el: HTMLTextAreaElement | null) => {
        inner.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      },
      [ref],
    );
    useIsoLayoutEffect(() => {
      const el = inner.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight + 2}px`;
    }, [value]);
    return (
      <textarea
        ref={setRefs}
        rows={minRows}
        value={value}
        className={cn(
          "block w-full resize-none overflow-hidden rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-relaxed text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-[#0D9488] focus:outline-none focus:ring-2 focus:ring-teal-600/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-700",
          className,
        )}
        {...props}
      />
    );
  },
);

/* Inline alert ---------------------------------------------------------------------------------- */

const ALERT_STYLES = {
  info: { box: "border-sky-200 bg-sky-50 text-sky-900", Icon: Info, icon: "text-sky-600" },
  success: { box: "border-teal-200 bg-teal-50 text-teal-900", Icon: CheckCircle2, icon: "text-teal-600" },
  warning: { box: "border-amber-200 bg-amber-50 text-amber-900", Icon: AlertTriangle, icon: "text-amber-600" },
  error: { box: "border-red-200 bg-red-50 text-red-900", Icon: XCircle, icon: "text-red-600" },
} as const;

export function InlineAlert({
  tone = "info",
  title,
  children,
  action,
  className,
  role,
}: {
  tone?: keyof typeof ALERT_STYLES;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  role?: "alert" | "status";
}) {
  const s = ALERT_STYLES[tone];
  return (
    <div role={role} className={cn("flex gap-3 rounded-xl border px-3.5 py-3 text-sm", s.box, className)}>
      <s.Icon className={cn("mt-0.5 h-4 w-4 shrink-0", s.icon)} aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="text-[13px] leading-relaxed opacity-90">{children}</div>}
        {action && <div className="flex flex-wrap gap-2 pt-1">{action}</div>}
      </div>
    </div>
  );
}

/* Toasts ---------------------------------------------------------------------------------------- */

export interface Toast {
  id: number;
  tone: "success" | "error" | "info";
  title: string;
  detail?: string;
  action?: { label: string; href: string };
}

interface ToastApi {
  push(t: Omit<Toast, "id">): void;
}

const ToastContext = createContext<ToastApi>({ push: () => undefined });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const api = useMemo<ToastApi>(
    () => ({
      push(t) {
        const id = next.current++;
        setToasts((list) => [...list.slice(-2), { ...t, id }]);
        window.setTimeout(() => dismiss(id), t.tone === "error" ? 9000 : 6000);
      },
    }),
    [dismiss],
  );
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end sm:px-6"
      >
        {toasts.map((t) => {
          const s = ALERT_STYLES[t.tone];
          return (
            <div
              key={t.id}
              role={t.tone === "error" ? "alert" : "status"}
              className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-lg"
            >
              <s.Icon className={cn("mt-0.5 h-4 w-4 shrink-0", s.icon)} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-900">{t.title}</p>
                {t.detail && <p className="mt-0.5 text-[13px] text-slate-600">{t.detail}</p>}
                {t.action && (
                  <Link href={t.action.href} className="mt-1 inline-block text-[13px] font-medium text-teal-700 underline-offset-2 hover:underline">
                    {t.action.label}
                  </Link>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="rounded p-0.5 text-slate-400 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488]"
                aria-label="Dismiss notification"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

/* Media query ----------------------------------------------------------------------------------- */

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof window === "undefined" ? false : window.matchMedia(query).matches));
  useEffect(() => {
    const mql = window.matchMedia(query);
    const on = () => setMatches(mql.matches);
    on();
    mql.addEventListener("change", on);
    return () => mql.removeEventListener("change", on);
  }, [query]);
  return matches;
}

/* Text highlight -------------------------------------------------------------------------------- */

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Text with case-insensitive matches of `query` wrapped in <mark>. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (q.length < 2) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escapeRegExp(q)})`, "gi"));
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded bg-amber-200/80 px-0.5 text-inherit">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
