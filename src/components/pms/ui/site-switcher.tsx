"use client";
import * as React from "react";
import { Check, ChevronDown, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

export const ALL_SITES = "all";

export interface SiteOption {
  id: string;
  name: string;
  /** Small note on the right ("Default"). */
  note?: string;
}

export interface SiteSwitcherProps {
  /** The sites the member may use. */
  sites: readonly SiteOption[];
  /** A site id, or ALL_SITES. */
  value: string;
  onChange: (value: string) => void;
  /** All the clinic's sites (for "You have access to x of y sites"). */
  totalSites: number;
  /** Offer "All my sites (n)" (only with more than one site). Default true. */
  allowAll?: boolean;
  /** Note beside "All my sites" (the design: "Reports only"). */
  allNote?: string;
  /** Start open (the design-system preview). */
  defaultOpen?: boolean;
  className?: string;
}

/**
 * The site the member is working at (design system v1, "Site switcher"): a button with the site's name, a list
 * with a search box, "All my sites (n)" and "You have access to x of y sites". Keyboard: ↓/↑ move, Enter picks,
 * Esc closes and returns focus to the button. The caller stores the choice (no data fetching here).
 */
export function SiteSwitcher({ sites, value, onChange, totalSites, allowAll = true, allNote, defaultOpen = false, className }: SiteSwitcherProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const listId = React.useId();

  const options = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const list: SiteOption[] = sites.filter((s) => !q || s.name.toLowerCase().includes(q));
    if (allowAll && sites.length > 1 && (!q || "all my sites".includes(q))) list.push({ id: ALL_SITES, name: `All my sites (${sites.length})`, note: allNote });
    return list;
  }, [sites, query, allowAll, allNote]);

  const current = value === ALL_SITES ? `All my sites (${sites.length})` : sites.find((s) => s.id === value)?.name ?? "Choose a site";

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  React.useEffect(() => {
    if (open && !defaultOpen) searchRef.current?.focus();
  }, [open, defaultOpen]);

  React.useEffect(() => {
    const i = options.findIndex((o) => o.id === value);
    setActive(i >= 0 ? i : 0);
  }, [options, value]);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery("");
    buttonRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (options[active]) pick(options[active].id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    }
  };

  const optionId = (i: number) => `${listId}-opt-${i}`;

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-full min-w-0 items-center gap-2 rounded-[8px] border border-input-strong bg-white px-2.5 text-sm font-medium text-foreground hover:bg-[#F8FAFC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <MapPin className="h-4 w-4 shrink-0 text-primary-strong" aria-hidden />
        <span className="sr-only">Site: </span>
        <span className="min-w-0 flex-1 truncate text-left">{current}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[#475569]" aria-hidden />
      </button>
      {open ? (
        <div className="absolute left-0 top-[calc(100%+6px)] z-50 flex w-[min(300px,calc(100vw-32px))] min-w-full flex-col rounded-xl border border-border bg-white p-1.5 text-sm shadow-[0_12px_32px_rgba(15,23,42,0.12)]">
          <div className="px-2 py-1.5">
            <input
              ref={searchRef}
              type="search"
              aria-label="Find a site"
              placeholder="Find a site"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={options[active] ? optionId(active) : undefined}
              className="h-8 w-full rounded-[8px] border border-border bg-[#F1F5F9] px-2.5 placeholder:text-[#475569] focus-visible:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
            />
          </div>
          <div id={listId} role="listbox" aria-label="Sites" className="flex max-h-[280px] flex-col overflow-y-auto">
            {options.length === 0 ? <p className="px-2 py-2 text-muted-foreground">No site matches.</p> : null}
            {options.map((o, i) => {
              const selected = o.id === value;
              return (
                <div
                  key={o.id}
                  id={optionId(i)}
                  role="option"
                  aria-selected={selected}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(o.id)}
                  onMouseEnter={() => setActive(i)}
                  className={cn("flex cursor-pointer items-center gap-2 rounded-[8px] p-2 text-foreground", selected ? "bg-[#F0FDFA]" : i === active ? "bg-[#F8FAFC]" : "", i === active && "outline outline-1 outline-primary/40")}
                >
                  <span className="inline-flex w-4 shrink-0 text-primary-strong" aria-hidden>
                    {selected ? <Check className="h-4 w-4" /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{o.name}</span>
                  {o.note ? <span className="shrink-0 text-xs text-muted-foreground">{o.note}</span> : null}
                </div>
              );
            })}
          </div>
          <div className="mt-1 border-t border-border p-2 text-xs text-muted-foreground">
            You have access to {sites.length} of {totalSites} {totalSites === 1 ? "site" : "sites"}
          </div>
        </div>
      ) : null}
    </div>
  );
}
