/**
 * A clinic's Studio home is a work queue (fix wave 2, from the end-to-end review): forms in progress first,
 * approved ones a click away, and a search over what a member recognises – the patient, the referrer, the
 * form and who approved it. Pure helpers (tested in work-queue.test.ts); the screen is home-screen.tsx.
 */
import type { Report } from "../../../core/types";

export type QueueFilter = "open" | "approved" | "all";

export const QUEUE_FILTERS: ReadonlyArray<{ id: QueueFilter; label: string }> = [
  { id: "open", label: "In progress" },
  { id: "approved", label: "Approved" },
  { id: "all", label: "All" },
];

export interface QueueCounts {
  open: number;
  approved: number;
  all: number;
}

export function queueCounts(reports: readonly Report[]): QueueCounts {
  const approved = reports.filter((r) => r.status === "signed").length;
  return { open: reports.length - approved, approved, all: reports.length };
}

/** The filter shown first: what is in progress, or everything when nothing is. */
export function defaultQueueFilter(counts: QueueCounts): QueueFilter {
  return counts.open > 0 ? "open" : "all";
}

/** Text a member may search by: patient, referrer, form title, who approved it. */
function searchText(r: Report): string {
  return [r.patientLabel, r.form?.title, r.form?.referrer.name, r.instructingParty?.name, r.receipt?.signer.name]
    .filter((x): x is string => typeof x === "string")
    .join(" ")
    .toLowerCase();
}

/** The reports for a filter and a search (every word must match), in the order given (newest first). */
export function filterQueue(reports: readonly Report[], filter: QueueFilter, query: string): Report[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return reports.filter((r) => {
    if (filter === "open" && r.status === "signed") return false;
    if (filter === "approved" && r.status !== "signed") return false;
    if (!words.length) return true;
    const text = searchText(r);
    return words.every((w) => text.includes(w));
  });
}
