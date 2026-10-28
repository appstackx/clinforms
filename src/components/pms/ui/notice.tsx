import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type NoticeTone = "info" | "warning" | "error" | "success";

const TONES: Readonly<Record<NoticeTone, { box: string; icon: string; Icon: typeof Info; role: "note" | "alert" | "status" }>> = {
  info: { box: "bg-[#EFF4FF] border-[#C7D4F5]", icon: "text-[#1842B4]", Icon: Info, role: "note" },
  warning: { box: "bg-[#FFFBEB] border-[#FBD38D]", icon: "text-accent-text", Icon: AlertTriangle, role: "note" },
  error: { box: "bg-[#FEF2F2] border-[#FECACA]", icon: "text-destructive-strong", Icon: XCircle, role: "alert" },
  success: { box: "bg-[#F0FDF4] border-[#A7E8BE]", icon: "text-[#166534]", Icon: CheckCircle, role: "status" },
};

export interface PmsNoticeProps {
  tone?: NoticeTone;
  title: ReactNode;
  children?: ReactNode;
  /** Override the ARIA role (default: info/warning "note", error "alert", success "status"). */
  role?: "note" | "alert" | "status";
  className?: string;
}

/**
 * An inline message (design system v1, "Notices"): icon + bold title + plain body. Errors are announced at once
 * (role="alert"), successes politely (role="status").
 */
export function PmsNotice({ tone = "info", title, children, role, className }: PmsNoticeProps) {
  const t = TONES[tone];
  return (
    <div role={role ?? t.role} className={cn("flex gap-2.5 rounded-xl border px-3.5 py-3 text-sm", t.box, className)}>
      <t.Icon className={cn("mt-0.5 h-4 w-4 shrink-0", t.icon)} aria-hidden />
      <div className="flex min-w-0 flex-col gap-0.5 text-foreground">
        <strong className="font-semibold">{title}</strong>
        {children ? <span className="text-[#334155]">{children}</span> : null}
      </div>
    </div>
  );
}
