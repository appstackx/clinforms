import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ErrorStateProps {
  title: ReactNode;
  children?: ReactNode;
  /** Usually a primary "Try again" button. */
  action?: ReactNode;
  className?: string;
}

/** Something could not load – plain words, no codes, and a way to try again (design system v1). */
export function ErrorState({ title, children, action, className }: ErrorStateProps) {
  return (
    <div role="alert" className={cn("flex flex-col items-center gap-2 rounded-2xl border border-border bg-white px-6 py-8 text-center text-sm", className)}>
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#FEF2F2] text-destructive-strong" aria-hidden>
        <AlertTriangle className="h-5 w-5" />
      </div>
      <strong className="text-[15px] font-semibold text-foreground">{title}</strong>
      {children ? <p className="max-w-[280px] text-muted-foreground">{children}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
