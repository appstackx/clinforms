import "server-only";

/**
 * Choice layouts of Word forms the rules reading recognises (10/2026, product gaps P17 / P18 – clinic templates kept in a
 * practice system, e.g. TM3 report templates):
 *
 * - typed tick boxes in a table row, one option per cell ("Back at work now?" | "Yes [x]" | "No [ ]",
 *   "Daily [x]" | "Weekly [ ]" | …, a list continued on the next row): ONE question over those boxes;
 * - "mark the column" tables: a heading row prints the options (Yes | No, None | Mild | Severe,
 *   a scale) and every following row names an item with an EMPTY cell under each heading – one question per row,
 *   answered by marking the cell under the chosen heading (mark_cell); a row of a wide grid ("tick all that apply",
 *   more than five headings that are not a scale) is answered as text naming every heading that applies;
 * - a question row that prints its own options ("…? | Yes | No"): the chosen option's cell is marked;
 * - "delete as necessary" lists: an inline list ("Daily/Weekly/Monthly", "…medication? Yes/No", an answer cell
 *   that is only "Better / Same / Worse"), or one option per line under "Delete as necessary" / "please
 *   delete" – only the chosen option is kept (delete_options).
 *
 * Pure: a function of the outline blocks. Everything the rules reading proposes stays low confidence; post-validation
 * checks every anchor again (form-postvalidate.ts).
 */
import type { AnswerType, OutlineBlock } from "../core/types";
import { withBracketBoxesAsGlyphs } from "../forms/docx-dom";

export interface ChoiceProposal {
  /** Where it sits in document order (the block the question is emitted at). */
  at: string;
  label: string;
  answerType: AnswerType;
  options: string[];
  target: "checkbox_glyph" | "mark_cell" | "delete_options";
  anchorRef: string;
  placeholderText?: string;
  optionAnchors: Array<{ option: string; ref: string; glyphIndex: number }>;
  note?: string;
}

export interface ChoiceLayouts {
  /** Proposals by the block (row key, cell or paragraph ID) the rules reading emits them at. */
  byAt: Map<string, ChoiceProposal[]>;
  /** Blocks the proposals use: the per-cell rules skip them (no second question for the same answer space). */
  consumed: Set<string>;
  /** Heading rows of mark-the-column tables (no questions of their own). */
  headerRows: Set<string>;
}

interface CellInfo {
  block: OutlineBlock;
  table: string;
  r: number;
  c: number;
}

const tidy = (s: string) => s.replace(/\s+/g, " ").trim();
const plain = (s: string) => tidy(withBracketBoxesAsGlyphs(s).replace(/[☐☒☑]/g, " "));
/** `s` without trailing whitespace and colons – linear (security fix 24/10/2026: /[\s:]+$/ is quadratic on "::::…x"). */
function trimTrailing(s: string, colons: boolean): string {
  let end = s.length;
  while (end > 0 && ((colons && s.charCodeAt(end - 1) === 58) || /\s/.test(s.charAt(end - 1)))) end -= 1;
  return s.slice(0, end);
}
const label = (s: string) => trimTrailing(tidy(s).replace(/^[\s\d.)(•a-z]{0,3}[.)]\s+(?=[A-Z])/, ""), true).slice(0, 200);

/** A short printed option ("Yes", "Mild", "Up to 50%", "IIa", "0-3 months"). */
function isOptionText(t: string): boolean {
  const s = tidy(t);
  if (!s || s.length > 32) return false;
  if (/[?:]/.test(s) || /\.$/.test(s)) return false;
  return s.split(" ").length <= 4;
}

const YES_NO = (opts: string[]) => opts.length === 2 && /^y(?:es)?$/i.test(opts[0]) && /^no?$/i.test(opts[1]);
const SCALE = (opts: string[]) => opts.every((o) => /^\d+(?:\s*%|\/\d+)?$/.test(o.trim()));

function typeFor(opts: string[]): AnswerType {
  if (YES_NO(opts)) return "yes_no";
  return opts.length === 1 ? "checkbox" : "single_choice";
}

/** The direct cells of every table, row by row. */
function tableRows(blocks: OutlineBlock[]): Map<string, Map<number, CellInfo[]>> {
  const tables = new Map<string, Map<number, CellInfo[]>>();
  for (const b of blocks) {
    if (b.kind !== "cell") continue;
    const m = /^(.*)\.r(\d+)\.c(\d+)$/.exec(b.id);
    if (!m) continue;
    const rows = tables.get(m[1]) ?? new Map<number, CellInfo[]>();
    const row = rows.get(Number(m[2])) ?? [];
    row.push({ block: b, table: m[1], r: Number(m[2]), c: Number(m[3]) });
    rows.set(Number(m[2]), row);
    tables.set(m[1], rows);
  }
  return tables;
}

function add(out: ChoiceLayouts, p: ChoiceProposal, uses: string[]): void {
  out.byAt.set(p.at, [...(out.byAt.get(p.at) ?? []), p]);
  for (const u of uses) out.consumed.add(u);
}

/* Typed (or printed) tick boxes, one option per cell -------------------------------------------- */

function boxOption(cell: OutlineBlock): string | null {
  if ((cell.checkboxGlyphs ?? 0) !== 1) return null;
  const t = plain(cell.text);
  return isOptionText(t) ? t : null;
}

/** A typed tick box alone in its cell ("[x]"), with nothing else printed there. */
function typedBoxOnly(cell: OutlineBlock): boolean {
  return (cell.checkboxGlyphs ?? 0) === 1 && withBracketBoxesAsGlyphs(cell.text) !== cell.text && plain(cell.text) === "";
}

/** Several boxes with their options in one cell ("Yes [ ] No [x]"): the options as printed, or null. */
function boxOptionsInCell(cell: OutlineBlock): string[] | null {
  const n = cell.checkboxGlyphs ?? 0;
  if (n < 2 || withBracketBoxesAsGlyphs(cell.text) === cell.text) return null;
  const parts = withBracketBoxesAsGlyphs(cell.text).split(/[☐☒☑]/);
  const before = parts.slice(0, -1).map((p) => tidy(p));
  const opts = before.every((p) => isOptionText(p)) ? before : parts.slice(1).map((p) => tidy(p));
  return opts.length === n && opts.every((o) => isOptionText(o)) ? opts : null;
}

function boxRows(out: ChoiceLayouts, rows: Map<number, CellInfo[]>): void {
  let previous: { proposal: ChoiceProposal; r: number; cols: number[] } | null = null;
  const keys = Array.from(rows.keys()).sort((a, b) => a - b);
  const cellAt = (r: number, c: number) => (rows.get(r) ?? []).find((x) => x.c === c);
  // Options printed down a column, one typed box each ("[ ] 0", "[ ] I", "[ ] IIa"…): ONE question.
  const columns = new Set(keys.flatMap((r) => (rows.get(r) ?? []).map((c) => c.c)));
  columns.forEach((c) => {
    let run: CellInfo[] = [];
    const flush = () => {
      if (run.length >= 3) {
        const head = cellAt(run[0].r - 1, c);
        const l = head && !head.block.isEmpty ? label(plain(head.block.text).split("\n")[0]) : "";
        if (l) {
          const opts = run.map((x) => boxOption(x.block) as string);
          add(
            out,
            { at: run[0].block.id, label: l, answerType: typeFor(opts), options: opts, target: "checkbox_glyph", anchorRef: run[0].block.id, optionAnchors: run.map((x, i) => ({ option: opts[i], ref: x.block.id, glyphIndex: 0 })) },
            run.map((x) => x.block.id),
          );
        }
      }
      run = [];
    };
    for (const r of keys) {
      const cell = cellAt(r, c);
      const typed = cell && withBracketBoxesAsGlyphs(cell.block.text) !== cell.block.text;
      if (cell && typed && boxOption(cell.block) !== null && (rows.get(r) ?? []).filter((x) => (x.block.checkboxGlyphs ?? 0) > 0).length === 1) run.push(cell);
      else flush();
    }
    flush();
  });
  for (const r of Array.from(rows.keys()).sort((a, b) => a - b)) {
    const cells = (rows.get(r) ?? []).sort((a, b) => a.c - b.c);
    // Runs of adjacent cells that each hold one box and its option.
    const runs: CellInfo[][] = [];
    let run: CellInfo[] = [];
    for (const cell of cells) {
      if (boxOption(cell.block) !== null) run.push(cell);
      else {
        if (run.length) runs.push(run);
        run = [];
      }
    }
    if (run.length) runs.push(run);
    // "Any warning signs" | "Yes [ ] No [x]": one question for the boxes of that cell.
    for (const cell of cells) {
      if (out.consumed.has(cell.block.id)) continue;
      const opts = boxOptionsInCell(cell.block);
      const left = cells.filter((c) => c.c < cell.c && !c.block.isEmpty).pop();
      if (opts && left && !(left.block.checkboxGlyphs ?? 0)) {
        add(
          out,
          { at: cell.block.id, label: label(plain(left.block.text).split("\n")[0]), answerType: typeFor(opts), options: opts, target: "checkbox_glyph", anchorRef: cell.block.id, optionAnchors: opts.map((o, i) => ({ option: o, ref: cell.block.id, glyphIndex: i })) },
          [cell.block.id],
        );
      }
      // "Taping" | "[x]": a tick box for the item on its left.
      if (typedBoxOnly(cell.block) && left && !(left.block.checkboxGlyphs ?? 0) && left.c === cell.c - 1) {
        const item = label(plain(left.block.text).split("\n")[0]);
        if (item) add(out, { at: cell.block.id, label: item, answerType: "checkbox", options: [item], target: "checkbox_glyph", anchorRef: cell.block.id, optionAnchors: [{ option: item, ref: cell.block.id, glyphIndex: 0 }] }, [cell.block.id]);
      }
    }
    let continued = false;
    for (const group of runs) {
      if (group.some((g) => out.consumed.has(g.block.id))) continue;
      const first = group[0];
      const before = cells.filter((c) => c.c < first.c && !c.block.isEmpty && boxOption(c.block) === null).pop();
      const opts = group.map((g) => boxOption(g.block) as string);
      const anchors = group.map((g, i) => ({ option: opts[i], ref: g.block.id, glyphIndex: 0 }));
      const emptyLead = cells.filter((c) => c.c < first.c).every((c) => c.block.isEmpty);
      // A list continued on the next row (its first cells empty): more options of the question above.
      if (!before && emptyLead && previous && previous.r === r - 1 && !continued) {
        previous.proposal.options.push(...opts);
        previous.proposal.optionAnchors.push(...anchors);
        previous.proposal.answerType = typeFor(previous.proposal.options);
        group.forEach((g) => out.consumed.add(g.block.id));
        continued = true;
        continue;
      }
      if (!before) continue;
      if (group.length === 1 && /^(?:yes|no)$/i.test(opts[0]) === false && opts[0].length > 3) continue; // "Taping [x]": the per-cell rule labels it
      const p: ChoiceProposal = {
        at: first.block.id,
        label: label(plain(before.block.text).split("\n")[0]),
        answerType: typeFor(opts),
        options: opts,
        target: "checkbox_glyph",
        anchorRef: first.block.id,
        optionAnchors: anchors,
      };
      if (!p.label) continue;
      add(out, p, group.map((g) => g.block.id));
      previous = { proposal: p, r, cols: group.map((g) => g.c) };
    }
    if (runs.length === 0) previous = null;
  }
}

/* Mark-the-column tables ------------------------------------------------------------------------ */

function markTables(out: ChoiceLayouts, rows: Map<number, CellInfo[]>): void {
  const keys = Array.from(rows.keys()).sort((a, b) => a - b);
  for (let k = 0; k < keys.length; k++) {
    const header = (rows.get(keys[k]) ?? []).sort((a, b) => a.c - b.c);
    if (header.length < 3) continue;
    // The heading row: an empty (or labelled) first cell, then short options; trailing cells may be anything.
    const optionCols = header.filter((c) => c.c > 0 && !c.block.isEmpty && !(c.block.checkboxGlyphs ?? 0) && isOptionText(c.block.text));
    if (optionCols.length < 2) continue;
    const firstCol = optionCols[0].c;
    const contiguous = optionCols.every((c, i) => c.c === firstCol + i);
    if (!contiguous || firstCol !== 1) continue;
    const opts = optionCols.map((c) => tidy(c.block.text));
    // Item rows: same number of cells, a label first, every option column empty (or only a printed mark).
    const items: Array<{ r: number; label: string; cells: CellInfo[] }> = [];
    for (let j = k + 1; j < keys.length; j++) {
      const row = (rows.get(keys[j]) ?? []).sort((a, b) => a.c - b.c);
      if (row.length !== header.length) break;
      const lead = row[0];
      const under = optionCols.map((oc) => row.find((c) => c.c === oc.c));
      if (!lead || lead.block.isEmpty || under.some((c) => !c || !(c.block.isEmpty || /^[xX✓✔]$/.test(c.block.text.trim())))) break;
      const l = label(lead.block.text.split("\n")[0]);
      if (!l) break;
      items.push({ r: keys[j], label: l, cells: under as CellInfo[] });
    }
    if (items.length === 0) continue;
    const grid = opts.length > 5 && !SCALE(opts);
    out.headerRows.add(`${header[0].table}.r${keys[k]}`);
    for (const item of items) {
      const p: ChoiceProposal = {
        at: `${header[0].table}.r${item.r}`,
        label: item.label,
        answerType: grid ? "short_text" : typeFor(opts),
        options: opts.slice(),
        target: "mark_cell",
        anchorRef: item.cells[0].block.id,
        optionAnchors: item.cells.map((c, i) => ({ option: opts[i], ref: c.block.id, glyphIndex: 0 })),
        ...(grid && { note: "More than one column may apply: the answer names every one that does (or “None”)." }),
      };
      add(out, p, item.cells.map((c) => c.block.id));
    }
    k += items.length;
  }
}

/** "…? | Yes | No" – a question row that prints its own options and has nowhere else to answer. */
function questionWithOptions(out: ChoiceLayouts, rows: Map<number, CellInfo[]>): void {
  for (const r of Array.from(rows.keys()).sort((a, b) => a - b)) {
    const row = (rows.get(r) ?? []).sort((a, b) => a.c - b.c);
    if (row.length < 3 || row.some((c) => out.consumed.has(c.block.id))) continue;
    const [q, ...rest] = row;
    if (q.block.isEmpty || !/\?\s*$/.test(tidy(q.block.text))) continue;
    if (!rest.every((c) => !c.block.isEmpty && !(c.block.checkboxGlyphs ?? 0) && isOptionText(c.block.text))) continue;
    const opts = rest.map((c) => tidy(c.block.text));
    if (!YES_NO(opts)) continue;
    add(
      out,
      {
        at: `${q.table}.r${r}`,
        label: label(q.block.text),
        answerType: "yes_no",
        options: opts,
        target: "mark_cell",
        anchorRef: rest[0].block.id,
        optionAnchors: rest.map((c, i) => ({ option: opts[i], ref: c.block.id, glyphIndex: 0 })),
      },
      rest.map((c) => c.block.id),
    );
  }
}

/* "Delete as necessary" lists ------------------------------------------------------------------- */

const DELETE_RE = /\b(?:delete as (?:necessary|appropriate|applicable)|(?:please )?delete (?:the )?(?:other|unused|unwanted) (?:choices|options)|please delete|circle (?:as appropriate|one))\b/i;
const NOT_A_LIST = /\b(?:N\/A|DD\/MM|MM\/YY|and\/or|w\/c|c\/o|24\/7)\b/i;

/** "Daily/Weekly/Monthly", "Better / Same / Worse" → the options, or null. */
export function slashOptions(text: string): string[] | null {
  const t = tidy(text);
  if (!t.includes("/") || NOT_A_LIST.test(t)) return null;
  const parts = t.split(/\s*\/\s*/).map((p) => p.trim());
  if (parts.length < 2 || parts.length > 6) return null;
  if (!parts.every((p) => p && p.length <= 40 && /^[A-Za-z0-9%][A-Za-z0-9%' -]*\.?$/.test(p) && p.split(" ").length <= 5)) return null;
  // Abbreviations ("GP/NHS") are not options to keep or delete – Yes / No in capitals is.
  if (parts.some((p) => /^[A-Z]{2,3}$/.test(p) && !/^(?:YES|NO)$/.test(p))) return null;
  return parts.map((p) => p.replace(/\.$/, ""));
}

/** An inline list at the end of a question line ("…any medication? Yes/No", "…will they attend? Daily/Weekly"). */
function trailingList(text: string): { label: string; list: string; options: string[] } | null {
  const t = trimTrailing(text, false);
  const m = /^(.*[?:])\s+([A-Za-z0-9%][^?:]*?)$/.exec(t.split("\n")[0] ?? "");
  if (!m) return null;
  const options = slashOptions(m[2]);
  return options ? { label: label(m[1].replace(DELETE_RE, "")), list: m[2].trim(), options } : null;
}

/**
 * The question of an answer cell that holds only a list: the label on its left when it reads as a question ("Status:",
 * "…since treatment?", or the only other cell of the row); in a table of rows to fill (the cell on its
 * left is empty), the column heading above. A table's heading row ("Area | Notes/Comments") is no list.
 */
function listQuestion(cell: CellInfo, rows: Map<number, CellInfo[]>): string {
  const row = (rows.get(cell.r) ?? []).sort((a, b) => a.c - b.c);
  const left = row.filter((c) => c.c < cell.c).pop();
  if (!left) return "";
  if (!left.block.isEmpty) {
    const t = tidy(left.block.text.split("\n")[0] ?? "");
    return /[?:]$/.test(t) || row.length === 2 ? label(t) : "";
  }
  const above = (rows.get(cell.r - 1) ?? []).find((c) => c.c === cell.c);
  return above && !above.block.isEmpty && tidy(above.block.text).length <= 30 ? label(above.block.text.split("\n")[0]) : "";
}

function deleteLists(out: ChoiceLayouts, blocks: OutlineBlock[], tables: Map<string, Map<number, CellInfo[]>>): void {
  const byId = new Map(blocks.map((b) => [b.id, b] as const));
  const cellInfo = new Map<string, CellInfo>();
  tables.forEach((rows) => rows.forEach((row) => row.forEach((c) => cellInfo.set(c.block.id, c))));
  // A cell's own paragraphs ("<cell>.p<n>"), indexed once (security fix 24/10/2026: one RegExp and one pass over every
  // block per cell was O(cells × blocks)).
  const parasByCell = new Map<string, OutlineBlock[]>();
  for (const b of blocks) {
    if (b.kind !== "paragraph") continue;
    const cut = b.id.lastIndexOf(".p");
    if (cut <= 0 || !/^\d+$/.test(b.id.slice(cut + 2))) continue;
    const cell = b.id.slice(0, cut);
    const list = parasByCell.get(cell);
    if (list) list.push(b);
    else parasByCell.set(cell, [b]);
  }
  const parasOf = (cellId: string) => parasByCell.get(cellId) ?? [];

  for (const b of blocks) {
    if (out.consumed.has(b.id)) continue;
    if (b.kind === "cell") {
      const paras = parasOf(b.id);
      // One option per line under "Delete as necessary" / "(please delete)".
      if (paras.length >= 2 && DELETE_RE.test(paras[0].text)) {
        const m = DELETE_RE.exec(paras[0].text)!;
        const head = paras[0].text.slice(0, m.index).replace(/[\s(:–-]+$/, "");
        const tail = paras[0].text.slice(m.index + m[0].length).replace(/^[\s):–-]+/, "").trim();
        const lines = paras.slice(1).filter((p) => !p.isEmpty && isListLine(p.text));
        if (lines.length >= 1) {
          const optionAnchors = [
            ...(tail && isListLine(tail) ? [{ option: tidy(tail), ref: paras[0].id, glyphIndex: 0 }] : []),
            ...lines.map((p) => ({ option: tidy(p.text), ref: p.id, glyphIndex: 0 })),
          ];
          const opts = optionAnchors.map((o) => o.option);
          add(
            out,
            {
              at: b.id,
              label: label(head) || label(paras[0].text),
              answerType: typeFor(opts),
              options: opts,
              target: "delete_options",
              anchorRef: optionAnchors[0].ref,
              optionAnchors,
            },
            [b.id, ...optionAnchors.map((o) => o.ref)],
          );
          continue;
        }
      }
      // An answer cell that is only a list ("Better / Same / Worse", "Daily / Weekly", "Yes/No").
      const own = paras.length >= 2 ? paras.filter((p) => !p.isEmpty) : [b];
      if (own.length === 1 && !(b.checkboxGlyphs ?? 0)) {
        const options = slashOptions(own[0].text);
        const info = cellInfo.get(b.id);
        if (options && info) {
          const l = listQuestion(info, tables.get(info.table) ?? new Map());
          if (l) {
            add(out, { at: b.id, label: l, answerType: typeFor(options), options, target: "delete_options", anchorRef: own[0].id, placeholderText: own[0].text.trim(), optionAnchors: [] }, [b.id, own[0].id]);
            continue;
          }
        }
        // A one-line cell that is a question ending in its options ("How often…? Daily/Weekly/Monthly").
        const trail = paras.length === 0 ? trailingList(b.text) : null;
        if (trail && trail.label) {
          add(out, { at: b.id, label: trail.label, answerType: typeFor(trail.options), options: trail.options, target: "delete_options", anchorRef: b.id, placeholderText: trail.list, optionAnchors: [] }, [b.id]);
        }
      }
      continue;
    }
    // A question line ending in its options ("Any medication? Yes/No").
    const trail = trailingList(b.text);
    if (trail && trail.label) {
      add(out, { at: b.id, label: trail.label, answerType: typeFor(trail.options), options: trail.options, target: "delete_options", anchorRef: b.id, placeholderText: trail.list, optionAnchors: [] }, [b.id]);
      const cell = /^(.*\.c\d+)\.p\d+$/.exec(b.id)?.[1];
      if (cell && byId.has(cell) && parasOf(cell).filter((p) => !p.isEmpty).length === 1) out.consumed.add(cell);
    }
  }
}

function isListLine(text: string): boolean {
  const t = tidy(text);
  return t.length > 0 && t.length <= 90 && !/[?:]$/.test(t);
}

/** Every choice layout of a Word form's outline (see the file comment). */
export function detectChoiceLayouts(blocks: OutlineBlock[]): ChoiceLayouts {
  const out: ChoiceLayouts = { byAt: new Map(), consumed: new Set(), headerRows: new Set() };
  const tables = tableRows(blocks);
  tables.forEach((rows) => {
    boxRows(out, rows);
    markTables(out, rows);
    questionWithOptions(out, rows);
  });
  deleteLists(out, blocks, tables);
  return out;
}
