/**
 * ID helpers (pure; browser and Node 22 both provide globalThis.crypto).
 */
import { NOTE_ID_PATTERN, REGISTRATION_SOURCE_ID } from "./schemas";

/** Random ID with a readable prefix, e.g. `rpt_3f9c2a7b1d4e`. */
export function createId(prefix: string): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex}`;
}

/** 1 → "N-001". The mapper assigns note IDs in date/time order. */
export function formatNoteId(n: number): string {
  return `N-${String(n).padStart(3, "0")}`;
}

export function isNoteId(id: string): boolean {
  return NOTE_ID_PATTERN.test(id);
}

export function isFactId(id: string): boolean {
  return /^FACT-[A-Za-z0-9-]+$/.test(id);
}

/** True for "REG", "N-###" and "FACT-*" (shape only; existence is checked by the validators). */
export function isCitableIdShape(id: string): boolean {
  return id === REGISTRATION_SOURCE_ID || isNoteId(id) || isFactId(id);
}
