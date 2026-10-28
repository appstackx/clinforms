/**
 * A clinical note in a list (record overview, Clinical notes tab, case page): title, "Today · Priya Shah · draft
 * saved 11:40", and its state as a pill (Unsigned / Signed / Amended / Entered in error). Server-safe.
 */
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { StatusPill } from "@/components/pms/ui";
import type { NoteSummary } from "@/modules/pms/records/types";
import { dayLabel, timeLabel } from "./format";

export function noteState(n: Pick<NoteSummary, "status" | "amendmentCount" | "enteredInError">): { status: string; label?: string } {
  if (n.status === "draft") return { status: "unsigned" };
  if (n.status === "discarded") return { status: "discarded" };
  if (n.enteredInError) return { status: "discarded", label: "Entered in error" };
  return n.amendmentCount > 0 ? { status: "amended" } : { status: "signed" };
}

export function noteTitle(n: Pick<NoteSummary, "templateName">): string {
  return n.templateName;
}

export function noteMeta(n: NoteSummary, today: string): string {
  const parts = [dayLabel(n.seenOn, today), n.authorName ?? ""];
  if (n.status === "draft") parts.push(`draft saved ${timeLabel(n.updatedAt)}`);
  else if (n.amendmentCount > 0) parts.push(`amended ${n.amendmentCount === 1 ? "once" : `${n.amendmentCount} times`}`);
  return parts.filter(Boolean).join(" · ");
}

export function NoteRow({ note, href, today }: { note: NoteSummary; href: string; today: string }) {
  const s = noteState(note);
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl border border-border bg-white px-3.5 py-2.5 hover:bg-[#F8FAFC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <strong className="truncate text-sm font-semibold text-foreground">{noteTitle(note)}</strong>
        <span className="truncate text-xs text-[#475569]">{noteMeta(note, today)}</span>
      </span>
      <StatusPill kind="note" status={s.status} label={s.label} size="sm" />
      <ChevronRight className="h-4 w-4 shrink-0 text-[#64748B] md:hidden" aria-hidden />
    </Link>
  );
}
