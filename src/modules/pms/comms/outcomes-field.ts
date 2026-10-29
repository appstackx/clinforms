/**
 * The `{{latest_outcomes}}` letter field: for each outcome measure of the letter's case (else the patient's), the first
 * and the latest score – "NPRS 7/10 → 2/10 · ODI 46% → 12%". Pure. Clinical detail: letters only (comms
 * merge-fields marks the field `clinical`; letters need messages.letters, which reception can never have).
 */
import { MEASURES, OUTCOME_MEASURES, formatScore, type OutcomeMeasureId } from "../records/outcomes";

export interface OutcomeScore {
  measure: OutcomeMeasureId;
  /** "YYYY-MM-DD" */
  takenOn: string;
  scoreTenths: number;
  /** Measures marked "entered in error" are left out. */
  status?: "recorded" | "entered_in_error";
  createdAt?: string;
}

/** "" when there is no score (the letter then shows "[not recorded: …]"). */
export function formatLatestOutcomes(scores: readonly OutcomeScore[]): string {
  const parts: string[] = [];
  for (const id of OUTCOME_MEASURES) {
    const mine = scores
      .filter((s) => s.measure === id && s.status !== "entered_in_error")
      .slice()
      .sort((a, b) => a.takenOn.localeCompare(b.takenOn) || (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
    if (mine.length === 0) continue;
    const first = mine[0];
    const last = mine[mine.length - 1];
    const short = MEASURES[id].short;
    parts.push(mine.length === 1 ? `${short} ${formatScore(id, first.scoreTenths)}` : `${short} ${formatScore(id, first.scoreTenths)} → ${formatScore(id, last.scoreTenths)}`);
  }
  return parts.join(" · ");
}
