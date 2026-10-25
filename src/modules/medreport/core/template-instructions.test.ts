/**
 * The form author's instructions for whoever completes the form (core/template-instructions.ts, 10/2026): what counts
 * as one – the patterns found in Blue Heart's templates, written here as FICTIONAL lines of our own – and what never does (the
 * referrer's own question wording), what leaves the line, and the notes for the clinician and for staff.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_INSTRUCTIONS_PER_FORM,
  MAX_INSTRUCTIONS_PER_LINE,
  findTemplateInstructions,
  instructionColour,
  instructionsLeftOffNote,
  instructionsMappingNote,
  mayHoldInstruction,
  type InstructionLine,
} from "./template-instructions";
import { hasBannedTerm } from "./wording";

/** A line printed all in red (the template's notes), or in the default colour. */
const red = (text: string): InstructionLine => ({ text, colours: [{ at: 0, colour: "ff0000" }] });
const plain = (text: string): InstructionLine => ({ text, colours: [{ at: 0, colour: "" }] });

/** The line once its instructions are left out. */
function without(line: InstructionLine): string {
  let text = line.text;
  for (const f of findTemplateInstructions(line).reverse()) text = text.slice(0, f.start) + text.slice(f.end);
  return text;
}

test("instructions: the delete-as-necessary family, wherever it stands apart from the referrer's wording", () => {
  assert.deepEqual(findTemplateInstructions(red("Delete unused cells")), [{ kind: "delete_unused", text: "Delete unused cells", start: 0, end: 19 }]);
  assert.equal(findTemplateInstructions(red("Delete unused rows"))[0].kind, "delete_unused");
  assert.equal(findTemplateInstructions(red("Delete as necessary"))[0].kind, "delete", "a note beside a list of options");
  assert.equal(findTemplateInstructions(plain("[Remove this text before sending the form]"))[0].kind, "delete_note", "a note about itself");
  assert.equal(without(red("    Delete those which are not required\t")), "\t", "the spaces before go, a tab stays");
  // After a label's colon, in brackets, after a dash or a tab – whatever its colour.
  assert.equal(without(plain("Area affected: Delete as necessary")), "Area affected:");
  assert.equal(without(plain("Duties:   (Please delete other choices)         Normal duties")), "Duties:         Normal duties");
  assert.equal(without(plain("Is treatment required? Yes/No (delete as appropriate)")), "Is treatment required? Yes/No");
  assert.equal(without(plain("[Remove this text before sending the form]")), "");
  assert.equal(without(plain("Treatment\tdelete whichever does not apply\tWeekly")), "Treatment\t\tWeekly");
  // Review 25/10: what introduces it goes with it (a dash, ";", a bullet), a label's colon and a sentence's full stop stay;
  // at the start of a line the spaces after it go too.
  assert.equal(without(plain("Yes / No – delete as applicable.")), "Yes / No");
  assert.equal(without(plain("Yes / No – delete as applicable. Then sign below.")), "Yes / No. Then sign below.");
  assert.equal(without(plain("Working; delete as appropriate")), "Working");
  assert.equal(without(plain("• Delete as necessary")), "");
  assert.equal(without(red("Delete if not applicable. Then sign below.")), "Then sign below.");
  assert.equal(without(plain("(Please delete other choices)   Normal duties")), "Normal duties");
  // In a colour of its own straight after the label ("Cause of injury " navy, "Delete as necessary" red).
  const onset = "Cause of injury Delete as necessary";
  assert.equal(without({ text: onset, colours: [{ at: 0, colour: "1f497d" }, { at: 16, colour: "ff0000" }] }), "Cause of injury");
  assert.equal(without({ text: onset, colours: [{ at: 0, colour: "ff0000" }] }), onset, "the same words in one colour: part of the label");
  // At the start of a line only when printed in a colour: a line in the default colour stays as before.
  assert.deepEqual(findTemplateInstructions(plain("Delete as necessary")), []);
  assert.deepEqual(findTemplateInstructions({ text: "Delete unused cells" }), []);
  assert.deepEqual(findTemplateInstructions({ text: "Delete as necessary Yes / No", colours: [{ at: 0, colour: "ff0000" }, { at: 19, colour: "" }] }).map((f) => f.text), ["Delete as necessary"]);
});

test("instructions: a box's prompt as the whole line – copy and paste, and 'give … in this box' below a label", () => {
  assert.deepEqual(findTemplateInstructions(plain("Copy and paste from the first report")), [{ kind: "paste", text: "Copy and paste from the first report", start: 0, end: 36 }]);
  assert.equal(findTemplateInstructions(plain("Copy and past the findings here and remove abbreviations"))[0]?.kind, "paste");
  assert.deepEqual(findTemplateInstructions(plain("Copy and paste is not allowed.")), [], "a statement, not a prompt");
  assert.deepEqual(findTemplateInstructions(plain("Notes: copy and paste from the first report")), [], "only as the whole line");
  const box = "Please give the findings in this box";
  assert.deepEqual(findTemplateInstructions({ ...red(box), belowLabelInCell: true }), [{ kind: "box", text: box, start: 0, end: box.length }]);
  assert.deepEqual(findTemplateInstructions(red(box)), [], "without a label above it, the line is the question itself");
  assert.deepEqual(findTemplateInstructions({ ...plain(box), belowLabelInCell: true }), [], "in the default colour it may be the referrer's own guidance");
  assert.deepEqual(findTemplateInstructions({ ...red("Please give details of the treatment in this box and the dates"), belowLabelInCell: true }), []);
});

test("instructions: the referrer's own question wording is never one", () => {
  const questions = [
    "Whiplash grade (please circle/tick)",
    "TREATMENTS PLANNED (tick all that apply)",
    "Please specify:",
    "Comments (if applicable)",
    "Other (please specify)",
    "If yes, please give details and whether still taken",
    "Is more treatment needed? If yes, please state the plan and the number of sessions:",
    "Please complete all three parts of this form from your clinical records and return it within 14 days of receipt.",
    "Please complete every section. Type or write clearly in the spaces provided.",
    "If you suggest another treatment, please outline it below",
    "Limited / Not possible",
    "Weekly/Fortnightly/Monthly",
    "Please do not delete any part of this form.",
    "If you delete as appropriate lines, keep the headings.",
    "Cause Delete as necessary",
    "Duties: (please delete)",
    "Has the claimant deleted unused cells?",
    "Remove all abbreviations from the summary",
    "Symptoms improved in the past two weeks",
  ];
  for (const text of questions) {
    assert.deepEqual(findTemplateInstructions({ ...red(text), belowLabelInCell: true }), [], `${text} (red)`);
    assert.deepEqual(findTemplateInstructions(plain(text)), [], text);
  }
  assert.equal(mayHoldInstruction("Range of Movement (%)"), false);
  assert.equal(mayHoldInstruction("Delete unused cells"), true);
});

test("instructions: the default colour is none, automatic or black – in Word and in the browser", () => {
  for (const c of [null, undefined, "", "auto", "000000", "#000000", "#000", "black", "rgb(0, 0, 0)", "windowtext"]) assert.equal(instructionColour(c), "", String(c));
  assert.equal(instructionColour("FF0000"), "ff0000");
  assert.equal(instructionColour("rgb(255, 0, 0)"), "rgb(255,0,0)");
  assert.equal(instructionColour("1F497D"), "1f497d");
});

test("instructions: the notes say what is left off, in plain words", () => {
  const four = Array.from({ length: 4 }, () => ({ kind: "delete_unused" as const, text: "Delete unused cells" }));
  assert.equal(
    instructionsLeftOffNote(four, 23),
    "Left off the completed form: the form's own instruction “Delete unused cells” (4 places), meant for whoever completes it. As it asks, 23 unused table rows are left off too.",
  );
  assert.equal(
    instructionsLeftOffNote([{ text: "Delete as necessary" }, { text: "delete as necessary" }, { text: "Please delete other choices" }, { text: "Delete those which are not required" }], 1),
    "Left off the completed form: the form's own instructions “Delete as necessary” (2 places), “Please delete other choices” and “Delete those which are not required”, meant for whoever completes it. As it asks, 1 unused table row is left off too.",
  );
  assert.equal(instructionsLeftOffNote([{ text: "Delete as necessary" }]), "Left off the completed form: the form's own instruction “Delete as necessary”, meant for whoever completes it.");
  assert.equal(
    instructionsMappingNote(four, true),
    "The form's own instruction “Delete unused cells” (4 places) is meant for whoever completes it, so it is struck through here and left off the completed form. As it asks, table rows a report leaves empty are left off too.",
  );
  // Review 25/10: rows are only promised where they can go (the instruction's row is blank once it is left out, or
  // prints like the row above) – not for one outside a table or sharing its row with other text.
  assert.equal(
    instructionsMappingNote(four, false),
    "The form's own instruction “Delete unused cells” (4 places) is meant for whoever completes it, so it is struck through here and left off the completed form.",
  );
  // A note beside options is only left off once the report has chosen from that list.
  const both = [{ kind: "delete" as const, text: "Delete as necessary" }, { kind: "box" as const, text: "Please give the findings in this box" }];
  assert.equal(
    instructionsMappingNote(both, true),
    "The form's own instructions “Delete as necessary” and “Please give the findings in this box” are meant for whoever completes it, so they are struck through here and left off the completed form. One beside a list of options is only left off once the report has chosen from that list.",
  );
  for (const note of [instructionsLeftOffNote(four, 2), instructionsMappingNote(four, true), instructionsMappingNote(both)]) assert.equal(hasBannedTerm(note), false, note);
});

test("instructions: the whole-line rules are linear on a line of millions of spaces, dots or tabs (security review 25/10)", () => {
  // Before: "Copy and paste from" + 18 million spaces + "x" took about 5 s (a lazy 120-character match, each step
  // re-reading the tail); the line is now read without its trailing spaces and dots by a plain loop.
  const n = 18_000_000;
  const started = Date.now();
  for (const filler of [" ", ".", "\t"]) {
    assert.deepEqual(findTemplateInstructions(plain(`Copy and paste from${filler.repeat(n)}x`)), [], JSON.stringify(filler));
    assert.deepEqual(findTemplateInstructions({ ...red(`Please give the details in this box${filler.repeat(n)}x`), belowLabelInCell: true }), []);
  }
  const prompt = `Copy and paste from the first report${" .".repeat(n / 2)}`;
  assert.deepEqual(findTemplateInstructions(plain(prompt)), [{ kind: "paste", text: "Copy and paste from the first report", start: 0, end: prompt.length }], "an answer space after it");
  assert.ok(Date.now() - started < 3000, `${Date.now() - started} ms`);
  assert.equal(MAX_INSTRUCTIONS_PER_FORM, 200);
});

test("instructions: linear on long lines and many colour changes; a line with more than 20 is left as printed", () => {
  const long = `${"delete as necessary: ".repeat(20_000)}x ${"Please give ".repeat(5_000)}in this box`;
  const colours = Array.from({ length: 40_000 }, (_, i) => ({ at: i * 10, colour: i % 2 ? "ff0000" : "" }));
  const started = Date.now();
  assert.deepEqual(findTemplateInstructions({ text: long, belowLabelInCell: true, colours }), []);
  assert.deepEqual(findTemplateInstructions(plain(`Copy and paste from ${"x".repeat(50_000)}`)), []);
  assert.ok(Date.now() - started < 2000, `${Date.now() - started} ms`);
  assert.equal(findTemplateInstructions(plain("Yes/No (delete as appropriate) ".repeat(MAX_INSTRUCTIONS_PER_LINE))).length, MAX_INSTRUCTIONS_PER_LINE);
  assert.deepEqual(findTemplateInstructions(plain("Yes/No (delete as appropriate) ".repeat(MAX_INSTRUCTIONS_PER_LINE + 1))), []);
});

test("instructions: a few spaces or a tab between an instruction's words, never any number (integration review 25/10)", () => {
  assert.deepEqual(findTemplateInstructions(red("Delete  unused\tcells")).map((f) => f.text), ["Delete unused cells"]);
  assert.deepEqual(findTemplateInstructions(red(`Delete${" ".repeat(10)}unused cells`)).map((f) => f.text), ["Delete unused cells"]);
  // One instruction spread over thousands of one-space runs would be removed run by run: not an instruction.
  assert.deepEqual(findTemplateInstructions(red(`Delete${" ".repeat(11)}unused cells`)), []);
  assert.deepEqual(findTemplateInstructions(red(`(Delete${" ".repeat(60_000)}unused cells)`)), []);
});
