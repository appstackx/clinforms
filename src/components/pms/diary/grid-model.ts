/**
 * The diary grid's geometry and the small rules the screens share (design round 2, "Diary – day view"): 15 minutes
 * are 20 px (80 px an hour), moves and resizes snap to 15 minutes, a block's clash check in its target column, the
 * phone list's order. Pure and browser-safe.
 */
import type { DiaryCard, DiaryColumn } from "@/modules/pms/diary/view";
import { localSpan, occupiesDiary } from "@/modules/pms/diary/rules";
import { formatHhmm, isoWeekday, weekdayName } from "@/modules/pms/diary/time";
import { formatUkDate } from "@/modules/pms/core/text";
import type { DiaryBlockStatus } from "../ui/diary-block-model";

export const PX_PER_MINUTE = 80 / 60;
export const SNAP_MINUTES = 15;
export const MIN_LENGTH = 15;
export const MAX_LENGTH = 480;

export const minutesToPx = (minutes: number): number => minutes * PX_PER_MINUTE;
export const pxToMinutes = (px: number): number => px / PX_PER_MINUTE;

/** Rounds to the nearest 15 minutes. */
export function snap(minute: number, step: number = SNAP_MINUTES): number {
  return Math.round(minute / step) * step;
}

/** Keeps a block of `length` minutes inside the grid. */
export function clampStart(start: number, length: number, grid: { start: number; end: number }): number {
  return Math.max(grid.start, Math.min(grid.end - length, start));
}

export function clampLength(length: number, start: number, grid: { start: number; end: number }): number {
  return Math.max(MIN_LENGTH, Math.min(MAX_LENGTH, grid.end - start, length));
}

/** Whole hours of the grid with their offset from the top (px). */
export function hourMarks(grid: { start: number; end: number }): { minute: number; label: string; top: number }[] {
  const out: { minute: number; label: string; top: number }[] = [];
  for (let m = Math.ceil(grid.start / 60) * 60; m < grid.end; m += 60) out.push({ minute: m, label: formatHhmm(m), top: minutesToPx(m - grid.start) });
  return out;
}

/** The card's local start and end minutes on its column's date. */
export function cardSpan(card: Pick<DiaryCard, "startsAt" | "endsAt">, date: string): { start: number; end: number } {
  return localSpan(card, date);
}

/** How the kit's DiaryBlock shows a card. */
export function blockStatusOf(card: Pick<DiaryCard, "kind" | "status">): DiaryBlockStatus {
  return card.kind === "block" ? "blocked" : card.status;
}

/** Whether the card still occupies its slot (cancelled ones read as free). */
export function occupies(card: Pick<DiaryCard, "status">): boolean {
  return occupiesDiary(card.status);
}

/**
 * What a moved or resized card would run into in a column (the screen's live hint – the server checks again):
 * occupying items overlapping [start, end) other than the card itself.
 */
export function clashInColumn(cards: readonly DiaryCard[], column: Pick<DiaryColumn, "key" | "date">, movingId: string, start: number, end: number): DiaryCard | null {
  for (const c of cards) {
    if (c.id === movingId || c.columnKey !== column.key || !occupies(c)) continue;
    const s = cardSpan(c, column.date);
    if (s.start < end && start < s.end) return c;
  }
  return null;
}

/** The same patient's other appointment overlapping [start, end) on `date` (any column) – one patient, one place. */
export function patientClash(cards: readonly DiaryCard[], moving: Pick<DiaryCard, "id" | "patientId">, date: string, start: number, end: number): DiaryCard | null {
  if (!moving.patientId) return null;
  for (const c of cards) {
    if (c.id === moving.id || c.patientId !== moving.patientId || c.kind !== "appointment" || !occupies(c) || c.startsOn !== date) continue;
    const s = cardSpan(c, date);
    if (s.start < end && start < s.end) return c;
  }
  return null;
}

/** Minutes of a column outside its working windows, as bands to shade (grid-relative minutes). */
export function offRotaBands(column: Pick<DiaryColumn, "windows">, grid: { start: number; end: number }): { top: number; height: number }[] {
  const windows = [...column.windows].sort((a, b) => a.startMinute - b.startMinute);
  const bands: { top: number; height: number }[] = [];
  let cursor = grid.start;
  for (const w of windows) {
    const s = Math.max(grid.start, w.startMinute);
    if (s > cursor) bands.push({ top: cursor - grid.start, height: s - cursor });
    cursor = Math.max(cursor, Math.min(grid.end, w.endMinute));
  }
  if (cursor < grid.end) bands.push({ top: cursor - grid.start, height: grid.end - cursor });
  return bands;
}

/** Whether a minute is inside one of the column's windows. */
export function inWindows(column: Pick<DiaryColumn, "windows">, start: number, end: number): boolean {
  return column.windows.some((w) => start >= w.startMinute && end <= w.endMinute);
}

/** "Tue 27/10/2026" */
export function weekdayDate(date: string): string {
  return `${weekdayName(isoWeekday(date)).slice(0, 3)} ${formatUkDate(date)}`;
}

/** "Tuesday 27/10/2026" (the day view's heading). */
export function longDate(date: string): string {
  return `${weekdayName(isoWeekday(date))} ${formatUkDate(date)}`;
}

/** "26/10 – 31/10/2026" (the week view's heading). */
export function weekRange(first: string, last: string): string {
  const [, m1, d1] = first.split("-");
  return `${d1}/${m1} – ${formatUkDate(last)}`;
}

/** Start times for the booking form: every 15 minutes from 07:00 to 20:45. */
export function startTimeOptions(from = 7 * 60, to = 21 * 60): string[] {
  const out: string[] = [];
  for (let m = from; m < to; m += SNAP_MINUTES) out.push(formatHhmm(m));
  return out;
}

/** "DD/MM/YYYY" → "YYYY-MM-DD" (null when not a real date). */
export function ukToIso(value: string): string | null {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(value);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** The share booked as words for the column header ("53% booked"), or null without a rota. */
export function bookedText(percent: number | null): string | null {
  return percent === null ? null : `${percent}% booked`;
}
