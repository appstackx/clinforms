"use client";

/**
 * One question of the referrer's form (or one section of a built-in report) in the review centre
 * column: the label as printed, the referrer's guidance, an answer editor for its type, where each part
 * of the answer came from (origin pills and citation chips) and the checks and gaps on it – its open gaps and the
 * checks its own answer clears as one item (BoxIssue, fix 10/2026).
 *
 * bh2 WC: who entered each part is read from its stamps (provenance.ts – never from the box's fill source alone); a
 * proposal in a clinician box says so and offers the approving clinician one "Adopt" click; "These are my own words"
 * is the approver's, refused while drafted wording is still in the paragraph ("Split it out"); what the person here may
 * not do is not offered, and the card says who decides.
 *
 * Owner: WC (review roles and provenance) – docs/bh2-ownership.json (formerly studio-b agent).
 */
import { memo, useEffect, useRef, useState } from "react";
import { Loader2, Lock, NotebookPen, PenLine, Plus, RotateCcw, Scissors, Trash2, UserRound, UserRoundCheck } from "lucide-react";
import { formatUkDate, isValidIsoDate, parseUkDate } from "../../../core/dates";
import { blankFor, blankForWording } from "../../../core/parties";
import { humaniseMergeCodes } from "../../../core/practice-merge-codes";
import { answerKindFor, isSectionAnswered, leftBlankEffect, parseFormAnswerValue, recordSourceOf, signoffValuesFromReceipt } from "../../../core/forms";
import { showsReferrerReferenceNotice } from "../../../core/form-record-rules";
import { ANSWER_TYPE_LABELS, PARAGRAPH_BASIS_LABELS, RECORD_SOURCE_LABELS, SIGNOFF_PART_LABELS } from "../../../core/labels";
import { nameClinicianInstead } from "../../../core/voice";
import type { ConnectorId, EpisodeBundle, FormDefinition, Gap, Paragraph, Report, ReportFlag, ReportSection, ReportTemplate, SignReceipt } from "../../../core/types";
import { useStudioMode } from "../../host-hooks";
import { Button, cn } from "../../primitives";
import { TENANT_COPY } from "../../studio-copy";
import { WORDING } from "../../wording";
import { useFillSourceLabels } from "../shared/ui-bits";
import type { BoxItem } from "./box-items";
import { BoxIssue, FlagItem, GapItem } from "./issues";
import { TableAnswer } from "./table-answer";
import { rowsOf } from "./table-answer-model";
import {
  QUESTION_STATUS_META,
  answerOptions,
  mayMarkOwnWords,
  nextClinicianParagraphId,
  originLabel,
  ownWordsBlockers,
  paragraphProvenanceLine,
  resolutionOptionsFor,
  splitOutPlan,
  storedSuggestion,
  structuredAnswerBy,
  supersededAbsenceSentences,
  type QuestionStatus,
  type ReviewQuestion,
} from "./review-model";
import { OneClickOffers, type ReviewOneClicks } from "./one-click-offers";
import { CopyAnswerButton } from "./copy-answers";
import { AutoTextarea, CitationChip, OriginPill, Pill, StatusDot } from "./review-ui";
import type { Actor } from "../../../core/actor";
import { enteredByName, othersUncitedParagraph, sameMember } from "../../../core/provenance";
import type { ReviewAction } from "./use-review-state";

export interface QuestionCardProps {
  q: ReviewQuestion;
  status: QuestionStatus;
  /** Flags on this question (section-level and paragraph-level). */
  flags: ReportFlag[];
  gaps: Gap[];
  /** What blocks approval on this question as one item (box-items.ts), when anything does. */
  box?: BoxItem;
  /** Checks shown inside a question's item (this one's or another's): not listed again. */
  hiddenFlagIds?: ReadonlySet<string>;
  bundle: EpisodeBundle;
  connectorId: ConnectorId;
  referrerName: string | null;
  /** The report is approved: read-only from now on, and its drafted paragraphs and answers are no longer called drafts. */
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
  /**
   * Fix wave 3: when the referral holds no reference, the policy or membership number the record does hold (an
   * insurer's "Policy / claim no." usually asks for it), offered as "Use the policy number …".
   */
  referralFallback?: string | null;
  receipt: SignReceipt | undefined;
  activeSourceId: string | null;
  drafting: boolean;
  actor: Actor;
  dispatch(action: ReviewAction): void;
  onOpenSource(id: string): void;
  canAcknowledge(flag: ReportFlag): boolean;
  onDraft?: (key: string) => void;
  /** "Copy" this question's answer (form reports; copy-answers.tsx). Stable callback. */
  onCopy?: (key: string) => void;
  /** The question has an answer to copy. */
  copyable?: boolean;
  /** Fix round 1 (B0-7): why this conditional question does not apply ("“ANY FURTHER TREATMENT…?” is “NO”"), or null. */
  notApplicableBecause?: string | null;
  /** bh2 WC: the person here makes the approving clinician's decisions on this report (core/provenance.ts actsAsApprover). */
  mayDecide?: boolean;
  /** WC design 5: "Entered by Pat Morgan (staff) – the approving physio must adopt it", when the box holds a proposal. */
  proposal?: string | null;
  /** WC design 4: who settles a gap the person here may not ("Only Sarah Reid, the approving clinician, can settle this."). */
  approverOnlyFor?: (gap: Gap) => string | null;
  /** WC design 4: who may acknowledge a flag the person here may not. */
  onlyWhoFor?: (flag: ReportFlag) => string | null;
  /** The approving clinician's name (for the card's wording), or null. */
  approverName?: string | null;
  /** The report's approving clinician (Report.approver), or null. */
  approver?: Report["approver"] | null;
  /**
   * R1T-WC-12: why the box is not asked, as a kind – a rule ("condition", "session_not_attended") or a person's decision
   * ("person") – so the approver is offered "This applies – print my answer" or "It applies after all"; null when asked.
   */
  notAskedKind?: "condition" | "session_not_attended" | "person" | null;
  /**
   * R1T-WC-L2 (orchestrator decision 26/10): the one-click corrections on this box's flags (one-click-offers.tsx – the
   * same set the Flags tab offers), with the report they apply to. Only a box with offers gets them, so the other cards
   * stay memoised.
   */
  oneClicks?: ReviewOneClicks;
  report?: Report;
  template?: ReportTemplate;
  form?: FormDefinition | null;
}

/* Paragraphs ------------------------------------------------------------------------------------ */

const isPersonOrigin = (o: Paragraph["origin"]) => o === "clinician" || o === "edited" || o === "staff";

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
  section,
  mayDecide = true,
  onlyWhoFor,
  supporting = false,
  oneClicks,
  report,
  template,
  form,
  approverRef,
}: {
  /** R1T-WC-L5: supporting text of a structured answer (never printed) – its own accessible name. */
  supporting?: boolean;
  oneClicks?: ReviewOneClicks;
  report?: Report;
  template?: ReportTemplate;
  form?: FormDefinition | null;
  /** The report's approving clinician (WC-08: Adopt someone else's uncited words). */
  approverRef?: Report["approver"] | null;
  staffEntry?: boolean;
  /** The box (stamps, adoption and the drafted wording "These are my own words" is checked against). */
  section?: ReportSection | null;
  /** The person here makes the approver's decisions (own words, attribution fixes). */
  mayDecide?: boolean;
  onlyWhoFor?: (flag: ReportFlag) => string | null;
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
  actor: Actor;
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

  // R1T-WC-L5: supporting text is never printed – never named as the answer itself (a screen reader types into the right box).
  const what = supporting ? `Supporting text for “${questionLabel}” (not printed)` : `Answer to “${questionLabel}”`;
  const label = total > 1 ? `${what}, paragraph ${index + 1} of ${total}` : what;
  // WC design 7: who wrote it, from its stamps; an older paragraph with none keeps the earlier wording.
  const byOther = Boolean(paragraph.by && isPersonOrigin(paragraph.origin) && !sameMember(paragraph.by, actor));
  const provenance =
    section && (paragraph.ownWords || section.adoptedBy || (paragraph.by && !byOther)) ? paragraphProvenanceLine(paragraph, section, actor) : null;
  // WC design 6: "These are my own words" – the approver's, on a paragraph they edited; refused while drafted wording is in it.
  // R1T-WC-08: only on the approver's own rewrite – someone else's words are adopted (they keep their author's name).
  const ownWordsOffer = !readOnly && mayDecide && section && paragraph.origin === "edited" && paragraph.text.trim() && !paragraph.ownWords && mayMarkOwnWords({ approver: approverRef ?? undefined }, paragraph, actor);
  const blockers = ownWordsOffer && section ? ownWordsBlockers(section, paragraph) : [];
  // R1T-WC-L1: "Split it out" only when it changes something (some of the paragraph is the approver's own).
  const splittable = Boolean(ownWordsOffer && section && blockers.length > 0 && splitOutPlan(section, paragraph));
  // R1T-WC-08: someone else's uncited words in a box that is not a clinician box – the approver adopts them.
  const adoptOthers = !readOnly && mayDecide && Boolean(section && approverRef && othersUncitedParagraph(section, paragraph, approverRef ?? null));

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
          onChange={(e) => dispatch({ type: "editParagraph", key: sectionKey, paragraphId: paragraph.id, text: e.target.value, actor })}
          onBlur={(e) => {
            const before = textAtFocus.current;
            textAtFocus.current = null;
            const now = e.target.value;
            // A paragraph a person added and left empty goes again (staff's are "edited" with no draft behind them).
            if (!now.trim() && (paragraph.origin === "clinician" || (paragraph.origin === "edited" && paragraph.originalText === undefined))) {
              dispatch({ type: "removeParagraph", key: sectionKey, paragraphId: paragraph.id, actor, silent: before === "" || before === null });
              return;
            }
            if (before !== null && before !== now) dispatch({ type: "logEdit", key: sectionKey, actor });
          }}
          className={cn(paragraph.origin === "edited" && "border-violet-300", paragraph.origin === "clinician" && "border-indigo-300")}
        />
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <OriginPill
          origin={paragraph.origin}
          label={
            byOther && paragraph.by
              ? `${paragraph.origin === "edited" && paragraph.originalText !== undefined ? "Edited" : "Entered"} by ${enteredByName(paragraph.by)}`
              : staffEntry && paragraph.origin === "clinician" && !paragraph.by
                ? "Entered by staff"
                : originLabel(paragraph.origin, connectorId, readOnly)
          }
        />
        {paragraph.basis && paragraph.origin !== "from_records" && (
          <span className="text-[11px] text-slate-500">{PARAGRAPH_BASIS_LABELS[paragraph.basis]}</span>
        )}
        {paragraph.sourceIds.map((id) => (
          <CitationChip key={id} id={id} bundle={bundle} onOpen={onOpenSource} active={activeSourceId === id} />
        ))}
        {(paragraph.origin === "ai" || paragraph.origin === "edited") && paragraph.sourceIds.length === 0 && (
          <span className="text-[11px] font-medium text-red-700">No source cited</span>
        )}
        {provenance ? (
          <span className="text-[11px] text-slate-500">{provenance}</span>
        ) : (
          paragraph.origin === "clinician" && (
            <span className="text-[11px] text-slate-500">{staffEntry ? "Typed in by staff – kept in the activity log" : "Your own words – no citation needed"}</span>
          )
        )}
        {ownWordsOffer && blockers.length === 0 && (
          <button
            type="button"
            onClick={() => dispatch({ type: "markOwnWords", key: sectionKey, paragraphId: paragraph.id, actor })}
            className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-indigo-800 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488]"
          >
            <UserRoundCheck className="h-3 w-3" aria-hidden /> These are my own words
          </button>
        )}
        {!readOnly && paragraph.origin === "edited" && paragraph.originalText !== undefined && (
          <button
            type="button"
            onClick={() => {
              dispatch({ type: "revertParagraph", key: sectionKey, paragraphId: paragraph.id, actor });
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
      {ownWordsOffer && blockers.length > 0 && (
        // WC design 6: refused while drafted wording remains – the drafted sentence can be moved out first.
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-lg border border-sky-200 bg-sky-50/70 px-2.5 py-1.5 text-[12px] text-sky-950">
          <p className="min-w-0 flex-1 basis-56">
            Drafted wording is still in this paragraph, so it cannot be recorded as your own words: <q>{blockers[0]}</q>
            {blockers.length > 1 ? ` (+${blockers.length - 1} more)` : ""}
            {!splittable ? " Every sentence of it is drafted wording – put the draft back, or write your own." : ""}
          </p>
          {splittable && (
            <button
              type="button"
              onClick={() => dispatch({ type: "splitOutResidue", key: sectionKey, paragraphId: paragraph.id, actor })}
              className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-sky-900 hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488]"
            >
              <Scissors className="h-3 w-3" aria-hidden /> Split it out
            </button>
          )}
        </div>
      )}
      {flags.length > 0 && (
        <div className="space-y-1.5">
          {flags.map((f) => {
            // "Name Tom Ellis instead" (fix round 1): another clinician's note written as "I" / "my".
            const named = mayDecide && f.code === "OTHER_CLINICIAN_VOICE" && f.evidence && !/,| and /.test(f.evidence) ? nameClinicianInstead(paragraph.text, f.evidence) : null;
            return (
              <FlagItem
                key={f.id}
                flag={f}
                compact
                readOnly={readOnly}
                onlyWho={onlyWhoFor?.(f) ?? null}
                canAck={canAcknowledge(f)}
                onAcknowledge={(flagId, reason) => dispatch({ type: "acknowledgeFlag", flagId, reason, actor })}
                {...(named && { fix: { label: `Name ${f.evidence} instead`, onFix: () => dispatch({ type: "nameClinicians", flags: [f], actor }) } })}
                {...(adoptOthers && f.code === "UNCITED_PARAGRAPH" ? { onAdopt: () => dispatch({ type: "adopt", key: sectionKey, actor }) } : {})}
                {...(oneClicks && report && !readOnly
                  ? { extra: <OneClickOffers report={report} flag={f} actor={actor} dispatch={dispatch} offers={oneClicks} template={template} form={form ?? null} readOnly={readOnly} skipGenerators={named ? ["name-instead"] : []} /> }
                  : {})}
              />
            );
          })}
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
    // "N/A": the clinician's answer that the date or number does not apply – written on the form as N/A.
    if (/^(?:n\/?a|not applicable)$/i.test(raw)) {
      setError(null);
      if (value !== "N/A") onChange("N/A");
      return;
    }
    if (isDate) {
      const iso = parseUkDate(raw) ?? (isValidIsoDate(raw) ? raw : null);
      if (!iso) return setError("Enter the date as DD/MM/YYYY, for example 07/07/2026 – or N/A if it does not apply.");
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
        inputMode={isDate ? "text" : "decimal"}
        placeholder={isDate ? "DD/MM/YYYY or N/A" : "Number or N/A"}
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
  const mayDecide = props.mayDecide ?? true;
  const approverRef = props.approver ?? props.report?.approver ?? null;
  const approverOnlyFor = props.approverOnlyFor ?? (() => null);
  const notApplicableBecause = props.notApplicableBecause ?? null;
  const tenant = useStudioMode() === "tenant";
  const sourceLabels = useFillSourceLabels();
  const section = q.section;
  const [focusId, setFocusId] = useState<string | null>(null);
  const clearFocus = useRef(() => setFocusId(null)).current;
  const meta = QUESTION_STATUS_META[status];
  const headingId = `q-${q.key}-label`;
  const field = q.field;
  // A box left blank says whose it is ("For the patient to complete"), not just "referrer's use".
  const blankWording = !section && field ? blankForWording(blankFor(field), props.referrerName) : null;
  // A value the record lacks (a withheld insurer number), typed in by staff: say so, not "by the clinician".
  // (bh2 WC: an entry stamped by a clinician is theirs – B1-7(b); an older entry with no stamp keeps "entered by staff".)
  const staffEntered =
    section?.kind === "from_records" &&
    section.paragraphs.some((p) => (p.origin === "staff" || (p.origin === "clinician" && (!p.by || p.by.role === "staff"))) && p.text.trim() !== "") &&
    !section.paragraphs.some((p) => p.origin === "from_records");
  // A record value the record does not hold (another insurer's membership number withheld) is for staff to
  // enter, not a clinical question.
  // Fix round 1 (B0-19): a staff entry, the physiotherapist's choice or the clinic's own details, said as such.
  const recordSource = field ? recordSourceOf(field) : null;
  const statusLabel =
    status === "blank" && blankWording
      ? blankWording.chip
      : staffEntered && status === "clinician"
        ? "Entered by staff"
        : status === "needs_input" && section?.kind === "from_records"
          ? recordSource === "physio_choice"
            ? "To be chosen by the physiotherapist"
            : "To be entered by staff"
          : meta.label;
  const answered = section ? isSectionAnswered(section) : false;

  // An unanswered opinion question already says "Needs clinician input" (and its gap explains why), so
  // its "required and empty" check is listed in the Flags tab rather than repeated here.
  // (A question that does not apply asks nobody for an opinion – fix round 2.)
  // B2-23: not once the box is left blank on purpose (every gap of it settled).
  const showsNeedsClinician =
    section?.kind === "clinician_opinion" && !readOnly && section.status !== "pending" && !isSectionAnswered(section) && !notApplicableBecause && gaps.some((g) => !g.resolution);
  const box = props.box;
  const hidden = props.hiddenFlagIds;
  const sectionFlags = flags.filter(
    (f) => !f.paragraphId && !hidden?.has(f.id) && !(showsNeedsClinician && f.code === "MISSING_PLACEHOLDER" && f.evidence === "empty section"),
  );
  const paragraphFlags = (pid: string) => flags.filter((f) => f.paragraphId === pid && !hidden?.has(f.id));
  // Open gaps in the question's item are shown there; resolved ones (and any other) as before.
  const otherGaps = box ? gaps.filter((g) => !box.gaps.includes(g)) : gaps;

  const fillSourceText = staffEntered
    ? recordSource === "clinic"
      ? "Entered by staff for this report – not from your Clinic details (see the Activity tab)"
      : "Typed in by staff – not from the clinic record (see the Activity tab)"
    : field
      ? recordSource
        ? RECORD_SOURCE_LABELS[recordSource].long
        : sourceLabels.long[field.fillSource.kind]
      : section
        ? section.kind === "from_records"
          ? tenant
            ? TENANT_COPY.sources.registrationLong
            : "From records – filled by code"
          : section.kind === "declaration"
            ? "Declaration – fixed wording"
            : WORDING.labels.fillSourceNotesNarrative
        : "";

  const structuredKind = section?.answer && section.answer.kind !== "text" ? section.answer.kind : null;
  const isRecords = section?.kind === "from_records";
  const isOpinion = section?.kind === "clinician_opinion";
  const paragraphsAll = section?.paragraphs ?? [];
  // Locked only while the answer is the one filled by code from the record (a value the clinician
  // entered for a missing record value stays editable).
  const recordsLocked = isRecords && answered && paragraphsAll.length > 0 && paragraphsAll.every((p) => p.origin === "from_records");

  const absence = section && !readOnly && mayDecide ? supersededAbsenceSentences(section) : [];
  const referrerGap = gaps.find((g) => g.id.endsWith("-referrer") && !g.resolution) ?? null;
  const referrerField =
    field?.fillSource.kind === "registration" && showsReferrerReferenceNotice(field.fillSource.path, props.referrerName ?? null, bundle);
  // The card already says to enter the referrer's own reference.
  const referrerNotice = Boolean(isRecords && !answered && !readOnly && (referrerGap || referrerField));

  const startClinicianText = (text: string) => {
    if (!section) return;
    const id = nextClinicianParagraphId(section);
    dispatch({ type: "addParagraph", key: section.key, text, actor });
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
          section={section}
          mayDecide={mayDecide}
          onlyWhoFor={props.onlyWhoFor}
          supporting={opts.supporting}
          oneClicks={props.oneClicks}
          report={props.report}
          template={props.template}
          form={props.form}
          approverRef={props.report?.approver ?? approverRef}
        />
      ))}
      {!readOnly && section?.blankFromRecords && visibleParagraphs.length === 0 && !opts.supporting && !notApplicableBecause && (
        // R1T-WC-L4: the reason for the record part involved – never an address line for a session row (a session that
        // did not happen says so in its "Not applicable" notice instead).
        <p className="text-[12px] text-slate-600">
          {blankRecordReason(field)} Type here only if something should go on this line.
        </p>
      )}
      {!readOnly && !recordsLocked && visibleParagraphs.length === 0 && !opts.supporting && (
        <AutoTextarea
          aria-label={`Answer to “${q.label}”`}
          value=""
          minRows={isOpinion ? 3 : 2}
          placeholder={isRecords && referrerField ? `${props.referrerName ?? "The referrer"}'s reference` : isRecords ? "Type the value – it is marked as entered by you." : opts.emptyPlaceholder}
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
        {blankWording ? blankWording.sentence : "Left blank on the form."}
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
  } else if (section.status === "pending" && !answered && !readOnly) {
    // (Once approved, a question never drafted reads "Left blank on the form." below, not "Not drafted yet.")
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
  } else if (structuredKind === "rows") {
    // Table answers (S2): the rows under the printed headers; staff can correct cells and rows.
    body = (
      <div className="space-y-3">
        <TableAnswer
          questionKey={q.key}
          label={q.label}
          field={field}
          rows={rowsOf(section.answer?.value)}
          readOnly={readOnly}
          onChange={(rows) => dispatch({ type: "setRows", key: q.key, rows, actor })}
        />
        {paragraphs.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {props.answerEdited ? (
              <Pill className="border-violet-200 bg-violet-50 text-violet-800">Rows changed by staff</Pill>
            ) : (
              <OriginPill origin="from_records" label={originLabel("from_records", connectorId)} />
            )}
            <span className="text-[11px] text-slate-500">{paragraphs[0].text}</span>
            {Array.from(new Set(paragraphs.flatMap((p) => p.sourceIds))).map((id) => (
              <CitationChip key={id} id={id} bundle={bundle} onOpen={onOpenSource} active={props.activeSourceId === id} />
            ))}
          </div>
        )}
      </div>
    );
  } else if (structuredKind) {
    const raw = section.answer?.value ?? null;
    const value = Array.isArray(raw) ? null : raw;
    const isChoice = structuredKind === "yes_no" || structuredKind === "choice" || structuredKind === "checkbox";
    // WC design 7 / B2-20: who chose the answer is its stamp (Section.answerBy) – never "changed" when nothing was there.
    const chosenBy = structuredAnswerBy(section);
    // R1T-WC-10: an answer no person's stamp vouches for keeps its own provenance – drafted – never "Clinician".
    const ownWords = paragraphs.some((p) => p.origin === "clinician" && p.text.trim() && (!p.by || sameMember(p.by, approverRef ?? undefined)));
    const proposedBy = isRecords && !chosenBy ? null : chosenBy ? "person" : value === null ? null : ownWords ? "clinician" : "ai";
    body = (
      <div className="space-y-3">
        {isOpinion && value === null && !readOnly && !notApplicableBecause && gaps.some((g) => !g.resolution) && <NeedsClinician gaps={gaps} approverName={props.approverName ?? null} opinion />}
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
                {proposedBy === "ai" && (
                  <Pill className="border-sky-200 bg-sky-50 text-sky-800">{readOnly ? WORDING.origin.answerDraftedApproved : WORDING.origin.answerDrafted}</Pill>
                )}
                {proposedBy === "person" && chosenBy && (
                  <Pill className={chosenBy.role === "staff" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-indigo-200 bg-indigo-50 text-indigo-800"}>
                    {sameMember(chosenBy, actor) ? "Your answer" : `Chosen by ${enteredByName(chosenBy)}`}
                  </Pill>
                )}
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
        // Fix round 1 (B0-4): the clinic's own details are changed on the report when another site treated the patient.
        clinic={recordSource === "clinic"}
        onOverride={!readOnly && recordSource === "clinic" ? () => dispatch({ type: "overrideRecord", key: q.key, actor }) : undefined}
      />
    );
  } else {
    body = (
      <div className="space-y-3">
        {isOpinion && !answered && !readOnly && !notApplicableBecause && gaps.some((g) => !g.resolution) && <NeedsClinician gaps={gaps} approverName={props.approverName ?? null} opinion />}
        {referrerNotice ? (
          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-[13px] text-amber-950">
            <p>
              {props.referralValue
                ? `${props.referrerName ?? "The referrer"} uses its own reference here, so the referral's reference has not been copied in. `
                : `${props.referrerName ?? "The referrer"} asks for its own reference here, and the record holds none. `}
              Enter {props.referrerName ? `${props.referrerName}'s` : "their"} reference from their instruction letter – it is marked as entered by staff.
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
                  dispatch({ type: "resolveGap", gapId: referrerGap.id, kind: "resolved", text: `Confirmed by ${actor.name}: the referrer asked for the referral's own reference.`, actor });
                }}
              >
                Use the referral&apos;s reference “{props.referralValue}”
              </Button>
            )}
            {!props.referralValue && props.referralFallback && referrerGap && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 bg-white"
                onClick={() => {
                  startClinicianText(props.referralFallback ?? "");
                  dispatch({ type: "resolveGap", gapId: referrerGap.id, kind: "resolved", text: `Confirmed by ${actor.name}: the policy or membership number is the reference asked for.`, actor });
                }}
              >
                Use the policy or membership number “{props.referralFallback}”
              </Button>
            )}
          </div>
        ) : isRecords && !answered && !readOnly ? (
          <p className="text-[13px] text-slate-600">
            {recordSource === "staff_entry"
              ? `Entered by staff on each report: ${field && (answerKindFor(field.answerType) === "checkbox" || answerKindFor(field.answerType) === "yes_no") ? "tick it" : field && answerKindFor(field.answerType) === "choice" ? "choose it" : "type it"} from your records – it is marked as entered by you.`
              : recordSource === "physio_choice"
                ? "Chosen by the physiotherapist on each report."
                : recordSource === "clinic"
                  ? "Your Clinic details do not hold this yet. Add it in Clinic settings, or type it here for this patient's site – it is marked as entered by staff."
                  : "The clinic record does not hold this value, so it was left blank. Enter it if you know it – it is marked as entered by staff."}
          </p>
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
            {humaniseMergeCodes(q.label)}
          </h3>
          {q.guidance && <p className="mt-1 text-[13px] leading-relaxed text-slate-500">{humaniseMergeCodes(q.guidance)}</p>}
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5">
          {props.onCopy && <CopyAnswerButton label={q.label} enabled={Boolean(props.copyable)} onCopy={() => props.onCopy?.(q.key)} />}
          <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-slate-50 px-2 text-[11px] font-medium", meta.text)}>
            <StatusDot status={status} />
            {statusLabel}
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
      {notApplicableBecause && (
        // Fix round 1 (B0-7): a conditional question the answer before it rules out.
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-3 py-2 text-[13px] text-slate-600" data-testid="not-applicable">
          <p className="min-w-0 flex-1 basis-56">Not applicable: {notApplicableBecause} – nothing is printed here, and its checks do not block approval.</p>
          {/* R1T-WC-12: the approving clinician decides that a ruled-out question applies (audited; the store refuses it from anyone else). */}
          {!readOnly && mayDecide && section && props.notAskedKind === "condition" && (
            <Button type="button" size="sm" variant="outline" className="h-8 bg-white" onClick={() => dispatch({ type: "setDisposition", key: q.key, kind: "applies_anyway", reason: APPLIES_REASON, actor })}>
              This applies – print my answer
            </Button>
          )}
          {!readOnly && mayDecide && section && props.notAskedKind === "person" && (
            <Button type="button" size="sm" variant="outline" className="h-8 bg-white" onClick={() => dispatch({ type: "setDisposition", key: q.key, kind: null, actor })}>
              It applies after all
            </Button>
          )}
        </div>
      )}
      {!notApplicableBecause && section?.disposition?.kind === "applies_anyway" && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-3 py-2 text-[13px] text-slate-600" data-testid="applies-anyway">
          <p className="min-w-0 flex-1 basis-56">
            Printed although the answer before it rules it out – decided by {section.disposition.by.name}. Every check runs on it.
          </p>
          {!readOnly && mayDecide && (
            <Button type="button" size="sm" variant="outline" className="h-8 bg-white" onClick={() => dispatch({ type: "setDisposition", key: q.key, kind: null, actor })}>
              Undo – it does not apply
            </Button>
          )}
        </div>
      )}
      {!notApplicableBecause && !readOnly && mayDecide && section?.condition && section.disposition?.kind !== "applies_anyway" && (
        // R1T-WC-12: a conditional question the approving clinician knows does not apply here.
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => dispatch({ type: "markNotApplicable", key: q.key, on: true, reason: NOT_APPLICABLE_REASON, actor })}
            className="text-xs font-medium text-slate-600 underline underline-offset-2 hover:text-slate-900"
          >
            Not applicable
          </button>
        </div>
      )}
      {props.proposal && !readOnly && (
        // WC design 5: someone other than the approver entered this – a proposal until the approver adopts it.
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-950" data-testid="proposal">
          <p className="min-w-0 flex-1 basis-56">
            <span className="font-medium">{props.proposal}.</span>{" "}
            {mayDecide ? "Check it, then adopt it as your answer – or change it yourself." : `${props.approverName ?? "The approving clinician"} adopts it, or changes it.`}
          </p>
          {mayDecide && (
            <Button type="button" size="sm" className="h-8" onClick={() => dispatch({ type: "adopt", key: q.key, actor })}>
              <UserRoundCheck className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Adopt as my answer
            </Button>
          )}
        </div>
      )}
      <div className="mt-3">{body}</div>
      {(status === "blank" || status === "left_blank") && section && field && leftBlankEffect(field) && (
        // Fix round 1 (B0-2): what leaving it blank changes on the printed form.
        <p className="mt-2 text-[12px] text-slate-600">Left blank on the form: {leftBlankEffect(field)}.</p>
      )}
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
      {(box || sectionFlags.length > 0 || otherGaps.length > 0) && (
        <div className="mt-3 space-y-2">
          {box && (
            <BoxIssue
              box={box}
              compact
              hideInstruction={referrerNotice || showsNeedsClinician}
              hideGapIssue={referrerNotice}
              hideQuestion={showsNeedsClinician}
              bundle={bundle}
              readOnly={readOnly}
              resolutionFor={(g) => resolutionOptionsFor({ own: props.answeredByPerson, opinion: section?.kind === "clinician_opinion", gap: g, actor: actor.name, approverOnly: approverOnlyFor(g) })}
              onResolve={(gapId, kind, text) => dispatch({ type: "resolveGap", gapId, kind, text, actor })}
              onReopen={(gapId) => dispatch({ type: "reopenGap", gapId, actor })}
              onTickSuggested={(g) => {
                // R1T-WC-11: the suggestion as the box stores it (true / false, or the printed option) – never a word it cannot hold.
                const value = storedSuggestion(field, g.suggestedAnswer);
                if (value !== undefined) dispatch({ type: "setAnswer", key: g.sectionKey, value, actor });
              }}
              tickable={(g) => storedSuggestion(field, g.suggestedAnswer) !== undefined}
              opinionBox={isOpinion}
              onOpenSource={onOpenSource}
            />
          )}
          {otherGaps.map((g) => (
            <GapItem
              key={g.id}
              gap={g}
              compact
              hideQuestion={showsNeedsClinician}
              bundle={bundle}
              readOnly={readOnly}
              resolution={resolutionOptionsFor({ own: props.answeredByPerson, opinion: section?.kind === "clinician_opinion", gap: g, actor: actor.name, approverOnly: approverOnlyFor(g) })}
              onResolve={(gapId, kind, text) => dispatch({ type: "resolveGap", gapId, kind, text, actor })}
              onReopen={(gapId) => dispatch({ type: "reopenGap", gapId, actor })}
              opinionBox={isOpinion}
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
                onlyWho={props.onlyWhoFor?.(f) ?? null}
                onAcknowledge={(flagId, reason) => dispatch({ type: "acknowledgeFlag", flagId, reason, actor })}
                {...(f.code === "APPROVER_DECISION" && mayDecide ? { onAdopt: () => dispatch({ type: "adopt", key: q.key, actor }) } : {})}
                {...(props.oneClicks && props.report && !readOnly
                  ? { extra: <OneClickOffers report={props.report} flag={f} actor={actor} dispatch={dispatch} offers={props.oneClicks} template={props.template} form={props.form ?? null} readOnly={readOnly} /> }
                  : {})}
              />
            ))}
        </div>
      )}
    </article>
  );
}

/**
 * "Needs clinician input" (WC design 7, B3-10, B2-23): worded from the gap's kind (Gap.kind), never from guesses about
 * its wording – and only while one of the box's gaps is open.
 */
export function needsClinicianText(gap: Pick<Gap, "kind" | "id"> | undefined, opts: { opinion?: boolean } = {}): string {
  // R1T-WC-L3: on an opinion box a held-back answer is held back because it is an opinion – whatever the notes say.
  if (opts.opinion && gap?.kind === "choice_held_back") return "The drafted answer was held back: it is the clinician's opinion, which only the approving clinician gives.";
  switch (gap?.kind) {
    case "no_opinion_recorded":
      return "No clinician recorded an opinion on this in the notes, so it has been left blank rather than guessed.";
    case "opinion_not_fitting_options":
      return "The opinion recorded in the notes does not fit any of the printed options, so none has been ticked.";
    case "band":
      return "The printed band is the clinician's choice, so none has been ticked.";
    case "choice_held_back":
      return "The drafted choice was held back: the cited notes do not use its words.";
    default:
      return gap?.id.endsWith("-physio") ? "The physiotherapist chooses this on each report." : "The notes do not settle this, so it has been left blank rather than guessed.";
  }
}

function NeedsClinician({ gaps, approverName, opinion = false }: { gaps: Gap[]; approverName: string | null; opinion?: boolean }) {
  const open = gaps.find((g) => !g.resolution);
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50/70 px-3 py-2.5 text-[13px] text-amber-950">
      <p className="flex items-center gap-1.5 font-medium">
        <UserRound className="h-4 w-4 text-amber-700" aria-hidden /> Needs clinician input
      </p>
      <p className="mt-0.5 leading-relaxed">
        {needsClinicianText(open, { opinion })} {approverName ? `Only the approving clinician (${approverName}) can answer it.` : "Only the treating clinician can answer it."}
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
  clinic = false,
  onOverride,
}: {
  text: string;
  sourceIds: string[];
  bundle: EpisodeBundle;
  connectorId: ConnectorId;
  activeSourceId: string | null;
  onOpenSource(id: string): void;
  /** From the clinic's own details (Clinic settings), not the uploaded notes. */
  clinic?: boolean;
  /** "Change it for this patient's site" (fix round 1, B0-4). */
  onOverride?: () => void;
}) {
  const tenant = useStudioMode() === "tenant";
  if (clinic) {
    return (
      <div className="space-y-1.5">
        <p className="whitespace-pre-wrap rounded-lg border border-teal-100 bg-teal-50/40 px-3 py-2 text-sm leading-relaxed text-slate-900">{text}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <OriginPill origin="from_records" label="From your Clinic details" />
          <span className="text-[11px] text-slate-500">Change it here when another of your sites treated this patient – it prints instead, on this report only.</span>
          {onOverride && (
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={onOverride}>
              <PenLine className="mr-1 h-3.5 w-3.5" aria-hidden /> Change it for this patient&apos;s site
            </Button>
          )}
        </div>
      </div>
    );
  }
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
        <span className="text-[11px] text-slate-500">{tenant ? TENANT_COPY.sources.lockedFromRecords : WORDING.byCode.lockedFromRecords}</span>
      </div>
    </div>
  );
}

/**
 * R1T-WC-L2 (orchestrator decision 26/10): the one-click corrections on one box – exactly the review's offers
 * (one-click-offers.tsx reviewOneClicks, the Flags tab's set) whose box is this one – or undefined when it has none (so
 * the card stays memoised). The card hands them to each of its flags as the Flags tab does (offersForFlag).
 */
export function oneClicksForBox(all: ReviewOneClicks, key: string): ReviewOneClicks | undefined {
  const fixes = all.fixes.filter((p) => p.sectionKey === key);
  const actions = all.actions.filter((a) => a.key === key);
  return fixes.length || actions.length ? { fixes, actions } : undefined;
}

/** R1T-WC-12: the reasons the audit trail records for the approver's two decisions about a conditional question. */
const APPLIES_REASON = "The approving clinician decided this question applies here.";
const NOT_APPLICABLE_REASON = "The approving clinician decided this question does not apply here.";

/**
 * R1T-WC-L4: why a line filled from the record is left empty, for the record part involved: a session row ("no attended
 * session in the notes matches this line" – when it is not already said as not applicable), an address line, or the
 * record in general.
 */
export function blankRecordReason(field: Pick<import("../../../core/types").FormField, "fillSource"> | null | undefined): string {
  const path = field?.fillSource.kind === "registration" ? field.fillSource.path : "";
  if (path.startsWith("episode.")) return "Left empty on the form: no attended session in the notes matches this line.";
  if (/address|postcode/i.test(path)) return "Left empty on the form: the record's address has no line for it.";
  return "Left empty on the form: the record has nothing for this line.";
}

export const QuestionCard = memo(QuestionCardImpl);
