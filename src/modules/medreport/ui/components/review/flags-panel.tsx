"use client";

/**
 * Flags & gaps tab: what blocks approval (open gaps, blocking checks), warnings, and what has already
 * been resolved or acknowledged – each with a jump to its question.
 *
 * Owner: studio-b agent.
 */
import { CheckCircle2, Loader2 } from "lucide-react";
import type { EpisodeBundle, Gap, Report, ReportFlag } from "../../../core/types";
import { FlagItem, GapItem } from "./issues";
import { gapResolutionOptions, isOpenBlocking } from "./review-model";
import type { ReviewAction } from "./use-review-state";

export function FlagsPanel({
  report,
  bundle,
  blockingCount,
  readOnly,
  validating,
  actor,
  dispatch,
  onJump,
  onOpenSource,
  canAcknowledge,
  questionLabel,
}: {
  report: Report;
  bundle: EpisodeBundle;
  blockingCount: number;
  readOnly: boolean;
  validating: boolean;
  actor: string;
  dispatch(action: ReviewAction): void;
  onJump(key: string): void;
  onOpenSource(id: string): void;
  canAcknowledge(flag: ReportFlag): boolean;
  questionLabel(key: string): string;
}) {
  const gaps = report.gaps;
  const flags = report.flags.filter((f) => f.code !== "OPEN_GAP");
  const openGaps = gaps.filter((g) => !g.resolution);
  const blocking = flags.filter((f) => isOpenBlocking(f, gaps));
  const warnings = flags.filter((f) => f.severity === "warning" && !f.acknowledged);
  const doneGaps = gaps.filter((g) => g.resolution);
  const doneFlags = flags.filter((f) => f.acknowledged);
  const jumpProps = (key: string | undefined) =>
    key ? { onJump: () => onJump(key), jumpLabel: `Go to ${key.startsWith("F-") ? key : questionLabel(key)}` } : {};

  const gapItem = (g: Gap) => (
    <GapItem
      key={g.id}
      gap={g}
      bundle={bundle}
      readOnly={readOnly}
      resolution={gapResolutionOptions(report, g, actor)}
      onResolve={(gapId, kind, text) => dispatch({ type: "resolveGap", gapId, kind, text, actor })}
      onReopen={(gapId) => dispatch({ type: "reopenGap", gapId, actor })}
      onOpenSource={onOpenSource}
      {...jumpProps(g.sectionKey)}
    />
  );
  const flagItem = (f: ReportFlag) => (
    <FlagItem
      key={f.id}
      flag={f}
      readOnly={readOnly}
      canAck={canAcknowledge(f)}
      onAcknowledge={(flagId, reason) => dispatch({ type: "acknowledgeFlag", flagId, reason, actor })}
      {...jumpProps(f.sectionKey)}
    />
  );

  return (
    <div className="space-y-4">
      <div
        role="status"
        className={
          blockingCount > 0
            ? "flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-900"
            : "flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2.5 text-sm font-medium text-teal-900"
        }
      >
        {validating ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : blockingCount > 0 ? null : (
          <CheckCircle2 className="h-4 w-4 text-teal-700" aria-hidden />
        )}
        <span className="flex-1">
          {readOnly
            ? "Approved – the checks passed at approval."
            : blockingCount > 0
              ? `${blockingCount} item${blockingCount === 1 ? "" : "s"} must be resolved before approval`
              : "Nothing blocks approval"}
        </span>
        {validating && <span className="text-xs font-normal opacity-80">Checking…</span>}
      </div>

      {(openGaps.length > 0 || blocking.length > 0) && (
        <section aria-labelledby="flags-blocking" className="space-y-2">
          <h3 id="flags-blocking" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Blocks approval ({openGaps.length + blocking.length})
          </h3>
          {openGaps.map(gapItem)}
          {blocking.map(flagItem)}
        </section>
      )}

      {warnings.length > 0 && (
        <section aria-labelledby="flags-warnings" className="space-y-2">
          <h3 id="flags-warnings" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Warnings ({warnings.length})
          </h3>
          {warnings.map(flagItem)}
        </section>
      )}

      {openGaps.length === 0 && blocking.length === 0 && warnings.length === 0 && (
        <p className="rounded-lg bg-slate-50 px-3 py-3 text-[13px] text-slate-600">
          No open gaps or checks. Every answer still needs your review against its sources before approval.
        </p>
      )}

      {(doneGaps.length > 0 || doneFlags.length > 0) && (
        <details className="group rounded-xl border border-slate-200 bg-white">
          <summary className="cursor-pointer list-none rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488] [&::-webkit-details-marker]:hidden">
            Resolved and acknowledged ({doneGaps.length + doneFlags.length})
            <span className="ml-1 text-xs font-normal text-slate-500 group-open:hidden">– show</span>
          </summary>
          <div className="space-y-2 px-3 pb-3">
            {doneGaps.map(gapItem)}
            {doneFlags.map(flagItem)}
          </div>
        </details>
      )}

      <p className="text-[11px] leading-relaxed text-slate-500">
        The checks catch uncited text, dates and figures that are not in the cited note, opinion wording the note does not contain,
        out-of-scope history and unanswered questions. They cannot catch a paraphrase error that cites a valid note – check each
        answer against its source.
      </p>
    </div>
  );
}
