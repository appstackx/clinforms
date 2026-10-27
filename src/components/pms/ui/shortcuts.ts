/** Keyboard shortcuts: the shared list and the "is the person typing?" rule. Pure. */

export interface Shortcut {
  label: string;
  keys: readonly string[];
}

export interface ShortcutGroup {
  title: string;
  shortcuts: readonly Shortcut[];
}

/** Shortcuts that work on every clinic-system page (the shell handles them). */
export const GLOBAL_SHORTCUTS: readonly Shortcut[] = [
  { label: "Search patients", keys: ["/"] },
  { label: "Show all shortcuts", keys: ["?"] },
];

/** The diary's shortcuts from the design – the diary screens register them when they land. */
export const DIARY_SHORTCUTS: readonly Shortcut[] = [
  { label: "New appointment", keys: ["N"] },
  { label: "Go to today", keys: ["T"] },
  { label: "Previous / next day", keys: ["[", "]"] },
  { label: "Move selected appointment", keys: ["M", "↑", "↓", "←", "→"] },
];

/** A single-key shortcut must never fire while someone types in a field. */
export function isTypingTarget(target: { tagName?: string; isContentEditable?: boolean; type?: string } | null | undefined): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = (target.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const type = (target.type ?? "text").toLowerCase();
  return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(type);
}

/** Whether a key press is the plain shortcut key (no Ctrl/Alt/Meta – those belong to the browser). */
export function isPlainKey(e: { key: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean }, key: string): boolean {
  return e.key === key && !e.ctrlKey && !e.altKey && !e.metaKey;
}
