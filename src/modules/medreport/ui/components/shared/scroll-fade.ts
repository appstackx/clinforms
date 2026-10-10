"use client";

/**
 * A horizontal strip that scrolls (the Studio's compact navigation on a phone) fades out at the edge that has
 * more to show (fix wave 2: at 375 px the navigation was cut off with no cue that it scrolls).
 */
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";

/** The mask for a strip that has more to the left (`start`) and/or to the right (`end`). Pure, for tests. */
export function scrollFadeMask(start: boolean, end: boolean, width = 28): string | undefined {
  if (!start && !end) return undefined;
  const from = start ? `transparent 0, #000 ${width}px` : "#000 0";
  const to = end ? `#000 calc(100% - ${width}px), transparent 100%` : "#000 100%";
  return `linear-gradient(to right, ${from}, ${to})`;
}

export function useScrollFade<T extends HTMLElement>(): { ref: RefObject<T>; style: CSSProperties | undefined } {
  const ref = useRef<T>(null);
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
  const mask = scrollFadeMask(edges.start, edges.end);
  return { ref, style: mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined };
}
