/**
 * The clinic's record-keeping settings for clinical notes (pure). Today one: after how many days an unsigned note
 * (a draft) counts as overdue on the unsigned-notes list. Stored in pms_records_settings (one row per clinic);
 * no row = the defaults below.
 */
import { z } from "zod";

export const DEFAULT_UNSIGNED_NOTE_DAYS = 3;
export const MAX_UNSIGNED_NOTE_DAYS = 60;

export interface RecordsSettings {
  unsignedNoteDays: number;
  /** 0 = the defaults (no row yet). */
  rev: number;
  updatedAt: string | null;
}

export const DEFAULT_RECORDS_SETTINGS: RecordsSettings = { unsignedNoteDays: DEFAULT_UNSIGNED_NOTE_DAYS, rev: 0, updatedAt: null };

export const RecordsSettingsInputSchema = z.object({
  unsignedNoteDays: z
    .number({ error: "Enter a number of days" })
    .int("Enter a whole number of days")
    .min(1, "At least 1 day")
    .max(MAX_UNSIGNED_NOTE_DAYS, `At most ${MAX_UNSIGNED_NOTE_DAYS} days`),
});
export type RecordsSettingsInput = z.input<typeof RecordsSettingsInputSchema>;

/** The last consultation date whose unsigned note is overdue today: today minus N days (YYYY-MM-DD, UTC arithmetic on dates). */
export function overdueCutoff(today: string, days: number): string {
  const t = Date.parse(`${today}T00:00:00.000Z`);
  if (!Number.isFinite(t)) throw new Error("overdueCutoff: today must be YYYY-MM-DD");
  return new Date(t - Math.max(0, Math.floor(days)) * 86_400_000).toISOString().slice(0, 10);
}

/** Days since the consultation (0 = today). */
export function daysSince(seenOn: string, today: string): number {
  return Math.round((Date.parse(`${today}T00:00:00.000Z`) - Date.parse(`${seenOn}T00:00:00.000Z`)) / 86_400_000);
}
