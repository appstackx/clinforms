/**
 * Geometry helpers of readPdfForm (forms/pdf-widgets.ts): the label beside each tick box / radio button
 * (right of the box preferred, left accepted), runs of one-character boxes, and their label.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { charGroupNearbyText, detectCharGroups, widgetOptionLabel, widgetOptionLabels, type TextItem } from "./pdf-widgets";

const item = (str: string, x: number, y: number, w = str.length * 5, h = 9): TextItem => ({ str, x, y, w, h });

test("widgetOptionLabel: the nearest label on the line, right of the box preferred, left accepted", () => {
  // Bupa: "○ Miss ○ Mrs" – each button's label is to its right; the previous label is to its left.
  const items = [item("Miss", 135, 700), item("Mrs", 180, 700)];
  assert.equal(widgetOptionLabel({ x: 120, y: 698, width: 11, height: 11 }, items), "Miss");
  assert.equal(widgetOptionLabel({ x: 165, y: 698, width: 11, height: 11 }, items), "Mrs");
  // Freedom: "Yes ☐   No ☐" – labels left of the boxes.
  const yn = [item("Yes", 437, 322, 16), item("No", 507, 322, 12)];
  assert.equal(widgetOptionLabel({ x: 461.8, y: 314, width: 28, height: 25 }, yn), "Yes");
  assert.equal(widgetOptionLabel({ x: 537.8, y: 314, width: 28, height: 25 }, yn), "No");
  // Nothing close enough, or on another line.
  assert.equal(widgetOptionLabel({ x: 258, y: 398, width: 16, height: 16 }, [item("Telephone number", 56, 420)]), "");
  // AXA: one field, two widgets stacked – each takes the label on its own line.
  const stacked = [item("No", 339, 577), item("Yes", 339, 562)];
  assert.deepEqual(
    widgetOptionLabels(
      [
        { page: 1, rect: { x: 322.5, y: 575, width: 9, height: 9 } },
        { page: 1, rect: { x: 322.5, y: 560, width: 9, height: 9 } },
      ],
      new Map([[1, stacked]]),
    ),
    ["No", "Yes"],
  );
});

const cell = (name: string, x: number, y = 262, width = 15.7, height = 16.7) => ({ name, page: 1, rect: { x, y, width, height } });

test("detectCharGroups: 6–8 touching boxes of equal width ≤ 20 pt on one line; not 5, not 9, not with a gap", () => {
  const eight = Array.from({ length: 8 }, (_, i) => cell(`d${i}`, 214.2 + i * 16.3));
  assert.deepEqual(detectCharGroups(eight), [eight.map((c) => c.name)]);
  const six = Array.from({ length: 6 }, (_, i) => cell(`s${i}`, 100 + i * 16, 400));
  assert.deepEqual(detectCharGroups(six), [six.map((c) => c.name)]);
  assert.deepEqual(detectCharGroups(eight.slice(0, 5)), [], "five boxes are not a group");
  const nine = Array.from({ length: 9 }, (_, i) => cell(`n${i}`, 50 + i * 16, 500));
  assert.deepEqual(detectCharGroups(nine), [], "nine boxes are not a group");
  // DD | MM | YYYY with gaps between them: three short runs, no group.
  const gapped = [0, 1, 3, 4, 6, 7, 8, 9].map((k, i) => cell(`g${i}`, 300 + k * 16 + (k >= 3 ? 8 : 0) + (k >= 6 ? 8 : 0), 600));
  assert.deepEqual(detectCharGroups(gapped), []);
  // Wide boxes, or boxes of different widths.
  assert.deepEqual(detectCharGroups(Array.from({ length: 8 }, (_, i) => cell(`w${i}`, 50 + i * 25, 700, 25))), []);
  assert.deepEqual(
    detectCharGroups(Array.from({ length: 8 }, (_, i) => cell(`m${i}`, 50 + i * 16, 650, i === 4 ? 10 : 15.7))),
    [],
    "a narrower box breaks the run",
  );
  // Two groups on two pages, in any input order.
  const other = Array.from({ length: 8 }, (_, i) => ({ ...cell(`p${i}`, 214.2 + i * 16.3), page: 2 }));
  assert.equal(detectCharGroups([...other.reverse(), ...eight]).length, 2);
});

test("charGroupNearbyText: label left (drop cap rejoined, lines joined), text above, and the D/M/Y letters inside", () => {
  const union = { x: 214.2, y: 262, width: 130.2, height: 16.7 };
  const items: TextItem[] = [
    item("D", 56.7, 270, 8.7, 12),
    item("ate of diagnosis", 65.4, 270, 90, 12),
    item("(dd/mm/yyyy)", 56.7, 258, 60, 9),
    ...Array.from("DDMMYYYY").map((ch, i) => item(ch, 225.5 + i * 16.3, 263, 3, 5)),
    item("Key clinical findings", 214, 295, 120, 14),
  ];
  assert.equal(charGroupNearbyText(union, items), "Date of diagnosis (dd/mm/yyyy) | Key clinical findings | DDMMYYYY");
  // A label above only (AXA's date of birth).
  assert.equal(charGroupNearbyText({ x: 57.3, y: 409.7, width: 130, height: 16.7 }, [item("Patient’s date of birth", 56.7, 432.6, 100)]), "Patient’s date of birth");
});
