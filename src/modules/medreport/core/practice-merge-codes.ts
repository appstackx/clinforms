/**
 * A clinic system's letter merge codes (10/2026, Blue Heart): TM3's letter templates print upper-case codes in
 * double angle brackets – <<P_TITLE>> <<P_FIRSTNAM>> <<P_SURNAME>>, <<P_DOB>>, <<P_ADDRESS1>>…<<P_ADDRESS5>>,
 * <<P_POSTCODE>>, <<P_GROUPREF>>, <<P_CONSNAME>>, <<DATE>>, <<P_LOCATION_ADDRESS2>>… – which the clinic system
 * replaces with the patient's details when it prints the letter. A clinic that keeps each referrer's report form as
 * such a template uploads it as it is (RTF or Word). The codes stay in the form (core/rtf keeps them when it converts
 * an RTF file), and the form reading (ai/practice-merge-binding.ts) turns each one into a question answered FROM THE
 * RECORD where the record holds that detail – instead of an anonymous answer box:
 *
 *   patient: title, first name, surname, date of birth, address lines, postcode, telephone, employer…
 *   referral: the referrer's reference (<<P_GROUPREF>>), membership number;
 *   clinician: the treating clinician's name (<<P_CONSNAME>>);  report: the date (<<DATE>>);
 *   clinic: its name and address lines / postcode (<<P_LOCATION_…>>, from the clinic's own settings).
 *
 * A code the record does not hold (a hospital number, a work telephone…), and any code this dictionary does not
 * know, stays an answer box for staff, flagged with the code it came from. Either way the merge-field safety block
 * stays in force: a form is never approved while one of these codes is left on it (core/merge-fields.ts).
 *
 * Names are data, never instructions. Browser-safe and pure.
 */
import type { AnswerType, RegistrationPath } from "./types";

/** A clinic-system code as printed: << + an upper-case name (letters, digits, underscores, ≤ 40) + >>. */
export const PRACTICE_CODE_NAME = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;
/** Every such code in a text, e.g. "Patient: <<P_TITLE>> <<P_SURNAME>>" → two matches (group 1 = the name). */
export const PRACTICE_CODE_IN_TEXT = /<<([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*)>>/g;

/** Whether a typed merge field's name is a clinic-system code (kept in the converted form, see core/rtf). */
export function isPracticeCodeName(name: string): boolean {
  return name.length > 0 && name.length <= 40 && PRACTICE_CODE_NAME.test(name);
}

export type PracticeCodeBinding =
  /** Filled by code from one record field. */
  | { kind: "record"; path: RegistrationPath; answerType: AnswerType }
  /** One line of the patient's or the clinic's postal address (spread over the form's address codes in order). */
  | { kind: "address_line"; family: "patient" | "clinic"; line: number }
  /** The patient's or the clinic's postcode. */
  | { kind: "postcode"; family: "patient" | "clinic" }
  /** What the code holds depends on how the clinic system is set up: decided by the form's label beside it. */
  | { kind: "by_label"; choices: Array<{ label: RegExp; path: RegistrationPath; answerType: AnswerType }> }
  /** The record here does not hold it: staff enter it for each report. */
  | { kind: "not_held" };

export interface PracticeCode {
  /** The code without brackets, e.g. "P_FIRSTNAM". */
  code: string;
  /** The question as staff see it when the form prints no label of its own. */
  label: string;
  binding: PracticeCodeBinding;
  /** What the clinic system puts there, in plain English (the question's guidance and its note). */
  meaning: string;
  /** How staff screens name the code when `meaning` (less its examples in brackets) does not read well there. */
  plain?: string;
  /** Labels that would contradict the meaning (e.g. a clinic that keeps the solicitor in the employer field). */
  doubtfulBeside?: RegExp;
}

const rec = (path: RegistrationPath, answerType: AnswerType = "short_text"): PracticeCodeBinding => ({ kind: "record", path, answerType });

const ENTRIES: PracticeCode[] = [
  { code: "P_TITLE", label: "Patient's title", binding: rec("patient.title"), meaning: "the patient's title (Mr, Mrs, Ms…)" },
  { code: "P_FIRSTNAM", label: "Patient's first name", binding: rec("patient.firstName"), meaning: "the patient's first name" },
  { code: "P_FIRSTNAME", label: "Patient's first name", binding: rec("patient.firstName"), meaning: "the patient's first name" },
  { code: "P_FORENAME", label: "Patient's first name", binding: rec("patient.firstName"), meaning: "the patient's first name" },
  { code: "P_SURNAME", label: "Patient's surname", binding: rec("patient.lastName"), meaning: "the patient's surname" },
  { code: "P_LASTNAME", label: "Patient's surname", binding: rec("patient.lastName"), meaning: "the patient's surname" },
  { code: "P_FULLNAME", label: "Patient's name", binding: rec("patient.fullName"), meaning: "the patient's full name" },
  { code: "P_DOB", label: "Patient's date of birth", binding: rec("patient.dob", "date"), meaning: "the patient's date of birth" },
  { code: "P_AGE", label: "Patient's age", binding: rec("patient.age"), meaning: "the patient's age" },
  { code: "P_SEX", label: "Patient's sex", binding: rec("patient.sex"), meaning: "the patient's sex" },
  { code: "P_GENDER", label: "Patient's sex", binding: rec("patient.sex"), meaning: "the patient's sex" },
  ...[1, 2, 3, 4, 5, 6].map(
    (n): PracticeCode => ({ code: `P_ADDRESS${n}`, label: "Patient's address", binding: { kind: "address_line", family: "patient", line: n }, meaning: `line ${n} of the patient's address` }),
  ),
  { code: "P_POSTCODE", label: "Patient's postcode", binding: { kind: "postcode", family: "patient" }, meaning: "the patient's postcode" },
  { code: "P_HOMETEL", label: "Patient's telephone", binding: rec("patient.phone"), meaning: "the patient's home telephone number" },
  { code: "P_MOBILE", label: "Patient's mobile", binding: rec("patient.phone"), meaning: "the patient's mobile number" },
  { code: "P_TEL", label: "Patient's telephone", binding: rec("patient.phone"), meaning: "the patient's telephone number" },
  { code: "P_EMAIL", label: "Patient's email address", binding: rec("patient.email"), meaning: "the patient's email address" },
  { code: "P_WORKTEL", label: "Patient's work telephone", binding: { kind: "not_held" }, meaning: "the patient's work telephone number" },
  { code: "P_OCCUPATION", label: "Patient's occupation", binding: rec("patient.occupation"), meaning: "the patient's occupation" },
  {
    code: "P_EMPLOYER",
    label: "Patient's employer",
    binding: rec("patient.employer"),
    meaning: "the patient's employer",
    doubtfulBeside: /solicitor|insurer|referrer|instruct|case\s*manager|agent/i,
  },
  { code: "P_GROUPREF", label: "Referrer's reference", binding: rec("referral.reference"), meaning: "the referrer's reference for this case" },
  {
    code: "P_ALTERNATE_REF1",
    label: "Alternative reference",
    binding: {
      kind: "by_label",
      choices: [{ label: /(?:accident|injury|incident|onset|occurrence)\b[\s\S]{0,20}\bdate|\bdate\b[\s\S]{0,20}\b(?:of\s+)?(?:the\s+)?(?:accident|injury|incident|onset)/i, path: "incident.date", answerType: "date" }],
    },
    meaning: "the clinic system's alternative reference 1 (some clinics keep the date of the accident there)",
    // Fix round 1 (B0-29): no aside about what other clinics keep there (a JJ Physio "Shoulder No" read oddly).
    plain: "alternative reference 1",
  },
  { code: "P_INS_NUM", label: "Insurance membership number", binding: rec("referral.membershipNumber"), meaning: "the patient's insurance membership number" },
  { code: "P_HOSP_NUM", label: "Hospital number", binding: { kind: "not_held" }, meaning: "the patient's hospital number" },
  { code: "P_NHSNUM", label: "NHS number", binding: { kind: "not_held" }, meaning: "the patient's NHS number" },
  { code: "P_NHS_NUMBER", label: "NHS number", binding: { kind: "not_held" }, meaning: "the patient's NHS number" },
  { code: "P_INJURY", label: "Injury", binding: { kind: "not_held" }, meaning: "the injury as the clinic system records it" },
  { code: "P_CONSNAME", label: "Treating clinician", binding: rec("clinician.name"), meaning: "the treating clinician's name" },
  { code: "DATE", label: "Date", binding: rec("report.date", "date"), meaning: "the date of the report" },
  { code: "TODAY", label: "Date", binding: rec("report.date", "date"), meaning: "the date of the report" },
  { code: "P_LOCATION_NAME", label: "Clinic location", binding: rec("clinic.name"), meaning: "the clinic (site) the patient attends" },
  ...[1, 2, 3, 4, 5, 6].map(
    (n): PracticeCode => ({
      code: `P_LOCATION_ADDRESS${n}`,
      label: "Clinic address",
      binding: { kind: "address_line", family: "clinic", line: n },
      meaning: `line ${n} of the clinic's address`,
    }),
  ),
  { code: "P_LOCATION_POSTCODE", label: "Clinic postcode", binding: { kind: "postcode", family: "clinic" }, meaning: "the clinic's postcode" },
];

export const PRACTICE_CODES: ReadonlyMap<string, PracticeCode> = new Map(ENTRIES.map((e) => [e.code, e]));

export function practiceCode(code: string): PracticeCode | null {
  return PRACTICE_CODES.get(code) ?? null;
}

/** Every clinic-system code in a text with its position, in order. */
export function findPracticeCodes(text: string): Array<{ code: string; text: string; index: number }> {
  if (!text || text.indexOf("<<") < 0) return [];
  const out: Array<{ code: string; text: string; index: number }> = [];
  const re = new RegExp(PRACTICE_CODE_IN_TEXT.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (isPracticeCodeName(m[1])) out.push({ code: m[1], text: m[0], index: m.index });
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Plain words for staff (Blue Heart trial, 10/2026). The codes stay in the stored map – an answer's place names
 * the exact text it replaces, and a note says which code it came from – but staff screens show what each code
 * holds instead ("the patient's first name"). It is done when the text is shown, so maps stored before this
 * change read the same way. Shared by every staff screen that shows a map's notes, guidance or places.
 * ----------------------------------------------------------------------------------------------*/

/** A run of codes as the form reading and the RTF converter list them: "<<P_TITLE>>, <<P_FIRSTNAM>>". */
const CODE_RUN = /(\b[Mm]erge codes? )?(<<[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*>>(?:, <<[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*>>)*)/g;

/** What a known code holds, as staff screens name it ("the patient's first name"); null for an unknown code. */
export function practiceCodeWords(code: string): string | null {
  const entry = practiceCode(code);
  if (!entry) return null;
  // The meaning without its examples: "the patient's title (Mr, Mrs, Ms…)" → "the patient's title".
  return entry.plain ?? entry.meaning.replace(/\s*\((?:[^()]|\([^()]*\))*\)$/, "");
}

/**
 * The words for a code's place ("merge code for …"): an address printed over several lines is spread over them in
 * order, so each line's code names the whole address – "line 3 of the patient's address" would contradict the
 * "line 2 of 3" it fills.
 */
function placeWords(code: string): string | null {
  const entry = practiceCode(code);
  if (entry?.binding.kind === "address_line") return entry.binding.family === "patient" ? "the patient's address" : "the clinic's address";
  return practiceCodeWords(code);
}

/** "a and b", "a, b and c" – or, for examples in brackets (perhaps followed by "and 3 more"), "a, b, c". */
function joinWords(words: string[], withAnd: boolean): string {
  if (!withAnd || words.length < 2) return words.join(", ");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** Whether `at` starts a sentence: the text's start, a new line, or after ". " (looks back over spaces only). */
function startsSentence(text: string, at: number): boolean {
  let i = at - 1;
  while (i >= 0 && (text[i] === " " || text[i] === "\t")) i--;
  return i < 0 || ".!?\n".includes(text[i]);
}

/**
 * A text for staff with every clinic-system code in plain words:
 *   "From the clinic system's merge code <<P_FIRSTNAM>> (the patient's first name): filled from the record."
 *     → "From the clinic system's merge code for the patient's first name: filled from the record."
 *   "13 merge codes from your clinic system (<<P_GROUPREF>>, <<P_TITLE>>, <<P_FIRSTNAM>>) were kept"
 *     → "13 merge codes from your clinic system (the referrer's reference for this case, the patient's title, the
 *        patient's first name) were kept"
 * A code the dictionary does not know keeps its name, in quotes (“P_HOSP_REF”), so staff can still find it on the
 * form. Plain text in and out: codes are only capital letters, digits and underscores, nothing is read as markup,
 * and anything else in the text (other mail-merge fields such as «Patient_Name» included) is left as it is.
 */
export function humaniseMergeCodes(text: string): string {
  if (!text || text.indexOf("<<") < 0) return text;
  const re = new RegExp(CODE_RUN.source, "g");
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const prefix = m[1] ?? "";
    const codes = m[2].split(", ").map((t) => t.slice(2, -2));
    if (!codes.every(isPracticeCodeName)) continue;
    const start = m.index + prefix.length;
    let end = m.index + m[0].length;
    // A single code already in quotes (“<<P_X>>”) is not quoted again.
    const quoted = codes.length === 1 && text[start - 1] === "“" && text[end] === "”";
    // After "merge code(s)" the codes name one place; a bare list is examples, each code in its own words.
    const words: string[] = [];
    for (const code of codes) {
      const w = (prefix ? placeWords(code) : practiceCodeWords(code)) ?? (quoted ? code : `“${code}”`);
      if (!words.includes(w)) words.push(w);
    }
    for (const who of prefix ? ["patient's", "clinic's"] : []) {
      const at = words.indexOf(`the ${who} address`);
      const pc = words.indexOf(`the ${who} postcode`);
      if (at >= 0 && pc >= 0) {
        words[at] = `the ${who} address and postcode`;
        words.splice(pc, 1);
      }
    }
    let phrase = joinWords(words, Boolean(prefix));
    if (prefix) {
      phrase = `${prefix}${codes.some((c) => practiceCode(c)) ? "for " : ""}${phrase}`;
    } else if (startsSentence(text, start)) {
      phrase = phrase.charAt(0).toUpperCase() + phrase.slice(1);
    }
    // The form reading's notes repeat the meaning after the code: "<<P_DOB>> (the patient's date of birth)".
    const entry = codes.length === 1 ? practiceCode(codes[0]) : null;
    if (entry && text.startsWith(` (${entry.meaning})`, end)) end += entry.meaning.length + 3;
    out += text.slice(last, m.index) + phrase;
    last = end;
    re.lastIndex = end;
  }
  return out + text.slice(last);
}

/**
 * A place that is nothing but clinic-system codes ("<<P_FIRSTNAM>>", "<<P_ADDRESS1>>, <<P_POSTCODE>>"), in plain
 * words – "merge code for the patient's first name" – or null when the text holds anything else.
 */
export function practiceCodesInWords(text: string): string | null {
  const codes = findPracticeCodes(text);
  if (codes.length === 0) return null;
  const rest = codes.reduce((t, c) => t.split(c.text).join(""), text);
  if (!/^[\s,;:.\-–—/()]*$/.test(rest)) return null;
  return humaniseMergeCodes(`merge code${codes.length === 1 ? "" : "s"} ${codes.map((c) => c.text).join(", ")}`);
}
