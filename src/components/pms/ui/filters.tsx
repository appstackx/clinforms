"use client";
import type { ReactNode } from "react";
import { Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** The row above a table: search box, filter chips and "Clear filters" (design system v1, "Tables, filters"). */
export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-2 border-b border-border px-4 py-3", className)}>{children}</div>;
}

export interface FilterSearchProps {
  id: string;
  /** For screen readers ("Filter invoices"). */
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
}

export function FilterSearch({ id, label, placeholder, value, onChange }: FilterSearchProps) {
  return (
    <div className="flex h-8 min-w-0 max-w-[320px] flex-[1_1_220px] items-center gap-1.5 rounded-[8px] border border-input-strong bg-white px-2.5 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary">
      <Search className="h-4 w-4 shrink-0 text-[#64748B]" aria-hidden />
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-full min-w-0 flex-1 bg-transparent text-sm placeholder:text-[#64748B] focus:outline-none"
      />
    </div>
  );
}

const chipFocus = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/** "+ Status": opens the caller's filter picker. */
export function FilterAddButton({ children, onClick, expanded }: { children: ReactNode; onClick?: () => void; expanded?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      className={cn("inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-dashed border-input-strong bg-white px-2.5 text-[13px] text-foreground hover:bg-[#F8FAFC]", chipFocus)}
    >
      <Plus className="h-3.5 w-3.5 text-primary-strong" aria-hidden />
      {children}
    </button>
  );
}

/** An applied filter ("Payer: Insurer ×"); the whole chip removes it. */
export function FilterChip({ children, onRemove }: { children: ReactNode; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className={cn("inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-primary bg-[#F0FDFA] px-2.5 text-[13px] font-medium text-[#0B5F58] hover:bg-[#CCFBF1]", chipFocus)}
    >
      {children}
      <X className="h-3.5 w-3.5" aria-hidden />
      <span className="sr-only">Remove filter</span>
    </button>
  );
}

export function ClearFilters({ onClick, children = "Clear filters" }: { onClick: () => void; children?: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn("h-8 rounded-[8px] px-2.5 text-[13px] text-[#475569] hover:bg-[#F1F5F9] hover:text-foreground", chipFocus)}>
      {children}
    </button>
  );
}
