/**
 * A form author's instructions for WHOEVER COMPLETES the form (10/2026, Blue Heart's provider templates): notes such as
 * a red "Delete unused cells" under a table of repeat rows, "Delete as necessary" / "(Please delete other choices)"
 * beside a list of options, "Please give … in this box" under a box's label, or "Copy and paste from …" in an answer
 * box. They are meant for the clinic, so the completed form leaves them off (forms/docx-fill.ts) and the Studio's form
 * preview strikes them through (ui/components/shared/docx-instructions.ts).
 *
 * What counts – deliberately narrow, so question text, labels and option lists are never matched:
 *   delete  "[Please] delete/remove" + what to delete: "unused cells/rows/lines…", "as necessary/appropriate/
 *           applicable/required", "(the) other/unwanted choices/options…", "those/any/options which are not required /
 *           do not apply", "if/where not applicable…", "whichever does not apply", "this text/note [before sending]" –
 *           and only where it stands apart from the referrer's wording: in brackets, after ":" ";" "." "–" or a tab,
 *           where the text colour changes, or – at the start of a line – printed in a colour (the red notes of Blue
 *           Heart's templates; a line in the default colour stays, as before). Kinds: "delete_unused" ("Delete unused
 *           cells/rows/lines" – it also asks for the table rows a report leaves empty to go), "delete_note" ("Delete
 *           this text") and "delete" (any other: a note beside a list of options – the fill leaves it off only once
 *           the report has chosen from that list, so a list nobody chose from never reads as chosen).
 *   paste   "Copy and paste from/the/here/into …" / "Cut and paste …" as the whole line (an answer box's prompt).
 *   box     "[Please] give/enter/type/write/add/record/provide … in this box/space/cell" as the whole line, printed in a
 *           colour, in a table cell below a printed label (the label stays).
 * Not instructions: "(please circle/tick)", "if applicable", "Please specify:", "please provide details" – they are
 * the referrer's own question wording.
 *
 * What leaves the line with it: its brackets, the spaces before it, a dash, ";" or bullet that introduces it, and – at
 * the start of a line – the spaces after it. A label's ":" or a full stop ending the referrer's words stays.
 *
 * Hostile sizes (security review 25/10/2026): a line with more than MAX_INSTRUCTIONS_PER_LINE matches, or a form with
 * more than MAX_INSTRUCTIONS_PER_FORM, is not a template's notes: it is left as printed. An instruction's words are at
 * most 10 spaces apart, so one never spans thousands of runs; the fill's own limits on a line's runs and a parent's
 * children are in forms/docx-fill.ts. Browser-safe and pure; linear in the text (the whole-line rules read the line
 * without its trailing spaces and dots, cut off by a plain loop – never a backtracking `[.\s]*$`).
 */

/** Real templates print one or two per line; a line with more is left alone (hostile sizes). */
export const MAX_INSTRUCTIONS_PER_LINE = 20;

/** Real templates print a handful (Blue Heart's: 6 at most); a form with more is left as printed (hostile sizes). */
export const MAX_INSTRUCTIONS_PER_FORM = 200;

export type TemplateInstructionKind = "delete_unused" | "delete" | "delete_note" | "paste" | "box";

export interface TemplateInstruction {
  kind: TemplateInstructionKind;
  /** The instruction as printed, without brackets or a full stop, e.g. "Delete unused cells". */
  text: string;
  /** What leaves the line: [start, end) – the instruction, its brackets and full stop, and the spaces before it. */
  start: number;
  end: number;
}

export interface InstructionLine {
  /** The line's visible text, a tab as "\t" (a tab is kept: it is not a space before an instruction). */
  text: string;
  /**
   * The text colour from each offset on, an entry only where it changes ("" = the default: none, automatic or black),
   * e.g. [{at: 0, colour: "1F497D"}, {at: 17, colour: "FF0000"}].
   */
  colours?: ReadonlyArray<{ at: number; colour: string }>;
  /** The line is in a table cell with a line of printed text above it in the cell (the box's own label). */
  belowLabelInCell?: boolean;
}

/** "" for the default text colour (none, automatic or black), else the colour as given. */
export function instructionColour(colour: string | null | undefined): string {
  const c = (colour ?? "").trim().toLowerCase().replace(/\s+/g, "");
  return /^(?:|auto|#?0{3}|#?0{6}|black|rgb\(0,0,0\)|windowtext)$/.test(c) ? "" : c;
}

/** Between the words of an instruction: a few spaces or a tab, never any number (one instruction spanning thousands of runs). */
const WHAT_TO_DELETE = [
  String.raw`unused\s{1,10}(?:cells?|rows?|lines?|boxes|box|spaces?|sections?|options?|columns?|fields?|items?)`,
  String.raw`as\s{1,10}(?:necessary|appropriate|applicable|required)`,
  String.raw`(?:the\s{1,10})?(?:other|unwanted|inapplicable)\s{1,10}(?:choices?|options?|answers?|responses?|rows?|cells?|lines?|boxes|words?)`,
  String.raw`(?:those|any|options?|choices?|rows?|cells?|lines?|boxes|items?|ones?)\s{1,10}(?:which|that)\s{1,10}(?:are\s{1,10}not|is\s{1,10}not|do\s{1,10}not|does\s{1,10}not|don['’]t|doesn['’]t|aren['’]t)\s{1,10}(?:required|apply|applicable|relevant|needed|used)`,
  String.raw`(?:if|where|when)\s{1,10}not\s{1,10}(?:applicable|required|relevant|needed|used|appropriate)`,
  String.raw`whichever\s{1,10}(?:is\s{1,10}not\s{1,10}applicable|is\s{1,10}inapplicable|does\s{1,10}not\s{1,10}apply|doesn['’]t\s{1,10}apply)`,
  String.raw`(?:this|these)\s{1,10}(?:text|notes?|instructions?|guidance)(?:\s{1,10}before\s{1,10}(?:sending|submitting|returning|issuing)(?:\s{1,10}(?:the|this)\s{1,10}(?:form|report))?)?`,
];
const DELETE_RE = new RegExp(String.raw`\b(?:please\s{1,10})?(?:delete|remove)\s{1,10}(?:${WHAT_TO_DELETE.join("|")})\b`, "gi");
const UNUSED_ROWS_RE = /\bunused\s+(?:cells?|rows?|lines?)\b/i;
const THIS_NOTE_RE = /\b(?:this|these)\s+(?:text|notes?|instructions?|guidance)\b/i;
// Whole-line rules, matched on the line without the spaces around it and its trailing dots (lineCore).
const PASTE_LINE_RE = /^((?:please\s+)?(?:copy|cut)\s+(?:and|&)\s+paste?\s+(?:from|the|here|in|into|your|this|any)\b[^\n]{0,120})$/i;
const BOX_LINE_RE =
  /^((?:please\s+)?(?:give|enter|type|write|put|add|record|provide|insert|include)\b[^\n.]{0,80}?\b(?:in|into|within)\s+this\s+(?:box|space|cell|section|field|area))$/i;
/** Longest line the whole-line rules read (their longest match is about 150 characters). */
const WHOLE_LINE_MAX = 300;
/** Cheap first look: a line without any of these words holds no instruction. */
const HINT_RE = /\b(?:delete|remove|paste|past)\b|\bthis\s+(?:box|space|cell|section|field|area)\b/i;

const SPACE = /[ \u00A0]/;
/** What may come before an instruction that starts a clause: ":" ";" "." "!" "?" a tab, a dash, a bullet. */
const OPENS_CLAUSE = /[:;.!?\t\u2013\u2014\-\u2022*]/;
/** Of those, what introduces the instruction and goes with it: ";", a dash, a bullet (":" and "." end the referrer's words). */
const INTRODUCES = /[;\u2013\u2014\-\u2022*]/;

/** Whether a line may hold an instruction at all (a fast check before reading its runs). */
export function mayHoldInstruction(text: string): boolean {
  return HINT_RE.test(text);
}

/** Index of the first entry with `at` > pos (binary search: entries are in text order). */
function after(colours: ReadonlyArray<{ at: number }>, pos: number): number {
  let lo = 0;
  let hi = colours.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (colours[mid].at <= pos) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The colour runs of a line: where the colour changes, and whether a stretch is all printed in a colour. */
function colourRuns(line: InstructionLine) {
  const colours = line.colours ?? [];
  return {
    /** The colour changes somewhere in [from, to]. */
    changesIn: (from: number, to: number) => {
      const i = Math.max(1, after(colours, from - 1)); // the first entry is where the colour starts, not a change
      return i < colours.length && colours[i].at <= to;
    },
    /** Every character of [from, to) is printed in a colour (not the default). */
    coloured: (from: number, to: number) => {
      const first = after(colours, from) - 1;
      if (first < 0) return false;
      for (let i = first; i < colours.length && colours[i].at < to; i++) if (!colours[i].colour) return false;
      return true;
    },
  };
}

/** The line without the spaces before it and the spaces and dots after it ("…… " answer space) – plain loops, linear. */
function lineCore(text: string): string {
  let a = 0;
  while (a < text.length && /\s/.test(text[a])) a += 1;
  let z = text.length;
  while (z > a && /[.\s]/.test(text[z - 1])) z -= 1;
  return text.slice(a, z);
}

function wholeLine(line: InstructionLine, re: RegExp, kind: TemplateInstructionKind): TemplateInstruction | null {
  const core = lineCore(line.text);
  const m = core.length <= WHOLE_LINE_MAX ? re.exec(core) : null;
  if (!m) return null;
  return { kind, text: m[1].replace(/\s+/g, " ").trim(), start: 0, end: line.text.length };
}

/** The instructions in a line, in order (non-overlapping). */
export function findTemplateInstructions(line: InstructionLine): TemplateInstruction[] {
  const { text } = line;
  if (!mayHoldInstruction(text)) return [];
  const runs = colourRuns(line);
  const paste = wholeLine(line, PASTE_LINE_RE, "paste");
  if (paste) return [paste];
  if (line.belowLabelInCell) {
    const box = wholeLine(line, BOX_LINE_RE, "box");
    if (box && runs.coloured(text.search(/\S/), text.trimEnd().length)) return [box];
  }
  const found: TemplateInstruction[] = [];
  const textEnd = text.trimEnd().length; // nothing but spaces and tabs from here on
  for (const m of Array.from(text.matchAll(DELETE_RE))) {
    const s = m.index ?? 0;
    const e = s + m[0].length;
    let a = s;
    while (a > 0 && SPACE.test(text[a - 1])) a -= 1;
    let z = e;
    if (text[z] === ".") z += 1;
    let b = z;
    while (b < text.length && SPACE.test(text[b])) b += 1;
    const before = a > 0 ? text[a - 1] : "";
    const next = b < text.length ? text[b] : "";
    let start: number;
    let end: number;
    if ((before === "(" && next === ")") || (before === "[" && next === "]")) {
      // "(Please delete other choices)": the brackets go with it, and the spaces before them.
      start = a - 1;
      while (start > 0 && SPACE.test(text[start - 1])) start -= 1;
      end = b + 1;
    } else {
      const standsApartBefore = OPENS_CLAUSE.test(before) || runs.changesIn(a, s) || (before === "" && runs.coloured(s, e));
      const standsApartAfter = z >= textEnd || next === "\t" || runs.changesIn(e, b) || (z > e && b > z);
      if (!standsApartBefore || !standsApartAfter) continue;
      start = a;
      end = z;
      if (INTRODUCES.test(before)) {
        // "Yes / No – delete as applicable." → "Yes / No": the dash goes too (a full stop before more text stays).
        start = a - 1;
        while (start > 0 && SPACE.test(text[start - 1])) start -= 1;
        if (b < textEnd) end = e;
      }
    }
    // At the start of a line (or after a tab), the spaces after it go too: "Delete if not applicable. Then sign …".
    if (start === 0 || text[start - 1] === "\t") while (end < text.length && SPACE.test(text[end])) end += 1;
    if (found.length > 0 && start < found[found.length - 1].end) continue;
    if (found.length === MAX_INSTRUCTIONS_PER_LINE) return [];
    const printed = m[0].replace(/\s+/g, " ");
    const kind = UNUSED_ROWS_RE.test(printed) ? "delete_unused" : THIS_NOTE_RE.test(printed) ? "delete_note" : "delete";
    found.push({ kind, text: printed, start, end });
  }
  return found;
}

/** “Delete as necessary” (3 places) and “Delete those which are not required”. */
function listed(found: readonly Pick<TemplateInstruction, "text">[]): { list: string; many: boolean } {
  const counts = new Map<string, { text: string; n: number }>();
  for (const f of found) {
    const key = f.text.toLowerCase();
    const seen = counts.get(key);
    if (seen) seen.n += 1;
    else counts.set(key, { text: f.text, n: 1 });
  }
  const items = Array.from(counts.values()).map(({ text, n }) => `“${text}”${n > 1 ? ` (${n} places)` : ""}`);
  const list = items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : (items[0] ?? "");
  return { list, many: items.length > 1 };
}

/**
 * For the clinician (the completed form's notes, shown under the form preview): e.g. "Left off the completed form:
 * the form's own instruction “Delete unused cells” (4 places), meant for whoever completes it. As it asks, 23 unused
 * table rows are left off too."
 */
export function instructionsLeftOffNote(found: readonly Pick<TemplateInstruction, "text">[], rowsLeftOff = 0): string {
  const { list, many } = listed(found);
  const rows = rowsLeftOff > 0 ? ` As it asks, ${rowsLeftOff} unused table ${rowsLeftOff === 1 ? "row is" : "rows are"} left off too.` : "";
  return `Left off the completed form: the form's own ${many ? "instructions" : "instruction"} ${list}, meant for whoever completes it.${rows}`;
}

/** Tooltip of an instruction struck through in the Studio's preview of the original form. */
export const INSTRUCTION_PREVIEW_TITLE = "Left off the completed form: an instruction for whoever completes it";

/**
 * For staff checking the form's mapping (the original form, where the instructions are struck through). `rows`: a
 * "Delete unused cells" sits where table rows can go (its row is blank once it is left out, or prints like the row above).
 */
export function instructionsMappingNote(found: readonly Pick<TemplateInstruction, "kind" | "text">[], rows = false): string {
  const { list, many } = listed(found);
  const lists = found.some((f) => f.kind === "delete") ? " One beside a list of options is only left off once the report has chosen from that list." : "";
  const unused = rows && found.some((f) => f.kind === "delete_unused") ? " As it asks, table rows a report leaves empty are left off too." : "";
  return `${many ? "The form's own instructions" : "The form's own instruction"} ${list} ${many ? "are" : "is"} meant for whoever completes it, so ${many ? "they are" : "it is"} struck through here and left off the completed form.${lists}${unused}`;
}
