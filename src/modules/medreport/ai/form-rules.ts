import "server-only";

/**
 * Rules-only form analysis (mode "rules"): no AI call. Used for an uploaded form in demo mode, and as
 * the fallback when no recorded analysis exists. Walks the parsed outline and proposes one field per
 * answer space it recognises:
 *
 * - Word tables: a label cell followed by an empty / placeholder / content-control cell (also "label
 *   above, answer below"); cells and paragraphs with ☐ tick boxes (options from the text around them).
 * - Word paragraphs: placeholders ("[Insert …]", "……", "____"), content controls, legacy form fields,
 *   and a question ending in "?" or ":" followed by an empty paragraph.
 * - Fillable PDFs: every field, labelled from its nearby text.
 * - Flat PDFs: lines that end with ":" / "?" or a "____" blank, with an answer box to their right.
 *
 * Answer types and fill sources come from the label (form-classify.ts). Everything is low confidence –
 * staff complete and confirm the mapping – and passes through the same post-validation as AI output.
 *
 * Owner: ai agent.
 */
import type { AnswerType, OutlineBlock, PdfFormOutline } from "../core/types";
import type { AnalysisFieldOutput } from "./form-analysis-schema";
import { answerTypeFromLabel, classifyLabel } from "./form-classify";
import { cellOfParagraph, isDocxAnswerSpace, pdfFlatLabelCandidates, rowKey, sortedPdfFields, type ParsedForm } from "./form-outline";
import { glyphOptionsFromText } from "./form-postvalidate";

const ZERO_BOX = { page: 0, x: 0, y: 0, width: 0, height: 0 };

const LONG_RE = /\b(?:history|describe|description|details|summary|summarise|findings|examination|treatment|symptoms|progress|comments?|comment on|explain|plan|management|condition|current status|presentation|mechanism|circumstances|other information|please (?:give|provide|state)|prognosis|restrictions?|recommend\w*|opinion|outcome|diagnosis|injury|capacity|adjustments?|reason)\b/i;

function cleanLabel(text: string): string {
  return text
    .replace(/[☐☒☑]/g, " ")
    .replace(/(?:_{3,}|\.{4,}|…{2,})/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s\d.)(•-]+(?=[A-Za-z])/, "")
    .replace(/[\s:]+$/, "")
    .trim();
}

function isHeading(b: OutlineBlock): boolean {
  if (b.isEmpty) return false;
  if (b.headingLevel !== undefined) return true;
  if (b.style && /heading|title/i.test(b.style)) return true;
  return /^(?:section|part)\s+[A-Z0-9]+\b/i.test(b.text.trim()) && b.text.trim().length < 90;
}

function raw(label: string, section: string, rest: Partial<AnalysisFieldOutput>, context = ""): AnalysisFieldOutput {
  const cls = classifyLabel(label, `${section} ${context}`.trim());
  const layoutType = rest.answerType;
  const answerType: AnswerType =
    cls.answerType && (layoutType === undefined || layoutType === "short_text" || layoutType === "long_text")
      ? cls.answerType
      : layoutType ?? answerTypeFromLabel(label) ?? (LONG_RE.test(label) ? "long_text" : "short_text");
  const fill = cls.fillSource;
  return {
    label,
    section,
    guidance: "",
    options: [],
    anchorTarget: "after_paragraph",
    anchorRef: "",
    placeholderText: "",
    optionAnchors: [],
    overlay: ZERO_BOX,
    // The analysis output has no "fixed" kind (staff set fixed answers in the map); the rules never give one.
    fillSource: fill.kind === "fixed" ? "leave_blank" : fill.kind,
    registrationPath: fill.kind === "registration" ? fill.path : "none",
    computedFact: fill.kind === "computed_fact" ? fill.factId : "none",
    computedFormat: fill.kind === "computed_fact" && fill.format ? fill.format : "none",
    signoffPart: fill.kind === "signoff" ? fill.part : "none",
    required: fill.kind !== "leave_blank",
    confidence: "low",
    note: "",
    ...rest,
    answerType,
  };
}

function glyphField(block: OutlineBlock, label: string, section: string): AnalysisFieldOutput | null {
  const options = glyphOptionsFromText(block.text);
  const n = block.checkboxGlyphs ?? 0;
  if (n === 0) return null;
  const opts = options.length === n ? options : Array.from({ length: n }, (_, i) => options[i] ?? `Option ${i + 1}`);
  const yesNo = n === 2 && /^y/i.test(opts[0]) && /^n/i.test(opts[1]);
  return raw(label, section, {
    answerType: yesNo ? "yes_no" : n === 1 ? "checkbox" : "single_choice",
    options: opts,
    anchorTarget: "checkbox_glyph",
    anchorRef: block.id,
    optionAnchors: opts.map((option, i) => ({ option, ref: block.id, glyphIndex: i })),
  });
}

/** Fill-in placeholders in a line of text, with the label printed before each. */
const PLACEHOLDER_RE = /_{3,}|\.{4,}|…{2,}|\[[^\]\n]{1,60}\]|Click or tap here to enter (?:text|a date)\./g;

function placeholdersWithLabels(text: string): Array<{ label: string; placeholder: string }> {
  const out: Array<{ label: string; placeholder: string }> = [];
  let last = 0;
  const re = new RegExp(PLACEHOLDER_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ label: cleanLabel(text.slice(last, m.index)).replace(/[:\s–-]+$/, "").trim(), placeholder: m[0] });
    last = m.index + m[0].length;
  }
  return out;
}

/** Labels that say nothing about the question ("Answer:") – the question above is used instead. */
const GENERIC_LABEL_RE = /^(?:answer|your answer|response)$/i;
/** Follow-up labels ("If yes, please give details") – appended to the question above. */
const FOLLOW_UP_RE = /^(?:details|comments?|notes?|please specify|if (?:yes|no|so|not),? (?:please )?(?:give|provide|state|specify)(?: details)?)$/i;

/** Attendance sub-labels ("Attended: ____  Failed to attend: ____"). */
function attendanceOverride(sub: string): Partial<AnalysisFieldOutput> | null {
  const t = sub.toLowerCase();
  if (/^(?:sessions )?attended$|^number attended$/.test(t)) {
    return { fillSource: "computed_fact", computedFact: "FACT-attendance", computedFormat: "sessions_attended", registrationPath: "none", signoffPart: "none", answerType: "number" };
  }
  if (/\b(?:failed to attend|missed|dna|did not attend|not attended)\b/.test(t)) {
    return { fillSource: "computed_fact", computedFact: "FACT-attendance", computedFormat: "dna_count", registrationPath: "none", signoffPart: "none", answerType: "number" };
  }
  return null;
}

function isQuestionLike(text: string): boolean {
  const t = text.trim();
  return /[?:]$/.test(t) || /^(?:[A-Z]?\d+[.)]|[A-Z]\d+\.?)\s+\S/.test(t);
}

interface Pending {
  label: string;
  /** Last non-empty paragraph of the question (answers go after it). */
  anchorId: string;
  guidance: string;
  answered: boolean;
}

function docxRules(blocks: OutlineBlock[]): AnalysisFieldOutput[] {
  const out: AnalysisFieldOutput[] = [];
  const ids = new Set(blocks.map((b) => b.id));
  const cellParas = new Map<string, OutlineBlock[]>();
  for (const b of blocks) {
    const cell = b.kind === "paragraph" ? cellOfParagraph(b.id) : null;
    if (cell && ids.has(cell)) cellParas.set(cell, [...(cellParas.get(cell) ?? []), b]);
  }
  const isCellParagraph = (b: OutlineBlock) => b.kind === "paragraph" && cellParas.has(cellOfParagraph(b.id) ?? "");
  const byId = new Map(blocks.map((b) => [b.id, b]));
  let section = "";
  let pending: Pending | null = null;
  let lastText = "";

  const push = (label: string, rest: Partial<AnalysisFieldOutput>, guidance = "") => {
    const l = label.slice(0, 200);
    if (!l) return;
    const field = raw(l, section, rest);
    if (guidance) field.guidance = guidance.slice(0, 300);
    out.push(field);
  };
  /**
   * Fields for every placeholder in `b` ("Name: ____  Date of birth: ____"). `fallbackLabel` is the
   * question the fill-ins belong to (left cell or question above), `lastResort` names an unlabelled one.
   */
  const placeholderFields = (b: OutlineBlock, fallbackLabel: string, guidance = "", lastResort = "") => {
    const found = placeholdersWithLabels(b.text);
    const next = blocks[blocks.indexOf(b) + 1];
    const continued = Boolean(next && next.kind === "paragraph" && next.hasPlaceholder && !cleanLabel(next.text.replace(PLACEHOLDER_RE, " ")));
    found.forEach(({ label, placeholder }, k) => {
      const base = fallbackLabel || lastResort;
      let l = label && !GENERIC_LABEL_RE.test(label) ? label : base;
      if (k > 0 && !label) l = `${base} (${k + 1})`;
      const followUp = Boolean(label && fallbackLabel && FOLLOW_UP_RE.test(label));
      if (followUp) l = `${fallbackLabel} – ${label}`;
      const override = attendanceOverride(label);
      if (override && fallbackLabel) l = `${fallbackLabel} – ${label}`;
      const target = b.inContentControl ? "content_control" : "replace_placeholder";
      const long = followUp || (continued && found.length === 1);
      push(l, { anchorTarget: target, anchorRef: b.id, placeholderText: placeholder, ...(long && { answerType: "long_text" as const }), ...override }, guidance);
    });
    return found.length;
  };

  for (let i = 0; i < blocks.length; i += 1) {
    const b = blocks[i];
    if (isCellParagraph(b)) continue;

    if (b.kind === "paragraph" && isHeading(b)) {
      const text = b.text.replace(/\s+/g, " ").trim();
      if ((b.headingLevel ?? 1) <= 1 || /^(?:section|part)\b/i.test(text)) {
        section = text;
        pending = null;
      } else {
        pending = { label: cleanLabel(text), anchorId: b.id, guidance: "", answered: false };
      }
      lastText = cleanLabel(text);
      continue;
    }

    if (b.kind === "cell") {
      const row = rowKey(b.id);
      const cells: OutlineBlock[] = [];
      while (i < blocks.length && ((blocks[i].kind === "cell" && rowKey(blocks[i].id) === row) || isCellParagraph(blocks[i]))) {
        if (blocks[i].kind === "cell") cells.push(blocks[i]);
        i += 1;
      }
      i -= 1;
      pending = null;
      // A single short full-width cell is a sub-heading ("FOR OFFICE USE ONLY", "2  DIAGNOSIS").
      if (cells.length === 1 && !cells[0].isEmpty && !isDocxAnswerSpace(cells[0]) && !cellParas.has(cells[0].id) && cells[0].text.trim().length <= 80) {
        section = cells[0].text.replace(/\s+/g, " ").trim();
        continue;
      }
      for (let c = 0; c < cells.length; c += 1) {
        const cell = cells[c];
        const paras = cellParas.get(cell.id) ?? [];
        const left = cells[c - 1];
        const leftParas = left ? cellParas.get(left.id) ?? [] : [];
        const leftLabel = left && !left.isEmpty && !(left.checkboxGlyphs ?? 0) && !left.hasPlaceholder ? cleanLabel((leftParas[0]?.text ?? left.text).split("\n")[0]) : "";
        const leftGuidance = leftParas.length > 1 ? leftParas.slice(1).map((p) => p.text.trim()).filter(Boolean).join(" ") : "";

        if (paras.length > 0) {
          // A question-and-answer box: question first, then tick boxes, fill-ins or blank lines.
          let question = leftLabel;
          let guidance = leftGuidance;
          let answeredHere = false;
          for (const p of paras) {
            if ((p.checkboxGlyphs ?? 0) > 0) {
              const before = cleanLabel(p.text.split(/[☐☒☑]/)[0] ?? "");
              const f = glyphField(p, before.length > 2 ? before : question || lastText, section);
              if (f) out.push(f);
              answeredHere = true;
            } else if (p.hasPlaceholder || p.inContentControl) {
              placeholderFields(p, question, guidance, lastText);
              answeredHere = true;
            } else if (!p.isEmpty) {
              if (!question) question = cleanLabel(p.text);
              else if (!answeredHere) guidance = `${guidance} ${p.text.trim()}`.trim();
            }
          }
          if (!answeredHere && question && paras.some((p) => p.isEmpty)) {
            const blanks = paras.filter((p) => p.isEmpty).length;
            push(question, { anchorTarget: "table_cell", anchorRef: cell.id, ...(blanks >= 2 && { answerType: "long_text" as const }) }, guidance);
          }
          else if (!answeredHere && question && cell.isEmpty) push(question, { anchorTarget: "table_cell", anchorRef: cell.id }, guidance);
          continue;
        }

        if ((cell.checkboxGlyphs ?? 0) > 0) {
          const before = cleanLabel(cell.text.split(/[☐☒☑]/)[0] ?? "");
          const label = before.length > 2 ? before : leftLabel || lastText;
          const f = label ? glyphField(cell, label, section) : null;
          if (f) out.push(f);
          continue;
        }
        if (cell.hasPlaceholder || (cell.inContentControl && cell.placeholderText)) {
          placeholderFields(cell, leftLabel, leftGuidance, lastText);
          continue;
        }
        if (cell.isEmpty || cell.inContentControl || cell.legacyFieldName) {
          let label = leftLabel;
          if (!label) {
            // Label above, answer below.
            const m = /^(.*)\.r(\d+)\.c(\d+)$/.exec(cell.id);
            const above = m && Number(m[2]) > 0 ? byId.get(`${m[1]}.r${Number(m[2]) - 1}.c${m[3]}`) : undefined;
            if (above && !above.isEmpty && !(above.checkboxGlyphs ?? 0) && !above.hasPlaceholder) label = cleanLabel(above.text.split("\n")[0]);
          }
          if (!label || /^(?:your )?answer$/i.test(label)) continue;
          const target = cell.legacyFieldName ? "legacy_form_field" : cell.inContentControl ? "content_control" : "table_cell";
          push(label, { anchorTarget: target, anchorRef: cell.id }, leftGuidance);
        }
      }
      const lastFilled = cells.filter((c) => !c.isEmpty).pop();
      if (lastFilled) lastText = cleanLabel(lastFilled.text.split("\n")[0]);
      continue;
    }

    // Body paragraphs.
    const text = b.text.trim();
    if ((b.checkboxGlyphs ?? 0) > 0) {
      const before = cleanLabel(b.text.split(/[☐☒☑]/)[0] ?? "");
      const label = before.length > 2 ? before : pending?.label || lastText;
      const f = label ? glyphField(b, label, section) : null;
      if (f) {
        if (pending?.guidance) f.guidance = pending.guidance.slice(0, 300);
        out.push(f);
      }
      if (pending) pending.answered = true;
      continue;
    }
    if (b.hasPlaceholder || b.inContentControl || b.legacyFieldName) {
      const labelText = cleanLabel(text.replace(PLACEHOLDER_RE, " "));
      if (!labelText && pending?.answered) continue; // dotted continuation line of the answer above
      if (b.legacyFieldName && !b.hasPlaceholder) {
        push(pending?.label || lastText, { anchorTarget: "legacy_form_field", anchorRef: b.id }, pending?.guidance);
      } else {
        placeholderFields(b, pending && !pending.answered ? pending.label : "", pending?.guidance, lastText);
      }
      if (pending) pending.answered = true;
      else pending = { label: labelText || lastText, anchorId: b.id, guidance: "", answered: true };
      continue;
    }
    if (b.isEmpty) {
      if (pending && !pending.answered) {
        push(pending.label, { anchorTarget: "after_paragraph", anchorRef: pending.anchorId, answerType: answerTypeFromLabel(pending.label) ?? "long_text" }, pending.guidance);
        pending.answered = true;
      }
      continue;
    }
    // Text: a new question, or guidance for the current one.
    if (isQuestionLike(text) && text.length <= 220) {
      pending = { label: cleanLabel(text), anchorId: b.id, guidance: "", answered: false };
    } else if (pending && !pending.answered) {
      pending.guidance = `${pending.guidance} ${text}`.trim();
      pending.anchorId = b.id;
    }
    lastText = cleanLabel(text);
  }
  return out;
}

function prettifyName(name: string): string {
  const last = name.split(".").pop() ?? name;
  return last
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

function pdfFieldRules(pdf: PdfFormOutline): AnalysisFieldOutput[] {
  return sortedPdfFields(pdf).map((f) => {
    const options = f.options ?? [];
    const isOption = (t: string) => options.some((o) => o.trim().toLowerCase() === t.trim().toLowerCase());
    const segments = f.nearbyText
      .split(/\n| \| /)
      .map((t) => cleanLabel(t))
      .filter((t) => t.length > 1);
    const near = segments.find((t) => !isOption(t)) ?? "";
    const label = (near.length > 2 ? near : prettifyName(f.name)).slice(0, 160);
    const answerType: AnswerType | undefined =
      f.type === "checkbox"
        ? "checkbox"
        : f.type === "radio" || f.type === "dropdown"
          ? options.length === 2 && /^y/i.test(options[0]) && /^n/i.test(options[1])
            ? "yes_no"
            : "single_choice"
          : f.rect.height > 40
            ? "long_text"
            : undefined;
    return raw(label, "", { ...(answerType && { answerType }), options, anchorTarget: "pdf_field", anchorRef: f.name }, segments.join(" "));
  });
}

function pdfFlatRules(pdf: PdfFormOutline): AnalysisFieldOutput[] {
  return pdfFlatLabelCandidates(pdf).map((c) => {
    const x = Math.min(c.endX + 4, 480);
    return raw(cleanLabel(c.text), "", {
      anchorTarget: "pdf_overlay",
      overlay: { page: c.page, x, y: Math.max(0, c.y - 3), width: Math.max(80, 560 - x), height: 14 },
    });
  });
}

/** Raw proposals for the post-validation (then capped at low confidence). */
export function proposeFieldsByRules(parsed: ParsedForm): AnalysisFieldOutput[] {
  if (parsed.kind === "docx") return docxRules(parsed.blocks);
  return parsed.kind === "pdf_acroform" ? pdfFieldRules(parsed.pdf) : pdfFlatRules(parsed.pdf);
}

/** A title for the form from its first heading or first line (rules mode). */
export function guessTitle(parsed: ParsedForm, fileName: string): string {
  if (parsed.kind === "docx") {
    const first = parsed.blocks.find((b) => !b.isEmpty && (b.headingLevel !== undefined || (b.style && /title|heading/i.test(b.style))));
    const any = first ?? parsed.blocks.find((b) => !b.isEmpty && b.kind === "paragraph");
    if (any) return any.text.replace(/\s+/g, " ").trim().slice(0, 120);
  } else {
    const items = (parsed.pdf.pageText.find((p) => p.page === 1)?.items ?? []).filter((i) => i.str.trim());
    const top = items.slice().sort((a, b) => b.y - a.y)[0];
    if (top) return top.str.replace(/\s+/g, " ").trim().slice(0, 120);
  }
  return fileName.replace(/\.(docx|pdf)$/i, "").replace(/[_-]+/g, " ").trim() || "Referrer form";
}
