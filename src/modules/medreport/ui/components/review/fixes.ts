/**
 * Review workspace model – one-click fixes (bh2 WD design 6, invariant I8): the one-click engine, plus "Write in my own
 * voice", "Name <clinician> instead" and removing the draft's superseded "not recorded" sentences.
 *
 * The engine: offeredFixes(report, {actor, form, template}) lists every one-click fix it offers, each a FixProposal
 * (core/fix-types.ts: the paragraph's text before and after, the spans it removes, the generator that made it). Every
 * proposal has passed planFix() – the engine's rules, checked on a copy before anything is offered:
 *   - removals take whole sentences only (the shared tokenizer, core/text/sentences.ts – never a split inside "8.0");
 *   - the figures and dates after = before minus the removed spans (plus the date of a note the paragraph cites, which
 *     an attribution fix may add);
 *   - no sentence the edit creates starts in lower case, with a digit or with a comma (a compact value – "7/10 at worst",
 *     "lighter work" – is a value, not a sentence);
 *   - no "He/She recorded …" loses the sentence that said who recorded it (B3-5);
 *   - the repeated twin still prints, and the box's answer is never removed (the box keeps text);
 *   - a clinical negative ("No red flags were reported.") is never removed;
 *   - re-validation adds no blocking flag and clears none but the one the fix answers – a wording fix never makes
 *     unsafe text approvable;
 *   - the paragraph's other warnings stay: the fixed paragraph keeps origin "ai" and records the fix in
 *     Paragraph.fixes {kind, by, at, edits}, so every drafted-text check keeps running on it.
 * Every proposal is shown with its before and after (fix-preview.tsx) and can be undone (undoProposal()).
 *
 * Generators: "repeat-removal" (the sentences another box already says, draft-fit/repeats.ts), "duplicate-paragraph"
 * (an exact second copy in the same box), "value-only" (a compact value from the voice owner's own note,
 * draft-fit/shorten.ts), "dose-not-stated" (B3-12, draft-fit/measure.ts), "printed-lead" (the verb the form already
 * prints, draft-fit/printed-lead.ts), and WB's attribution, quotation and commentary fixes
 * (core/validation/attribution-fixes.ts ATTRIBUTION_FIX_GENERATORS), each checked by the same rules.
 *
 * Pure, no React. Split out of review-model.ts by W0.4 (bh2 module split, pure move; review-model.ts re-exports it).
 * Owner: WD (drafting and text edits; the one-click engine) – docs/bh2-ownership.json. WB's fix generators reach the
 * review through here.
 */
import { inOwnClinicalWording, isOwnVoiceCandidate, nameClinicianInstead, otherCliniciansInFirstPerson } from "../../../core/voice";
import { appendActivity } from "../../../core/report-factory";
import type { Actor } from "../../../core/actor";
import type { FixProposal, TextSpan as FixSpan } from "../../../core/fix-types";
import { compactPlace, printedLeadOf } from "../../../core/forms/answer-shape";
import { checkSafeEdit, figureChanges, removeSentences, sentenceKey, splitSentences, type TextSpan } from "../../../core/text/sentences";
import type { Clinician, FormDefinition, Paragraph, Report, ReportFlag, ReportSection, ReportTemplate } from "../../../core/types";
import { validateReport } from "../../../core/validation";
import { ATTRIBUTION_FIX_GENERATORS } from "../../../core/validation/attribution-fixes";
import { undosedMedicine } from "../../../core/validation/draft-fit/measure";
import { withoutPrintedVerb } from "../../../core/validation/draft-fit/printed-lead";
import { REPEAT_REMOVAL_HOOK, duplicateParagraphs, repeatedSentences } from "../../../core/validation/draft-fit/repeats";
import { VALUE_ONLY_HOOK, citesOnlyOwnersNotes, valueOnlyText } from "../../../core/validation/draft-fit/shorten";
import { hookEnabled } from "../../../core/validation/hooks";
import { editParagraph, removeParagraph } from "./reducer";

/* ------------------------------------------------------------------------------------------------
 * The one-click engine
 * ----------------------------------------------------------------------------------------------*/

/** What a generator proposes for one paragraph, before the engine checks it. */
export interface FixCandidate {
  generator: string;
  label: string;
  sectionKey: string;
  paragraphId: string;
  before: string;
  after: string;
  /** Whole sentences the fix takes out (a removal); empty for a rewrite. */
  removedSpans: TextSpan[];
  /** The flags the fix answers (their blocking flag may go). */
  answers: ReportFlag[];
  ackPolicy?: FixProposal["ackPolicy"];
}

export interface FixContext {
  form: Pick<FormDefinition, "fields" | "analysis"> | null;
  template: ReportTemplate;
}

/** The approver (or the author) as the voice owner of a report. */
function voiceOwnerOfReport(report: Pick<Report, "approver" | "author">): Clinician | null {
  if (report.approver?.name) return { name: report.approver.name, hcpc: report.approver.hcpc };
  return report.author ?? null;
}

function validationOf(report: Report, ctx: FixContext): ReportFlag[] {
  const owner = voiceOwnerOfReport(report);
  return validateReport(report, ctx.template, { form: ctx.form, ...(report.approver ? { voice: { owner } } : {}) }).blocking;
}

function boxText(report: Pick<Report, "sections">, key: string): string {
  return (report.sections.find((s) => s.key === key)?.paragraphs ?? []).map((p) => p.text).join(" ").trim();
}

/** A sentence of clinical content that says something was absent or negative ("No red flags were reported."). */
const CLINICAL_NEGATIVE = /\b(?:no|not|nil|none|never|without|denie[sd]|negative|absent|unremarkable)\b/i;
/** "He recorded …", "She noted …": a sentence whose subject is the clinician named before it. */
const RECORDER_PRONOUN = /^(?:He|She|They)\s+(?:also\s+|then\s+|later\s+)?(?:recorded|noted|found|assessed|measured|observed|examined|documented)\b/;

const QUESTION_STOPWORDS = new Set("a an the and or of to in on at for with by from is are was were be been if yes no please give state describe details detail any other what which when how does do did has have had this that these those there their his her its patient claimant".split(" "));

/** The words of a question that say what it asks ("If yes, describe the treatment advised" → treatment, advised). */
function questionWords(question: string): string[] {
  return (question.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length > 2 && !QUESTION_STOPWORDS.has(w));
}

/** Whether a sentence uses a word of the question (compared on their first five letters: "advised" ~ "advise"). */
function answersQuestion(sentence: string, question: string): boolean {
  const stems = new Set(questionWords(question).map((w) => w.slice(0, 5)));
  if (stems.size === 0) return false;
  return (sentence.toLowerCase().match(/[a-z]+/g) ?? []).some((w) => w.length > 2 && stems.has(w.slice(0, 5)));
}

/** The text with one paragraph's text replaced (or the paragraph removed when `text` is ""). */
function withParagraphText(report: Report, key: string, paragraphId: string, text: string): Report {
  return {
    ...report,
    sections: report.sections.map((s) =>
      s.key !== key ? s : { ...s, paragraphs: text === "" ? s.paragraphs.filter((p) => p.id !== paragraphId) : s.paragraphs.map((p) => (p.id === paragraphId ? { ...p, text } : p)) },
    ),
  };
}

const blockKey = (f: ReportFlag) => `${f.code}|${f.sectionKey ?? ""}`;

function countBy(flags: readonly ReportFlag[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const f of flags) if (f.code !== "OPEN_GAP") m.set(blockKey(f), (m.get(blockKey(f)) ?? 0) + 1);
  return m;
}

/**
 * The engine's rules for one candidate (see the header). Returns the problems found – empty when the fix may be
 * offered. `blockingBefore` is the report's blocking flags now (computed once by the caller).
 */
export function fixRuleProblems(report: Report, c: FixCandidate, ctx: FixContext, blockingBefore: readonly ReportFlag[]): string[] {
  const problems: string[] = [];
  const section = report.sections.find((s) => s.key === c.sectionKey);
  const paragraph = section?.paragraphs.find((p) => p.id === c.paragraphId);
  if (!section || !paragraph || paragraph.text !== c.before) return ["the paragraph has changed"];
  const field = ctx.form?.fields.find((f) => f.id === (section.fieldId ?? section.key));
  const compact = compactPlace(field) !== null || (field ? printedLeadOf(field, ctx.form) !== null : false);

  // Text: whole sentences, figures, starts, orphaned "He recorded".
  const noteDates = paragraph.sourceIds.map((id) => report.bundleSnapshot.notes.find((n) => n.id === id)?.date).filter((d): d is string => Boolean(d));
  const citedDates = noteDates.map((d) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`);
  for (const p of checkSafeEdit({ before: c.before, after: c.after, removedSpans: c.removedSpans })) {
    if (p.kind === "partial_sentence") problems.push("it would take out part of a sentence");
    else if (p.kind === "figures_changed") {
      const gained = p.gained.filter((g) => !citedDates.includes(g));
      if (p.lost.length || gained.length) problems.push(`it would change a figure or date (${[...p.lost, ...gained].join(", ")})`);
    } else if (p.kind === "bad_start") {
      // A compact value is a value, not a sentence: it may start with a figure or in lower case.
      const first = splitSentences(c.after, "notes")[0]?.text === p.sentence;
      if (!(compact && first && (p.problem === "digit" || p.problem === "lower_case"))) problems.push(`a sentence would start badly (“${p.sentence.slice(0, 30)}”)`);
    } else if (p.kind === "orphaned_pronoun" && RECORDER_PRONOUN.test(p.sentence.trim())) problems.push(`“${p.sentence.slice(0, 30)}…” would lose who recorded it`);
  }
  if (c.removedSpans.length === 0 && c.after !== "" && c.before !== c.after) {
    // A rewrite keeps every figure (bar the cited note's own date it may add) – checked above with no removed spans.
    const { lost } = figureChanges(c.before, c.after);
    if (lost.length && !problems.some((x) => x.startsWith("it would change"))) problems.push(`it would drop a figure (${lost.join(", ")})`);
  }
  // Clinical negatives are never removed.
  const kept = splitSentences(c.after).map((s) => s.text);
  for (const s of splitSentences(c.before)) {
    if (CLINICAL_NEGATIVE.test(s.text) && !kept.some((k) => k.includes(s.text.replace(/[.\s]+$/, "")))) {
      if (c.removedSpans.some((r) => r.text.includes(s.text)) || c.after === "") problems.push(`it would remove a clinical negative (“${s.text.slice(0, 30)}…”)`);
    }
  }
  // The box keeps its answer: never left empty, and never without the only sentence that answers its question (B3-5 c).
  const next = withParagraphText(report, c.sectionKey, c.paragraphId, c.after);
  if (!boxText(next, c.sectionKey)) problems.push("it would remove the box's only answer");
  else if (c.removedSpans.length > 0) {
    const question = section.title || field?.label || "";
    const answering = (t: string) => answersQuestion(t, question);
    const removedAnswering = c.removedSpans.some((r) => answering(r.text));
    const stillAnswering = splitSentences(boxText(next, c.sectionKey)).some((x) => answering(x.text));
    if (removedAnswering && !stillAnswering) problems.push("it would remove the only sentence that answers the question");
  }
  // The repeated twin still prints (a removal of a repeat leaves the earlier box untouched – checked for safety).
  // Re-validation: no blocking flag added, none cleared but the ones the fix answers.
  const after = validationOf({ ...next, flags: [] }, ctx);
  const was = countBy(blockingBefore);
  const now = countBy(after);
  const answered = countBy(c.answers.filter((f) => f.severity === "blocking"));
  now.forEach((n, k) => {
    if (n > (was.get(k) ?? 0)) problems.push(`re-validation adds a blocking ${k.split("|")[0]}`);
  });
  was.forEach((n, k) => {
    if ((now.get(k) ?? 0) < n - (answered.get(k) ?? 0)) problems.push(`it would clear a blocking ${k.split("|")[0]} it does not answer`);
  });
  return problems;
}

/**
 * The engine's check of one candidate: the proposal to offer, or null when any rule fails (WD design 6 – planFix).
 */
export function planFix(report: Report, c: FixCandidate, ctx: FixContext, blockingBefore?: readonly ReportFlag[]): FixProposal | null {
  const before = blockingBefore ?? validationOf({ ...report, flags: [] }, ctx);
  if (fixRuleProblems(report, c, ctx, before).length > 0) return null;
  const flagId = c.answers[0]?.id;
  return {
    generator: c.generator,
    ...(flagId ? { flagId } : {}),
    sectionKey: c.sectionKey,
    paragraphId: c.paragraphId,
    label: c.label,
    before: c.before,
    after: c.after,
    removedSpans: c.removedSpans.map((r): FixSpan => ({ start: r.start, end: r.end })),
    ...(c.ackPolicy ? { ackPolicy: c.ackPolicy } : {}),
  };
}

function paragraphOf(report: Report, key: string | undefined, paragraphId: string | undefined): { section: ReportSection; paragraph: Paragraph } | null {
  const section = report.sections.find((s) => s.key === key);
  const paragraph = section?.paragraphs.find((p) => p.id === paragraphId);
  return section && paragraph ? { section, paragraph } : null;
}

const open = (report: Report) => report.flags.filter((f) => !f.acknowledged && f.code === "DRAFT_FIT");

/** "Remove the repeated sentence": every sentence of the paragraph another box already says, in one action (B3-5 b). */
function repeatCandidates(report: Report, ctx: FixContext): FixCandidate[] {
  if (!hookEnabled(REPEAT_REMOVAL_HOOK)) return [];
  const flags = open(report).filter((f) => (f.evidence ?? "").startsWith("repeat ") && f.severity === "warning");
  if (flags.length === 0) return [];
  const repeats = repeatedSentences(report, ctx.form);
  const out: FixCandidate[] = [];
  for (const flag of flags) {
    const at = paragraphOf(report, flag.sectionKey, flag.paragraphId);
    if (!at) continue;
    const spans = repeats.filter((r) => r.paragraphId === at.paragraph.id).map((r) => r.sentence);
    if (spans.length === 0) continue;
    const { after, removedSpans } = removeSentences(at.paragraph.text, spans.map((s) => s.index));
    out.push({
      generator: "repeat-removal",
      label: spans.length === 1 ? "Remove the repeated sentence" : `Remove the ${spans.length} repeated sentences`,
      sectionKey: at.section.key,
      paragraphId: at.paragraph.id,
      before: at.paragraph.text,
      after,
      removedSpans,
      answers: [flag],
      ackPolicy: "member",
    });
  }
  return out;
}

/** "Remove the second copy": an exact duplicate paragraph of the same box. */
function duplicateCandidates(report: Report): FixCandidate[] {
  const flags = open(report).filter((f) => (f.evidence ?? "").startsWith("duplicate "));
  const dups = duplicateParagraphs(report.sections);
  const out: FixCandidate[] = [];
  for (const flag of flags) {
    const at = paragraphOf(report, flag.sectionKey, flag.paragraphId);
    if (!at || !dups.some((d) => d.paragraphId === at.paragraph.id)) continue;
    const whole = splitSentences(at.paragraph.text).map((s) => ({ start: s.start, end: s.end, text: s.text }));
    out.push({ generator: "duplicate-paragraph", label: "Remove the second copy", sectionKey: at.section.key, paragraphId: at.paragraph.id, before: at.paragraph.text, after: "", removedSpans: whole, answers: [flag], ackPolicy: "member" });
  }
  return out;
}

/** "Use the value only" (B2-16): a compact value from the voice owner's own note, without its undated attribution. */
function valueOnlyCandidates(report: Report, ctx: FixContext): FixCandidate[] {
  if (!hookEnabled(VALUE_ONLY_HOOK)) return [];
  const owner = voiceOwnerOfReport(report);
  const out: FixCandidate[] = [];
  for (const flag of open(report).filter((f) => f.evidence === "shorten")) {
    const at = paragraphOf(report, flag.sectionKey, flag.paragraphId);
    if (!at || at.section.paragraphs[0] !== at.paragraph) continue;
    const field = ctx.form?.fields.find((f) => f.id === (at.section.fieldId ?? at.section.key));
    if (!field || compactPlace(field) === null || field.fillSource.kind !== "notes_narrative") continue;
    // C-REV-1: a colleague's finding keeps their name – only the owner's own notes.
    if (!citesOnlyOwnersNotes(at.paragraph, report.bundleSnapshot, owner)) continue;
    const value = valueOnlyText(at.paragraph.text);
    if (!value) continue;
    out.push({
      generator: "value-only",
      label: `Use the value only (${value.length > 40 ? `${value.slice(0, 37)}…` : value})`,
      sectionKey: at.section.key,
      paragraphId: at.paragraph.id,
      before: at.paragraph.text,
      after: value,
      removedSpans: [],
      answers: [flag],
      ackPolicy: "member",
    });
  }
  return out;
}

/** "(dose not stated)" (B3-12): a medicine named without a dose no cited note gives. */
function doseCandidates(report: Report): FixCandidate[] {
  const out: FixCandidate[] = [];
  for (const flag of open(report).filter((f) => (f.evidence ?? "").startsWith("dose "))) {
    const at = paragraphOf(report, flag.sectionKey, flag.paragraphId);
    if (!at) continue;
    const cited = at.paragraph.sourceIds.map((id) => report.bundleSnapshot.notes.find((n) => n.id === id)).filter(Boolean);
    const citedText = cited.map((n) => [n!.subjective, n!.objective, n!.assessment, n!.plan, n!.freeText ?? ""].join("\n")).join("\n");
    const medicine = undosedMedicine(at.paragraph.text, citedText);
    if (!medicine) continue;
    const re = new RegExp(`\\b${medicine.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b(?!\\s*\\(dose)`);
    const m = re.exec(at.paragraph.text);
    if (!m) continue;
    const end = m.index + m[0].length;
    const after = `${at.paragraph.text.slice(0, end)} (dose not stated)${at.paragraph.text.slice(end)}`;
    out.push({ generator: "dose-not-stated", label: "Add “(dose not stated)”", sectionKey: at.section.key, paragraphId: at.paragraph.id, before: at.paragraph.text, after, removedSpans: [], answers: [flag], ackPolicy: "member" });
  }
  return out;
}

/** "Take out the repeated verb" (B2-8, B3-8): the answer without the verb the form prints before it. */
function printedLeadCandidates(report: Report, ctx: FixContext): FixCandidate[] {
  const out: FixCandidate[] = [];
  for (const flag of open(report).filter((f) => f.evidence === "printed lead")) {
    const at = paragraphOf(report, flag.sectionKey, flag.paragraphId);
    if (!at) continue;
    const field = ctx.form?.fields.find((f) => f.id === (at.section.fieldId ?? at.section.key));
    const lead = field ? printedLeadOf(field, ctx.form) : null;
    const after = withoutPrintedVerb(at.paragraph.text, lead);
    if (!after || after === at.paragraph.text) continue;
    out.push({ generator: "printed-lead", label: `Take out the repeated “${lead}”`, sectionKey: at.section.key, paragraphId: at.paragraph.id, before: at.paragraph.text, after, removedSpans: [], answers: [flag], ackPolicy: "member" });
  }
  return out;
}

/** WB's attribution, quotation and commentary fixes (core/validation/attribution-fixes.ts), as candidates. */
function attributionCandidates(report: Report, actor: Actor): FixCandidate[] {
  const out: FixCandidate[] = [];
  if (ATTRIBUTION_FIX_GENERATORS.length === 0) return out;
  for (const flag of report.flags.filter((f) => !f.acknowledged && f.paragraphId)) {
    const at = paragraphOf(report, flag.sectionKey, flag.paragraphId);
    if (!at) continue;
    for (const gen of ATTRIBUTION_FIX_GENERATORS) {
      const p = gen({ report, section: at.section, paragraph: at.paragraph, flag, actor });
      if (!p || p.sectionKey !== at.section.key || p.paragraphId !== at.paragraph.id || p.before !== at.paragraph.text) continue;
      const removedSpans = p.removedSpans.map((r) => ({ start: r.start, end: r.end, text: p.before.slice(r.start, r.end) }));
      out.push({ generator: p.generator, label: p.label, sectionKey: p.sectionKey, paragraphId: p.paragraphId, before: p.before, after: p.after, removedSpans, answers: [flag], ...(p.ackPolicy ? { ackPolicy: p.ackPolicy } : {}) });
    }
  }
  return out;
}

/** Whether `actor` may apply a fix with this policy: "approver" fixes are the report's approver's (WC). */
function mayApply(policy: FixProposal["ackPolicy"], report: Pick<Report, "approver">, actor: Actor): boolean {
  if (policy === "never") return false;
  if (policy === "approver") return Boolean(report.approver && report.approver.memberId === actor.memberId);
  return true;
}

/**
 * Every one-click fix the engine offers `actor` on `report` (whose flags are the validators' latest), each checked by
 * planFix. A signed report offers none. Used by the review (fix-preview.tsx) and the safety corpus.
 */
export function offeredFixes(report: Report, ctx: FixContext & { actor: Actor }): FixProposal[] {
  if (report.status === "signed") return [];
  const candidates = [
    ...repeatCandidates(report, ctx),
    ...duplicateCandidates(report),
    ...valueOnlyCandidates(report, ctx),
    ...doseCandidates(report),
    ...printedLeadCandidates(report, ctx),
    ...attributionCandidates(report, ctx.actor),
  ].filter((c) => mayApply(c.ackPolicy, report, ctx.actor));
  if (candidates.length === 0) return [];
  const blockingBefore = validationOf({ ...report, flags: [] }, ctx);
  const out: FixProposal[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const key = `${c.generator}|${c.paragraphId}`;
    if (seen.has(key)) continue;
    const proposal = planFix(report, c, ctx, blockingBefore);
    if (!proposal) continue;
    seen.add(key);
    out.push(proposal);
  }
  return out;
}

/** The proposal that undoes an applied one (its after back to its before). */
export function undoProposal(applied: FixProposal): FixProposal {
  return { generator: `undo-${applied.generator}`.slice(0, 64), sectionKey: applied.sectionKey, paragraphId: applied.paragraphId, label: "Undo", before: applied.after, after: applied.before, removedSpans: [] };
}

const quoteExcerpt = (s: string) => `“${s.length > 70 ? `${s.slice(0, 67).trimEnd()}…` : s}”`;

/**
 * Apply a one-click fix the engine offered (the reducer's `applyFix {proposal}`, use-review-state.ts – WC; the safety
 * corpus dispatches it too). Only while the paragraph still reads `before`; a signed report never changes. The text
 * becomes `after` (a removal of a whole duplicate paragraph removes it), the paragraph keeps its origin – "ai" stays
 * "ai", so the drafted-text checks keep running – and the fix is recorded in Paragraph.fixes {kind, by, at, edits} and
 * in the activity log.
 */
export function applyFixProposal(report: Report, proposal: FixProposal, actor: Actor, now?: Date): Report {
  if (report.status === "signed") return report;
  const at = paragraphOf(report, proposal.sectionKey, proposal.paragraphId);
  if (!at || at.paragraph.text !== proposal.before || proposal.before === proposal.after) return report;
  const when = (now ?? new Date()).toISOString();
  const section = at.section;
  let sections: ReportSection[];
  if (proposal.after.trim() === "") {
    // Only a duplicate paragraph goes whole – and only while the box keeps another paragraph.
    if (!section.paragraphs.some((p) => p.id !== proposal.paragraphId && p.text.trim())) return report;
    sections = report.sections.map((s) => (s.key !== section.key ? s : { ...s, paragraphs: s.paragraphs.filter((p) => p.id !== proposal.paragraphId) }));
  } else {
    const fix = { kind: proposal.generator.slice(0, 64), by: actor, at: when, edits: [{ start: 0, end: proposal.before.length, text: proposal.after }] };
    sections = report.sections.map((s) =>
      s.key !== section.key ? s : { ...s, paragraphs: s.paragraphs.map((p): Paragraph => (p.id !== proposal.paragraphId ? p : { ...p, text: proposal.after, fixes: [...(p.fixes ?? []), fix] })) },
    );
  }
  return appendActivity(
    { ...report, sections, updatedAt: when },
    { actor: actor.name, action: "edited", detail: `${section.key}: one-click fix “${proposal.label}” – ${quoteExcerpt(proposal.before)} → ${proposal.after.trim() ? quoteExcerpt(proposal.after) : "removed"}.` },
    now,
  );
}

/* ------------------------------------------------------------------------------------------------
 * The signer's own voice, leftover "not recorded" sentences
 * ----------------------------------------------------------------------------------------------*/

/**
 * Drafted paragraphs that report `authorName`'s own notes as record-keeping – in the third person ("Sarah
 * Reid recorded…", "she recorded…") or as "I recorded…" – which "Write in my own voice" turns into the
 * signer's plain clinical wording (core/voice.ts inOwnClinicalWording).
 */
export function ownVoiceCandidates(report: Pick<Report, "sections" | "bundleSnapshot">, authorName: string): Array<{ key: string; paragraphId: string }> {
  const out: Array<{ key: string; paragraphId: string }> = [];
  for (const s of report.sections) {
    for (const p of s.paragraphs) {
      if (isOwnVoiceCandidate(p, report.bundleSnapshot, authorName, { pronouns: true }) && inOwnClinicalWording(p.text, authorName, { pronouns: true }) !== p.text) out.push({ key: s.key, paragraphId: p.id });
    }
  }
  return out;
}

/**
 * Rewrite every candidate paragraph in the author's own voice. Each becomes "edited" (the AI wording
 * stays available through "Revert to AI draft"); citations are unchanged. One activity entry.
 */
export function writeInOwnVoice(report: Report, authorName: string, actor: string, now?: Date): Report {
  const targets = ownVoiceCandidates(report, authorName);
  if (targets.length === 0) return report;
  let next = report;
  for (const t of targets) {
    const p = next.sections.find((s) => s.key === t.key)?.paragraphs.find((x) => x.id === t.paragraphId);
    if (p) next = editParagraph(next, t.key, t.paragraphId, inOwnClinicalWording(p.text, authorName, { pronouns: true }), now);
  }
  return appendActivity(
    next,
    { actor, action: "edited", detail: `Wrote ${targets.length} drafted answer${targets.length === 1 ? "" : "s"} about ${authorName}'s own notes in ${authorName}'s own clinical wording (citations unchanged).` },
    now,
  );
}

/**
 * "Name Tom Ellis instead" (fix round 1, B0-1): the rewrite offered on an OTHER_CLINICIAN_VOICE flag – the paragraph
 * with the one other clinician whose note it cites named instead of "I" / "me" / "my" – or null (two clinicians, or
 * wording the rewrite cannot settle: the clinician edits it).
 */
export function nameClinicianFix(report: Pick<Report, "sections" | "bundleSnapshot" | "author">, flag: Pick<ReportFlag, "code" | "sectionKey" | "paragraphId">): { name: string; text: string } | null {
  if (flag.code !== "OTHER_CLINICIAN_VOICE" || !flag.sectionKey || !flag.paragraphId) return null;
  const p = report.sections.find((s) => s.key === flag.sectionKey)?.paragraphs.find((x) => x.id === flag.paragraphId);
  if (!p) return null;
  const others = otherCliniciansInFirstPerson(p, report.bundleSnapshot, report.author);
  if (!others || others.length !== 1) return null;
  const text = nameClinicianInstead(p.text, others[0]);
  return text ? { name: others[0], text } : null;
}

/** Apply nameClinicianFix() to the flagged paragraphs (by flag ID): each becomes "edited" (revertable); one activity entry each. */
export function nameCliniciansInstead(report: Report, flags: readonly ReportFlag[], actor: string, now?: Date): Report {
  let next = report;
  for (const flag of flags) {
    const fix = nameClinicianFix(next, flag);
    if (!fix || !flag.sectionKey || !flag.paragraphId) continue;
    next = appendActivity(
      editParagraph(next, flag.sectionKey, flag.paragraphId, fix.text, now),
      { actor, action: "edited", detail: `${flag.sectionKey}: named ${fix.name}, who wrote the cited note, instead of “I” or “my” (citations unchanged).` },
      now,
    );
  }
  return next;
}

/**
 * Sentences of drafted text that only say something was NOT recorded (whole sentences, by the shared tokenizer – bh2
 * WD design 5: never a split inside "8.0").
 */
export function notRecordedSentences(text: string): string[] {
  return splitSentences(text)
    .map((x) => x.text.trim())
    .filter((x) => /\b(?:no|not|nothing)\b[\s\S]*\b(?:recorded|documented|noted|stated)\b/i.test(x) && !/\bI recorded\b/.test(x));
}

/**
 * On an opinion question the clinician has now answered: the AI paragraphs' "No … was recorded."
 * sentences, which the clinician's own answer replaces.
 */
export function supersededAbsenceSentences(section: Pick<ReportSection, "kind" | "paragraphs">): Array<{ paragraphId: string; sentence: string }> {
  if (section.kind !== "clinician_opinion") return [];
  if (!section.paragraphs.some((p) => p.origin === "clinician" && p.text.trim())) return [];
  const out: Array<{ paragraphId: string; sentence: string }> = [];
  for (const p of section.paragraphs) {
    if (p.origin !== "ai" && p.origin !== "edited") continue;
    for (const sentence of notRecordedSentences(p.text)) out.push({ paragraphId: p.id, sentence });
  }
  return out;
}

/** Remove superseded "not recorded" sentences (paragraphs left empty are removed). */
export function removeAbsenceSentences(report: Report, key: string, actor: string, now?: Date): Report {
  const section = report.sections.find((s) => s.key === key);
  if (!section) return report;
  const found = supersededAbsenceSentences(section);
  if (found.length === 0) return report;
  let next = report;
  for (const { paragraphId, sentence } of found) {
    const p = next.sections.find((s) => s.key === key)?.paragraphs.find((x) => x.id === paragraphId);
    if (!p) continue;
    // Whole sentences only (the shared tokenizer), the rest of the paragraph as written.
    const text = removeSentences(p.text, (span) => sentenceKey(span.text) === sentenceKey(sentence)).after.trim();
    next = text ? editParagraph(next, key, paragraphId, text, now) : removeParagraph(next, key, paragraphId, now);
  }
  return appendActivity(next, { actor, action: "edited", detail: `${key}: removed the draft's “not recorded” wording now that the clinician has answered.` }, now);
}
