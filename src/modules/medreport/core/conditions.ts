/**
 * Conditional questions (Blue Heart fix round 1, B0-7): "IF YES, PLEASE DETAIL", "If not back at work, expected return
 * to work date", "Frequency – if other, details", "If yes to any of the above, note detail". Such a question belongs to
 * the yes/no or choice question just before it on the form; when that answer means it does not apply, it is not asked:
 * nothing it holds is printed, its checks do not block and its gaps are settled as "not applicable" (the review's
 * reducer, audited). When the answer before it is not known yet, it is an ordinary question – and so is a choice question,
 * which answers its own condition (it prints its own "Not applicable").
 *
 * Read from the report alone – a form section's title is its question as printed – so the browser, the server and the
 * forms engine decide it the same way. Pure; browser and server.
 */
import type { ReportSection } from "./types";

type Wants = "yes" | "no" | "other";

const LEAD = String.raw`^(?:\(?[a-z0-9]{1,3}[.)]\s*)?`;

/** What the question's own condition asks of the answer before it, or null for an ordinary question. */
export function conditionWanted(title: string): { wants: Wants; anyOfAbove: boolean } | null {
  const t = title.trim();
  const anyOfAbove = /\bany of the above\b/i.test(t);
  if (new RegExp(`${LEAD}if (?:yes|so)\\b`, "i").test(t)) return { wants: "yes", anyOfAbove };
  if (new RegExp(`${LEAD}if (?:no|not)\\b`, "i").test(t)) return { wants: "no", anyOfAbove };
  if (/(?:^|[\s–—-])if other\b/i.test(t)) return { wants: "other", anyOfAbove: false };
  return null;
}

type Section = Pick<ReportSection, "key" | "title" | "answer">;

const isStructured = (s: Section) => s.answer !== undefined && (s.answer.kind === "yes_no" || s.answer.kind === "checkbox" || s.answer.kind === "choice");

/** true / false for a yes/no answer (a choice printed "Yes" / "No" too), null when it is neither or not given. */
function yesNo(s: Section): boolean | null {
  const v = s.answer?.value;
  if (typeof v === "boolean") return v;
  if (typeof v === "string" && /^y(?:es)?$/i.test(v.trim())) return true;
  if (typeof v === "string" && /^no?$/i.test(v.trim())) return false;
  return null;
}

export interface Condition {
  /** The question(s) it depends on. */
  controllers: Section[];
  /** true: it applies; false: it does not (the answer before it says so); null: not known yet. */
  applies: boolean | null;
  /** "“ANY FURTHER TREATMENT RECOMMENDED?” is “NO”" – for the review and the audit trail. */
  because: string;
}

/**
 * The condition of `key`, or null for an ordinary question. Its controller is the nearest yes/no or choice question at
 * most 3 questions before it ("any of the above": the run of yes/no questions just before it).
 */
export function conditionOf(sections: readonly Section[], key: string): Condition | null {
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
  const said = (s: Section) => {
    const v = s.answer?.value;
    return `“${s.title.trim()}” is “${typeof v === "boolean" ? (v ? "Yes" : "No") : String(v ?? "")}”`;
  };
  if (wanted.wants === "other") {
    const v = controllers[0].answer?.value;
    if (v === null || v === undefined || v === "") return { controllers, applies: null, because: "" };
    return { controllers, applies: typeof v === "string" && /\bother\b/i.test(v), because: said(controllers[0]) };
  }
  const answers = controllers.map(yesNo);
  if (wanted.wants === "yes") {
    if (answers.some((a) => a === true)) return { controllers, applies: true, because: "" };
    if (answers.every((a) => a === false)) return { controllers, applies: false, because: controllers.map(said).join(" and ") };
    return { controllers, applies: null, because: "" };
  }
  if (answers.some((a) => a === false)) return { controllers, applies: true, because: "" };
  if (answers.every((a) => a === true)) return { controllers, applies: false, because: controllers.map(said).join(" and ") };
  return { controllers, applies: null, because: "" };
}

/** Whether `key` is a conditional question that does not apply (its answer before it says so). */
export function notApplicable(sections: readonly Section[], key: string): Condition | null {
  const c = conditionOf(sections, key);
  return c && c.applies === false ? c : null;
}

/**
 * For the drafting call (fix round 1, B0-7): which question a conditional question of the form map depends on and what
 * it asks of it – "F-32 (“ANY FURTHER TREATMENT RECOMMENDED?”) is Yes" – or null. The nearest yes/no or choice
 * question at most 3 before it, as conditionOf() decides it on a report.
 */
export function conditionText(fields: ReadonlyArray<{ id: string; label: string; answerType: string }>, id: string): string | null {
  const i = fields.findIndex((f) => f.id === id);
  const wanted = i >= 0 && fields[i].answerType !== "single_choice" ? conditionWanted(fields[i].label) : null;
  if (!wanted) return null;
  const structured = (f: { answerType: string }) => f.answerType === "yes_no" || f.answerType === "checkbox" || f.answerType === "single_choice";
  for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
    if (!structured(fields[j])) continue;
    const what = wanted.wants === "yes" ? "Yes" : wanted.wants === "no" ? "No" : "“Other”";
    return `${wanted.anyOfAbove ? "any of the questions just before it" : `${fields[j].id} (“${fields[j].label.trim()}”)`} is ${what}`;
  }
  return null;
}
