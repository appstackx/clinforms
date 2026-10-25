"use client";

/**
 * Flags and gaps as the clinician works through them: a flag explains a failed check (and can be
 * acknowledged with a reason where the rules allow); a gap is something the record does not say (it is
 * resolved or acknowledged with the clinician's own words). Used inline on each question and in the
 * Flags & gaps tab. A question's open gaps and the checks its own answer clears are one item (BoxIssue, fix 10/2026 –
 * see box-items.ts).
 *
 * Owner: studio-b agent.
 */
import { useId, useState } from "react";
import { AlertOctagon, AlertTriangle, ArrowRight, CheckCircle2, CircleHelp, RotateCcw } from "lucide-react";
import { formatUkDateTime } from "../../../core/dates";
import { DATA_CHECK_LABELS, FLAG_CODE_LABELS } from "../../../core/labels";
import { humaniseMergeCodes } from "../../../core/practice-merge-codes";
import type { DataCheckCode, EpisodeBundle, Gap, ReportFlag } from "../../../core/types";
import { Button, cn } from "../../primitives";
import type { BoxItem } from "./box-items";
import { requiredAnswerFirst, type GapResolutionOptions } from "./review-model";
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

/** A check's title; "Missing field" says which kind it is (fix 10/2026). */
function flagTitle(flag: ReportFlag): string {
  if (flag.code === "MISSING_PLACEHOLDER" && flag.evidence === "optional field blank") return "Optional – no answer";
  if (flag.code === "MISSING_PLACEHOLDER" && flag.evidence?.startsWith("mail-merge field ")) return "Mail-merge field left on the form";
  return FLAG_CODE_LABELS[flag.code];
}

export function FlagItem({
  flag,
  canAck,
  readOnly,
  onAcknowledge,
  onJump,
  jumpLabel,
  compact,
  fix,
}: {
  flag: ReportFlag;
  canAck: boolean;
  readOnly: boolean;
  onAcknowledge(flagId: string, reason: string): void;
  onJump?: () => void;
  jumpLabel?: string;
  compact?: boolean;
  /** A one-click correction the check offers ("Name Tom Ellis instead"). */
  fix?: { label: string; onFix(): void };
}) {
  const [acking, setAcking] = useState(false);
  const acked = Boolean(flag.acknowledged);
  const blocking = flag.severity === "blocking" && !acked;
  const Icon = acked ? CheckCircle2 : blocking ? AlertOctagon : AlertTriangle;
  const dataCheck = flag.code === "DATA_CHECK" && flag.evidence && flag.evidence in DATA_CHECK_LABELS ? DATA_CHECK_LABELS[flag.evidence as DataCheckCode] : null;
  // A mail-merge field's evidence is the code as found (<<P_GROUPREF>>): the message already says it in plain words.
  const showEvidence = flag.evidence && !dataCheck && !/^(empty section|optional field blank|validator .*|mail-merge field .*)$/.test(flag.evidence);
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
          {dataCheck ? `Record check: ${dataCheck}` : flagTitle(flag)}
          <span className="sr-only">{acked ? " (acknowledged)" : blocking ? " (blocks approval)" : " (warning)"}</span>
          {!compact && flag.sectionKey && <span className="ml-1.5 font-mono text-[11px] font-normal opacity-70">{flag.sectionKey}</span>}
        </p>
        <p className="mt-0.5 leading-relaxed">{humaniseMergeCodes(flag.message)}</p>
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
          (onJump || (canAck && !acked && !readOnly) || (fix && !acked && !readOnly)) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              {fix && !acked && !readOnly && (
                <button
                  type="button"
                  onClick={fix.onFix}
                  className="inline-flex h-7 items-center gap-1 rounded-md bg-red-700 px-2.5 text-xs font-semibold text-white shadow-sm hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488] focus-visible:ring-offset-1"
                >
                  {fix.label}
                </button>
              )}
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

interface GapActionProps {
  bundle: Pick<EpisodeBundle, "notes">;
  readOnly: boolean;
  /** Fix round 1 (B0-8): tick a held-back drafted choice ("Tick “No Impact”") – the person's own decision. */
  onTickSuggested?: (gap: Gap) => void;
  onResolve(gapId: string, kind: "resolved" | "acknowledged", text: string): void;
  onReopen(gapId: string): void;
  onOpenSource?: (id: string) => void;
  onJump?: () => void;
  jumpLabel?: string;
}

/** A gap's text, related notes and actions (inside a GapItem or a BoxIssue). */
function GapBody({
  gap,
  bundle,
  readOnly,
  resolution,
  onTickSuggested,
  onResolve,
  onReopen,
  onOpenSource,
  onJump,
  jumpLabel,
  hideQuestion,
  hideIssue,
  hideHint,
  issueLabel,
}: GapActionProps & {
  gap: Gap;
  resolution: GapResolutionOptions;
  hideQuestion?: boolean;
  /** The question's card already explains it (the referrer's own reference). */
  hideIssue?: boolean;
  /** The item's instruction already says what resolving means. */
  hideHint?: boolean;
  /** "Gap" before the issue (inside a BoxIssue). */
  issueLabel?: string;
}) {
  const [mode, setMode] = useState<null | "resolved" | "acknowledged">(null);
  const done = gap.resolution;
  return (
    <>
      {!hideIssue && (
        <p className={cn("leading-relaxed", issueLabel ? "mt-1.5" : "mt-0.5")}>
          {issueLabel && <span className="font-medium">{issueLabel}: </span>}
          {humaniseMergeCodes(gap.issue)}
        </p>
      )}
      {!done && !hideQuestion && !hideIssue && gap.suggestedQuestion && (
        <p className="mt-1 text-xs">
          <span className="font-medium">Ask:</span> {humaniseMergeCodes(gap.suggestedQuestion)}
        </p>
      )}
      {gap.relatedNoteIds.length > 0 && !hideIssue && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className="text-xs opacity-80">Related:</span>
          {gap.relatedNoteIds.map((id) => (
            <CitationChip key={id} id={id} bundle={bundle} onOpen={onOpenSource} />
          ))}
        </div>
      )}
      <p className="mt-1 text-[11px] opacity-70">{gapProvenance(gap)}</p>
      {done && (
        <p className="mt-1 text-xs">
          {done.kind === "resolved" ? "Resolution" : "Reason"}: “{done.text}” · {formatUkDateTime(done.at)}
        </p>
      )}
      {!done && !readOnly && !mode && !hideHint && resolution.hint && <p className="mt-1 text-[11px] font-medium opacity-80">{resolution.hint}</p>}
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
              {gap.suggestedAnswer && onTickSuggested && (
                <button
                  type="button"
                  onClick={() => onTickSuggested(gap)}
                  className="inline-flex h-7 items-center gap-1 rounded-md bg-amber-600 px-2.5 text-xs font-semibold text-white shadow-sm hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488] focus-visible:ring-offset-1"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Tick “{gap.suggestedAnswer}”
                </button>
              )}
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
              {resolution.canAcknowledge !== false && (
                <button type="button" onClick={() => setMode("acknowledged")} className="text-xs font-medium underline underline-offset-2 hover:no-underline">
                  Acknowledge with a reason
                </button>
              )}
            </>
          )}
          {!readOnly && done && (
            <button type="button" onClick={() => onReopen(gap.id)} className="inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2 hover:no-underline">
              <RotateCcw className="h-3 w-3" aria-hidden /> Reopen
            </button>
          )}
          {onJump && <JumpButton onJump={onJump} jumpLabel={jumpLabel} />}
        </div>
      )}
    </>
  );
}

/**
 * Why a gap was raised, by its kind (fix round 1, B0-17): a held-back drafted choice is not "the clinic record does not
 * hold this value". System gaps from drafting end "-choice", "-fit", "-cite" or "-sys" (ai/assemble.ts); a staff entry, a
 * physiotherapist's choice or the clinic's details "-staff", "-physio" or "-clinic" (core/report-factory.ts).
 */
export function gapProvenance(gap: Pick<Gap, "id" | "raisedBy">): string {
  if (gap.raisedBy !== "system") return "Raised while drafting: the notes do not say this, so nothing was guessed.";
  if (gap.id.endsWith("-referrer")) return "Raised by the system: the value comes from another organisation's referral, so a person confirms it.";
  if (gap.id.endsWith("-choice")) return "Raised by the system: the notes do not use the option's own words, so a person ticks it.";
  if (gap.id.endsWith("-fit")) return "Raised by the system: the drafted answer does not fit the printed options, so a person chooses.";
  if (gap.id.endsWith("-cite")) return "Raised by the system: the drafted answer cites no source, so a person confirms it.";
  if (gap.id.endsWith("-sys")) return "Raised by the system: the notes did not answer this question.";
  if (gap.id.endsWith("-staff")) return "Raised by the system: this is entered by staff on each report.";
  if (gap.id.endsWith("-physio")) return "Raised by the system: the physiotherapist chooses this on each report.";
  if (gap.id.endsWith("-clinic")) return "Raised by the system: your Clinic details do not hold this yet.";
  return "Raised by the system: the clinic record does not hold this value.";
}

function JumpButton({ onJump, jumpLabel }: { onJump(): void; jumpLabel?: string }) {
  return (
    <button type="button" onClick={onJump} className="inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2 hover:no-underline">
      {jumpLabel ?? "Go to question"} <ArrowRight className="h-3 w-3" aria-hidden />
    </button>
  );
}

export function GapItem({
  gap,
  resolution,
  compact,
  hideQuestion,
  ...actions
}: GapActionProps & {
  gap: Gap;
  /** What "Resolve" may claim for this gap (review-model.ts gapResolutionOptions). */
  resolution: GapResolutionOptions;
  compact?: boolean;
  /** The suggested question is already shown next to the answer box. */
  hideQuestion?: boolean;
}) {
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
        <GapBody gap={gap} resolution={resolution} hideQuestion={hideQuestion} {...actions} />
      </div>
    </div>
  );
}

/* One item per question ------------------------------------------------------------------------- */

/**
 * A question's open gaps and the checks its answer clears, as ONE item (box-items.ts): the heading says required or
 * optional and what is missing, then one instruction, then each gap with its actions. It blocks approval until the
 * question is answered and its gaps are closed.
 */
export function BoxIssue({
  box,
  resolutionFor,
  compact,
  hideQuestion,
  hideInstruction,
  hideGapIssue,
  onJump,
  jumpLabel,
  ...actions
}: Omit<GapActionProps, "onJump" | "jumpLabel"> & {
  box: BoxItem;
  /** What "Resolve" may claim for each gap (review-model.ts gapResolutionOptions). */
  resolutionFor(gap: Gap): GapResolutionOptions;
  compact?: boolean;
  hideQuestion?: boolean;
  /** The question's card already says what to do (the referrer notice, "Needs clinician input"). */
  hideInstruction?: boolean;
  /** The question's card already explains the gap (the referrer's own reference). */
  hideGapIssue?: boolean;
  onJump?: () => void;
  jumpLabel?: string;
}) {
  const strong = box.required && !box.answered;
  return (
    <div
      data-box-item={box.key}
      className={cn(
        "flex gap-2.5 rounded-lg border px-3 py-2.5 text-[13px]",
        strong ? "border-red-200 bg-red-50 text-red-950" : "border-amber-300 bg-amber-50 text-amber-950",
      )}
    >
      {strong ? <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden /> : <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />}
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {box.heading}
          <span className="sr-only"> (blocks approval)</span>
          {!compact && <span className="ml-1.5 font-mono text-[11px] font-normal opacity-70">{box.key}</span>}
        </p>
        {!hideInstruction && <p className="mt-0.5 leading-relaxed">{box.instruction}</p>}
        {box.gaps.map((g, i) => (
          <GapBody
            key={g.id}
            gap={g}
            // Fix round 1 (B0-3): a required question with no answer is answered first, never acknowledged blank.
            resolution={box.required && !box.answered ? requiredAnswerFirst(resolutionFor(g)) : resolutionFor(g)}
            issueLabel="Gap"
            hideIssue={hideGapIssue}
            hideQuestion={hideQuestion || box.answered}
            hideHint
            {...actions}
            {...(i === box.gaps.length - 1 && onJump ? { onJump, jumpLabel } : {})}
          />
        ))}
        {box.gaps.length === 0 && onJump && (
          <div className="mt-1.5">
            <JumpButton onJump={onJump} jumpLabel={jumpLabel} />
          </div>
        )}
      </div>
    </div>
  );
}
