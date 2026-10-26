"use client";

/**
 * Working copy of one report on the review screen: a reducer over the pure edits in review-model.ts,
 * debounced validation (the same core/validation code the server runs at /validate, /sign and /render;
 * flags are persisted on the report), debounced saving to this browser, and pick-up of newer copies
 * saved elsewhere (another tab, or drafting that finishes after navigation).
 *
 * bh2 WC: every person action carries who did it (ReviewAction.actor); after it, the reducer gives the person's text
 * its origin, stamps who decided (`by`), undoes a decision this person may not take and keeps the approver's adoption
 * in step with the box (reducer.ts withPersonOrigins / stampDecisions / enforceDecisionRoles / maintainAdoptions).
 *
 * Owner: WC (review roles and provenance) – docs/bh2-ownership.json (formerly studio-b agent).
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { appendActivity, applyDraftResult, type DraftResultLike } from "../../../core/report-factory";
import { SYSTEM_ACTOR_NAME, type Actor } from "../../../core/actor";
import type { FixProposal } from "../../../core/fix-types";
import { actsAsApprover } from "../../../core/provenance";
import type { FormAnswerRow, FormDefinition, Report, ReportFlag, ReportTemplate, SectionDispositionKind, SignReceipt } from "../../../core/types";
import { canAcknowledge, validateReport } from "../../../core/validation";
import { flushStore, getStoreMode, getStoreSyncState, saveReport, saveReportDurable } from "../../store";
import {
  acceptNoteWords,
  acknowledgeFlag,
  addClinicianParagraph,
  adoptBox,
  confirmByApprover,
  editParagraph,
  enforceDecisionRoles,
  isClinicianGap,
  keepApproverEntries,
  maintainAdoptions,
  markApproved,
  markOwnWords,
  nameCliniciansInstead,
  overrideRecordValue,
  recordConsent,
  removeAbsenceSentences,
  removeParagraph,
  reopenGap,
  resolveGap,
  revertParagraph,
  setDisposition,
  setStructuredAnswer,
  settleConditionalGaps,
  settleGapsByAnswer,
  splitOutResidue,
  stampDecisions,
  supersedeAcknowledgedGaps,
  takeOverApprover,
  withPersonOrigins,
  writeInOwnVoice,
} from "./review-model";
import { applyFixProposal } from "./fixes";
import { setRowsAnswer } from "./table-answer-model";
import { acknowledgeGapLeavingBlank, leaveOptionalBoxesBlank } from "./box-items";

/**
 * What a person does on the review screen. Every action carries who did it (W0.6: required, so the compiler finds every
 * dispatch site; WC stamps it as `by`). The activity log names `actor.name`.
 */
export type PersonReviewAction = (
  | { type: "editParagraph"; key: string; paragraphId: string; text: string }
  | { type: "revertParagraph"; key: string; paragraphId: string }
  | { type: "addParagraph"; key: string; paragraphId?: string; text?: string }
  | { type: "removeParagraph"; key: string; paragraphId: string; silent?: boolean }
  | { type: "logEdit"; key: string }
  | { type: "setAnswer"; key: string; value: string | boolean | null }
  | { type: "setRows"; key: string; rows: FormAnswerRow[] }
  | { type: "resolveGap"; gapId: string; kind: "resolved" | "acknowledged"; text: string }
  | { type: "reopenGap"; gapId: string }
  | { type: "acknowledgeFlag"; flagId: string; reason: string }
  /** "Leave optional boxes blank": one acknowledgement per gap and warning, re-checked against the form (box-items.ts). */
  | { type: "leaveOptionalBlank"; keys: string[]; opinionKeys?: string[]; reason: string; template: ReportTemplate; form: FormDefinition | null }
  | { type: "recordConsent"; givenOn: string }
  | { type: "approved"; sent: Report; receipt: SignReceipt; flags: ReportFlag[]; isForm: boolean }
  | { type: "activity"; action: string; detail: string }
  | { type: "writeInOwnVoice"; authorName: string }
  /** "Name Tom Ellis instead" on OTHER_CLINICIAN_VOICE flags (fix round 1, B0-1). */
  | { type: "nameClinicians"; flags: ReportFlag[] }
  /** Change a value from the clinic's details for this report only (fix round 1, B0-4). */
  | { type: "overrideRecord"; key: string }
  | { type: "removeAbsence"; key: string }
  /** bh2 W0 follow-up (seam "apply-fix"): a one-click fix the engine offered (WD: fixes.ts applyFixProposal). */
  | { type: "applyFix"; proposal: FixProposal }
  /** WC design 5: the approver adopts what someone else entered in a clinician box (one audited click, never in bulk). */
  | { type: "adopt"; key: string }
  /** WC design 6: the approver's "These are my own words" on a paragraph (refused while drafted residue remains). */
  | { type: "markOwnWords"; key: string; paragraphId: string | null }
  /** WC design 6: move the drafted sentences kept in a paragraph into a drafted paragraph of their own. */
  | { type: "splitOutResidue"; key: string; paragraphId: string }
  /** WB design 5 / WC design 4: the approver's "Accept as the note's words" (one phrase, their own note). */
  | { type: "acceptNoteWords"; key: string; paragraphId: string | null; check?: string; phrase?: string; sentence?: string; noteId?: string; reason?: string }
  /** WC design 1: "Take over as approver". */
  | { type: "takeOverApprover" }
  /** WC design 4 / WA1: a person's decision about a box – not applicable (on), cleared (off). */
  | { type: "markNotApplicable"; key: string; on: boolean; reason?: string }
  | { type: "setDisposition"; key: string; kind: SectionDispositionKind | null; reason?: string }
) & { actor: Actor };

/**
 * What code does, with no person behind it: a newer stored copy replaces the working copy, the validators' flags, a
 * draft arriving, and a line in the activity log from the drafting step (SYSTEM_ACTOR_NAME, "System").
 */
export type SystemReviewAction =
  | { type: "replace"; report: Report }
  | { type: "setFlags"; flags: ReportFlag[] }
  | { type: "applyDraft"; result: DraftResultLike }
  | { type: "systemActivity"; action: string; detail: string };

export type ReviewAction = PersonReviewAction | SystemReviewAction;

function locked(report: Report): boolean {
  return report.status === "signed";
}

/** Person actions that write nothing a later decision depends on (no provenance step after them). */
const NO_PROVENANCE: ReadonlySet<string> = new Set(["activity", "approved", "recordConsent"]);
/**
 * The approver's decisions (WC designs 1, 4–6): each writes its own provenance – who decided, and what the text's
 * origin and author become – so the generic origin and stamp steps do not run after them.
 */
const DECISIONS: ReadonlySet<string> = new Set(["adopt", "markOwnWords", "splitOutResidue", "acceptNoteWords", "takeOverApprover", "markNotApplicable", "setDisposition"]);
/** Person actions whose answer settles its own box's gaps (fix round 1, B0-8). */
const SETTLING: ReadonlySet<string> = new Set(["editParagraph", "addParagraph", "removeParagraph", "setAnswer", "setRows"]);

const ackAllowed = (flag: ReportFlag, report: Report, actor: Actor) => canAcknowledge(flag, report, actor);

export function reviewReducer(report: Report, action: ReviewAction): Report {
  let next = applyReviewAction(report, action);
  if (next === report || locked(report)) return next;
  if (!("actor" in action)) {
    // Fix round 1 (B0-7): a conditional question that no longer applies (or applies again) after a draft.
    return action.type === "applyDraft" ? settleConditionalGaps(next, SYSTEM_ACTOR_NAME) : next;
  }
  if (NO_PROVENANCE.has(action.type)) return next;
  const actor = action.actor;
  const key = "key" in action && typeof action.key === "string" ? action.key : null;
  if (DECISIONS.has(action.type)) return confirmByApprover(report, maintainAdoptions(report, enforceDecisionRoles(report, next, actor, ackAllowed), actor), actor);
  // bh2 WC design 6: the origin of a person's text – only the approver's own new words are "clinician" – and
  // (design 2) who did what, stamped on every change.
  next = stampDecisions(report, withPersonOrigins(report, next, actor), actor);
  // Fix round 1 (B0-8): a person's answer settles its own box's gaps (and an answer removed reopens them) – a
  // clinician gap only when the answer is the approver's (WC design 4; it replaced the NEW-1 stop-gap).
  if (key && actor.name && SETTLING.has(action.type)) next = settleGapsByAnswer(report, next, key, actor.name, undefined, { by: actor });
  // Fix round 1 (B0-7): a conditional question that no longer applies (or applies again) after an answer.
  if (action.type === "setAnswer") next = settleConditionalGaps(next, actor.name || SYSTEM_ACTOR_NAME);
  // A decision this person may not take is undone, and so is a change that would take away what the approver
  // confirmed in a clinician box without leaving a proposal; the approver's adoption follows the box's content (stale
  // after anyone else's change), and the approver's own entry confirms the box.
  next = enforceDecisionRoles(report, next, actor, ackAllowed);
  next = keepApproverEntries(report, next, actor);
  next = maintainAdoptions(report, next, actor);
  next = confirmByApprover(report, next, actor);
  return next;
}

/**
 * Who may apply a one-click fix (WC design 4): an attribution fix, a voice fix, a note-words acceptance and a
 * one-click option tick are the approver's, and so is any fix whose proposal says so (FixProposal.ackPolicy
 * "approver"); a fix whose policy is "never" is applied by nobody. WD's generators name themselves in `generator`.
 */
const APPROVER_FIX_GENERATORS: ReadonlySet<string> = new Set(["name-clinician", "attribution", "own-voice", "voice", "note-words", "option-tick", "tick-suggested"]);

export function mayApplyFix(report: Report, proposal: FixProposal, actor: Actor): boolean {
  if (proposal.ackPolicy === "never") return false;
  if (proposal.ackPolicy === "approver" || APPROVER_FIX_GENERATORS.has(proposal.generator)) return actsAsApprover(actor, report);
  return true;
}

/** The approver's decision, else the report unchanged (WC design 4: the UI hides it; the reducer refuses it too). */
function approverOnly(report: Report, actor: Actor, decide: () => Report): Report {
  return actsAsApprover(actor, report) ? decide() : report;
}

function applyReviewAction(report: Report, action: ReviewAction): Report {
  if (action.type === "replace") return action.report;
  if (action.type === "activity") return appendActivity(report, { action: action.action, detail: action.detail, actor: action.actor.name });
  if (action.type === "systemActivity") return appendActivity(report, { action: action.action, detail: action.detail, actor: SYSTEM_ACTOR_NAME });
  if (action.type === "approved") return markApproved(action.sent, action.receipt, action.flags, { isForm: action.isForm });
  // Everything below changes content: a signed report is read-only.
  if (locked(report)) return report;
  switch (action.type) {
    case "writeInOwnVoice":
      // The approver's own voice (WC design 4: a voice fix is the approver's).
      return approverOnly(report, action.actor, () => writeInOwnVoice(report, action.authorName, action.actor.name));
    case "nameClinicians":
      // An attribution fix (WC design 4): the approver's.
      return approverOnly(report, action.actor, () => nameCliniciansInstead(report, action.flags, action.actor.name));
    case "overrideRecord":
      return overrideRecordValue(report, action.key, action.actor.name);
    case "removeAbsence":
      return approverOnly(report, action.actor, () => removeAbsenceSentences(report, action.key, action.actor.name));
    case "applyFix":
      return mayApplyFix(report, action.proposal, action.actor) ? applyFixProposal(report, action.proposal, action.actor) : report;
    case "editParagraph":
      return editParagraph(report, action.key, action.paragraphId, action.text);
    case "revertParagraph":
      return revertParagraph(report, action.key, action.paragraphId);
    case "addParagraph": {
      // The origin is the reducer's (withPersonOrigins): the approver's own words, else checked like edited text.
      const next = addClinicianParagraph(report, action.key, action.text ?? "");
      // A value typed straight into an empty answer supersedes a "left blank" acknowledgement of its gap.
      return action.actor.name && (action.text ?? "").trim() ? supersedeAcknowledgedGaps(next.report, action.key, action.actor.name, undefined, { by: action.actor }) : next.report;
    }
    case "removeParagraph": {
      const section = report.sections.find((s) => s.key === action.key);
      const next = removeParagraph(report, action.key, action.paragraphId, undefined, { by: action.actor });
      if (next === report || action.silent) return next;
      return appendActivity(next, { actor: action.actor.name, action: "edited", detail: `${action.key}: removed a paragraph from “${section?.title ?? action.key}”.` });
    }
    case "logEdit": {
      const section = report.sections.find((s) => s.key === action.key);
      const logged = appendActivity(report, { actor: action.actor.name, action: "edited", detail: `${action.key}: edited the answer to “${section?.title ?? action.key}”.` });
      return supersedeAcknowledgedGaps(logged, action.key, action.actor.name, undefined, { by: action.actor });
    }
    case "setAnswer":
      return supersedeAcknowledgedGaps(setStructuredAnswer(report, action.key, action.value, action.actor), action.key, action.actor.name, undefined, { by: action.actor });
    case "setRows":
      return setRowsAnswer(report, action.key, action.rows, action.actor.name);
    case "resolveGap": {
      const gap = report.gaps.find((g) => g.id === action.gapId);
      // WC design 4: a clinician gap is resolved or acknowledged by the approver only.
      if (!gap || (isClinicianGap(report, gap) && !actsAsApprover(action.actor, report))) return report;
      // An optional box's gap acknowledged = left blank: its "no answer" warning is acknowledged with it.
      return action.kind === "acknowledged"
        ? acknowledgeGapLeavingBlank(report, action.gapId, action.text, action.actor.name)
        : resolveGap(report, action.gapId, action.kind, action.text, action.actor.name, undefined, { by: action.actor });
    }
    case "reopenGap":
      return reopenGap(report, action.gapId, action.actor.name);
    case "acknowledgeFlag": {
      const flag = report.flags.find((f) => f.id === action.flagId);
      if (!flag || !canAcknowledge(flag, report, action.actor)) return report;
      // WC design 5: the approver's "acknowledgement" of a proposal is adopting it – one audited click.
      if (flag.code === "APPROVER_DECISION") return flag.sectionKey ? adoptBox(report, flag.sectionKey, action.actor) : report;
      return acknowledgeFlag(report, action.flagId, action.reason, action.actor.name, undefined, { by: action.actor });
    }
    case "leaveOptionalBlank":
      return leaveOptionalBoxesBlank(report, { template: action.template, form: action.form, keys: action.keys, opinionKeys: action.opinionKeys, reason: action.reason, actor: action.actor.name, by: action.actor });
    case "recordConsent":
      return recordConsent(report, action.givenOn, action.actor.name);
    case "adopt":
      return adoptBox(report, action.key, action.actor);
    case "markOwnWords":
      return action.paragraphId ? markOwnWords(report, action.key, action.paragraphId, action.actor) : report;
    case "splitOutResidue":
      return splitOutResidue(report, action.key, action.paragraphId, action.actor);
    case "acceptNoteWords": {
      if (!action.paragraphId) return report;
      const input = action.phrase && action.sentence ? { check: action.check ?? "OPINION_LANGUAGE", phrase: action.phrase, sentence: action.sentence, noteId: action.noteId, reason: action.reason } : null;
      return acceptNoteWords(report, action.key, action.paragraphId, action.actor, input);
    }
    case "takeOverApprover":
      return takeOverApprover(report, action.actor);
    case "markNotApplicable":
      return setDisposition(report, action.key, action.on ? "not_applicable" : null, action.actor, { reason: action.reason });
    case "setDisposition":
      return setDisposition(report, action.key, action.kind, action.actor, { reason: action.reason });
    case "setFlags":
      return { ...report, flags: action.flags };
    case "applyDraft":
      return applyDraftResult(report, action.result);
  }
}

/** What the validators look at (sections, gaps, acknowledgements) – flags themselves are their output. */
function validationKey(report: Report): string {
  const acks = report.flags
    .filter((f) => f.acknowledged)
    .map((f) => f.id)
    .sort()
    .join("|");
  // The record's consent too (fix wave 3: recorded on the review screen for uploaded notes).
  return JSON.stringify([report.sections, report.gaps, acks, report.bundleSnapshot.consent]);
}

function sameFlags(a: readonly ReportFlag[], b: readonly ReportFlag[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export type SaveState = "saved" | "saving" | "failed";

export interface ReviewState {
  report: Report;
  dispatch: (action: ReviewAction) => void;
  /** True while an edit is waiting for the validators. */
  validating: boolean;
  saveState: SaveState;
  savedAt: string | null;
  /** Run the validators now and return the report with fresh flags (used before approval). */
  validateNow(): Report;
  /** Save now. */
  flush(): void;
  /** Replace the working copy and save it immediately (e.g. the approved report). Returns false if storage failed. */
  commit(next: Report): boolean;
}

const VALIDATE_DELAY_MS = 350;
const SAVE_DELAY_MS = 300;

/**
 * @param initial  the stored report when the screen opened
 * @param stored   the latest stored copy (useReport); a newer one replaces the working copy
 * @param template the report's template (null when the form map is missing: validation is skipped)
 * @param form     the referrer's form map of a form report (its mail-merge fields are checked, 10/2026)
 * (W0.6: who is acting travels on each action – ReviewAction.actor – not here.)
 */
export function useReviewState(
  initial: Report,
  stored: Report | null,
  template: ReportTemplate | null,
  form: FormDefinition | null = null,
): ReviewState {
  const [report, rawDispatch] = useReducer(reviewReducer, initial);
  const [validating, setValidating] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [savedAt, setSavedAt] = useState<string | null>(initial.updatedAt);
  const reportRef = useRef(report);
  reportRef.current = report;
  const lastSaved = useRef<Report>(initial);
  const templateRef = useRef(template);
  templateRef.current = template;
  const formRef = useRef(form);
  formRef.current = form;

  // Fix wave 2: in a clinic's Studio, only a change someone made is saved – opening a report (and the validators
  // refreshing its flags) never stores a new revision, an audit row "Report saved" or a reset retention clock.
  const changedByUser = useRef(false);
  const dispatch = useCallback((action: ReviewAction) => {
    if (action.type !== "setFlags" && action.type !== "replace") changedByUser.current = true;
    rawDispatch(action);
  }, []);

  // A newer copy saved elsewhere (another tab, background drafting) replaces the working copy.
  useEffect(() => {
    if (!stored || stored === lastSaved.current) return;
    if (stored.updatedAt > reportRef.current.updatedAt) {
      lastSaved.current = stored;
      rawDispatch({ type: "replace", report: stored });
    }
  }, [stored]);

  // Debounced save.
  const save = useCallback(() => {
    const current = reportRef.current;
    if (current === lastSaved.current) return;
    if (getStoreMode() === "server") {
      if (!changedByUser.current) {
        // Only refreshed flags since the report was opened: nothing to store (they are recomputed on every open).
        lastSaved.current = current;
        setSaveState("saved");
        return;
      }
      // A clinic's Studio: the save is queued at once; the indicator follows the server's answer.
      lastSaved.current = current;
      setSaveState("saving");
      void saveReportDurable(current).then((ok) => {
        if (lastSaved.current !== current) return; // a newer save reports for itself
        setSaveState(ok ? "saved" : "failed");
        if (ok) setSavedAt(current.updatedAt);
      });
      return;
    }
    const ok = saveReport(current);
    if (ok) {
      lastSaved.current = current;
      setSaveState("saved");
      setSavedAt(current.updatedAt);
    } else {
      setSaveState("failed");
    }
  }, []);

  useEffect(() => {
    if (report === lastSaved.current) return;
    setSaveState("saving");
    const t = window.setTimeout(save, SAVE_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [report, save]);

  // Save on leaving the page or the screen.
  useEffect(() => {
    const onHide = () => {
      save();
      // A clinic's Studio: send what is still waiting now, with keepalive (the page may be closing).
      void flushStore({ keepalive: true });
    };
    // A clinic's Studio: ask before closing the tab while changes are still on their way to the server.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (getStoreMode() !== "server") return;
      save();
      if (getStoreSyncState().pending > 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("pagehide", onHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      save();
    };
  }, [save]);

  // Debounced validation; runs on content changes only (flags are its output).
  const firstValidation = useRef(true);
  const key = validationKey(report);
  const runValidation = useCallback((): Report => {
    const current = reportRef.current;
    const tpl = templateRef.current;
    if (!tpl || current.status === "signed") return current;
    try {
      const result = validateReport(current, tpl, { form: formRef.current });
      if (!sameFlags(result.flags, current.flags)) {
        rawDispatch({ type: "setFlags", flags: result.flags });
        return { ...current, flags: result.flags };
      }
    } catch {
      // The validators never throw by contract; keep the last flags if they do.
    }
    return current;
  }, []);

  useEffect(() => {
    if (!template || report.status === "signed") {
      setValidating(false);
      return;
    }
    setValidating(true);
    // The first check runs at once (the stored flags may predate edits made elsewhere).
    const delay = firstValidation.current ? 0 : VALIDATE_DELAY_MS;
    firstValidation.current = false;
    const t = window.setTimeout(() => {
      runValidation();
      setValidating(false);
    }, delay);
    return () => window.clearTimeout(t);
    // `key` captures the content the validators read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, template, runValidation]);

  const commit = useCallback((next: Report): boolean => {
    const ok = saveReport(next);
    if (ok) {
      lastSaved.current = next;
      setSaveState("saved");
      setSavedAt(next.updatedAt);
    } else {
      setSaveState("failed");
    }
    reportRef.current = next;
    rawDispatch({ type: "replace", report: next });
    return ok;
  }, []);

  return { report, dispatch, validating, saveState, savedAt, validateNow: runValidation, flush: save, commit };
}
