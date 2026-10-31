"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { pageItems, showingText, totalPagesOf } from "./pagination-model";

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** What is being paged, for the nav's name ("Invoices"). */
  label?: string;
  className?: string;
}

/** "Showing 1–25 of 312" and ‹ 1 2 3 … 13 › (design system v1, "Pagination"). */
export function Pagination({ page, pageSize, total, onPageChange, label, className }: PaginationProps) {
  const pages = totalPagesOf(total, pageSize);
  const current = Math.min(Math.max(1, page), pages);
  const arrow = "inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-border bg-white text-foreground disabled:text-[#94A3B8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
  return (
    <nav aria-label={label ? `${label} pages` : "Pagination"} className={cn("flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-[13px] text-[#475569]", className)}>
      <span>{showingText(current, pageSize, total)}</span>
      <div className="flex items-center gap-1">
        <button type="button" aria-label="Previous page" className={arrow} disabled={current <= 1} onClick={() => onPageChange(current - 1)}>
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        {pageItems(current, pages).map((item, i) =>
          item === "gap" ? (
            <span key={`gap-${i}`} className="px-1" aria-hidden>
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              aria-label={`Page ${item}`}
              aria-current={item === current ? "page" : undefined}
              onClick={() => onPageChange(item)}
              className={cn(
                "h-8 min-w-8 rounded-[8px] border px-1.5 tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                item === current ? "border-primary-strong bg-[#F0FDFA] font-semibold text-[#0B5F58]" : "border-transparent text-foreground hover:bg-[#F1F5F9]",
              )}
            >
              {item}
            </button>
          ),
        )}
        <button type="button" aria-label="Next page" className={arrow} disabled={current >= pages} onClick={() => onPageChange(current + 1)}>
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </nav>
  );
}
