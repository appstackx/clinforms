"use client";
import * as React from "react";

/**
 * Makes a panel modal without moving it into a Radix Dialog: while `active`, everything on the page outside the
 * panel is `inert` (no focus, no clicks, hidden from screen readers) – except the toasts (`[data-modal-keep]`), so
 * an "Undo" toast stays announced and usable – and Tab / Shift+Tab cycle inside the panel. Dialogs opened later
 * from inside the panel (portalled to <body>) are not made inert; they trap focus themselves.
 *
 * Use it for a side panel that must stay open while toasts report its changes (the diary's appointment drawer):
 * render the panel in a portal on <body> with role="dialog" aria-modal="true".
 */
export function useModalLayer(ref: React.RefObject<HTMLElement>, active: boolean): void {
  React.useEffect(() => {
    const panel = ref.current;
    if (!active || !panel) return;
    const made = inertOutside([panel, ...Array.from(document.querySelectorAll<HTMLElement>("[data-modal-keep]"))]);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const target = e.target instanceof Node ? e.target : null;
      // Only when focus is in the panel (or lost on <body>): a dialog opened above it handles its own Tab.
      if (target && target !== document.body && !panel.contains(target)) return;
      const items = tabbables(panel);
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === first || at === panel || !panel.contains(at))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (at === last || !panel.contains(at))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      for (const el of made) el.removeAttribute("inert");
    };
  }, [ref, active]);
}

const SKIP = new Set(["SCRIPT", "STYLE", "LINK", "TEMPLATE", "NOSCRIPT"]);

/** Sets `inert` on every element that contains none of `keep` (siblings along each kept element's path). */
export function inertOutside(keep: readonly HTMLElement[]): HTMLElement[] {
  const made: HTMLElement[] = [];
  const keepSet = new Set<Node>();
  for (const el of keep) for (let n: Node | null = el; n && n !== document.body; n = n.parentNode) keepSet.add(n);
  const walk = (parent: Element) => {
    for (const child of Array.from(parent.children)) {
      if (!(child instanceof HTMLElement) || SKIP.has(child.tagName)) continue;
      if (keep.includes(child)) continue;
      if (keepSet.has(child)) walk(child);
      else if (!child.hasAttribute("inert")) {
        child.setAttribute("inert", "");
        made.push(child);
      }
    }
  };
  walk(document.body);
  return made;
}

const TABBABLE = "a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1']), summary";

function tabbables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter((el) => !el.closest("[inert]") && el.tabIndex >= 0 && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0));
}
