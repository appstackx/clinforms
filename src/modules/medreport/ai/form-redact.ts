import "server-only";

/**
 * Data minimisation for form ANALYSIS. The analysis needs the referrer's blank form – its questions,
 * headings and answer spaces – never a patient's details. Forms sometimes arrive already filled in
 * (claimant name, date of birth, address, claim reference typed into the boxes), so before anything is
 * sent to Claude:
 *
 * - Word: an answer cell next to an identifying label ("Claimant name", "Date of birth", "Address",
 *   "NHS number", "Policy / claim no." …) that already holds text is emptied; "Name: Megan Hart"-style
 *   label lines keep the label and lose the value; content controls / legacy fields that hold a value
 *   (not their placeholder) are emptied.
 * - Everywhere (Word blocks, PDF page text and the text near PDF fields): dates of birth, full dates,
 *   NHS-style numbers, postcodes, e-mail addresses and phone numbers are replaced with tags.
 * - PDF page text: on a FILLABLE PDF, "Label: value" is treated as a filled-in answer only inside a
 *   field's box (its values live in the fields, emptied below); printed form text around them
 *   ("Telephone numbers: Home") is the blank form itself. On a FLAT PDF every "Label: value" line is
 *   checked – inside a detected answer box (`boxes` on the outline) or beside its label – except the
 *   referrer's footer lines ("Registered address: …") and printed option lists, so a typed-in flat form
 *   is caught whether or not the forms engine found its boxes.
 * - Fillable PDFs: the attached copy has every text field emptied (forms/pdf-blank.ts).
 * - Flat PDFs that look filled in: the PDF itself is NOT attached – Claude gets the redacted text only.
 *
 * Patient-specific findings (a filled identifying box, a labelled date of birth, an NHS number, filled
 * fillable fields) produce a warning asking staff to upload the blank form. Postcodes, phone numbers and
 * dates are replaced silently: a blank form prints the referrer's own address and version date.
 *
 * Owner: ai agent.
 */
import type { OutlineBlock, PdfFormOutline } from "../core/types";
import { WORDING } from "../core/wording";
import type { ParsedForm } from "./form-outline";

export interface FormRedaction {
  /** The outline as it may be sent to the AI. */
  parsed: ParsedForm;
  /** Plain-English, patient-specific things that were found and removed (no values). */
  findings: string[];
}

const IDENTIFYING_LABEL =
  /\b(?:(?:claimant|patient|employee|client|injured party|applicant)(?:'s)?\s+(?:full\s+)?name|full name|surname|forenames?|first name|last name|name of (?:claimant|patient|employee)|date of birth|d\.?\s?o\.?\s?b\.?|address|postcode|nhs (?:no|number)|national insurance|ni number|telephone|phone|mobile|e-?mail|(?:policy|claim|case|our|your|client)\s*(?:\/\s*\w+\s*)?(?:no\.?|number|ref(?:erence)?)|reference)\b/i;
const NAME_ONLY_LABEL = /^\s*(?:name|claimant|patient|employee)\s*:?\s*$/i;

const TAGS: Array<{ re: RegExp; tag: string; finding?: string }> = [
  {
    re: /\b(date of birth|d\.?\s?o\.?\s?b\.?|born)(\s*[:\-–]?\s*)\d{1,2}(?:st|nd|rd|th)?[\s/.\-]+(?:\d{1,2}|[A-Za-z]{3,9})[\s/.\-]+\d{2,4}\b/gi,
    tag: "$1$2[DOB]",
    finding: "a date of birth",
  },
  { re: /\b\d{3}[\s-]?\d{3}[\s-]?\d{4}\b/g, tag: "[ID]", finding: "an NHS-style number" },
  { re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, tag: "[EMAIL]" },
  { re: /(?:\+44\s?\(?0?\)?\s?\d{2,5}|\b0\d{2,5})[\s-]?\d{3}[\s-]?\d{3,4}\b/g, tag: "[PHONE]" },
  { re: /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/g, tag: "[POSTCODE]" },
  { re: /\b\d{1,2}[/.-]\d{1,2}[/.-](?:19|20)\d{2}\b/g, tag: "[DATE]" },
];

/** Replace identifiers in free text; adds patient-specific findings to `found`. */
export function redactText(text: string, found?: Set<string>): string {
  let out = text;
  for (const { re, tag, finding } of TAGS) {
    out = out.replace(re, (...args) => {
      if (finding) found?.add(finding);
      // "$1$2[DOB]" keeps the label.
      return tag.replace(/\$(\d)/g, (_m, n) => String(args[Number(n)] ?? ""));
    });
  }
  return out;
}

function isFillIn(text: string): boolean {
  const t = text.trim();
  return (
    t === "" ||
    /^[_.…\s-]+$/.test(t) ||
    /^\[[^\]]*\]$/.test(t) ||
    /^\([^)]*\)$/.test(t) || // "(include postcode)"
    /[☐☒☑]/.test(t) || // tick boxes
    /click or tap here to enter/i.test(t)
  );
}

/** "Name: Megan Hart" / "Date of birth: 22/11/1991" → keep the label, drop the value. */
function redactLabelValue(text: string, found: Set<string>): string {
  const m = /^(\s*[^:]{2,40}?:\s*)(.+)$/.exec(text);
  if (!m) return text;
  const label = m[1];
  const value = m[2];
  if (!IDENTIFYING_LABEL.test(label) || isFillIn(value) || /_{3,}|\.{4,}|…/.test(value)) return text;
  found.add(`a filled-in “${label.replace(/[:\s]+$/, "").trim()}”`);
  return `${label}[removed]`;
}

function redactDocx(blocks: OutlineBlock[], found: Set<string>): OutlineBlock[] {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  return blocks.map((b) => {
    let text = b.text;
    let emptied = false;
    // An answer cell to the right of an identifying label that already holds text.
    if (b.kind === "cell" && b.table && b.table.c > 0 && !b.isEmpty && !b.hasPlaceholder) {
      const prefix = b.id.slice(0, b.id.lastIndexOf(`.r${b.table.r}.c${b.table.c}`));
      const left = byId.get(`${prefix}.r${b.table.r}.c${b.table.c - 1}`);
      if (left && (IDENTIFYING_LABEL.test(left.text) || NAME_ONLY_LABEL.test(left.text)) && !IDENTIFYING_LABEL.test(b.text) && !isFillIn(b.text)) {
        found.add(`a filled-in “${left.text.replace(/[:\s]+$/, "").trim().slice(0, 40)}”`);
        text = "";
        emptied = true;
      }
    }
    // A content control or legacy field that holds a value rather than its placeholder.
    if (!emptied && (b.inContentControl || b.legacyFieldName) && !b.hasPlaceholder && !isFillIn(b.text) && b.headingLevel === undefined) {
      const looksLikeLabel = /[:?]\s*$/.test(b.text) || IDENTIFYING_LABEL.test(b.text);
      if (!looksLikeLabel) {
        found.add("a filled-in form field");
        text = "";
        emptied = true;
      }
    }
    if (!emptied) text = redactText(redactLabelValue(text, found), found);
    if (text === b.text) return b;
    return { ...b, text, isEmpty: text.trim() === "" ? true : b.isEmpty };
  });
}

/** An answer space on a PDF page: a fillable field's box, or a box the forms engine detected. */
type AnswerBox = { page: number; x: number; y: number; width: number; height: number; kind?: string };

/**
 * Answer spaces of a PDF outline: fillable fields' boxes plus the detected answer boxes (`boxes`, tick
 * boxes excluded). Null when there are none – a flat PDF on which no answer box was found (readPdfForm
 * then sets `boxes: []`), or one with tick boxes only – so its text keeps the label check everywhere.
 */
function answerBoxes(pdf: PdfFormOutline): AnswerBox[] | null {
  const detected = (pdf as PdfFormOutline & { boxes?: AnswerBox[] }).boxes;
  const boxes: AnswerBox[] = pdf.fields.map((f) => ({ page: f.page, ...f.rect }));
  if (Array.isArray(detected)) boxes.push(...detected.filter((b) => b.kind !== "tick"));
  return boxes.length > 0 ? boxes : null;
}

/** Text whose baseline sits inside an answer space (1 pt tolerance). */
function insideBox(it: { x: number; y: number }, page: number, boxes: AnswerBox[]): boolean {
  return boxes.some((b) => b.page === page && it.x >= b.x - 1 && it.x <= b.x + b.width && it.y >= b.y - 1 && it.y <= b.y + b.height);
}

/** Lines that belong to the referrer, not to a patient: company footers and legal small print. */
const FOOTER_LINE =
  /\b(?:registered (?:office|address|in england|in scotland|number|no\.?)|company (?:registration )?(?:no\.?|number)|registration number|authorised and regulated|financial conduct authority|prudential regulation authority|trading name|vat (?:registration )?(?:no\.?|number)|charity (?:no\.?|number))\b/i;
/** Values that are printed option words, not answers ("Telephone numbers: Home"). */
const OPTION_WORDS =
  /^(?:(?:home|work|mobile|daytime|evening|office|other|yes|no|mr|mrs|ms|miss|dr|male|female|tick|please (?:tick|state|specify)|if (?:known|applicable|different))[\s/,.()-]*)+$/i;

function redactPdf(pdf: PdfFormOutline, found: Set<string>): PdfFormOutline {
  const boxes = answerBoxes(pdf);
  const flat = pdf.fields.length === 0;
  return {
    ...pdf,
    fields: pdf.fields.map((f) => {
      const nearbyText = redactText(f.nearbyText, found);
      // The labels printed beside tick boxes are page text too.
      const optionLabels = f.optionLabels?.map((l) => redactText(l, found));
      const labelsChanged = Boolean(optionLabels?.some((l, i) => l !== f.optionLabels?.[i]));
      return nearbyText === f.nearbyText && !labelsChanged ? f : { ...f, nearbyText, ...(labelsChanged && { optionLabels }) };
    }),
    pageText: pdf.pageText.map((p) => ({
      ...p,
      items: p.items.map((it) => {
        // A filled-in answer: text inside an answer space; and on a flat PDF (no fillable fields, so a
        // typed-in value may sit beside its label rather than in a box) any "Label: value" line that is
        // neither the referrer's footer nor a printed list of options.
        const entered =
          (boxes !== null && insideBox(it, p.page, boxes)) ||
          (flat && !FOOTER_LINE.test(it.str) && !OPTION_WORDS.test(it.str.replace(/^[^:]*:\s*/, "")));
        const str = entered ? redactText(redactLabelValue(it.str, found), found) : redactText(it.str, found);
        return str === it.str ? it : { ...it, str };
      }),
    })),
  };
}

/** The outline with identifiers removed, and what patient-specific content was found. */
export function redactParsedForm(parsed: ParsedForm): FormRedaction {
  const found = new Set<string>();
  const next: ParsedForm = parsed.kind === "docx" ? { ...parsed, blocks: redactDocx(parsed.blocks, found) } : { ...parsed, pdf: redactPdf(parsed.pdf, found) };
  return { parsed: next, findings: Array.from(found) };
}

/** The warning shown with the proposed map when the uploaded form was already filled in. */
export function prefilledWarning(findings: string[], prefilledFields: number): string | null {
  const parts = findings.slice(0, 4);
  if (prefilledFields > 0) parts.push(`${prefilledFields} filled-in fillable field${prefilledFields === 1 ? "" : "s"}`);
  if (parts.length === 0) return null;
  return `This form already contains details that look like patient information (${parts.join(", ")}). ${WORDING.server.analysis.prefilledRemoved} Upload ${"the referrer's"} blank form instead, so no patient details are stored with the form map.`;
}
