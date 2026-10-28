/** Small display helpers for the billing screens (browser-safe). */
import { formatPence, formatUkDate } from "@/modules/pms/core/text";

export const BILLING_PATH = "/app/clinic/billing";

export const money = (pence: number | null | undefined) => formatPence(pence ?? 0);
export const date = (iso: string | null | undefined) => (iso ? formatUkDate(iso) : "–");

/** "12.50" / "£12.50" / "12" → 1250; null when it is not an amount. */
export function parsePounds(text: string): number | null {
  const t = text.replace(/[£,\s]/g, "");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) return null;
  const [pounds, pence = ""] = t.split(".");
  return Number(pounds) * 100 + Number(pence.padEnd(2, "0"));
}

/** 1250 → "12.50" (for an amount box). */
export function poundsText(pence: number): string {
  return (pence / 100).toFixed(2);
}

export const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
