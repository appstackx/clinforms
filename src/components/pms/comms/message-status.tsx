import { Ban, Check, CheckCheck, Clock, Inbox, Loader, Moon, XCircle } from "lucide-react";
import type { OutboxState } from "@/modules/pms/comms/view";
import { cn } from "@/lib/utils";

const STYLES: Readonly<Record<OutboxState, { label: string; cls: string; Icon: typeof Check }>> = {
  planned: { label: "Planned", cls: "bg-[#F1F5F9] text-[#334155]", Icon: Clock },
  held: { label: "Held – quiet hours", cls: "bg-[#EFF4FF] text-[#1842B4]", Icon: Moon },
  sending: { label: "Sending", cls: "bg-[#F1F5F9] text-[#334155]", Icon: Loader },
  outbox: { label: "In the outbox", cls: "bg-[#FEF3C7] text-[#864E0E]", Icon: Inbox },
  sent: { label: "Sent", cls: "bg-[#DCFCE7] text-[#166534]", Icon: Check },
  delivered: { label: "Delivered", cls: "bg-[#DCFCE7] text-[#166534]", Icon: CheckCheck },
  failed: { label: "Failed", cls: "bg-[#FEE2E2] text-[#991B1B]", Icon: XCircle },
  skipped: { label: "Not sent", cls: "bg-[#F1F5F9] text-[#475569]", Icon: Ban },
  cancelled: { label: "Cancelled", cls: "bg-[#F1F5F9] text-[#475569]", Icon: Ban },
};

/** A message's state as colour + icon + word (design round 2c outbox pills). */
export function MessageStatusPill({ state, label }: { state: OutboxState; label?: string }) {
  const s = STYLES[state];
  return (
    <span className={cn("inline-flex h-[22px] shrink-0 items-center gap-[5px] whitespace-nowrap rounded-full pl-1.5 pr-2 text-xs font-medium", s.cls)} data-state={state}>
      <s.Icon className="h-3 w-3" aria-hidden />
      {label ?? s.label}
    </span>
  );
}
