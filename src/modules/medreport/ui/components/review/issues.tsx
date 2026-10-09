"use client";

/**
 * Flags and gaps as the clinician works through them: a flag explains a failed check (and can be
 * acknowledged with a reason where the rules allow); a gap is something the record does not say (it is
 * resolved or acknowledged with the clinician's own words). Used inline on each question and in the
 * Flags & gaps tab.
 *
 * Owner: studio-b agent.
 */
import { useId, useState } from "react";
import { AlertOctagon, AlertTriangle, ArrowRight, CheckCircle2, CircleHelp, RotateCcw } from "lucide-react";
import { formatUkDateTime } from "../../../core/dates";
import { DATA_CHECK_LABELS, FLAG_CODE_LABELS } from "../../../core/labels";
import type { DataCheckCode, EpisodeBundle, Gap, ReportFlag } from "../../../core/types";
import { Button, cn } from "../../primitives";
import type { GapResolutionOptions } from "./review-model";
import { CitationChip } from "./review-ui";

const MIN_REASON = 3;

function ReasonForm({
  label,
  placeholder,
  submitLabel,
  onSubmit,
  onCancel,
  initial = "",
  minLength = MIN_REASON,
}: {
  label: string;
  placeholder: string;
  submitLabel: string;
  onSubmit(text: string): void;
  onCancel(): void;
  initial?: string;
  minLength?: number;
}) {
  const [text, setText] = useState(initial);
  const id = useId();
  const hintId = useId();
  const valid = text.trim().length >= minLength;
  return (
    <form
      className="mt-2 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit(text.trim());
      }}
    >
      <label htmlFor={id} className="block text-xs font-medium text-slate-700">
        {label}
      </label>
      <textarea
        id={id}
        autoFocus
        rows={2}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
        aria-describedby={minLength > MIN_REASON ? hintId : undefined}
        className="block w-full resize-y rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[13px] text-slate-900 placeholder:text-slate-400 focus:border-[#0D9488] focus:outline-none focus:ring-2 focus:ring-teal-600/20"
      />
      {minLength > MIN_REASON && (
        <p id={hintId} className="text-[11px] text-slate-500">
          At least {minLength} characters – it is kept in the audit trail{text.trim().length > 0 && !valid ? ` (${minLength - text.trim().length} more)` : ""}.
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!valid} className="h-8">
          {submitLabel}
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-8" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/* Flags ----------------------------------------------------------------------------------------- */

export function FlagItem({
  flag,
  canAck,
  readOnly,
  onAcknowledge,
  onJump,
  jumpLabel,
  compact,
}: {
  flag: ReportFlag;
  canAck: boolean;
  readOnly: boolean;
  onAcknowledge(flagId: string, reason: string): void;
  onJump?: () => void;
  jumpLabel?: string;
  compact?: boolean;
}) {
  const [acking, setAcking] = useState(false);
  const acked = Boolean(flag.acknowledged);
  const blocking = flag.severity === "blocking" && !acked;
  const Icon = acked ? CheckCircle2 : blocking ? AlertOctagon : AlertTriangle;
  const dataCheck = flag.code === "DATA_CHECK" && flag.evidence && flag.evidence in DATA_CHECK_LABELS ? DATA_CHECK_LABELS[flag.evidence as DataCheckCode] : null;
  const showEvidence = flag.evidence && !dataCheck && !/^(empty section|optional field blank|validator .*)$/.test(flag.evidence);
  return (
    <div
      className={cn(
        "flex gap-2.5 rounded-lg border px-3 py-2.5 text-[13px]",
        acked ? "border-slate-200 bg-slate-50 text-slate-700" : blocking ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900",
      )}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", acked ? "text-slate-500" : blocking ? "text-red-600" : "text-amber-600")} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {dataCheck ? `Record check: ${dataCheck}` : FLAG_CODE_LABELS[flag.code]}
          <span className="sr-only">{acked ? " (acknowledged)" : blocking ? " (blocks approval)" : " (warning)"}</span>
          {!compact && flag.sectionKey && <span className="ml-1.5 font-mono text-[11px] font-normal opacity-70">{flag.sectionKey}</span>}
        </p>
        <p className="mt-0.5 leading-relaxed">{flag.message}</p>
        {showEvidence && (
          <p className="mt-1 text-xs opacity-80">
            Found: <q className="font-medium">{flag.evidence}</q>
          </p>
        )}
        {flag.acknowledged && (
          <p className="mt-1 text-xs">
            Acknowledged: “{flag.acknowledged.reason}” · {formatUkDateTime(flag.acknowledged.at)}
          </p>
        )}
        {acking ? (
          <ReasonForm
            label="Why is this acceptable? (kept in the audit trail)"
            placeholder="e.g. This is my own clinical opinion, based on my assessment on 07/07/2026."
            submitLabel="Acknowledge"
            onCancel={() => setAcking(false)}
            onSubmit={(reason) => {
              onAcknowledge(flag.id, reason);
              setAcking(false);
            }}
          />
        ) : (
          (onJump || (canAck && !acked && !readOnly)) && (
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
              {canAck && !acked && !readOnly && (
                <button type="button" onClick={() => setAcking(true)} className="text-xs font-medium underline underline-offset-2 hover:no-underline">
                  Acknowledge with a reason
                </button>
              )}
              {onJump && (
                <button type="button" onClick={onJump} className="inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2 hover:no-underline">
                  {jumpLabel ?? "Go to question"} <ArrowRight className="h-3 w-3" aria-hidden />
                </button>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}

/* Gaps ------------------------------------------------------------------------------------------ */

export function GapItem({
  gap,
  bundle,
  readOnly,
  resolution,
  onResolve,
  onReopen,
  onOpenSource,
  onJump,
  jumpLabel,
  compact,
  hideQuestion,
}: {
  gap: Gap;
  bundle: Pick<EpisodeBundle, "notes">;
  readOnly: boolean;
  /** What "Resolve" may claim for this gap (review-model.ts gapResolutionOptions). */
  resolution: GapResolutionOptions;
  onResolve(gapId: string, kind: "resolved" | "acknowledged", text: string): void;
  onReopen(gapId: string): void;
  onOpenSource?: (id: string) => void;
  onJump?: () => void;
  jumpLabel?: string;
  compact?: boolean;
  /** The suggested question is already shown next to the answer box. */
  hideQuestion?: boolean;
}) {
  const [mode, setMode] = useState<null | "resolved" | "acknowledged">(null);
  const done = gap.resolution;
  return (
    <div
      className={cn(
        "flex gap-2.5 rounded-lg border px-3 py-2.5 text-[13px]",
        done ? "border-slate-200 bg-slate-50 text-slate-700" : "border-amber-300 bg-amber-50 text-amber-950",
      )}
    >
      {done ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
      ) : (
        <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {done ? (done.kind === "resolved" ? "Gap resolved" : "Gap acknowledged") : "Gap – not in the record"}
          <span className="sr-only">{done ? "" : " (blocks approval until resolved or acknowledged)"}</span>
          {!compact && <span className="ml-1.5 font-mono text-[11px] font-normal opacity-70">{gap.sectionKey}</span>}
        </p>
        <p className="mt-0.5 leading-relaxed">{gap.issue}</p>
        {!done && !hideQuestion && gap.suggestedQuestion && (
          <p className="mt-1 text-xs">
            <span className="font-medium">Ask:</span> {gap.suggestedQuestion}
          </p>
        )}
        {gap.relatedNoteIds.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <span className="text-xs opacity-80">Related:</span>
            {gap.relatedNoteIds.map((id) => (
              <CitationChip key={id} id={id} bundle={bundle} onOpen={onOpenSource} />
            ))}
          </div>
        )}
        <p className="mt-1 text-[11px] opacity-70">
          {gap.raisedBy === "system"
            ? gap.id.endsWith("-referrer")
              ? "Raised by the system: the value comes from another organisation's referral, so a person confirms it."
              : "Raised by the system: the clinic record does not hold this value."
            : "Raised while drafting: the notes do not say this, so nothing was guessed."}
        </p>
        {done && (
          <p className="mt-1 text-xs">
            {done.kind === "resolved" ? "Resolution" : "Reason"}: “{done.text}” · {formatUkDateTime(done.at)}
          </p>
        )}
        {!done && !readOnly && !mode && resolution.hint && <p className="mt-1 text-[11px] font-medium opacity-80">{resolution.hint}</p>}
        {mode ? (
          <ReasonForm
            label={mode === "resolved" ? "How was this resolved?" : "Why can this stay open? (kept in the audit trail)"}
            placeholder={
              mode === "resolved"
                ? "e.g. Confirmed with the patient on 08/10/2026 and added to the notes."
                : "e.g. No opinion was formed at discharge; the form is returned without one."
            }
            initial={mode === "resolved" ? resolution.prefill : ""}
            minLength={mode === "resolved" ? resolution.minLength : 15}
            submitLabel={mode === "resolved" ? "Mark resolved" : "Acknowledge"}
            onCancel={() => setMode(null)}
            onSubmit={(text) => {
              onResolve(gap.id, mode, text);
              setMode(null);
            }}
          />
        ) : (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {!readOnly && !done && (
              <>
                {resolution.canResolve &&
                  (resolution.prefill ? (
                    // The answer is the person's own: one click records exactly that.
                    <button
                      type="button"
                      onClick={() => onResolve(gap.id, "resolved", resolution.prefill)}
                      className="inline-flex h-7 items-center gap-1 rounded-md bg-amber-600 px-2.5 text-xs font-semibold text-white shadow-sm hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488] focus-visible:ring-offset-1"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Mark resolved
                    </button>
                  ) : (
                    <button type="button" onClick={() => setMode("resolved")} className="text-xs font-medium underline underline-offset-2 hover:no-underline">
                      Resolve
                    </button>
                  ))}
                <button type="button" onClick={() => setMode("acknowledged")} className="text-xs font-medium underline underline-offset-2 hover:no-underline">
                  Acknowledge with a reason
                </button>
              </>
            )}
            {!readOnly && done && (
              <button type="button" onClick={() => onReopen(gap.id)} className="inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2 hover:no-underline">
                <RotateCcw className="h-3 w-3" aria-hidden /> Reopen
              </button>
            )}
            {onJump && (
              <button type="button" onClick={onJump} className="inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2 hover:no-underline">
                {jumpLabel ?? "Go to question"} <ArrowRight className="h-3 w-3" aria-hidden />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
