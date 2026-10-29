"use client";
import * as React from "react";

/**
 * Focus goes back to what opened an overlay when it closes – also when the overlay was opened from state (a diary
 * block, a menu item) rather than through a Radix Trigger, where Radix would otherwise drop focus on <body>.
 * Spread the result on DialogPrimitive.Content.
 */
// A layout effect runs before Radix moves focus into the overlay (Radix does that in a passive effect), so the
// element read here is still the opener. On the server there is nothing to read.
const useBeforeFocusMoves = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

export function useReturnFocus(open: boolean, fallback?: React.RefObject<HTMLElement | null>): { onCloseAutoFocus: (e: Event) => void } {
  const opener = React.useRef<HTMLElement | null>(null);
  useBeforeFocusMoves(() => {
    if (open && typeof document !== "undefined") {
      const el = document.activeElement;
      opener.current = el instanceof HTMLElement && el !== document.body ? el : null;
    }
  }, [open]);
  const onCloseAutoFocus = React.useCallback((e: Event) => {
    // The opener may have gone (a link that navigated, a row that re-rendered) – then the fallback, if given.
    const el = opener.current && opener.current.isConnected ? opener.current : (fallback?.current ?? null);
    if (el && el.isConnected) {
      e.preventDefault();
      el.focus();
    }
  }, [fallback]);
  return { onCloseAutoFocus };
}
