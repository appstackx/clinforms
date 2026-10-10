"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
}

/**
 * Fix wave 2: on a phone the clinic navigation scrolls sideways; the edge with more to show fades out, so the
 * cut-off items read as "more this way".
 */
function useEdgeFade() {
  const ref = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const start = el.scrollLeft > 2;
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  if (!edges.start && !edges.end) return { ref, style: undefined };
  const mask = `linear-gradient(to right, ${edges.start ? "transparent 0, #000 28px" : "#000 0"}, ${edges.end ? "#000 calc(100% - 28px), transparent 100%" : "#000 100%"})`;
  return { ref, style: { maskImage: mask, WebkitMaskImage: mask } };
}

export function AppNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const fade = useEdgeFade();
  return (
    <nav ref={fade.ref} style={fade.style} aria-label="Clinic" className="flex gap-0.5 overflow-x-auto sm:gap-1">
      {items.map((item) => {
        const active = item.href === "/app" ? pathname === "/app" : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-lg px-2 py-1.5 text-[13px] font-medium sm:px-3 sm:text-sm",
              active ? "bg-teal-50 text-teal-800" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
