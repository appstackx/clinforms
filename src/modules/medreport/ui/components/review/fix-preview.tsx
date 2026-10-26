"use client";

/**
 * One-click fix preview (bh2 WD design 6; seam "fix-preview-ui", bh2-base2): every fix the engine offers for a flag
 * (ui/components/review/fixes.ts offeredFixes – each already checked by the engine's rules) shows its before and after
 * first, is applied only when the person confirms, and can be undone straight after. Applying dispatches the reducer's
 * `applyFix {proposal}` (use-review-state.ts, WC) through `onApply`; Undo dispatches the inverse proposal
 * (fixes.ts undoProposal), which applies only while the paragraph still reads what the fix wrote.
 *
 * WC places this component next to a flag (issues.tsx / question-card.tsx, its files). Neutral wording, no colours that
 * read as "approve": a fix is the person's choice, never the default button.
 * Owner: WD (drafting and text edits; the one-click engine) – docs/bh2-ownership.json.
 */
import { useMemo, useState } from "react";
import type { Actor } from "../../../core/actor";
import type { FixProposal } from "../../../core/fix-types";
import type { FormDefinition, Report, ReportFlag, ReportTemplate } from "../../../core/types";
import { offeredFixes, undoProposal } from "./fixes";

export interface FixPreviewProps {
  report: Report;
  flag: ReportFlag;
  actor: Actor;
  /** Apply the proposal (the review screen dispatches `applyFix {proposal}` as `actor`). */
  onApply(proposal: FixProposal): void;
  /** The report's template and form map (the engine re-validates a copy with them). */
  template?: ReportTemplate;
  form?: FormDefinition | null;
  /** Proposals computed by the caller (else worked out here from template and form). */
  proposals?: FixProposal[];
  readOnly?: boolean;
}

/** The fixes the engine offers for this one flag. */
export function proposalsForFlag(report: Report, flag: ReportFlag, actor: Actor, template: ReportTemplate, form: FormDefinition | null): FixProposal[] {
  return offeredFixes(report, { actor, template, form }).filter((p) => (p.flagId ? p.flagId === flag.id : p.paragraphId === flag.paragraphId));
}

export function FixPreview(props: FixPreviewProps) {
  const { report, flag, actor, onApply, template, form, readOnly } = props;
  const proposals = useMemo(
    () => props.proposals ?? (template ? proposalsForFlag(report, flag, actor, template, form ?? null) : []),
    [props.proposals, template, report, flag, actor, form],
  );
  const [open, setOpen] = useState<FixProposal | null>(null);
  const [applied, setApplied] = useState<FixProposal | null>(null);

  if (readOnly) return null;
  if (applied) {
    return (
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
        <span>Changed: {applied.label}.</span>
        {applied.after.trim() !== "" && (
          <button
            type="button"
            className="inline-flex h-7 items-center rounded-md border border-slate-300 bg-white px-2.5 font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488]"
            onClick={() => {
              onApply(undoProposal(applied));
              setApplied(null);
            }}
          >
            Undo
          </button>
        )}
      </div>
    );
  }
  if (proposals.length === 0) return null;
  if (open) {
    return (
      <div className="mt-1.5 rounded-md border border-slate-300 bg-white p-2.5 text-xs text-slate-800" role="group" aria-label={`Preview: ${open.label}`}>
        <p className="font-semibold">{open.label}</p>
        <p className="mt-1.5 text-slate-600">Now:</p>
        <p className="mt-0.5 whitespace-pre-wrap rounded bg-slate-50 px-2 py-1">{open.before}</p>
        <p className="mt-1.5 text-slate-600">After the change:</p>
        <p className="mt-0.5 whitespace-pre-wrap rounded bg-slate-50 px-2 py-1">{open.after.trim() ? open.after : "(this copy is removed – the first one stays)"}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex h-7 items-center rounded-md bg-slate-800 px-2.5 font-semibold text-white hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488]"
            onClick={() => {
              onApply(open);
              setApplied(open);
              setOpen(null);
            }}
          >
            Make this change
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center rounded-md border border-slate-300 bg-white px-2.5 font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488]"
            onClick={() => setOpen(null)}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-1.5 flex flex-wrap gap-2">
      {proposals.map((p) => (
        <button
          key={`${p.generator}:${p.paragraphId}`}
          type="button"
          className="inline-flex h-7 items-center rounded-md border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488]"
          onClick={() => setOpen(p)}
        >
          {p.label}…
        </button>
      ))}
    </div>
  );
}
