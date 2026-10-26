"use client";
/** The tabs of a patient's record (from every module's record-tabs/<module>.ts), the current one marked. */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface RecordTabLink {
  href: string;
  label: string;
  /** The record's first page: current only on exactly its own path. */
  exact: boolean;
}

export function RecordTabs({ tabs }: { tabs: RecordTabLink[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Patient record" className="-mx-1 flex gap-1 overflow-x-auto border-b border-slate-200 px-1">
      {tabs.map((t) => {
        const current = t.exact ? pathname === t.href || pathname === `${t.href}/edit` : pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "-mb-px whitespace-nowrap rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700",
              current ? "border-teal-700 text-teal-900" : "border-transparent text-slate-700 hover:border-slate-300 hover:text-slate-900",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
