/**
 * Shared text helpers for WB's opinion and attribution checks (plan WB designs 2, 3, 7–9 and 12): what a cited note
 * says sentence by sentence, what a drafted sentence claims, who it says holds it, and how strongly.
 *
 * - noteSentences(note): every sentence of a clinician's note (the W0 tokenizer, "notes" policy), its field, its inline
 *   label ("Goal:", "STG:", "Plan:", "Opinion on work:"), normalised with the note's shorthand written out (">15 kg" →
 *   "more than 15 kg", "LBP" → "low back pain") – the form both sides are compared in.
 * - draftSentences(text, people): a drafted paragraph's sentences, each with its attribution frame ("On 06/05/2026 Tom
 *   Ellis recorded that…", "In my opinion…", "Priya Shah's assessment (01/09/2026): …", a framed quotation "Tom Ellis
 *   recorded on 06/05/2026: “…”") and the claim after it, split into clauses.
 * - contentStems / covers: the content words of a claim (function words, frames, names, the patient's title and name
 *   left out; figures kept) and whether one note sentence holds every one of them.
 * - stanceOf: negation, hedges, a goal or plan frame, a question, and modal strength (3 assertive – is, will, must,
 *   can; 2 probable – should, would, expect, likely; 1 possible – may, might, could).
 *
 * Pure; browser and server. Owner: WB (opinion guard and attribution) – docs/bh2-ownership.json.
 */
import { splitSentences } from "../text/sentences";
import type { Clinician, Note } from "../types";
import { expandNoteShorthand } from "../voice";
import { escapeRegExp, normaliseForMatch } from "./text";

/* ------------------------------------------------------------------------------------------------
 * Words
 * ----------------------------------------------------------------------------------------------*/

/** Words that carry no claim of their own: articles, pronouns, auxiliaries, prepositions, frame words, modals. */
const STOP = new Set(
  (
    "a an the and or but nor so yet then than that this these those which who whom whose what when where while as of to in on at for with by from " +
    "into onto over under about after before since until during through between within without per via also too very quite just only still now again " +
    "already currently today recently further i me my mine myself we us our ours he him his she her hers they them their theirs it its one ones " +
    "is are was were be been being am has have had having do does did done doing will would shall should can could may might must ought need needs " +
    "needed required require requires able unable going aim aims aimed plan plans planned intend intends hope hopes want wants wish " +
    "not no never n't nil none neither any some all each every both either " +
    "recorded record records noted note notes documented wrote written stated reported reports said says told describes described describing " +
    "opinion opinions view views clinical professional physiotherapist physiotherapists senior mcsp hcpc patient claimant client employee " +
    "mr mrs ms miss mx dr there here if whether because although though however appointment appointments visit visits occasion consultation part same effect regard respect terms order addition form including include includes"
  ).split(/\s+/),
);

/** Hedge words: a note sentence with one of them around a phrase does not assert it (and a draft that drops it overstates). */
export const HEDGE_WORDS = [
  "unlikely",
  "likely",
  "doubtful",
  "unclear",
  "uncertain",
  "unknown",
  "possible",
  "possibly",
  "probable",
  "probably",
  "perhaps",
  "maybe",
  "query",
  "queried",
  "questionable",
  "suspected",
  "suspect",
  "potential",
  "potentially",
  "?",
] as const;
const HEDGE_RE = /\b(?:unlikely|likely|doubtful|unclear|uncertain|unknown|possible|possibly|probable|probably|perhaps|maybe|query|queried|questionable|suspected|suspect|potential|potentially)\b|\?|\bnot yet\b|\bat this stage\b|\btoo early\b|\bif\b|\bwhether\b/g;
const NEGATION_RE = /\b(?:not|no|never|neither|nor|nil|without|cannot|unable)\b|n't\b/;
/** A goal, aim, plan or target frame – an outcome planned or hoped for, not recorded as having happened. */
const GOAL_RE = /\b(?:goals?|aims?|aiming|aimed|targets?|objectives?|stg|ltg|short[- ]term goals?|long[- ]term goals?|hopes?|hoping|hoped|plans?|planned|planning|intends?|intended|expectations?|recommend\w*|advis\w*|advice)\b/;

/** A light stem: "returning" / "returned" → "return", "duties" → "duty", "settled" → "settl", "recovery" stays. */
export function stem(word: string): string {
  let w = word.replace(/['’]s$/, "");
  if (/^\d/.test(w)) return w;
  for (const suf of ["ingly", "edly", "ings", "ing", "ies", "ied", "ed", "es", "s", "ly"]) {
    if (w.length - suf.length >= 3 && w.endsWith(suf)) {
      w = w.slice(0, -suf.length) + (suf === "ies" || suf === "ied" ? "y" : "");
      break;
    }
  }
  if (w.length > 4 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

/** Two stems are the same word: equal, or one is a prefix of the other and the shorter has at least 4 letters. */
export function stemsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return s.length >= 4 && !/^\d/.test(s) && l.startsWith(s);
}

/** Lower-cased names to leave out of a claim's content (clinicians, the patient's title and surname). */
export interface IgnoreNames {
  /** Full names, lower case ("tom ellis"). */
  people: readonly string[];
}

const TITLE_NAME = /\b(?:mr|mrs|ms|miss|mx|dr)\.? [a-z][a-z'’-]+\b/g;
const DATE = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g;

/** Side shorthand in notes, read as the word (content stems only; the text is never rewritten). */
const SIDE: Readonly<Record<string, string>> = { l: "left", lt: "left", r: "right", rt: "right", bilat: "bilateral" };

/** The content stems of normalised text: claim words and figures, in order (duplicates kept once). */
export function contentStems(norm: string, ignore: IgnoreNames = { people: [] }): string[] {
  let s = ` ${norm} `.replace(/\[claimant\]/g, " ").replace(TITLE_NAME, " ").replace(DATE, " ");
  for (const name of ignore.people) if (name) s = s.replace(new RegExp(`\\b${escapeRegExp(name)}(?:['’]s)?\\b`, "g"), " ");
  const out: string[] = [];
  for (const m of Array.from(s.matchAll(/[a-z0-9]+(?:[-'’.][a-z0-9]+)*/g))) {
    const whole = m[0].replace(/[’]/g, "'");
    // A hyphenated word counts by its parts ("full-time" is "full time", "pain-free" is "pain free"); figures stay whole.
    const words = /\d/.test(whole) ? [whole] : whole.split("-");
    for (const raw of words) {
      // A note's side shorthand is the drafted word: "positive FRT L" is "on the left", "SLR 70° R" "on the right".
      const w = SIDE[raw] ?? raw;
      if (STOP.has(w) || (w.length < 3 && !/\d/.test(w))) continue;
      const st = stem(w);
      if (!out.includes(st)) out.push(st);
    }
  }
  return out;
}

/** A conjunct of a claim: its text (normalised) and offsets in the claim. */
export interface Segment {
  text: string;
  start: number;
  end: number;
}

/** Where a claim splits into conjuncts: a comma or semicolon, and / or / but / with / while between words. */
const SEGMENT_SPLIT = /\s*[,;:]\s+|\s+(?:and|or|but|with|while|whereas)\s+/g;

/** A normalised claim's conjunct segments ("working full time on normal duties, driving without restriction and swimming …"). */
export function segmentsOf(norm: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of Array.from(norm.matchAll(SEGMENT_SPLIT))) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: norm.slice(last, at), start: last, end: at });
    last = at + m[0].length;
  }
  if (last < norm.length) out.push({ text: norm.slice(last), start: last, end: norm.length });
  return out.filter((x) => x.text.trim().length > 0);
}

/**
 * Words that carry an opinion – a recovery, prognosis, permanence, cause, fitness, need, advice, modality or a
 * diagnosis – by stem. In an opinion place a segment with one of them must be anchored in a cited note; a segment
 * without one only describes (an incident, a frame, a treatment given) and has no opinion content of its own.
 */
const OPINION_CUES = [
  "recover", "better", "worse", "improv", "deteriorat", "settl", "resolv", "heal", "gone", "asymptomat",
  "prognos", "outlook", "prospect", "expect", "anticipat", "likel", "unlikel", "probabl", "possibl", "predict", "future", "soon",
  "permanen", "lasting", "lifelong", "chronic", "irreversib", "residual", "persist", "forever",
  "caus", "due", "result", "trigger", "attribut", "consistent", "secondary", "relat", "because",
  "fit", "unfit", "abl", "unabl", "capabl", "ready", "return", "resum", "restrict", "limit",
  "need", "requir", "necessar", "recommend", "advis", "suggest", "benefit", "indicat", "warrant",
  "should", "would", "will", "may", "might", "can", "could", "must", "ought",
  "opinion", "view", "believ", "think", "consider", "feel", "diagnos", "impression", "genuin", "exaggerat",
];

/** Whether a normalised text has opinion content (an OPINION_CUES stem, or a modal word). */
export function hasOpinionCue(norm: string): boolean {
  if (/\b(?:should|would|will|may|might|can|could|must|ought|cannot|won't|wouldn't|shouldn't|needs?|needed|requires?|required|(?:un)?able)\b/.test(norm)) return true;
  return contentStems(norm).some((w) => OPINION_CUES.some((c) => w.startsWith(c)));
}

/** Whether `have` holds every stem of `want` (stemsMatch); the ones it lacks. */
export function covers(want: readonly string[], have: readonly string[]): { ok: boolean; missing: string[] } {
  const missing = want.filter((w) => !have.some((h) => stemsMatch(w, h)));
  return { ok: missing.length === 0, missing };
}

/* ------------------------------------------------------------------------------------------------
 * Stance: negation, hedges, goal frames, questions, modal strength
 * ----------------------------------------------------------------------------------------------*/

export interface Stance {
  negated: boolean;
  hedges: string[];
  goal: boolean;
  question: boolean;
  /** 3 assertive (is, has, will, must, can), 2 probable (should, would, expect, likely), 1 possible (may, might, could). */
  modality: number;
}

const POSSIBLE_RE = /\b(?:may|might|could|possibly|possible|perhaps|maybe)\b/;
const PROBABLE_RE = /\b(?:should|would|ought|expect\w*|anticipat\w*|likely|probabl\w*)\b/;

/** The stance of a normalised clause. */
export function stanceOf(norm: string): Stance {
  const hedges = Array.from(new Set(Array.from(norm.matchAll(HEDGE_RE), (m) => m[0]))).sort();
  return {
    negated: NEGATION_RE.test(norm),
    hedges,
    goal: GOAL_RE.test(norm),
    question: /\?/.test(norm),
    modality: POSSIBLE_RE.test(norm) ? 1 : PROBABLE_RE.test(norm) ? 2 : 3,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Frames: whose statement a note sentence makes, and on what condition (check-WB M1, M2)
 * ----------------------------------------------------------------------------------------------*/

/**
 * Words that make a note sentence something other than the clinician asserting it: a belief, feeling, worry or wish
 * ("Pt is worried he will never fully recover", "Wants to return to full duties"), someone's report or question ("GP
 * told him …", "Asked about being back on full duties"), a third party or another person ("Employer wants him to …",
 * "His brother made a full recovery"), a risk to watch or a question to rule out ("Risk of chronic pain", "Monitor
 * for …"), a condition ("when pain allows", "once symptoms settle", "assuming no setbacks"), a refusal ("Employer
 * refused his request …") or an earlier time ("a 2019 back injury", "previously"). Each is [key, words]: a draft keeps
 * a frame when it has a word of the same key.
 */
const FRAMES: ReadonlyArray<readonly [string, string]> = [
  ["worry", "worr(?:y|ies|ied|ying)"],
  ["concern", "concern(?:s|ed|ing)?"],
  ["fear", "fear(?:s|ed|ful|ing)?|afraid|anxious"],
  ["think", "think(?:s|ing)?|thought"],
  ["believe", "believ(?:e|es|ed|ing)|belief"],
  ["feel", "feel(?:s|ing)?|felt"],
  ["perceive", "perceiv(?:e|es|ed)|perception"],
  ["convinced", "convinced|unsure|not sure"],
  ["doubt", "doubts?|doubted"],
  ["wonder", "wonder(?:s|ed|ing)?"],
  ["want", "want(?:s|ed|ing)?"],
  ["wish", "wish(?:es|ed|ing)?"],
  ["keen", "keen|eager"],
  ["like", "would like|'d like|would love"],
  ["hope", "hop(?:e|es|ed|ing|eful|efully)"],
  ["ideally", "ideally|ideal"],
  ["aspire", "aspir(?:e|es|ed|ation|ations)"],
  ["prefer", "prefer(?:s|red|ence)?"],
  ["forward", "looking forward|looks forward"],
  ["tell", "told|tells?|telling"],
  ["say", "says?|said|saying"],
  ["report", "report(?:s|ed|ing)?|self-report(?:s|ed)?"],
  ["state", "states|stated|stating"],
  ["claim", "claim(?:s|ed|ing)?"],
  ["ask", "asks?|asked|asking"],
  ["question", "question(?:s|ed|ing)?"],
  ["request", "request(?:s|ed|ing)?"],
  ["according", "according to|as per"],
  ["gp", "gp|general practitioner|doctor|consultant|surgeon|radiologist"],
  ["solicitor", "solicitors?|lawyers?|insurers?|case manager"],
  ["employer", "employers?|managers?|boss|supervisor|occupational health|oh|hr"],
  ["family", "family|wife|husband|partner|brother|sister|mother|father|son|daughter|friends?|relatives?|parents?|mum|dad|children|child"],
  ["colleague", "colleagues?|chiropractor|osteopath|coach|teammates?"],
  ["risk", "risks?|at risk"],
  ["monitor", "monitor(?:s|ed|ing)?|watch(?:ing)? for|keep an eye on"],
  ["screen", "screen(?:s|ed|ing)? for"],
  ["rule out", "rule out|ruled out|ruling out|r/o|exclude|excluded"],
  ["discuss", "discuss(?:ed|es|ing|ion)?"],
  ["consider", "consider(?:s|ed|ing|ation)?"],
  ["await", "await(?:s|ed|ing)?|pending|waiting for"],
  ["if", "if"],
  ["unless", "unless"],
  ["until", "until|till"],
  ["provided", "provided(?: that)?|providing"],
  ["as long as", "as long as|so long as"],
  ["assume", "assum(?:e|es|ed|ing)"],
  ["depend", "depend(?:s|ent|ing)?"],
  ["subject to", "subject to"],
  ["once", "once"],
  ["whether", "whether"],
  ["when", "when|whenever"],
  ["after", "after"],
  ["refuse", "refus(?:e|es|ed|ing|al)"],
  ["decline", "declin(?:e|es|ed|ing)"],
  ["deny", "den(?:y|ies|ied|ying)"],
  ["reject", "reject(?:s|ed|ing|ion)?"],
  ["previous", "previous(?:ly)?|prior|formerly|former"],
  ["before", "before (?:the |his |her |their )?(?:accident|collision|crash|rta|road traffic accident|incident|injury|fall|lift)"],
  ["pre-injury", "pre-?(?:accident|injury|incident|morbid)"],
  ["history", "history|hx|pmh"],
  ["ago", "ago|last year|years ago"],
  ["earlier", "earlier"],
  ["similar", "similar"],
  ["year", "(?:19|20)\\d\\d"],
];
const FRAME_RES: ReadonlyArray<readonly [string, RegExp]> = FRAMES.map(([k, w]) => [k, new RegExp(`(?<![a-z0-9'/-])(?:${w})(?![a-z0-9'-])`, "g")]);
/** "when" and "after" frame a condition only in a clause with no past tense ("Return to full duties when pain allows"). */
const TIME_FRAMES = new Set(["when", "after"]);
const PAST_TENSE = /\b(?:was|were|had|did)\b|\b(?!(?:expect|anticipat|predict|forecast|plann|advis|recommend|hop|requir|need|indicat|propos|suggest|intend|schedul|book|arrang|agre)ed\b)[a-z]{3,}ed\b/;

/** The frame keys of normalised text (dates "dd/mm/yyyy" are not years). */
export function framesIn(norm: string): string[] {
  const s = norm.replace(DATE, " ");
  const out: string[] = [];
  for (const [key, re] of FRAME_RES) {
    re.lastIndex = 0;
    if (re.test(s)) out.push(key);
  }
  if (PAST_TENSE.test(s)) return out.filter((k) => !TIME_FRAMES.has(k));
  return out;
}

/** The frames of `noteScope` that `draft` does not keep (both normalised). */
export function droppedFrames(noteScope: string, draft: string): string[] {
  const kept = new Set(framesIn(draft));
  return framesIn(noteScope).filter((k) => !kept.has(k));
}

/** A segment that governs its clause from the side: a condition or a report lead ("assuming no setbacks", "according to his GP"). */
const GOVERNING_LEAD = /^(?:if|unless|until|provided|providing|as long as|so long as|assuming|depending|subject to|once|when|whenever|whether|according to|as per|per)\b/;
const FRAME_ANY = new RegExp(FRAMES.map(([, w]) => `(?<![a-z0-9'/-])(?:${w})(?![a-z0-9'-])`).join("|"));
const FRAME_ANY_G = new RegExp(FRAME_ANY.source, "g");
/** Negators and hedges, as words to take out of a segment (stanceOf reads them). */
const STANCE_WORDS = /\b(?:not|no|never|neither|nor|nil|without|cannot|unable|yet|unlikely|likely|doubtful|unclear|uncertain|unknown|possible|possibly|probable|probably|perhaps|maybe|query|queried|questionable|suspected|suspect|potential|potentially|at this stage|too early)\b|n't\b|\?/g;

/**
 * A segment that only modifies its neighbour – a negator, hedge or frame with no claim of its own: "…, probably",
 * "… – not yet", "…, he hopes", "Possibly, …". A segment with its own content ("no neurological signs") is another
 * statement, and its negation is not this one's.
 */
function isModifier(text: string): boolean {
  const rest = text.replace(STANCE_WORDS, " ").replace(FRAME_ANY_G, " ");
  return rest.replace(/\s+/g, " ").trim() !== text.replace(/\s+/g, " ").trim() && contentStems(rest).length === 0;
}

/**
 * The part of a note sentence that says [start, end), and so whose stance and frames are its own: the clause's conjunct
 * segments the span touches, the segments of the clause that govern it from the side (a lead condition or report –
 * "Assuming no setbacks, …"; a modifier – "…, probably", "… – not yet", "…, he hopes"), and the sentence's inline label
 * ("Solicitor asks for an opinion: …") – with `exclude` (a quotation's own words) left out. Another conjunct with its own
 * content ("…, no neurological signs") is not part of it.
 */
export function frameScope(s: Pick<NoteSentence, "norm" | "label">, start: number, end: number, exclude?: { start: number; end: number }): string {
  const norm = s.norm;
  let a = start;
  while (a > 0 && !/[;:.!?]/.test(norm.charAt(a - 1))) a -= 1;
  let b = end;
  while (b < norm.length && !/[;.!?]/.test(norm.charAt(b))) b += 1;
  const clause = norm.slice(a, b);
  const parts: string[] = [];
  for (const g of segmentsOf(clause)) {
    const gs = a + g.start;
    const ge = a + g.end;
    const text = g.text.trim();
    if (gs < end && start < ge) parts.push(exclude ? `${norm.slice(gs, Math.max(gs, exclude.start))} ${norm.slice(Math.min(ge, exclude.end), ge)}` : norm.slice(gs, ge));
    else if (ge <= start && (GOVERNING_LEAD.test(text) || isModifier(text))) parts.push(text);
    else if (gs >= end && (GOVERNING_LEAD.test(text) || isModifier(text))) parts.push(text);
  }
  if (s.label && a > 0 && norm.slice(0, a).replace(/[\s:]+$/, "").endsWith(s.label)) parts.push(s.label);
  return parts.join(" ; ");
}

/* ------------------------------------------------------------------------------------------------
 * Segment stems (bounded work on hostile text – check-WB M6)
 * ----------------------------------------------------------------------------------------------*/

/** At most this many conjunct segments make one claim or one note window (a longer run is never one statement). */
export const MAX_WINDOW_SEGMENTS = 12;
/** A drafted claim with more conjunct segments than this is not anchored segment by segment (it blocks in an opinion place). */
export const MAX_CLAIM_SEGMENTS = 40;

const segmentCache = new Map<string, { segs: Segment[]; stems: string[][] }>();

/** A normalised text's segments and each one's content stems (remembered for the last few hundred texts). */
export function segmentStems(norm: string, ignore?: IgnoreNames): { segs: Segment[]; stems: string[][] } {
  const key = `${(ignore?.people ?? []).join("|")}\u0000${norm}`;
  const hit = segmentCache.get(key);
  if (hit) return hit;
  const segs = segmentsOf(norm);
  const out = { segs, stems: segs.map((g) => contentStems(g.text, ignore)) };
  if (segmentCache.size >= 512) segmentCache.clear();
  segmentCache.set(key, out);
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Notes, sentence by sentence
 * ----------------------------------------------------------------------------------------------*/

export type NoteField = "subjective" | "objective" | "assessment" | "plan" | "other" | "history";

export interface NoteSentence {
  noteId: string;
  author: Clinician;
  date: string;
  type: Note["type"];
  field: NoteField;
  /** The inline label before a colon, normalised ("goal", "stg", "opinion on work"), or null. */
  label: string | null;
  /** The sentence as written (shorthand left as the note has it). */
  text: string;
  /** normaliseForMatch() of the sentence with its shorthand written out (expandNoteShorthand). */
  norm: string;
  /** Content stems (label words included). */
  stems: string[];
  /** A goal, aim, plan, target, STG or LTG label. */
  goalLabel: boolean;
  /** A question ("Permanent?"). */
  question: boolean;
}

const FIELDS: ReadonlyArray<[NoteField, (n: Note) => string | undefined]> = [
  ["subjective", (n) => n.subjective],
  ["objective", (n) => n.objective],
  ["assessment", (n) => n.assessment],
  ["plan", (n) => n.plan],
  ["other", (n) => n.freeText],
  ["history", (n) => n.pastMedicalHistory],
  ["history", (n) => n.socialHistory],
];

const GOAL_LABEL = /^(?:goals?|aims?|targets?|objectives?|stg|ltg|short[- ]term goals?|long[- ]term goals?|plan|plans|hopes?|expectations?|rtw plan|return to work plan)$/;
const noteCache = new WeakMap<Note, NoteSentence[]>();

/** Every sentence of a note (cached per note object). */
export function noteSentences(note: Note): readonly NoteSentence[] {
  const hit = noteCache.get(note);
  if (hit) return hit;
  const out: NoteSentence[] = [];
  for (const [field, get] of FIELDS) {
    const value = get(note);
    if (!value || !value.trim()) continue;
    for (const span of splitSentences(value, "notes")) {
      const text = span.text;
      const norm = normaliseForMatch(expandNoteShorthand(text));
      const lab = /^([a-z][a-z /-]{0,30}?):\s/.exec(norm);
      const label = lab ? lab[1].trim() : null;
      out.push({
        noteId: note.id,
        author: note.author,
        date: note.date,
        type: note.type,
        field,
        label,
        text,
        norm,
        stems: contentStems(norm),
        goalLabel: label !== null && GOAL_LABEL.test(label),
        question: /\?/.test(norm),
      });
    }
  }
  noteCache.set(note, out);
  return out;
}

/** The index of `phrase` in `text` as whole words, or -1. */
export function wordIndexOf(text: string, phrase: string, from = 0): number {
  if (!phrase) return -1;
  let i = text.indexOf(phrase, from);
  while (i >= 0) {
    const before = i === 0 ? " " : text.charAt(i - 1);
    const after = text.charAt(i + phrase.length) || " ";
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return i;
    i = text.indexOf(phrase, i + 1);
  }
  return -1;
}

/** The clause of `norm` around [start, end): back to and up to the nearest ; : or sentence end (commas kept). */
export function clauseAround(norm: string, start: number, end: number): string {
  let a = start;
  while (a > 0 && !/[;:.!?]/.test(norm.charAt(a - 1))) a -= 1;
  let b = end;
  while (b < norm.length && !/[;.!]/.test(norm.charAt(b))) b += 1;
  return norm.slice(a, b + (norm.charAt(b) === "?" ? 1 : 0)).trim();
}

/**
 * What a drafted sentence says around a quotation at [start, end) of its normalised text: the rest of the conjunct
 * segments of the quotation's own clause that the quotation touches ("he was not “fit for full duties”" → "he was
 * not"), never another conjunct ("there were no red flags and the pain was “…”") or a clause before a ";" or ":" – a
 * framed quotation's frame ("Tom Ellis recorded on 06/05/2026:") says nothing about it.
 */
export function quoteOutside(norm: string, start: number, end: number): string {
  let a = start;
  while (a > 0 && !/[;:.!?]/.test(norm.charAt(a - 1))) a -= 1;
  let b = end;
  while (b < norm.length && !/[;.!?]/.test(norm.charAt(b))) b += 1;
  const clause = norm.slice(a, b);
  const parts: string[] = [];
  for (const g of segmentsOf(clause)) {
    const gs = a + g.start;
    const ge = a + g.end;
    if (gs < end && start < ge) parts.push(`${norm.slice(gs, Math.max(gs, start))} ${norm.slice(Math.min(ge, end), ge)}`);
  }
  return parts.join(" ").replace(/["“”]/g, " ").replace(/\s+/g, " ").trim();
}

/* ------------------------------------------------------------------------------------------------
 * People
 * ----------------------------------------------------------------------------------------------*/

/** The clinicians a text may name: the bundle's clinicians and the authors of its notes. */
export function clinicianNames(bundle: { clinicians?: readonly Clinician[]; notes: readonly Note[] }): string[] {
  const names = new Set<string>();
  for (const c of bundle.clinicians ?? []) if (c.name.trim()) names.add(c.name.trim());
  for (const n of bundle.notes) if (n.author.name.trim()) names.add(n.author.name.trim());
  return Array.from(names).sort((a, b) => b.length - a.length);
}

const normName = (s: string) => s.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

/** The same person by name (case and spacing ignored). */
export function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b) && normName(a as string) === normName(b as string);
}

/** "Sarah Reid" → "sr" (the initials a note writes, "covering SR AL"). */
export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0))
    .join("")
    .toLowerCase();
}

/** Whether a note's text mentions `name`: in full, as title and surname, or by initials ("SR"). */
export function noteMentions(note: Note, name: string): boolean {
  const all = [note.subjective, note.objective, note.assessment, note.plan, note.freeText ?? ""].join("\n");
  const n = name.trim();
  if (!n) return false;
  if (new RegExp(`\\b${escapeRegExp(n).replace(/ /g, "\\s+")}\\b`, "i").test(all)) return true;
  const surname = n.split(/\s+/).pop() ?? "";
  if (surname.length > 1 && new RegExp(`\\b(?:Dr|Mr|Mrs|Ms|Miss|Mx)\\.? ${escapeRegExp(surname)}\\b`).test(all)) return true;
  const ini = initialsOf(n).toUpperCase();
  return ini.length >= 2 && new RegExp(`(?<![A-Za-z])${escapeRegExp(ini)}(?![A-Za-z])`).test(all);
}

/* ------------------------------------------------------------------------------------------------
 * Drafted sentences: frame, holder, quotation, clauses
 * ----------------------------------------------------------------------------------------------*/

/** Whose opinion a drafted sentence says it gives. */
export type Holder = { kind: "owner" } | { kind: "named"; name: string };

export interface DraftQuote {
  /** The quoted words as written. */
  text: string;
  /** normaliseForMatch() of the quoted words with shorthand written out. */
  norm: string;
}

export interface DraftSentence {
  /** The sentence as written. */
  text: string;
  /** Its offsets in the paragraph. */
  start: number;
  end: number;
  /** normaliseForMatch() of the sentence. */
  norm: string;
  /** Whose words or opinion it says it gives, from its frame; null when it names none. */
  holder: Holder | null;
  /** The clinician the frame names as the one who recorded, noted or holds it (also for "<Name> recorded that…"). */
  framedBy: string | null;
  /** A framed quotation: "<Name> recorded on <date>: “…”" – the quoted words. */
  quote: DraftQuote | null;
  /** The claim after the frame (normalised), and its clauses. */
  claim: string;
  clauses: string[];
}

const UK_DATE_N = "\\d{2}/\\d{2}/\\d{4}";
const FRAME_VERBS = "recorded|noted|documented|wrote|stated|reported|observed|found|measured|assessed|examined|described|explained|advised|recommended|discharged|treated";
/**
 * Where the clinician recorded it, or as what, after the frame verb: "recorded in his assessment that", "recorded in the
 * discharge note that", "recorded under opinion on work:", "recorded an assessment that", "recorded her assessment as".
 */
const RECORD_WHERE =
  "(?: (?:in|under) (?:his|her|their|my|the|an?|that|this) (?:[a-z-]+ ){0,3}?(?:assessment|note|notes|review|record|letter|opinion on work|plan)(?: of \\d{2}/\\d{2}/\\d{4})?:?| under [a-z ]{2,30}?:| (?:an?|his|her|their|the|my) (?:clinical |initial |working )?(?:assessment|impression|diagnosis|opinion|view|findings?)(?: (?:that|of|as))?)?";

function namesAlt(people: readonly string[]): string {
  return people.length ? people.map((p) => escapeRegExp(p.toLowerCase()).replace(/ /g, "\\s+")).join("|") : "(?!x)x";
}

/** Clause boundaries inside a claim: ; and the conjunctions that start a new clause. */
const CLAUSE_SPLIT = /\s*;\s*|,\s+(?=(?:and|but|so|while|whereas|although|though|because|as|since|which|when)\b)|\s+(?=(?:and|but)\s+(?:he|she|they|his|her|their|i|we|it|the)\b)|\s+(?=(?:because|although|whereas|while)\b)/;

/**
 * Parse one drafted sentence: its frame, holder, quotation and claim. `people` are the clinicians' full names (any case).
 */
export function parseDraftSentence(text: string, people: readonly string[]): Omit<DraftSentence, "start" | "end"> {
  const norm = normaliseForMatch(text);
  const NAMES = namesAlt(people);
  let rest = norm;
  let holder: Holder | null = null;
  let framedBy: string | null = null;
  let quote: DraftQuote | null = null;
  const nameOf = (lower: string) => people.find((p) => p.toLowerCase().replace(/\s+/g, " ") === lower.replace(/\s+/g, " ")) ?? lower;

  // A framed quotation: "<Name> recorded on 06/05/2026: “…”" / "On 06/05/2026 <Name> recorded: “…”".
  const qm = new RegExp(`^(?:on ${UK_DATE_N},? )?(${NAMES})(?:, [a-z ,-]{2,60}?,)? (?:recorded|noted|wrote|documented|stated)(?: on ${UK_DATE_N})?:? ["“]([^"”]+)["”]\\.?$`).exec(norm);
  if (qm) {
    framedBy = nameOf(qm[1]);
    holder = { kind: "named", name: framedBy };
    const raw = /["“]([^"”]+)["”]/.exec(text)?.[1] ?? qm[2];
    quote = { text: raw, norm: normaliseForMatch(expandNoteShorthand(raw)) };
    return { text, norm, holder, framedBy, quote, claim: "", clauses: [] };
  }
  // The note as the subject: "The same note contained …", "That note recorded that …" – a frame, not a claim.
  rest = rest.replace(new RegExp(`^(?:the|that|this|his|her|their) (?:same )?(?:[a-z-]+ )?(?:note|notes|record|assessment)(?: of ${UK_DATE_N})? (?:also )?(?:contained|recorded|included|gave|stated|said|noted)(?: that)?,? `), "");
  // A lead date or occasion: "On 06/05/2026", "At the review on 06/05/2026,", "At discharge,", "At that appointment".
  rest = rest.replace(new RegExp(`^(?:on ${UK_DATE_N}|at (?:the |my |his |her |their |this |that )?(?:[a-z-]+ ){0,2}?(?:assessment|review|appointment|session|visit|consultation|discharge)(?: on ${UK_DATE_N})?),? `), "");
  // "<Name>'s assessment (01/09/2026): …" / "My assessment: …".
  let m = new RegExp(`^(${NAMES}|my)['’]?s? (?:clinical |professional |initial |discharge )?(?:assessment|opinion|view|impression|diagnosis|findings?|examination|note|expectation)(?: \\(${UK_DATE_N}\\))?: `).exec(rest);
  if (m) {
    if (m[1] === "my") holder = { kind: "owner" };
    else {
      framedBy = nameOf(m[1]);
      holder = { kind: "named", name: framedBy };
    }
    rest = rest.slice(m[0].length);
  } else if ((m = new RegExp(`^(${NAMES}|my)['’]?s? (?:clinical |professional )?(?:opinion|view|assessment|impression|expectation) (?:is|was) that,? `).exec(rest))) {
    // "<Name>'s opinion is that …" / "My opinion is that …".
    if (m[1] === "my") holder = { kind: "owner" };
    else {
      framedBy = nameOf(m[1]);
      holder = { kind: "named", name: framedBy };
    }
    rest = rest.slice(m[0].length);
  } else if ((m = new RegExp(`^(?:in (?:his|her|their|my) (?:clinical |initial |discharge )?(?:assessment|opinion|view|notes?|review),? )?(${NAMES}|i)(?:, [a-z ,-]{2,60}?,)? (?:also |then |later |again )?(${FRAME_VERBS})${RECORD_WHERE}(?: that)?,? `).exec(rest))) {
    // "<Name>, physiotherapist, recorded that …" / "I recorded that …".
    if (m[1] === "i") holder = { kind: "owner" };
    else {
      framedBy = nameOf(m[1]);
      holder = { kind: "named", name: framedBy };
    }
    rest = rest.slice(m[0].length);
    // "… recorded that, in his opinion, …"
    const inHis = /^,?\s*in (?:his|her|their|my) (?:clinical |professional )?(?:opinion|view),? /.exec(rest);
    if (inHis) rest = rest.slice(inHis[0].length);
  }
  // "He also recorded that …", "She recorded advice to …": the clinician named before (the frame, not the claim).
  if (!framedBy) {
    const pr = new RegExp(`^(?:he|she|they) (?:also |then |later |again )?(${FRAME_VERBS})${RECORD_WHERE}(?: that)?,? `).exec(rest);
    if (pr) rest = rest.slice(pr[0].length);
  }
  // "In my opinion …" / "In Tom Ellis's opinion …" (at the start of the claim).
  const op = new RegExp(`^,?\\s*in (my|${NAMES})(?:['’]s)? (?:clinical |professional )?(?:opinion|view),? `).exec(rest);
  if (op) {
    if (op[1] === "my") holder = holder ?? { kind: "owner" };
    else {
      framedBy = framedBy ?? nameOf(op[1]);
      holder = { kind: "named", name: nameOf(op[1]) };
    }
    rest = rest.slice(op[0].length);
  }
  // First-person opinion verbs at the claim's start: "I expect…", "I would recommend…".
  if (!holder && /^i (?:also |would |do |still )?(?:expect|think|believe|feel|recommend|anticipate|consider|suspect|predict|estimate|advise)\b/.test(rest)) holder = { kind: "owner" };
  // A short attribution at the end: "… (Tom Ellis, 06/05/2026)." / "…, as Tom Ellis recorded on 06/05/2026."
  const tail = new RegExp(`(?:\\s*\\((${NAMES})(?:, ${UK_DATE_N})?\\)|,? (?:as )?(?:recorded|assessed|noted|documented) by (${NAMES})(?: on ${UK_DATE_N})?|,? as (${NAMES}) (?:recorded|noted|documented)(?: on ${UK_DATE_N})?)\\.?$`).exec(rest);
  if (tail) {
    const who = nameOf(tail[1] ?? tail[2] ?? tail[3]);
    framedBy = framedBy ?? who;
    holder = holder ?? { kind: "named", name: who };
    rest = rest.slice(0, tail.index);
  }
  const claim = rest.replace(/[.!]+$/, "").trim();
  const clauses = claim
    .split(CLAUSE_SPLIT)
    .map((c) => c.replace(/^(?:and|but|so|while|whereas|although|though|because|as|since|which|when)\s+/, "").trim())
    .filter((c) => c.length > 0);
  return { text, norm, holder, framedBy, quote, claim, clauses };
}

/**
 * The holder in force at `index` of a normalised drafted sentence: the last attribution frame that starts at or before
 * it – "in Tom Ellis's opinion", "Tom Ellis recorded that", "Tom Ellis's opinion is that", "I recorded that", "in my
 * opinion", "my opinion is that" – so a frame after a semicolon ("…; in Tom Ellis's opinion he will need …") governs
 * what follows it; else `fallback` (the sentence's own frame).
 */
export function holderAt(norm: string, index: number, people: readonly string[], fallback: Holder | null): Holder | null {
  const NAMES = namesAlt(people);
  const nameOf = (lower: string) => people.find((p) => p.toLowerCase().replace(/\s+/g, " ") === lower.replace(/\s+/g, " ")) ?? lower;
  const re = new RegExp(`\\b(?:in (my|${NAMES})(?:['’]s)? (?:clinical |professional )?(?:opinion|view)|(my|${NAMES})['’]?s? (?:clinical |professional )?(?:opinion|view|assessment|impression) (?:is|was) that|(i|${NAMES})(?:, [a-z ,-]{2,60}?,)? (?:also |then |later |again )?(?:recorded|noted|documented|wrote|stated|assessed|found|advised|recommended)${RECORD_WHERE} that)\\b`, "g");
  let found: Holder | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm)) !== null) {
    if (m.index > index) break;
    const who = m[1] ?? m[2] ?? m[3];
    found = who === "my" || who === "i" ? { kind: "owner" } : { kind: "named", name: nameOf(who) };
  }
  return found ?? fallback;
}

/** Every sentence of a drafted paragraph, parsed (the W0 tokenizer, "prose" policy). */
export function draftSentences(text: string, people: readonly string[]): DraftSentence[] {
  return splitSentences(text, "prose").map((s) => ({ ...parseDraftSentence(s.text, people), start: s.start, end: s.end }));
}

/* ------------------------------------------------------------------------------------------------
 * A small synchronous SHA-256 (for Section.accepted sentenceSha – validators and reducers are synchronous)
 * ----------------------------------------------------------------------------------------------*/

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 of a string's UTF-8 bytes, as lower-case hex (the same value WebCrypto gives). */
export function sha256HexSync(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bitLen >>> 0);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, "0")).join("");
}
