/** The Healthcode bill status as a small pill (HC13). Presentational, server or client. */
import { cn } from "@/lib/utils";
import { HEALTHCODE_BILL_STATUS_TONES, billStatusLabel, type HealthcodeBillStatus } from "@/modules/pms/billing/healthcode";

const TONE: Record<"info" | "success" | "warning" | "neutral" | "none", string> = {
  info: "border-[#BFD3F8] bg-[#EEF4FF] text-[#1842B4]",
  success: "border-[#A7E3C4] bg-[#ECFDF3] text-[#0F6B3E]",
  warning: "border-[#F5D08A] bg-[#FFF8E6] text-[#864E0E]",
  neutral: "border-[#CBD5E1] bg-[#F8FAFC] text-[#334155]",
  none: "border-dashed border-[#CBD5E1] bg-white text-[#475569]",
};

export function BillStatusPill({ status }: { status: HealthcodeBillStatus | null }) {
  const tone = status ? HEALTHCODE_BILL_STATUS_TONES[status] : "none";
  return (
    <span className={cn("inline-flex h-6 items-center whitespace-nowrap rounded-full border px-2 text-xs font-medium", TONE[tone])} data-testid="bill-status" data-status={status ?? ""}>
      {billStatusLabel(status)}
    </span>
  );
}
