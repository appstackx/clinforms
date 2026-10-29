/**
 * The context menu's keyboard rules (pure, browser-safe – tested in kit.test.ts): which item the roving focus
 * moves to for ↑ ↓ Home End, skipping disabled items and wrapping round, and where the menu opens so it stays on
 * the screen.
 */

export type MenuKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

/**
 * The index of the item that takes focus after `key`, from `current` (-1 = none yet). Disabled items are skipped;
 * ↑ and ↓ wrap round. -1 when every item is disabled.
 */
export function nextMenuIndex(current: number, key: MenuKey, disabled: readonly boolean[]): number {
  const n = disabled.length;
  if (n === 0 || disabled.every(Boolean)) return -1;
  const firstFrom = (start: number, step: 1 | -1): number => {
    for (let i = 0; i < n; i++) {
      const at = (((start + step * i) % n) + n) % n;
      if (!disabled[at]) return at;
    }
    return -1;
  };
  if (key === "Home") return firstFrom(0, 1);
  if (key === "End") return firstFrom(n - 1, -1);
  if (key === "ArrowDown") return firstFrom(current < 0 ? 0 : current + 1, 1);
  return firstFrom(current < 0 ? n - 1 : current - 1, -1);
}

/** The index of the next enabled item whose label starts with `char` after `current` (type-ahead); -1 if none. */
export function typeaheadIndex(current: number, char: string, labels: readonly string[], disabled: readonly boolean[]): number {
  const c = char.toLowerCase();
  const n = labels.length;
  for (let i = 1; i <= n; i++) {
    const at = (((current + i) % n) + n) % n;
    if (!disabled[at] && labels[at].trim().toLowerCase().startsWith(c)) return at;
  }
  return -1;
}

/** Keeps a menu of `size` opened at `point` inside the viewport (8 px from each edge). */
export function placeMenu(point: { x: number; y: number }, size: { width: number; height: number }, viewport: { width: number; height: number }): { left: number; top: number } {
  const margin = 8;
  const left = Math.max(margin, Math.min(point.x, viewport.width - size.width - margin));
  // Not enough room below: open upwards from the point.
  const below = point.y + size.height + margin <= viewport.height;
  const top = below ? point.y : Math.max(margin, point.y - size.height);
  return { left, top };
}
