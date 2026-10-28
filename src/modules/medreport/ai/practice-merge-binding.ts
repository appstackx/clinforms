import "server-only";

/**
 * A clinic system's letter merge codes in a Word form (10/2026; dictionary: core/practice-merge-codes.ts). After the
 * reading (live or rules, ai/analyse-form.ts) has proposed its questions, every code printed in the form's body –
 * <<P_TITLE>> <<P_FIRSTNAM>> <<P_SURNAME>>, <<P_DOB>>, <<P_ADDRESS1>>…, <<P_GROUPREF>>, <<P_CONSNAME>>, <<DATE>>,
 * <<P_LOCATION_ADDRESS2>>… – becomes ONE question that replaces exactly that code ("replace_placeholder"), answered:
 *
 * - FROM THE RECORD where the record holds the detail (registration fill source, filled by code);
 * - an address printed over several lines (<<P_ADDRESS1>> / <<P_ADDRESS3>> / <<P_ADDRESS4>> on lines of their own) is
 *   spread over those lines in order (registration `part`), a line the address does not have is left empty and the
 *   code removed; an address printed on one line (<<P_ADDRESS1>>, <<P_ADDRESS3>>, <<P_POSTCODE>>) is one answer;
 * - by staff on each report ("staff.entry", flagged with the code) when the record does not hold it, or when the code
 *   is not in the dictionary.
 *
 * The reading's own questions for the same place are replaced (a placeholder that is a code, or the code's own box);
 * any other question on a line that holds codes is kept and flagged. Questions are then put back in document order and
 * numbered again. The merge-field safety block is untouched: a form is never approved while a code is left on it
 * (core/merge-fields.ts), so a code whose answer is missing still stops approval until staff enter it.
 *
 * Pure (no I/O): a function of the outline and the proposed questions.
 */
import { findPracticeCodes, practiceCode, type PracticeCode } from "../core/practice-merge-codes";
import { docxAnchorBlockIds } from "../core/forms";
import { FormFieldSchema } from "../core/schemas";
import type { AnswerType, FillSource, FormField, OutlineBlock, RegistrationPath } from "../core/types";
import type { ParsedForm } from "./form-outline";

export interface MergeBindingResult {
  fields: FormField[];
  warnings: string[];
  /** Codes answered from the record. */
  fromRecords: number;
  /** Codes left for staff (not held, or unknown). */
  forStaff: number;
  /** The reading's questions replaced by a code's question. */
  replaced: number;
}

/** A line of the form: a body paragraph, a paragraph inside a cell, or a one-paragraph cell. */
interface Unit {
  block: OutlineBlock;
  order: number;
  codes: Array<{ code: string; text: string; index: number; entry: PracticeCode | null }>;
}

/** One question to add. */
interface Proposal {
  blockId: string;
  placeholderText: string;
  /** Position in the block's text (document order inside a line). */
  at: number;
  order: number;
  label: string;
  guidance: string;
  answerType: AnswerType;
  fillSource: FillSource;
  confidence: FormField["confidence"];
  note: string;
  fromRecords: boolean;
}

const FILLER = /^[\s,;:.\-–—/()]*$/;
const LINE_FAMILY: Record<string, "patient" | "clinic"> = {};

function familyOf(entry: PracticeCode | null): { family: "patient" | "clinic"; kind: "line" | "postcode" } | null {
  if (!entry) return null;
  const b = entry.binding;
  if (b.kind === "address_line") return { family: b.family, kind: "line" };
  if (b.kind === "postcode") return { family: b.family, kind: "postcode" };
  return null;
}

function clean(s: string, max = 120): string {
  return s.replace(/\s+/g, " ").trim().slice(0, max);
}

/** The printed label in front of a code on its line ("Date of Birth:" → "Date of Birth"), or "". */
function labelBefore(text: string, index: number): string {
  const before = text.slice(0, index);
  const lastCode = before.lastIndexOf(">>");
  const own = lastCode >= 0 ? before.slice(lastCode + 2) : before;
  const label = clean(own.split("\n").pop() ?? "").replace(/[:\-–—\s]+$/, "");
  return label.length >= 2 && /[A-Za-z]/.test(label) ? label : "";
}

/** The text of the cell to the left (same row), for a code alone in a cell ("Name:" | "<<P_SURNAME>>"). */
function labelLeft(block: OutlineBlock, byId: Map<string, OutlineBlock>): string {
  const m = /^(.*\.r\d+\.c)(\d+)(?:\.p\d+)?$/.exec(block.id);
  if (!m || Number(m[2]) === 0) return "";
  const left = byId.get(`${m[1]}${Number(m[2]) - 1}`);
  const label = clean(left?.text ?? "").replace(/[:\-–—\s]+$/, "");
  return label && !findPracticeCodes(label).length && label.length <= 80 ? label : "";
}

const quote = (s: string) => `“${s}”`;

/**
 * The part of a printed label nearest to its code: labels run together on a line ("First appointment:      Discharged
 * on: <<DATE>>") – the last part ("Discharged on") is the code's own.
 */
function nearestLabel(label: string): string {
  const parts = label
    .split(/:\s*|\s{2,}|\t/)
    .map((s) => s.trim())
    .filter((s) => /[A-Za-z]/.test(s));
  return parts.length ? parts[parts.length - 1] : label;
}
/** A date code beside the accident's label ("Accident date", "Injury date"). */
const ACCIDENT_DATE_LABEL = /\b(?:accident|injury|incident|onset|occurrence|collision|RTA)\b/i;
/** A date code beside a label naming another date than the report's ("Date of first visit", "Discharged on"). */
const OTHER_DATE_LABEL =
  /\b(?:birth|DOB|assess\w*|attend\w*|seen|appointment|admi(?:ssion|tted)|discharge\w*|treatment|referr\w*|instruct\w*|request\w*|surgery|operation|examin\w*|consultation|session|first|initial|last|next|review|follow[- ]?up|start\w*|return\w*)\b/i;

/**
 * Plan WE design 3 (B0-19, B2-22, D-9): where a value comes from, in the same words in notes and guidance – and the
 * words the map lint (core/form-map-lint.ts L3) checks: a clinic detail comes "From your Clinic details", a detail
 * the record does not hold is "Entered by staff on each report", and only the patient's record is "filled from the
 * record". Every new upload of a clinic-system template gets these words.
 */
export const SOURCE_WORDS = {
  clinic: "From your Clinic details",
  staff: "Entered by staff on each report",
  record: "Filled from the record",
} as const;

/** The source words for a registration path. */
export function sourceWordsFor(path: RegistrationPath): string {
  if (path === "staff.entry") return SOURCE_WORDS.staff;
  return path.startsWith("clinic.") ? SOURCE_WORDS.clinic : SOURCE_WORDS.record;
}

function recordNote(code: string, entry: PracticeCode, path: RegistrationPath): string {
  return path.startsWith("clinic.")
    ? `${SOURCE_WORDS.clinic}: the clinic system's merge code ${code} (${entry.meaning}).`
    : `From the clinic system's merge code ${code} (${entry.meaning}): filled from the record.`;
}

function staffNote(code: string, entry: PracticeCode | null): string {
  return entry
    ? `The clinic system's merge code ${code} (${entry.meaning}): the record here does not hold it, so staff enter it on each report – or choose where it comes from in the mapping.`
    : `The clinic system's merge code ${code} is not one this form reading knows: staff enter it on each report – or choose where it comes from in the mapping.`;
}

const STAFF_ENTRY: FillSource = { kind: "registration", path: "staff.entry" };

/** The question for one non-address code. */
function codeProposal(unit: Unit, c: Unit["codes"][number], label: string, many: boolean): Proposal {
  const entry = c.entry;
  const printed = label && !many ? label : "";
  const base = {
    blockId: unit.block.id,
    placeholderText: c.text,
    at: c.index,
    order: unit.order,
  };
  const guidanceFor = (what: string) => `${printed || label ? `Printed as ${quote(printed || label)}. ` : ""}${what}`;
  if (!entry || entry.binding.kind === "not_held") {
    return {
      ...base,
      label: printed || entry?.label || `Merge code ${c.text}`,
      guidance: guidanceFor(entry ? `${SOURCE_WORDS.staff}: ${entry.meaning}.` : `${SOURCE_WORDS.staff}: the detail the clinic system puts in ${c.text}.`),
      answerType: "short_text",
      fillSource: STAFF_ENTRY,
      confidence: "low",
      note: staffNote(c.text, entry),
      fromRecords: false,
    };
  }
  const b = entry.binding;
  if (b.kind === "by_label") {
    const choice = b.choices.find((ch) => ch.label.test(label));
    if (!choice) {
      return {
        ...base,
        label: printed || entry.label,
        guidance: guidanceFor(`${SOURCE_WORDS.staff}: ${entry.meaning}.`),
        answerType: "short_text",
        fillSource: STAFF_ENTRY,
        confidence: "low",
        note: staffNote(c.text, { ...entry, meaning: entry.meaning }),
        fromRecords: false,
      };
    }
    return {
      ...base,
      label: printed || entry.label,
      guidance: guidanceFor(`${sourceWordsFor(choice.path)} (${entry.meaning}).`),
      answerType: choice.answerType,
      fillSource: { kind: "registration", path: choice.path },
      confidence: "medium",
      note: `${recordNote(c.text, entry, choice.path)} The form's label ${quote(label)} says what it holds here – check it.`,
      fromRecords: true,
    };
  }
  if (b.kind !== "record") throw new Error("address codes are proposed by addressProposals");
  // Verify fix (10/2026): the clinic system prints the LETTER's date for <<DATE>> wherever the template puts it – also
  // beside an accident date's or an assessment date's label. Beside the accident it is the record's accident date
  // (flagged); beside any other date it stays the report date but is flagged for staff to check.
  if (b.path === "report.date" && label) {
    const near = nearestLabel(label);
    if (ACCIDENT_DATE_LABEL.test(near)) {
      return {
        ...base,
        label: printed || near,
        guidance: guidanceFor("Filled from the record: the date of the accident."),
        answerType: "date",
        fillSource: { kind: "registration", path: "incident.date" },
        confidence: "medium",
        note: `The clinic system prints the letter's date for ${c.text}, but the form's label ${quote(near)} asks for the date of the accident: filled from the record's accident date – check it.`,
        fromRecords: true,
      };
    }
    if (OTHER_DATE_LABEL.test(near)) {
      return {
        ...base,
        label: printed || entry.label,
        guidance: guidanceFor(`${sourceWordsFor(b.path)}: ${entry.meaning}.`),
        answerType: b.answerType,
        fillSource: { kind: "registration", path: b.path },
        confidence: "low",
        note: `${recordNote(c.text, entry, b.path)} The form's label ${quote(near)} names another date than the report's – check it, and choose where it comes from in the mapping (for example the first appointment or the discharge date).`,
        fromRecords: true,
      };
    }
  }
  const doubtful = entry.doubtfulBeside && label && entry.doubtfulBeside.test(label);
  const location = b.path === "clinic.name";
  return {
    ...base,
    label: printed || entry.label,
    guidance: guidanceFor(`${sourceWordsFor(b.path)}: ${entry.meaning}.`),
    answerType: b.answerType,
    fillSource: { kind: "registration", path: b.path },
    confidence: doubtful ? "low" : location ? "medium" : "high",
    note: doubtful
      ? `${recordNote(c.text, entry, b.path)} The form's label ${quote(label)} suggests something else is meant here – check where it comes from.`
      : location
        ? `${recordNote(c.text, entry, b.path)} It is the clinic's name from its settings: if the patient is seen at another of your sites, enter that site's name.`
        : recordNote(c.text, entry, b.path),
    fromRecords: true,
  };
}

/** Address codes: one answer per printed line, or one answer for an address on a single line. */
function addressProposals(units: Unit[], byId: Map<string, OutlineBlock>): Proposal[] {
  type Span = { unit: Unit; start: number; end: number; codes: Unit["codes"]; family: "patient" | "clinic"; postcode: boolean };
  // Spans of one family's codes on a line, separated only by commas, spaces…
  const spansOf = (unit: Unit): Span[] => {
    const out: Span[] = [];
    let cur: Span | null = null;
    for (const c of unit.codes) {
      const fam = familyOf(c.entry);
      if (!fam) {
        cur = null;
        continue;
      }
      const between = cur ? unit.block.text.slice(cur.end, c.index) : "";
      if (cur && cur.family === fam.family && FILLER.test(between)) {
        cur.end = c.index + c.text.length;
        cur.codes.push(c);
        cur.postcode ||= fam.kind === "postcode";
      } else {
        cur = { unit, start: c.index, end: c.index + c.text.length, codes: [c], family: fam.family, postcode: fam.kind === "postcode" };
        out.push(cur);
      }
    }
    return out;
  };
  /** A line that holds nothing but this family's address codes (and filler) – after an optional label. */
  const addressOnly = (unit: Unit, span: Span, allowLabel: boolean): boolean => {
    const text = unit.block.text;
    const after = text.slice(span.end);
    const before = text.slice(0, span.start);
    return FILLER.test(after) && (FILLER.test(before) || (allowLabel && /:\s*$/.test(before)));
  };

  const proposals: Proposal[] = [];
  const spans = units.flatMap(spansOf);
  const used = new Set<Span>();
  for (let i = 0; i < spans.length; i++) {
    const first = spans[i];
    if (used.has(first)) continue;
    // A run: this span's line and the following lines that hold only the same family's address codes.
    const run: Span[] = [first];
    if (addressOnly(first.unit, first, true)) {
      for (let j = i + 1; j < spans.length; j++) {
        const next = spans[j];
        const prev = run[run.length - 1];
        // The very next line of the form (`units` holds every line, with or without codes).
        const adjacent = units.indexOf(next.unit) === units.indexOf(prev.unit) + 1;
        if (!adjacent || next.family !== first.family || !addressOnly(next.unit, next, false)) break;
        run.push(next);
      }
    }
    run.forEach((s) => used.add(s));
    const who = first.family === "patient" ? "patient's" : "clinic's";
    const Who = first.family === "patient" ? "Patient's" : "Clinic";
    const printed = labelBefore(first.unit.block.text, first.start) || labelLeft(first.unit.block, byId);
    const lineFill = (index: number, of: number): FillSource => ({
      kind: "registration",
      path: (first.family === "patient" ? "patient.addressLines" : "clinic.addressLines") as RegistrationPath,
      part: { index, of },
    });
    const postcodeFill: FillSource = { kind: "registration", path: first.family === "patient" ? "patient.postcode" : "clinic.postcode" };
    const codesText = (codes: Unit["codes"]) => codes.map((c) => c.text).join(", ");
    /** WE design 3: a clinic's address comes from its Clinic details; the patient's from the record. */
    const fromWords = first.family === "clinic" ? SOURCE_WORDS.clinic : SOURCE_WORDS.record;
    const codesNote = (codes: Unit["codes"], tail = "") =>
      first.family === "clinic"
        ? `${SOURCE_WORDS.clinic}: the clinic system's merge code${codes.length === 1 ? "" : "s"} ${codesText(codes)}${tail ? ` (${tail})` : ""}.`
        : `From the clinic system's merge code${codes.length === 1 ? "" : "s"} ${codesText(codes)}: filled from the record${tail ? ` (${tail})` : ""}.`;
    const settings = first.family === "clinic" ? " (the clinic's address from its settings – if the patient is seen at another of your sites, enter that site's address)" : "";

    if (run.length === 1) {
      // One line: the whole address (with the postcode when the line prints it) as ONE answer.
      const s = first;
      const lineCodes = s.codes.filter((c) => familyOf(c.entry)?.kind === "line");
      const placeholderText = s.unit.block.text.slice(s.start, s.end);
      const fill: FillSource = lineCodes.length === 0 ? postcodeFill : s.postcode ? { kind: "registration", path: first.family === "patient" ? "patient.address" : "clinic.address" } : lineFill(1, 1);
      proposals.push({
        blockId: s.unit.block.id,
        placeholderText,
        at: s.start,
        order: s.unit.order,
        label: printed || (lineCodes.length === 0 ? `${Who} postcode` : `${Who} address`),
        guidance: `${printed ? `Printed as ${quote(printed)}. ` : ""}${fromWords}: the ${who} ${lineCodes.length === 0 ? "postcode" : s.postcode ? "address with its postcode, on one line" : "address on one line"}${settings}.`,
        answerType: "short_text",
        fillSource: fill,
        confidence: first.family === "clinic" ? "medium" : "high",
        note: codesNote(s.codes),
        fromRecords: true,
      });
      continue;
    }
    // Several lines: the address's lines in order over the printed lines; the postcode on its own.
    const lineSpans: Array<{ s: Span; start: number; end: number; codes: Unit["codes"] }> = [];
    for (const s of run) {
      const lines = s.codes.filter((c) => familyOf(c.entry)?.kind === "line");
      const postcodes = s.codes.filter((c) => familyOf(c.entry)?.kind === "postcode");
      if (lines.length > 0) lineSpans.push({ s, start: lines[0].index, end: lines[lines.length - 1].index + lines[lines.length - 1].text.length, codes: lines });
      for (const pc of postcodes) {
        proposals.push({
          blockId: s.unit.block.id,
          placeholderText: pc.text,
          at: pc.index,
          order: s.unit.order,
          label: `${Who} postcode`,
          guidance: `${fromWords}: the ${who} postcode${settings}.`,
          answerType: "short_text",
          fillSource: postcodeFill,
          confidence: first.family === "clinic" ? "medium" : "high",
          note: codesNote([pc]),
          fromRecords: true,
        });
      }
    }
    lineSpans.forEach((ls, k) => {
      const placeholderText = ls.s.unit.block.text.slice(ls.start, ls.end);
      // Lines that hold more than one code ("<<P_ADDRESS3>> <<P_ADDRESS4>>") are one printed line.
      proposals.push({
        blockId: ls.s.unit.block.id,
        placeholderText,
        at: ls.start,
        order: ls.s.unit.order,
        label: `${printed || `${Who} address`} – line ${k + 1} of ${lineSpans.length}`,
        guidance: `${printed ? `Printed as ${quote(printed)}. ` : ""}${fromWords}: line ${k + 1} of the ${who} address as printed over ${lineSpans.length} lines${settings}. A line the address does not have is left empty.`,
        answerType: "short_text",
        fillSource: lineFill(k + 1, lineSpans.length),
        confidence: first.family === "clinic" ? "medium" : "high",
        note: codesNote(ls.codes, `line ${k + 1} of ${lineSpans.length}`),
        fromRecords: true,
      });
    });
  }
  return proposals;
}

/** Document position of a field's anchor (its block's place in the outline). */
function fieldOrder(field: FormField, order: Map<string, number>): number {
  if (field.anchor.kind !== "docx") return Number.MAX_SAFE_INTEGER;
  const ids = docxAnchorBlockIds(field.anchor);
  const at = ids.map((id) => order.get(id) ?? order.get(id.replace(/\.p\d+$/, "")) ?? Number.MAX_SAFE_INTEGER);
  return at.length ? Math.min(...at) : Number.MAX_SAFE_INTEGER;
}

/** The questions for the clinic system's merge codes in a Word form (see the file comment). */
export function bindPracticeMergeCodes(parsed: ParsedForm, fields: FormField[]): MergeBindingResult {
  const none: MergeBindingResult = { fields, warnings: [], fromRecords: 0, forStaff: 0, replaced: 0 };
  if (parsed.kind !== "docx") return none;
  const blocks = parsed.blocks;
  const order = new Map<string, number>();
  blocks.forEach((b, i) => order.set(b.id, i));
  const byId = new Map(blocks.map((b) => [b.id, b] as const));
  // Lines: paragraphs (body, or inside a cell), and cells that have no paragraph blocks of their own.
  const cellsWithParagraphs = new Set(blocks.filter((b) => b.kind === "paragraph" && /\.p\d+$/.test(b.id)).map((b) => b.id.replace(/\.p\d+$/, "")));
  const lines = blocks.filter((b) => b.kind === "paragraph" || !cellsWithParagraphs.has(b.id));
  const units: Unit[] = [];
  lines.forEach((block) => {
    const codes = findPracticeCodes(block.text).map((c) => ({ ...c, entry: practiceCode(c.code) }));
    units.push({ block, order: order.get(block.id) ?? 0, codes });
  });
  const withCodes = units.filter((u) => u.codes.length > 0);
  if (withCodes.length === 0) return none;

  // Address codes first (runs over adjacent lines need the neighbouring lines), then every other code.
  const proposals: Proposal[] = addressProposals(units, byId);
  for (const unit of withCodes) {
    const others = unit.codes.filter((c) => !familyOf(c.entry));
    const many = unit.codes.length > 1;
    for (const c of others) {
      const label = labelBefore(unit.block.text, c.index) || (unit.codes.length === 1 ? labelLeft(unit.block, byId) : "");
      proposals.push(codeProposal(unit, c, label, many));
    }
  }

  // The reading's questions for the same places are replaced; others on those lines are kept and flagged.
  const codeBlocks = new Map(withCodes.map((u) => [u.block.id, u] as const));
  /** The lines with codes an anchor writes into: its own block, or – for a cell – the cell's paragraphs. */
  const unitsAt = (id: string): Unit[] => {
    const own = codeBlocks.get(id);
    if (own) return [own];
    return withCodes.filter((u) => u.block.id.startsWith(`${id}.p`));
  };
  let replaced = 0;
  const kept: FormField[] = [];
  const sectionAt = new Map<string, string>();
  for (const f of fields) {
    // Tick boxes, marked cells and kept options write no text where a code is printed (10/2026).
    if (f.anchor.kind !== "docx" || f.anchor.target === "checkbox_glyph" || f.anchor.target === "mark_cell" || f.anchor.target === "delete_options") {
      kept.push(f);
      continue;
    }
    const at = unitsAt(f.anchor.blockId);
    if (at.length === 0) {
      kept.push(f);
      continue;
    }
    if (f.section) for (const u of at) sectionAt.set(u.block.id, f.section);
    const ph = f.anchor.placeholderText ?? "";
    const codes = at.flatMap((u) => u.codes);
    const isCodePlaceholder = f.anchor.target === "replace_placeholder" && ph !== "" && codes.some((c) => ph.includes(c.text) || c.text.includes(ph));
    const restOfLine = at.map((u) => u.codes.reduce((t, c) => t.split(c.text).join(""), u.block.text)).join("\n");
    const codeBox = (f.anchor.target === "table_cell" || f.anchor.target === "after_paragraph") && FILLER.test(restOfLine.replace(/^[^:\n]*:/, ""));
    const lineLabel = clean(restOfLine).replace(/[:\-–—\s]+$/, "").toLowerCase();
    const own = clean(f.label).replace(/[:\-–—\s]+$/, "").toLowerCase();
    const sameLabel = f.anchor.target === "after_paragraph" && Boolean(lineLabel) && Boolean(own) && (lineLabel.startsWith(own) || own.startsWith(lineLabel));
    if (isCodePlaceholder || codeBox || sameLabel) {
      replaced += 1;
      continue;
    }
    kept.push({
      ...f,
      confidence: "low",
      note: clean([f.note, "This line also holds clinic-system merge codes, each answered by its own question – check this question is not a second answer for one of them."].filter(Boolean).join(" "), 500),
    });
  }

  const added: Array<{ field: Omit<FormField, "id">; order: number; at: number }> = proposals.map((p) => ({
    order: p.order,
    at: p.at,
    field: {
      label: clean(p.label, 160) || "Merge code",
      ...(sectionAt.get(p.blockId) ? { section: sectionAt.get(p.blockId) } : {}),
      guidance: clean(p.guidance, 400),
      answerType: p.answerType,
      anchor: { kind: "docx", target: "replace_placeholder", blockId: p.blockId, placeholderText: p.placeholderText },
      fillSource: p.fillSource,
      required: true,
      confidence: p.confidence,
      note: clean(p.note, 500),
    },
  }));
  /** Where in its line a kept question writes (placeholders by position; an answer after the line after it). */
  const keptAt = (f: FormField): number => {
    if (f.anchor.kind !== "docx") return -1;
    if (f.anchor.target === "after_paragraph") return Number.MAX_SAFE_INTEGER;
    if (f.anchor.target === "replace_placeholder" && f.anchor.placeholderText) return Math.max(-1, (byId.get(f.anchor.blockId)?.text ?? "").indexOf(f.anchor.placeholderText));
    return -1;
  };
  const all = [
    ...kept.map((f, i) => ({ field: f as Omit<FormField, "id"> & { id?: string }, order: fieldOrder(f, order), at: keptAt(f), seq: i })),
    ...added.map((a, i) => ({ field: a.field as Omit<FormField, "id"> & { id?: string }, order: a.order, at: a.at, seq: kept.length + i })),
  ];
  all.sort((a, b) => a.order - b.order || a.at - b.at || a.seq - b.seq);
  const out = all.map((x, i) => {
    const { id: _id, ...rest } = x.field;
    void _id;
    return FormFieldSchema.parse({ id: `F-${String(i + 1).padStart(2, "0")}`, ...rest });
  });

  const fromRecords = proposals.filter((p) => p.fromRecords).length;
  const forStaff = proposals.length - fromRecords;
  const examples = (ps: Proposal[]) => Array.from(new Set(ps.map((p) => p.placeholderText))).slice(0, 3).join(", ");
  const warnings = [
    `This form holds ${withCodes.reduce((n, u) => n + u.codes.length, 0)} merge codes from your clinic system (${examples(proposals)}). ${fromRecords} ${fromRecords === 1 ? "question is" : "questions are"} answered from the patient's record${forStaff ? `; ${forStaff} ${forStaff === 1 ? "is" : "are"} left for staff to enter on each report (${examples(proposals.filter((p) => !p.fromRecords))})` : ""}. Check the mapping once – a form is never approved while a code is left on it.`,
  ];
  return { fields: out, warnings, fromRecords, forStaff, replaced };
}
