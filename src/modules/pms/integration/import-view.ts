/** What the import screens get from the server (types only – browser-safe). */
import type { ImportKind } from "./import-kinds";
import type { BatchCounts, BatchStatus, RowStatus } from "./import-status";
import type { ImportMapping } from "./mapping";

export interface ImportFieldChoice {
  key: string;
  label: string;
  required: boolean;
  group: string | null;
  hint: string | null;
}

export interface ImportIssueRow {
  rowNo: number;
  status: RowStatus;
  severity: "error" | "warning";
  messages: string[];
}

export interface ImportView {
  id: string;
  rev: number;
  kind: ImportKind;
  kindLabel: string;
  noun: string;
  status: BatchStatus;
  fileName: string | null;
  rowCount: number;
  headers: string[];
  /** The first row's values (the member's own file), for the mapping step's "Example" column; null once wiped. */
  example: string[] | null;
  mapping: ImportMapping | null;
  /** Field key → a problem with the mapping, if any. */
  mappingProblems: string[];
  fields: ImportFieldChoice[];
  counts: BatchCounts;
  /** Live while checking / importing / undoing. */
  remaining: { staged: number; ready: number; imported: number };
  importedAt: string | null;
  undoneAt: string | null;
  /** Until when the import can be undone (imported only), and why not (null: it can). */
  undoUntil: string | null;
  undoBlocked: string | null;
  /** The kind can be checked but not run here (invoices). */
  runUnavailable: string | null;
}

