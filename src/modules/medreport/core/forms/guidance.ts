/**
 * Referrer forms – guidance: what the drafting step and the reviewer are told a question wants.
 *
 * Pure: no React, no Node built-ins, no env. Split out of core/forms.ts by W0.4 (bh2 module split, pure move; core/forms.ts re-exports it).
 * Owner: WE (data, maps and mapping page) – docs/bh2-ownership.json.
 */
import { ANSWER_TYPE_LABELS } from "../labels";
import type { FormField } from "../types";

/** Guidance for the AI and the reviewer: the referrer's brief plus the expected answer shape. */
export function fieldGuidance(field: FormField): string {
  const parts = [field.guidance.trim()];
  if (field.section) parts.push(`Form section: ${field.section}.`);
  parts.push(`Answer type: ${ANSWER_TYPE_LABELS[field.answerType]}.`);
  if (field.options?.length) parts.push(`Options as printed: ${field.options.map((o) => `"${o}"`).join(", ")}.`);
  return parts.filter(Boolean).join(" ");
}
