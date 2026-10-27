/**
 * bh2 R1T-WD-01 (SEC-1, voted REAL / MUST_FIX): no text the public demo can post makes validation quadratic.
 *
 * On bh2-rc1 the shared splitter walked back to the line start for every sentence and the repeat check compared every
 * sentence of a later box with every earlier paragraph, re-splitting that paragraph for each pair: one 96 KB box took
 * 13 s on /validate and 160 KB took 71 s (production: 0.13 s / 0.16 s). These tests pin linear time on the shapes that
 * were quadratic, by CPU time (not wall time, so a busy machine does not fail them), with a wide margin: each input
 * below takes well under 0.2 s now and took from 2 s to minutes before.
 *
 * The per-request text budget on /validate, /sign and /render is R1T-WA1-03; the drafted-residue matching is R1T-WC-01.
 * Fictional data only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSafeEdit, removeSentences, splitSentences } from "../text/sentences";
import { computeFacts } from "../computed-facts";
import { formToTemplate } from "../forms";
import { createFormReport } from "../report-factory";
import type { FormDefinition, FormField, Paragraph, Report, ReportSection } from "../types";
import { validateReport } from "./index";
import { REPEAT_WORK_BUDGET, repeatedSentences, repeatsPart } from "./draft-fit/repeats";
import { TEST_FACTS_DATE, testBundle } from "./test-fixtures";

const AT = "2026-10-06T09:00:00.000Z";
const SARAH = { name: "Sarah Reid", hcpc: "PH-DEMO-01" };
let pid = 0;
const ai = (text: string, sourceIds = ["N-001"]): Paragraph => ({ id: `lin-p${++pid}`, text, sourceIds, origin: "ai", basis: "clinician_observed" });

/** CPU milliseconds `fn` takes (user + system), and its result. */
function cpu<T>(fn: () => T): { ms: number; value: T } {
  const start = process.cpuUsage();
  const value = fn();
  const d = process.cpuUsage(start);
  return { ms: (d.user + d.system) / 1000, value };
}

function box(id: string, label: string): FormField {
  return { id, label, guidance: "", answerType: "long_text", anchor: { kind: "docx", target: "after_paragraph", blockId: `p${id.slice(2)}` }, fillSource: { kind: "notes_narrative" }, required: false, confidence: "high" };
}
function form(fields: FormField[]): FormDefinition {
  return {
    id: "frm_wd_linear",
    tenantId: "demo",
    referrer: { name: "Example Case Services (fictional)", type: "mlc" },
    title: "Treatment Summary Report",
    file: { fileName: "wd.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sha256: "a".repeat(64), sizeBytes: 1 },
    kind: "docx",
    fields,
    status: "confirmed",
    analysis: { mode: "rules", promptVersion: "t", at: AT, warnings: [] },
    confirmed: { by: "Test", at: AT },
    createdAt: AT,
    updatedAt: AT,
  };
}
const FORM = form([box("F-31", "Mechanism of injury"), box("F-32", "Objective findings"), box("F-33", "Treatment provided")]);
function report(answers: Record<string, Paragraph[]>): Report {
  const bundle = testBundle();
  const base = createFormReport({ form: FORM, bundle, instructingParty: bundle.referral, computedFacts: computeFacts(bundle, { asOf: TEST_FACTS_DATE }), id: "rpt_wd_linear", now: new Date(AT), author: SARAH });
  return { ...base, sections: base.sections.map((s) => (answers[s.key] ? { ...s, paragraphs: answers[s.key] } : s)) };
}

const WORDS = ["lumbar", "cervical", "thoracic", "shoulder", "hip", "knee", "ankle", "wrist", "elbow", "posture", "stiffness", "swelling", "walking", "lifting", "sitting", "standing", "bending", "reaching", "driving", "sleeping"];
/** The SEC-1 probe's sentence: six made-up content words, all different from sentence to sentence. */
function probeSentence(i: number, salt: string): string {
  const w = (k: number) => WORDS[(i * 7 + k * 3 + salt.length) % WORDS.length] + String.fromCharCode(97 + ((i >> (k % 4)) % 26)) + String.fromCharCode(97 + ((i * (k + 1)) % 26));
  return `The ${w(0)} ${w(1)} ${w(2)} ${w(3)} ${w(4)} ${w(5)} was recorded${salt}.`;
}
/** One line of probe sentences, about `kb` kilobytes long. */
function oneLine(kb: number, salt = ""): string {
  const parts: string[] = [];
  let length = 0;
  for (let i = 0; length < kb * 1024; i++) {
    const s = probeSentence(i, salt);
    parts.push(s);
    length += s.length + 1;
  }
  return parts.join(" ");
}

test("R1T-WD-01: splitSentences takes linear time on one long line, for every shape that was quadratic", () => {
  const repeat = (unit: string, kb: number) => unit.repeat(Math.ceil((kb * 1024) / unit.length));
  const shapes: Record<string, string> = {
    sentences: oneLine(160),
    "list marker after a colon": repeat("Plan: 1. rest ", 160),
    "lettered markers": repeat("a. Bb ", 160),
    "inline bullets": repeat("knee pain • back pain ", 160),
    "unmatched openers and closers": `${"(".repeat(40000)} ${"]".repeat(40000)} ${'"a" '.repeat(20000)}`,
    "nested brackets": `${"(".repeat(60000)}x${")".repeat(60000)}. He rested.`,
    "quotes inside an open bracket": `${"(".repeat(30000)}${' "x" '.repeat(30000)}`,
    "number abbreviations": repeat("no. of ", 160),
  };
  for (const [name, text] of Object.entries(shapes)) {
    for (const policy of ["prose", "notes"] as const) {
      const { ms } = cpu(() => splitSentences(text, policy));
      assert.ok(ms < 1000, `${name} (${policy}, ${Math.round(text.length / 1024)} KB): ${Math.round(ms)} ms of CPU`);
    }
  }
  // The long line is still split exactly as before: one span per sentence, offsets into the text.
  const text = shapes.sentences;
  const spans = splitSentences(text);
  assert.equal(spans.length, text.split(". ").length);
  assert.ok(spans.every((s) => text.slice(s.start, s.end) === s.text));
});

test("R1T-WD-01: checkSafeEdit takes linear time (a long run of pronoun-led sentences, half of them removed)", () => {
  const before = ["Tom Ellis assessed the right knee on 08/09/2026.", ...Array.from({ length: 20000 }, (_, i) => `He recorded swelling grade ${i % 3} with ice advised.`)].join(" ");
  const { after, removedSpans } = removeSentences(before, (s) => s.index > 0 && s.index % 2 === 0);
  const { ms, value } = cpu(() => checkSafeEdit({ before, after, removedSpans }));
  assert.ok(ms < 1000, `${Math.round(before.length / 1024)} KB: ${Math.round(ms)} ms of CPU`);
  assert.deepEqual(value, [], "whole sentences removed, figures of the kept ones kept, every pronoun keeps its naming sentence");
});

test("R1T-WD-01: repeatedSentences is bounded – two 96 KB boxes (the SEC-1 body) in well under 1 s, and the budget, not the input, sets the work", () => {
  const r = report({ "F-31": [ai(oneLine(96))], "F-32": [ai(oneLine(96, " again"))] });
  const stats = { spent: 0, truncated: false };
  const { ms, value } = cpu(() => repeatedSentences(r, FORM, { stats }));
  assert.ok(ms < 1000, `${Math.round(ms)} ms of CPU`);
  assert.equal(stats.truncated, true, "an input this size runs out of budget");
  assert.ok(stats.spent <= REPEAT_WORK_BUDGET);
  assert.ok(Array.isArray(value));
  // The validator around it: advisory only, nothing blocks because of the size.
  const flags = cpu(() => repeatsPart({ report: r, bundle: r.bundleSnapshot, template: formToTemplate(FORM), computedFacts: [], form: FORM }).finish!());
  assert.ok(flags.ms < 1000, `repeatsPart: ${Math.round(flags.ms)} ms of CPU`);
  assert.ok(flags.value.every((f) => f.severity !== "blocking"));
});

test("R1T-WD-01: a report of real size is compared in full – the repeat in its 60th sentence is found, far inside the budget", () => {
  const earlier = Array.from({ length: 60 }, (_, i) => `Session ${i + 1} covered ${WORDS[i % 20]} mobility drills with ${WORDS[(i + 7) % 20]} control and ${WORDS[(i + 13) % 20]} work.`);
  earlier[59] = "Mr Testcase reported that he had been off work since 13/03/2026 with a fit note.";
  const later = [...Array.from({ length: 40 }, (_, i) => `Range of ${WORDS[(i * 3) % 20]} motion was reviewed with ${WORDS[(i * 3 + 1) % 20]} loading at visit ${i + 1}.`), "On 18/03/2026 Sarah Reid, physiotherapist, recorded that Mr Testcase had been off work since 13/03/2026 with a fit note."];
  const r = report({ "F-31": [ai(earlier.join(" "))], "F-32": [ai(later.join(" "))] });
  const stats = { spent: 0, truncated: false };
  const found = repeatedSentences(r, FORM, { stats });
  assert.equal(stats.truncated, false);
  assert.ok(stats.spent < REPEAT_WORK_BUDGET / 10, `spent ${stats.spent}`);
  assert.deepEqual(
    found.map((x) => [x.key, x.sentence.text, x.of.key, x.of.sentence]),
    [["F-32", later[40], "F-31", earlier[59]]],
  );
  // The same result whatever the budget, once it is enough for the report.
  assert.deepEqual(repeatedSentences(r, FORM, { budget: stats.spent }), found);
});

test("R1T-WD-01: numbered-row names and labels with many digit runs stay linear; identical names still block", () => {
  const sections: ReportSection[] = [];
  for (let i = 1; i <= 3000; i++) sections.push({ key: `R-${i}`, title: `Activity ${i}`, paragraphs: [ai(i === 3000 ? "Walking" : `${WORDS[i % 20]} drill ${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + ((i >> 5) % 26))}`)] } as ReportSection);
  sections.push({ key: "R-0", title: `${"Row 1a".repeat(20000)} 7`, paragraphs: [ai("Walking")] } as ReportSection);
  const r = { ...report({}), sections };
  const { ms, value } = cpu(() => repeatsPart({ report: r, bundle: r.bundleSnapshot, template: formToTemplate(FORM), computedFacts: [] }).finish!());
  assert.ok(ms < 1000, `${Math.round(ms)} ms of CPU`);
  const walking = value.filter((f) => f.sectionKey === "R-3000" && f.severity === "blocking");
  assert.equal(walking.length, 0, "“Walking” in Activity 3000 is not the name of an earlier activity row");
  const twice = { ...r, sections: [...sections.slice(0, 2), { ...sections[1], key: "R-x", title: "Activity 9", paragraphs: [ai(sections[1].paragraphs[0].text)] } as ReportSection] };
  const flags = repeatsPart({ report: twice, bundle: twice.bundleSnapshot, template: formToTemplate(FORM), computedFacts: [] }).finish!();
  assert.ok(flags.some((f) => f.sectionKey === "R-x" && f.severity === "blocking" && f.ackPolicy === "member"), "an identical name in a later numbered row blocks (it may be kept with a reason)");
});

test("R1T-WD-01 (SEC-1): a long one-line drafted paragraph validates in under 1 s, and the work grows linearly with it", () => {
  const run = (kb: number) => {
    const r = report({ "F-31": [ai(oneLine(kb))] });
    return cpu(() => validateReport(r, formToTemplate(FORM), { form: FORM, voice: { owner: SARAH } })).ms;
  };
  run(4); // warm the modules and regular expressions
  const small = run(16);
  const large = run(64);
  assert.ok(large < 1000, `64 KB on one line: ${Math.round(large)} ms of CPU`);
  // Quadratic work grows 16 times for 4 times the text; linear about 4 times. Allow noise, never 16.
  assert.ok(large < Math.max(small, 10) * 9, `16 KB ${Math.round(small)} ms, 64 KB ${Math.round(large)} ms of CPU`);
});
