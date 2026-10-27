/**
 * Security fix 24/10/2026 (input lens): the rules reading's choice layouts stay fast on large or hostile outlines, and a
 * form with more than MAX_READ_BLOCKS paragraphs and cells is refused before it is read. Fictional data only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { OutlineBlock } from "../core/types";
import { MAX_READ_BLOCKS, assertReadableOutline } from "../forms/docx-outline";
import { detectChoiceLayouts } from "./form-choice-rules";

const cell = (id: string, text: string, extra: Partial<OutlineBlock> = {}): OutlineBlock => ({ id, kind: "cell", text, isEmpty: text.trim() === "", hasPlaceholder: false, ...extra });
const para = (id: string, text: string): OutlineBlock => ({ id, kind: "paragraph", text, isEmpty: text.trim() === "", hasPlaceholder: false });

test("many cells with several lines each: the cell → lines index is built once (was one RegExp per cell over every block)", () => {
  const blocks: OutlineBlock[] = [];
  for (let i = 0; i < 20_000; i++) {
    const id = `t${i}.r0.c0`;
    blocks.push(cell(id, "Duties: (please delete)\nFull duties\nLight duties"), para(`${id}.p0`, "Duties: (please delete)"), para(`${id}.p1`, "Full duties"), para(`${id}.p2`, "Light duties"));
  }
  const t = Date.now();
  const out = detectChoiceLayouts(blocks);
  const ms = Date.now() - t;
  assert.ok(ms < 5000, `took ${ms} ms`);
  const first = out.byAt.get("t0.r0.c0")?.[0];
  assert.equal(first?.target, "delete_options", "the per-line list is still found");
  assert.deepEqual(first?.options, ["Full duties", "Light duties"]);
  assert.deepEqual(first?.optionAnchors.map((o) => o.ref), ["t0.r0.c0.p1", "t0.r0.c0.p2"]);
});

test("labels ending in a long run of colons are trimmed in linear time", () => {
  const blocks: OutlineBlock[] = [cell("t0.r0.c0", ""), cell("t0.r0.c1", "None"), cell("t0.r0.c2", "Mild"), cell("t0.r0.c3", "Severe")];
  const lead = `${":".repeat(1190)}x`;
  for (let r = 1; r <= 4000; r++) blocks.push(cell(`t0.r${r}.c0`, lead), cell(`t0.r${r}.c1`, ""), cell(`t0.r${r}.c2`, ""), cell(`t0.r${r}.c3`, ""));
  const t = Date.now();
  const out = detectChoiceLayouts(blocks);
  const ms = Date.now() - t;
  assert.ok(ms < 5000, `took ${ms} ms`);
  assert.equal(out.byAt.get("t0.r1")?.[0]?.target, "mark_cell");
  // Same labels as before for ordinary text.
  const small = detectChoiceLayouts([cell("t0.r0.c0", ""), cell("t0.r0.c1", "Yes"), cell("t0.r0.c2", "No"), cell("t0.r0.c3", "Notes"), cell("t0.r1.c0", "Swelling : :"), cell("t0.r1.c1", ""), cell("t0.r1.c2", ""), cell("t0.r1.c3", "")]);
  assert.equal(small.byAt.get("t0.r1")?.[0]?.label, "Swelling");
});

test("a form with more than MAX_READ_BLOCKS paragraphs and cells is refused before it is read (422 FORM_INVALID)", () => {
  const blocks = (n: number) => Array.from({ length: n }, (_, i) => para(`p${i}`, "Line"));
  assert.equal(MAX_READ_BLOCKS, 5000);
  assert.doesNotThrow(() => assertReadableOutline({ blocks: blocks(MAX_READ_BLOCKS) }));
  assert.throws(
    () => assertReadableOutline({ blocks: blocks(MAX_READ_BLOCKS + 1) }),
    (err: unknown) => (err as { status?: number }).status === 422 && (err as { init?: { code?: string; detail?: string } }).init?.code === "FORM_INVALID" && /too long to read automatically/.test((err as { init?: { detail?: string } }).init?.detail ?? ""),
  );
});
