/**
 * DRAFT_FIT part "repeat" (B0-16, B2-7; bh2 WD design 7): drafted wording that repeats what another box already says.
 *
 * Advisory: a warning on the later box ("This repeats what “History of the incident” says in this report"), never a
 * block – except an identical name cell in numbered rows ("Activity 2" = "Activity 1" = "Running"), which blocks and
 * may be acknowledged with a reason (ackPolicy "member").
 *
 * How two sentences are compared (the shared tokenizer, core/text/sentences.ts – never a split inside "8.0"):
 * - the words: only alphabetic content words count – no figures, dates, units, frequency words, names, titles, or the
 *   reporting frame ("On 18/03/2026 Sarah Reid, physiotherapist, recorded that …" against "Mr Testcase reported that …"
 *   is a repeat, B3-11 (b)); the shorter sentence has at least 5 words and 3 content words, and at least 0.8 of its
 *   content words are in the other sentence;
 * - the figures (bh2 WD review M1): two sentences that say different figures are never a repeat – "flexion limited by
 *   50%" and "flexion limited by 10%", pain "7/10" and "2/10", "2–3 times a week" and "3–4 times a week" (B3-11) each
 *   report a different measurement. The figures other than dates of one sentence must all be in the other (as a
 *   multiset: "PSFS 2.7" is repeated inside "PSFS from 2.7 to 5.3", never by "PSFS 5.3"); when both sentences are
 *   dated, they must share a date (two dated observations of the same finding are two time points). Which of the two
 *   may be removed is the one-click engine's rule: only a sentence whose every figure and date its twin also says;
 * - the finding (bh2 WD harden N1): two sentences with different negations ("not painful" / "painful"), a contrary
 *   side, severity, pattern, direction or result word ("left" / "right", "constant" / "occasional", "better" /
 *   "worse", "full" / "limited") or different time points ("At the first assessment …" / "At discharge … still …")
 *   report two findings, never a repeat (sameFinding) – and a removal needs exactly the same markers and every content
 *   word of the removed sentence in its twin (removableRepeat);
 * - never across an initial / current / now / at-discharge pair of questions (R-regression-4, AC-DRF-6) – the two
 *   labels name different time points and otherwise ask the same thing ("Which symptoms were there on the first
 *   visit?" / "Which symptoms are there today?", "Sleep quality on presentation" / "Sleep quality on discharge"); never between
 *   the columns of numbered rows ("Session 1 – date", "Session 2 – date"), never between compact values (a cell's
 *   value is not a sentence).
 * Messages name the other box by its printed label, and say "in this report" on a built-in report (R-regression-7).
 *
 * The one-click "Remove the repeated sentence" (ui/components/review/fixes.ts, generator "repeat-removal") is built
 * from repeatedSentences() – each with the earlier sentence it repeats (its twin) – and offered only when the engine's
 * rules hold (whole sentences; the twin still prints and says every figure and date the removed sentence says; never
 * the box's only answering sentence; never a sentence left without the clinician or date it relied on – B3-2, B3-5,
 * R-regression-3).
 *
 * Owner: WD (drafting and text edits) – docs/bh2-ownership.json.
 */
import { compactPlace } from "../../forms/answer-shape";
import { figuresOf, splitSentences, sentenceKey, type SentenceSpan } from "../../text/sentences";
import { defineHook } from "../hooks";
import type { EpisodeBundle, FormDefinition, Paragraph, ReportFlag, ReportSection } from "../../types";
import { makeFlag } from "../context";
import type { DraftFitPart } from "../draft-fit";
import type { ValidatorInput } from "../registry";

/**
 * Ledger hook "repeat-removal" (one-click, ledger.json): the one-click "Remove the repeated sentence" built from
 * repeatedSentences(). Registered here (loaded with the validators); ui/components/review/fixes.ts offers the fix only
 * while hookEnabled(REPEAT_REMOVAL_HOOK).
 */
export const REPEAT_REMOVAL_HOOK = defineHook("repeat-removal");

const STOPWORDS = new Set(
  (
    "a an the and or but nor so yet of to in on at for with by from into onto upon over under about after before since until than then also as " +
    "is are was were be been being am has have had having do does did done will would shall should can could may might must " +
    "he she they it we you i him her them us me his hers its their theirs our ours my mine your yours this that these those there here " +
    "who whom whose which what when where why how all any both each either neither every some such same other another more most less " +
    "very just only still even again further once up down out off own too if while during per via etc mr mrs ms mx dr miss prof"
  ).split(/\s+/),
);
/** The reporting frame: who said or recorded it, and their job title – not what was said. */
const FRAME = new Set(
  (
    "recorded records record reported reports report told tells tell stated states state described describes describe documented documents " +
    "noted notes observed observes said says explained explains confirmed confirms mentioned mentions advised advises found finds assessed assesses " +
    "physiotherapist physiotherapists physio senior extended scope clinical specialist mcsp clinician clinicians therapist"
  ).split(/\s+/),
);
/** Units, frequency and time words: two different values share them ("2–3 times a week", "3–4 times a week"). */
const MEASURE = new Set(
  (
    "times time daily weekly monthly fortnightly nightly hourly day days week weeks wk wks month months year years yr yrs hour hours hr hrs " +
    "minute minutes min mins second seconds km kg cm mm m g mg ml percent per cent degrees x twice once thrice"
  ).split(/\s+/),
);

/** Words of the people in the record (clinicians, the patient): names are not what a sentence says. */
export function nameWords(bundle: Pick<EpisodeBundle, "clinicians" | "notes" | "registration"> | undefined): Set<string> {
  const out = new Set<string>();
  const add = (s: string | undefined) => {
    for (const w of (s ?? "").toLowerCase().match(/[a-z]+/g) ?? []) if (w.length > 1) out.add(w);
  };
  if (!bundle) return out;
  for (const c of bundle.clinicians ?? []) add(c.name);
  for (const n of bundle.notes ?? []) add(n.author?.name);
  add(bundle.registration?.firstName);
  add(bundle.registration?.lastName);
  add(bundle.registration?.fullName);
  return out;
}

/** The alphabetic words of a sentence. */
export function alphaWords(sentence: string): string[] {
  return sentence.toLowerCase().match(/[a-z]+(?:['’][a-z]+)?/g) ?? [];
}

/** The content words of a sentence (see the header). */
export function contentWords(sentence: string, names: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const raw of alphaWords(sentence)) {
    const w = raw.replace(/['’]s$/, "");
    if (w.length < 2 || STOPWORDS.has(w) || FRAME.has(w) || MEASURE.has(w) || names.has(w)) continue;
    out.add(w);
  }
  return out;
}

/** A figure that is a date ("06/05/2026", "6.5.26", "2026-05-06"). */
const DATE_FIGURE = /^(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})$/;

/** The figures of a sentence, split into its dates and its other figures (measurements, scores, counts). */
export function figuresByKind(sentence: string): { dates: string[]; values: string[] } {
  const all = figuresOf(sentence);
  return { dates: all.filter((f) => DATE_FIGURE.test(f)), values: all.filter((f) => !DATE_FIGURE.test(f)).sort() };
}

/** A multiset of strings, as counts. */
function countsOf(items: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const x of items) out.set(x, (out.get(x) ?? 0) + 1);
  return out;
}

/** Whether every item of `a` is in `b` (multisets, as counts). Linear in the items of `a`. */
function within(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  return Array.from(a.entries()).every(([x, n]) => (b.get(x) ?? 0) >= n);
}

/** Whether two sets share an item. Linear in the smaller one. */
function intersects(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  return Array.from(small).some((x) => large.has(x));
}

/** The figures of a sentence as the repeat rules compare them: its dates (a set) and its other figures (counts). */
interface FigureFacts {
  readonly dates: ReadonlySet<string>;
  readonly values: ReadonlyMap<string, number>;
}

function figureFactsOf(sentence: string): FigureFacts {
  const { dates, values } = figuresByKind(sentence);
  return { dates: new Set(dates), values: countsOf(values) };
}

function sameFigureFacts(x: FigureFacts, y: FigureFacts): boolean {
  if (!within(x.values, y.values) && !within(y.values, x.values)) return false;
  if (x.dates.size > 0 && y.dates.size > 0 && !intersects(x.dates, y.dates)) return false;
  return true;
}

/**
 * Whether two sentences can report the same thing by their figures (see the header): the figures other than dates of
 * one all in the other, and – when both are dated – a date in common.
 */
export function sameFigures(a: string, b: string): boolean {
  return sameFigureFacts(figureFactsOf(a), figureFactsOf(b));
}

/**
 * Words that make one finding a different finding though every other word is shared (bh2 WD harden N1), by kind: the
 * side ("left knee" / "right knee"), a severity, a pattern ("constant" / "occasional"), a direction of change
 * ("better" / "worse"), a result ("positive" / "negative", "full" / "limited"), a count ("two" / "three"). Two
 * sentences with contrary ones are never a repeat (sameFinding).
 */
const CONTRAST_KINDS: Readonly<Record<string, string>> = Object.fromEntries(
  (
    [
      ["side", "left right bilateral bilaterally unilateral"],
      ["severity", "mild mildly moderate moderately severe severely slight slightly marked markedly significant significantly minimal minor major extreme"],
      ["pattern", "constant constantly intermittent intermittently occasional occasionally persistent persistently frequent frequently rare rarely sometimes always episodic regular regularly"],
      ["direction", "better worse improved improving improvement worsened worsening deteriorated deteriorating unchanged increased increasing decreased decreasing reduced reducing resolved resolving settled settling eased easing aggravated aggravating exacerbated flared"],
      ["count", "one two three four five six seven eight nine ten eleven twelve once twice thrice half quarter"],
      ["result", "positive negative normal abnormal full partial partially limited restricted"],
    ] as const
  ).flatMap(([kind, list]) => list.split(" ").map((w) => [w, kind] as const)),
);

/**
 * Time-point words in a sentence (bh2 WD harden N1): "At the first assessment, lumbar flexion was limited by 50%" and
 * "At discharge, lumbar flexion was still limited by 50%" report two time points, never a repeat. Each is read as its
 * time point ("initially" → initial, "discharged" → discharge).
 */
const SENTENCE_TIME: Readonly<Record<string, string>> = {
  first: "first", initial: "initial", initially: "initial", baseline: "initial", outset: "initial", onset: "onset", presentation: "presentation", presenting: "presentation",
  admission: "admission", referral: "referral", pre: "pre", preinjury: "pre", originally: "original", original: "original", previously: "previous", previous: "previous",
  earlier: "previous", discharge: "discharge", discharged: "discharge", now: "now", current: "now", currently: "now", today: "now", presently: "now", latest: "latest",
  final: "final", finally: "final", still: "still", recently: "recent", since: "since", anymore: "anymore", longer: "longer",
};

/**
 * Time words that place a sentence loosely ("previous", "since", "recently"): a removal needs them in both sentences,
 * but the advice does not treat them as a time point of their own.
 */
const LOOSE_TIME = new Set(["previous", "original", "recent", "since", "anymore", "longer"]);

/** The contrast words of a sentence by kind, and its time points – its time words and its dates (see above). */
function markersOf(sentence: string): { contrast: Map<string, Set<string>>; time: Set<string> } {
  const contrast = new Map<string, Set<string>>();
  const time = new Set<string>();
  const add = (kind: string, w: string) => {
    const words = contrast.get(kind);
    if (words) words.add(w);
    else contrast.set(kind, new Set([w]));
  };
  for (const w of alphaWords(sentence)) {
    const kind = CONTRAST_KINDS[w];
    if (kind) add(kind, w);
    const t = SENTENCE_TIME[w];
    if (t) time.add(t);
  }
  // The side written short ("L knee", "R) shoulder", "Lt hip") – never a spinal level ("L4/5", "S1").
  for (const m of Array.from(sentence.matchAll(/\b(L|R|Lt|Rt|LHS|RHS)\b(?![\d/])/g))) add("side", /^L/.test(m[1]) ? "left" : "right");
  for (const d of figuresByKind(sentence).dates) time.add(d);
  return { contrast, time };
}

const sameSet = (a: ReadonlySet<string> | undefined, b: ReadonlySet<string> | undefined): boolean => {
  const x = a ?? new Set<string>();
  const y = b ?? new Set<string>();
  return x.size === y.size && Array.from(x).every((w) => y.has(w));
};

/** "pain-free", "symptom free" read as the negatives they are ("no pain", "no symptom"). */
const withoutFree = (sentence: string): string => sentence.replace(/\b([A-Za-z]+)[- ]free\b/g, "no $1");

/** Words a negation looks past to what it negates ("no longer painful", "not yet able"). */
const NEGATION_FILLER = new Set(["longer", "yet", "really", "very", "fully", "quite"]);
/** The negation words, as single tokens. */
const NEGATION_WORDS = new Set(
  "no not nil none never nothing neither nor without denies denied deny absent unremarkable unable cannot can't isn't wasn't weren't aren't doesn't didn't don't hasn't haven't hadn't won't couldn't wouldn't shouldn't".split(" "),
);

/**
 * What a sentence negates and what it asserts (bh2 WD harden N1). After each negation, the next two content words of
 * the same clause are negated – "lumbar flexion was not painful" → painful; "no saddle numbness, bladder normal" →
 * saddle, numbness; "full, pain-free range" → pain. A word is asserted when it also appears outside any negation
 * ("Numeric Pain Rating Scale … no pain" asserts and negates "pain").
 */
function polarityOf(sentence: string, names: ReadonlySet<string>): { negated: Set<string>; asserted: Set<string> } {
  const negated = new Set<string>();
  const total = new Map<string, number>();
  const inNegation = new Map<string, number>();
  const bump = (m: Map<string, number>, w: string) => m.set(w, (m.get(w) ?? 0) + 1);
  for (const clause of withoutFree(sentence).split(/[,;:()\u2013\u2014]|\s-\s|\band\b|\bbut\b/i)) {
    const tokens = clause.toLowerCase().match(/[a-z]+(?:['’][a-z]+)?/g) ?? [];
    const content = tokens.map((t) => Array.from(contentWords(t, names))[0] ?? null);
    content.forEach((c) => c && bump(total, c));
    // nextTaken[j]: the first position at or after j that a negation takes – a content word that is not filler (bh2
    // R1T-WD-01: one table per clause, so a run of negations costs linear time, never a scan from each one).
    const nextTaken = new Int32Array(tokens.length + 1);
    nextTaken[tokens.length] = tokens.length;
    for (let j = tokens.length - 1; j >= 0; j--) nextTaken[j] = !NEGATION_FILLER.has(tokens[j]) && content[j] ? j : nextTaken[j + 1];
    tokens.forEach((t, i) => {
      if (!NEGATION_WORDS.has(t.replace("’", "'"))) return;
      for (let j = nextTaken[i + 1], taken = 0; j < tokens.length && taken < 2; j = nextTaken[j + 1], taken++) {
        const c = content[j]!;
        negated.add(c);
        bump(inNegation, c);
      }
    });
  }
  const asserted = new Set<string>();
  total.forEach((n, w) => {
    if (n > (inNegation.get(w) ?? 0)) asserted.add(w);
  });
  return { negated, asserted };
}

/** The words a sentence negates (see polarityOf). */
export function negatedWords(sentence: string, names: ReadonlySet<string> = new Set()): Set<string> {
  return polarityOf(sentence, names).negated;
}

/**
 * Whether one sentence denies what the other asserts (bh2 WD harden N1): a word one only negates that the other only
 * asserts – "lumbar flexion was not painful" / "lumbar flexion was painful", "no pain at rest" / "pain at rest". A
 * longer sentence that adds its own negatives ("…, with no restrictions, and no headaches") does not.
 */
export function polarityConflict(a: string, b: string, names: ReadonlySet<string> = new Set()): boolean {
  return polarityConflictOf(polarityOf(a, names), polarityOf(b, names));
}

interface Polarity {
  readonly negated: ReadonlySet<string>;
  readonly asserted: ReadonlySet<string>;
}

function polarityConflictOf(x: Polarity, y: Polarity): boolean {
  const denies = (p: Polarity, q: Polarity) => Array.from(p.negated).some((w) => !p.asserted.has(w) && q.asserted.has(w) && !q.negated.has(w));
  return denies(x, y) || denies(y, x);
}

const subset = (a: ReadonlySet<string>, b: ReadonlySet<string>) => Array.from(a).every((w) => b.has(w));

/**
 * What the repeat rules read from one sentence, worked out once per sentence (bh2 R1T-WD-01, SEC-1: the rules used to
 * re-read every sentence, and re-split every earlier paragraph, for each pair compared – 13 s for 96 KB).
 */
export interface SentenceFacts {
  readonly text: string;
  /** How many alphabetic words it has (alphaWords). */
  readonly words: number;
  readonly content: ReadonlySet<string>;
  readonly figures: FigureFacts;
  readonly contrast: ReadonlyMap<string, ReadonlySet<string>>;
  /** Its time points (time words and dates), and the same without the loose time words (LOOSE_TIME). */
  readonly time: ReadonlySet<string>;
  readonly firmTime: ReadonlySet<string>;
  readonly polarity: Polarity;
}

/** The facts of a sentence (see SentenceFacts). Linear in its length. */
export function sentenceFacts(sentence: string, names: ReadonlySet<string> = new Set()): SentenceFacts {
  const markers = markersOf(sentence);
  return {
    text: sentence,
    words: alphaWords(sentence).length,
    content: contentWords(sentence, names),
    figures: figureFactsOf(sentence),
    contrast: markers.contrast,
    time: markers.time,
    firmTime: new Set(Array.from(markers.time).filter((t) => !LOOSE_TIME.has(t))),
    polarity: polarityOf(sentence, names),
  };
}

/**
 * Whether two sentences report the same finding, their other words aside (bh2 WD harden N1). Always: neither denies
 * what the other asserts (polarityConflict – "not painful" / "painful" are two findings). Then, for the advisory
 * warning (`advice`), no contrary marker: where both sentences give a side, a severity, a pattern, a direction, a
 * result or a count, one's are among the other's ("left" / "right", "constant" / "occasional", "better" / "worse",
 * "two" / "three" are contrary; "negative" / "normal and negative" are not), and where both give a time point (a time
 * word or a date), they share one ("At the first assessment …" / "At discharge … still …", "On 18/03/2026 …" / "At
 * discharge …") – a sentence that gives none is not contrary. For a removal (`removal`, a = the removed sentence, b =
 * its twin), exactly the same markers and time points, and every negative of the removed sentence in its twin: a
 * sentence that says "at discharge", "still" or "left" where its twin does not says something its twin does not.
 */
export function sameFinding(a: string, b: string, mode: "advice" | "removal" = "advice", names: ReadonlySet<string> = new Set()): boolean {
  return sameFindingOf(sentenceFacts(a, names), sentenceFacts(b, names), mode);
}

/** sameFinding on the facts of the two sentences. */
export function sameFindingOf(x: SentenceFacts, y: SentenceFacts, mode: "advice" | "removal" = "advice"): boolean {
  if (polarityConflictOf(x.polarity, y.polarity)) return false;
  const kinds = new Set([...Array.from(x.contrast.keys()), ...Array.from(y.contrast.keys())]);
  if (mode === "removal") {
    if (!subset(x.polarity.negated, y.polarity.negated)) return false;
    return sameSet(x.time, y.time) && Array.from(kinds).every((k) => sameSet(x.contrast.get(k), y.contrast.get(k)));
  }
  if (x.firmTime.size > 0 && y.firmTime.size > 0 && !intersects(x.firmTime, y.firmTime)) return false;
  return Array.from(kinds).every((k) => {
    const p = x.contrast.get(k);
    const q = y.contrast.get(k);
    return !p || !q || subset(p, q) || subset(q, p);
  });
}

/** Whether two sentences say the same thing (see the header). */
export function sentencesRepeat(a: string, b: string, names: ReadonlySet<string>): boolean {
  return sentencesRepeatOf(sentenceFacts(a, names), sentenceFacts(b, names));
}

/**
 * sentencesRepeat on the facts of the two sentences. Symmetric; the cheapest tests come first (all must hold). Linear
 * in the facts of the two sentences.
 */
export function sentencesRepeatOf(x: SentenceFacts, y: SentenceFacts): boolean {
  const [short, long] = x.words <= y.words ? [x, y] : [y, x];
  if (short.words < 5) return false;
  const ws = short.content;
  const wl = long.content;
  if (ws.size < 3 || wl.size < 3) return false;
  const [few, many] = ws.size <= wl.size ? [ws, wl] : [wl, ws];
  let shared = 0;
  few.forEach((w) => {
    if (many.has(w)) shared++;
  });
  if (shared / few.size < 0.8) return false;
  if (!sameFigureFacts(x.figures, y.figures)) return false;
  return sameFindingOf(x, y, "advice");
}

/**
 * Whether `removed` may be taken out because `twin` (an earlier box's sentence) says it (bh2 WD harden N1): the two
 * repeat, they give exactly the same negations, sides, severities, patterns, directions, results and time points
 * (sameFinding "removal"), and every content word of `removed` is in `twin` – a sentence that says one word more
 * ("occasional", "right", "still", a qualifier the twin does not have) says something the twin does not, and is never
 * removed. The figures and dates are checked by the one-click engine (the twin must say every one of them).
 */
export function removableRepeat(removed: string, twin: string, names: ReadonlySet<string>): boolean {
  const x = sentenceFacts(removed, names);
  const y = sentenceFacts(twin, names);
  if (!sentencesRepeatOf(x, y) || !sameFindingOf(x, y, "removal")) return false;
  return Array.from(x.content).every((w) => y.content.has(w));
}

const TIME_WORDS =
  /\b(?:at (?:the )?(?:first|initial|final|latest|last|most recent) (?:assessment|appointment|session|review|visit)|at (?:the )?(?:assessment|discharge|start|end|outset|presentation|review)|on (?:discharge|admission|referral|presentation|assessment)|at the end of treatment|so far|to date|initial(?:ly)?|first|now|current(?:ly)?|latest|final|present(?:ly)?|presenting|presentation|today|pre[- ]?(?:injury|accident|incident)|before|after|baseline|start|end|onset|outset|admission|referral|intake|original(?:ly)?|recent(?:ly)?|since|discharge|assessment|previous(?:ly)?)\b/gi;

/** A label without its time point: "Lumbar flexion – at first assessment" and "Lumbar flexion – now" give the same. */
function withoutTimePoint(label: string): string {
  return label.toLowerCase().replace(TIME_WORDS, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

/** The time point words of a label ("on the first visit" → first; "today" → today). */
function timeWordsOf(label: string): Set<string> {
  const out = new Set<string>();
  for (const m of label.toLowerCase().match(new RegExp(TIME_WORDS.source, "gi")) ?? []) out.add(m.replace(/\s+/g, " ").trim());
  return out;
}

/** Words of a question that do not say what it asks about ("What were …", "Please describe the patient's …"). */
const QUESTION_FRAME = new Set(
  "a an the and or of to in on at for with by from as is are was were be been has have had do does did what which when how who please describe give state detail details list any patient patients patient's claimant client s his her their its".split(" "),
);

/** A word without its common endings ("planned" → plan, "symptoms" → symptom), for comparing two labels. */
function stem(w: string): string {
  const s = w.replace(/(?:ning|ned|ing|ed|es|s)$/, "");
  return s.length >= 3 ? s : w;
}

/** What a label asks about, its time point and the question's frame aside (as word stems). */
function labelSubject(label: string): Set<string> {
  return new Set(withoutTimePoint(label).split(" ").filter((w) => w && !QUESTION_FRAME.has(w)).map(stem));
}

/**
 * Two boxes that ask the same question at two time points (an initial / current pair, R-regression-4, AC-DRF-6): the
 * same label once the time words are taken out ("Lumbar flexion – at first assessment" / "Lumbar flexion – now"), or two
 * labels that each name a different time point and otherwise ask about the same thing – the same subject words, or
 * mostly the same ("Which symptoms were there on the first visit?" / "Which symptoms are there today?", "Outline the
 * client's condition when first seen" / "Outline the client's condition today", "Sleep quality on presentation" /
 * "Sleep quality on discharge"). In doubt the pair is not compared: a repeat is only advice.
 */
export function timePointPair(a: string, b: string): boolean {
  return timePointPairOf(labelFacts(a), labelFacts(b));
}

/** What the pair rules read from a box's label, worked out once per box (bh2 R1T-WD-01). */
interface LabelFacts {
  /** The label trimmed, in lower case. */
  readonly lower: string;
  /** withoutTimePoint, timeWordsOf and labelSubject of the label, and its numbered row. */
  readonly without: string;
  readonly time: ReadonlySet<string>;
  readonly subject: ReadonlySet<string>;
  readonly row: { group: string; n: number; column: string } | null;
}

function labelFacts(label: string): LabelFacts {
  return { lower: label.trim().toLowerCase(), without: withoutTimePoint(label), time: timeWordsOf(label), subject: labelSubject(label), row: numberedRow(label) };
}

/** timePointPair on the facts of the two labels. */
function timePointPairOf(a: LabelFacts, b: LabelFacts): boolean {
  if (a.lower === b.lower) return false;
  if (a.without !== "" && a.without === b.without) return true;
  if (a.time.size === 0 || b.time.size === 0) return false;
  if (a.time.size === b.time.size && Array.from(a.time).every((w) => b.time.has(w))) return false;
  if (a.subject.size === 0 && b.subject.size === 0) return true;
  const [few, many] = a.subject.size <= b.subject.size ? [a.subject, b.subject] : [b.subject, a.subject];
  const shared = Array.from(few).filter((w) => many.has(w)).length;
  const union = a.subject.size + b.subject.size - shared;
  return union > 0 && shared / union >= 0.5;
}

const isDigitChar = (ch: string) => ch >= "0" && ch <= "9";
/** A line terminator, which "." in a regular expression does not match. */
const LINE_TERMINATOR = /[\n\r\u2028\u2029]/;

/**
 * "Activity 2 – frequency" → {stem "activity#– frequency", n 2, column "– frequency"}; null when not a numbered row.
 * The last run of digits is the row number (what `/^(.*?)(\d+)(\D*)$/` matched), found by one scan from the end: the
 * regular expression backtracked quadratically on a long label with many digit runs (bh2 R1T-WD-01).
 */
function numberedRow(title: string): { group: string; n: number; column: string } | null {
  const t = title.trim();
  let end = t.length;
  while (end > 0 && !isDigitChar(t[end - 1])) end--;
  if (end === 0) return null;
  let start = end;
  while (start > 0 && isDigitChar(t[start - 1])) start--;
  const prefix = t.slice(0, start);
  if (LINE_TERMINATOR.test(prefix) || prefix.trim() === "") return null;
  const column = t.slice(end).trim().toLowerCase();
  return { group: `${prefix.trim().toLowerCase()}#${column}`, n: Number(t.slice(start, end)), column };
}

/** Columns of numbered rows that are compared only as name cells (or never). */
function sameNumberedColumnOf(a: LabelFacts, b: LabelFacts): boolean {
  const x = a.row;
  const y = b.row;
  return Boolean(x && y && x.group === y.group && x.n !== y.n);
}

/** The words of a numbered-row name cell that rowRepeats compares. */
function rowWords(text: string): Set<string> {
  return new Set(alphaWords(text).filter((w) => w.length > 2 && !STOPWORDS.has(w)));
}

/** Two numbered-row name cells that mostly say the same item: one's words all in the other's, or most of them shared. */
function rowRepeats(wa: ReadonlySet<string>, wb: ReadonlySet<string>): boolean {
  if (wa.size === 0 || wb.size === 0) return false;
  const [few, many] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
  const shared = Array.from(few).filter((w) => many.has(w)).length;
  return shared === Math.min(wa.size, wb.size) || shared / Math.max(wa.size, wb.size) >= 0.6;
}

/** A name cell compared as identical: its canonical text, lower case, without trailing stops and white space. */
function rowKey(text: string): string {
  const k = sentenceKey(text).toLowerCase();
  let end = k.length;
  while (end > 0 && (k[end - 1] === "." || /\s/.test(k[end - 1]))) end--;
  return k.slice(0, end);
}

/** A sentence of a drafted answer that repeats one of an earlier box. */
export interface RepeatedSentence {
  /** The later box and its paragraph. */
  key: string;
  paragraphId: string;
  sentence: SentenceSpan;
  /** The earlier box (and paragraph) that already says it, and the sentence there that says it (its twin). */
  of: { key: string; title: string; paragraphId: string; sentence: string };
}

interface Printed {
  section: ReportSection;
  paragraph: Paragraph;
  compact: boolean;
}

/** The drafted (origin "ai") printed text answers of the report, in document order. */
function printedDrafts(sections: readonly ReportSection[], form: Pick<FormDefinition, "fields"> | null | undefined): Printed[] {
  const fields = new Map((form?.fields ?? []).map((f) => [f.id, f] as const));
  const out: Printed[] = [];
  for (const s of sections) {
    if (s.answer && s.answer.kind !== "text") continue; // a yes/no, date or choice prints its value, not this text
    let compact: boolean | undefined;
    for (const p of s.paragraphs) {
      if (p.origin !== "ai" || !p.text.trim()) continue;
      if (compact === undefined) compact = compactPlace(fields.get(s.fieldId ?? s.key)) !== null;
      out.push({ section: s, paragraph: p, compact });
    }
  }
  return out;
}

/**
 * The most work repeatedSentences does on one report (bh2 R1T-WD-01, SEC-1: a 96 KB box took 13 s, 160 KB 71 s), in
 * units of one character compared (about 0.01 µs): each pair of sentences compared costs the length of both; splitting
 * a paragraph costs SPLIT_COST_PER_CHAR and reading a sentence's facts FACTS_COST_PER_CHAR per character (measured
 * against a comparison), and so does reading a box's label (once per box); each earlier paragraph looked at for a later
 * one costs VISIT_COST, and comparing two labels LABEL_ITEM_COST per word compared. Each paragraph is split once, each
 * sentence and each label read once. The whole budget is about
 * 0.1 s of work. The recorded drafts on the 17 Blue Heart forms with the 3 sample patients spend at most about 0.5
 * million units (7 ms). When the budget runs out, the sentences not yet compared get no repeat advice: the warning
 * is advisory, so nothing that blocks is lost.
 */
export const REPEAT_WORK_BUDGET = 12_000_000;
const SPLIT_COST_PER_CHAR = 16;
const FACTS_COST_PER_CHAR = 64;
/** An earlier paragraph looked at for a later one, and the set work of comparing two labels per item (measured). */
const VISIT_COST = 8;
const LABEL_ITEM_COST = 8;

/**
 * Every drafted sentence that repeats a sentence of an EARLIER box (document order), with the box it repeats. Paired
 * time points, numbered-row columns and compact values are never compared. Bounded by REPEAT_WORK_BUDGET (`budget`
 * overrides it, for tests; `stats` receives the units spent and whether the budget ran out).
 */
export function repeatedSentences(
  report: { sections: readonly ReportSection[]; bundleSnapshot?: EpisodeBundle },
  form?: Pick<FormDefinition, "fields"> | null,
  opts: { budget?: number; stats?: { spent: number; truncated: boolean } } = {},
): RepeatedSentence[] {
  const names = nameWords(report.bundleSnapshot);
  const drafts = printedDrafts(report.sections, form);
  const out: RepeatedSentence[] = [];
  const order = new Map(report.sections.map((s, i) => [s.key, i] as const));
  const budget = opts.budget ?? REPEAT_WORK_BUDGET;
  let left = budget;
  const stats = opts.stats ?? { spent: 0, truncated: false };
  const spend = (units: number): boolean => {
    left -= units;
    stats.spent = Math.min(budget, budget - left);
    if (left < 0) stats.truncated = true;
    return left >= 0;
  };

  const split = new Map<Printed, SentenceSpan[]>();
  /** The paragraph's sentences, split once; null when the budget is spent. */
  const sentencesOf = (d: Printed): SentenceSpan[] | null => {
    let spans = split.get(d);
    if (!spans) {
      if (!spend(SPLIT_COST_PER_CHAR * d.paragraph.text.length)) return null;
      split.set(d, (spans = splitSentences(d.paragraph.text)));
    }
    return spans;
  };
  const facts = new Map<SentenceSpan, SentenceFacts>();
  /** The sentence's facts, read once; null when the budget is spent. */
  const factsOf = (span: SentenceSpan): SentenceFacts | null => {
    let f = facts.get(span);
    if (!f) {
      if (!spend(FACTS_COST_PER_CHAR * span.text.length)) return null;
      facts.set(span, (f = sentenceFacts(span.text, names)));
    }
    return f;
  };
  // Pairs of boxes that are never compared (two time points of one question, two columns of numbered rows): each label
  // read once, each pair of boxes decided once.
  const labels = new Map<ReportSection, LabelFacts>();
  const labelOf = (s: ReportSection): LabelFacts | null => {
    let f = labels.get(s);
    if (!f) {
      if (!spend(FACTS_COST_PER_CHAR * s.title.length)) return null;
      labels.set(s, (f = labelFacts(s.title)));
    }
    return f;
  };
  const notCompared = new Map<ReportSection, Map<ReportSection, boolean>>();
  const pairNotCompared = (e: ReportSection, later: ReportSection): boolean | null => {
    let row = notCompared.get(later);
    if (!row) notCompared.set(later, (row = new Map()));
    const known = row.get(e);
    if (known !== undefined) return known;
    const a = labelOf(e);
    const b = labelOf(later);
    if (!a || !b) return null;
    const items = 2 + a.time.size + b.time.size + a.subject.size + b.subject.size + ((a.lower.length + b.lower.length) >> 3);
    if (!spend(LABEL_ITEM_COST * items)) return null;
    const skip = timePointPairOf(a, b) || sameNumberedColumnOf(a, b);
    row.set(e, skip);
    return skip;
  };

  for (const later of drafts) {
    if (later.compact) continue;
    const laterOrder = order.get(later.section.key) ?? 0;
    // The earlier paragraphs this one is compared with, in document order (the same for each of its sentences).
    const earlier: Printed[] = [];
    for (const e of drafts) {
      if (!spend(VISIT_COST)) return out;
      if (e.compact || (order.get(e.section.key) ?? 0) >= laterOrder) continue;
      const skip = pairNotCompared(e.section, later.section);
      if (skip === null) return out;
      if (!skip) earlier.push(e);
    }
    if (earlier.length === 0) continue;
    const laterSentences = sentencesOf(later);
    if (!laterSentences) return out;
    for (const sentence of laterSentences) {
      const mine = factsOf(sentence);
      if (!mine) return out;
      for (const e of earlier) {
        const theirs = sentencesOf(e);
        if (!theirs) return out;
        let twin: SentenceSpan | undefined;
        for (const t of theirs) {
          if (!spend(t.text.length + sentence.text.length)) return out;
          const f = factsOf(t);
          if (!f) return out;
          if (sentencesRepeatOf(f, mine)) {
            twin = t;
            break;
          }
        }
        if (!twin) continue;
        out.push({ key: later.section.key, paragraphId: later.paragraph.id, sentence, of: { key: e.section.key, title: e.section.title.trim(), paragraphId: e.paragraph.id, sentence: twin.text } });
        break;
      }
    }
  }
  return out;
}

/**
 * The most word comparisons the numbered-row name check makes on one report (each pair of rows costs 1 plus the words of
 * both cells; about 0.05 s of work): identical names are always found (by key); only the "mostly the same" advice
 * stops when it runs out (bh2 R1T-WD-01).
 */
const ROW_WORK_BUDGET = 1_000_000;

/** A paragraph that repeats, word for word, an earlier paragraph of the same box (a drafted duplicate). */
export function duplicateParagraphs(sections: readonly ReportSection[]): Array<{ key: string; paragraphId: string; of: string }> {
  const out: Array<{ key: string; paragraphId: string; of: string }> = [];
  for (const s of sections) {
    const seen = new Map<string, string>();
    for (const p of s.paragraphs) {
      if (!p.text.trim()) continue;
      const k = sentenceKey(p.text).toLowerCase();
      const first = seen.get(k);
      if (first && p.origin === "ai") out.push({ key: s.key, paragraphId: p.id, of: first });
      else if (!first) seen.set(k, p.id);
    }
  }
  return out;
}

/** The printed name of a box in a message: “History of the incident (as reported)”. */
function labelOf(title: string): string {
  return `“${title.trim()}”`;
}

export function repeatsPart(input: ValidatorInput): DraftFitPart {
  return {
    finish() {
      const flags: ReportFlag[] = [];
      const sections = input.report.sections ?? [];
      const builtIn = !input.report.form;
      const where = builtIn ? " in this report" : "";

      // 1. Sentences that repeat an earlier box (advisory): one warning per paragraph, naming the boxes.
      const repeats = repeatedSentences(input.report, input.form ?? null);
      const byParagraph = new Map<string, RepeatedSentence[]>();
      for (const r of repeats) {
        const list = byParagraph.get(r.paragraphId);
        if (list) list.push(r);
        else byParagraph.set(r.paragraphId, [r]);
      }
      byParagraph.forEach((list) => {
        const r = list[0];
        const boxes = Array.from(new Set(list.map((x) => labelOf(x.of.title))));
        const excerpt = r.sentence.text.length > 90 ? `${r.sentence.text.slice(0, 87).trimEnd()}…` : r.sentence.text;
        flags.push(
          makeFlag({
            code: "DRAFT_FIT",
            severity: "warning",
            sectionKey: r.key,
            paragraphId: r.paragraphId,
            evidence: `repeat ${r.of.key}`,
            message: `This repeats what ${boxes.join(" and ")} says${where}: “${excerpt}” – remove it here if it is printed twice, or keep both.`,
          }),
        );
      });

      // 2. A drafted paragraph that is word for word an earlier paragraph of the same box.
      for (const d of duplicateParagraphs(sections)) {
        flags.push(
          makeFlag({
            code: "DRAFT_FIT",
            severity: "warning",
            sectionKey: d.key,
            paragraphId: d.paragraphId,
            evidence: `duplicate ${d.of}`,
            message: "This paragraph is printed twice in this box – remove the second copy.",
          }),
        );
      }

      // 3. Numbered rows (B0-16, B1-4): the name cells ("Activity 2" against "Activity 1"). An identical name blocks – it
      //    may be kept with a reason; one that mostly repeats an earlier row is a warning. Frequency, status and date
      //    columns are never compared.
      //    Each cell is read once (its key and its words); identical names are found by key, and the similar-name advice
      //    is bounded like the sentence repeats (bh2 R1T-WD-01).
      type Row = { s: ReportSection; n: number; text: string; key: string; words: Set<string> };
      const rows = new Map<string, Row[]>();
      for (const s of sections) {
        const row = numberedRow(s.title);
        if (!row || row.column !== "") continue;
        if (s.answer && s.answer.kind !== "text") continue;
        const p = s.paragraphs.find((x) => x.origin === "ai" && x.text.trim());
        if (!p) continue;
        const text = s.paragraphs.map((x) => x.text).join(" ");
        const entry: Row = { s, n: row.n, text, key: rowKey(text), words: rowWords(text) };
        const list = rows.get(row.group);
        if (list) list.push(entry);
        else rows.set(row.group, [entry]);
      }
      let rowWork = ROW_WORK_BUDGET;
      rows.forEach((list) => {
        list.sort((a, b) => a.n - b.n);
        const firstByKey = new Map<string, Row>();
        list.forEach((row, i) => {
          const identical = firstByKey.get(row.key);
          let similar: Row | undefined;
          for (let j = 0; !identical && j < i && rowWork > 0; j++) {
            rowWork -= 1 + list[j].words.size + row.words.size;
            if (rowRepeats(list[j].words, row.words)) {
              similar = list[j];
              break;
            }
          }
          if (row.text.trim() !== "" && !firstByKey.has(row.key)) firstByKey.set(row.key, row);
          const hit = identical ?? similar;
          if (!hit) return;
          const p = row.s.paragraphs.find((x) => x.origin === "ai" && x.text.trim());
          const flag = makeFlag({
            code: "DRAFT_FIT",
            severity: identical ? "blocking" : "warning",
            sectionKey: row.s.key,
            ...(p && { paragraphId: p.id }),
            evidence: `repeat ${hit.s.key}`,
            message: identical
              ? `${labelOf(row.s.title)} names the same item as ${labelOf(hit.s.title)} – give the next item the notes record, leave it blank, or keep it with a reason.`
              : `This repeats ${labelOf(hit.s.title)} (${hit.s.key}) – give the next item the notes record, or leave it blank.`,
          });
          if (identical) flag.ackPolicy = "member";
          flags.push(flag);
        });
      });
      return flags;
    },
  };
}
