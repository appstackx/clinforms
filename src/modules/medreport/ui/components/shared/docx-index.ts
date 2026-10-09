/**
 * Index a Word document rendered by docx-preview by the forms engine's block IDs ("p12", "t2.r3.c1",
 * "t2.r3.c1.p0", nested "t2.r3.c1.t0.r0.c0"), in the same document order as forms/docx-dom.ts
 * indexBlocks: body paragraphs and tables (content controls unwrapped), then rows, cells, a cell's own
 * paragraphs and nested tables. Body paragraphs and cells get `data-mr-block` so a click can be mapped
 * back to a block ID. DOM-only (no React).
 *
 * Owner: studio-a agent.
 */
import { formatCellBlockId, type CellRef } from "../../../core/forms";

export interface DocxIndex {
  byId: Map<string, HTMLElement>;
}

function rowsOf(table: Element): Element[] {
  const rows: Element[] = [];
  for (const child of Array.from(table.children)) {
    if (child.tagName === "TR") rows.push(child);
    else if (child.tagName === "TBODY" || child.tagName === "THEAD" || child.tagName === "TFOOT") {
      for (const r of Array.from(child.children)) if (r.tagName === "TR") rows.push(r);
    }
  }
  return rows;
}

/** Index the rendered Word document by block ID, in the forms engine's document order. */
export function indexDocxDom(root: HTMLElement): DocxIndex {
  const byId = new Map<string, HTMLElement>();
  const walkTable = (table: Element, path: CellRef[], t: number) => {
    rowsOf(table).forEach((row, r) => {
      // docx-preview adds an empty <td> for gridBefore/gridAfter: not a w:tc, so skip it.
      const cells = Array.from(row.children).filter((c) => (c.tagName === "TD" || c.tagName === "TH") && c.childNodes.length > 0);
      cells.forEach((cell, c) => {
        const cellPath = [...path, { t, r, c }];
        const id = formatCellBlockId(cellPath);
        const el = cell as HTMLElement;
        byId.set(id, el);
        el.dataset.mrBlock = id;
        let pi = 0;
        let ti = 0;
        for (const child of Array.from(cell.children)) {
          if (child.tagName === "P") byId.set(formatCellBlockId(cellPath, pi++), child as HTMLElement);
          else if (child.tagName === "TABLE") walkTable(child, cellPath, ti++);
        }
      });
    });
  };
  let p = 0;
  let t = 0;
  for (const article of Array.from(root.querySelectorAll("section.docx > article"))) {
    for (const child of Array.from(article.children)) {
      if (child.tagName === "P") {
        const id = `p${p++}`;
        byId.set(id, child as HTMLElement);
        (child as HTMLElement).dataset.mrBlock = id;
      } else if (child.tagName === "TABLE") {
        walkTable(child, [], t++);
      }
    }
  }
  return { byId };
}

