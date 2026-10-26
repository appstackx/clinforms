"use client";

/**
 * Flags & gaps tab: what blocks approval – one item per question (box-items.ts), required and optional questions
 * apart – the "Leave optional boxes blank" action, warnings, and what has already been resolved or acknowledged –
 * each with a jump to its question.
 *
 * Owner: studio-b agent.
 */
import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { todayIso } from "../../../core/dates";
import { humaniseMergeCodes } from "../../../core/practice-merge-codes";
import type { EpisodeBundle, Gap, Report, ReportFlag } from "../../../core/types";
import { Button, Input } from "../../primitives";
import { FieldLabel } from "../shared/ui-bits";
import { LEAVE_BLANK_REASON, type BlankCandidate, type BoxItem, type ReviewItem, type ReviewItems } from "./box-items";
import { BoxIssue, FlagItem, GapItem } from "./issues";
import { MIN_GAP_REASON, canRecordConsent, gapResolutionOptions, nameClinicianFix } from "./review-model";
import type { Actor } from "../../../core/actor";
import type { ReviewAction } from "./use-review-state";

export function FlagsPanel({
  report,
  bundle,
  items,
  blankCandidates,
  blankSummary,
  onLeaveBlank,
  readOnly,
  validating,
  actor,
  dispatch,
  onJump,
  onOpenSource,
  canAcknowledge,
  questionLabel,
  consentRecorder = true,
}: {
  /**
   * Fix wave 3: whether the person on this screen may record the patient's consent for a report built from uploaded
   * notes (a clinic's member who may approve; anyone in the public demo).
   */
  consentRecorder?: boolean;
  report: Report;
  bundle: EpisodeBundle;
  /** What blocks approval, one item per question (box-items.ts reviewItems). */
  items: ReviewItems;
  /** Optional questions "Leave optional boxes blank" may acknowledge (box-items.ts optionalBlankCandidates). */
  blankCandidates: BlankCandidate[];
  /** All optional questions without an answer, and why the others are not offered (box-items.ts emptyOptionalSummary). */
  blankSummary?: { total: number; opinion: number; other: number };
  /** Fix round 1 (B0-8): opinion questions the clinician ticked one by one go in `opinionKeys`. */
  onLeaveBlank(keys: string[], reason: string, opinionKeys: string[]): void;
  readOnly: boolean;
  validating: boolean;
  actor: Actor;
  dispatch(action: ReviewAction): void;
  onJump(key: string): void;
  onOpenSource(id: string): void;
  canAcknowledge(flag: ReportFlag): boolean;
  questionLabel(key: string): string;
}) {
  const gaps = report.gaps;
  const flags = report.flags.filter((f) => f.code !== "OPEN_GAP");
  const blockingCount = items.count;
  // A check shown inside a question's item is not listed again.
  const warnings = flags.filter((f) => f.severity === "warning" && !f.acknowledged && !items.coveredIds.has(f.id));
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
      resolution={gapResolutionOptions(report, g, actor.name)}
      onResolve={(gapId, kind, text) => dispatch({ type: "resolveGap", gapId, kind, text, actor })}
      onReopen={(gapId) => dispatch({ type: "reopenGap", gapId, actor })}
      onOpenSource={onOpenSource}
      {...jumpProps(g.sectionKey)}
    />
  );
  const consentFlag = (f: ReportFlag) => f.code === "DATA_CHECK" && f.evidence === "CONSENT_NOT_RECORDED" && !readOnly && consentRecorder && canRecordConsent(report);
  const flagItem = (f: ReportFlag) => {
    const named = nameClinicianFix(report, f);
    return (
      <div key={f.id} className="space-y-1.5">
        <FlagItem
          flag={f}
          readOnly={readOnly}
          canAck={canAcknowledge(f)}
          onAcknowledge={(flagId, reason) => dispatch({ type: "acknowledgeFlag", flagId, reason, actor })}
          {...jumpProps(f.sectionKey)}
          {...(named && { fix: { label: `Name ${named.name} instead`, onFix: () => dispatch({ type: "nameClinicians", flags: [f], actor }) } })}
        />
        {consentFlag(f) ? <RecordConsent onRecord={(givenOn) => dispatch({ type: "recordConsent", givenOn, actor })} /> : null}
      </div>
    );
  };
  // Every "I" / "my" answer that reports one other clinician's note, named in one step (fix round 1, B0-1).
  const voiceFixes = readOnly ? [] : report.flags.filter((f) => !f.acknowledged && nameClinicianFix(report, f));
  const boxItem = (box: BoxItem) => (
    <BoxIssue
      key={`box-${box.key}`}
      box={box}
      bundle={bundle}
      readOnly={readOnly}
      resolutionFor={(g) => gapResolutionOptions(report, g, actor.name)}
      onResolve={(gapId, kind, text) => dispatch({ type: "resolveGap", gapId, kind, text, actor })}
      onReopen={(gapId) => dispatch({ type: "reopenGap", gapId, actor })}
      onTickSuggested={(g) => g.suggestedAnswer && dispatch({ type: "setAnswer", key: g.sectionKey, value: g.suggestedAnswer, actor })}
      onOpenSource={onOpenSource}
      {...jumpProps(box.key)}
    />
  );
  const item = (it: ReviewItem) => (it.type === "box" ? boxItem(it.box) : flagItem(it.flag));

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
          {!readOnly && blockingCount > 0 && (
            <span className="block text-xs font-normal">
              {items.required.length} required · {items.optional.length} on optional questions
            </span>
          )}
        </span>
        {validating && <span className="text-xs font-normal opacity-80">Checking…</span>}
      </div>

      {voiceFixes.length > 1 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-red-950" data-testid="name-clinicians">
          <p className="min-w-0 flex-1 basis-56">
            <span className="font-medium">{voiceFixes.length} answers say “I” or “my” about another clinician&apos;s note.</span> Name the clinician who
            wrote each note instead – each answer is marked as edited, and you can put the draft back.
          </p>
          <Button type="button" size="sm" variant="outline" className="h-8 bg-white" disabled={validating} onClick={() => dispatch({ type: "nameClinicians", flags: voiceFixes, actor })}>
            Name the clinician in all {voiceFixes.length}
          </Button>
        </div>
      )}

      {!readOnly && blankCandidates.length > 0 && (
        <LeaveBlankPanel candidates={blankCandidates} summary={blankSummary} disabled={validating} questionLabel={questionLabel} onConfirm={onLeaveBlank} />
      )}

      {!readOnly && items.required.length > 0 && (
        <section aria-labelledby="flags-required" className="space-y-2">
          <h3 id="flags-required" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Required – blocks approval ({items.required.length})
          </h3>
          {items.required.map(item)}
        </section>
      )}

      {!readOnly && items.optional.length > 0 && (
        <section aria-labelledby="flags-optional" className="space-y-2">
          <h3 id="flags-optional" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Optional – answer or leave blank ({items.optional.length})
          </h3>
          {items.optional.map(item)}
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

      {blockingCount === 0 && warnings.length === 0 && (
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

/**
 * "Leave optional boxes blank" (fix 10/2026): the optional questions that are simply blank, each ticked, and one reason;
 * every gap and warning on them is acknowledged with it, one by one, as a single acknowledgement is (box-items.ts).
 */
function LeaveBlankPanel({
  candidates,
  summary,
  disabled,
  questionLabel,
  onConfirm,
}: {
  candidates: BlankCandidate[];
  summary?: { total: number; opinion: number; other: number };
  disabled: boolean;
  questionLabel(key: string): string;
  onConfirm(keys: string[], reason: string, opinionKeys: string[]): void;
}) {
  const [open, setOpen] = useState(false);
  // Questions the person unticked (new candidates start ticked) – and opinion questions they ticked themselves (fix round
  // 1, B0-8: those start unticked, the clinician decides each).
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [optedIn, setOptedIn] = useState<ReadonlySet<string>>(new Set());
  const [reason, setReason] = useState(LEAVE_BLANK_REASON);
  const isTicked = (c: BlankCandidate) => (c.opinion ? optedIn.has(c.key) : !excluded.has(c.key));
  const chosen = candidates.filter(isTicked);
  const valid = reason.trim().length >= MIN_GAP_REASON && chosen.length > 0;
  const n = candidates.length;
  const flip = (prev: ReadonlySet<string>, key: string) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };
  const toggle = (c: BlankCandidate) => (c.opinion ? setOptedIn((prev) => flip(prev, c.key)) : setExcluded((prev) => flip(prev, c.key)));

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13px] text-slate-700" data-testid="leave-blank">
        <p className="min-w-0 flex-1 basis-56">{leaveBlankSummaryText(n, summary)}</p>
        <Button type="button" size="sm" variant="outline" className="h-8 bg-white" onClick={() => setOpen(true)}>
          Leave optional boxes blank…
        </Button>
      </div>
    );
  }
  return (
    <form
      className="space-y-2.5 rounded-xl border border-slate-300 bg-white px-3 py-3 text-[13px] text-slate-800"
      data-testid="leave-blank"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid || disabled) return;
        onConfirm(
          chosen.filter((c) => !c.opinion).map((c) => c.key),
          reason.trim(),
          chosen.filter((c) => c.opinion).map((c) => c.key),
        );
        setOpen(false);
      }}
    >
      <fieldset className="space-y-1.5">
        <legend className="mb-1 font-medium text-slate-900">Leave these optional boxes blank</legend>
        {candidates.map((c) => (
          <label key={c.key} className="flex cursor-pointer items-start gap-2 rounded-lg px-1 py-0.5 hover:bg-slate-50">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#0D9488]" checked={isTicked(c)} onChange={() => toggle(c)} />
            <span className="min-w-0">
              <span className="font-mono text-[11px] text-slate-500">{c.key.startsWith("F-") ? c.key : ""}</span> {humaniseMergeCodes(questionLabel(c.key) || c.label)}
              {c.opinion && <span className="block text-xs font-medium text-violet-800">Asks for your opinion – tick it only if you decide to leave it blank.</span>}
              {c.gaps[0] && <span className="block text-xs text-slate-500">{c.gaps[0].issue}</span>}
              {c.effect && <span className="block text-xs font-medium text-slate-600">Left blank: {c.effect}.</span>}
            </span>
          </label>
        ))}
      </fieldset>
      <div>
        <label htmlFor="leave-blank-reason" className="block text-xs font-medium text-slate-700">
          Reason – kept in the audit trail for each box
        </label>
        <textarea
          id="leave-blank-reason"
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-1 block w-full resize-y rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[13px] text-slate-900 focus:border-[#0D9488] focus:outline-none focus:ring-2 focus:ring-teal-600/20"
        />
        {reason.trim().length < MIN_GAP_REASON && <p className="mt-1 text-[11px] text-slate-500">At least {MIN_GAP_REASON} characters.</p>}
      </div>
      <p className="text-[11px] leading-relaxed text-slate-500">
        Each box is recorded as acknowledged, with this reason, in the activity log. Never included: required questions, and boxes with another
        check to sort out. Questions that ask for your opinion are left blank only if you tick them.
      </p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" className="h-8" disabled={!valid || disabled}>
          Leave {chosen.length} box{chosen.length === 1 ? "" : "es"} blank
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * Fix round 1 (B0-28): "1 of 4 optional boxes can be left blank in one step; the other 3 need your opinion." – the count
 * of every optional box without an answer, not only the ones the step covers.
 */
export function leaveBlankSummaryText(n: number, summary?: { total: number; opinion: number; other: number }): string {
  const total = Math.max(summary?.total ?? n, n);
  const opinion = Math.min(summary?.opinion ?? 0, n);
  const inStep = n - opinion;
  const other = total - n;
  const box = (k: number) => `${k} optional box${k === 1 ? "" : "es"}`;
  if (opinion === 0 && other === 0) return `${box(n)} ${n === 1 ? "has" : "have"} no answer. You can leave ${n === 1 ? "it" : "them"} blank on the form in one step, with one reason.`;
  const parts = [`${inStep} can be left blank in one step, with one reason`];
  if (opinion) parts.push(`${opinion} ${opinion === 1 ? "asks" : "ask"} for your opinion – tick ${opinion === 1 ? "it" : "them"} in the list only if you decide to leave ${opinion === 1 ? "it" : "them"} blank`);
  if (other) parts.push(`the other ${other} ${other === 1 ? "needs" : "need"} a decision first`);
  return `${box(total)} ${total === 1 ? "has" : "have"} no answer: ${parts.join("; ")}.`;
}

/** Fix wave 3: record the patient's consent (and the date it was given) on a report built from uploaded notes. */
function RecordConsent({ onRecord }: { onRecord(givenOn: string): void }) {
  const today = todayIso();
  const [givenOn, setGivenOn] = useState(today);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(givenOn) && givenOn <= today;
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2" data-testid="record-consent">
      <div>
        <FieldLabel htmlFor="consent-given-on">Consent given on</FieldLabel>
        <Input id="consent-given-on" type="date" className="h-9 w-40" max={today} value={givenOn} onChange={(e) => setGivenOn(e.target.value)} />
      </div>
      <Button size="sm" className="h-9" disabled={!valid} onClick={() => valid && onRecord(givenOn)}>
        Record consent
      </Button>
      <p className="w-full text-xs text-slate-500">Only if the patient has consented to sharing the report. It is kept in this report&apos;s activity.</p>
    </div>
  );
}
