/**
 * Review workspace model (pure, no React): how the review screen groups and labels questions, derives
 * each question's status, summarises how the report was drafted, and applies the clinician's edits.
 *
 * Every edit is immutable and bumps `updatedAt`. The validators (core/validation) re-run on the result
 * in the screen; nothing here decides whether a report can be approved.
 *
 * W0.4 module split (bh2): this file only re-exports, so every existing import keeps working. The code lives in
 *   status.ts      questions, groups and each question's status   (owner WA1)
 *   labels.ts      generation badge, origin and citation labels, answer options, blocking lines   (WC)
 *   reducer.ts     the edits (paragraphs, structured answers, consent, approval, amendments)   (WC)
 *   provenance.ts  who answered a question   (WC)
 *   gaps.ts        gaps and acknowledgements   (WC)
 *   fixes.ts       one-click fixes (own voice, name the clinician, "not recorded" sentences)   (WD)
 * Owners per docs/bh2-ownership.json; this barrel is the integrator's. New code imports from the file itself.
 */
export type { QuestionStatus, ReviewGroup, ReviewQuestion, StatusCounts } from "./status";
export {
  QUESTION_STATUS_META,
  QUESTION_STATUS_ORDER,
  buildQuestionGroups,
  countStatuses,
  flattenQuestions,
  groupBySection,
  isOpenBlocking,
  questionStatus,
} from "./status";
export type { AnswerOption, GenerationSummary, SourceKind } from "./labels";
export {
  ORIGIN_PILL_CLASSES,
  answerOptions,
  answerText,
  blockingLines,
  citationAriaLabel,
  citationLabel,
  citationsBySource,
  filedEntries,
  generationSummary,
  originLabel,
  sourceKind,
  staffApprovalNote,
  wordFormPdfNote,
} from "./labels";
export {
  addClinicianParagraph,
  canRecordConsent,
  createAmendedVersion,
  editParagraph,
  markApproved,
  nextClinicianParagraphId,
  overrideRecordValue,
  recordConsent,
  removeParagraph,
  revertParagraph,
  setStructuredAnswer,
} from "./reducer";
export { answerChangedByClinician, answeredByPerson } from "./provenance";
export type { GapResolutionOptions } from "./gaps";
export {
  MIN_GAP_REASON,
  acknowledgeFlag,
  gapResolutionOptions,
  isClinicianGap,
  reopenGap,
  requiredAnswerFirst,
  resolutionOptionsFor,
  resolveGap,
  settleConditionalGaps,
  settleGapsByAnswer,
  supersedeAcknowledgedGaps,
} from "./gaps";
export {
  nameClinicianFix,
  nameCliniciansInstead,
  notRecordedSentences,
  ownVoiceCandidates,
  removeAbsenceSentences,
  supersededAbsenceSentences,
  writeInOwnVoice,
} from "./fixes";
