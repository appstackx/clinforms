import "server-only";

/**
 * Deterministic checks on a proposed form map (live analysis, recorded analysis or rules) before
 * staff see it. Claude proposes; code decides what is safe to keep:
 *
 * - Anchors must exist in the parsed document: a Word block ID from the outline (or a paragraph inside
 *   one of its cells), a fillable-PDF field name, or a box on a real page. Common slips are repaired
 *   (the label cell chosen instead of the empty answer cell next to it, a placeholder that is not in the
 *   block, tick boxes linked out of order) and the field's confidence is lowered with a note; an anchor
 *   that cannot be found or repaired drops the field with a plain-English warning.
 * - Tick boxes: every option must point at a real ☐ (glyph index < the block's glyph count) and the
 *   options must match the linked glyphs one for one.
 * - No two fields may share an answer space (the later one is dropped with a warning).
 * - Identifiers (name, date of birth, address, references) are always filled by code from the
 *   registration record, and opinion questions (prognosis, causation, fitness for work, restrictions,
 *   recommendations) are always "clinician_opinion" – whatever the model proposed (form-classify.ts).
 * - Field IDs F-01, F-02… are assigned in document order of the anchors.
 *
 * Pure (no I/O). Owner: ai agent.
 */
import type {
  AnswerType,
  ComputedFactFormat,
  DocxAnchor,
  FactId,
  FillSource,
  FormAnchor,
  FormField,
  FormFieldConfidence,
  OptionGlyph,
  OutlineBlock,
  SignoffPart,
} from "../core/types";
import { FormFieldSchema } from "../core/schemas";
import type { AnalysisFieldOutput } from "./form-analysis-schema";
import { snapOverlay } from "./form-boxes";
import { classifyLabel } from "./form-classify";
import { pdfTableQuestions } from "./form-tables";
import {
  docxOrder,
  indexDocx,
  indexPdf,
  resolveDocxBlock,
  rowKey,
  siblingCellId,
  type DocxIndex,
  type ParsedForm,
  type PdfIndex,
} from "./form-outline";

export interface PostValidateResult {
  fields: FormField[];
  /** Plain-English warnings for the staff member (dropped or repaired fields). */
  warnings: string[];
  dropped: number;
  repaired: number;
}

export interface PostValidateOptions {
  /** Highest confidence any field may keep (rules mode: "low"). */
  confidenceCap?: FormFieldConfidence;
}

const RANK: Record<FormFieldConfidence, number> = { low: 0, medium: 1, high: 2 };
const BY_RANK: FormFieldConfidence[] = ["low", "medium", "high"];
function minConf(a: FormFieldConfidence, b: FormFieldConfidence): FormFieldConfidence {
  return BY_RANK[Math.min(RANK[a], RANK[b])];
}

function clean(s: string | undefined | null, max = 300): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

const normText = (s: string) =>
  s
    .toLowerCase()
    .replace(/[☐☒☑]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function quoteLabel(label: string): string {
  return `“${label.length > 60 ? `${label.slice(0, 59)}…` : label}”`;
}

/* ------------------------------------------------------------------------------------------------
 * Anchors
 * ----------------------------------------------------------------------------------------------*/

type AnchorOutcome =
  | { ok: true; anchor: FormAnchor; conf: FormFieldConfidence; notes: string[]; repaired: boolean; options?: string[]; answerType?: AnswerType }
  | { ok: false; reason: string };

/** An empty / placeholder / content-control cell, or a question-and-answer box (blank lines after the question). */
function isWritableCell(b: OutlineBlock | null | undefined, ix?: DocxIndex): boolean {
  if (!b || b.kind !== "cell") return false;
  return b.isEmpty || b.hasPlaceholder || Boolean(b.inContentControl) || Boolean(ix?.qaBoxes.has(b.id));
}

/** Where to write in a cell or paragraph that is a real answer space. */
function anchorForAnswerBlock(b: OutlineBlock): DocxAnchor {
  if (b.legacyFieldName) return { kind: "docx", target: "legacy_form_field", blockId: b.id };
  if (b.inContentControl) return { kind: "docx", target: "content_control", blockId: b.id };
  if (b.hasPlaceholder && b.placeholderText) return { kind: "docx", target: "replace_placeholder", blockId: b.id, placeholderText: b.placeholderText };
  if (b.kind === "cell") return { kind: "docx", target: "table_cell", blockId: b.id };
  return { kind: "docx", target: "after_paragraph", blockId: b.id };
}

/** The empty answer cell next to (or below) a label cell, if any. */
function answerCellNear(ix: DocxIndex, labelCell: OutlineBlock): OutlineBlock | null {
  const right = siblingCellId(labelCell.id, 1);
  const r = right ? ix.byId.get(right) : undefined;
  if (r && isWritableCell(r, ix)) return r;
  const m = /^(.*)\.r(\d+)\.c(\d+)$/.exec(labelCell.id);
  if (m) {
    const below = ix.byId.get(`${m[1]}.r${Number(m[2]) + 1}.c${m[3]}`);
    if (below && isWritableCell(below, ix)) return below;
  }
  return null;
}

/** Find the block that prints the label (for re-locating a missing anchor). */
function findLabelBlock(ix: DocxIndex, label: string): OutlineBlock | null {
  const want = normText(label);
  if (!want) return null;
  return (
    ix.blocks.find((b) => !b.isEmpty && normText(b.text) === want) ??
    ix.blocks.find((b) => !b.isEmpty && want.length >= 6 && normText(b.text).startsWith(want)) ??
    null
  );
}

function glyphOptionsFromText(text: string): string[] {
  const parts = text.split(/[☐☒☑]/);
  if (parts.length < 2) return [];
  const after = parts.slice(1).map((p) => p.replace(/^[\s:–-]+|[\s,;/]+$/g, "").trim());
  if (after.every((p) => p !== "")) return after;
  const before = parts.slice(0, -1).map((p) => p.trim().split(/\s{2,}|\t/).pop() ?? "");
  return before.every((p) => p !== "") ? before : after;
}

function docxGlyphAnchor(raw: AnalysisFieldOutput, ix: DocxIndex, label: string, options: string[]): AnchorOutcome {
  const notes: string[] = [];
  const wanted = raw.optionAnchors.map((o) => ({ option: clean(o.option, 120), blockId: o.ref.trim(), glyphIndex: Math.trunc(o.glyphIndex) }));
  const seen = new Set<string>();
  const valid: OptionGlyph[] = [];
  for (const g of wanted) {
    const block = resolveDocxBlock(ix, g.blockId);
    const key = `${g.blockId}#${g.glyphIndex}`;
    if (!block || g.glyphIndex < 0 || g.glyphIndex >= (block.checkboxGlyphs ?? 0) || seen.has(key)) continue;
    seen.add(key);
    valid.push({ option: g.option || options[valid.length] || `Option ${valid.length + 1}`, blockId: g.blockId, glyphIndex: g.glyphIndex });
  }
  const wantCount = Math.max(options.length, wanted.length);
  if (valid.length > 0 && valid.length === wanted.length && (options.length === 0 || options.length === valid.length)) {
    return {
      ok: true,
      anchor: { kind: "docx", target: "checkbox_glyph", blockId: valid[0].blockId, optionGlyphs: valid },
      conf: "high",
      notes,
      repaired: false,
      options: valid.map((g) => g.option),
    };
  }
  // Repair: one block holds exactly as many ☐ as there are options → link them in order.
  const candidates = [raw.anchorRef.trim(), ...wanted.map((g) => g.blockId)]
    .map((id) => (id ? resolveDocxBlock(ix, id) : null))
    .filter((b): b is OutlineBlock => b !== null && (b.checkboxGlyphs ?? 0) > 0);
  const labelBlock = findLabelBlock(ix, label);
  if (labelBlock && (labelBlock.checkboxGlyphs ?? 0) > 0) candidates.push(labelBlock);
  for (const b of candidates) {
    const glyphOpts = glyphOptionsFromText(b.text);
    const opts = options.length ? options : glyphOpts;
    if ((b.checkboxGlyphs ?? 0) === opts.length && opts.length > 0) {
      notes.push("Tick boxes were re-linked in the order they appear – check them.");
      const optionGlyphs = opts.map((option, i) => ({ option, blockId: b.id, glyphIndex: i }));
      return { ok: true, anchor: { kind: "docx", target: "checkbox_glyph", blockId: b.id, optionGlyphs }, conf: "medium", notes, repaired: true, options: opts };
    }
  }
  if (valid.length > 0) {
    notes.push(`Only ${valid.length} of ${wantCount} tick boxes could be linked – check the options.`);
    return {
      ok: true,
      anchor: { kind: "docx", target: "checkbox_glyph", blockId: valid[0].blockId, optionGlyphs: valid },
      conf: "low",
      notes,
      repaired: true,
      options: valid.map((g) => g.option),
    };
  }
  // No usable tick box: write the answer as text after the question.
  const fallback = resolveDocxBlock(ix, raw.anchorRef.trim()) ?? labelBlock;
  if (!fallback) return { ok: false, reason: `The tick boxes for ${quoteLabel(label)} could not be found, so it was left out. Add it in the mapping editor.` };
  notes.push("The tick boxes could not be linked, so the answer will be written as text after the question.");
  return { ok: true, anchor: { kind: "docx", target: "after_paragraph", blockId: fallback.id }, conf: "low", notes, repaired: true };
}

function docxAnchor(raw: AnalysisFieldOutput, ix: DocxIndex, label: string, options: string[]): AnchorOutcome {
  if (raw.anchorTarget === "checkbox_glyph" || (raw.optionAnchors.length > 0 && raw.anchorTarget !== "pdf_field")) {
    return docxGlyphAnchor(raw, ix, label, options);
  }
  const notes: string[] = [];
  const ref = raw.anchorRef.trim();
  const block = ref ? resolveDocxBlock(ix, ref) : null;
  let target = raw.anchorTarget;
  let repaired = false;
  let conf: FormFieldConfidence = "high";

  if (!block) {
    const labelBlock = findLabelBlock(ix, label);
    if (!labelBlock) {
      return { ok: false, reason: `The answer space for ${quoteLabel(label)} was not found in the document, so it was left out. Add it in the mapping editor.` };
    }
    const cell = labelBlock.kind === "cell" ? answerCellNear(ix, labelBlock) : null;
    notes.push("The answer space was re-located next to the question – check it.");
    return {
      ok: true,
      anchor: cell ? anchorForAnswerBlock(cell) : { kind: "docx", target: "after_paragraph", blockId: labelBlock.id },
      conf: "low",
      notes,
      repaired: true,
    };
  }
  // A paragraph inside a cell ("t0.r1.c1.p0") is kept as given; `block` is then its cell.
  const blockId = ref;

  if (target === "pdf_field" || target === "pdf_overlay") {
    target = block.kind === "cell" ? "table_cell" : "after_paragraph";
    repaired = true;
    conf = "medium";
  }

  switch (target) {
    case "table_cell": {
      if (block.kind !== "cell") {
        return { ok: true, anchor: { kind: "docx", target: "after_paragraph", blockId }, conf: "medium", notes, repaired: true };
      }
      if (!isWritableCell(block, ix)) {
        // Probably the label cell: use the empty cell next to it (or below it).
        const near = answerCellNear(ix, block);
        if (near && normText(block.text) && normText(label).indexOf(normText(block.text).slice(0, 12)) >= 0) {
          notes.push("Moved from the question cell to the empty answer cell next to it.");
          return { ok: true, anchor: anchorForAnswerBlock(near), conf: "medium", notes, repaired: true };
        }
        notes.push("The answer cell already holds text; the answer will be added to it – check the layout.");
        return { ok: true, anchor: { kind: "docx", target: "table_cell", blockId }, conf: "low", notes, repaired: true };
      }
      if (block.hasPlaceholder && block.placeholderText) {
        return { ok: true, anchor: { kind: "docx", target: "replace_placeholder", blockId, placeholderText: block.placeholderText }, conf, notes, repaired };
      }
      return { ok: true, anchor: { kind: "docx", target: "table_cell", blockId }, conf, notes, repaired };
    }
    case "replace_placeholder": {
      const want = raw.placeholderText.trim();
      // Word's own content-control prompt ("Click or tap here to enter text.") is filled as the control.
      if (block.inContentControl && /^(?:click or tap here|click here|choose an item|enter a date)/i.test(want || block.placeholderText || "")) {
        return { ok: true, anchor: { kind: "docx", target: "content_control", blockId }, conf, notes, repaired };
      }
      if (want && block.text.indexOf(want) >= 0) {
        return { ok: true, anchor: { kind: "docx", target: "replace_placeholder", blockId, placeholderText: want }, conf, notes, repaired };
      }
      if (block.placeholderText && block.text.indexOf(block.placeholderText) >= 0) {
        notes.push("Placeholder text corrected to the one printed in the document.");
        return {
          ok: true,
          anchor: { kind: "docx", target: "replace_placeholder", blockId, placeholderText: block.placeholderText },
          conf: minConf(conf, "medium"),
          notes,
          repaired: true,
        };
      }
      notes.push("No placeholder was found there, so the answer will be written after it – check it.");
      return {
        ok: true,
        anchor: block.kind === "cell" && block.isEmpty ? { kind: "docx", target: "table_cell", blockId } : { kind: "docx", target: "after_paragraph", blockId },
        conf: "low",
        notes,
        repaired: true,
      };
    }
    case "content_control":
    case "legacy_form_field": {
      const okHere = target === "content_control" ? Boolean(block.inContentControl) : Boolean(block.legacyFieldName);
      if (okHere) return { ok: true, anchor: { kind: "docx", target, blockId }, conf, notes, repaired };
      notes.push(`No ${target === "content_control" ? "content control" : "form field"} was found there – check where the answer goes.`);
      return { ok: true, anchor: anchorForAnswerBlock(block), conf: "low", notes, repaired: true };
    }
    case "after_paragraph":
    default:
      return { ok: true, anchor: { kind: "docx", target: "after_paragraph", blockId }, conf, notes, repaired };
  }
}

function pdfFieldAnchor(raw: AnalysisFieldOutput, ix: PdfIndex, label: string, answerType: AnswerType, options: string[]): AnchorOutcome {
  const names = [raw.anchorRef, ...raw.optionAnchors.map((o) => o.ref)].map((n) => n.trim()).filter(Boolean);
  let field = names.map((n) => ix.byName.get(n)).find((f) => f !== undefined);
  let conf: FormFieldConfidence = "high";
  const notes: string[] = [];
  let repaired = false;
  if (!field) {
    const lower = names.map((n) => n.toLowerCase());
    field = ix.pdf.fields.find((f) => lower.indexOf(f.name.toLowerCase()) >= 0);
    if (field) {
      repaired = true;
      conf = "medium";
    }
  }
  if (!field) {
    return { ok: false, reason: `The fillable field for ${quoteLabel(label)} was not found in the PDF, so it was left out. Add it in the mapping editor.` };
  }
  const anchor: FormAnchor = { kind: "pdf_field", fieldName: field.name, fieldType: field.type };
  if (field.options?.length) anchor.options = field.options.slice();
  let type = answerType;
  let opts = options;
  if (field.type === "checkbox") {
    const distinct = new Set(raw.optionAnchors.map((o) => o.ref.trim()).filter(Boolean));
    if (type === "yes_no" && distinct.size > 1) {
      notes.push("The form has separate tick boxes per option; only the first box is linked (ticked for “Yes”). Check it.");
      conf = minConf(conf, "medium");
      repaired = true;
    }
    if (type !== "checkbox" && type !== "yes_no") repaired = true;
    type = "checkbox";
    opts = [];
  } else if (field.type === "radio" || field.type === "dropdown") {
    if (opts.length === 0 && field.options?.length) opts = field.options.slice();
    if (type !== "yes_no" && type !== "single_choice") type = opts.length === 2 && /^y/i.test(opts[0]) && /^n/i.test(opts[1]) ? "yes_no" : "single_choice";
  }
  return { ok: true, anchor, conf, notes, repaired, answerType: type, options: opts };
}

function overlayAnchor(raw: AnalysisFieldOutput, pages: number, label: string): AnchorOutcome {
  const o = raw.overlay;
  const valid =
    Number.isInteger(o.page) &&
    o.page >= 1 &&
    o.page <= Math.max(1, pages) &&
    o.width > 4 &&
    o.height > 4 &&
    o.x >= 0 &&
    o.y >= 0 &&
    o.x + o.width <= 1200 &&
    o.y + o.height <= 1600;
  if (!valid) return { ok: false, reason: `No position on the page could be found for the answer to ${quoteLabel(label)}, so it was left out. Add it in the mapping editor.` };
  return {
    ok: true,
    anchor: { kind: "pdf_overlay", page: o.page, x: o.x, y: o.y, width: o.width, height: o.height },
    conf: "medium",
    notes: ["Flat PDF: the answer is written at an estimated position – check it in the preview."],
    repaired: false,
  };
}

function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let i = text.indexOf(needle);
  while (i >= 0) {
    n += 1;
    i = text.indexOf(needle, i + needle.length);
  }
  return n;
}

/**
 * The answer spaces an anchor uses, each with how many questions may share it. The forms engine gives
 * the k-th question that names the same placeholder (or content control) in a block the k-th one, so
 * "Attended: ____  Failed to attend: ____" is two questions; anything else holds one answer.
 */
function anchorSlots(anchor: FormAnchor, docx: DocxIndex | null): Array<{ key: string; capacity: number }> {
  switch (anchor.kind) {
    case "docx": {
      if (anchor.target === "checkbox_glyph") return (anchor.optionGlyphs ?? []).map((g) => ({ key: `glyph:${g.blockId}#${g.glyphIndex}`, capacity: 1 }));
      const block = docx ? resolveDocxBlock(docx, anchor.blockId) : null;
      const text = block?.text ?? "";
      if (anchor.target === "replace_placeholder") {
        const needle = anchor.placeholderText ?? "";
        return [{ key: `docx:${anchor.blockId}|${needle}`, capacity: Math.max(1, countOccurrences(text, needle)) }];
      }
      if (anchor.target === "content_control") {
        const capacity = block?.placeholderText ? Math.max(1, countOccurrences(text, block.placeholderText)) : 1;
        return [{ key: `sdt:${anchor.blockId}`, capacity }];
      }
      return [{ key: `docx:${anchor.blockId}`, capacity: 1 }];
    }
    case "pdf_field":
      return [{ key: `pdf:${anchor.fieldName}`, capacity: 1 }];
    case "pdf_overlay":
      return [{ key: `overlay:${anchor.page}:${Math.round(anchor.x / 6)}:${Math.round(anchor.y / 6)}`, capacity: 1 }];
    // Tables and tick boxes (S2): every cell / box is one answer space.
    case "pdf_table":
      return anchor.rows.flatMap((row) => anchor.columns.map((c) => row[c.key]).filter(Boolean).map((name) => ({ key: `pdf:${name}`, capacity: 1 })));
    case "pdf_overlay_table":
      return anchor.rowTops.flatMap((t) => anchor.columns.map((c) => ({ key: `overlay:${anchor.page}:${Math.round(c.x / 6)}:${Math.round((t - anchor.rowHeight) / 6)}`, capacity: 1 })));
    case "pdf_overlay_ticks":
      return anchor.options.map((o) => ({ key: `tick:${anchor.page}:${Math.round(o.x)}:${Math.round(o.y)}`, capacity: 1 }));
  }
}

/* ------------------------------------------------------------------------------------------------
 * Fill sources
 * ----------------------------------------------------------------------------------------------*/

const SIGNOFF_BY_TYPE: Partial<Record<AnswerType, SignoffPart>> = {
  signature: "signature",
  clinician_name: "name",
  hcpc_number: "hcpc",
  date_signed: "date",
  date: "date",
};

function fillSourceOf(raw: AnalysisFieldOutput, label: string, section: string | undefined, answerType: AnswerType): { source: FillSource; notes: string[]; conf: FormFieldConfidence } {
  const notes: string[] = [];
  let conf: FormFieldConfidence = "high";
  const cls = classifyLabel(label, section);
  let source: FillSource;
  switch (raw.fillSource) {
    case "registration":
      if (raw.registrationPath !== "none") source = { kind: "registration", path: raw.registrationPath };
      else if (cls.fillSource.kind === "registration") source = cls.fillSource;
      else {
        source = { kind: "notes_narrative" };
        conf = "low";
        notes.push("No registration field matched this question, so it will be drafted from the notes – check it.");
      }
      break;
    case "computed_fact":
      if (raw.computedFact !== "none") {
        const format = raw.computedFormat === "none" ? undefined : (raw.computedFormat as ComputedFactFormat);
        source = { kind: "computed_fact", factId: raw.computedFact as FactId, ...(format && { format }) };
      } else if (cls.fillSource.kind === "computed_fact") source = cls.fillSource;
      else {
        source = { kind: "notes_narrative" };
        conf = "low";
        notes.push("No computed figure matched this question, so it will be drafted from the notes – check it.");
      }
      break;
    case "signoff": {
      const part = raw.signoffPart !== "none" ? raw.signoffPart : SIGNOFF_BY_TYPE[answerType] ?? (cls.fillSource.kind === "signoff" ? cls.fillSource.part : undefined);
      if (part) source = { kind: "signoff", part };
      else {
        source = { kind: "clinician_opinion" };
        conf = "low";
        notes.push("This looks like part of the sign-off but is not a signature, name, HCPC number or date – the clinician completes it.");
      }
      break;
    }
    case "notes_narrative":
      source = { kind: "notes_narrative" };
      break;
    case "clinician_opinion":
      source = { kind: "clinician_opinion" };
      break;
    case "leave_blank":
    default:
      source = { kind: "leave_blank" };
      break;
  }

  // Safety rules, whatever was proposed.
  if (cls.identifier && source.kind !== "registration" && source.kind !== "signoff" && source.kind !== "leave_blank") {
    source = cls.fillSource;
    conf = minConf(conf, "medium");
    notes.push("Identifiers are always filled from the clinic record by code, never drafted.");
  }
  if (cls.opinion && source.kind === "notes_narrative") {
    source = { kind: "clinician_opinion" };
    conf = minConf(conf, "medium");
    notes.push("Opinion questions are answered only with an opinion a clinician recorded, otherwise by the clinician.");
  }
  return { source, notes, conf };
}

/* ------------------------------------------------------------------------------------------------
 * Main
 * ----------------------------------------------------------------------------------------------*/

interface Candidate {
  field: Omit<FormField, "id">;
  order: number;
  seq: number;
  repaired: boolean;
}

export function postValidateFields(parsed: ParsedForm, raws: AnalysisFieldOutput[], opts: PostValidateOptions = {}): PostValidateResult {
  const warnings: string[] = [];
  let dropped = 0;
  let repairedCount = 0;
  const docxIx = parsed.kind === "docx" ? indexDocx(parsed.blocks) : null;
  const pdfIx = parsed.kind !== "docx" ? indexPdf(parsed.pdf) : null;
  const cap = opts.confidenceCap ?? "high";

  const candidates: Candidate[] = [];
  raws.forEach((raw, seq) => {
    const label = clean(raw.label);
    if (!label) {
      dropped += 1;
      warnings.push("An answer space without a printed question was left out.");
      return;
    }
    const section = clean(raw.section, 160) || undefined;
    let answerType: AnswerType = raw.answerType;
    let options = Array.from(new Set(raw.options.map((o) => clean(o, 120)).filter(Boolean)));

    // Anchor.
    let outcome: AnchorOutcome;
    if (docxIx) outcome = docxAnchor(raw, docxIx, label, options);
    else if (pdfIx && parsed.kind === "pdf_acroform" && raw.anchorTarget !== "pdf_overlay") {
      outcome = pdfFieldAnchor(raw, pdfIx, label, answerType, options);
    } else if (pdfIx) {
      outcome =
        raw.anchorTarget === "pdf_field" && pdfIx.byName.has(raw.anchorRef.trim())
          ? pdfFieldAnchor(raw, pdfIx, label, answerType, options)
          : overlayAnchor(raw, pdfIx.pdf.pages, label);
    } else {
      outcome = { ok: false, reason: `The answer space for ${quoteLabel(label)} was not found.` };
    }
    if (!outcome.ok) {
      dropped += 1;
      warnings.push(outcome.reason);
      return;
    }
    // Flat PDFs with printed boxes (form-boxes.ts): written inside the box, dates between the printed
    // separators, yes/no and choices as an X in the printed tick box.
    if (pdfIx && outcome.anchor.kind === "pdf_overlay") {
      const snapped = snapOverlay(outcome.anchor, pdfIx.pdf, answerType, options);
      if (snapped) outcome = { ...outcome, anchor: snapped.anchor, notes: [snapped.note], ...(snapped.options && { options: snapped.options }) };
    }
    if (outcome.options) options = outcome.options;
    if (outcome.answerType) answerType = outcome.answerType;

    // Answer type vs options.
    const notes: string[] = [...outcome.notes];
    let conf = minConf(raw.confidence, outcome.conf);
    if (outcome.anchor.kind === "docx" && outcome.anchor.target === "checkbox_glyph") {
      const n = outcome.anchor.optionGlyphs?.length ?? 0;
      const yesNo = n === 2 && /^y(?:es)?\b/i.test(options[0] ?? "") && /^no?\b/i.test(options[1] ?? "");
      if (answerType !== "yes_no" && answerType !== "single_choice" && answerType !== "checkbox") {
        answerType = yesNo ? "yes_no" : n === 1 ? "checkbox" : "single_choice";
      }
      if (answerType === "yes_no" && !yesNo && n !== 2) answerType = n === 1 ? "checkbox" : "single_choice";
    }
    if (answerType === "yes_no" && options.length === 0) options = ["Yes", "No"];
    if (answerType === "single_choice" && options.length === 0) {
      answerType = "short_text";
      conf = "low";
      notes.push("No options were found for this choice, so it will be answered as text.");
    }

    const fill = fillSourceOf(raw, label, section, answerType);
    notes.push(...fill.notes);
    conf = minConf(minConf(conf, fill.conf), cap);
    if (raw.note.trim()) notes.unshift(clean(raw.note, 200));

    const field: Omit<FormField, "id"> = {
      label,
      ...(section && { section }),
      guidance: clean(raw.guidance, 400) || `Answer ${quoteLabel(label)} as asked on the form.`,
      answerType,
      ...(options.length > 0 && (answerType === "yes_no" || answerType === "single_choice" || answerType === "checkbox") && { options }),
      anchor: outcome.anchor,
      fillSource: fill.source,
      required: Boolean(raw.required),
      confidence: conf,
      ...(notes.length > 0 && { note: clean(Array.from(new Set(notes)).join(" "), 500) }),
    };

    let order = seq;
    if (docxIx && outcome.anchor.kind === "docx") {
      const ids = outcome.anchor.target === "checkbox_glyph" ? (outcome.anchor.optionGlyphs ?? []).map((g) => g.blockId) : [outcome.anchor.blockId];
      order = Math.min(...ids.map((id) => docxOrder(docxIx, id)));
    } else if (pdfIx && outcome.anchor.kind === "pdf_field") {
      order = pdfIx.order.get(outcome.anchor.fieldName) ?? seq;
    } else if (outcome.anchor.kind === "pdf_overlay" || outcome.anchor.kind === "pdf_overlay_ticks") {
      const at = outcome.anchor.kind === "pdf_overlay" ? outcome.anchor : { page: outcome.anchor.page, ...outcome.anchor.options[0] };
      order = at.page * 100_000 + (2_000 - Math.round(at.y)) * 10 + Math.min(9, Math.round(at.x / 100));
    }
    if (outcome.repaired) repairedCount += 1;
    candidates.push({ field, order, seq, repaired: outcome.repaired });
  });

  // Fillable PDFs: a table of fields (repeated rows) is one question, not one per cell (form-tables.ts).
  if (pdfIx && parsed.kind === "pdf_acroform") {
    const tables = pdfTableQuestions(parsed.pdf, candidates.map((c) => c.field), pdfIx.order);
    const replaced = new Set(tables.flatMap((t) => t.replaces));
    const kept = candidates.filter((_, i) => !replaced.has(i));
    for (const t of tables) {
      kept.push({ field: { ...t.field, confidence: minConf(t.field.confidence, cap) }, order: t.order, seq: -1, repaired: false });
      if (t.replaces.length > 1) warnings.push(`The ${t.table.rows.length}-row table “${t.field.label}” is one question (${t.replaces.length} cell questions were combined).`);
    }
    candidates.splice(0, candidates.length, ...kept);
  }

  // Document order, then the model's order.
  candidates.sort((a, b) => a.order - b.order || a.seq - b.seq);

  // One answer space per question (repeated placeholders / controls in one block: one each, in order).
  const used = new Map<string, Candidate[]>();
  const kept: Candidate[] = [];
  for (const c of candidates) {
    const slots = anchorSlots(c.field.anchor, docxIx);
    const full = slots.find((slot) => (used.get(slot.key)?.length ?? 0) >= slot.capacity);
    if (full) {
      const clash = (used.get(full.key) ?? [])[0];
      dropped += 1;
      warnings.push(
        `${quoteLabel(c.field.label)} pointed at the same answer space as ${quoteLabel(clash?.field.label ?? "another question")}, so it was left out. Add it in the mapping editor if it is a separate question.`,
      );
      continue;
    }
    slots.forEach((slot) => used.set(slot.key, [...(used.get(slot.key) ?? []), c]));
    kept.push(c);
  }

  const fields: FormField[] = kept.map((c, i) => FormFieldSchema.parse({ id: `F-${String(i + 1).padStart(2, "0")}`, ...c.field }));
  if (repairedCount > 0) {
    warnings.push(`${repairedCount} answer space${repairedCount === 1 ? " was" : "s were"} corrected automatically and marked for checking.`);
  }
  return { fields, warnings, dropped, repaired: repairedCount };
}

/** Exposed for tests and the rules mode. */
export { glyphOptionsFromText, rowKey };
