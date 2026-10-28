"use client";
/**
 * Client pieces of the patient record's header: the tab row (links, the current one marked, arrow keys move along
 * it) and the "More actions" menu (Esc closes it, focus returns to the button).
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export interface RecordTabLink {
  href: string;
  label: string;
  count?: number | null;
  /** The record's first page: current only on exactly its own path. */
  exact: boolean;
}

export function RecordTabs({ tabs }: { tabs: RecordTabLink[] }) {
  const pathname = usePathname();
  const refs = useRef<(HTMLAnchorElement | null)[]>([]);
  const onKey = (i: number, e: React.KeyboardEvent) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    refs.current[(i + step + tabs.length) % tabs.length]?.focus();
  };
  return (
    <nav aria-label="Patient record sections" data-scroll-x className="relative w-full min-w-0 max-w-full overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b border-border">
        {tabs.map((t, i) => {
          const current = t.exact ? pathname === t.href : pathname === t.href || pathname.startsWith(`${t.href}/`);
          return (
            <li key={t.href}>
              <Link
                ref={(el) => {
                  refs.current[i] = el;
                }}
                href={t.href}
                aria-current={current ? "page" : undefined}
                onKeyDown={(e) => onKey(i, e)}
                className={cn(
                  "-mb-px inline-flex h-11 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary",
                  current ? "border-primary text-foreground" : "border-transparent text-[#475569] hover:text-foreground",
                )}
              >
                {t.label}
                {t.count ? (
                  <span className="rounded-full bg-[#F1F5F9] px-1.5 text-[11px] font-semibold leading-[18px] text-[#475569]">
                    {t.count}
                    <span className="sr-only"> items</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export interface MenuItem {
  label: string;
  href: string;
  /** A download (subject-access copy): a plain link, no client navigation. */
  download?: boolean;
  /** Shown on phones only (the actions the header hides there). */
  phoneOnly?: boolean;
}

export function MoreActionsMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>("a")?.focus();
    const close = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  if (items.length === 0) return null;
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      button.current?.focus();
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const links = Array.from(menu.current?.querySelectorAll<HTMLElement>("a") ?? []).filter((a) => a.offsetParent !== null);
      const i = links.indexOf(document.activeElement as HTMLElement);
      links[(i + (e.key === "ArrowDown" ? 1 : -1) + links.length) % links.length]?.focus();
    }
  };
  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] border border-border bg-white text-foreground hover:bg-[#F8FAFC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </button>
      {open ? (
        <div ref={menu} role="menu" aria-label="More actions" onKeyDown={onKey} className="absolute right-0 top-[calc(100%+6px)] z-40 flex w-[min(260px,calc(100vw-32px))] flex-col rounded-xl border border-border bg-white p-1.5 text-sm shadow-[0_12px_32px_rgba(15,23,42,0.14)]">
          {items.map((item) =>
            item.download ? (
              <a key={item.href} role="menuitem" href={item.href} download className={cn("rounded-lg px-3 py-2 hover:bg-[#F1F5F9] focus-visible:bg-[#F1F5F9] focus-visible:outline-none", item.phoneOnly && "md:hidden")}>
                {item.label}
              </a>
            ) : (
              <Link key={item.href} role="menuitem" href={item.href} onClick={() => setOpen(false)} className={cn("rounded-lg px-3 py-2 hover:bg-[#F1F5F9] focus-visible:bg-[#F1F5F9] focus-visible:outline-none", item.phoneOnly && "md:hidden")}>
                {item.label}
              </Link>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
