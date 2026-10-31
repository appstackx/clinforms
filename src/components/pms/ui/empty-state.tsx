import type { ReactNode } from "react";
import { Hourglass } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  title: ReactNode;
  children?: ReactNode;
  /** Defaults to an hourglass. */
  icon?: ReactNode;
  /** The next step (a PmsButton, usually "secondary"). */
  action?: ReactNode;
  className?: string;
}

/** Nothing here yet – what this place is for and the one thing to do next (design system v1). */
export function EmptyState({ title, children, icon, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center gap-2 rounded-2xl border border-border bg-white px-6 py-8 text-center text-sm", className)}>
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#F0FDFA] text-primary-strong [&>svg]:h-5 [&>svg]:w-5" aria-hidden>
        {icon ?? <Hourglass />}
      </div>
      <strong className="text-[15px] font-semibold text-foreground">{title}</strong>
      {children ? <p className="max-w-[280px] text-muted-foreground">{children}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
