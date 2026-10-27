/**
 * Shared text helpers for WB's opinion and attribution checks (plan WB designs 2, 3, 7–9 and 12): what a cited note
 * says sentence by sentence, what a drafted sentence claims, who it says holds it, and how strongly.
 *
 * - noteSentences(note): every sentence of a clinician's note (the W0 tokenizer, "notes" policy), its field, its inline
 *   label ("Goal:", "STG:", "Plan:", "Opinion on work:"), normalised with the note's shorthand written out (">15 kg" →
 *   "more than 15 kg", "LBP" → "low back pain") – the form both sides are compared in. Fix round 1 (R1T-WB-04): a
 *   printed or pasted line wrap inside a sentence is joined by the prose rule (the next line starts in lower case, the
 *   line does not end at a stop, the next line is not a list item or a "Label:" line), so "consistent with the⏎
 *   mechanism" is one sentence again; the join (and a spaced dash, R1T-WB-05) is kept as a conjunct boundary of the
 *   sentence (NoteSentence.breaks), so a terse two-line note never lends a negation, hedge or frame across it ("no
 *   swelling⏎knee pain on stairs" never anchors "no knee pain on stairs").
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
    "mr mrs ms miss mx dr there here if whether because although though however appointment appointments visit visits occasion consultation part same effect regard respect terms order addition form including include includes " +
    // harden-WB (check2-WB N1, N2): light verbs, reporting verbs and the answer particle carry no claim of their own –
    // "He made good progress" says what the note's "Good progress." says, "an explanation of the expected recovery" what
    // its "Explained … the expected recovery" says, and "Yes – resolved" answers the box's question.
    "made make makes making show shows showed shown showing included explain explains explained explaining explanation explanations yes " +
    // Fix round 1 (R1T-WB-11): a test result's reporting verb carries no claim – "McMurray's test produced medial knee
    // pain" says what the note's "McMurray's test: medial knee pain" says.
    "produced produce produces producing reproduced reproduce reproduces revealed reveal reveals demonstrated demonstrate demonstrates elicited elicit elicits"
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
// "As if" / "as though" describe a sensation ("the knee feels as if it will give way"), not a condition (harden-WB).
const HEDGE_RE = /\b(?:unlikely|likely|doubtful|unclear|uncertain|unknown|possible|possibly|probable|probably|perhaps|maybe|query|queried|questionable|suspected|suspect|potential|potentially)\b|\?|\bnot yet\b|\bat this stage\b|\btoo early\b|(?<!\bas )\bif\b|\bwhether\b/g;
const NEGATION_RE = /\b(?:not|no|never|neither|nor|nil|without|cannot|unable)\b|n't\b/;
/** A goal, aim, plan or target frame – an outcome planned or hoped for, not recorded as having happened. */
const GOAL_RE = /\b(?:goals?|aims?|aiming|aimed|targets?|objectives?|stg|ltg|short[- ]term goals?|long[- ]term goals?|hopes?|hoping|hoped|plans?|planned|planning|intends?|intended|expectations?|recommend\w*|advis\w*|advice)\b/;

/**
 * Irregular past forms, read as the verb (harden-WB, check2-WB N2: "his neck felt nearly back to normal" says what the
 * note's "Neck feels nearly back to normal." says). "Left" is not here: it is a side.
 */
const IRREGULAR: Readonly<Record<string, string>> = {
  felt: "feel", kept: "keep", slept: "sleep", went: "go", gone: "go", got: "get", gotten: "get", gave: "give", given: "give",
  took: "take", taken: "take", saw: "see", seen: "see", began: "begin", begun: "begin", came: "come", ran: "run", drove: "drive",
  driven: "drive", rode: "ride", ridden: "ride", fell: "fall", fallen: "fall", broke: "break", broken: "break", woke: "wake",
  woken: "wake", swam: "swim", swum: "swim", spoke: "speak", spoken: "speak", brought: "bring", thought: "think", caught: "catch",
  bought: "buy", held: "hold", lost: "lose", sat: "sit", stood: "stand", wore: "wear", worn: "wear", knew: "know", known: "know",
  grew: "grow", grown: "grow", threw: "throw", thrown: "throw", chose: "choose", chosen: "choose", became: "become", meant: "mean",
  met: "meet", paid: "pay", sent: "send", spent: "spend", built: "build", struck: "strike", stuck: "stick", swung: "swing",
  taught: "teach", understood: "understand", ate: "eat", eaten: "eat", drank: "drink", flew: "fly", flown: "fly", forgot: "forget",
  forgotten: "forget", hid: "hide", hidden: "hide", shook: "shake", shaken: "shake", bled: "bleed", bent: "bend", dealt: "deal",
};

/** A light stem: "returning" / "returned" → "return", "duties" → "duty", "settled" → "settl", "recovery" stays. */
export function stem(word: string): string {
  let w = word.replace(/['’]s$/, "");
  if (/^\d/.test(w)) return w;
  w = IRREGULAR[w] ?? w;
  for (const suf of ["ingly", "edly", "ings", "ing", "ies", "ied", "ed", "es", "s", "ly"]) {
    if (w.length - suf.length >= 3 && w.endsWith(suf)) {
      w = w.slice(0, -suf.length) + (suf === "ies" || suf === "ied" ? "y" : "");
      break;
    }
  }
  if (w.length > 4 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

/**
 * Two stems are the same word: equal, the same but for a final "e" (harden-WB: "knees" → "kne" is "knee", "gives" →
 * "giv" is "give", "wakes" → "wak" is "wake"), or one is a prefix of the other and the shorter has at least 4 letters.
 */
export function stemsMatch(a: string, b: string): boolean {
  if (a === b || `${a}e` === b || `${b}e` === a) return true;
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

/**
 * Same content in other words (fix round 1, R1T-WB-06), on both sides before the stems are read: a range written "2 to 3"
 * is "2-3"; the home exercise programme is the note's "home programme" (and "HEP" written out); "back to / on football"
 * is a return to it – each such phrase gives the other's stem too, so either side's wording holds the other's.
 */
export function canonicalContent(norm: string): string {
  return norm
    .replace(/\b(\d+(?:\.\d+)?) ?(?:-|to) ?(\d+(?:\.\d+)?)\b/g, "$1-$2")
    .replace(/\bhome[- ]exercises? (?:programmes?|programs?|plan)\b/g, "home programme")
    .replace(/\b(tender(?:ness)?) (?:on|to) palpation\b/g, "$1")
    .replace(/\b(?:returned|returning|returns|return)( (?:to|on)\b)/g, "return back$1")
    .replace(/\bback( (?:to|on|at|in) (?!(?:the |his |her |their )?(?:(?:left|right|upper|lower) )?(?:hip|hips|buttocks?|legs?|knees?|neck|shoulders?|thighs?|groin|foot|feet|ankles?|arms?|spine|pelvis)\b))/g, "return back$1");
}

/** A range of figures in one form ("2 to 3 weeks", "2 - 3 weeks" → "2-3 weeks"), so a phrase reads the same on both sides. */
export function canonicalRanges(norm: string): string {
  return norm.replace(/\b(\d+(?:\.\d+)?) ?(?:-|to) ?(\d+(?:\.\d+)?)\b(?!\/)/g, "$1-$2");
}

/**
 * The content stems of normalised text: claim words and figures, in order (duplicates kept once). `canonical: false`
 * reads the words as written (no canonicalContent) – whose finding a sentence is (attribution-colleague-named.ts) is
 * read that way, as before fix round 1: a shared "return" (a draft's "getting back to …" beside a note's "phased return
 * to …") is the same content for an anchor, never on its own a colleague's opinion.
 */
export function contentStems(norm: string, ignore: IgnoreNames = { people: [] }, opts: { canonical?: boolean } = {}): string[] {
  let s = ` ${opts.canonical === false ? norm : canonicalContent(norm)} `.replace(/\[claimant\]/g, " ").replace(TITLE_NAME, " ").replace(DATE, " ");
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

const PLAIN_STEMS = new WeakMap<NoteSentence, string[]>();

/** A note sentence's content stems read as written (contentStems with `canonical: false`), computed once per sentence. */
export function plainStemsOf(s: NoteSentence): string[] {
  let out = PLAIN_STEMS.get(s);
  if (!out) {
    out = contentStems(s.norm, { people: [] }, { canonical: false });
    PLAIN_STEMS.set(s, out);
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

/** A gap [start, end) of a note sentence's normalised text that is a conjunct boundary its punctuation does not show. */
export interface NoteBreak {
  start: number;
  end: number;
}

/**
 * A normalised claim's conjunct segments ("working full time on normal duties, driving without restriction and swimming
 * …"). `breaks` (a note sentence's NoteBreak gaps, offsets in `norm`): further boundaries – a joined line wrap, a spaced
 * dash (fix round 1, R1T-WB-04 / 05).
 */
export function segmentsOf(norm: string, breaks: readonly NoteBreak[] = []): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  const cuts: Array<{ start: number; end: number }> = Array.from(norm.matchAll(SEGMENT_SPLIT), (m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  for (const b of breaks) if (b.start >= 0 && b.end <= norm.length && b.start < b.end) cuts.push(b);
  cuts.sort((a, b) => a.start - b.start || a.end - b.end);
  for (const c of cuts) {
    if (c.start < last) {
      last = Math.max(last, c.end);
      continue;
    }
    if (c.start > last) out.push({ text: norm.slice(last, c.start), start: last, end: c.start });
    last = c.end;
  }
  if (last < norm.length) out.push({ text: norm.slice(last), start: last, end: norm.length });
  return out.filter((x) => x.text.trim().length > 0);
}

/** The breaks inside [a, b) of a text, shifted to a slice that starts at `a`. */
function breaksIn(breaks: readonly NoteBreak[] | undefined, a: number, b: number): NoteBreak[] {
  if (!breaks || breaks.length === 0) return [];
  return breaks.filter((x) => x.start >= a && x.end <= b).map((x) => ({ start: x.start - a, end: x.end - a }));
}

/**
 * Words that carry an opinion – a recovery, prognosis, permanence, cause, fitness, need, advice, modality or a
 * diagnosis. In an opinion place a segment with one of them must be anchored in a cited note; a segment without one
 * only describes (an incident, a frame, a treatment given) and has no opinion content of its own. (Until fix round 1
 * these were stems matched as prefixes.)
 *
 * As whole words (fix round 1, R1T-WB-05): each cue with the inflections and derivations it
 * takes – never as a prefix of another word ("shoulder" is not "should", "viewings" not "view", "needles" not "need",
 * "cancelled" not "can", "health" not "heal", "relatives" not "related").
 */
const OPINION_CUE_WORD = new RegExp(
  `^(?:${[
    "recover(?:s|ed|ing|y|ies)?", "better", "worse(?:n|ns|ned|ning)?", "improv(?:e|es|ed|ing|ement|ements)",
    "deteriorat(?:e|es|ed|ing|ion)", "settl(?:e|es|ed|ing)", "resol(?:ve|ves|ved|ving|ution)", "heal(?:s|ed|ing)?", "gone",
    "asymptomatic(?:ally)?", "prognos(?:is|es|tic|tically)", "outlooks?", "prospects?", "expect(?:s|ed|ing|ation|ations|ancy)?",
    "anticipat(?:e|es|ed|ing|ion)", "likel(?:y|ihood)", "unlikely", "probabl(?:e|y)", "probabilit(?:y|ies)", "possibl(?:e|y)",
    "possibilit(?:y|ies)", "maybe", "predict(?:s|ed|ing|ion|ions|able|ably)?", "future", "soon(?:er|est)?",
    "permanen(?:t|tly|ce|cy)", "lasting", "lifelong", "chronic(?:ally|ity)?", "irreversib(?:le|ly)", "residual(?:ly)?",
    "persist(?:s|ed|ing|ent|ently|ence)?", "forever",
    "caus(?:e|es|ed|ing|al|ally|ation|ative)", "due", "result(?:s|ed|ing|ant)?", "trigger(?:s|ed|ing)?", "attribut(?:e|es|ed|ing|able|ion)",
    "consistent(?:ly)?", "secondar(?:y|ily)", "relat(?:e|es|ed|ing)", "because",
    "fit(?:ness)?", "unfit(?:ness)?", "able", "ably", "abilit(?:y|ies)", "unable", "inability", "capab(?:le|ly|ility|ilities)",
    "ready", "readiness", "return(?:s|ed|ing)?", "resum(?:e|es|ed|ing|ption)", "restrict(?:s|ed|ing|ion|ions|ive)?",
    "limit(?:s|ed|ing|ation|ations)?", "need(?:s|ed|ing)?", "requir(?:e|es|ed|ing|ement|ements)", "necessar(?:y|ily)", "necessity",
    "recommend(?:s|ed|ing|ation|ations)?", "advis(?:e|es|ed|ing|able|ory)", "advice", "suggest(?:s|ed|ing|ion|ions)?",
    "benefi(?:t|ts|ted|ting|tted|tting|cial)", "indicat(?:e|es|ed|ing|ion|ions|ive)", "warrant(?:s|ed)?",
    "should", "would", "will", "willing(?:ness)?", "may", "might", "can", "could", "must", "ought", "candidates?",
    "opinions?", "views?", "believ(?:e|es|ed|ing)", "beliefs?", "think(?:s|ing)?", "thought", "consider(?:s|ed|ing|ation)?",
    "feel(?:s|ing|ings)?", "felt", "diagnos(?:e|es|ed|is|tic)", "impressions?", "genuine(?:ly|ness)?", "exaggerat(?:e|es|ed|ing|ion)",
  ].join("|")})$`,
);

/**
 * Whether a normalised text has opinion content (an opinion cue word, or a modal word). Word by word, as the content
 * words of contentStems are chosen (function words, names, titles and dates left out), but the word as written is
 * matched against the cue's own forms (OPINION_CUE_WORD), never its stem's prefix.
 */
export function hasOpinionCue(norm: string): boolean {
  if (/\b(?:should|would|will|may|might|can|could|must|ought|cannot|won't|wouldn't|shouldn't|needs?|needed|requires?|required|(?:un)?able)\b/.test(norm)) return true;
  // A movement or range described as restricted or limited is a finding ("painful restricted cervical range", "side
  // flexion limited by pain"), not a work restriction or a limitation of function (fix round 1, R1T-WB-06).
  const findings = norm.replace(MOVEMENT_LIMIT, " ");
  return contentWords(findings).some((w) => OPINION_CUE_WORD.test(w) || OPINION_CUE_WORD.test(w.replace(/['’]s$/, "")));
}
// Regex literals (see PAST_TENSE: no template literal with "\\b" and a constant).
const MOVEMENT_LIMIT =
  /\b(?:restricted|limited|reduced)(?= (?:[a-z-]+ ){0,4}(?:range|movement|motion|rom|flexion|extension|rotation|abduction|adduction|side flexion|lateral flexion|bending|dorsiflexion|plantarflexion)\b)|(?<=\b(?:range|movement|motion|rom|flexion|extension|rotation|abduction|adduction|side flexion|lateral flexion|bending|dorsiflexion|plantarflexion) (?:(?:was|were|is|are) )?(?:\d+% )?)(?:restricted|limited|reduced)\b/g;

/** The content words of normalised text as written (contentStems before stemming): no function words, names, titles or dates. */
function contentWords(norm: string): string[] {
  const s = ` ${norm} `.replace(/\[claimant\]/g, " ").replace(TITLE_NAME, " ").replace(DATE, " ");
  const out: string[] = [];
  for (const m of Array.from(s.matchAll(/[a-z0-9]+(?:[-'’.][a-z0-9]+)*/g))) {
    const whole = m[0].replace(/[’]/g, "'");
    for (const w of /\d/.test(whole) ? [whole] : whole.split("-")) {
      if (STOP.has(w) || (w.length < 3 && !/\d/.test(w))) continue;
      out.push(w);
    }
  }
  return out;
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
  ["if", "(?<!as )if"],
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
/**
 * "when" and "after" (D8, harden-WB – check2-WB N1):
 * - in a note they frame a condition only in a conjunct not told in the past ("Fully recovered after 6 sessions" and "Pain
 *   started when he lifted the box" are narrative; a participle straight after the word is the condition's own – "Return
 *   to full duties when settled"), and "after" a count of the treatment given, in a conjunct that predicts nothing, is
 *   narrative too ("Good progress after 5 sessions"; "Fit for full duties after 2 sessions" is still a condition);
 * - the condition is one of an outcome to come when its clause has a modal, a return, fitness, a discharge or review, a
 *   start, an expectation or a plan ("Return to full duties when pain allows") – key "when!" / "after!" – else one of a
 *   finding ("Pain worse after lifting", "Normal function when healed") – key "when" / "after";
 * - a draft keeps a finding's condition when it has the word at all ("his pain was worse after lifting"), and an
 *   outcome's only in a conjunct not told in the past – an attribution verb is not the claim's tense: "Tom Ellis
 *   recorded that she would return to full duties when pain allows" keeps it, "she returned to full duties when pain
 *   allowed" does not.
 */
const TIME_FRAMES = new Set(["when", "after"]);
/**
 * A conjunct told in the past: an auxiliary or an irregular past a narrative uses ("felt", "began" …), or a regular
 * "-ed" past that is not a participle naming a kind of duty or programme ("amended duties", "graded return"). A regex
 * LITERAL (fix round 1, R1T-WB-12): built from a template literal with a one-use constant, the production server build
 * folded it into a string with "\\b" mis-escaped (a backspace), so it never matched on /validate and /sign – the server
 * read the time frames differently from the review.
 */
const PAST_TENSE =
  /\b(?:was|were|had|did|felt|began|went|came|fell|gave|took|saw|got|ran|drove|rode|broke|woke|swam|spoke|brought|thought|caught|bought|held|lost|sat|stood|wore|knew|grew|threw|chose|became|meant|met|paid|sent|spent|built|struck|stuck|swung|taught|ate|drank|flew|forgot|hid|shook|bled|bent|dealt|told|said|kept|slept|found|made|hurt)\b|\b(?!(?:expect|anticipat|predict|forecast|plann|advis|recommend|hop|requir|need|indicat|propos|suggest|intend|schedul|book|arrang|agre|amend|modifi|adjust|restrict|reduc|phas|grad|limit|supervis|tailor|assist|prescrib|target|focus|load)ed\b)[a-z]{3,}ed\b/;
const OUTCOME_TO_COME =
  /\b(?:will|would|shall|should|can|could|may|might|must|ought|return\w*|rtw|resum\w*|back (?:to|on|at|in)|fit|unfit|able|unable|ready|discharg\w*|review\w*|progress(?:es|ed|ing)? (?:to|onto)|increas\w*|start\w*|begin\w*|commenc\w*|restart\w*|expect\w*|anticipat\w*|plan\w*|aim\w*|goals?|target\w*)\b/;
const AFTER_COUNT = /^after (?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) (?:(?:treatment|physiotherapy|physio|supervised) )?(?:sessions?|treatments?|appointments?|visits?)\b/;
/** Attribution verbs say when it was recorded, not the claim's tense. */
const ATTRIBUTION_PAST = /\b(?:recorded|noted|documented|wrote|written|stated|reported|described|explained|observed|found|assessed|examined|advised|recommended|confirmed|said|told)\b/g;
/** A participle straight after the time word is the condition's own ("when settled", "after healed"). */
const OWN_PARTICIPLE = /\b(when|whenever|after)\s+[a-z]{3,}ed\b/g;
const SEGMENT_EDGE = /[,;:]\s|\s(?:and|or|but|with|while|whereas)\s/g;
/** How far either side of a frame word its clause is read (bounded work on hostile text). */
const TIME_CONTEXT = 1500;
/** At most this many "when" / "after" words are read in one text; past that a note's is a frame and a draft keeps none (fail closed). */
const MAX_TIME_WORDS = 32;

/**
 * The conjunct segment of `s` around `at` (between the nearest segment edges) and its clause (between ; and sentence
 * ends); `cut` when the clause runs past TIME_CONTEXT either side (the caller then fails closed).
 */
function aroundAt(s: string, at: number): { segment: string; clause: string; cut: boolean } {
  let ca = at;
  while (ca > 0 && at - ca < TIME_CONTEXT && !/[;.!?]/.test(s.charAt(ca - 1))) ca -= 1;
  let cb = at;
  while (cb < s.length && cb - at < TIME_CONTEXT && !/[;.!?]/.test(s.charAt(cb))) cb += 1;
  const cut = (ca > 0 && !/[;.!?]/.test(s.charAt(ca - 1))) || (cb < s.length && !/[;.!?]/.test(s.charAt(cb)));
  const clause = s.slice(ca, cb);
  let sa = 0;
  let sb = clause.length;
  const rel = at - ca;
  for (const m of Array.from(clause.matchAll(SEGMENT_EDGE))) {
    const i = m.index ?? 0;
    if (i + m[0].length <= rel) sa = i + m[0].length;
    else if (i >= rel) {
      sb = i;
      break;
    }
  }
  return { segment: clause.slice(sa, sb), clause, cut };
}

/**
 * The time keys a text has for one of "when" / "after" (see TIME_FRAMES): for a note, "key!" (an outcome's condition)
 * or "key" (a finding's), or none; for a draft, the ones it keeps – "key" when it has the word, and "key!" too when the
 * word is in a conjunct not told in the past.
 */
function timeKeys(s: string, key: string, re: RegExp, side: "note" | "draft"): string[] {
  const g = new RegExp(re.source, "g");
  const out = new Set<string>();
  let n = 0;
  for (let m = g.exec(s); m !== null; m = g.exec(s)) {
    if (++n > MAX_TIME_WORDS) return side === "note" ? [`${key}!`] : Array.from(out);
    const at = m.index;
    const { segment, clause, cut } = aroundAt(s, at);
    if (side === "draft") {
      out.add(key);
      if (!cut && !PAST_TENSE.test(segment.replace(ATTRIBUTION_PAST, " ").replace(OWN_PARTICIPLE, "$1 _"))) out.add(`${key}!`);
      continue;
    }
    if (cut) return [`${key}!`];
    if (PAST_TENSE.test(segment.replace(OWN_PARTICIPLE, "$1 _"))) continue;
    // A count of the treatment given, in a conjunct that predicts nothing ("Good progress after 5 sessions"); "Fit for full
    // duties after 2 sessions" is still a condition.
    if (m[0] === "after" && AFTER_COUNT.test(s.slice(at, at + 80)) && !OUTCOME_TO_COME.test(segment)) continue;
    out.add(OUTCOME_TO_COME.test(clause) ? `${key}!` : key);
  }
  // A note: the stricter reading wins (an outcome's condition needs the word in a conjunct not told in the past).
  if (side === "note" && out.has(`${key}!`)) return [`${key}!`];
  return Array.from(out);
}

/**
 * The frame keys of normalised text (dates "dd/mm/yyyy" are not years): a note's (`side` "note", what frames it) or a
 * draft's (`side` "draft", what it keeps).
 */
export function framesIn(norm: string, side: "note" | "draft" = "note"): string[] {
  const s = norm.replace(DATE, " ");
  const out: string[] = [];
  for (const [key, re] of FRAME_RES) {
    if (TIME_FRAMES.has(key)) {
      out.push(...timeKeys(s, key, re, side));
      continue;
    }
    re.lastIndex = 0;
    if (re.test(s)) out.push(key);
  }
  return out;
}

/** The frames of `noteScope` that `draft` does not keep (both normalised). */
export function droppedFrames(noteScope: string, draft: string): string[] {
  const kept = new Set(framesIn(draft, "draft"));
  return framesIn(noteScope, "note").filter((k) => !kept.has(k));
}

/** A segment that governs its clause from the side: a condition or a report lead ("assuming no setbacks", "according to his GP"). */
// Fix round 1 (R1T-WB-06): also after a report noun and "that" – "advice that if the knee locked …" is the same condition.
const GOVERNING_LEAD = /^(?:(?:[a-z-]+ ){0,2}that )?(?:if|unless|until|provided|providing|as long as|so long as|assuming|depending|subject to|once|when|whenever|whether|according to|as per|per)\b/;
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

/** How far either side of a span frameScope reads its clause (a statement never runs further without a ; or a full stop). */
export const FRAME_CONTEXT = 1500;

/** Words that make the text before a colon a clause of its own (a negation, an auxiliary or a modal), not a heading. */
const CLAUSE_WORDS = /\b(?:not|no|never|nil|without|cannot|yet|is|are|was|were|has|have|had|will|would|should|can|could|may|might|must|does|did|be|been|being)\b|n't\b/;

/**
 * Whether a note sentence's text before its colon governs the clause after it (fix round 1, R1T-WB-05): a heading
 * ("Goal", "Plan", "Opinion on work", "Red flags") or a frame ("Solicitor asks for an opinion", "Employer has asked …"),
 * or a bare modifier ("Possibly", "Query"), does; a statement of its own does not – "Not yet back to match play: the
 * remaining limitation is quick changes of direction." says two things, and the first one's "not yet" is not the
 * second's.
 */
export function labelGoverns(label: string): boolean {
  if (!CLAUSE_WORDS.test(label)) return true;
  return FRAME_ANY.test(label) || isModifier(label);
}

/**
 * The part of a note sentence that says [start, end), and so whose stance and frames are its own: the clause's conjunct
 * segments the span touches, the segments of the clause that govern it from the side (a lead condition or report –
 * "Assuming no setbacks, …"; a modifier – "…, probably", "… – not yet", "…, he hopes"), and the sentence's inline label
 * ("Solicitor asks for an opinion: …") – with `exclude` (a quotation's own words) left out. Another conjunct with its own
 * content ("…, no neurological signs") is not part of it.
 */
export function frameScope(s: Pick<NoteSentence, "norm" | "label"> & { breaks?: readonly NoteBreak[] }, start: number, end: number, exclude?: { start: number; end: number }, side: "note" | "draft" = "note"): string {
  const norm = s.norm;
  // The clause is read at most FRAME_CONTEXT characters either side of the span (check2-WB N4: bounded work per call).
  let a = start;
  while (a > 0 && start - a < FRAME_CONTEXT && !/[;:.!?]/.test(norm.charAt(a - 1))) a -= 1;
  let b = end;
  while (b < norm.length && b - end < FRAME_CONTEXT && !/[;.!?]/.test(norm.charAt(b))) b += 1;
  // A note clause longer than that is never one plain statement: its stance is unknown ("?"), so nothing anchors to it.
  const cut = (a > 0 && !/[;:.!?]/.test(norm.charAt(a - 1))) || (b < norm.length && !/[;.!?]/.test(norm.charAt(b)));
  const clause = norm.slice(a, b);
  const parts: string[] = [];
  for (const g of segmentsOf(clause, breaksIn(s.breaks, a, b))) {
    const gs = a + g.start;
    const ge = a + g.end;
    const text = g.text.trim();
    if (gs < end && start < ge) parts.push(exclude ? `${norm.slice(gs, Math.max(gs, exclude.start))} ${norm.slice(Math.min(ge, exclude.end), ge)}` : norm.slice(gs, ge));
    else if (ge <= start && (GOVERNING_LEAD.test(text) || isModifier(text))) parts.push(text);
    else if (gs >= end && (GOVERNING_LEAD.test(text) || isModifier(text))) parts.push(text);
  }
  if (s.label && labelGoverns(s.label) && a > 0 && norm.slice(Math.max(0, a - s.label.length - 8), a).replace(/[\s:]+$/, "").endsWith(s.label)) parts.push(s.label);
  if (cut && side === "note") parts.push("?");
  return parts.join(" ; ");
}


/* ------------------------------------------------------------------------------------------------
 * Segment stems (bounded work on hostile text – check-WB M6)
 * ----------------------------------------------------------------------------------------------*/

/** At most this many conjunct segments make one claim or one note window (a longer run is never one statement). */
export const MAX_WINDOW_SEGMENTS = 12;
/** A drafted claim with more conjunct segments than this is not anchored segment by segment (it blocks in an opinion place). */
export const MAX_CLAIM_SEGMENTS = 40;

type SegmentStems = { segs: Segment[]; stems: string[][] };

/**
 * Remembered segments (check2-WB m3). A note sentence's live on the sentence itself (a WeakMap: they go with the note);
 * other texts – drafted claims – in a small map that never holds a long text, so a large imported note or a hostile
 * paste is not kept in server memory across requests, and the key is never a copy of a long text.
 */
const sentenceSegments = new WeakMap<object, Map<string, SegmentStems>>();
const segmentCache = new Map<string, SegmentStems>();
const SEGMENT_CACHE_ENTRIES = 512;
const SEGMENT_CACHE_TEXT = 4096;

/** A normalised text's segments and each one's content stems (`owner`: the note sentence it is the text of). */
export function segmentStems(norm: string, ignore?: IgnoreNames, owner?: object): SegmentStems {
  const who = (ignore?.people ?? []).join("|");
  if (owner) {
    let byIgnore = sentenceSegments.get(owner);
    if (!byIgnore) sentenceSegments.set(owner, (byIgnore = new Map()));
    const hit = byIgnore.get(who);
    if (hit) return hit;
    // A note sentence's own conjunct boundaries (a joined line wrap, a spaced dash – NoteSentence.breaks).
    const own = owner as { norm?: unknown; breaks?: readonly NoteBreak[] };
    const out = computeSegmentStems(norm, ignore, own.norm === norm ? own.breaks : undefined);
    byIgnore.set(who, out);
    return out;
  }
  if (norm.length > SEGMENT_CACHE_TEXT) return computeSegmentStems(norm, ignore);
  const key = `${who}\u0000${norm}`;
  const hit = segmentCache.get(key);
  if (hit) return hit;
  const out = computeSegmentStems(norm, ignore);
  if (segmentCache.size >= SEGMENT_CACHE_ENTRIES) segmentCache.clear();
  segmentCache.set(key, out);
  return out;
}

function computeSegmentStems(norm: string, ignore?: IgnoreNames, breaks?: readonly NoteBreak[]): SegmentStems {
  const segs = segmentsOf(norm, breaks);
  return { segs, stems: segs.map((g) => contentStems(g.text, ignore)) };
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
  /**
   * Conjunct boundaries in `norm` its punctuation does not show (fix round 1): where a printed line wrap was joined
   * (R1T-WB-04) and a spaced dash ("Sleeping poorly – wakes when turning over", R1T-WB-05). A negation, hedge or frame
   * in the part before one is not the part after it (frameScope, coveringSpan).
   */
  breaks: readonly NoteBreak[];
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

/**
 * A note's own line labels (a terse note's "Plan: …", "Rx: …" on a line of its own): a wrapped line never starts with
 * one, so the line before it is not joined to it.
 */
const LINE_LABEL =
  /^(?:plans?|goals?|aims?|stg|ltg|assessment|impression|diagnosis|dx|opinion|advice|rx|tx|treatment|hep|meds|medications?|pmh|dh|sh|hpc|pc|o\/e|review|outcome measures?|red flags?|yellow flags?|work|social|sleep|aggs|eases|imaging|investigations|special tests|notes?|comments?|next|subjective|objective|history|observation|palpation|rom|power|sensation|reflexes|neuro|posture|gait|pain|function|s|o|a|p)\s*:\s/i;
/** A line ending at a stop (a full stop, "!", "?", an ellipsis or a heading's colon), closing quotes and brackets aside. */
const ENDS_AT_STOP = /[.!?\u2026:]["\u201D\u2019')\]]*$/;
/** A spaced dash between words in normalised text ("sleeping poorly - wakes when turning over"; never a range "4 - 6"). */
const SPACED_DASH = /(?<=[a-z)\]'"%°])\s+-\s+(?=[a-z(])/g;

/** Whether the first (`start`) or last (`end`) word of normalised text is a content word (not a function word; a figure counts). */
function contentWordAt(norm: string, at: "start" | "end"): boolean {
  const m = at === "end" ? /([a-z0-9][a-z0-9'’-]*)[^a-z0-9]*$/.exec(norm) : /^[^a-z0-9]*([a-z0-9][a-z0-9'’-]*)/.exec(norm);
  if (!m) return false;
  const w = m[1].replace(/['’]s$/, "");
  if (/\d/.test(w)) return true;
  return !STOP.has(w) && w.length >= 3;
}

/**
 * The tokenizer's note sentences of one field, a printed line wrap inside a sentence joined back (fix round 1, R1T-WB-04;
 * the W0 "notes" policy ends a sentence at every line break): span B continues span A when exactly one line break lies
 * between them, A does not end at a stop, B starts with a lower-case letter, and B is neither a list item nor a "Label:"
 * line – the prose rule. Each group is the spans of one sentence.
 */
function sentenceGroups(value: string): Array<Array<{ start: number; end: number; text: string }>> {
  const spans = splitSentences(value, "notes");
  const groups: Array<Array<{ start: number; end: number; text: string }>> = [];
  for (const sp of spans) {
    const last = groups[groups.length - 1];
    const prev = last ? last[last.length - 1] : null;
    const gap = prev ? value.slice(prev.end, sp.start) : "";
    const wrapped =
      prev !== null &&
      /^[ \t\r]*\n[ \t\r]*$/.test(gap) &&
      !ENDS_AT_STOP.test(prev.text) &&
      sp.marker === undefined &&
      /^[a-z]/.test(sp.text) &&
      !LINE_LABEL.test(sp.text);
    if (wrapped && last) last.push({ start: sp.start, end: sp.end, text: sp.text });
    else groups.push([{ start: sp.start, end: sp.end, text: sp.text }]);
  }
  return groups;
}

/** Every sentence of a note (cached per note object). */
export function noteSentences(note: Note): readonly NoteSentence[] {
  const hit = noteCache.get(note);
  if (hit) return hit;
  const out: NoteSentence[] = [];
  for (const [field, get] of FIELDS) {
    const value = get(note);
    if (!value || !value.trim()) continue;
    for (const group of sentenceGroups(value)) {
      // The sentence as written, its wraps as single spaces; its normalised form part by part, so each join's place is known.
      const text = group.map((g) => g.text).join(" ");
      let norm = "";
      const breaks: NoteBreak[] = [];
      for (const g of group) {
        const part = canonicalRanges(normaliseForMatch(expandNoteShorthand(g.text)));
        if (!part) continue;
        if (norm) {
          // The join is a conjunct boundary only between two whole phrases – a content word ends the line and another
          // starts the next ("no swelling⏎knee pain on stairs"); a wrap inside a phrase ("after a⏎twisting sports
          // injury", "no evidence of⏎nerve root signs", "should be able to⏎return …") is one statement.
          if (contentWordAt(norm, "end") && contentWordAt(part, "start")) breaks.push({ start: norm.length, end: norm.length + 1 });
          norm += " ";
        }
        norm += part;
      }
      for (const m of Array.from(norm.matchAll(SPACED_DASH))) breaks.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
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
        breaks: breaks.sort((a, b) => a.start - b.start),
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
// Fix round 1 (R1T-WB-06): the noun-phrase form is a frame only with what follows it ("recorded an assessment of …", "her
// assessment as …", "his findings:") – "I explained the diagnosis and the expected recovery" is the act itself.
const RECORD_WHERE =
  "(?: (?:in|under) (?:his|her|their|my|the|an?|that|this) (?:[a-z-]+ ){0,3}?(?:assessment|note|notes|review|record|letter|opinion on work|plan)(?: of \\d{2}/\\d{2}/\\d{4})?:?| under [a-z ]{2,30}?:| (?:an?|his|her|their|the|my) (?:clinical |initial |working )?(?:assessment|impression|diagnosis|opinion|view|findings?)(?: (?:that|of|as)|:))?";

function namesAlt(people: readonly string[]): string {
  return people.length ? people.map((p) => escapeRegExp(p.toLowerCase()).replace(/ /g, "\\s+")).join("|") : "(?!x)x";
}

/** Clause boundaries inside a claim: ; and the conjunctions that start a new clause. */
const CLAUSE_SPLIT = /\s*;\s*|,\s+(?=(?:and|but|so|while|whereas|although|though|because|as|since|which|when)\b)|\s+(?=(?:and|but)\s+(?:he|she|they|his|her|their|i|we|it|the)\b)|\s+(?=(?:because|although|whereas|while)\b)/;

/**
 * Attribution and occasion frames inside a claim (fix round 1, R1T-WB-06 a, d), which say who recorded it and when, not
 * what: "… and an assessment of good progress" ("an assessment of" / "her assessment as"), "… was sleeping poorly at that
 * assessment" ("at that assessment", "at the initial assessment on 08/09/2026", "at my discharge review"). Removed only
 * where something is left of the clause; the claim's own words are never touched.
 */
// A regex literal: a template literal with "\\b" and a constant is mis-escaped by the production server build (R1T-WB-12).
const INLINE_FRAME =
  /\b(?:(?:an?|his|her|their|the|my) (?:clinical |initial |working |discharge |final )?(?:assessment|impression|opinion|view) (?:of|as)|(?:at|by|on) (?:that|this|the|his|her|their|my|each|every) (?:(?:initial|first|discharge|final|last|latest|follow-up|second|third|same|previous|earlier) ){0,2}(?:assessment|review|appointment|session|visit|consultation)(?: on \d{2}\/\d{2}\/\d{4})?)\b ?/g;
/** A reference back to the condition named before ("the same condition", "this injury"): it names, it claims nothing new. */
const ANAPHORA = /\b(?:the same|this|that|the said) (?:condition|injury|problem|complaint|presentation)\b/g;
function inlineFramesOut(claim: string): string {
  const out = claim.replace(INLINE_FRAME, "").replace(ANAPHORA, "it").replace(/\s+([,;.])/g, "$1").replace(/\s{2,}/g, " ").trim();
  return out.length > 0 && /[a-z0-9]/.test(out) ? out : claim;
}

/**
 * Parse one drafted sentence: its frame, holder, quotation and claim. `people` are the clinicians' full names (any case).
 */
export function parseDraftSentence(text: string, people: readonly string[]): Omit<DraftSentence, "start" | "end"> {
  const norm = canonicalRanges(normaliseForMatch(text));
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
    quote = { text: raw, norm: canonicalRanges(normaliseForMatch(expandNoteShorthand(raw))) };
    return { text, norm, holder, framedBy, quote, claim: "", clauses: [] };
  }
  // The note as the subject: "The same note contained …", "That note recorded that …" – a frame, not a claim.
  rest = rest.replace(new RegExp(`^(?:the|that|this|his|her|their) (?:same )?(?:[a-z-]+ )?(?:note|notes|record|assessment)(?: of ${UK_DATE_N})? (?:also )?(?:contained|recorded|included|gave|stated|said|noted)(?: that)?,? `), "");
  // A lead date or occasion: "On 06/05/2026", "At the review on 06/05/2026,", "At discharge,", "At that appointment",
  // "By the review on 19/08/2026" (harden-WB: the occasion is when, not what – "review" is not a claim word).
  // Fix round 1 (R1T-WB-06 a): the occasion's words are read greedily – "At my discharge review on 16/09/2026" is all
  // frame (a lazy read stopped at "discharge" and left "review on 16/09/2026" as claim content).
  rest = rest.replace(new RegExp(`^(?:on ${UK_DATE_N}|on (?:the same|that) (?:date|day)|(?:at|by) (?:the |my |his |her |their |this |that )?(?:[a-z-]+ ){0,2}(?:assessment|review|appointment|session|visit|consultation|discharge)(?: on ${UK_DATE_N})?),? `), "");
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
  } else if ((m = new RegExp(`^(${NAMES}|my|his|her|their)['’]?s? (?:clinical |professional |initial |discharge |final )?(?:opinion|view|assessment|impression|diagnosis|expectation|findings?)(?: (?:on|of|dated) ${UK_DATE_N}| \\(${UK_DATE_N}\\))? (?:is|was|were)(?: that)?,? `).exec(rest))) {
    // Fix round 1 (R1T-WB-06 d, R1T-WB-11): "<Name>'s assessment on 20/10/2026 was …", "His assessment was …" – an
    // attribution frame, not claim content. A pronoun names no one here: the colleague-named check reads it against the
    // clinician the paragraph named before ("Her assessment was …" after "Priya Shah recorded …").
    if (m[1] === "my") holder = { kind: "owner" };
    else if (!/^(?:his|her|their)$/.test(m[1])) {
      framedBy = nameOf(m[1]);
      holder = { kind: "named", name: framedBy };
    }
    rest = rest.slice(m[0].length);
  } else if ((m = new RegExp(`^(?:in (?:his|her|their|my) (?:clinical |initial |discharge )?(?:assessment|opinion|view|notes?|review),? )?(${NAMES}|i)(?:, [a-z ,-]{2,60}?,)? (?:also |then |later |again )?(${FRAME_VERBS})(?: on ${UK_DATE_N})?${RECORD_WHERE}(?: that)?,? `).exec(rest))) {
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
  // "He also recorded that …", "She recorded advice to …": the clinician named before (the frame, not the claim) – also
  // after "In his assessment of the same date" (fix round 1, R1T-WB-11).
  if (!framedBy) {
    const pr = new RegExp(`^(?:in (?:his|her|their) (?:clinical |initial |discharge |follow-up )?(?:assessment|note|notes|review|examination)(?: (?:of|on) (?:the same date|that date|that day|${UK_DATE_N}))?,? )?(?:he|she|they) (?:also |then |later |again )?(${FRAME_VERBS})(?: on ${UK_DATE_N})?${RECORD_WHERE}(?: that)?,? `).exec(rest);
    if (pr) rest = rest.slice(pr[0].length);
  }
  // "Assessment on 08/09/2026: …", "Discharge review (16/09/2026): …" – a label naming the occasion, not claim content.
  if (!holder) {
    const lab = new RegExp(`^(?:initial |discharge |follow-up |final |clinical )?(?:assessment|review|examination|impression|diagnosis|findings?)(?: (?:on|of) ${UK_DATE_N}| \\(${UK_DATE_N}\\))?: `).exec(rest);
    if (lab) rest = rest.slice(lab[0].length);
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
  const claim = inlineFramesOut(rest.replace(/[.!]+$/, "").trim());
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
  // Fix round 1 (R1T-WB-06, R1T-WB-09): a named clinician's own frame verb governs what follows it, "that" or not –
  // "…, and on 05/08/2026 Tom Ellis, physiotherapist, recorded advising a break …" is Tom Ellis's.
  const re = new RegExp(`\\b(?:in (my|${NAMES})(?:['’]s)? (?:clinical |professional )?(?:opinion|view)|(my|${NAMES})['’]?s? (?:clinical |professional )?(?:opinion|view|assessment|impression) (?:is|was) that|(i|${NAMES})(?:, [a-z ,-]{2,60}?,)? (?:also |then |later |again )?(?:recorded|noted|documented|wrote|stated|assessed|found|advised|recommended)(?: on ${UK_DATE_N})?${RECORD_WHERE} that|(${NAMES})(?:, [a-z ,-]{2,60}?,)? (?:also |then |later |again )?(?:recorded|noted|documented|wrote|stated|assessed|found|advised|recommended|explained|measured|examined|observed|treated|discharged|reviewed|provided|gave)\\b)`, "g");
  let found: Holder | null = null;
  let m: RegExpExecArray | null;
  // A frame inside a quotation is the quoted clinician's own words ("Tom Ellis recorded: “In my opinion …”"), never a
  // frame of the drafted sentence (fix round 1, R1T-WB-07): quoted text is read as blanks.
  const unquoted = norm.replace(/"[^"]*"/g, (q) => " ".repeat(q.length));
  while ((m = re.exec(unquoted)) !== null) {
    if (m.index > index) break;
    const who = m[1] ?? m[2] ?? m[3] ?? m[4];
    found = who === "my" || who === "i" ? { kind: "owner" } : { kind: "named", name: nameOf(who) };
  }
  return found ?? fallback;
}

/**
 * A drafted claim split where another frame starts inside it (fix round 1, R1T-WB-06 / R1T-WB-09): "advice on desk
 * set-up and regular breaks, and on 05/08/2026 Tom Ellis, physiotherapist, recorded advising a break every 45 minutes …"
 * is two runs – the first in the sentence's own holder's words, the second Tom Ellis's – each anchored to its own
 * holder's notes. The frame words themselves are left out of the runs.
 */
export function claimRuns(claim: string, people: readonly string[], holder: Holder | null): Array<{ text: string; holder: Holder | null }> {
  const NAMES = namesAlt(people);
  const nameOf = (lower: string) => people.find((p) => p.toLowerCase().replace(/\s+/g, " ") === lower.replace(/\s+/g, " ")) ?? lower;
  const re = new RegExp(`(?:,\\s*(?:and\\s+)?|;\\s*|\\s+and\\s+)(?:on ${UK_DATE_N},?\\s+)?(${NAMES}|i)(?:, [a-z ,-]{2,60}?,)? (?:also |then |later |again )?(?:${FRAME_VERBS})${RECORD_WHERE}(?: that)?,?\\s+`, "g");
  const out: Array<{ text: string; holder: Holder | null }> = [];
  let last = 0;
  let current = holder;
  for (const m of Array.from(claim.matchAll(re))) {
    const at = m.index ?? 0;
    const before = claim.slice(last, at).trim();
    if (before) out.push({ text: before, holder: current });
    current = m[1] === "i" ? { kind: "owner" } : { kind: "named", name: nameOf(m[1]) };
    last = at + m[0].length;
  }
  const tail = claim.slice(last).trim();
  if (tail) out.push({ text: tail, holder: current });
  return out.length > 0 ? out : [{ text: claim, holder }];
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
