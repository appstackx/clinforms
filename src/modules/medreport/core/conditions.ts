/**
 * Conditional questions (Blue Heart fix round 1, B0-7; bh2 WA1 design 3): "IF YES, DESCRIBE IT", "If not, the
 * expected date", "Kind – if other, which", "If (a), (b) or (d) is Yes, give details", "If yes to either question
 * above, describe the pain", "Only if he or she is not yet back at work: …". Such a question belongs to one or more
 * structured questions before it. If their answers mean it does not apply, it is not asked: nothing it holds is
 * printed, its checks do not block and its gaps are settled as "not applicable".
 *
 * Read ONCE, when the report is created (compileCondition, called by core/report-factory.ts createFormReport), and
 * frozen on the section (ReportSection.condition – hashed, kept through drafting): what an approved report issues never
 * depends on a later change to this parser. The issue state (core/issue-state.ts) evaluates the frozen condition
 * against the controlling answers each time (evaluateCondition); nothing about it is ever inferred from flags or the
 * activity log.
 *
 * Reading a condition (compileCondition):
 * - where: an "If …" clause at the start of the question (after any lettering such as "(a)" or "5.") or after a clause
 *   break in it ("More treatment – if yes, describe it"); an "Only if / Only when …" clause in the question or in the
 *   map's guidance;
 * - what it wants: "yes" ("If yes", "If so", "is Yes"), "no" ("If no", "If not", and a free clause with exactly one
 *   negation – "If he is not expected back", "Only if … not yet back at work" – about the subject of the
 *   question it depends on, R-safety-9), "other" ("if other");
 * - what it depends on: the nearest structured question at most 3 before it; the lettered questions it names
 *   ("(a), (b) or (d)", "yes to b or d"); the run of structured questions just above it ("any question above"; "either"
 *   or "both … above": the two just above);
 * - anything else that reads as a condition is UNRESOLVED: the box is applicable – drafted and fully checked, never
 *   guessed (WA1 design 3). A positive free clause ("If he went back to work, …") is never matched to an answer.
 *
 * Reports from before this release (no frozen condition on the section) keep the earlier reading of the printed
 * question at run time (legacyConditionOf), exactly as they were checked and approved.
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
export const CONDITION_PARSER_VERSION = "wa1-c2";

/** Most questions one condition can name (core/schemas.ts MAX_CONDITION_CONTROLLERS). */
const MAX_CONTROLLERS = 26;

type Wants = "yes" | "no" | "other";

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

type Section = Pick<ReportSection, "key" | "title" | "answer"> & { condition?: FrozenCondition };

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
  return judge(controllers, wanted.wants, "any");
}

/* ------------------------------------------------------------------------------------------------
 * Evaluating a condition against the controlling answers
 * ----------------------------------------------------------------------------------------------*/

function judge(controllers: Section[], wants: string, match: "any" | "all"): Condition {
  if (wants === "other" || (wants !== "yes" && wants !== "no")) {
    const c = controllers[0];
    const v = c?.answer?.value;
    if (v === null || v === undefined || v === "") return { controllers, applies: null, because: "" };
    const hit = typeof v === "string" && (wants === "other" ? /\bother\b/i.test(v) : v.trim().toLowerCase() === wants.trim().toLowerCase());
    return { controllers, applies: hit, because: hit ? "" : said(c) };
  }
  const want = wants === "yes";
  const answers = controllers.map(yesNo);
  const right = (a: boolean | null) => a === want;
  const wrong = (a: boolean | null) => a === !want;
  if (match === "all") {
    if (answers.every(right)) return { controllers, applies: true, because: "" };
    if (answers.some(wrong)) return { controllers, applies: false, because: controllers.filter((_, k) => wrong(answers[k])).map(said).join(" and ") };
    return { controllers, applies: null, because: "" };
  }
  if (answers.some(right)) return { controllers, applies: true, because: "" };
  if (answers.every(wrong)) return { controllers, applies: false, because: controllers.map(said).join(" and ") };
  return { controllers, applies: null, because: "" };
}

/**
 * A frozen condition against the report's sections: applies true / false, or null when it is unresolved or the
 * controlling answers are not known yet (the box then applies). A controller the report does not hold is unknown.
 */
export function evaluateCondition(condition: FrozenCondition, sections: readonly Section[]): Condition {
  const byKey = new Map(sections.map((s) => [s.key, s]));
  const controllers = condition.controllers.map((k) => byKey.get(k)).filter((s): s is Section => Boolean(s));
  if (condition.unresolved || !condition.wants || controllers.length === 0 || controllers.length !== condition.controllers.length) {
    return { controllers, applies: null, because: "", frozen: true };
  }
  return { ...judge(controllers, condition.wants, condition.match ?? "any"), frozen: true };
}

/**
 * The condition of `key`, or null for an ordinary question: the section's frozen condition (this release), else the
 * earlier reading of its printed question (a report from before the release). With the "condition-parser" hook
 * disabled (corpus ledger seam) every question is ordinary.
 */
export function conditionOf(sections: readonly Section[], key: string): Condition | null {
  if (!hookEnabled(CONDITION_PARSER_HOOK)) return null;
  const section = sections.find((s) => s.key === key);
  if (!section) return null;
  if (section.condition) return evaluateCondition(section.condition, sections);
  return legacyConditionOf(sections, key);
}

/** Whether `key` is a conditional question that does not apply (the answers before it say so). */
export function notApplicable(sections: readonly Section[], key: string): Condition | null {
  const c = conditionOf(sections, key);
  return c && c.applies === false ? c : null;
}

/* ------------------------------------------------------------------------------------------------
 * Reading the condition once, from the form map (report creation)
 * ----------------------------------------------------------------------------------------------*/

/** What the parser reads of a form's questions (a FormField, or the drafting call's field list). */
export interface ConditionField {
  id: string;
  label: string;
  guidance?: string;
  answerType: string;
}

const structuredType = (t: string) => t === "yes_no" || t === "checkbox" || t === "single_choice";

/** The lettering a question is printed with: "(b) …", "b) …", "b. …" → "b". */
function letterOf(label: string): string | null {
  const m = /^\s*\(([a-z])\)\s*|^\s*([a-z])[.)]\s+/i.exec(label);
  return m ? (m[1] ?? m[2]).toLowerCase() : null;
}

/**
 * Words that say nothing about WHAT a question asks (topic overlap of a free clause): function words, and the people
 * every question is about ("the patient", "the client", "the employee").
 */
const FUNCTION_WORDS = new Set(
  "a an the and or but if only when whether is are was were be been being has have had do does did not no nor never yet still any all either both each this that these those there here it its he she him her his hers they them their theirs you your yours we our us i me my of to in on at for from by with as into onto about above below than then so such can could will would shall should may might must please give state describe detail details provide explain expected date who what which why how patient patients client clients employee employees claimant claimants person injured".split(
    " ",
  ),
);

function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().replace(/[’']/g, "'").split(/[^a-z0-9']+/)) {
    const word = w.replace(/'s$/, "");
    if (word.length < 3 || FUNCTION_WORDS.has(word)) continue;
    // A crude stem, so "returned" meets "return" and "working" meets "work".
    out.add(word.replace(/(?:ing|ed|es|s)$/, "") || word);
  }
  return out;
}

const NEGATION = /\b(?:not|never|no longer|cannot)\b|n't\b/gi;
/** Every word that turns a clause the other way – a plain negation, or a word that negates by itself ("off", "unable"). */
const POLARITY_CUES = /\b(?:not|never|no longer|cannot|unable|without|off|absent|unfit)\b|n't\b/gi;

/** An "If …" or "Only if / Only when …" clause: where it starts in the text and the words of its condition. */
interface Clause {
  /** The condition's own words (after "if"). */
  body: string;
  /** The printed words it was read from (for the review and the activity log). */
  text: string;
  /** "only if" / "only when". */
  only: boolean;
}

/** The first condition clause of a printed question (or of its guidance, `guidance` true: "Only if/when" clauses only). */
function clauseOf(text: string, guidance: boolean): Clause | null {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return null;
  // The question: "If …" / "Only if …" at its start (after any lettering) or after a clause break ("… – if yes, …").
  // The guidance: only "Only if / Only when …" ("If unsure, leave it blank" is an instruction, not a condition).
  const re = guidance
    ? /(?:^|[.;:–—(]\s*|\s-\s)(only if|only when)\s+(.+)$/i
    : /(?:^(?:\(?[a-z0-9]{1,3}[.)]\s*)?|[,;:–—(]\s*|\s-\s)(only if|only when|if)\s+(.+)$/i;
  const m = re.exec(t);
  if (!m) return null;
  const rest = m[2];
  // The condition runs to the first clause break – but a lettered list ("(a), (b) or (d)") keeps its commas.
  const lettered = /^(?:(?:yes|no)\s+(?:to|for|on)\s+)?(?:\(?[a-h]\)?\s*(?:,|\bor\b|\band\b|&|\/)\s*)+\(?[a-h]\)?(?=[\s,.:;?)–—]|$)/i.exec(rest);
  const head = lettered ? lettered[0] : "";
  const tail = rest.slice(head.length);
  const end = tail.search(/[,:;?–—)]|\s-\s|\.(?:\s|$)/);
  const body = (head + (end < 0 ? tail : tail.slice(0, end))).trim();
  return { body, text: `${m[1]} ${(head + (end < 0 ? tail : tail.slice(0, end))).trim()}`.slice(0, 500), only: /^only/i.test(m[1]) };
}

/** A compiled condition (the frozen shape), or null for an ordinary question. */
function frozen(controllers: string[], wants: Wants, text: string, match?: "any" | "all"): FrozenCondition {
  return { controllers, wants, ...(match && controllers.length > 1 ? { match } : {}), text, parser: CONDITION_PARSER_VERSION };
}

function unresolvedCondition(text: string): FrozenCondition {
  return { controllers: [], unresolved: true, text, parser: CONDITION_PARSER_VERSION };
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

function newReading(fields: readonly ConditionField[], i: number): FrozenCondition | null {
  const field = fields[i];
  const clause = clauseOf(field.label, false) ?? clauseOf(field.guidance ?? "", true);
  if (!clause) {
    // "Kind – if other, which": "if other" wherever it is printed.
    if (/(?:^|[\s–—-])if other\b/i.test(field.label)) {
      const c = nearestController(fields, i);
      return c ? frozen([c.id], "other", "if other") : unresolvedCondition("if other");
    }
    return null;
  }
  const body = clause.body;
  // 1. Lettered questions it names: "(a), (b) or (d) is Yes", "yes to b or d".
  const list = /^(?:(?:yes|no)\s+(?:to|for|on)\s+)?((?:\(?[a-h]\)?\s*(?:,|\bor\b|\band\b|&|\/)\s*)+\(?[a-h]\)?)(?=[\s,.:;?)–—]|$)/i.exec(body);
  if (list) {
    const letters = Array.from(list[1].matchAll(/\(?([a-h])\)?/gi), (m) => m[1].toLowerCase());
    const wants = statedPolarity(body.replace(list[1], " "));
    const controllers: string[] = [];
    for (const letter of letters) {
      let found: ConditionField | null = null;
      for (let j = i - 1; j >= Math.max(0, i - MAX_CONTROLLERS); j--) {
        if (letterOf(fields[j].label) === letter) {
          found = fields[j];
          break;
        }
      }
      if (!found || !structuredType(found.answerType)) return unresolvedCondition(clause.text);
      controllers.unshift(found.id);
    }
    if (!wants || wants === "other") return unresolvedCondition(clause.text);
    const ordered = fields.filter((f) => controllers.includes(f.id)).map((f) => f.id);
    return frozen(ordered, wants, clause.text, /\band\b|&/i.test(list[1]) && !/\bor\b/i.test(list[1]) ? "all" : "any");
  }
  // 2. "If yes to either question above", "If no to any question above", "if both questions above".
  const above = aboveReference(body);
  if (above) {
    const run = runAbove(fields, i);
    const controllers = (above.which === "two" ? run.slice(-2) : run).map((f) => f.id);
    const wants = statedPolarity(body) ?? null;
    if (controllers.length === 0 || !wants || wants === "other" || (above.which === "two" && controllers.length < 2)) return unresolvedCondition(clause.text);
    return frozen(controllers, wants, clause.text, above.match);
  }
  // 3. "If yes", "If so", "If not", "If no", "If other": about the nearest structured question before it.
  const stated = /^(?:yes|so|no|not|other)\b/i.test(body) ? statedPolarity(body) : null;
  const near = nearestController(fields, i);
  if (stated) return near ? frozen([near.id], stated, clause.text) : unresolvedCondition(clause.text);
  // 4. A free clause: exactly one negation, about the subject of the question before it, wants "No" (R-safety-9:
  //    "Only if … not yet back at work"). Anything else is never matched to an answer: unresolved, so it applies.
  // One plain negation and no other word that turns it ("not off work" is never guessed), and a question before it that
  // is not itself turned ("Is the patient unable to work?").
  const negations = (body.match(NEGATION) ?? []).length;
  const cues = (body.match(POLARITY_CUES) ?? []).length;
  if (negations === 1 && cues === 1 && near && near.answerType !== "single_choice" && (near.label.match(POLARITY_CUES) ?? []).length === 0) {
    const topic = contentWords(body.replace(NEGATION, " "));
    const shared = Array.from(contentWords(near.label)).filter((w) => topic.has(w));
    if (shared.length > 0) return frozen([near.id], "no", clause.text);
  }
  return unresolvedCondition(clause.text);
}

/**
 * The condition of form field `id`, read from the form's questions (in form order: the report's sections), as frozen on
 * its section when the report is created – or null for an ordinary question. A choice question answers its own
 * condition (it prints its own "Not applicable"). Whatever the earlier reading recognised is recognised here too, so a
 * report this release creates never falls back to reading the printed words at run time.
 */
export function compileCondition(fields: readonly ConditionField[], id: string): FrozenCondition | null {
  const i = fields.findIndex((f) => f.id === id);
  if (i < 0 || fields[i].answerType === "single_choice") return null;
  const read = newReading(fields, i);
  if (read) return read;
  // The earlier reading, frozen (a superset guard: today every one of its patterns is read above).
  const wanted = conditionWanted(fields[i].label);
  if (!wanted) return null;
  if (wanted.anyOfAbove) {
    const run = runAbove(fields, i).map((f) => f.id);
    return run.length ? frozen(run, wanted.wants, fields[i].label.slice(0, 500), "any") : unresolvedCondition(fields[i].label.slice(0, 500));
  }
  const near = nearestController(fields, i);
  return near ? frozen([near.id], wanted.wants, fields[i].label.slice(0, 500)) : unresolvedCondition(fields[i].label.slice(0, 500));
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
  const c = compileCondition(fields, id);
  if (!c || c.unresolved || !c.wants || c.controllers.length === 0) return null;
  const what = c.wants === "yes" ? "Yes" : c.wants === "no" ? "No" : c.wants === "other" ? "“Other”" : `“${c.wants}”`;
  const named = c.controllers.map((k) => {
    const f = fields.find((x) => x.id === k);
    return f ? `${f.id} (“${f.label.trim()}”)` : k;
  });
  if (named.length === 1) return `${named[0]} is ${what}`;
  return c.match === "all" ? `each of ${named.join(", ")} is ${what}` : `any of ${named.join(", ")} is ${what}`;
}
