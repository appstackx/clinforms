"use client";

/**
 * The one-click corrections offered on a flag (bh2-rc1 integration, plan WI; WB E-UI / check2-WB m4, WD "FixPreview
 * placement"): the engine's text fixes (fixes.ts offeredFixes – WD's own and WB's generators, each checked by the
 * engine's rules) shown with their before and after first through WD's FixPreview, and WB's one-click actions that are
 * not text fixes (fixes.ts offeredActions): "Accept as my note's words" – the approving physio accepts, in one click, a
 * return or work-status line their own note records, shown the note's words (Khuram 26/10) – and "Remove the note link".
 * Both are dispatched as review actions, so WC's reducer decides who may (the approver alone) and stamps who and when.
 *
 * reviewOneClicks works the offers out once per report change (the engine re-validates a copy per candidate), and
 * the review screen hands them to every flag. Neutral wording; a fix is the person's choice, never the default button.
 */
import { useState } from "react";
import type { Actor } from "../../../core/actor";
import type { FixProposal } from "../../../core/fix-types";
import type { FormDefinition, Report, ReportFlag, ReportTemplate } from "../../../core/types";
import { FixPreview } from "./fix-preview";
import { offeredActions, offeredFixes, type OfferedAction } from "./fixes";
import type { ReviewAction } from "./use-review-state";

export interface ReviewOneClicks {
  fixes: FixProposal[];
  actions: OfferedAction[];
}

export const NO_ONE_CLICKS: ReviewOneClicks = { fixes: [], actions: [] };

/** Every one-click the review offers `actor` on `report` (its flags the validators' latest). */
export function reviewOneClicks(report: Report, ctx: { actor: Actor; template: ReportTemplate | null; form: FormDefinition | null }): ReviewOneClicks {
  if (report.status === "signed" || !ctx.template) return NO_ONE_CLICKS;
  try {
    return { fixes: offeredFixes(report, { actor: ctx.actor, template: ctx.template, form: ctx.form }), actions: offeredActions(report, { actor: ctx.actor }) };
  } catch {
    // An offer is a convenience: a report the engine cannot read offers none, and the flags still say what to do.
    return NO_ONE_CLICKS;
  }
}

/** The offers that belong to one flag: its own text fixes, and the actions on its paragraph that answer its check. */
export function offersForFlag(all: ReviewOneClicks, flag: ReportFlag): ReviewOneClicks {
  const fixes = all.fixes.filter((p) => (p.flagId ? p.flagId === flag.id : p.paragraphId === flag.paragraphId));
  const actions = all.actions.filter(
    (a) => a.paragraphId === flag.paragraphId && ((a.kind === "accept-note-words" && flag.code === "OPINION_LANGUAGE" && (!flag.evidence || a.noteWords?.phrase === flag.evidence.toLowerCase() || a.noteWords?.sentence.toLowerCase().includes(flag.evidence.toLowerCase()))) || (a.kind === "remove-note-link" && flag.code === "OTHER_CLINICIAN_VOICE")),
  );
  return { fixes, actions };
}

export function OneClickOffers({
  report,
  flag,
  actor,
  dispatch,
  offers,
  template,
  form,
  readOnly,
  skipGenerators,
}: {
  report: Report;
  flag: ReportFlag;
  actor: Actor;
  dispatch(action: ReviewAction): void;
  /** reviewOneClicks for the whole report (worked out once per report change). */
  offers: ReviewOneClicks;
  template?: ReportTemplate;
  form?: FormDefinition | null;
  readOnly?: boolean;
  /** Generators the flag already offers itself (FlagItem's own fix, e.g. "Name X instead"). */
  skipGenerators?: readonly string[];
}) {
  const [done, setDone] = useState<string | null>(null);
  if (readOnly || flag.acknowledged) return null;
  const mine = offersForFlag(offers, flag);
  const fixes = mine.fixes.filter((p) => !(skipGenerators ?? []).includes(p.generator));
  if (fixes.length === 0 && mine.actions.length === 0 && !done) return null;
  return (
    <div className="mt-1.5 space-y-1.5">
      {fixes.length > 0 && <FixPreview report={report} flag={flag} actor={actor} proposals={fixes} template={template} form={form ?? null} onApply={(proposal) => dispatch({ type: "applyFix", proposal, actor })} />}
      {mine.actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {mine.actions.map((a) => (
            <button
              key={`${a.kind}:${a.paragraphId}:${a.noteWords?.phrase ?? ""}`}
              type="button"
              className="inline-flex min-h-7 items-center rounded-md border border-slate-300 bg-white px-2.5 py-1 text-left text-xs font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488]"
              onClick={() => {
                if (a.kind === "accept-note-words" && a.noteWords) {
                  const { phrase, sentence, noteId, noteSentence } = a.noteWords;
                  dispatch({ type: "acceptNoteWords", key: a.key, paragraphId: a.paragraphId, check: "OPINION_LANGUAGE", phrase, sentence, noteId, reason: `The note's words: “${noteSentence}”.`, actor });
                } else if (a.kind === "remove-note-link") {
                  dispatch({ type: "removeNoteLink", key: a.key, paragraphId: a.paragraphId, actor });
                }
                setDone(a.label);
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
      {done && mine.actions.length === 0 && fixes.length === 0 && <p className="text-xs">Done: {done}.</p>}
    </div>
  );
}
