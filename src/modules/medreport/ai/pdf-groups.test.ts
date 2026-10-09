/**
 * Fillable-PDF answer spaces made of several fields (ai/pdf-groups.ts): separate tick boxes read as one
 * choice (Yes/No pairs on a line, columns of options, options taken from the box to the left), checklists
 * left alone, and how a run of one-character boxes is written.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PdfOutlineField } from "../core/types";
import { charGroupFormat, charGroupLabel, detectOptionGroups, isYesNoOptions, printedOptions, yesFirst } from "./pdf-groups";

function box(name: string, x: number, y: number, label?: string, size = 9, nearbyText = label ?? ""): PdfOutlineField {
  return { name, type: "checkbox", page: 1, rect: { x, y, width: size, height: size }, nearbyText, ...(label !== undefined && { optionLabels: [label] }) };
}

test("detectOptionGroups: a Yes box and a No box on one line are one yes/no question", () => {
  const groups = detectOptionGroups({
    fields: [box("Check Box5", 461.8, 314, "Yes", 25, "Yes | No | Do you have any other insurance?"), box("Check Box6", 537.8, 314, "No", 25, "No | Yes | Do you have any other insurance?")],
  });
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].fields.map((f) => f.name), ["Check Box5", "Check Box6"]);
  assert.deepEqual(groups[0].options, ["Yes", "No"]);
  assert.equal(groups[0].yesNo, true);
  assert.equal(groups[0].label, "Do you have any other insurance?");
});

test("detectOptionGroups: a column of boxes printed with options is one choice; a checklist of questions is not", () => {
  const fields = [
    box("Check Box 4", 56.5, 500, "Physiotherapist", 9, "Physiotherapist | Therapist type"),
    box("Check Box 5", 56.5, 485, "Chiropractor"),
    box("Check Box 6", 56.5, 470, "Osteopath"),
    box("Check Box 2", 400, 500, "answered all questions?"),
    box("Check Box 3", 400, 482, "signed and dated the form?"),
    box("Lonely", 56.5, 300, "Discharged"),
  ];
  const groups = detectOptionGroups({ fields });
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].options, ["Physiotherapist", "Chiropractor", "Osteopath"]);
  assert.equal(groups[0].label, "Therapist type");
  assert.equal(groups[0].yesNo, false);
});

test("detectOptionGroups: boxes beside other boxes take their option from the field to the left", () => {
  const text = (name: string, y: number, label: string): PdfOutlineField => ({ name, type: "text", page: 1, rect: { x: 56.7, y, width: 191.6, height: 16 }, nearbyText: label });
  const groups = detectOptionGroups({
    fields: [
      text("Text Field 15", 398, "Telephone number | Please tick your preferred method of contact"),
      box("Check Box 10", 258, 398, undefined, 16, "Please tick your preferred method of contact"),
      text("Text Field 17", 361, "Fax number"),
      box("Check Box 11", 258, 361, undefined, 16, ""),
      text("Text Field 18", 324, "Email"),
      box("Check Box 12", 258, 324, undefined, 16, ""),
    ],
  });
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].options, ["Telephone number", "Fax number", "Email"]);
  assert.equal(groups[0].label, "Please tick your preferred method of contact");
});

test("detectOptionGroups: boxes without a printed option, repeated options or far apart are not grouped", () => {
  assert.deepEqual(detectOptionGroups({ fields: [box("a", 50, 500), box("b", 50, 485)] }), [], "no labels");
  assert.deepEqual(detectOptionGroups({ fields: [box("a", 50, 500, "Yes"), box("b", 50, 485, "Yes")] }), [], "same option twice");
  assert.deepEqual(detectOptionGroups({ fields: [box("a", 50, 500, "Neck"), box("b", 50, 300, "Back")] }), [], "too far apart");
  assert.deepEqual(detectOptionGroups({ fields: [box("a", 30, 500, "Neck"), box("b", 400, 500, "Back")] }), [], "too far apart on the line");
});

test("one-character boxes: a date in 8 / 6 boxes, else one character per box; the label without the hints", () => {
  assert.equal(charGroupFormat(8, "When will the patient be referred back? | DDMMYYYY"), "DDMMYYYY", "printed D D M M Y Y Y Y");
  assert.equal(charGroupFormat(6, "Date of injury"), "DDMMYY", "the label asks for a date");
  assert.equal(charGroupFormat(8, "Policy number"), "chars");
  assert.equal(charGroupFormat(8, "Policy number", "date"), "DDMMYYYY", "a date question");
  assert.equal(charGroupFormat(7, "Date of birth"), "chars", "7 boxes are not a known date layout");
  assert.equal(charGroupLabel("Date of diagnosis (dd/mm/yyyy) | Key clinical findings | DDMMYYYY"), "Date of diagnosis");
  assert.equal(charGroupLabel("DDMMYYYY"), "");
});

test("options: yes/no detection, Yes first, printed labels in reading order", () => {
  assert.equal(isYesNoOptions(["No", "Yes"]), true);
  assert.equal(isYesNoOptions(["Yes", "None"]), false);
  assert.equal(isYesNoOptions(["Yes", "No", "N/A"]), false);
  assert.deepEqual(yesFirst(["No", "Yes"], (o) => o), ["Yes", "No"]);
  const radio: PdfOutlineField = {
    name: "Radio Button 1",
    type: "radio",
    page: 1,
    rect: { x: 120, y: 698, width: 221, height: 11 },
    options: ["Choice1", "Choice2", "Choice3"],
    optionLabels: ["Other", "Dr", ""],
    nearbyText: "Title",
  };
  const pageText = [{ page: 1, items: [{ str: "Mr", x: 140, y: 700 }, { str: "Dr", x: 200, y: 700 }, { str: "Other", x: 260, y: 700 }, { str: "Choice3", x: 999, y: 0 }] }];
  assert.deepEqual(printedOptions({ pageText }, radio), ["Other", "Dr", "Choice3"], "a label not found on the page keeps the given order");
  assert.deepEqual(printedOptions({ pageText }, { ...radio, optionLabels: ["Other", "Dr", "Mr"] }), ["Mr", "Dr", "Other"]);
});
