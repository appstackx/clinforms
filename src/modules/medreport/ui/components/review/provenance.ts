/**
 * Review workspace model – provenance: who answered a question (a person, or the drafting step).
 *
 * Pure, no React. Split out of review-model.ts by W0.4 (bh2 module split, pure move; review-model.ts re-exports it).
 * Owner: WC (review roles and provenance) – docs/bh2-ownership.json.
 */
import type { ActivityEntry, Report } from "../../../core/types";

/** True when the clinician has changed this question's structured answer (see setStructuredAnswer). */
export function answerChangedByClinician(report: Pick<Report, "activity">, key: string): boolean {
  return report.activity.some((a: ActivityEntry) => a.action === "answer_set" && a.detail.startsWith(`${key}:`));
}

/**
 * True when a person (not the AI) has answered this question: a paragraph they wrote or edited, or a
 * structured answer they set themselves.
 */
export function answeredByPerson(report: Pick<Report, "sections" | "activity">, key: string): boolean {
  const section = report.sections.find((s) => s.key === key);
  if (!section) return false;
  if (section.paragraphs.some((p) => (p.origin === "clinician" || p.origin === "edited") && p.text.trim() !== "")) return true;
  const structured = section.answer && section.answer.kind !== "text" && section.answer.value !== null && section.answer.value !== "";
  return Boolean(structured && answerChangedByClinician(report, key));
}
