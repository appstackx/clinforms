/**
 * "My unsigned notes" (design round 2, beside the note editor): the member's own drafts, oldest consultation first,
 * "Over 24 h" on the overdue ones (the clinic's setting – records settings, default 24 hours), the current note
 * marked. Server-safe; the data comes from unsignedNotesFor (nothing decrypted).
 */
import Link from "next/link";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { overdueWindowLabel, signWithinText } from "@/modules/pms/records/settings";
import { dayLabel } from "./format";

export interface UnsignedItem {
  id: string;
  href: string;
  patientName: string;
  seenOn: string;
  templateName: string;
  overdue: boolean;
}

export function UnsignedAside({ items, days, currentId, today, className }: { items: UnsignedItem[]; days: number; currentId?: string; today: string; className?: string }) {
  return (
    <aside aria-labelledby="unsigned-heading" className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <h2 id="unsigned-heading" className="text-[15px] font-semibold text-foreground">
          My unsigned notes
        </h2>
        <span className="rounded-full bg-[#FEF3C7] px-2 text-xs font-semibold leading-5 text-[#864E0E]">
          {items.length}
          <span className="sr-only"> unsigned</span>
        </span>
      </div>
      <p className="text-[13px] text-[#475569]">Oldest first. {signWithinText(days)}</p>
      {items.length ? (
        <ul className="flex flex-col gap-2">
          {items.map((u) => (
            <li key={u.id}>
              <Link
                href={u.href}
                aria-current={u.id === currentId ? "page" : undefined}
                className={cn(
                  "flex flex-col gap-0.5 rounded-xl border px-3 py-2.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                  u.id === currentId ? "border-[#99E2D8] bg-[#F0FDFA]" : "border-border bg-white hover:bg-[#F8FAFC]",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <strong className="truncate font-semibold text-foreground">{u.patientName}</strong>
                  {u.overdue ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#FEE2E2] px-1.5 text-[11px] font-semibold leading-5 text-[#991B1B]">
                      <Clock className="h-3 w-3" aria-hidden />
                      Over {overdueWindowLabel(days)}
                    </span>
                  ) : null}
                </span>
                <span className="truncate text-xs text-[#334155]">
                  {dayLabel(u.seenOn, today)} · {u.templateName}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">None – every note is signed.</p>
      )}
    </aside>
  );
}
