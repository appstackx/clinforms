/**
 * Referrer forms – headings: each question's section heading for grouping on screen.
 *
 * Pure: no React, no Node built-ins, no env. Split out of core/forms.ts by W0.4 (bh2 module split, pure move; core/forms.ts re-exports it).
 * Owner: WE (data, maps and mapping page) – docs/bh2-ownership.json.
 */
import type { FormField } from "../types";

/**
 * Fix round 1 (B0-21): each question's section heading for grouping on screen. A run of questions the map gives no
 * section takes the heading around it when the questions before and after it share one (10Bridge's address lines
 * between two "CLAIMANT DETAILS" questions); otherwise it keeps none ("" – its own group).
 */
export function sectionHeadings(fields: ReadonlyArray<Pick<FormField, "section">>): string[] {
  const own = fields.map((f) => f.section?.trim() ?? "");
  return own.map((h, i) => {
    if (h) return h;
    let before = "";
    for (let j = i - 1; j >= 0 && !before; j--) before = own[j];
    let after = "";
    for (let j = i + 1; j < own.length && !after; j++) after = own[j];
    return before && before === after ? before : "";
  });
}
