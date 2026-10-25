/**
 * The form author's instructions for whoever completes the form ("Delete unused cells", "Delete as necessary"), found
 * in a Word form rendered by docx-preview and struck through, so staff checking the mapping see what every completed
 * form leaves off (forms/docx-fill.ts removes them; the rule is core/template-instructions.ts). DOM-only (no React).
 *
 * Owner: studio-a agent.
 */
import { findTemplateInstructions, instructionColour, mayHoldInstruction, type TemplateInstruction } from "../../../core/template-instructions";

export const INSTRUCTION_CLASS = "mr-instruction";

/** The colour docx-preview gave a text node (its nearest inline colour); "" for the default. */
function colourOf(node: Text, p: Element): string {
  for (let el = node.parentElement; el && el !== p; el = el.parentElement) {
    const colour = el.style?.color;
    if (colour) return instructionColour(colour);
  }
  return "";
}

function textNodes(p: Element): Text[] {
  const out: Text[] = [];
  const walker = p.ownerDocument.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}

/** A paragraph of a table cell with a line of printed text above it in the cell (as forms/docx-fill.ts reads it). */
function belowLabelInCell(p: Element): boolean {
  if (!p.parentElement || !["TD", "TH"].includes(p.parentElement.tagName)) return false;
  let lines = 0;
  for (let q = p.previousElementSibling; q && lines < 10; q = q.previousElementSibling) {
    if (q.tagName !== "P") continue;
    if ((q.textContent ?? "").trim()) return true;
    lines += 1;
  }
  return false;
}

/**
 * Wraps [start, end) of the paragraph's text in struck-through spans, splitting text nodes where needed. `starts` are
 * the nodes' offsets before any split: ranges are struck from the end backwards, and a split node keeps its start.
 */
function strikeThrough(nodes: Text[], starts: number[], start: number, end: number, title: string): void {
  nodes.forEach((node, i) => {
    const from = starts[i];
    const at = from + node.data.length;
    if (at <= start || from >= end) return;
    let part = node;
    if (start > from) part = part.splitText(start - from);
    if (end < at) part.splitText(end - Math.max(start, from));
    const span = part.ownerDocument.createElement("span");
    span.className = INSTRUCTION_CLASS;
    span.title = title;
    part.parentNode?.insertBefore(span, part);
    span.appendChild(part);
  });
}

/** Strikes through every template instruction in the rendered form; returns them in document order. */
export function markTemplateInstructions(root: HTMLElement, title: string): TemplateInstruction[] {
  const found: TemplateInstruction[] = [];
  for (const p of Array.from(root.querySelectorAll("section.docx p"))) {
    if (!mayHoldInstruction(p.textContent ?? "")) continue;
    const nodes = textNodes(p);
    let text = "";
    const colours: Array<{ at: number; colour: string }> = [];
    const starts: number[] = [];
    for (const node of nodes) {
      starts.push(text.length);
      if (node.data) {
        const colour = colourOf(node, p);
        if (colours[colours.length - 1]?.colour !== colour) colours.push({ at: text.length, colour });
      }
      text += node.data;
    }
    const here = findTemplateInstructions({ text, colours, belowLabelInCell: belowLabelInCell(p) });
    // From the end, so earlier offsets still hold; the spaces before an instruction are not struck through.
    for (const f of here.slice().reverse()) {
      const lead = text.slice(f.start, f.end).search(/\S/);
      strikeThrough(nodes, starts, f.start + Math.max(0, lead), f.end, title);
    }
    found.push(...here);
  }
  return found;
}
