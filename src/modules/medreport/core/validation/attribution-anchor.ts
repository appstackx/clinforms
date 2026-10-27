/**
 * findAnchor – where one sentence of a cited clinician's note asserts a phrase (plan WB design 2, N-ATTR-2; seam
 * "fix-generators-and-anchor", bh2-base2). It replaces the old acceptance "the phrase appears somewhere in the cited
 * text" (indexOf over every cited source joined), which let a goal, a hedge, a question or the opposite polarity
 * licence a firm drafted opinion.
 *
 * A phrase is anchored only when ONE sentence of a cited note written by a clinician (the holder, when the draft names
 * one: "in X's opinion" anchors only to a note X wrote) holds it, and that sentence
 * - is not a goal, aim, plan, target, STG or LTG (by its inline label, its words, or – for an outcome such as a
 *   recovery, a return or fitness – the note's plan field), and not a question;
 * - has no negator or hedge in the part of the sentence that says it – its conjunct segments, a modifier beside them
 *   (", probably", " – not yet") and a lead condition (attribution-text.ts frameScope) – that the draft drops (not, no,
 *   never, unlikely, doubtful, unclear, possible, "?", not yet, at this stage, if, whether …);
 * - is the clinician's own statement (check-WB M1, M2): no belief, worry, feeling, wish, someone else's report or
 *   question, third party, another person, risk or monitoring, condition (when / once / after / provided / assuming /
 *   until / unless), refusal or earlier time frames it – unless the draft keeps that frame ("He is worried he will
 *   never fully recover");
 * - is not weaker than the draft (no may → is: the draft's modal strength may not exceed the note's), with the same
 *   polarity (the draft does not negate what the note asserts);
 * - holds every content word of the drafted clause around the phrase (so a changed figure, a different cause or an
 *   added qualifier is not covered by the phrase alone).
 * The history fields (past medical, social history) never anchor. Every allow returns the note, its author and the
 * sentence – for the review ("shows the note sentence") and for WD's band information (WD design 4).
 *
 * anchorClause() is the same test for a whole drafted clause that has no listed opinion phrase (the opinion-box rule,
 * design 3, and the attribution checks): every content word in one note sentence, with that sentence's hedges kept,
 * its negation matched, its goal frame kept and its modal strength not exceeded.
 *
 * harden-WB (check2-WB N1, N2, N4): the note may write the phrase in another tense of its auxiliary (phraseForms); a plan,
 * need or advice modal reads a plan line that states it as the instruction (planAnchor); an outcome in the plan field
 * anchors where the draft reports it as the plan, request, explanation or advice (planFramed); the note's words must be
 * the same opinion phrase (samePhraseAt); a quotation is tried at most MAX_QUOTE_PLACES times in one note sentence.
 *
 * Ledger hook "quoted-in-source" (ledger.json): findAnchor and anchorClause allow nothing while it is disabled.
 * Pure; browser and server. Owner: WB (opinion guard and attribution) – docs/bh2-ownership.json.
 */
import type { Note } from "../types";
import { MAX_CLAIM_SEGMENTS, MAX_WINDOW_SEGMENTS, contentStems, covers, droppedFrames, frameScope, hasOpinionCue, noteSentences, sameName, segmentStems, segmentsOf, stanceOf, wordIndexOf, type IgnoreNames, type NoteSentence, type Segment } from "./attribution-text";
import { defineHook, hookEnabled } from "./hooks";
import { normaliseForMatch } from "./text";

/** Ledger hook: an opinion phrase accepted because a cited note asserts it (findAnchor / anchorClause). */
export const QUOTED_IN_SOURCE = defineHook("quoted-in-source");

/** Where a cited note asserts the phrase. */
export interface NoteAnchor {
  noteId: string;
  /** The note's author (a clinician of the bundle). */
  author: Note["author"];
  /** The note's sentence that asserts it, as written. */
  sentence: string;
}

export interface FindAnchorInput {
  /** The drafted phrase (an opinion or expectation, e.g. "should settle within 4–6 weeks"). */
  phrase: string;
  /** The drafted sentence (or clause) it sits in (for modality, polarity and its content words). */
  sentence?: string;
  /** The notes the paragraph cites (only these may anchor it). */
  notes: readonly Note[];
  /** "in X's opinion": the clinician who must have written the note. */
  holder?: string | null;
  /**
   * What the phrase claims: "outcome" (recovery, prognosis, a return, fitness, permanence – a note's plan field does not
   * record it as having happened), else "opinion" (default).
   */
  kind?: "outcome" | "opinion";
  /** Names to leave out of the content words (clinicians; the patient's title and surname are always left out). */
  ignore?: IgnoreNames;
  /**
   * The drafted sentence before the phrase (normalised), its attribution frame included ("on 08/09/2026 tom ellis recorded
   * in the plan that he explained the diagnosis and that the"): whether the draft reports a plan, a request, an
   * explanation or advice (harden-WB, check2-WB N2).
   */
  context?: string;
  /**
   * The words of the phrase that only say it is a plan, advice or need ("should", "plan to", "advising"): a note's plan
   * instruction ("Avoid twisting and pivoting for now.") is that plan without them (see planAnchor).
   */
  planWords?: string;
  /**
   * The opinion pattern the phrase was found by: the note's same words must be that phrase there too – "to the left with
   * his foot planted" never holds a drafted "left with" (permanence; harden-WB).
   */
  pattern?: RegExp;
}

/** A draft that reports a plan, a request, an explanation or advice – by its frame or its words before the phrase. */
const PLAN_FRAMED =
  /\b(?:plans?|planned|planning|request(?:s|ed|ing)?|explain(?:s|ed|ing)?|explanation|advis(?:e|es|ed|ing)|advice|recommend(?:s|ed|ing|ation|ations)?|discuss(?:es|ed|ing|ion)?|propos(?:e|es|ed|al)|aim(?:s|ed)?|goals?|to complete|reassur(?:e|es|ed|ing|ance))\b/;

/** Whether the drafted clause (and its context) reports a plan, request, explanation or advice. */
export function planFramed(clause: string, context = ""): boolean {
  return PLAN_FRAMED.test(`${context} ${clause}`);
}

/**
 * The forms of a drafted phrase a note may write it in: the same words, or another tense of its auxiliary – "had settled"
 * is the note's "has settled" or "settled", "would give way" its "will give way" (check2-WB N2). The stance (modality,
 * negation, hedges) is still compared, so "will" over a note's "would" stays refused.
 */
const AUX_CLASSES: ReadonlyArray<readonly string[]> = [
  ["has", "have", "had"],
  ["is", "are", "was", "were"],
  ["will", "would"],
  ["can", "could"],
];
export function phraseForms(phrase: string): string[] {
  const out = [phrase];
  const m = /^(\S+) (.+)$/.exec(phrase);
  if (!m) return out;
  const cls = AUX_CLASSES.find((c) => c.includes(m[1]));
  if (!cls) return out;
  for (const a of cls) if (a !== m[1]) out.push(`${a} ${m[2]}`);
  if (cls.includes("has") || cls.includes("is")) out.push(m[2]);
  return out;
}

/** The goal and plan words that frame a note sentence. */
const GOAL_WORDS = /\b(?:goals?|aims?|aiming|targets?|objectives?|stg|ltg|hopes?|hoping|plans?|planned|planning|intends?|intended|expectations?)\b/;

function noteOk(s: NoteSentence, kind: FindAnchorInput["kind"], draft: { goal: boolean; modality: number; planFramed: boolean }): boolean {
  if (s.field === "history" || s.question) return false;
  if ((s.goalLabel || GOAL_WORDS.test(s.norm)) && !draft.goal) return false;
  // The plan field records what was planned, explained or advised: it never anchors an outcome drafted as having
  // happened ("he returned to normal duties" from "Plan: return to normal duties within 2 weeks"); a drafted possibility
  // or plan ("could return on amended duties if …") it holds is the note's own, and so is the plan, request, explanation
  // or advice the draft reports as such ("recorded in the plan that he explained … that the outlook is good", "requested 3
  // further sessions … to complete the graded return to full duties" – check2-WB N2).
  if (kind === "outcome" && s.field === "plan" && !draft.goal && !draft.planFramed && draft.modality >= 3) return false;
  return true;
}

/** A run of a note sentence's text: [start, end) and the text. */
export interface NoteSpan {
  start: number;
  end: number;
  text: string;
}

/**
 * The shortest run of a note sentence's conjunct segments that holds every one of `want` (and, when given, the span
 * [mustStart, mustEnd)) – the part of the note that says it, whose own negation, hedges and modality count (a "no
 * neurological signs" later in the sentence does not negate "consistent with whiplash-associated disorder grade II").
 * Bounded (check-WB M6): each segment's stems are read once, and a run is at most MAX_WINDOW_SEGMENTS segments – a
 * longer one is never one statement – so the work is linear in the sentence.
 */
export function coveringSpan(norm: string, want: readonly string[], ignore?: IgnoreNames, must?: { start: number; end: number }, owner?: object): NoteSpan | null {
  const { segs, stems } = segmentStems(norm, ignore, owner);
  if (segs.length === 0) return null;
  let best: { start: number; end: number } | null = null;
  for (let i = 0; i < segs.length; i++) {
    if (must && segs[i].start > must.start) break;
    const have: string[] = [];
    for (let j = i; j < segs.length && j < i + MAX_WINDOW_SEGMENTS; j++) {
      for (const st of stems[j]) have.push(st);
      if (must && segs[j].end < must.end) continue;
      if (best !== null && segs[j].end - segs[i].start >= best.end - best.start) break;
      if (covers(want, have).ok) {
        best = { start: segs[i].start, end: segs[j].end };
        break;
      }
    }
  }
  return best ? { ...best, text: norm.slice(best.start, best.end) } : null;
}

/** The text of coveringSpan (see there). */
export function coveringWindow(norm: string, want: readonly string[], ignore?: IgnoreNames, must?: { start: number; end: number }): string | null {
  return coveringSpan(norm, want, ignore, must)?.text ?? null;
}

/**
 * The note's own plan acts (fix round 1, R1T-WB-06): on a plan line "Request 3 further sessions … from the case
 * manager", "Discussed a graded return with the case manager", "Consider a scan", "Refer back to his GP …" are what the
 * clinician planned and whom it involves, not someone else's request, words or question – a draft that reports the
 * plan, request, advice or referral ("recorded the plan to complete …", "a request to the case manager for …") keeps
 * them. Any other frame of the plan line (a wish, a worry, a condition, an earlier time) still counts.
 */
const PLAN_ACT_FRAMES = new Set(["request", "discuss", "consider", "ask", "gp", "solicitor", "employer"]);
/**
 * A draft that reports the plan itself – the plan, a request, an aim or a referral – so a plan line's own plan acts may
 * stay unsaid. Advice or a recommendation is not such a report: "Surgery was recommended" never reports "Discuss
 * surgery with GP" (a discussion is not a recommendation); a draft that says "discussed" keeps the frame by its own word.
 */
const PLAN_ACT_REPORT = /\b(?:plans?|planned|planning|request(?:s|ed|ing)?|aim(?:s|ed)?|goals?|to complete|refer(?:s|red|ring|ral)?)\b/;

/** Whether the drafted clause (and its context) reports the plan itself (PLAN_ACT_REPORT). */
function planActReported(clause: string, context = ""): boolean {
  return PLAN_ACT_REPORT.test(`${context} ${clause}`);
}

/** The frames of `scope` the draft drops – a plan line's own plan acts kept when the draft reports the plan. */
function droppedFramesOf(s: NoteSentence, scope: string, clause: string, planReported: boolean): string[] {
  const dropped = droppedFrames(scope, clause);
  if (!planReported || !isPlanLine(s)) return dropped;
  return dropped.filter((k) => !PLAN_ACT_FRAMES.has(k));
}

/** Whether the note sentence's part that says [window] has the drafted stance: its frames kept, the same negation, its hedges kept, no stronger modality. */
function stanceHolds(s: NoteSentence, window: { start: number; end: number }, clause: string, d: { negated: boolean; hedges: string[]; modality: number; planActReported?: boolean; goal?: boolean }): boolean {
  // The part of the note that says it (the window, a lead condition, a modifier, the label – attribution-text.ts
  // frameScope): said by the clinician, not someone's worry, wish, report or condition (unless the draft says whose it
  // is), and with no negator or hedge the draft drops ("Not fit for full warehouse duties at present" drafted as "was not
  // fit for full warehouse duties at present" keeps it). Another conjunct's own negation ("…, no neurological signs") is
  // not this statement's.
  const scope = frameScope(s, window.start, window.end);
  if (droppedFramesOf(s, scope, clause, Boolean(d.planActReported)).length > 0) return false;
  const n = stanceOf(scope);
  if (n.negated !== d.negated) return false;
  if (!n.hedges.every((h) => d.hedges.includes(h))) return false;
  return d.modality <= n.modality;
}

/** Whether `re` matches the note's text at `at` (the same opinion phrase, read the same way – its lookbehinds included). */
function samePhraseAt(norm: string, at: number, re: RegExp): boolean {
  const g = new RegExp(re.source, "g");
  g.lastIndex = Math.max(0, at - 1);
  for (let m = g.exec(norm); m !== null && m.index <= at + 1; m = g.exec(norm)) {
    const lead = m[0].length - m[0].trimStart().length;
    if (m.index + lead === at) return true;
    if (m[0].length === 0) g.lastIndex += 1;
  }
  return false;
}

/** Where one cited note sentence asserts `phrase` (see the file header), or null. */
export function findAnchor(input: FindAnchorInput): NoteAnchor | null {
  if (!hookEnabled(QUOTED_IN_SOURCE)) return null;
  const phrase = normaliseForMatch(input.phrase).replace(/[.,;:!]+$/, "").trim();
  if (!phrase) return null;
  const clause = normaliseForMatch(input.sentence ?? input.phrase);
  // The claim around the phrase: the conjunct segments of its clause the phrase touches ("he was fit for a phased
  // return … over 2 weeks" in "…, and should avoid lifting …") – their content words must be in the note sentence.
  const at0 = wordIndexOf(clause, phrase);
  const segs = segmentsOf(clause);
  const touched = at0 < 0 ? segs : segs.filter((g) => g.start < at0 + phrase.length && at0 < g.end);
  const run = touched.length ? clause.slice(touched[0].start, touched[touched.length - 1].end) : clause;
  // The stance is the part of the drafted clause that says it – the segments the phrase touches, with their modifiers
  // and lead conditions ("He will not, in my opinion, return …") – not another conjunct ("…, with neck pain and no
  // neurological signs"); the content is the run's.
  // A goal, plan or recommendation frame anywhere in the drafted clause ("His recommendation … was a phased return …")
  // still makes it a plan statement.
  const dStance = {
    ...stanceOf(at0 < 0 ? clause : frameScope({ norm: clause, label: null }, at0, at0 + phrase.length, undefined, "draft")),
    goal: stanceOf(clause).goal,
    planFramed: planFramed(clause, input.context),
    planActReported: planActReported(clause, input.context),
  };
  const want = contentStems(run, input.ignore);
  const forms = phraseForms(phrase);
  for (const note of input.notes) {
    if (input.holder && !sameName(note.author.name, input.holder)) continue;
    for (const s of noteSentences(note)) {
      if (!noteOk(s, input.kind, dStance)) continue;
      for (const form of forms) {
        const at = wordIndexOf(s.norm, form);
        if (at < 0) continue;
        if (form === phrase && input.pattern && !samePhraseAt(s.norm, at, input.pattern)) continue;
        // The part of the note sentence that says it: the phrase's clause, widened to the drafted claim's content words.
        const window = coveringSpan(s.norm, want, input.ignore, { start: at, end: at + form.length }, s);
        if (window && stanceHolds(s, window, clause, dStance)) return { noteId: note.id, author: note.author, sentence: s.text };
      }
    }
  }
  return input.planWords ? planAnchor(input, clause, run, dStance) : null;
}

/** A plan line by its label (the plan field is one by its field). */
const PLAN_LABEL = /^(?:plan|plans|rtw plan|return to work plan|advice|recommendations?)$/;
/** A note sentence that plans or advises in its own words. */
const PLANISH_NOTE = /\b(?:advis\w*|advice|recommend\w*|plan|plans|planned)\b/;
/** A drafted clause that reports advice given, and the advice words' stems. */
const ADVICE_IN_DRAFT = /\b(?:advis(?:e|es|ed|ing)|advice|recommend(?:s|ed|ing|ation|ations)?)\b/;
const ADVICE_STEM = /^(?:advis|advic|recommend)/;
/** The light verbs that report advice given ("advice was given", "provided advice on", "gave him advice"). */
const ADVICE_LIGHT_VERB = /^(?:give|giv|gave|provid|offer)$/;
/** A drafted clause that gives what it says as the patient's history (past medical or social history, an earlier episode). */
const HISTORY_IN_DRAFT = /\b(?:past medical history|medical history|social history|history of|pmh|previous(?:ly)?|prior|before the (?:accident|injury|incident)|in the past)\b/;

/** A note's plan line: the plan field, a plan or advice label, or a sentence that plans or advises in its own words. */
function isPlanLine(s: NoteSentence): boolean {
  return s.field === "plan" || (s.label !== null && PLAN_LABEL.test(s.label)) || PLANISH_NOTE.test(s.norm);
}
/** A goal, aim, target or hope – an outcome wanted, not a plan instruction. */
const GOAL_ONLY = /\b(?:goals?|aims?|aiming|targets?|objectives?|stg|ltg|hopes?|hoping|expectations?)\b/;

/**
 * check2-WB N2: a drafted plan, need or advice ("should avoid twisting", "a plan to request 3 further sessions", "sessions
 * would be weekly", "advising ice and compression") whose note writes it as its own plan instruction, without the modal
 * or advice word ("Avoid twisting and pivoting for now.", "Request 3 further sessions …", "Weekly sessions.", "Ice and
 * compression for the swelling."). Anchored only to a plan line – the plan field, a plan or advice label, or a sentence
 * that plans or advises in its own words – that holds every other content word of the drafted conjunct, with the same
 * frames, negation and hedges and no weaker modality than the draft's; a goal, aim, target or hope only when the draft
 * keeps it a goal. Which modals may be read this way is the caller's (opinion-language.ts planWordsOf: should, needs to,
 * plans to …; will / would only when the draft reports a plan).
 */
function planAnchor(input: FindAnchorInput, clause: string, run: string, d: { goal: boolean; negated: boolean; hedges: string[]; modality: number; planActReported?: boolean }): NoteAnchor | null {
  const drop = new Set(contentStems(normaliseForMatch(input.planWords ?? "")));
  const want = contentStems(run, input.ignore).filter((w) => !drop.has(w));
  if (want.length === 0) return null;
  for (const note of input.notes) {
    if (input.holder && !sameName(note.author.name, input.holder)) continue;
    for (const s of noteSentences(note)) {
      if (s.field === "history" || s.question) continue;
      const planLabel = s.label !== null && PLAN_LABEL.test(s.label);
      if (!isPlanLine(s)) continue;
      if (((s.goalLabel && !planLabel) || GOAL_ONLY.test(s.norm)) && !d.goal) continue;
      if (!covers(want, s.stems).ok) continue;
      const window = coveringSpan(s.norm, want, input.ignore, undefined, s);
      if (window && stanceHolds(s, window, clause, d)) return { noteId: note.id, author: note.author, sentence: s.text };
    }
  }
  return null;
}

export interface AnchorClauseInput {
  /** The drafted clause (as written or normalised). */
  clause: string;
  notes: readonly Note[];
  holder?: string | null;
  ignore?: IgnoreNames;
  /** The drafted sentence around the clause (normalised): whether it gives the clause as history ("… in his past medical history"). */
  context?: string;
}

/**
 * Where one cited note sentence holds a whole drafted clause: every content word, its hedges kept, the same negation, its
 * goal frame kept and no stronger modality – or null. A clause with no content words is anchored to nothing (null).
 */
export function anchorClause(input: AnchorClauseInput): NoteAnchor | null {
  if (!hookEnabled(QUOTED_IN_SOURCE)) return null;
  const clause = normaliseForMatch(input.clause);
  const want = contentStems(clause, input.ignore);
  if (want.length === 0) return null;
  const d = stanceOf(clause);
  // Advice the draft reports ("heat was advised for comfort", "he was advised to avoid twisting", fix round 1: "advice
  // was given to avoid twisting", "she gave advice on …") is the note's plan line without the advice word or the light
  // verb that reports it ("Heat for comfort.", "Avoid twisting and pivoting for now." – check2-WB N2).
  const advice = ADVICE_IN_DRAFT.test(clause) ? want.filter((w) => !ADVICE_STEM.test(w) && !ADVICE_LIGHT_VERB.test(w)) : null;
  // A plan the draft reports as the plan, a request or a referral (fix round 1): a plan line's own plan acts are kept.
  const planReported = planActReported(clause, input.context);
  // History fields hold history facts (fix round 1, R1T-WB-06 e): a clause the draft gives as history, or one with no
  // opinion cue (a condition and how it is managed – "asthma, well controlled with an inhaler"), may anchor there; an
  // outcome, prognosis or other opinion never does ("settled with 4 sessions in 2019" never holds a recovery now).
  const historyOk = HISTORY_IN_DRAFT.test(`${input.context ?? ""} ${clause}`) || !hasOpinionCue(clause);
  for (const note of input.notes) {
    if (input.holder && !sameName(note.author.name, input.holder)) continue;
    for (const s of noteSentences(note)) {
      if ((s.field === "history" && !historyOk) || s.question) continue;
      const need = advice && advice.length > 0 && isPlanLine(s) && !covers(want, s.stems).ok ? advice : want;
      if (!covers(need, s.stems).ok) continue;
      // The part of the note that holds the claim decides its stance ("…fit for a phased return; he should avoid
      // lifting" – the second clause's "should" does not weaken the first, "no neurological signs" does not negate it).
      const span = coveringSpan(s.norm, need, input.ignore, undefined, s);
      if (span && droppedFramesOf(s, frameScope(s, span.start, span.end), clause, planReported).length > 0) continue;
      // Its stance: the window with its modifiers and lead conditions (frameScope), not another conjunct's.
      const n = stanceOf(span ? frameScope(s, span.start, span.end) : s.norm);
      if (n.negated !== d.negated) continue;
      if ((s.goalLabel || n.goal) && !d.goal) continue;
      if (!n.hedges.every((h) => d.hedges.includes(h))) continue;
      if (d.modality > n.modality) continue;
      return { noteId: note.id, author: note.author, sentence: s.text };
    }
  }
  return null;
}

export interface ClaimAnchors {
  /** Each conjunct segment of the claim: its text, whether it has content words, and the note sentence that holds it. */
  segments: Array<{ text: string; content: boolean; anchor: NoteAnchor | null }>;
}

/**
 * Anchor a whole claim conjunct by conjunct: the longest run of consecutive segments one cited note sentence holds
 * (anchorClause), then the next – so "working full time on normal duties, driving without restriction and swimming
 * twice a week" is held by three sentences of the note, while one conjunct ("fit for normal duties") is never pieced
 * together from two.
 */
/** "consistent with", "in keeping with", "compatible with", "associated with", "in line with": the opinion and its object are one statement. */
const OPINION_WITH = /\b(?:consistent|keeping|compatible|associated|line|accordance)$/;

/** A claim's conjunct segments, an opinion and its "with …" object kept together (see OPINION_WITH). */
export function claimSegments(claim: string, ignore?: IgnoreNames): { segs: Segment[]; stems: string[][] } {
  const base = segmentStems(claim, ignore);
  if (!base.segs.some((g) => OPINION_WITH.test(g.text.trim()))) return base;
  const segs: Segment[] = [];
  for (const g of base.segs) {
    const last = segs[segs.length - 1];
    if (last && OPINION_WITH.test(last.text.trim()) && /^\s+with\s+$/.test(claim.slice(last.end, g.start))) {
      segs[segs.length - 1] = { start: last.start, end: g.end, text: claim.slice(last.start, g.end) };
    } else segs.push(g);
  }
  return { segs, stems: segs.map((g) => contentStems(g.text, ignore)) };
}

export function anchorClaim(input: AnchorClauseInput): ClaimAnchors {
  const claim = normaliseForMatch(input.clause);
  const { segs, stems } = claimSegments(claim, input.ignore);
  const out: ClaimAnchors["segments"] = segs.map((g, k) => ({ text: g.text, content: stems[k].length > 0, anchor: null }));
  // A claim of more segments than one statement ever has is not pieced together (check-WB M6): nothing is anchored.
  if (segs.length > MAX_CLAIM_SEGMENTS) return { segments: out };
  let i = 0;
  while (i < segs.length) {
    if (!out[i].content) {
      i += 1;
      continue;
    }
    let done = false;
    for (let j = Math.min(segs.length, i + MAX_WINDOW_SEGMENTS) - 1; j >= i; j--) {
      const a = anchorClause({ ...input, clause: claim.slice(segs[i].start, segs[j].end) });
      if (!a) continue;
      for (let k = i; k <= j; k++) out[k].anchor = a;
      i = j + 1;
      done = true;
      break;
    }
    if (!done) i += 1;
  }
  return { segments: out };
}

/** A goal or plan label outside the quotation, a negator, hedge, "?", weaker modal or condition, or a dropped frame. */
function quoteDropsStance(s: NoteSentence, at: number, quoted: string, outside: string): boolean {
  const scope = frameScope(s, at, at + quoted.length, { start: at, end: at + quoted.length });
  const rest = stanceOf(scope);
  const kept = stanceOf(outside);
  if (rest.negated && !kept.negated) return true;
  if (!rest.hedges.every((h) => kept.hedges.includes(h) || quoted.includes(h))) return true;
  if (s.question && !quoted.includes("?") && !kept.question) return true;
  if ((s.goalLabel || rest.goal) && !kept.goal && !stanceOf(quoted).goal) return true;
  if (rest.modality < 3 && stanceOf(quoted).modality === 3 && kept.modality > rest.modality) return true;
  return droppedFrames(scope, outside).length > 0;
}

/** At most this many places of one quotation in one note sentence are tried. */
export const MAX_QUOTE_PLACES = 8;

/**
 * Whether `quoted` (normalised, shorthand written out) is word for word in one sentence of a cited note by `holder`,
 * and is the whole statement (check-WB M3): what the quotation leaves out of its part of the note sentence holds no
 * negator, hedge, "?", goal or plan label, weaker modal, condition or frame – "Not fit for full duties." quoted as
 * “fit for full duties” is a misquotation – unless the drafted sentence outside the quotation (`outside`, normalised)
 * says it ("He was not “fit for full duties”").
 */
export function quotedVerbatim(quoted: string, notes: readonly Note[], holder: string | null, outside = ""): NoteAnchor | null {
  const q = quoted.replace(/[.,;:!]+$/, "").trim();
  if (q.length < 3) return null;
  for (const note of notes) {
    if (holder && !sameName(note.author.name, holder)) continue;
    const sentences = noteSentences(note);
    for (const s of sentences) {
      if (s.field === "history") continue;
      // Each place the quotation is in the sentence, up to MAX_QUOTE_PLACES (check2-WB N4: a long note sentence that repeats
      // the quoted words is not read once per repeat; past the bound the quotation is not verbatim – fail closed).
      let tries = 0;
      for (let at = wordIndexOf(s.norm, q); at >= 0 && tries < MAX_QUOTE_PLACES; at = wordIndexOf(s.norm, q, at + 1), tries++) {
        if (!quoteDropsStance(s, at, q, outside)) return { noteId: note.id, author: note.author, sentence: s.text };
      }
    }
    const run = quotedAcrossSentences(q, sentences, outside);
    if (run) return { noteId: note.id, author: note.author, sentence: run };
  }
  return null;
}

/** At most this many consecutive note sentences make one quotation. */
const MAX_QUOTE_SENTENCES = 4;

/**
 * Fix round 1 (R1T-WB-07): a quotation of two or more consecutive sentences of one note field, word for word ("Good
 * progress after 5 sessions: the mechanical low back pain is resolving. In my opinion she should be able to return …").
 * Each note sentence the quotation covers is checked as a one-sentence quotation is (quoteDropsStance on its quoted
 * part): a first or last sentence quoted only in part keeps its negation, hedge, condition or frame inside the quotes,
 * or the quotation is not verbatim. Returns the note's sentences as written, or null.
 */
function quotedAcrossSentences(q: string, sentences: readonly NoteSentence[], outside: string): string | null {
  for (let i = 0; i < sentences.length; i++) {
    if (sentences[i].field === "history") continue;
    let joined = "";
    const parts: Array<{ s: NoteSentence; start: number }> = [];
    for (let j = i; j < sentences.length && j < i + MAX_QUOTE_SENTENCES && sentences[j].field === sentences[i].field; j++) {
      parts.push({ s: sentences[j], start: joined ? joined.length + 1 : 0 });
      joined = joined ? `${joined} ${sentences[j].norm}` : sentences[j].norm;
      if (parts.length < 2) continue;
      const at = wordIndexOf(joined, q);
      if (at < 0) continue;
      const end = at + q.length;
      // It must start in the first sentence of the run and end in its last (a shorter run would have held it).
      if (at >= parts[0].start + parts[0].s.norm.length || end <= parts[parts.length - 1].start) continue;
      const ok = parts.every(({ s, start }) => {
        const a = Math.max(at, start) - start;
        const b = Math.min(end, start + s.norm.length) - start;
        const piece = s.norm.slice(a, b).replace(/[.,;:!?]+$/, "").trim();
        return piece.length > 0 && !quoteDropsStance(s, a, piece, outside);
      });
      if (ok) return parts.map((x) => x.s.text).join(" ");
    }
  }
  return null;
}
