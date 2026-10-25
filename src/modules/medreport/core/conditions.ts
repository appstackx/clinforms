/**
 * Conditional questions (Blue Heart fix round 1, B0-7; fix round 2, B1-1, B1-5, B1-9, B1-11): "IF YES, PLEASE DETAIL",
 * "If not back at work, expected return to work date", "Frequency – if other, details", "If yes to any of the above, note
 * detail", "If yes for b, c or d above…", "If no for either of the above…", "If you do not anticipate a full recovery…",
 * "If the condition is worsening…". Such a question belongs to the yes/no, tick or choice question(s) its condition
 * names – the nearest one before it unless it names others; when their answers mean it does not apply, it is not asked:
 * nothing it holds is printed, its checks do not block and its gaps are settled as "not applicable" (the review's
 * reducer, audited). When the answers are not known yet, it is an ordinary question – and so is a choice question,
 * which answers its own condition (it prints its own "Not applicable").
 *
 * A question may also carry its condition outside its label (fix round 2, B1-9): the printed heading it sits under ("If
 * employee is not on full duties, please list…") or its map guidance ("Only when the lifting restriction is kept…") –
 * kept on the report section as `condition` (conditionTextOf, at creation). Two more reasons a question does not apply:
 * - a person marked it so (`markedNotApplicable`): a yes/no whose own label carries a condition on the facts ("a. If
 *   the client was … off work at the time of the assessment, is the client at work now?") is never drafted – the
 *   clinician answers it or marks it not applicable (B1-5);
 * - a numbered session the record does not have ("Session date 7" when 5 sessions were attended, B1-11).
 *
 * Read from the report alone – a form section's title is its question as printed – so the browser, the server and the
 * forms engine decide it the same way. Pure; browser and server.
 */
import type { ReportSection } from "./types";

type Wants = "yes" | "no" | "other" | "option" | "not_option" | "filled";

/** What a condition asks of the answer(s) it depends on. */
export interface Wanted {
  wants: Wants;
  /** The run of yes/no questions just before it ("any / all of the above"). */
  anyOfAbove: boolean;
  /** "either / both of the above": the last two of that run. */
  lastTwo?: boolean;
  /** "If yes for b, c or d above": the lettered questions it names. */
  letters?: string[];
  /** The words naming the question it depends on ("If you do not anticipate a full recovery" → full, recovery). */
  names?: string[];
  /** The controller's printed question must match this ("Work status", "Is further treatment necessary?"). */
  titled?: RegExp;
  /** wants option / not_option: the chosen option it is about ("worsening", "normal role"), and in words. */
  option?: RegExp;
  optionLabel?: string;
}

const LEAD = String.raw`(?:^(?:\(?[a-z0-9]{1,3}[.)]\s*)?|\s[-–—]\s*|:\s+)`;
const LETTERS = String.raw`\(?([a-h])\)?((?:\s*(?:,|\bor\b|\band\b|&|\/)\s*\(?[a-h]\)?)+)\s+above\b`;
/** Words that do not name a question ("If you do not recommend home exercises at this stage"). */
const NAME_STOPWORDS = new Set(["the", "a", "an", "at", "this", "that", "these", "stage", "any", "of", "to", "for", "in", "on", "with", "is", "are", "be", "kept", "planned", "required", "given", "client", "patient", "claimant", "employee", "treatment", "and", "or", "it", "their", "his", "her"]);

function nameWords(clause: string): string[] {
  return (clause.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length > 2 && !NAME_STOPWORDS.has(w));
}

/** What the question's own condition asks of the answer before it, or null for an ordinary question. */
export function conditionWanted(title: string): Wanted | null {
  const t = title.trim();
  const anyOfAbove = /\b(?:any|all) of the above\b/i.test(t);
  const lastTwo = /\b(?:either|both) of the above\b/i.test(t);
  const lettered = (wants: "yes" | "no"): Wanted | null => {
    const m = new RegExp(`\\bif (?:yes|so|no|not)\\b[^.?]*?${LETTERS}`, "i").exec(t);
    if (!m) return null;
    const rest = m[2].split(/\s*(?:,|\bor\b|\band\b|&|\/)\s*/).map((x) => x.replace(/[()\s]/g, ""));
    const letters = [m[1], ...rest].filter((l) => /^[a-h]$/i.test(l)).map((l) => l.toLowerCase());
    return { wants, anyOfAbove: false, letters: Array.from(new Set(letters)) };
  };
  const yesNo = (wants: "yes" | "no"): Wanted => lettered(wants) ?? (lastTwo ? { wants, anyOfAbove: true, lastTwo: true } : { wants, anyOfAbove: anyOfAbove || lastTwo });
  if (new RegExp(`${LEAD}if (?:yes|so)\\b`, "i").test(t)) return yesNo("yes");
  if (new RegExp(`${LEAD}if (?:no|not)\\b`, "i").test(t)) return yesNo("no");
  if (/(?:^|[\s–—-])if other\b/i.test(t)) return { wants: "other", anyOfAbove: false };
  // Fix round 2 (B1-9): "If you do not anticipate a full recovery, …" – a "No" (or not ticked) on the question it names.
  const negative = /^(?:\(?[a-z0-9]{1,3}[.)]\s*)?if you (?:do not|don't) (?:anticipate|expect|recommend|consider|advise|think|feel|plan)\s+([^,.?;]+)/i.exec(t);
  if (negative && nameWords(negative[1]).length > 0) return { wants: "no", anyOfAbove: false, names: nameWords(negative[1]) };
  // "If the condition is worsening, what do you recommend?" – only when the choice before it is "Worsening".
  const state = /^(?:\(?[a-z0-9]{1,3}[.)]\s*)?if (?:the |their |his |her )?(?:condition|injury|symptoms?|pain|problem)\s+(?:is|are|has|have)\s+(?:been\s+)?(worsening|worsened|getting worse|improving|improved|unchanged|resolved)\b/i.exec(t);
  if (state) return { wants: "option", anyOfAbove: false, option: new RegExp(`\\b${state[1].toLowerCase().slice(0, 6)}`, "i"), optionLabel: state[1].charAt(0).toUpperCase() + state[1].slice(1).toLowerCase() };
  // "If employee is not on full duties, please list…" (a printed heading) – unless the work status is the normal role.
  if (/\bif (?:the )?(?:employee|client|patient|claimant) is not (?:on|back on|back to) (?:full|normal) (?:duties|role)\b/i.test(t)) {
    return { wants: "not_option", anyOfAbove: false, titled: /\bwork status\b|\bemployment status\b|\bduties\b/i, option: /\b(?:normal role|full duties|normal duties)\b/i, optionLabel: "the normal role (full duties)" };
  }
  // Fix round 3 (B2-13): "Only when an activity is still restricted" – the row's activity cell names one (not "None").
  const still = /^only (?:when|if) (?:an? |the )?([a-z][a-z -]*?) (?:is|are) still (?:restricted|limited|affected|impaired)\b/i.exec(t);
  if (still && nameWords(still[1]).length > 0) return { wants: "filled", anyOfAbove: false, names: nameWords(still[1]) };
  // "Only when the lifting restriction is kept: …" (map guidance) – the tick or yes/no it names is ticked / Yes.
  const onlyWhen = /^only (?:when|if)\s+([^:;.]+)/i.exec(t);
  if (onlyWhen && !/\bother\b/i.test(onlyWhen[1]) && nameWords(onlyWhen[1]).length > 0) return { wants: "yes", anyOfAbove: false, names: nameWords(onlyWhen[1]) };
  // "Rationale for recommending further treatment" – only when further treatment is recommended.
  if (/^(?:the )?(?:rationale|reasons?|justification) for (?:recommending |requesting )?(?:further|additional) (?:treatment|sessions)\b/i.test(t)) {
    return { wants: "yes", anyOfAbove: false, titled: /\b(?:further|additional) (?:treatment|sessions)\b.*\b(?:necessary|recommended|required|needed)\b|\b(?:necessary|recommended|required|needed)\b.*\b(?:further|additional) (?:treatment|sessions)\b/i };
  }
  return null;
}

/**
 * A yes/no whose own printed question carries a condition on the facts – "a. If the client was working prior to the
 * accident but was off work at the time of the assessment, is the client at work now?" – returns that condition ("the
 * client was working prior to the accident but was off work at the time of the assessment"); null otherwise (fix round
 * 2, B1-5). Such a question is never drafted: the clinician answers it or marks it not applicable.
 */
export function factCondition(title: string): string | null {
  const m = /^(?:\(?[a-z0-9]{1,3}[.)]\s*)?if\s+(.+?),\s*((?:is|are|was|were|has|have|does|do|did|can|could|will|would)\b[^?]*\?)\s*$/i.exec(title.trim());
  if (!m || /^(?:yes|so|no|not|other)\b/i.test(m[1]) || /\b(?:above|below)\b/i.test(m[1])) return null;
  return m[1].trim();
}

/**
 * The printed condition a form field carries outside its own label, for the report section (`condition`): its map
 * guidance when it says "Only when …" / "If …" or numbers a session "after the assessment", else its printed section
 * heading when that starts "If …" and is not an earlier question's own label (a sub-question). Null when there is none.
 */
export function conditionTextOf(
  field: { label: string; guidance?: string; section?: string | null },
  fields: ReadonlyArray<{ label: string }> = [],
): string | null {
  const guidance = (field.guidance ?? "").replace(/\s+/g, " ").trim();
  if (/^(?:only (?:when|if)|if)\b/i.test(guidance) || /\bafter the (?:initial )?assessment\b/i.test(guidance)) return guidance.slice(0, 400);
  // Fix round 3 (B2-13): an "Only when …" sentence later in the guidance ("Restricted or Unable to perform – the other
  // is deleted. Only when an activity is still restricted.").
  const later = /(?:^|[.;]\s+)(only (?:when|if)\b[^.;]*)/i.exec(guidance);
  if (later) return later[1].trim().slice(0, 400);
  const heading = (field.section ?? "").replace(/\s+/g, " ").trim();
  if (/^if\b/i.test(heading) && !fields.some((f) => f.label.trim().toLowerCase() === heading.toLowerCase())) return heading.slice(0, 400);
  return null;
}

type Section = Pick<ReportSection, "key" | "title" | "answer"> & Partial<Pick<ReportSection, "condition" | "markedNotApplicable" | "paragraphs">>;

/** withFormConditions() on a whole report (the same report when nothing is added). */
export function withReportConditions<R extends { sections: ReportSection[] }>(report: R, form: { fields: ReadonlyArray<{ id: string; label: string; guidance?: string; section?: string | null }> } | null | undefined): R {
  if (!form) return report;
  const sections = withFormConditions(report.sections, form.fields);
  return sections === report.sections ? report : { ...report, sections };
}

/**
 * Fix round 3 (B2-4): sections with the condition their form field carries (conditionTextOf) put back where a section has
 * none – a report drafted before the condition was kept through drafting. Returns `sections` itself when nothing is added.
 */
export function withFormConditions<S extends Section>(sections: readonly S[], fields: ReadonlyArray<{ id: string; label: string; guidance?: string; section?: string | null }>): S[] {
  let changed = false;
  const out = sections.map((s) => {
    if (s.condition) return s;
    const field = fields.find((f) => f.id === s.key);
    const condition = field ? conditionTextOf(field, fields) : null;
    if (!condition) return s;
    changed = true;
    return { ...s, condition };
  });
  return changed ? out : (sections as S[]);
}

/** The question as the condition rules read it: its printed title, its kind and the condition it carries elsewhere. */
interface Item {
  key: string;
  title: string;
  kind: "yes_no" | "checkbox" | "choice" | null;
  condition?: string;
}

const itemOf = (s: Section): Item => ({
  key: s.key,
  title: s.title,
  kind: s.answer?.kind === "yes_no" || s.answer?.kind === "checkbox" || s.answer?.kind === "choice" ? s.answer.kind : null,
  ...(s.condition ? { condition: s.condition } : {}),
});

/** The question's condition: from its own label first, else from the heading or guidance it carries. */
function wantedOf(item: Item): Wanted | null {
  return conditionWanted(item.title) ?? (item.condition ? conditionWanted(item.condition) : null);
}

/** "Barriers to recovery – details" → "Barriers to recovery"; null for any other label. */
function detailsOf(title: string): string | null {
  return /^(.+?)\s+[–—-]\s+(?:details?|comments?|please (?:give details|specify)|specify)\s*:?$/i.exec(title.trim())?.[1].trim() ?? null;
}

/**
 * Fix round 3 (B2-5, B2-13): a "<X> – details" question with no condition of its own belongs to the question straight
 * before it when that one is about the same X:
 * - a yes/no that names X ("Is there evidence of any barriers to recovery?" before "Barriers to recovery – details"):
 *   it applies only on "Yes" – "No" makes it not applicable, and it prints blank;
 * - a question of the same row ("Restrictions on daily living – status" before "… – details") that has a condition:
 *   it applies when that one does.
 * Returns the index of that question and how it depends on it, or null.
 */
function detailsController(items: readonly Item[], i: number): { j: number; wanted: Wanted | "same" } | null {
  const x = detailsOf(items[i].title);
  const j = i - 1;
  if (!x || j < 0) return null;
  const prev = items[j];
  const words = nameWords(x);
  if (prev.kind === "yes_no" && words.length > 0 && nameScore(words, prev.title) === words.length) return { j, wanted: { wants: "yes", anyOfAbove: false, names: words } };
  const prevRow = /^(.+?)\s+[–—-]\s+/.exec(prev.title.trim())?.[1].trim().toLowerCase();
  if (prevRow === x.toLowerCase() && wantedOf(prev)) return { j, wanted: "same" };
  return null;
}

/** "None", "N/A", "nil", "nothing", "no restrictions" – a cell that names nothing. */
const NAMES_NOTHING = /^(?:none(?: reported| recorded)?|n\/?a|nil|nothing|not applicable|no(?:ne)? restrictions?|no restriction)\.?$/i;

/** The text a question holds (its paragraphs, or a structured value), trimmed. */
function heldText(s: Section): string {
  const v = s.answer?.value;
  if (typeof v === "string" && v.trim()) return v.trim();
  return (s.paragraphs ?? []).map((p) => p.text).join(" ").trim();
}

/** The letter a lettered question starts with ("b. Has the client…" → "b"), or null. */
const letterOf = (title: string) => /^\(?([a-h])[.)]\s/i.exec(title.trim())?.[1].toLowerCase() ?? null;

/** Content words shared with a question's printed title, matched on their stem ("restriction" ~ "restrictions"). */
function nameScore(names: readonly string[], title: string): number {
  const words = title.toLowerCase().match(/[a-z]+/g) ?? [];
  return names.filter((n) => words.some((w) => w.slice(0, 5) === n.slice(0, 5) && Math.abs(w.length - n.length) <= 3)).length;
}

/** Indexes of the question(s) item i depends on, by its condition; [] when none is found. */
function controllersOf(items: readonly Item[], i: number, wanted: Wanted): number[] {
  const structured = (j: number) => items[j].kind !== null && j !== i;
  if (wanted.letters) {
    const out: number[] = [];
    for (let j = i - 1; j >= Math.max(0, i - 12); j--) if (structured(j) && wanted.letters.indexOf(letterOf(items[j].title) ?? "") >= 0) out.unshift(j);
    if (out.length > 0) return out;
  }
  if (wanted.anyOfAbove) {
    const run: number[] = [];
    for (let j = i - 1; j >= 0 && structured(j); j--) run.unshift(j);
    return wanted.lastTwo ? run.slice(-2) : run;
  }
  if (wanted.wants === "filled") {
    // The nearest text question at most 3 before it whose label names the same thing ("… – activity").
    for (let j = i - 1; j >= Math.max(0, i - 3); j--) if (items[j].kind === null && nameScore(wanted.names ?? [], items[j].title) > 0) return [j];
    return [];
  }
  if (wanted.names) {
    let best = -1;
    let score = 0;
    const consider = (j: number) => {
      if (j < 0 || j >= items.length || !structured(j) || items[j].kind === "choice") return;
      const s = nameScore(wanted.names as string[], items[j].title);
      if (s > score) {
        best = j;
        score = s;
      }
    };
    for (let j = i - 1; j >= Math.max(0, i - 20); j--) consider(j);
    for (let j = i + 1; j <= Math.min(items.length - 1, i + 3); j++) consider(j);
    return best >= 0 && score >= Math.min(2, wanted.names.length) ? [best] : [];
  }
  if (wanted.titled) {
    for (let j = i - 1; j >= Math.max(0, i - 8); j--) if (structured(j) && wanted.titled.test(items[j].title)) return [j];
    return [];
  }
  // The nearest yes/no or choice question at most 3 before it ("option": the nearest choice).
  for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
    if (!structured(j)) continue;
    if (wanted.wants === "option" && items[j].kind !== "choice") continue;
    return [j];
  }
  return [];
}

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
 * The condition of `key`, or null for an ordinary question. Its controller is the question its condition names – the
 * lettered ones ("b, c or d above"), the run just before it ("any of the above"; "either of the above": its last two),
 * the one whose words it uses ("If you do not anticipate a full recovery") – else the nearest yes/no or choice question
 * at most 3 questions before it.
 */
export function conditionOf(sections: readonly Section[], key: string): Condition | null {
  const i = sections.findIndex((s) => s.key === key);
  if (i < 0) return null;
  const items = sections.map(itemOf);
  let wanted = wantedOf(items[i]);
  if (!wanted) {
    const details = detailsController(items, i);
    if (details?.wanted === "same") return conditionOf(sections, sections[details.j].key);
    wanted = details?.wanted ?? null;
  }
  // A choice question answers its own condition ("5. If not, are they fit for modified duties?" prints "Not applicable") –
  // except one that depends on a cell naming something (fix round 3, B2-13: "Restricted / Unable to perform").
  if (!wanted || (sections[i].answer?.kind === "choice" && wanted.wants !== "filled")) return null;
  // A question it depends on that itself does not apply (marked so by a person) does not count.
  const controllers = controllersOf(items, i, wanted)
    .map((j) => sections[j])
    .filter((s) => !s.markedNotApplicable);
  if (controllers.length === 0) return null;
  const valueText = (s: Section) => {
    const v = s.answer?.value;
    if (typeof v === "boolean") return s.answer?.kind === "checkbox" ? (v ? "Ticked" : "Not ticked") : v ? "Yes" : "No";
    return String(v ?? "");
  };
  const said = (s: Section) => `“${s.title.trim()}” is “${valueText(s)}”`;
  if (wanted.wants === "filled") {
    const held = heldText(controllers[0]);
    if (!held) return { controllers, applies: null, because: "" };
    const nothing = NAMES_NOTHING.test(held);
    return { controllers, applies: !nothing, because: nothing ? `“${controllers[0].title.trim()}” is “${held.replace(/\.$/, "")}”` : "" };
  }
  if (wanted.wants === "other" || wanted.wants === "option" || wanted.wants === "not_option") {
    const v = controllers[0].answer?.value;
    if (v === null || v === undefined || v === "") return { controllers, applies: null, because: "" };
    const text = typeof v === "string" ? v : String(v);
    const hit = wanted.wants === "other" ? /\bother\b/i.test(text) : (wanted.option as RegExp).test(text);
    const applies = wanted.wants === "not_option" ? !hit : hit;
    return { controllers, applies, because: applies ? "" : said(controllers[0]) };
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

/* ------------------------------------------------------------------------------------------------
 * Numbered sessions the record does not have (fix round 2, B1-11)
 * ----------------------------------------------------------------------------------------------*/

/** The session number of "Session date 7", "Treatment date 5", "Session 7 – time" / "– duration", or null. */
export function sessionNumberOf(title: string): number | null {
  const t = title.trim();
  const m =
    /^(?:attended\s+)?(?:treatment\s+)?(?:session|treatment|appointment|visit)\s+(?:date|time|duration|length)\s+(\d{1,2})$/i.exec(t) ??
    /^(?:attended\s+)?(?:treatment\s+)?(?:session|treatment|appointment|visit)\s+(\d{1,2})\s*[–—:-]\s*(?:date|time|duration|length)\b/i.exec(t);
  return m ? Number(m[1]) : null;
}

interface RecordLike {
  appointments?: ReadonlyArray<{ status: string }>;
}

/**
 * Why a numbered session's question does not apply – "only 4 treatment sessions after the assessment were attended" –
 * or null. Counted from the record's attended appointments (the first is the assessment when the question counts
 * sessions "after the assessment"); never when the record has no attended appointment.
 */
export function sessionNotInRecord(section: Pick<Section, "title" | "condition">, record: RecordLike | undefined): string | null {
  const n = sessionNumberOf(section.title);
  const attended = (record?.appointments ?? []).filter((a) => a.status === "ATT").length;
  if (n === null || attended === 0) return null;
  const afterAssessment = /\bafter the (?:initial )?assessment\b/i.test(section.condition ?? "");
  const k = afterAssessment ? attended - 1 : attended;
  if (n <= k) return null;
  const what = afterAssessment ? `treatment session${k === 1 ? "" : "s"} after the assessment` : `session${k === 1 ? "" : "s"}`;
  return k === 0 ? `no ${what} ${afterAssessment ? "was" : "were"} attended` : `only ${k} ${what} ${k === 1 ? "was" : "were"} attended`;
}

/* ------------------------------------------------------------------------------------------------
 * Not applicable: the one rule (review, validation, forms engine, Copy answers)
 * ----------------------------------------------------------------------------------------------*/

type ReportLike = { sections: readonly Section[]; bundleSnapshot?: RecordLike };

/**
 * Whether `key` is a question that does not apply: the answer before it says so, a person marked it not applicable, or
 * it is a numbered session the record does not have. Pass the report (or just its sections: then only the first two).
 */
export function notApplicable(source: readonly Section[] | ReportLike, key: string): Condition | null {
  const sections = Array.isArray(source) ? (source as readonly Section[]) : (source as ReportLike).sections;
  const section = sections.find((s) => s.key === key);
  if (!section) return null;
  if (section.markedNotApplicable) return { controllers: [], applies: false, because: `the condition does not hold (marked by ${section.markedNotApplicable.by})` };
  if (!Array.isArray(source)) {
    const session = sessionNotInRecord(section, (source as ReportLike).bundleSnapshot);
    if (session) return { controllers: [], applies: false, because: session };
  }
  const c = conditionOf(sections, key);
  return c && c.applies === false ? c : null;
}

/* ------------------------------------------------------------------------------------------------
 * The drafting call
 * ----------------------------------------------------------------------------------------------*/

type FieldLike = { id: string; label: string; answerType: string; guidance?: string; section?: string | null };

/**
 * For the drafting call (fix round 1, B0-7; fix round 2, B1-1): which question(s) a conditional question of the form
 * map depends on and what it asks of them – "F-32 (“ANY FURTHER TREATMENT RECOMMENDED?”) is Yes", "any of F-24 (…),
 * F-25 (…) or F-26 (…) is Yes" – or null. The same controllers conditionOf() finds on a report.
 */
export function conditionText(fields: ReadonlyArray<FieldLike>, id: string): string | null {
  const i = fields.findIndex((f) => f.id === id);
  if (i < 0) return null;
  const kindOf = (t: string): Item["kind"] => (t === "yes_no" ? "yes_no" : t === "checkbox" ? "checkbox" : t === "single_choice" ? "choice" : null);
  const items: Item[] = fields.map((f) => {
    const condition = conditionTextOf(f, fields);
    return { key: f.id, title: f.label, kind: kindOf(f.answerType), ...(condition ? { condition } : {}) };
  });
  let wanted = wantedOf(items[i]);
  if (!wanted) {
    // Fix round 3 (B2-5, B2-13): "<X> – details" after the question about X.
    const details = detailsController(items, i);
    if (details?.wanted === "same") return conditionText(fields, fields[details.j].id);
    wanted = details?.wanted ?? null;
  }
  if (!wanted || (fields[i].answerType === "single_choice" && wanted.wants !== "filled")) return null;
  const controllers = controllersOf(items, i, wanted);
  if (controllers.length === 0) return null;
  const name = (j: number) => `${fields[j].id} (“${fields[j].label.trim()}”)`;
  const value = (j: number) => {
    if (wanted.wants === "other") return "“Other”";
    if (wanted.wants === "option") return `“${wanted.optionLabel ?? ""}”`;
    if (items[j].kind === "checkbox") return wanted.wants === "yes" ? "ticked" : "not ticked";
    return wanted.wants === "yes" ? "Yes" : "No";
  };
  if (wanted.wants === "not_option") return `${name(controllers[0])} is not ${wanted.optionLabel ?? "that option"}`;
  if (wanted.wants === "filled") return `${name(controllers[0])} names one (not “None”)`;
  if (controllers.length === 1) return `${name(controllers[0])} is ${value(controllers[0])}`;
  const listed = controllers.map(name);
  return `any of ${listed.slice(0, -1).join(", ")} or ${listed[listed.length - 1]} is ${value(controllers[0])}`;
}
