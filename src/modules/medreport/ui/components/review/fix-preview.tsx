"use client";

/**
 * One-click fix preview (bh2 W0 follow-up stub for WD, seam "fix-preview-ui", bh2-base2): WD design 6 – every fix the
 * engine offers for a flag shows its before/after first (core/fix-types.ts FixProposal: `before`, `after`, the removed
 * spans) and can be undone; applying it dispatches the reducer's `applyFix {proposal}` (use-review-state.ts, WC) through
 * `onApply`. WC places this component next to a flag (issues.tsx / question-card.tsx, its files); WD fills it in
 * (the proposals come from WD's ui/components/review/fixes.ts) without editing WC's files.
 *
 * Stub: renders nothing – no fix is offered as a FixProposal yet.
 * Owner: WD (drafting and text edits; the one-click engine) – docs/bh2-ownership.json.
 */
import type { Actor } from "../../../core/actor";
import type { FixProposal } from "../../../core/fix-types";
import type { Report, ReportFlag } from "../../../core/types";

export interface FixPreviewProps {
  report: Report;
  flag: ReportFlag;
  actor: Actor;
  /** Apply the proposal (the review screen dispatches `applyFix {proposal}` as `actor`). */
  onApply(proposal: FixProposal): void;
}

export function FixPreview(props: FixPreviewProps): null {
  void props;
  return null;
}
