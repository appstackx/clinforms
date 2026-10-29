"use client";
import * as React from "react";
import { ArrowUpDown, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Pagination, type PaginationProps } from "./pagination";
import { SkeletonBar } from "./skeleton";
import { ScrollRegion } from "./scroll-region";

export type SortDirection = "asc" | "desc";

export interface SortState {
  columnId: string;
  direction: SortDirection;
}

export interface DataTableColumn<T> {
  id: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  /** The header becomes a sort button (the caller sorts – the table holds no data logic). */
  sortable?: boolean;
  align?: "left" | "right";
  /** Numbers, dates, money: tabular figures. */
  numeric?: boolean;
  /** Cut long text with an ellipsis at this width (px). */
  truncateAt?: number;
  className?: string;
}

export interface DataTableProps<T> {
  /** Names the table for screen readers ("Invoices"). */
  label: string;
  columns: readonly DataTableColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  /**
   * Below the md breakpoint (phones, 375 px) each row is shown as this card instead of a table row. Required:
   * a wide table squeezed onto a phone is not usable.
   */
  renderCard: (row: T) => React.ReactNode;
  sort?: SortState | null;
  onSortChange?: (sort: SortState) => void;
  /** Tabs above the filters (UnderlineTabsList). */
  tabs?: React.ReactNode;
  /** The filter row (FilterBar with FilterSearch, chips…). */
  filters?: React.ReactNode;
  loading?: boolean;
  /** Shown instead of the rows (an ErrorState). */
  error?: React.ReactNode;
  /** Shown when there are no rows (an EmptyState). */
  empty?: React.ReactNode;
  pagination?: Omit<PaginationProps, "label">;
  /** Minimum width of the table on wider screens; it scrolls inside its own box beyond that. */
  minWidth?: number;
  className?: string;
}

function nextSort(current: SortState | null | undefined, columnId: string): SortState {
  if (current?.columnId === columnId) return { columnId, direction: current.direction === "asc" ? "desc" : "asc" };
  return { columnId, direction: "asc" };
}

/**
 * A list of records (design system v1, "Tables, filters, pagination, tabs"): tabs, filters, sortable headers,
 * pagination, a loading skeleton, empty and error states, and cards instead of a table on phones. Data, sorting
 * and filtering stay with the caller (no fetching here).
 */
export function DataTable<T>({
  label,
  columns,
  rows,
  rowKey,
  renderCard,
  sort,
  onSortChange,
  tabs,
  filters,
  loading,
  error,
  empty,
  pagination,
  minWidth = 720,
  className,
}: DataTableProps<T>) {
  const showRows = !loading && !error && rows.length > 0;
  return (
    <section aria-label={label} aria-busy={loading || undefined} className={cn("overflow-hidden rounded-2xl border border-border bg-white", className)}>
      {tabs}
      {filters}
      {error ? (
        <div className="p-4 [&>*]:border-0">{error}</div>
      ) : loading ? (
        <div role="status" aria-label={`Loading ${label.toLowerCase()}`} className="flex flex-col gap-3.5 p-4">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center gap-4">
              <SkeletonBar className="w-20" />
              <SkeletonBar className="flex-1" />
              <SkeletonBar className="h-5 w-16 rounded-full" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="p-4 [&>*]:border-0">{empty ?? <p className="py-6 text-center text-sm text-muted-foreground">Nothing to show.</p>}</div>
      ) : null}

      {showRows ? (
        <>
          {/* md and up: the table, scrolling inside its own box when narrower than minWidth. */}
          <ScrollRegion label={label} className="relative hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-sm" style={{ minWidth }}>
              <caption className="sr-only">{label}</caption>
              <thead>
                <tr className="bg-[#F8FAFC] text-left text-xs text-[#475569]">
                  {columns.map((col) => {
                    const sorted = sort?.columnId === col.id ? sort.direction : null;
                    return (
                      <th
                        key={col.id}
                        scope="col"
                        aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : col.sortable ? "none" : undefined}
                        className={cn("px-4 py-2.5 font-semibold", col.align === "right" && "text-right")}
                      >
                        {col.sortable && onSortChange ? (
                          <button
                            type="button"
                            onClick={() => onSortChange(nextSort(sort, col.id))}
                            className="inline-flex items-center gap-1 rounded font-semibold hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                          >
                            {col.header}
                            {sorted === "asc" ? (
                              <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                            ) : sorted === "desc" ? (
                              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                            ) : (
                              <ArrowUpDown className="h-3.5 w-3.5 opacity-60" aria-hidden />
                            )}
                          </button>
                        ) : (
                          col.header
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={rowKey(row)} className="border-t border-border hover:bg-[#F8FAFC]">
                    {columns.map((col) => (
                      <td
                        key={col.id}
                        className={cn("px-4 py-2.5 align-middle", col.align === "right" && "text-right", col.numeric && "tabular-nums", col.className)}
                        style={col.truncateAt ? { maxWidth: col.truncateAt } : undefined}
                      >
                        {col.truncateAt ? <span className="block truncate">{col.cell(row)}</span> : col.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
          {/* Phones: one card per row. */}
          <ul className="flex flex-col gap-3 p-4 md:hidden" aria-label={label}>
            {rows.map((row) => (
              <li key={rowKey(row)}>{renderCard(row)}</li>
            ))}
          </ul>
        </>
      ) : null}

      {pagination && !error ? <Pagination {...pagination} label={label} /> : null}
    </section>
  );
}

/** The card a row becomes on a phone (design: "Table → cards at 375 px"). */
export function DataCard({ title, status, meta, figure, className }: { title: React.ReactNode; status?: React.ReactNode; meta?: React.ReactNode; figure?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2 rounded-2xl border border-border bg-white px-4 py-3.5 text-sm", className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 font-semibold">{title}</div>
        {status}
      </div>
      {meta ? <div className="truncate text-[#475569]">{meta}</div> : null}
      {figure ? <div className="text-base font-semibold tabular-nums">{figure}</div> : null}
    </div>
  );
}
