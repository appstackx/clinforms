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
 * - has no negator or hedge before or after the phrase in its clause (not, no, never, unlikely, doubtful, unclear,
 *   possible, "?", not yet, at this stage, if, whether …);
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
 * Ledger hook "quoted-in-source" (ledger.json): findAnchor and anchorClause allow nothing while it is disabled.
 * Pure; browser and server. Owner: WB (opinion guard and attribution) – docs/bh2-ownership.json.
 */
import type { Note } from "../types";
import { clauseAround, contentStems, covers, noteSentences, sameName, segmentsOf, stanceOf, wordIndexOf, type IgnoreNames, type NoteSentence } from "./attribution-text";
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
}

/** Words that say the phrase is not asserted, before or after it in its clause. */
const NOT_ASSERTED = /\b(?:not|no|never|neither|nor|nil|without|cannot|unable|unlikely|doubtful|unclear|uncertain|unknown|possible|possibly|probable|probably|perhaps|maybe|query|queried|questionable|suspected|potential|potentially|if|whether|unless|until)\b|n't\b|\?|\bnot yet\b|\bat this stage\b|\btoo early\b/;
/** The goal and plan words that frame a note sentence. */
const GOAL_WORDS = /\b(?:goals?|aims?|aiming|targets?|objectives?|stg|ltg|hopes?|hoping|plans?|planned|planning|intends?|intended|expectations?)\b/;

function noteOk(s: NoteSentence, kind: FindAnchorInput["kind"], draft: { goal: boolean; modality: number }): boolean {
  if (s.field === "history" || s.question) return false;
  if ((s.goalLabel || GOAL_WORDS.test(s.norm)) && !draft.goal) return false;
  // The plan field records what was planned or advised: it never anchors an outcome drafted as having happened ("he
  // returned to normal duties" from "Plan: return to normal duties within 2 weeks"); a drafted possibility or plan
  // ("could return on amended duties if …") it holds is the note's own.
  if (kind === "outcome" && s.field === "plan" && !draft.goal && draft.modality >= 3) return false;
  return true;
}

/**
 * The shortest run of a note sentence's conjunct segments that holds every one of `want` (and, when given, the span
 * [mustStart, mustEnd)) – the part of the note that says it, whose own negation, hedges and modality count (a "no
 * neurological signs" later in the sentence does not negate "consistent with whiplash-associated disorder grade II").
 */
export function coveringWindow(norm: string, want: readonly string[], ignore?: IgnoreNames, must?: { start: number; end: number }): string | null {
  const segs = segmentsOf(norm);
  if (segs.length === 0) return null;
  let best: string | null = null;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i; j < segs.length; j++) {
      if (must && !(segs[i].start <= must.start && must.end <= segs[j].end)) continue;
      const text = norm.slice(segs[i].start, segs[j].end);
      if (best !== null && text.length >= best.length) continue;
      if (covers(want, contentStems(text, ignore)).ok) best = text;
    }
  }
  return best;
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
  // The stance is the clause's (a negation, hedge, goal or modal anywhere in the drafted clause), the content the run's.
  const dStance = stanceOf(clause);
  const want = contentStems(run, input.ignore);
  for (const note of input.notes) {
    if (input.holder && !sameName(note.author.name, input.holder)) continue;
    for (const s of noteSentences(note)) {
      if (!noteOk(s, input.kind, dStance)) continue;
      const at = wordIndexOf(s.norm, phrase);
      if (at < 0) continue;
      // The part of the note sentence that says it: the phrase's clause, widened to the drafted claim's content words.
      const window = coveringWindow(s.norm, want, input.ignore, { start: at, end: at + phrase.length });
      if (!window) continue;
      const around = clauseAround(s.norm, at, at + phrase.length);
      // A negator or hedge before or after the phrase means the note does not assert it – unless the draft says the same
      // ("Not fit for full warehouse duties at present" drafted as "was not fit for full warehouse duties at present").
      const n = stanceOf(around);
      if (NOT_ASSERTED.test(around.replace(phrase, " ")) && !NOT_ASSERTED.test(phrase)) {
        if (n.negated !== dStance.negated || !n.hedges.every((h) => dStance.hedges.includes(h))) continue;
      }
      if (n.negated !== dStance.negated) continue;
      if (!n.hedges.every((h) => dStance.hedges.includes(h))) continue;
      if (dStance.modality > n.modality) continue;
      return { noteId: note.id, author: note.author, sentence: s.text };
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
  for (const note of input.notes) {
    if (input.holder && !sameName(note.author.name, input.holder)) continue;
    for (const s of noteSentences(note)) {
      if (s.field === "history" || s.question) continue;
      if (!covers(want, s.stems).ok) continue;
      // The part of the note that holds the claim decides its stance ("…fit for a phased return; he should avoid
      // lifting" – the second clause's "should" does not weaken the first, "no neurological signs" does not negate it).
      const holding = coveringWindow(s.norm, want, input.ignore) ?? s.norm;
      const n = stanceOf(holding);
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
export function anchorClaim(input: AnchorClauseInput): ClaimAnchors {
  const claim = normaliseForMatch(input.clause);
  const segs = segmentsOf(claim);
  const out: ClaimAnchors["segments"] = segs.map((g) => ({ text: g.text, content: contentStems(g.text, input.ignore).length > 0, anchor: null }));
  let i = 0;
  while (i < segs.length) {
    if (!out[i].content) {
      i += 1;
      continue;
    }
    let done = false;
    for (let j = segs.length - 1; j >= i; j--) {
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

/** Whether `quoted` (normalised, shorthand written out) is word for word in one sentence of a cited note by `holder`. */
export function quotedVerbatim(quoted: string, notes: readonly Note[], holder: string | null): NoteAnchor | null {
  const q = quoted.replace(/[.,;:!]+$/, "").trim();
  if (q.length < 3) return null;
  for (const note of notes) {
    if (holder && !sameName(note.author.name, holder)) continue;
    for (const s of noteSentences(note)) {
      if (s.field === "history") continue;
      if (wordIndexOf(s.norm, q) >= 0) return { noteId: note.id, author: note.author, sentence: s.text };
    }
  }
  return null;
}
