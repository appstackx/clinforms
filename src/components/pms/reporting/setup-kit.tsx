"use client";
/**
 * Set-up's page pattern (design round 2c "Sites and opening hours"; the other set-up pages have no design and use
 * the same pattern): a header (title, one line, primary action), a list card on the left (rows with a name and a
 * meta such as "2 rooms"; the chosen row tinted) and cards on the right; forms end in a bar with "Discard
 * changes" and "Save". Below md everything stacks. Presentational – the pages pass data and actions in.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { PmsButton, useToast } from "@/components/pms/ui";
import type { SetupActionResult } from "@/app/app/clinic/setup/actions";

export const setupFocus = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

export function SetupHeader({ title, description, action }: { title: string; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-[240px] flex-1">
        <h1 className="m-0 text-xl font-semibold leading-7 text-foreground">{title}</h1>
        {description ? <p className="text-sm text-[#475569]">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** The page body: a column with 16 px gaps, as wide as the design. */
export function SetupPage({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full min-w-0 max-w-[1180px] flex-col gap-4">{children}</div>;
}

/** List on the left (flex 1 1 260px), detail on the right (flex 2 1 420px). */
export function SetupSplit({ list, children }: { list: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-4">
      <div className="min-w-0 flex-[1_1_260px]">{list}</div>
      <div className="flex min-w-0 flex-[2_1_420px] flex-col gap-4">{children}</div>
    </div>
  );
}

export interface SetupListItem {
  id: string;
  label: string;
  meta?: string;
  href: string;
  active: boolean;
  muted?: boolean;
}

export function SetupList({ items, label, empty, testId }: { items: SetupListItem[]; label: string; empty?: string; testId?: string }) {
  return (
    <nav aria-label={label} className="relative overflow-hidden rounded-2xl border border-border bg-white">
      {items.length === 0 ? <p className="px-3.5 py-3 text-sm text-[#475569]">{empty ?? "Nothing yet."}</p> : null}
      <ul>
        {items.map((x) => (
          <li key={x.id}>
            <Link
              href={x.href}
              scroll={false}
              aria-current={x.active ? "page" : undefined}
              data-testid={testId}
              data-id={x.id}
              className={cn(
                "flex min-h-11 w-full items-center gap-2 border-b border-[#F1F5F9] px-3.5 py-2 text-left text-foreground hover:bg-[#F8FAFC]",
                x.active && "bg-[#E6F7F5] font-semibold hover:bg-[#E6F7F5]",
                setupFocus,
              )}
            >
              <span className={cn("min-w-0 flex-1 truncate", x.muted && "text-[#64748B]")} title={x.label}>{x.label}</span>
              {x.meta ? <span className="shrink-0 text-xs font-normal text-[#475569]">{x.meta}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** A white card (16 px radius). `title` adds the design's header row (with an optional action on the right). */
export function SetupCard({ title, action, children, className, padded = true, id }: { title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string; padded?: boolean; id?: string }) {
  const headingId = React.useId();
  return (
    <section aria-labelledby={title ? headingId : undefined} id={id} className={cn("relative overflow-hidden rounded-2xl border border-border bg-white", className)}>
      {title ? (
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <h2 id={headingId} className="m-0 flex-1 text-[15px] font-semibold">
            {title}
          </h2>
          {action}
        </div>
      ) : null}
      <div className={cn(padded && "px-5 py-4")}>{children}</div>
    </section>
  );
}

/** The fields' grid of a card (auto-fit, 220 px minimum). */
export function SetupGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-3">{children}</div>;
}

/** "Discard changes" + "Save" at the end of a form (the design's bottom bar). */
export function SetupFormBar({ dirty, saving, onDiscard, saveLabel = "Save", testId = "setup-save", discardable = true }: { dirty: boolean; saving: boolean; onDiscard?: () => void; saveLabel?: string; testId?: string; discardable?: boolean }) {
  return (
    <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
      {discardable && onDiscard ? (
        <PmsButton type="button" variant="secondary" disabled={!dirty || saving} onClick={onDiscard}>
          Discard changes
        </PmsButton>
      ) : null}
      <PmsButton type="submit" loading={saving} disabled={!dirty} data-testid={testId}>
        {saveLabel}
      </PmsButton>
    </div>
  );
}

/** A form error line (announced). */
export function SetupError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-destructive-strong">
      {error}
    </p>
  );
}

/**
 * State for a set-up form: the values, whether they changed, saving, the error and field errors; `submit` runs the
 * action, toasts the message, refreshes the page (and goes to `then(id)` when given).
 */
export function useSetupForm<T extends object>(initial: T) {
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = React.useState<T>(initial);
  const [base, setBase] = React.useState<T>(initial);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const key = JSON.stringify(initial);
  React.useEffect(() => {
    const next = JSON.parse(key) as T;
    setValues(next);
    setBase(next);
    setError(null);
    setFieldErrors({});
  }, [key]);
  const dirty = JSON.stringify(values) !== JSON.stringify(base);
  const set = <K extends keyof T>(k: K, v: T[K]) => setValues((old) => ({ ...old, [k]: v }));
  async function submit(run: () => Promise<SetupActionResult>, done: string, then?: (id: string | undefined) => void) {
    setSaving(true);
    setError(null);
    setFieldErrors({});
    const r = await run();
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      setFieldErrors(r.fieldErrors ?? {});
      return false;
    }
    toast.success(done);
    setBase(values);
    if (then) then(r.id);
    router.refresh();
    return true;
  }
  return { values, set, setValues, dirty, saving, error, fieldErrors, submit, discard: () => setValues(base) };
}
