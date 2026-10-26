/**
 * bh2 WA2 – the forms engine on Blue Heart's 17 referrer forms (plan WA2 tests and AC-ENG-1..4), LOCAL ONLY:
 * registered only when CLINFORMS_BH_CORPUS points at the gitignored demo-assets/blue-heart-templates/load folder (the
 * referrers' files and maps are third-party and never committed; without it no test is registered – the default chain
 * allows no extra skips). Prints only field IDs, kinds and counts – never a
 * form's wording.
 *
 * Each form is filled FINAL with four fictional answer sets (the 17 × 3 verification run's shapes, without drafting):
 * every question answered; required answered and optional left blank; optional boxes not applicable (WA1's state);
 * an unknown answer ("Not recorded") on every choice question. Expected:
 * - the request caps never refuse a map (400 questions, 20 sharing a place);
 * - answered, left blank and not applicable: the strict FINAL copy is made – no fatal outcome, no residue, no merge code;
 * - unknown answers on choice questions: every one is fatal and the FINAL copy is refused (Q-1) – never issued with the
 *   pre-printed marks;
 * - typography (AC-ENG-2): no answer bold, italic or underlined; no answer paragraph in a cell with a negative right
 *   indent; every answer on a converted RTF form has a font;
 * - every fill well under 3 s, and under 1% of the fill's step budget.
 *
 *   CLINFORMS_BH_CORPUS=<…>/demo-assets/blue-heart-templates/load node --import ./scripts/medreport/test-setup.mjs \
 *     --import tsx --test scripts/medreport/bh-fill-outcomes.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import PizZip from "pizzip";
import { DOMParser } from "@xmldom/xmldom";
import type { FormFillAnswer, FormFillAnswers } from "../../src/modules/medreport/core/forms";
import type { BoxState } from "../../src/modules/medreport/core/issue-types";
import type { FormDefinition, FormField } from "../../src/modules/medreport/core/types";
import { isChoiceAnchor, printedOptions } from "../../src/modules/medreport/forms/choice-marks";
import { MAX_FILL_STEPS, fillDocxReport } from "../../src/modules/medreport/forms/docx-fill";
import { decodeFormFile } from "../../src/modules/medreport/forms/file";
import { FillRefusedError, renderFormFile } from "../../src/modules/medreport/forms/render-form";
import { formRequestCapIssues } from "../../src/modules/medreport/forms/request-caps";

const ROOT = process.env.CLINFORMS_BH_CORPUS ?? "";
const enabled = ROOT !== "" && fs.existsSync(path.join(ROOT, "maps"));
/** Registered only with CLINFORMS_BH_CORPUS set: the default chain allows no extra skips. */
const localTest: typeof test = (enabled ? test : () => undefined) as typeof test;
if (!enabled) console.log("Blue Heart forms check: not run (set CLINFORMS_BH_CORPUS to demo-assets/blue-heart-templates/load)");
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const AT = "2026-10-26T09:00:00.000Z";

interface Loaded {
  tag: string;
  form: FormDefinition;
  file: ReturnType<typeof decodeFormFile>;
}

function loadForms(): Loaded[] {
  const out: Loaded[] = [];
  for (const mapFile of fs.readdirSync(path.join(ROOT, "maps")).filter((f) => f.endsWith(".maps.json")).sort()) {
    const dir = mapFile.replace(/\.maps\.json$/, "");
    const maps = JSON.parse(fs.readFileSync(path.join(ROOT, "maps", mapFile), "utf8")) as Record<string, { referrer: FormDefinition["referrer"]; fields: FormField[] }>;
    for (const [name, m] of Object.entries(maps)) {
      const file = decodeFormFile(fs.readFileSync(path.join(ROOT, dir, name)).toString("base64"), { convertRtf: true });
      const form: FormDefinition = {
        id: "frm_bh_local",
        tenantId: "local",
        referrer: m.referrer,
        title: "Local check",
        file: { fileName: name, mimeType: file.mimeType, sha256: file.sha256, sizeBytes: file.sizeBytes },
        kind: "docx",
        fields: m.fields,
        status: "confirmed",
        analysis: { mode: "rules", promptVersion: "local", at: AT, warnings: [] },
        createdAt: AT,
        updatedAt: AT,
      };
      out.push({ tag: `${dir}/${/IA/.test(name) ? "IA" : "EOTS"}`, form, file });
    }
  }
  return out;
}

const answerable = (form: FormDefinition) => form.fields.filter((f) => f.fillSource.kind !== "leave_blank");

/** A fictional answer the field can take: a printed option for a choice (the `pick`-th), else neutral text. */
function answerFor(f: FormField, pick: number): FormFillAnswer {
  if (f.fillSource.kind === "signoff") {
    const part = f.fillSource.part;
    if (part === "date") return { text: "26/10/2026", value: "2026-10-26" };
    return { text: part === "hcpc" ? "PH-DEMO-01" : part === "signature" ? "Sarah Reid – approved electronically on 26/10/2026" : "Sarah Reid" };
  }
  const options = printedOptions(f);
  if (isChoiceAnchor(f) && options.length) {
    const o = options[pick % options.length];
    if (f.answerType === "yes_no" || f.answerType === "checkbox") return /^\s*n/i.test(o) ? { text: "No", value: false } : { text: "Yes", value: true };
    if (f.answerType === "short_text" || f.answerType === "long_text") return { text: o };
    return { text: o, value: o };
  }
  if (f.answerType === "date") return { text: "01/10/2026", value: "2026-10-01" };
  if (f.answerType === "number") return { text: "5", value: "5" };
  if (f.answerType === "long_text") return { text: "A fictional finding noted on the first visit.\n\nA second fictional paragraph." };
  return { text: "Fictional" };
}

const fatalIds = (outcomes: Array<{ fieldId: string; fatal: boolean; outcome: string }> | undefined) => (outcomes ?? []).filter((o) => o.fatal).map((o) => `${o.fieldId}:${o.outcome}`);

localTest("Blue Heart's forms (local): the request caps never refuse a map", () => {
  const forms = loadForms();
  assert.equal(forms.length, 17);
  for (const { tag, form } of forms) assert.deepEqual(formRequestCapIssues(form).map((i) => i.path), [], tag);
});

localTest("Blue Heart's forms (local): answered, left blank or not applicable – the strict FINAL copy is made, no fatal outcome, no residue", async () => {
  for (const { tag, form, file } of loadForms()) {
    const fields = answerable(form);
    const sets: Array<{ name: string; answers: FormFillAnswers; states?: Record<string, BoxState> }> = [
      { name: "answered", answers: Object.fromEntries(fields.map((f) => [f.id, answerFor(f, 0)])) },
      { name: "optional left blank", answers: Object.fromEntries(fields.map((f) => [f.id, f.required || f.fillSource.kind === "signoff" ? answerFor(f, 1) : { leftBlank: true }])) },
      {
        name: "optional not applicable",
        answers: Object.fromEntries(fields.map((f) => [f.id, answerFor(f, 2)])),
        states: Object.fromEntries(fields.filter((f) => !f.required && f.fillSource.kind !== "signoff").map((f) => [f.id, { kind: "not_applicable", reason: "condition" } as BoxState])),
      },
    ];
    for (const set of sets) {
      const started = Date.now();
      const out = await renderFormFile({ form, file, answers: set.answers, draft: false, format: "original", ...(set.states ? { states: set.states } : {}) }).catch((err: unknown) => {
        if (err instanceof FillRefusedError) assert.fail(`${tag} ${set.name}: refused – ${fatalIds(err.outcomes).join(", ")}`);
        throw err;
      });
      assert.ok(Date.now() - started < 3000, `${tag} ${set.name}: ${Date.now() - started} ms`);
      const steps = fillDocxReport(file.bytes, form, set.answers, { draft: false, ...(set.states ? { states: set.states } : {}) }).work.steps;
      assert.ok(steps < MAX_FILL_STEPS / 20, `${tag} ${set.name}: ${steps} steps – a real form needs under 5% of the budget`);
      assert.deepEqual(fatalIds(out.outcomes), [], `${tag} ${set.name}`);
      assert.deepEqual((out.outcomes ?? []).filter((o) => o.residue?.length).map((o) => o.fieldId), [], `${tag} ${set.name}: residue`);
      assert.equal(out.outcomes?.length, fields.length, `${tag}: one outcome per answerable field`);
    }
  }
});

localTest("Blue Heart's forms (local): an unknown answer on a choice question is fatal – the FINAL copy is refused, never issued as printed (Q-1)", async () => {
  let sites = 0;
  for (const { tag, form, file } of loadForms()) {
    const fields = answerable(form);
    const choices = fields.filter((f) => isChoiceAnchor(f) && printedOptions(f).length > 0);
    if (choices.length === 0) continue;
    const answers: FormFillAnswers = Object.fromEntries(fields.map((f) => [f.id, choices.includes(f) ? { text: "Not recorded" } : answerFor(f, 0)]));
    const report = fillDocxReport(file.bytes, form, answers, { draft: false });
    const byId = new Map(report.outcomes.map((o) => [o.fieldId, o]));
    for (const f of choices) {
      sites += 1;
      assert.equal(byId.get(f.id)?.fatal, true, `${tag} ${f.id}`);
    }
    await assert.rejects(() => renderFormFile({ form, file, answers, draft: false, format: "original" }), (err: unknown) => err instanceof FillRefusedError, tag);
  }
  assert.ok(sites >= 66, `every unknown-answer site (66 at 4c8843e) is fatal: ${sites}`);
});

localTest("Blue Heart's forms (local): answers are never bold, italic or underlined, never in a cell paragraph with a negative right indent", () => {
  for (const { tag, form, file } of loadForms()) {
    const fields = answerable(form).filter((f) => f.fillSource.kind !== "signoff" && f.anchor.kind === "docx" && !isChoiceAnchor(f));
    const answers: FormFillAnswers = Object.fromEntries(fields.map((f) => [f.id, answerFor(f, 0)]));
    const out = fillDocxReport(file.bytes, form, answers, { draft: true, reviewMarkers: true });
    const doc = new DOMParser().parseFromString(new PizZip(out.bytes).file("word/document.xml")!.asText(), "text/xml");
    const runs = Array.from(doc.getElementsByTagNameNS(W, "r") as unknown as ArrayLike<Element>);
    let answersSeen = 0;
    const rtf = /\.rtf$/i.test(form.file.fileName);
    for (const run of runs) {
      const rPr = Array.from(run.childNodes as unknown as ArrayLike<Element>).find((c) => c.localName === "rPr");
      const kids = rPr ? Array.from(rPr.childNodes as unknown as ArrayLike<Element>).filter((k) => k.nodeType === 1) : [];
      const highlight = kids.find((k) => k.localName === "highlight");
      if (!highlight || highlight.getAttributeNS(W, "val") !== "yellow") continue;
      answersSeen += 1;
      const emphasis = kids.filter((k) => ["b", "i", "u"].includes(k.localName ?? "") && !["0", "false"].includes(k.getAttributeNS(W, "val") ?? ""));
      assert.deepEqual(emphasis.map((k) => k.localName), [], `${tag}: an answer is ${emphasis.map((k) => k.localName).join("/")}`);
      if (rtf) assert.ok(kids.some((k) => k.localName === "rFonts"), `${tag}: an answer on a converted RTF form has no font`);
      let p: Node | null = run.parentNode;
      while (p && (p as Element).localName !== "p") p = p.parentNode;
      let inCell = false;
      for (let a = p?.parentNode ?? null; a; a = a.parentNode) if ((a as Element).localName === "tc") inCell = true;
      const pPr = p ? Array.from((p as Element).childNodes as unknown as ArrayLike<Element>).find((x) => x.localName === "pPr") : undefined;
      const ind = pPr ? Array.from(pPr.childNodes as unknown as ArrayLike<Element>).find((x) => x.localName === "ind") : undefined;
      const right = ind ? Number(ind.getAttributeNS(W, "right") || ind.getAttributeNS(W, "end") || "0") : 0;
      assert.ok(!(inCell && right < 0), `${tag}: an answer paragraph in a cell has right indent ${right}`);
    }
    assert.ok(answersSeen > 0, tag);
  }
});
