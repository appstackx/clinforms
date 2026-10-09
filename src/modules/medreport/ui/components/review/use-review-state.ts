"use client";

/**
 * Working copy of one report on the review screen: a reducer over the pure edits in review-model.ts,
 * debounced validation (the same core/validation code the server runs at /validate, /sign and /render;
 * flags are persisted on the report), debounced saving to this browser, and pick-up of newer copies
 * saved elsewhere (another tab, or drafting that finishes after navigation).
 *
 * Owner: studio-b agent.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { appendActivity, applyDraftResult, type DraftResultLike } from "../../../core/report-factory";
import type { FormAnswerRow, Report, ReportFlag, ReportTemplate, SignReceipt } from "../../../core/types";
import { validateReport } from "../../../core/validation";
import { saveReport } from "../../store";
import {
  acknowledgeFlag,
  addClinicianParagraph,
  editParagraph,
  markApproved,
  removeAbsenceSentences,
  removeParagraph,
  reopenGap,
  resolveGap,
  revertParagraph,
  setStructuredAnswer,
  writeInOwnVoice,
} from "./review-model";
import { setRowsAnswer } from "./table-answer-model";

export type ReviewAction =
  | { type: "replace"; report: Report }
  | { type: "editParagraph"; key: string; paragraphId: string; text: string }
  | { type: "revertParagraph"; key: string; paragraphId: string }
  | { type: "addParagraph"; key: string; paragraphId?: string; text?: string }
  | { type: "removeParagraph"; key: string; paragraphId: string; actor: string; silent?: boolean }
  | { type: "logEdit"; key: string; actor: string }
  | { type: "setAnswer"; key: string; value: string | boolean | null; actor: string }
  | { type: "setRows"; key: string; rows: FormAnswerRow[]; actor: string }
  | { type: "resolveGap"; gapId: string; kind: "resolved" | "acknowledged"; text: string; actor: string }
  | { type: "reopenGap"; gapId: string; actor: string }
  | { type: "acknowledgeFlag"; flagId: string; reason: string; actor: string }
  | { type: "setFlags"; flags: ReportFlag[] }
  | { type: "applyDraft"; result: DraftResultLike }
  | { type: "approved"; sent: Report; receipt: SignReceipt; flags: ReportFlag[]; isForm: boolean }
  | { type: "activity"; action: string; detail: string; actor: string }
  | { type: "writeInOwnVoice"; authorName: string; actor: string }
  | { type: "removeAbsence"; key: string; actor: string };

function locked(report: Report): boolean {
  return report.status === "signed";
}

export function reviewReducer(report: Report, action: ReviewAction): Report {
  if (action.type === "replace") return action.report;
  if (action.type === "activity") return appendActivity(report, { action: action.action, detail: action.detail, actor: action.actor });
  if (action.type === "approved") return markApproved(action.sent, action.receipt, action.flags, { isForm: action.isForm });
  // Everything below changes content: a signed report is read-only.
  if (locked(report)) return report;
  switch (action.type) {
    case "writeInOwnVoice":
      return writeInOwnVoice(report, action.authorName, action.actor);
    case "removeAbsence":
      return removeAbsenceSentences(report, action.key, action.actor);
    case "editParagraph":
      return editParagraph(report, action.key, action.paragraphId, action.text);
    case "revertParagraph":
      return revertParagraph(report, action.key, action.paragraphId);
    case "addParagraph": {
      const next = addClinicianParagraph(report, action.key, action.text ?? "");
      return next.report;
    }
    case "removeParagraph": {
      const section = report.sections.find((s) => s.key === action.key);
      const next = removeParagraph(report, action.key, action.paragraphId);
      if (next === report || action.silent) return next;
      return appendActivity(next, { actor: action.actor, action: "edited", detail: `${action.key}: removed a paragraph from “${section?.title ?? action.key}”.` });
    }
    case "logEdit": {
      const section = report.sections.find((s) => s.key === action.key);
      return appendActivity(report, { actor: action.actor, action: "edited", detail: `${action.key}: edited the answer to “${section?.title ?? action.key}”.` });
    }
    case "setAnswer":
      return setStructuredAnswer(report, action.key, action.value, action.actor);
    case "setRows":
      return setRowsAnswer(report, action.key, action.rows, action.actor);
    case "resolveGap":
      return resolveGap(report, action.gapId, action.kind, action.text, action.actor);
    case "reopenGap":
      return reopenGap(report, action.gapId, action.actor);
    case "acknowledgeFlag":
      return acknowledgeFlag(report, action.flagId, action.reason, action.actor);
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
  return JSON.stringify([report.sections, report.gaps, acks]);
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
 */
export function useReviewState(initial: Report, stored: Report | null, template: ReportTemplate | null): ReviewState {
  const [report, rawDispatch] = useReducer(reviewReducer, initial);
  const [validating, setValidating] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [savedAt, setSavedAt] = useState<string | null>(initial.updatedAt);
  const reportRef = useRef(report);
  reportRef.current = report;
  const lastSaved = useRef<Report>(initial);
  const templateRef = useRef(template);
  templateRef.current = template;

  const dispatch = useCallback((action: ReviewAction) => rawDispatch(action), []);

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
    const onHide = () => save();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
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
      const result = validateReport(current, tpl);
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
