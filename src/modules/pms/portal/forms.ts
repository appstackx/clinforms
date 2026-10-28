/**
 * Intake and consent forms (pure): what a form is made of, how a patient's answers are checked, which answers may
 * update the patient's record, which are health information (shown to clinicians only), and the typed
 * e-signature's rules. Browser-safe – the same checks run in the patient's browser and on the server.
 *
 * A form's definition holds NO patient data (it is a template). A patient's copy keeps a snapshot of the
 * definition it was answered on (a later edit of the template never changes what someone signed).
 */
import { isIsoDate, isPlausiblePhone, normalisePostcode, searchKey } from "../core/text";

export const FIELD_TYPES = ["heading", "text", "textarea", "yes_no", "choice", "multi", "date", "consent"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Readonly<Record<FieldType, string>> = {
  heading: "Heading or information",
  text: "Short answer",
  textarea: "Long answer",
  yes_no: "Yes or no",
  choice: "One choice from a list",
  multi: "Any choices from a list",
  date: "Date",
  consent: "Tick to agree",
};

/**
 * Answers that may update the shared patient record – only after a member of staff checks them (or, for
 * consent, when the patient signed in through their own portal sign-in link).
 */
export const RECORD_FIELDS = {
  phoneMobile: { label: "Mobile phone", kind: "phone" },
  phoneHome: { label: "Home phone", kind: "phone" },
  address: { label: "Address", kind: "lines" },
  postcode: { label: "Postcode", kind: "postcode" },
  occupation: { label: "Occupation", kind: "text" },
  employer: { label: "Employer", kind: "text" },
  emergencyName: { label: "Emergency contact", kind: "text" },
  emergencyPhone: { label: "Emergency contact's phone", kind: "phone" },
  emergencyRelationship: { label: "Emergency contact's relationship", kind: "text" },
  gpName: { label: "GP's name", kind: "text" },
  gpPractice: { label: "GP practice", kind: "text" },
  gpPhone: { label: "GP practice phone", kind: "phone" },
  consentShareGp: { label: "May write to the GP", kind: "consent" },
  consentTreatment: { label: "Consent to assessment and treatment", kind: "consent" },
} as const;
export type RecordField = keyof typeof RECORD_FIELDS;
export const RECORD_FIELD_KEYS = Object.keys(RECORD_FIELDS) as RecordField[];

/** Which field types may feed which kind of record field. */
export function recordFieldFits(type: FieldType, field: RecordField): boolean {
  const kind = RECORD_FIELDS[field].kind;
  if (kind === "consent") return type === "consent" || type === "yes_no";
  if (kind === "lines") return type === "textarea";
  return type === "text";
}

export interface FormField {
  /** Stable key inside the form: a–z, 0–9 and "_", starting with a letter. */
  id: string;
  type: FieldType;
  label: string;
  help?: string | null;
  required?: boolean;
  /** choice / multi. */
  options?: string[];
  /** Health information: answers shown only to members who may read clinical notes. */
  sensitive?: boolean;
  /** Where a checked answer may go on the patient's record. */
  recordField?: RecordField | null;
}

export interface FormDefinition {
  fields: FormField[];
}

export type AnswerValue = string | string[] | boolean;
export type Answers = Record<string, AnswerValue>;

export const FORM_LIMITS = { fields: 60, label: 300, help: 600, options: 20, option: 120, text: 200, textarea: 4000 } as const;
export const FIELD_ID_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

/** Problems with a form definition (empty = fine). Used when staff save a form. */
export function definitionProblems(def: FormDefinition): string[] {
  const problems: string[] = [];
  if (!def || !Array.isArray(def.fields)) return ["The form has no questions."];
  if (def.fields.filter((f) => f.type !== "heading").length === 0) problems.push("Add at least one question.");
  if (def.fields.length > FORM_LIMITS.fields) problems.push(`A form can have at most ${FORM_LIMITS.fields} parts.`);
  const ids = new Set<string>();
  const targets = new Set<string>();
  def.fields.forEach((f, i) => {
    const where = `Question ${i + 1}`;
    if (!FIELD_ID_PATTERN.test(f.id)) problems.push(`${where}: the key must start with a letter and use a–z, 0–9 or _.`);
    if (ids.has(f.id)) problems.push(`${where}: the key "${f.id}" is used twice.`);
    ids.add(f.id);
    if (!(FIELD_TYPES as readonly string[]).includes(f.type)) problems.push(`${where}: unknown type.`);
    if (typeof f.label !== "string" || f.label.trim() === "") problems.push(`${where}: add the question's wording.`);
    else if (f.label.length > FORM_LIMITS.label) problems.push(`${where}: the wording is longer than ${FORM_LIMITS.label} characters.`);
    if (f.help && f.help.length > FORM_LIMITS.help) problems.push(`${where}: the help text is longer than ${FORM_LIMITS.help} characters.`);
    if (f.type === "choice" || f.type === "multi") {
      const opts = f.options ?? [];
      if (opts.length < 2 || opts.length > FORM_LIMITS.options) problems.push(`${where}: give 2–${FORM_LIMITS.options} choices.`);
      if (opts.some((o) => typeof o !== "string" || o.trim() === "" || o.length > FORM_LIMITS.option)) problems.push(`${where}: each choice needs 1–${FORM_LIMITS.option} characters.`);
      if (new Set(opts).size !== opts.length) problems.push(`${where}: a choice is listed twice.`);
    }
    if (f.recordField) {
      if (!(f.recordField in RECORD_FIELDS)) problems.push(`${where}: unknown record field.`);
      else if (!recordFieldFits(f.type, f.recordField)) problems.push(`${where}: this type of answer cannot update "${RECORD_FIELDS[f.recordField].label}".`);
      else if (targets.has(f.recordField)) problems.push(`${where}: "${RECORD_FIELDS[f.recordField].label}" is filled by another question already.`);
      targets.add(f.recordField ?? "");
    }
    if (f.type === "heading" && f.required) problems.push(`${where}: a heading cannot be required.`);
  });
  return problems;
}

/** The questions a patient answers (headings left out). */
export function questions(def: FormDefinition): FormField[] {
  return def.fields.filter((f) => f.type !== "heading");
}

export type AnswerCheck = { ok: true; answers: Answers } | { ok: false; errors: Record<string, string> };

/**
 * Checks raw answers (from a form post: strings, string arrays, "on") against the definition.
 * `today` = "YYYY-MM-DD" (UK) – dates must lie between 1900 and 50 years from today.
 */
export function checkAnswers(def: FormDefinition, raw: Record<string, unknown>, today: string): AnswerCheck {
  const answers: Answers = {};
  const errors: Record<string, string> = {};
  const maxYear = Number(today.slice(0, 4)) + 50;
  for (const f of questions(def)) {
    const value = raw[f.id];
    const str = typeof value === "string" ? value.trim() : Array.isArray(value) && typeof value[0] === "string" ? String(value[0]).trim() : "";
    const missing = () => {
      if (f.required) errors[f.id] = f.type === "consent" ? "Tick the box to agree" : f.type === "choice" || f.type === "yes_no" ? "Choose an answer" : "Answer this question";
    };
    switch (f.type) {
      case "text": {
        if (!str) {
          missing();
          break;
        }
        if (str.length > FORM_LIMITS.text) {
          errors[f.id] = `At most ${FORM_LIMITS.text} characters`;
          break;
        }
        const kind = f.recordField ? RECORD_FIELDS[f.recordField].kind : "text";
        if (kind === "phone" && !isPlausiblePhone(str)) {
          errors[f.id] = "Enter a UK phone number (or an international number starting with +)";
          break;
        }
        if (kind === "postcode") {
          const pc = normalisePostcode(str);
          if (!pc) {
            errors[f.id] = "Enter a UK postcode";
            break;
          }
          answers[f.id] = pc;
          break;
        }
        answers[f.id] = str.replace(/\s+/g, " ");
        break;
      }
      case "textarea": {
        const text = typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : str;
        if (!text) {
          missing();
          break;
        }
        if (text.length > FORM_LIMITS.textarea) {
          errors[f.id] = `At most ${FORM_LIMITS.textarea} characters`;
          break;
        }
        answers[f.id] = text;
        break;
      }
      case "yes_no": {
        if (str !== "yes" && str !== "no") {
          if (str) errors[f.id] = "Choose yes or no";
          else missing();
          break;
        }
        answers[f.id] = str;
        break;
      }
      case "choice": {
        if (!str) {
          missing();
          break;
        }
        if (!(f.options ?? []).includes(str)) {
          errors[f.id] = "Choose one of the answers";
          break;
        }
        answers[f.id] = str;
        break;
      }
      case "multi": {
        const list = (Array.isArray(value) ? value : typeof value === "string" && value ? [value] : []).map((v) => String(v).trim()).filter(Boolean);
        const allowed = f.options ?? [];
        if (list.some((v) => !allowed.includes(v))) {
          errors[f.id] = "Choose from the answers listed";
          break;
        }
        const unique = allowed.filter((o) => list.includes(o));
        if (unique.length === 0) {
          missing();
          break;
        }
        answers[f.id] = unique;
        break;
      }
      case "date": {
        if (!str) {
          missing();
          break;
        }
        if (!isIsoDate(str) || str < "1900-01-01" || Number(str.slice(0, 4)) > maxYear) {
          errors[f.id] = "Enter a real date";
          break;
        }
        answers[f.id] = str;
        break;
      }
      case "consent": {
        const ticked = value === true || str === "on" || str === "yes" || str === "true";
        if (!ticked) {
          missing();
          break;
        }
        answers[f.id] = true;
        break;
      }
      default:
        break;
    }
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, answers };
}

export interface RecordUpdate {
  field: RecordField;
  label: string;
  value: string | string[] | boolean;
  /** The question it came from. */
  fieldId: string;
}

/** What the answers would change on the patient's record (only mapped questions that were answered). */
export function recordUpdates(def: FormDefinition, answers: Answers): RecordUpdate[] {
  const out: RecordUpdate[] = [];
  for (const f of questions(def)) {
    if (!f.recordField || !(f.id in answers)) continue;
    const raw = answers[f.id];
    const kind = RECORD_FIELDS[f.recordField].kind;
    let value: string | string[] | boolean;
    if (kind === "consent") value = raw === true || raw === "yes";
    else if (kind === "lines") value = String(raw).split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 6);
    else value = String(raw);
    out.push({ field: f.recordField, label: RECORD_FIELDS[f.recordField].label, value, fieldId: f.id });
  }
  return out;
}

/** Consent fields of a form, and whether every required one was ticked. */
export function consentComplete(def: FormDefinition, answers: Answers): boolean {
  const required = questions(def).filter((f) => f.type === "consent" && f.required);
  return required.length > 0 && required.every((f) => answers[f.id] === true);
}

export interface VisibleAnswer {
  field: FormField;
  /** null = not answered; "hidden" = health information the viewer may not read. */
  value: AnswerValue | null | "hidden";
}

/** The answers a member of staff may see: health information only with clinical access. */
export function visibleAnswers(def: FormDefinition, answers: Answers, canSeeHealth: boolean): VisibleAnswer[] {
  return def.fields.map((field) => {
    if (field.type === "heading") return { field, value: null };
    if (field.sensitive && !canSeeHealth) return { field, value: "hidden" };
    return { field, value: field.id in answers ? answers[field.id] : null };
  });
}

/** An answer as text ("Yes", "No", "Agreed", a list, a UK date). */
export function answerText(field: FormField, value: AnswerValue | null): string {
  if (value === null || value === undefined) return "Not answered";
  if (field.type === "consent") return value === true ? "Agreed" : "Not agreed";
  if (field.type === "yes_no") return value === "yes" ? "Yes" : "No";
  if (field.type === "date" && typeof value === "string" && isIsoDate(value)) {
    const [y, m, d] = value.split("-");
    return `${d}/${m}/${y}`;
  }
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/* ------------------------------------------------------------------------------------------------
 * Typed e-signature
 * ----------------------------------------------------------------------------------------------*/

export const SIGNATURE_NAME_MAX = 120;

/** The typed signature is in plain words: 2–120 characters with at least two letters. */
export function signatureNameProblem(typed: string): string | null {
  const t = typed.trim();
  if (t.length < 2 || t.replace(/[^A-Za-z\u00C0-\u024F]/g, "").length < 2) return "Type your full name to sign";
  if (t.length > SIGNATURE_NAME_MAX) return `At most ${SIGNATURE_NAME_MAX} characters`;
  return null;
}

/**
 * Whether the typed name looks like the patient's (contains the last name, and the first name or its initial).
 * A mismatch is not refused – people sign with legal names, initials, double-barrelled names – but staff see a
 * note to check it at the first visit.
 */
export function signatureMatchesPatient(typed: string, patient: { firstName: string; lastName: string; preferredName?: string | null }): boolean {
  const words = searchKey(typed).split(" ").filter(Boolean);
  const last = searchKey(patient.lastName).split(" ").filter(Boolean);
  if (last.length === 0 || !last.every((w) => words.includes(w))) return false;
  const firsts = [patient.firstName, patient.preferredName].map((n) => searchKey(n ?? "")).filter(Boolean);
  return firsts.some((first) => words.includes(first.split(" ")[0]) || words.some((w) => w.length === 1 && w === first[0]));
}

/** JSON with object keys sorted (stable text for hashing what was signed). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

/** The text whose SHA-256 seals a signed form: the form, the answers, the typed name, the time and who. */
export function signedContent(input: { responseId: string; patientId: string; form: FormDefinition; answers: Answers; signatureName: string | null; signedAt: string | null }): string {
  return canonicalJson({ v: 1, ...input });
}
