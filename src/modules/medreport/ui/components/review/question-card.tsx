"use client";

/**
 * One question of the referrer's form (or one section of a built-in report) in the review centre
 * column: the label as printed, the referrer's guidance, an answer editor for its type, where each part
 * of the answer came from (origin pills and citation chips) and the checks and gaps on it.
 *
 * Owner: studio-b agent.
 */
import { memo, useEffect, useRef, useState } from "react";
import { Loader2, Lock, NotebookPen, PenLine, Plus, RotateCcw, Trash2, UserRound } from "lucide-react";
import { formatUkDate, isValidIsoDate, parseUkDate } from "../../../core/dates";
import { answerKindFor, isSectionAnswered, parseFormAnswerValue, signoffValuesFromReceipt } from "../../../core/forms";
import { ANSWER_TYPE_LABELS, FILL_SOURCE_LABELS, PARAGRAPH_BASIS_LABELS, SIGNOFF_PART_LABELS } from "../../../core/labels";
import type { ConnectorId, EpisodeBundle, Gap, Paragraph, ReportFlag, SignReceipt } from "../../../core/types";
import { Button, cn } from "../../primitives";
import { WORDING } from "../../wording";
import { FlagItem, GapItem } from "./issues";
import {
  QUESTION_STATUS_META,
  answerOptions,
  nextClinicianParagraphId,
  originLabel,
  resolutionOptionsFor,
  supersededAbsenceSentences,
  type QuestionStatus,
  type ReviewQuestion,
} from "./review-model";
import { CopyAnswerButton } from "./copy-answers";
import { AutoTextarea, CitationChip, OriginPill, Pill, StatusDot } from "./review-ui";
import type { ReviewAction } from "./use-review-state";

export interface QuestionCardProps {
  q: ReviewQuestion;
  status: QuestionStatus;
  /** Flags on this question (section-level and paragraph-level). */
  flags: ReportFlag[];
  gaps: Gap[];
  bundle: EpisodeBundle;
  connectorId: ConnectorId;
  referrerName: string | null;
  readOnly: boolean;
  /** The clinician changed the structured answer (activity "answer_set"). */
  answerEdited: boolean;
  /** A person (not the drafting step) has answered this question (review-model.ts answeredByPerson). */
  answeredByPerson: boolean;
  /**
   * For a referral reference / referrer name question on another organisation's form: the referral's
   * own value, offered as "Use …" when the referrer asked for it.
   */
  referralValue?: string | null;
  receipt: SignReceipt | undefined;
  activeSourceId: string | null;
  drafting: boolean;
  actor: string;
  dispatch(action: ReviewAction): void;
  onOpenSource(id: string): void;
  canAcknowledge(flag: ReportFlag): boolean;
  onDraft?: (key: string) => void;
  /** "Copy" this question's answer (form reports; copy-answers.tsx). Stable callback. */
  onCopy?: (key: string) => void;
  /** The question has an answer to copy. */
  copyable?: boolean;
}

/* Paragraphs ------------------------------------------------------------------------------------ */

function ParagraphEditor({
  paragraph,
  index,
  total,
  sectionKey,
  questionLabel,
  readOnly,
  bundle,
  connectorId,
  activeSourceId,
  flags,
  autoFocus,
  actor,
  dispatch,
  onOpenSource,
  canAcknowledge,
  onFocused,
  staffEntry = false,
}: {
  staffEntry?: boolean;
  paragraph: Paragraph;
  index: number;
  total: number;
  sectionKey: string;
  questionLabel: string;
  readOnly: boolean;
  bundle: EpisodeBundle;
  connectorId: ConnectorId;
  activeSourceId: string | null;
  flags: ReportFlag[];
  autoFocus: boolean;
  actor: string;
  dispatch(action: ReviewAction): void;
  onOpenSource(id: string): void;
  canAcknowledge(flag: ReportFlag): boolean;
  onFocused(): void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const textAtFocus = useRef<string | null>(null);
  const locked = readOnly || paragraph.origin === "from_records";

  useEffect(() => {
    if (!autoFocus || !ref.current) return;
    const el = ref.current;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    onFocused();
  }, [autoFocus, onFocused]);

  const label = total > 1 ? `Answer to “${questionLabel}”, paragraph ${index + 1} of ${total}` : `Answer to “${questionLabel}”`;

  return (
    <div className="space-y-1.5">
      {locked ? (
        <p className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-sm leading-relaxed text-slate-900">
          {paragraph.text || <span className="text-slate-400">No text</span>}
        </p>
      ) : (
        <AutoTextarea
          ref={ref}
          aria-label={label}
          value={paragraph.text}
          minRows={1}
          onFocus={() => {
            textAtFocus.current = paragraph.text;
          }}
          onChange={(e) => dispatch({ type: "editParagraph", key: sectionKey, paragraphId: paragraph.id, text: e.target.value })}
          onBlur={(e) => {
            const before = textAtFocus.current;
            textAtFocus.current = null;
            const now = e.target.value;
            if (!now.trim() && paragraph.origin === "clinician") {
              dispatch({ type: "removeParagraph", key: sectionKey, paragraphId: paragraph.id, actor, silent: before === "" || before === null });
              return;
            }
            if (before !== null && before !== now) dispatch({ type: "logEdit", key: sectionKey, actor });
          }}
          className={cn(paragraph.origin === "edited" && "border-violet-300", paragraph.origin === "clinician" && "border-indigo-300")}
        />
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <OriginPill origin={paragraph.origin} label={staffEntry && paragraph.origin === "clinician" ? "Entered by staff" : originLabel(paragraph.origin, connectorId)} />
        {paragraph.basis && paragraph.origin !== "from_records" && (
          <span className="text-[11px] text-slate-500">{PARAGRAPH_BASIS_LABELS[paragraph.basis]}</span>
        )}
        {paragraph.sourceIds.map((id) => (
          <CitationChip key={id} id={id} bundle={bundle} onOpen={onOpenSource} active={activeSourceId === id} />
        ))}
        {(paragraph.origin === "ai" || paragraph.origin === "edited") && paragraph.sourceIds.length === 0 && (
          <span className="text-[11px] font-medium text-red-700">No source cited</span>
        )}
        {paragraph.origin === "clinician" && (
          <span className="text-[11px] text-slate-500">{staffEntry ? "Typed in by staff – kept in the activity log" : "Your own words – no citation needed"}</span>
        )}
        {!readOnly && paragraph.origin === "edited" && paragraph.originalText !== undefined && (
          <button
            type="button"
            onClick={() => {
              dispatch({ type: "revertParagraph", key: sectionKey, paragraphId: paragraph.id });
              dispatch({ type: "logEdit", key: sectionKey, actor });
            }}
            className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488]"
          >
            <RotateCcw className="h-3 w-3" aria-hidden /> {WORDING.origin.revertToDraft}
          </button>
        )}
        {!locked && (
          <button
            type="button"
            onClick={() => dispatch({ type: "removeParagraph", key: sectionKey, paragraphId: paragraph.id, actor })}
            aria-label={`Remove paragraph ${index + 1} of the answer to “${questionLabel}”`}
            className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-500 hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488]"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>
      {paragraph.ackReason && <p className="text-[11px] text-slate-500">Wording acknowledged: “{paragraph.ackReason}”</p>}
      {flags.length > 0 && (
        <div className="space-y-1.5">
          {flags.map((f) => (
            <FlagItem
              key={f.id}
              flag={f}
              compact
              readOnly={readOnly}
              canAck={canAcknowledge(f)}
              onAcknowledge={(flagId, reason) => dispatch({ type: "acknowledgeFlag", flagId, reason, actor })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* Structured answers ---------------------------------------------------------------------------- */

function ChoiceEditor({
  q,
  value,
  readOnly,
  onChange,
}: {
  q: ReviewQuestion;
  value: string | boolean | null;
  readOnly: boolean;
  onChange(value: string | boolean | null): void;
}) {
  const field = q.field;
  if (!field) return null;
  const kind = answerKindFor(field.answerType);
  const options =
    kind === "checkbox"
      ? [
          { label: "Ticked", value: true as string | boolean },
          { label: "Not ticked", value: false as string | boolean },
        ]
      : answerOptions(field);
  const name = `answer-${q.key}`;
  return (
    <fieldset className="space-y-2" disabled={readOnly}>
      <legend className="sr-only">Answer to “{q.label}”</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const checked = value === o.value;
          return (
            <label
              key={String(o.value)}
              className={cn(
                "inline-flex min-h-[2.25rem] cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#0D9488]",
                checked ? "border-[#0D9488] bg-teal-50 font-medium text-teal-900" : "border-slate-300 bg-white text-slate-800 hover:border-slate-400",
                readOnly && "cursor-default opacity-90",
              )}
            >
              <input
                type="radio"
                name={name}
                className="h-4 w-4 accent-[#0D9488]"
                checked={checked}
                onChange={() => onChange(o.value)}
              />
              {o.label}
            </label>
          );
        })}
      </div>
      {!readOnly && value !== null && (
        <button type="button" onClick={() => onChange(null)} className="text-xs font-medium text-slate-500 underline underline-offset-2 hover:text-slate-800">
          Clear answer
        </button>
      )}
    </fieldset>
  );
}

function TypedValueEditor({
  q,
  value,
  readOnly,
  onChange,
}: {
  q: ReviewQuestion;
  value: string | boolean | null;
  readOnly: boolean;
  onChange(value: string | null): void;
}) {
  const kind = q.answerType ? answerKindFor(q.answerType) : "text";
  const isDate = kind === "date";
  const shown = typeof value === "string" ? (isDate && isValidIsoDate(value) ? formatUkDate(value) : value) : "";
  const [text, setText] = useState(shown);
  const [error, setError] = useState<string | null>(null);
  const id = `value-${q.key}`;
  useEffect(() => {
    setText(shown);
    setError(null);
  }, [shown]);

  const commit = () => {
    const raw = text.trim();
    if (!raw) {
      setError(null);
      if (value !== null) onChange(null);
      return;
    }
    if (isDate) {
      const iso = parseUkDate(raw) ?? (isValidIsoDate(raw) ? raw : null);
      if (!iso) return setError("Enter the date as DD/MM/YYYY, for example 07/07/2026.");
      setError(null);
      if (iso !== value) onChange(iso);
      return;
    }
    const parsed = q.field ? parseFormAnswerValue(q.field, raw).value : raw;
    if (parsed === null || typeof parsed !== "string") return setError("Enter a number using digits, for example 6.");
    setError(null);
    if (parsed !== value) onChange(parsed);
  };

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="sr-only">
        Answer to “{q.label}”{isDate ? " (DD/MM/YYYY)" : ""}
      </label>
      <input
        id={id}
        type="text"
        inputMode={isDate ? "numeric" : "decimal"}
        placeholder={isDate ? "DD/MM/YYYY" : "Number"}
        value={text}
        disabled={readOnly}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        className={cn(
          "h-10 w-44 rounded-lg border bg-white px-3 text-sm tabular-nums text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 disabled:bg-slate-50",
          error ? "border-red-400 focus:ring-red-500/20" : "border-slate-300 focus:border-[#0D9488] focus:ring-teal-600/20",
        )}
      />
      {error && (
        <p id={`${id}-error`} className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

/* The card -------------------------------------------------------------------------------------- */

function QuestionCardImpl(props: QuestionCardProps) {
  const { q, status, flags, gaps, bundle, connectorId, readOnly, receipt, actor, dispatch, onOpenSource, canAcknowledge } = props;
  const section = q.section;
  const [focusId, setFocusId] = useState<string | null>(null);
  const clearFocus = useRef(() => setFocusId(null)).current;
  const meta = QUESTION_STATUS_META[status];
  const headingId = `q-${q.key}-label`;
  const field = q.field;
  const answered = section ? isSectionAnswered(section) : false;

  // An unanswered opinion question already says "Needs clinician input" (and its gap explains why), so
  // its "required and empty" check is listed in the Flags tab rather than repeated here.
  const showsNeedsClinician = section?.kind === "clinician_opinion" && !readOnly && section.status !== "pending" && !isSectionAnswered(section);
  const sectionFlags = flags.filter((f) => !f.paragraphId && !(showsNeedsClinician && f.code === "MISSING_PLACEHOLDER" && f.evidence === "empty section"));
  const paragraphFlags = (pid: string) => flags.filter((f) => f.paragraphId === pid);

  const fillSourceText = field ? FILL_SOURCE_LABELS[field.fillSource.kind] : section ? (section.kind === "from_records" ? "From records – filled by code" : section.kind === "declaration" ? "Declaration – fixed wording" : WORDING.labels.fillSourceNotesNarrative) : "";

  const structuredKind = section?.answer && section.answer.kind !== "text" ? section.answer.kind : null;
  const isRecords = section?.kind === "from_records";
  const isOpinion = section?.kind === "clinician_opinion";
  const paragraphsAll = section?.paragraphs ?? [];
  // Locked only while the answer is the one filled by code from the record (a value the clinician
  // entered for a missing record value stays editable).
  const recordsLocked = isRecords && answered && paragraphsAll.length > 0 && paragraphsAll.every((p) => p.origin === "from_records");

  const absence = section && !readOnly ? supersededAbsenceSentences(section) : [];
  const referrerGap = gaps.find((g) => g.id.endsWith("-referrer") && !g.resolution) ?? null;
  const referrerField =
    field?.fillSource.kind === "registration" && (field.fillSource.path === "referral.reference" || field.fillSource.path === "referral.referrerName");

  const startClinicianText = (text: string) => {
    if (!section) return;
    const id = nextClinicianParagraphId(section);
    dispatch({ type: "addParagraph", key: section.key, text });
    setFocusId(id);
  };

  const paragraphs = paragraphsAll;
  const visibleParagraphs = paragraphs;

  const renderParagraphs = (opts: { emptyPlaceholder: string; supporting: boolean }) => (
    <div className="space-y-3">
      {readOnly && visibleParagraphs.length === 0 && !opts.supporting && (
        <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-3 py-2 text-[13px] text-slate-500">Left blank on the form.</p>
      )}
      {opts.supporting && visibleParagraphs.length > 0 && (
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Supporting text – kept with the report, not printed on the form</p>
      )}
      {visibleParagraphs.map((p, i) => (
        <ParagraphEditor
          key={p.id}
          paragraph={p}
          index={i}
          total={visibleParagraphs.length}
          sectionKey={q.key}
          questionLabel={q.label}
          readOnly={readOnly}
          bundle={bundle}
          connectorId={connectorId}
          activeSourceId={props.activeSourceId}
          flags={paragraphFlags(p.id)}
          autoFocus={focusId === p.id}
          actor={actor}
          dispatch={dispatch}
          onOpenSource={onOpenSource}
          canAcknowledge={canAcknowledge}
          onFocused={clearFocus}
          staffEntry={isRecords}
        />
      ))}
      {!readOnly && !recordsLocked && visibleParagraphs.length === 0 && !opts.supporting && (
        <AutoTextarea
          aria-label={`Answer to “${q.label}”`}
          value=""
          minRows={isOpinion ? 3 : 2}
          placeholder={isRecords && referrerField ? `${props.referrerName ?? "The referrer"}'s reference` : opts.emptyPlaceholder}
          onChange={(e) => startClinicianText(e.target.value)}
        />
      )}
      {!readOnly && !recordsLocked && (visibleParagraphs.length > 0 || opts.supporting) && (
        <button
          type="button"
          onClick={() => startClinicianText("")}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-teal-800 hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488]"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {opts.supporting ? "Add supporting text" : "Add a paragraph in your own words"}
        </button>
      )}
    </div>
  );

  let body: JSX.Element;
  if (!section) {
    body = (
      <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-3 py-2 text-[13px] text-slate-600">
        Left blank on the form – this box is for {props.referrerName ?? "the referrer"}&apos;s own use.
      </p>
    );
  } else if (section.kind === "declaration" && section.fieldId && field?.fillSource.kind === "signoff") {
    const part = field.fillSource.part;
    const values = receipt ? signoffValuesFromReceipt(receipt) : null;
    body = values ? (
      <p className="flex items-center gap-2 rounded-lg border border-teal-200 bg-teal-50/60 px-3 py-2 text-sm text-teal-950">
        <Lock className="h-3.5 w-3.5 shrink-0 text-teal-700" aria-hidden />
        {values[part]}
      </p>
    ) : (
      <p className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-3 py-2 text-[13px] text-slate-600">
        <Lock className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
        {SIGNOFF_PART_LABELS[part]} – completed from the approval receipt when a clinician approves the form. Blank on the draft.
      </p>
    );
  } else if (section.status === "pending" && !answered) {
    body = (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-3 py-3 text-[13px] text-slate-600">
        {props.drafting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-[#0D9488]" aria-hidden />
            <span>Drafting from the notes…</span>
          </>
        ) : (
          <>
            <span className="flex-1">Not drafted yet.</span>
            {props.onDraft && !readOnly && (
              <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => props.onDraft?.(q.key)}>
                <NotebookPen className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Draft from the notes
              </Button>
            )}
          </>
        )}
      </div>
    );
  } else if (structuredKind) {
    const value = section.answer?.value ?? null;
    const isChoice = structuredKind === "yes_no" || structuredKind === "choice" || structuredKind === "checkbox";
    const proposedBy = isRecords ? null : props.answerEdited ? "edited" : paragraphs.some((p) => p.origin === "ai" || p.origin === "edited") && value !== null ? "ai" : value !== null ? "clinician" : null;
    body = (
      <div className="space-y-3">
        {isOpinion && value === null && !readOnly && <NeedsClinician gaps={gaps} />}
        {recordsLocked ? (
          <LockedRecordsAnswer
            text={paragraphs[0]?.text ?? String(value ?? "")}
            sourceIds={paragraphs[0]?.sourceIds ?? []}
            bundle={bundle}
            connectorId={connectorId}
            activeSourceId={props.activeSourceId}
            onOpenSource={onOpenSource}
          />
        ) : (
          <div className="space-y-1.5">
            {isChoice ? (
              <ChoiceEditor q={q} value={value} readOnly={readOnly} onChange={(v) => dispatch({ type: "setAnswer", key: q.key, value: v, actor })} />
            ) : (
              <TypedValueEditor q={q} value={value} readOnly={readOnly} onChange={(v) => dispatch({ type: "setAnswer", key: q.key, value: v, actor })} />
            )}
            {proposedBy && (
              <div className="flex items-center gap-1.5">
                {proposedBy === "ai" && <Pill className="border-sky-200 bg-sky-50 text-sky-800">Answer proposed from the notes – check it</Pill>}
                {proposedBy === "edited" && <Pill className="border-violet-200 bg-violet-50 text-violet-800">Answer changed by the clinician</Pill>}
                {proposedBy === "clinician" && <Pill className="border-indigo-200 bg-indigo-50 text-indigo-800">Clinician</Pill>}
              </div>
            )}
          </div>
        )}
        {!recordsLocked && !isRecords && renderParagraphs({ emptyPlaceholder: "", supporting: true })}
      </div>
    );
  } else if (recordsLocked) {
    body = (
      <LockedRecordsAnswer
        text={paragraphs.map((p) => p.text).join("\n\n")}
        sourceIds={Array.from(new Set(paragraphs.flatMap((p) => p.sourceIds)))}
        bundle={bundle}
        connectorId={connectorId}
        activeSourceId={props.activeSourceId}
        onOpenSource={onOpenSource}
      />
    );
  } else {
    body = (
      <div className="space-y-3">
        {isOpinion && !answered && !readOnly && <NeedsClinician gaps={gaps} />}
        {isRecords && !answered && !readOnly && (referrerGap || referrerField) ? (
          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-[13px] text-amber-950">
            <p>
              {props.referrerName ?? "The referrer"} uses its own reference here, so the referral&apos;s reference has not been copied in. Enter{" "}
              {props.referrerName ? `${props.referrerName}'s` : "their"} reference from their instruction letter – it is marked as entered by staff.
              {!q.required && " This box is optional – leave it blank if you do not have it."}
            </p>
            {props.referralValue && referrerGap && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 bg-white"
                onClick={() => {
                  startClinicianText(props.referralValue ?? "");
                  dispatch({ type: "resolveGap", gapId: referrerGap.id, kind: "resolved", text: `Confirmed by ${actor}: the referrer asked for the referral's own reference.`, actor });
                }}
              >
                Use the referral&apos;s reference “{props.referralValue}”
              </Button>
            )}
          </div>
        ) : isRecords && !answered && !readOnly ? (
          <p className="text-[13px] text-slate-600">The clinic record does not hold this value, so it was left blank. Enter it if you know it – it is marked as entered by staff.</p>
        ) : null}
        {renderParagraphs({
          emptyPlaceholder: isOpinion
            ? "Write your clinical opinion here. It is marked as your own (Clinician) and needs no citation."
            : "Write the answer here. It is marked as your own (Clinician).",
          supporting: false,
        })}
      </div>
    );
  }

  return (
    <article
      id={`q-${q.key}`}
      aria-labelledby={headingId}
      className={cn(
        "scroll-mt-40 rounded-2xl border bg-white p-4 shadow-sm transition-shadow sm:p-5 lg:scroll-mt-28",
        status === "blocked" ? "border-red-200" : status === "needs_input" ? "border-amber-200" : "border-slate-200",
      )}
    >
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <span className="mt-0.5 rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-slate-600">
          {q.key.startsWith("F-") ? q.key : `§${q.number}`}
        </span>
        <div className="min-w-0 flex-1 basis-60">
          {q.context && <p className="text-xs text-slate-500">Part of: {q.context}</p>}
          <h3 id={headingId} tabIndex={-1} className="text-[15px] font-semibold leading-snug text-slate-900 focus:outline-none">
            {q.label}
          </h3>
          {q.guidance && <p className="mt-1 text-[13px] leading-relaxed text-slate-500">{q.guidance}</p>}
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5">
          {props.onCopy && <CopyAnswerButton label={q.label} enabled={Boolean(props.copyable)} onCopy={() => props.onCopy?.(q.key)} />}
          <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-slate-50 px-2 text-[11px] font-medium", meta.text)}>
            <StatusDot status={status} />
            {meta.label}
          </span>
        </span>
      </header>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
        {q.answerType && <span>{ANSWER_TYPE_LABELS[q.answerType]}</span>}
        {section && <span>{q.required ? "Required" : "Optional"}</span>}
        {fillSourceText && (
          <span className="inline-flex items-center gap-1">
            {isOpinion ? <UserRound className="h-3 w-3" aria-hidden /> : isRecords ? <Lock className="h-3 w-3" aria-hidden /> : <PenLine className="h-3 w-3" aria-hidden />}
            {fillSourceText}
          </span>
        )}
      </div>
      <div className="mt-3">{body}</div>
      {absence.length > 0 && (
        <div className="mt-3 flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-2 text-[13px] text-sky-950">
          <p className="min-w-0 flex-1 basis-64">
            Your answer now covers this. Remove the draft&apos;s “not recorded” wording, so the form does not contradict you?{" "}
            <q className="text-sky-900/80">{absence[0].sentence}</q>
            {absence.length > 1 ? ` (+${absence.length - 1} more)` : ""}
          </p>
          <Button type="button" size="sm" variant="outline" className="h-8 bg-white" onClick={() => dispatch({ type: "removeAbsence", key: q.key, actor })}>
            Remove it
          </Button>
        </div>
      )}
      {(sectionFlags.length > 0 || gaps.length > 0) && (
        <div className="mt-3 space-y-2">
          {gaps.map((g) => (
            <GapItem
              key={g.id}
              gap={g}
              compact
              hideQuestion={showsNeedsClinician}
              bundle={bundle}
              readOnly={readOnly}
              resolution={resolutionOptionsFor({ own: props.answeredByPerson, opinion: section?.kind === "clinician_opinion", gap: g, actor })}
              onResolve={(gapId, kind, text) => dispatch({ type: "resolveGap", gapId, kind, text, actor })}
              onReopen={(gapId) => dispatch({ type: "reopenGap", gapId, actor })}
              onOpenSource={onOpenSource}
            />
          ))}
          {sectionFlags
            .filter((f) => f.code !== "OPEN_GAP")
            .map((f) => (
              <FlagItem
                key={f.id}
                flag={f}
                compact
                readOnly={readOnly}
                canAck={canAcknowledge(f)}
                onAcknowledge={(flagId, reason) => dispatch({ type: "acknowledgeFlag", flagId, reason, actor })}
              />
            ))}
        </div>
      )}
    </article>
  );
}

function NeedsClinician({ gaps }: { gaps: Gap[] }) {
  const open = gaps.find((g) => !g.resolution);
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50/70 px-3 py-2.5 text-[13px] text-amber-950">
      <p className="flex items-center gap-1.5 font-medium">
        <UserRound className="h-4 w-4 text-amber-700" aria-hidden /> Needs clinician input
      </p>
      <p className="mt-0.5 leading-relaxed">
        No clinician recorded an opinion on this in the notes, so it has been left blank rather than guessed. Only the treating clinician can answer it.
      </p>
      {open?.suggestedQuestion && (
        <p className="mt-1">
          <span className="font-medium">Suggested question:</span> {open.suggestedQuestion}
        </p>
      )}
    </div>
  );
}

function LockedRecordsAnswer({
  text,
  sourceIds,
  bundle,
  connectorId,
  activeSourceId,
  onOpenSource,
}: {
  text: string;
  sourceIds: string[];
  bundle: EpisodeBundle;
  connectorId: ConnectorId;
  activeSourceId: string | null;
  onOpenSource(id: string): void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="flex items-start gap-2 whitespace-pre-wrap rounded-lg border border-teal-100 bg-teal-50/40 px-3 py-2 text-sm leading-relaxed text-slate-900">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-700" aria-hidden />
        <span className="min-w-0">{text}</span>
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <OriginPill origin="from_records" label={originLabel("from_records", connectorId)} />
        {sourceIds.map((id) => (
          <CitationChip key={id} id={id} bundle={bundle} onOpen={onOpenSource} active={activeSourceId === id} />
        ))}
        <span className="text-[11px] text-slate-500">{WORDING.byCode.lockedFromRecords}</span>
      </div>
    </div>
  );
}

export const QuestionCard = memo(QuestionCardImpl);
