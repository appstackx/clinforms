/**
 * Conditional questions (Blue Heart fix round 1, B0-7; bh2 WA1 design 3): "IF YES, DESCRIBE IT", "If not, the
 * expected date", "Kind – if other, which", "If (a), (b) or (d) is Yes, give details", "If yes to either question
 * above, describe the pain", "Only if he or she is not yet back at work: …". Such a question belongs to one or more
 * questions before (or just after) it. If their answers mean it does not apply, it is not asked: nothing it holds is
 * printed, its checks do not block and its gaps are settled as "not applicable".
 *
 * Read ONCE, when the report is created (compileCondition, called by core/report-factory.ts createFormReport), and
 * frozen on the section (ReportSection.condition – hashed, kept through drafting): what an approved report issues never
 * depends on a later change to this parser. The issue state (core/issue-state.ts) evaluates the frozen condition
 * against the controlling answers each time (evaluateCondition); nothing about it is ever inferred from flags or the
 * activity log. A report this release made (Report.reportModel 2) reads only its frozen conditions – never the printed
 * words at run time (conditionOf `release`).
 *
 * Where a condition is read (compileCondition), first found wins:
 * - the question: an "If …" clause at its start (after any lettering such as "(a)" or "5.") or after a clause break
 *   ("More treatment – if yes, describe it"); a question with two of them ("If yes, or if unsure, …") is unresolved;
 * - its guidance: an "Only if / Only when …" sentence anywhere in it, or guidance that starts "If …";
 * - its printed heading (FormField.section) when that starts "If …" / "Only if / when …" and is not an earlier
 *   question's own label (B1-9: "If he is not yet working full duties, list the main problems");
 * - a question without "If": "Reasons for advising more treatment" after "Is more treatment advised?" (B1-9), and
 *   "<X> – details" straight after a yes/no about X ("Pain on waking – details", B2-5) or after a question of the same
 *   row that has a condition ("Home tasks – how limited" follows "Home tasks – status", B2-13).
 *
 * What a clause asks of what (readClause), in this order:
 * 1. a numbered reference ("If yes to question 1") is never guessed: unresolved;
 * 2. lettered questions it names – "(a), (b) or (d) is Yes", "yes to b or d", "any of (a)–(d)" – any one of them
 *    ("and" lists too; "all / each / both of" means all of them);
 * 3. "either / both … above" (the two questions just above), "any … above" (the run of them);
 * 4. a bare "If yes / If so / If no / If not / If other" (with nothing but an instruction after it) – the nearest
 *    structured question at most 3 before it ("if other": a choice; a "– Other" tick: ticked);
 * 5. a clause with content ("If not gone back to work", "Only when the tape restriction is kept", "If the knee is
 *    getting worse", "If you do not advise home exercises"): its polarity is "no" with exactly one negation and no other
 *    word that turns it ("not off work" is never guessed), "yes" with none. Its topic – its content words, without the
 *    words that only frame it ("you do not expect …", "… is kept", "at this stage") – must be covered WHOLE by exactly
 *    one structured question near it (20 before to 3 after; a one-word topic only by the nearest question before it):
 *    a yes/no or tick whose own question is not itself turned ("Is the patient unable to work?" is never read against,
 *    R-safety-9) – wants Yes / ticked or No / not ticked; or one printed option of a choice (with the choice's own
 *    question) – it applies when that option is chosen, or (negated: "not yet working full duties") when another one is. A
 *    positive clause with no such question may name a text box of its own row ("Only when a task is still limited"
 *    after "Home tasks – task still limited"): it applies when that box names something (not "None").
 * Anything else that reads as a condition is UNRESOLVED: the box is applicable – drafted and fully checked, never
 * guessed (WA1 design 3). A frozen reading the evaluator does not know (a wants it never writes, a yes/no wants on a
 * choice it cannot read) is unresolved too.
 *
 * Reports from before this release (no frozen condition on the section, no reportModel) keep the earlier reading of the
 * printed question at run time (legacyConditionOf), exactly as they were checked and approved.
 *
 * Ledger seam (core/validation/hooks.ts): "condition-parser" – with it disabled no box is ruled out by a condition.
 *
 * Pure; browser and server. Owner: WA1 (issue state) – docs/bh2-ownership.json.
 */
import { defineHook, hookEnabled } from "./validation/hooks";
import type { FrozenCondition, ReportSection } from "./types";

/** The ledger hook this file owns (__corpus__/ledger.json "condition-parser"). */
export const CONDITION_PARSER_HOOK = defineHook("condition-parser");

/** The version of the reading recorded on every frozen condition (FrozenCondition.parser). */
export const CONDITION_PARSER_VERSION = "wa1-c3";

/** Most questions one condition can name (core/schemas.ts MAX_CONDITION_CONTROLLERS). */
const MAX_CONTROLLERS = 26;

type Wants = "yes" | "no" | "other";

/**
 * A frozen condition as this file writes it. Besides W0's keys (core/schemas.ts FrozenConditionSchema, a loose object):
 * - wantsNot: a choice's printed option – the box applies when ANOTHER option is chosen ("not yet working full duties");
 * - filled: true – the box applies when the controlling text box names something (not "None", "N/A", "nil").
 * Exactly one of wants / wantsNot / filled is set on a resolved condition.
 */
type Frozen = FrozenCondition & { wantsNot?: string; filled?: true };

/* ------------------------------------------------------------------------------------------------
 * The earlier reading (fix round 1) – kept for reports without a frozen condition
 * ----------------------------------------------------------------------------------------------*/

const LEAD = String.raw`^(?:\(?[a-z0-9]{1,3}[.)]\s*)?`;

/** What the question's own condition asks of the answer before it, or null for an ordinary question (fix round 1). */
export function conditionWanted(title: string): { wants: Wants; anyOfAbove: boolean } | null {
  const t = title.trim();
  const anyOfAbove = /\bany of the above\b/i.test(t);
  if (new RegExp(`${LEAD}if (?:yes|so)\\b`, "i").test(t)) return { wants: "yes", anyOfAbove };
  if (new RegExp(`${LEAD}if (?:no|not)\\b`, "i").test(t)) return { wants: "no", anyOfAbove };
  if (/(?:^|[\s–—-])if other\b/i.test(t)) return { wants: "other", anyOfAbove: false };
  return null;
}

type Section = Pick<ReportSection, "key" | "title" | "answer"> & Partial<Pick<ReportSection, "paragraphs">> & { condition?: FrozenCondition };

const isStructured = (s: Pick<ReportSection, "answer">) => s.answer !== undefined && (s.answer.kind === "yes_no" || s.answer.kind === "checkbox" || s.answer.kind === "choice");

/** true / false for a yes/no answer (a choice printed "Yes" / "No" too), null when it is neither or not given. */
function yesNo(s: Pick<ReportSection, "answer">): boolean | null {
  const v = s.answer?.value;
  if (typeof v === "boolean") return v;
  if (typeof v === "string" && /^y(?:es)?$/i.test(v.trim())) return true;
  if (typeof v === "string" && /^no?$/i.test(v.trim())) return false;
  return null;
}

export interface Condition {
  /** The question(s) it depends on. */
  controllers: Section[];
  /** true: it applies; false: it does not (the answers before it say so); null: not known yet (it applies). */
  applies: boolean | null;
  /** "“ANY FURTHER TREATMENT RECOMMENDED?” is “NO”" – for the review and the audit trail. */
  because: string;
  /** Read from the frozen condition (this release) rather than from the printed question at run time. */
  frozen?: boolean;
}

function said(s: Section): string {
  const v = s.answer?.value;
  return `“${s.title.trim()}” is “${typeof v === "boolean" ? (v ? "Yes" : "No") : String(v ?? "")}”`;
}

/** The earlier reading (fix round 1, unchanged): the condition of `key` from its printed question, at run time. */
export function legacyConditionOf(sections: readonly Section[], key: string): Condition | null {
  const i = sections.findIndex((s) => s.key === key);
  // A choice question answers its own condition ("5. If not, are they fit for modified duties?" prints "Not applicable").
  if (i < 0 || sections[i].answer?.kind === "choice") return null;
  const wanted = conditionWanted(sections[i].title);
  if (!wanted) return null;
  let controllers: Section[] = [];
  if (wanted.anyOfAbove) {
    for (let j = i - 1; j >= 0 && isStructured(sections[j]); j--) controllers.unshift(sections[j]);
  } else {
    for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
      if (isStructured(sections[j])) {
        controllers = [sections[j]];
        break;
      }
    }
  }
  if (controllers.length === 0) return null;
  return legacyJudge(controllers, wanted.wants);
}

/** The earlier reading's evaluation (unchanged, so a report from before the release reads exactly as it was approved). */
function legacyJudge(controllers: Section[], wants: Wants): Condition {
  if (wants === "other") {
    const c = controllers[0];
    const v = c?.answer?.value;
    if (v === null || v === undefined || v === "") return { controllers, applies: null, because: "" };
    const hit = typeof v === "string" && /\bother\b/i.test(v);
    return { controllers, applies: hit, because: hit ? "" : said(c) };
  }
  return yesNoJudge(controllers, wants === "yes", "any", said);
}

/* ------------------------------------------------------------------------------------------------
 * Evaluating a frozen condition against the controlling answers
 * ----------------------------------------------------------------------------------------------*/

function yesNoJudge(controllers: Section[], want: boolean, match: "any" | "all", saidOf: (s: Section) => string, answersOf: (s: Section) => boolean | null = yesNo): Condition {
  const answers = controllers.map(answersOf);
  const right = (a: boolean | null) => a === want;
  const wrong = (a: boolean | null) => a === !want;
  if (match === "all") {
    if (answers.every(right)) return { controllers, applies: true, because: "" };
    if (answers.some(wrong)) return { controllers, applies: false, because: controllers.filter((_, k) => wrong(answers[k])).map(saidOf).join(" and ") };
    return { controllers, applies: null, because: "" };
  }
  if (answers.some(right)) return { controllers, applies: true, because: "" };
  if (answers.every(wrong)) return { controllers, applies: false, because: controllers.map(saidOf).join(" and ") };
  return { controllers, applies: null, because: "" };
}

/** A frozen yes/no reading reads a yes/no, a tick, or a choice printed "Yes" / "No" – nothing else. */
function frozenYesNo(s: Section): boolean | null {
  const kind = s.answer?.kind;
  if (kind !== "yes_no" && kind !== "checkbox" && kind !== "choice") return null;
  return yesNo(s);
}

/** "“Home exercises given” is “No”" – a tick reads "Ticked" / "Not ticked". */
function saidFrozen(s: Section): string {
  const v = s.answer?.value;
  const value = typeof v === "boolean" ? (s.answer?.kind === "checkbox" ? (v ? "Ticked" : "Not ticked") : v ? "Yes" : "No") : String(v ?? "");
  return `“${s.title.trim()}” is “${value}”`;
}

/** "None", "N/A", "nil", "nothing", "no restrictions" – a text box that names nothing. */
const NAMES_NOTHING = /^(?:none(?: (?:reported|recorded|noted))?|n\/?a|nil|nothing(?: (?:reported|recorded|noted))?|not applicable|no(?:ne)? restrictions?|no limitations?)\.?$/i;

/** The text a box holds (a structured text value, else its paragraphs), trimmed. */
function heldText(s: Section): string {
  const v = s.answer?.value;
  if (typeof v === "string" && v.trim()) return v.trim();
  return (s.paragraphs ?? [])
    .map((p) => p.text)
    .join(" ")
    .trim();
}

const sameOption = (a: string, b: string) => a.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase() === b.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

/**
 * A frozen condition against the report's sections: applies true / false, or null when it is unresolved, the
 * controlling answers are not known yet, or the reading is one this evaluator does not know (the box then applies). A
 * controller the report does not hold is unknown.
 */
export function evaluateCondition(condition: FrozenCondition, sections: readonly Section[]): Condition {
  const c = condition as Frozen;
  const byKey = new Map(sections.map((s) => [s.key, s]));
  const controllers = (c.controllers ?? []).map((k) => byKey.get(k)).filter((s): s is Section => Boolean(s));
  const unknown: Condition = { controllers, applies: null, because: "", frozen: true };
  if (c.unresolved || controllers.length === 0 || controllers.length !== c.controllers.length) return unknown;
  const readings = [c.wants !== undefined, c.wantsNot !== undefined, c.filled !== undefined].filter(Boolean).length;
  if (readings !== 1) return unknown;
  const match = c.match ?? "any";
  if (match !== "any" && match !== "all") return unknown;

  // The row's text box names something (not "None").
  if (c.filled !== undefined) {
    const ctl = controllers[0];
    if (c.filled !== true || controllers.length !== 1 || (ctl.answer && ctl.answer.kind !== "text")) return unknown;
    const held = heldText(ctl);
    if (!held) return unknown;
    const nothing = NAMES_NOTHING.test(held);
    return { controllers, applies: !nothing, because: nothing ? `“${ctl.title.trim()}” is “${held.replace(/\.$/, "")}”` : "", frozen: true };
  }
  // Any printed option of a choice but this one.
  if (c.wantsNot !== undefined) {
    const a = controllers[0].answer;
    if (typeof c.wantsNot !== "string" || controllers.length !== 1 || a?.kind !== "choice" || typeof a.value !== "string" || !a.value.trim()) return unknown;
    const is = sameOption(a.value, c.wantsNot);
    return { controllers, applies: !is, because: is ? saidFrozen(controllers[0]) : "", frozen: true };
  }
  const wants = c.wants;
  if (typeof wants !== "string") return unknown;
  if (wants === "yes" || wants === "no") return { ...yesNoJudge(controllers, wants === "yes", match, saidFrozen, frozenYesNo), frozen: true };
  // "other" or a printed option: one choice question.
  const a = controllers[0].answer;
  if (controllers.length !== 1 || a?.kind !== "choice" || typeof a.value !== "string" || !a.value.trim()) return unknown;
  const hit = wants === "other" ? /\bother\b/i.test(a.value) : sameOption(a.value, wants);
  return { controllers, applies: hit, because: hit ? "" : saidFrozen(controllers[0]), frozen: true };
}

/**
 * The condition of `key`, or null for an ordinary question: the section's frozen condition, else – only for a report
 * from before this release – the earlier reading of its printed question. `release`: the report was made by this
 * release (core/issue-state.ts isReleaseModel), so a section without a frozen condition is an ordinary question (no
 * run-time fallback). With the "condition-parser" hook disabled (corpus ledger seam) every question is ordinary.
 */
export function conditionOf(sections: readonly Section[], key: string, opts: { release?: boolean } = {}): Condition | null {
  if (!hookEnabled(CONDITION_PARSER_HOOK)) return null;
  const section = sections.find((s) => s.key === key);
  if (!section) return null;
  if (section.condition) return evaluateCondition(section.condition, sections);
  if (opts.release) return null;
  return legacyConditionOf(sections, key);
}

/** Whether `key` is a conditional question that does not apply (the answers before it say so). */
export function notApplicable(sections: readonly Section[], key: string, opts: { release?: boolean } = {}): Condition | null {
  const c = conditionOf(sections, key, opts);
  return c && c.applies === false ? c : null;
}

/* ------------------------------------------------------------------------------------------------
 * Words: topics, polarity, coverage
 * ----------------------------------------------------------------------------------------------*/

/** What the parser reads of a form's questions (a FormField, or the drafting call's field list). */
export interface ConditionField {
  id: string;
  label: string;
  guidance?: string;
  answerType: string;
  /** The printed heading the question sits under (FormField.section). */
  section?: string | null;
  /** A choice question's printed options (FormField.options). */
  options?: readonly string[];
}

const structuredType = (t: string) => t === "yes_no" || t === "checkbox" || t === "single_choice";
const textType = (t: string) => t === "short_text" || t === "long_text";

/** The lettering a question is printed with: "(b) …", "b) …", "b. …" → "b". */
function letterOf(label: string): string | null {
  const m = /^\s*\(([a-z])\)\s*|^\s*([a-z])[.)]\s+/i.exec(label);
  return m ? (m[1] ?? m[2]).toLowerCase() : null;
}

/**
 * Words that say nothing about WHAT a question asks: function words, polarity words, and the people every question is
 * about ("the patient", "the client", "the employee").
 */
const FUNCTION_WORDS = new Set(
  "a an the and or but if only when whether is are was were be been being has have had do does did not no nor never yet still any all either both each this that these those there here it its he she him her his hers they them their theirs you your yours we our us i me my of to in on at for from by with as into onto about above below than then so such can could will would shall should may might must please give given state describe detail details provide explain expected date who what which why how patient patients client clients employee employees claimant claimants person injured yes other".split(
    " ",
  ),
);

/**
 * Words that only frame a clause ("If you do not EXPECT …", "… is KEPT", "Reasons for ADVISING …"), as stems: the
 * topic is what is expected, kept or advised.
 */
const FRAME_STEMS = new Set(["expect", "anticipat", "recommend", "advis", "consider", "think", "feel", "believ", "intend", "propos", "suggest", "request", "keep", "kept", "tick", "select", "chos", "chosen", "plan", "giv", "given"]);

/** The same thing said two ways on referrers' forms: "normal role" / "full duties"; "returned to work" / "back at work". */
const SYNONYMS: ReadonlyArray<[RegExp, string]> = [
  [/\b(?:normal|full)\s+(?:role|duties|duty)\b/g, "full duties"],
  [/\breturn(?:ed|ing|s)?\b/g, "back"],
];

/** "at this stage", "at present", "currently", "now", "so far": when, not what. */
const TIME_WORDS = /\bat (?:this|the) (?:stage|time|moment|point)\b|\bat present\b|\bcurrently\b|\bnow\b|\bso far\b/g;

/** "he or she", "his or her": one person, not two alternatives. */
const PRONOUN_PAIRS = /\b(?:he or she|she or he|him or her|her or him|his or her|her or his|he\/she|him\/her|his\/her)\b/g;

/** "(Yes / No)", "Y/N" printed after a question: its answer boxes, not a negation. */
const ANSWER_BOXES = /\(?\b(?:yes\s*\/\s*no|no\s*\/\s*yes|y\s*\/\s*n)\b\)?/g;

function canonical(text: string): string {
  let t = text.normalize("NFKC").toLowerCase().replace(/[’']/g, "'").replace(ANSWER_BOXES, " ");
  for (const [re, to] of SYNONYMS) t = t.replace(re, to);
  return t.replace(TIME_WORDS, " ").replace(PRONOUN_PAIRS, " person ");
}

/** A crude stem, so "returned" meets "return", "restricted" meets "restriction" and "duty" meets "duties". */
function stem(word: string): string {
  let w = word.replace(/'s$/, "").replace(/(?:ments?|ions?|ings?|ed|es|s)$/, "");
  if (w.length < 3) w = word;
  w = w.replace(/e$/, "").replace(/y$/, "i");
  return w.replace(/([b-df-hj-np-tv-z])\1$/, "$1");
}

function contentWords(text: string): string[] {
  const out: string[] = [];
  for (const raw of canonical(text).split(/[^a-z0-9']+/)) {
    const word = raw.replace(/'s$/, "").replace(/'/g, "");
    if (word.length < 3 || FUNCTION_WORDS.has(word)) continue;
    const s = stem(word);
    if (FRAME_STEMS.has(s) || out.includes(s)) continue;
    out.push(s);
  }
  return out;
}

/** Two stems name the same thing: equal, one a prefix of the other (5+ letters), or 6 letters shared (length within 3). */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 5 && long.startsWith(short)) return true;
  return short.length >= 6 && long.slice(0, 6) === short.slice(0, 6) && long.length - short.length <= 3;
}

/** Every topic word is in `words`. */
function covers(topic: readonly string[], words: readonly string[]): boolean {
  return topic.every((t) => words.some((w) => sameWord(t, w)));
}

const NEGATION = /\b(?:no longer|not|never|no|nor|cannot)\b|n't\b/gi;
/** Every word that turns a clause the other way – a plain negation, or a word that negates by itself ("off", "unable"). */
const POLARITY_CUES = /\b(?:no longer|not|never|no|nor|cannot|unable|without|off|absent|unfit|unless|except|neither)\b|n't\b/gi;

const count = (re: RegExp, text: string) => (text.match(re) ?? []).length;
const turned = (text: string) => count(POLARITY_CUES, canonical(text)) > 0;

/** A clause's topic: its content words, without negations, frame words and when-words. */
function topicOf(body: string): string[] {
  return contentWords(body.replace(NEGATION, " "));
}

/** "Home tasks – how limited" → "home tasks"; null for a label that is not one cell of a printed row. */
function rowOf(label: string): string | null {
  return /^(.+?)\s+[–—-]\s+\S/.exec(label.trim())?.[1].trim().toLowerCase() ?? null;
}

/** "Pain on waking – details" → "Pain on waking"; null for any other label. */
function detailsOf(label: string): string | null {
  return /^(.+?)\s+[–—-]\s+(?:details?|comments?|please (?:give details|specify)|specify|describe)\s*:?$/i.exec(label.trim())?.[1].trim() ?? null;
}

/* ------------------------------------------------------------------------------------------------
 * Reading the condition once, from the form map (report creation)
 * ----------------------------------------------------------------------------------------------*/

/** An "If …" or "Only if / Only when …" clause: the words of its condition and the printed words it was read from. */
interface Clause {
  /** The condition's own words (after "if"). */
  body: string;
  /** The printed words it was read from (for the review and the activity log). */
  text: string;
  /** Another condition clause that widens it follows in the same words ("If yes, or if unsure, …"). */
  another: boolean;
}

/** One or more lettered questions: "(b), (c) or (d)", "b and d", "(a)–(d)", "(a) to (d)". */
const LETTER_LIST = String.raw`\(?[a-h]\)?(?:\s*(?:,|\bor\b|\band\b|&|\/|[–—-]|\bto\b)\s*\(?[a-h]\)?)+`;
const LETTER_HEAD = new RegExp(String.raw`^(?:(?:yes|no)\s+(?:to|for|on)\s+)?(?:(?:any|all|each|either|both)\s+of\s+(?:questions?\s+)?)?(${LETTER_LIST})(?=[\s,.:;?)–—]|$)`, "i");

const CLAUSE_START = /(?:^(?:\(?[a-z0-9]{1,3}[.)]\s*)?|[,;:–—(]\s*|\s-\s)(only if|only when|if)\s+/gi;

/**
 * The first condition clause of some printed words. `where`: "label" – "If …" / "Only if …" at its start (after any
 * lettering) or after a clause break; "only" – an "Only if / Only when …" sentence anywhere (guidance); "lead" – words
 * that start "If …" / "Only if / when …" (guidance, a heading).
 */
function clauseOf(text: string, where: "label" | "only" | "lead"): Clause | null {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return null;
  let m: RegExpExecArray | null;
  if (where === "only") m = /(?:^|[.;:–—(]\s*|\s-\s)(only if|only when)\s+(.+)$/i.exec(t);
  else if (where === "lead") m = /^()(only if|only when|if)\s+(.+)$/i.exec(t);
  else m = /(?:^(?:\(?[a-z0-9]{1,3}[.)]\s*)?|[,;:–—(]\s*|\s-\s)(only if|only when|if)\s+(.+)$/i.exec(t);
  if (!m) return null;
  const word = where === "lead" ? m[2] : m[1];
  const rest = where === "lead" ? m[3] : m[2];
  // The condition runs to the first clause break – but a lettered list ("(a), (b) or (d)", "(a)–(d)") keeps its commas.
  const lettered = LETTER_HEAD.exec(rest);
  const head = lettered ? lettered[0] : "";
  const tail = rest.slice(head.length);
  const end = tail.search(/[,:;?–—)]|\s-\s|\.(?:\s|$)/);
  const body = (head + (end < 0 ? tail : tail.slice(0, end))).trim();
  const after = end < 0 ? "" : tail.slice(end);
  CLAUSE_START.lastIndex = 0;
  // A second condition that widens it ("If yes, or if unsure, …"; "If yes, give details; if no, why?"). One that only
  // narrows it ("… and if he still takes them") leaves the box applicable more often, never less: it is not counted.
  const another = CLAUSE_START.test(after) || /\bor\s+(?:only\s+)?(?:if|when)\b/i.test(after);
  return { body, text: `${word} ${body}`.slice(0, 500), another };
}

/** A compiled condition (the frozen shape). */
function frozen(controllers: string[], reading: { wants: string } | { wantsNot: string } | { filled: true }, text: string, match?: "any" | "all"): Frozen {
  return { controllers, ...reading, ...(match && controllers.length > 1 ? { match } : {}), text: text.slice(0, 500), parser: CONDITION_PARSER_VERSION } as Frozen;
}

function unresolvedCondition(text: string): Frozen {
  return { controllers: [], unresolved: true, text: text.slice(0, 500), parser: CONDITION_PARSER_VERSION };
}

/** The nearest structured question at most 3 before field `i` (the earlier reading's rule). */
function nearestController(fields: readonly ConditionField[], i: number): ConditionField | null {
  for (let j = i - 1; j >= Math.max(0, i - 3); j--) if (structuredType(fields[j].answerType)) return fields[j];
  return null;
}

/** The run of structured questions just above field `i`, nearest last. */
function runAbove(fields: readonly ConditionField[], i: number): ConditionField[] {
  const run: ConditionField[] = [];
  for (let j = i - 1; j >= 0 && structuredType(fields[j].answerType) && run.length < MAX_CONTROLLERS; j--) run.unshift(fields[j]);
  return run;
}

/** "either … above" / "both … above" / "any question above": which earlier questions, and how they combine. */
function aboveReference(body: string): { which: "two" | "run"; match: "any" | "all" } | null {
  const b = body.toLowerCase();
  if (/\b(?:either|both)\b(?:\s+of)?(?:\s+the)?(?:\s+(?:two|2))?(?:\s+(?:questions?|answers?|boxes?|items?))?\s+(?:above|before)\b/.test(b) || /\b(?:either|both) of (?:them|these)\b/.test(b)) {
    return { which: "two", match: /\bboth\b/.test(b) ? "all" : "any" };
  }
  if (/\b(?:any|all|each)\b(?:\s+of)?(?:\s+the)?(?:\s+(?:questions?|answers?|boxes?|items?))?\s+(?:above|before)\b/.test(b) || /\bany of the above\b/.test(b)) {
    return { which: "run", match: /\b(?:all|each)\b/.test(b) ? "all" : "any" };
  }
  return null;
}

/** The polarity a condition's words state outright ("yes" / "so" / "no" / "not" first, or "is Yes"), or null. */
function statedPolarity(body: string): Wants | null {
  const b = body.trim().toLowerCase();
  if (/^(?:yes|so)\b/.test(b)) return "yes";
  if (/^(?:no|not)\b/.test(b)) return "no";
  if (/^other\b/.test(b)) return "other";
  const yes = /\b(?:is|are|was|answered|ticked)\s+(?:a\s+)?["“]?yes\b|\byes\b/.test(b);
  const no = /\b(?:is|are|was|answered|ticked)\s+(?:a\s+)?["“]?no\b/.test(b);
  if (yes && !no) return "yes";
  if (no && !yes) return "no";
  return null;
}

/** The letters a lettered list names, ranges spelled out: "(a)–(d)" → a, b, c, d; [] for anything but letters. */
function lettersOf(list: string): string[] {
  const out: string[] = [];
  for (const raw of list.toLowerCase().replace(/[()]/g, " ").split(/\s*(?:,|\bor\b|\band\b|&|\/)\s*/)) {
    const part = raw.trim();
    const range = /^([a-h])\s*(?:[–—-]|\bto\b)\s*([a-h])$/.exec(part);
    const [from, to] = range ? [range[1].charCodeAt(0), range[2].charCodeAt(0)] : /^[a-h]$/.test(part) ? [part.charCodeAt(0), part.charCodeAt(0)] : [0, -1];
    if (to < from) return [];
    for (let c = from; c <= to; c++) if (!out.includes(String.fromCharCode(c))) out.push(String.fromCharCode(c));
  }
  return out;
}

/** After a bare "If yes" / "If not": an instruction ("please detail", "give the date", "why"), not more condition. */
const INSTRUCTION = /^(?:please|give|state|describe|detail|details|provide|explain|specify|list|say|comment|comments|which|what|why|when|how|who|where|enter|record|note|then|indicate|outline|add|include)\b/i;

/** A numbered question reference ("If yes to question 1", "if 3 is Yes"): never guessed. */
const NUMBERED = /\b(?:questions?|q\.?|items?|numbers?|no\.|sections?|parts?|boxes?)\s*\d|\b(?:to|for|on|in|at)\s+\d+\b|^\d+\b/i;

interface Candidate {
  field: ConditionField;
  index: number;
  /** A choice's printed option the topic names. */
  option?: string;
}

/**
 * The one structured question near field `i` whose own words cover the whole topic (rule 5), or null: none, more than
 * one, or a one-word topic that is not the nearest question before it.
 */
function namedController(fields: readonly ConditionField[], i: number, topic: readonly string[]): Candidate | null {
  const found: Candidate[] = [];
  for (let j = Math.max(0, i - 20); j <= Math.min(fields.length - 1, i + 3); j++) {
    const f = fields[j];
    if (j === i || !structuredType(f.answerType) || turned(f.label)) continue;
    const words = contentWords(f.label);
    if (f.answerType === "single_choice") {
      const hits = (f.options ?? []).filter((o) => {
        if (turned(o)) return false;
        const ow = contentWords(o);
        return covers(topic, [...words, ...ow]) && topic.some((t) => ow.some((w) => sameWord(t, w)));
      });
      if (hits.length > 1) return null;
      if (hits.length === 1) found.push({ field: f, index: j, option: hits[0] });
    } else {
      // A yes/no that asks two things at once ("worse or better?") is never read against.
      if (f.answerType === "yes_no" && /\bor\b/i.test(canonical(f.label))) continue;
      if (covers(topic, words)) found.push({ field: f, index: j });
    }
  }
  if (found.length !== 1) return null;
  if (topic.length < 2 && found[0].field !== nearestController(fields, i)) return null;
  return found[0];
}

/** Rule 5's last resort for a positive clause: a text box of the question's own printed row that names the topic. */
function rowTextController(fields: readonly ConditionField[], i: number, topic: readonly string[]): ConditionField | null {
  const row = rowOf(fields[i].label);
  if (!row) return null;
  const found = [];
  for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
    const f = fields[j];
    if (textType(f.answerType) && rowOf(f.label) === row && covers(topic, contentWords(f.label))) found.push(f);
  }
  return found.length === 1 ? found[0] : null;
}

/**
 * What a clause asks of what (rules 1–5 in the file comment), or null when it cannot be read. `anaphoric`: a bare "If
 * yes" / "If not" may be read (the question's own words; not a heading or guidance that starts "If").
 */
function readClause(fields: readonly ConditionField[], i: number, clause: Clause, opts: { anaphoric: boolean; minTopic?: number }): Frozen | null {
  const body = clause.body;
  if (!body || clause.another) return null;
  // 1. A numbered reference is never guessed.
  if (NUMBERED.test(body)) return null;
  // 2. Lettered questions it names.
  const list = LETTER_HEAD.exec(body);
  if (list) {
    const letters = lettersOf(list[1]);
    const wants = statedPolarity(body.replace(list[1], " "));
    if (letters.length < 2 || !wants || wants === "other") return null;
    const controllers: string[] = [];
    for (const letter of letters) {
      let found: ConditionField | null = null;
      for (let j = i - 1; j >= Math.max(0, i - MAX_CONTROLLERS); j--) {
        if (letterOf(fields[j].label) === letter) {
          found = fields[j];
          break;
        }
      }
      if (!found || !structuredType(found.answerType)) return null;
      controllers.unshift(found.id);
    }
    const ordered = fields.filter((f) => controllers.includes(f.id)).map((f) => f.id);
    return frozen(ordered, { wants }, clause.text, /\b(?:all|each|both)\s+of\b/i.test(body.slice(0, list.index + list[0].length - list[1].length)) ? "all" : "any");
  }
  // 3. "If yes to either question above", "If no to any question above", "if both questions above".
  const above = aboveReference(body);
  if (above) {
    const run = runAbove(fields, i);
    const controllers = (above.which === "two" ? run.slice(-2) : run).map((f) => f.id);
    const wants = statedPolarity(body);
    if (controllers.length === 0 || !wants || wants === "other" || (above.which === "two" && controllers.length < 2)) return null;
    return frozen(controllers, { wants }, clause.text, above.match);
  }
  // 4. A bare "If yes", "If so", "If not", "If no", "If other": about the nearest structured question before it.
  const bare = /^(yes|so|no|not|other)\b\s*(.*)$/i.exec(body);
  if (bare) {
    const word = bare[1].toLowerCase();
    const rest = bare[2].trim();
    if (rest === "" || INSTRUCTION.test(rest)) {
      if (!opts.anaphoric) return null;
      const near = nearestController(fields, i);
      if (!near) return null;
      if (word === "other") {
        if (near.answerType === "single_choice") return frozen([near.id], { wants: "other" }, clause.text);
        return near.answerType === "checkbox" && /\bother\b/i.test(near.label) ? frozen([near.id], { wants: "yes" }, clause.text) : null;
      }
      return frozen([near.id], { wants: word === "yes" || word === "so" ? "yes" : "no" }, clause.text);
    }
    // "If yes to …" that rules 2–3 did not read, "If other …": cannot be read. "If not gone back to work", "If no
    // improvement": a clause with content (rule 5).
    if (word !== "no" && word !== "not") return null;
  }
  // 5. A clause with content: one negation (wants No) or none (wants Yes), its whole topic named by one question.
  const canon = canonical(body);
  const negations = count(NEGATION, canon);
  const cues = count(POLARITY_CUES, canon);
  const polarity: "yes" | "no" | null = negations === 1 && cues === 1 ? "no" : cues === 0 ? "yes" : null;
  if (!polarity) return null;
  const topic = topicOf(body);
  if (topic.length === 0 || topic.length < (opts.minTopic ?? 1)) return null;
  const named = namedController(fields, i, topic);
  if (named) {
    if (named.option) return frozen([named.field.id], polarity === "yes" ? { wants: named.option } : { wantsNot: named.option }, clause.text);
    return frozen([named.field.id], { wants: polarity }, clause.text);
  }
  if (polarity === "yes") {
    const text = rowTextController(fields, i, topic);
    if (text) return frozen([text.id], { filled: true }, clause.text);
  }
  return null;
}

/** The printed heading of field `i` as a condition clause, unless it is an earlier question's own label. */
function headingClause(fields: readonly ConditionField[], i: number): Clause | null {
  const heading = (fields[i].section ?? "").replace(/\s+/g, " ").trim();
  if (!heading) return null;
  const lower = heading.toLowerCase();
  if (fields.some((f, j) => j < i && f.label.replace(/\s+/g, " ").trim().toLowerCase() === lower)) return null;
  return clauseOf(heading, "lead");
}

function newReading(fields: readonly ConditionField[], i: number): Frozen | null {
  const field = fields[i];
  // The question's own words: what they say, or unresolved.
  const own = clauseOf(field.label, "label");
  if (own) return readClause(fields, i, own, { anaphoric: true }) ?? unresolvedCondition(own.text);
  // "Only if / Only when …" anywhere in the guidance: what it says, or unresolved.
  const guidance = field.guidance ?? "";
  const only = clauseOf(guidance, "only");
  if (only) return readClause(fields, i, only, { anaphoric: true }) ?? unresolvedCondition(only.text);
  // Guidance or a heading that starts "If …": only what can be read, and only about two or more words of the question
  // it depends on (an instruction such as "If unsure, …" or "If recorded, …" is none).
  const lead = clauseOf(guidance, "lead");
  const leadReading = lead ? readClause(fields, i, lead, { anaphoric: false, minTopic: 2 }) : null;
  if (leadReading) return leadReading;
  const heading = headingClause(fields, i);
  const headingReading = heading ? readClause(fields, i, heading, { anaphoric: false, minTopic: 2 }) : null;
  if (headingReading) return headingReading;
  // "Kind – if other, which": "if other" wherever it is printed.
  if (/(?:^|[\s–—-])if other\b/i.test(field.label)) {
    const c = nearestController(fields, i);
    return c && c.answerType === "single_choice" ? frozen([c.id], { wants: "other" }, "if other") : unresolvedCondition("if other");
  }
  // "Reasons for advising more treatment": only when the yes/no just before it asks about that.
  const reasons = /^(?:the\s+)?(?:rationale|reasons?|justification|grounds)\s+(?:for|why)\s+(.+)$/i.exec(field.label.trim());
  if (reasons && !turned(reasons[1])) {
    const near = nearestController(fields, i);
    const topic = topicOf(reasons[1]);
    if (near && near.answerType !== "single_choice" && !turned(near.label) && topic.length > 0 && covers(topic, contentWords(near.label))) return frozen([near.id], { wants: "yes" }, field.label);
  }
  // "<X> – details": straight after a question of the same row that has a condition, or a yes/no about X.
  const x = detailsOf(field.label);
  if (x && i > 0) {
    const prev = fields[i - 1];
    if (rowOf(prev.label) === x.toLowerCase()) {
      const same = newReading(fields, i - 1);
      if (same && !same.unresolved) return { ...same, text: `as ${prev.id}: ${same.text ?? ""}`.slice(0, 500) };
    }
    const topic = topicOf(x);
    if (prev.answerType === "yes_no" && !turned(prev.label) && !turned(x) && topic.length > 0 && covers(topic, contentWords(prev.label))) return frozen([prev.id], { wants: "yes" }, field.label);
  }
  return null;
}

/**
 * The condition of form field `id`, read from the form's questions (in form order: the report's sections), as frozen on
 * its section when the report is created – or null for an ordinary question. A choice question answers its own
 * condition (it prints its own "Not applicable") – except one that depends on a text box of its row naming something
 * ("Limited / Cannot do", B2-13). Whatever the earlier reading recognised is recognised here too, so a report
 * this release creates never falls back to reading the printed words at run time.
 */
export function compileCondition(fields: readonly ConditionField[], id: string): FrozenCondition | null {
  const i = fields.findIndex((f) => f.id === id);
  if (i < 0) return null;
  const read = newReading(fields, i);
  if (fields[i].answerType === "single_choice") return read && read.filled === true ? read : null;
  if (read) return read;
  // The earlier reading, frozen (a superset guard: today every one of its patterns is read above).
  const wanted = conditionWanted(fields[i].label);
  if (!wanted) return null;
  return unresolvedCondition(fields[i].label);
}

/** Every frozen condition of a form's questions (field id → condition), for report creation. */
export function compileConditions(fields: readonly ConditionField[]): Map<string, FrozenCondition> {
  const out = new Map<string, FrozenCondition>();
  for (const f of fields) {
    const c = compileCondition(fields, f.id);
    if (c) out.set(f.id, c);
  }
  return out;
}

/**
 * For the drafting call (fix round 1, B0-7): which question(s) a conditional question depends on and what it asks of
 * them – "F-05 (“Is more treatment advised?”) is Yes" – or null (an ordinary or unresolved question). Read
 * exactly as compileCondition reads it.
 */
export function conditionText(fields: ReadonlyArray<ConditionField>, id: string): string | null {
  const c = compileCondition(fields, id) as Frozen | null;
  if (!c || c.unresolved || c.controllers.length === 0) return null;
  const byId = new Map(fields.map((f) => [f.id, f]));
  const named = c.controllers.map((k) => {
    const f = byId.get(k);
    return f ? `${f.id} (“${f.label.trim()}”)` : k;
  });
  if (c.filled === true) return `${named[0]} names something (not “None”)`;
  if (typeof c.wantsNot === "string") return `${named[0]} is not “${c.wantsNot}”`;
  if (!c.wants) return null;
  const ticks = c.controllers.every((k) => byId.get(k)?.answerType === "checkbox");
  const what = c.wants === "yes" ? (ticks ? "ticked" : "Yes") : c.wants === "no" ? (ticks ? "not ticked" : "No") : c.wants === "other" ? "“Other”" : `“${c.wants}”`;
  if (named.length === 1) return `${named[0]} is ${what}`;
  return c.match === "all" ? `each of ${named.join(", ")} is ${what}` : `any of ${named.join(", ")} is ${what}`;
}
