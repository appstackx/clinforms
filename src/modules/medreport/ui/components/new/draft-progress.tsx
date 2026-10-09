"use client";

/**
 * Honest per-group drafting progress: which questions each /drafts call covers, whether it is queued,
 * running, done or failed, and how each was produced (drafted live, a prepared demo draft or a sample
 * draft – never presented as live when it is not). Wording: core/wording.ts.
 *
 * Owner: studio-a agent.
 */
import { CheckCircle2, CircleDashed, UserRound, XCircle } from "lucide-react";
import { cn } from "../../primitives";
import { formatMs } from "../shared/format";
import { Spinner } from "../shared/ui-bits";
import { WORDING } from "../../wording";
import { generationModeLabel, type DraftGroupProgress } from "./generate";

export function DraftProgress({
  groups,
  expectLive,
  noteCount,
  className,
}: {
  groups: DraftGroupProgress[];
  expectLive: boolean;
  /** Clinical notes in the record ("Drafting answers from 10 notes…"). */
  noteCount?: number;
  className?: string;
}) {
  const done = groups.filter((g) => g.status === "done" || g.status === "failed").length;
  const pct = groups.length ? Math.round((done / groups.length) * 100) : 100;
  return (
    <div className={cn("space-y-3", className)}>
      <div>
        <div className="flex items-center justify-between text-xs text-slate-600">
          <span>
            {done} of {groups.length} {groups.length === 1 ? "group" : "groups"} of questions
          </span>
          <span>{pct}%</span>
        </div>
        <div
          className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="Drafting progress"
        >
          <div className="h-full rounded-full bg-teal-600 transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <ol className="space-y-2" aria-live="polite">
        {groups.map((g) => (
          <li
            key={g.index}
            className={cn(
              "flex items-start gap-3 rounded-xl border p-3 text-sm",
              g.status === "failed"
                ? g.code === "NO_DEMO_DRAFT"
                  ? "border-amber-200 bg-amber-50/60"
                  : "border-red-200 bg-red-50"
                : g.status === "done"
                  ? "border-slate-200 bg-white"
                  : "border-slate-200 bg-slate-50",
            )}
          >
            <span className="mt-0.5 shrink-0">
              {g.status === "done" ? (
                <CheckCircle2 className="h-4 w-4 text-teal-600" aria-label="Done" />
              ) : g.status === "failed" && g.code === "NO_DEMO_DRAFT" ? (
                <UserRound className="h-4 w-4 text-amber-700" aria-label="Left for the clinician" />
              ) : g.status === "failed" ? (
                <XCircle className="h-4 w-4 text-red-600" aria-label="Failed" />
              ) : g.status === "drafting" ? (
                <Spinner />
              ) : (
                <CircleDashed className="h-4 w-4 text-slate-400" aria-label="Queued" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-slate-900">
                <span className="font-mono text-[11px] text-slate-500">{g.keys.join(" · ")}</span>
              </p>
              <p className="text-sm text-slate-800">{g.labels.join(" · ")}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {g.status === "queued"
                  ? "Queued"
                  : g.status === "drafting"
                    ? g.waitingForSlot
                      ? WORDING.drafting.waitingForSlot
                      : expectLive
                        ? WORDING.drafting.liveProgress(noteCount)
                        : WORDING.drafting.demoProgress
                    : g.status === "done"
                      ? `${generationModeLabel(g.mode, g.model)}${g.ms !== undefined ? ` · ${formatMs(g.ms)}` : ""}`
                      : null}
              </p>
              {g.status === "failed" ? (
                g.code === "NO_DEMO_DRAFT" ? (
                  <p className="mt-0.5 text-xs text-amber-900">Left blank for the clinician – no prepared demo answers for this patient.</p>
                ) : (
                  <p className="mt-0.5 text-xs text-red-800">{g.error} Left blank for the clinician.</p>
                )
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
