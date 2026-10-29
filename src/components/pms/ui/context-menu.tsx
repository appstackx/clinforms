"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { Kbd } from "./keyboard-hint";
import { nextMenuIndex, placeMenu, typeaheadIndex, type MenuKey } from "./menu-model";

export interface ContextMenuItem {
  key: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  onSelect: () => void;
  /** Red text (Cancel…, Remove). */
  danger?: boolean;
  /** Shown, skipped by the arrow keys, cannot be chosen (aria-disabled). */
  disabled?: boolean;
  /** A shortcut shown on the right ("M"). */
  shortcut?: string;
  /** A line above this item (a new group). */
  separatorBefore?: boolean;
}

export interface ContextMenuProps {
  open: boolean;
  /** Where it opens (viewport px): the pointer for a right-click, the trigger's corner for the keyboard. */
  point: { x: number; y: number } | null;
  items: ContextMenuItem[];
  /** The menu's accessible name ("Actions for Megan Hart"). */
  label: string;
  onClose: () => void;
  /** Where focus goes back to when it closes (default: what had focus when it opened). */
  returnFocusTo?: HTMLElement | null;
  className?: string;
}

/** Whether a key press asks for the context menu: the menu key, or Shift+F10 (WAI-ARIA, Windows convention). */
export function isContextMenuKey(e: Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey">): boolean {
  if (e.ctrlKey || e.altKey || e.metaKey) return false;
  return e.key === "ContextMenu" || (e.shiftKey && e.key === "F10");
}

/** Where a keyboard-opened menu appears: just inside the trigger's top-left corner. */
export function pointOf(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + Math.min(16, r.width / 2)), y: Math.round(r.top + Math.min(16, r.height)) };
}

/**
 * A context menu (design system v1, "Dropdown and context menu"): a list of actions in a small card at the pointer
 * or the focused element. WAI-ARIA menu pattern – role="menu" with menuitems, roving focus (the first item takes
 * focus), ↑ ↓ wrap round, Home / End, type a letter to jump, Enter or Space chooses, Esc or Tab closes; focus goes
 * back to the trigger, then the chosen action runs (so an action that moves focus – a dialog – wins). A click
 * outside closes it. Open it from a trigger's onContextMenu and from Shift+F10 / the menu key (isContextMenuKey).
 *
 *   <ContextMenu open={Boolean(menu)} point={menu?.point ?? null} label="Actions for Megan Hart" items={items} onClose={() => setMenu(null)} />
 */
export function ContextMenu({ open, point, items, label, onClose, returnFocusTo, className }: ContextMenuProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const opener = React.useRef<HTMLElement | null>(null);
  const [active, setActive] = React.useState(-1);
  const [pos, setPos] = React.useState<{ left: number; top: number } | null>(null);
  const [mounted, setMounted] = React.useState(false);
  const itemRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const disabled = items.map((i) => Boolean(i.disabled));
  const disabledKey = disabled.join(",");

  React.useEffect(() => setMounted(true), []);

  // Remember the opener before focus moves into the menu.
  React.useLayoutEffect(() => {
    if (!open) return;
    const el = document.activeElement;
    opener.current = returnFocusTo ?? (el instanceof HTMLElement && el !== document.body ? el : null);
    setActive(-1);
  }, [open, returnFocusTo]);

  // Place it on the screen once its size is known.
  React.useLayoutEffect(() => {
    if (!open || !point || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos(placeMenu(point, { width: r.width, height: r.height }, { width: window.innerWidth, height: window.innerHeight }));
  }, [open, point, items.length, mounted]);

  // The first enabled item takes focus (also when the items arrive after the menu opened).
  React.useEffect(() => {
    if (!open) return;
    const flags = disabledKey.split(",").map((x) => x === "true");
    if (active >= 0 && active < flags.length && !flags[active]) return;
    const first = nextMenuIndex(-1, "Home", flags);
    setActive(first);
  }, [open, disabledKey, active]);

  React.useEffect(() => {
    if (open && active >= 0) itemRefs.current[active]?.focus();
  }, [open, active]);

  const close = React.useCallback(
    (refocus: boolean) => {
      onClose();
      const el = opener.current;
      if (refocus && el && el.isConnected) el.focus();
    },
    [onClose],
  );

  // A pointer press outside closes it (focus stays where the press puts it).
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      close(false);
    };
    const onScroll = () => close(false);
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, close]);

  if (!open || !point || !mounted) return null;

  const choose = (i: number) => {
    const item = items[i];
    if (!item || item.disabled) return;
    close(true);
    item.onSelect();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(nextMenuIndex(active, e.key as MenuKey, disabled));
    } else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(active);
    } else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Letters jump to an item; they never reach the page's shortcuts (N, T…) while the menu is open.
      e.preventDefault();
      const at = typeaheadIndex(active, e.key, items.map((i) => i.label), disabled);
      if (at >= 0) setActive(at);
    }
    // Keys never reach the page's shortcuts while the menu is open.
    e.stopPropagation();
  };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      aria-orientation="vertical"
      data-testid="context-menu"
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      className={cn("fixed z-[70] min-w-[220px] max-w-[320px] rounded-[10px] border border-border bg-white p-1 text-sm text-foreground shadow-[0_12px_32px_rgba(15,23,42,0.18)]", className)}
      style={{ left: pos?.left ?? point.x, top: pos?.top ?? point.y, visibility: pos ? "visible" : "hidden" }}
    >
      {items.map((item, i) => {
        const Icon = item.icon;
        return (
          <React.Fragment key={item.key}>
            {item.separatorBefore && i > 0 ? <div role="separator" className="my-1 h-px bg-border" /> : null}
            <div
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              role="menuitem"
              tabIndex={i === active ? 0 : -1}
              aria-disabled={item.disabled ? true : undefined}
              data-menu-key={item.key}
              onClick={() => choose(i)}
              onPointerMove={() => {
                if (!item.disabled && active !== i) setActive(i);
              }}
              className={cn(
                "flex min-h-[36px] cursor-default select-none items-center gap-2 rounded-[6px] px-2.5 py-1.5 outline-none focus:bg-[#F1F5F9] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
                item.danger && "text-destructive-strong",
                item.disabled && "text-[#64748B]",
              )}
            >
              {Icon ? <Icon className="h-4 w-4 shrink-0" aria-hidden /> : <span className="w-4 shrink-0" aria-hidden />}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.shortcut ? <Kbd aria-hidden>{item.shortcut}</Kbd> : null}
            </div>
          </React.Fragment>
        );
      })}
    </div>,
    document.body,
  );
}
