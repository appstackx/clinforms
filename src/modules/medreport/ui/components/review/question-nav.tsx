"use client";

/**
 * Question list (left column on wide screens, a "Jump to question" picker on narrow ones): the form's
 * questions grouped by its own headings, each with a status dot, plus a progress summary and legend.
 *
 * Owner: studio-b agent.
 */
import { QUESTION_STATUS_META, QUESTION_STATUS_ORDER, type QuestionStatus, type ReviewGroup, type StatusCounts } from "./review-model";
import { StatusDot } from "./review-ui";
import { cn } from "../../primitives";

export function ProgressSummary({ counts, className }: { counts: StatusCounts; className?: string }) {
  const answerable = counts.total - counts.counts.blank - counts.counts.signoff;
  const done = counts.counts.records + counts.counts.drafted + counts.counts.clinician;
  const pct = answerable > 0 ? Math.round((done / answerable) * 100) : 100;
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-baseline justify-between text-xs text-slate-600">
        <span>
          <span className="font-semibold text-slate-900">{done}</span> of {answerable} answered and clear
        </span>
        <span className="tabular-nums">{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200" aria-hidden>
        <div className="h-full rounded-full bg-[#0D9488] transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600">
        {QUESTION_STATUS_ORDER.filter((s) => counts.counts[s] > 0 || s === "needs_input" || s === "blocked").map((s) => (
          <li key={s} className="flex items-center gap-1.5">
            <StatusDot status={s} className="h-2 w-2" />
            <span title={QUESTION_STATUS_META[s].label}>{QUESTION_STATUS_META[s].short}</span>
            <span className="tabular-nums font-medium text-slate-800">{counts.counts[s]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function QuestionNav({
  groups,
  statuses,
  activeKey,
  onJump,
}: {
  groups: ReviewGroup[];
  statuses: Map<string, QuestionStatus>;
  activeKey: string | null;
  onJump(key: string): void;
}) {
  return (
    <nav aria-label="Questions on the form" className="space-y-4">
      {groups.map((g) => (
        <div key={g.id}>
          <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{g.title}</p>
          <ul className="space-y-0.5">
            {g.questions.map((q) => {
              const status = statuses.get(q.key) ?? "pending";
              const active = activeKey === q.key;
              return (
                <li key={q.key}>
                  <button
                    type="button"
                    onClick={() => onJump(q.key)}
                    aria-current={active ? "location" : undefined}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] leading-snug transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488]",
                      active ? "bg-teal-50 text-teal-950" : "text-slate-700 hover:bg-slate-100",
                      status === "blank" && "text-slate-500",
                    )}
                  >
                    <StatusDot status={status} className="mt-1" />
                    <span className="mt-px w-8 shrink-0 font-mono text-[11px] text-slate-500">{q.key.startsWith("F-") ? q.key : q.number}</span>
                    <span className="line-clamp-2 min-w-0 flex-1">{q.label}</span>
                    <span className="sr-only">– {QUESTION_STATUS_META[status].label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Narrow screens: a native picker (keyboard and screen-reader friendly). */
export function QuestionJump({
  groups,
  statuses,
  onJump,
}: {
  groups: ReviewGroup[];
  statuses: Map<string, QuestionStatus>;
  onJump(key: string): void;
}) {
  return (
    <div>
      <label htmlFor="question-jump" className="sr-only">
        Jump to a question
      </label>
      <select
        id="question-jump"
        value=""
        onChange={(e) => {
          if (e.target.value) onJump(e.target.value);
        }}
        className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:border-[#0D9488] focus:outline-none focus:ring-2 focus:ring-teal-600/20"
      >
        <option value="">Jump to a question…</option>
        {groups.map((g) => (
          <optgroup key={g.id} label={g.title}>
            {g.questions.map((q) => {
              const status = statuses.get(q.key) ?? "pending";
              const mark = status === "blocked" ? "⛔ " : status === "needs_input" ? "⚠ " : status === "pending" ? "○ " : "";
              return (
                <option key={q.key} value={q.key}>
                  {mark}
                  {q.key.startsWith("F-") ? `${q.key} ` : ""}
                  {q.label.length > 70 ? `${q.label.slice(0, 68)}…` : q.label} – {QUESTION_STATUS_META[status].label}
                </option>
              );
            })}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
