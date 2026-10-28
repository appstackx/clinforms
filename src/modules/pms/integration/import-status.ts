/**
 * The life of an import batch, and of each of its rows. Pure (the repositories enforce it in SQL as well:
 * every change is a conditional UPDATE on the status it expects).
 *
 *   uploading ─(all rows in)→ mapping ─(check)→ checking ─→ checked ─(staff check)→ approved ─(import)→ importing ─→ imported
 *        │                     ↑   └────────────── change the mapping ──────────────┘                                   │
 *        └──────── cancel (before importing; the uploaded rows are wiped) ─────────────→ cancelled          undo ─→ undoing ─→ undone
 *
 * Rows: staged → ready | error | duplicate (by the check) → imported | skipped (by the import) → undone | kept (by undo:
 * a record changed or used since the import is kept, never removed).
 */

export const BATCH_STATUSES = ["uploading", "mapping", "checking", "checked", "approved", "importing", "imported", "undoing", "undone", "cancelled"] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const ROW_STATUSES = ["staged", "ready", "error", "duplicate", "imported", "skipped", "undone", "kept"] as const;
export type RowStatus = (typeof ROW_STATUSES)[number];

export type BatchAction = "add_rows" | "finish_upload" | "map" | "check" | "approve" | "import" | "undo" | "cancel" | "close";

const ALLOWED: Readonly<Record<BatchAction, readonly BatchStatus[]>> = {
  add_rows: ["uploading"],
  finish_upload: ["uploading"],
  map: ["mapping", "checked", "approved"],
  check: ["mapping", "checking", "checked"],
  approve: ["checked"],
  import: ["approved", "importing"],
  undo: ["imported", "undoing"],
  cancel: ["uploading", "mapping", "checking", "checked", "approved"],
  close: ["imported", "undone"],
};

export function canDo(status: BatchStatus, action: BatchAction): boolean {
  return ALLOWED[action].includes(status);
}

export function isBatchStatus(v: unknown): v is BatchStatus {
  return typeof v === "string" && (BATCH_STATUSES as readonly string[]).includes(v);
}

export function isRowStatus(v: unknown): v is RowStatus {
  return typeof v === "string" && (ROW_STATUSES as readonly string[]).includes(v);
}

export const BATCH_STATUS_LABELS: Readonly<Record<BatchStatus, string>> = {
  uploading: "Uploading",
  mapping: "Match the columns",
  checking: "Checking",
  checked: "Ready for the staff check",
  approved: "Checked by staff – ready to import",
  importing: "Importing",
  imported: "Imported",
  undoing: "Undoing",
  undone: "Undone",
  cancelled: "Cancelled",
};

export const ROW_STATUS_LABELS: Readonly<Record<RowStatus, string>> = {
  staged: "Not checked yet",
  ready: "Ready",
  error: "Will not be imported",
  duplicate: "Already in the clinic",
  imported: "Imported",
  skipped: "Not imported",
  undone: "Undone",
  kept: "Kept (changed since the import)",
};

/** The five steps shown at the top of a batch, and which one a status is at. */
export const IMPORT_STEPS = ["Upload", "Match columns", "Check", "Staff check", "Import"] as const;

export function stepOf(status: BatchStatus): number {
  switch (status) {
    case "uploading":
      return 0;
    case "mapping":
      return 1;
    case "checking":
      return 2;
    case "checked":
      return 3;
    case "approved":
    case "importing":
      return 4;
    default:
      return 5;
  }
}

/** An import can be undone for this many days after it finished (design round 2c: "Each import can be undone for 7 days"). */
export const UNDO_DAYS = 7;

/** The last moment an import finished at `importedAt` can be undone (ISO). */
export function undoUntil(importedAt: string): string {
  return new Date(Date.parse(importedAt) + UNDO_DAYS * 86_400_000).toISOString();
}

export interface BatchCounts {
  total: number;
  ready: number;
  /** Ready rows that carry at least one warning. */
  warnings: number;
  errors: number;
  duplicates: number;
  imported: number;
  skipped: number;
  undone: number;
  kept: number;
  /** Payers and referrers the import adds to the directory. */
  directoryAdded: number;
}

export function emptyCounts(total = 0): BatchCounts {
  return { total, ready: 0, warnings: 0, errors: 0, duplicates: 0, imported: 0, skipped: 0, undone: 0, kept: 0, directoryAdded: 0 };
}

/** Counts from storage (missing or wrong numbers are 0). */
export function cleanCounts(raw: unknown): BatchCounts {
  const out = emptyCounts();
  if (!raw || typeof raw !== "object") return out;
  for (const k of Object.keys(out) as (keyof BatchCounts)[]) {
    const v = (raw as Record<string, unknown>)[k];
    out[k] = typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0;
  }
  return out;
}

/** "120 ready (4 with warnings), 3 will not be imported, 2 already in the clinic". */
export function describeCounts(c: BatchCounts, noun: string): string {
  const parts: string[] = [];
  if (c.imported) parts.push(`${c.imported.toLocaleString("en-GB")} ${noun} imported`);
  if (c.ready) parts.push(`${c.ready.toLocaleString("en-GB")} ready${c.warnings ? ` (${c.warnings.toLocaleString("en-GB")} with warnings)` : ""}`);
  if (c.errors) parts.push(`${c.errors.toLocaleString("en-GB")} will not be imported`);
  if (c.duplicates) parts.push(`${c.duplicates.toLocaleString("en-GB")} already in the clinic`);
  if (c.skipped) parts.push(`${c.skipped.toLocaleString("en-GB")} not imported`);
  if (c.undone) parts.push(`${c.undone.toLocaleString("en-GB")} undone`);
  if (c.kept) parts.push(`${c.kept.toLocaleString("en-GB")} kept`);
  return parts.length ? parts.join(", ") : `${c.total.toLocaleString("en-GB")} rows`;
}

/**
 * A sample of row numbers for the staff check: `size` rows spread over the ready rows, the same every time for a
 * batch (seeded by its id), so two people checking see the same rows.
 */
export function sampleRowNumbers(readyRowNumbers: readonly number[], batchId: string, size = 8): number[] {
  if (readyRowNumbers.length <= size) return readyRowNumbers.slice();
  let seed = 0;
  for (let i = 0; i < batchId.length; i++) seed = (Math.imul(seed, 31) + batchId.charCodeAt(i)) >>> 0;
  const picked = new Set<number>();
  // First and last rows always (where mapping mistakes show), the rest spread out.
  picked.add(readyRowNumbers[0]);
  picked.add(readyRowNumbers[readyRowNumbers.length - 1]);
  while (picked.size < size) {
    seed = (Math.imul(seed ^ (seed >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    picked.add(readyRowNumbers[seed % readyRowNumbers.length]);
  }
  return Array.from(picked).sort((a, b) => a - b);
}
