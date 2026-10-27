/**
 * bh2 fix round 1 – R1T-WA2-02 (the engine part of review RG-1; plan AC-ISSUE-6): the FINAL copy of a report approved
 * BEFORE this release is the document production issued, not this release's fill of it.
 *
 * forms/pre-release/ holds production's forms engine (c883ce5) frozen; forms/render-form.ts renderPreReleaseFinal()
 * issues a pre-release receipt with it. This test pins its output, scenario by scenario, to the document production's
 * own code makes from the same input (GOLDEN: content hashes – a Word file's zip entries without the docProps
 * timestamps, a PDF's bytes – or production's refusal). The inputs are fictional only: the bundled sample forms
 * (Harrow & Pike, Kingsway, Meridian with its Word content controls, Northfield AcroForm PDF, Ashcroft flat PDF) and the
 * safety corpus's synthetic forms (printed defaults, pre-printed marks, instructions, a "To return to …" opener, a
 * postcode label column, merge codes), each answered, left blank and half answered.
 *
 * Re-derive GOLDEN against production itself (a checkout of c883ce5 with its node_modules, e.g. the main checkout):
 *   CLINFORMS_PRE_RELEASE_TREE=~/Projects/Appstackx/clinforms npm run test:medreport -- …/pre-release-engine.test.ts
 * runs production's buildFormAnswers + renderFormFile on the same inputs, asserts they equal both GOLDEN and the frozen
 * engine, and prints the hashes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import PizZip from "pizzip";
import { issuedContentSha256 } from "../api/handlers/sign/receipt";
import { buildFormAnswers } from "../core/forms";
import { FormDefinitionSchema } from "../core/schemas";
import type { FormDefinition, FormField, Report, ReportSection, SignReceipt } from "../core/types";
import { buildForm } from "../core/validation/__corpus__/harness/build";
import { RECORDED_FORM_ANALYSIS_SOURCES } from "../ai/recorded/forms";
import { DOCX_MIME, PDF_MIME, sha256Hex, type DecodedFormFile } from "./file";
import { PRE_RELEASE_ENGINE, issuedByPreReleaseEngine, renderFormFile, renderPreReleaseFinal } from "./render-form";
import { getSampleForm } from "./samples/registry";

const RECEIPT: Pick<SignReceipt, "signer" | "signedAt"> = {
  signer: { name: "Sarah Reid", hcpc: "PH-DEMO-01", role: "Physiotherapist" },
  signedAt: "2026-10-27T10:00:00.000Z",
};

type Variant = "answered" | "blank" | "mixed" | "rg1";

interface Scenario {
  id: string;
  load(): Promise<{ form: FormDefinition; file: DecodedFormFile }>;
  variant: Variant;
}

function decoded(bytes: Uint8Array, mimeType: typeof DOCX_MIME | typeof PDF_MIME): DecodedFormFile {
  return { bytes, mimeType, sha256: sha256Hex(bytes), sizeBytes: bytes.byteLength };
}

async function sample(id: string): Promise<{ form: FormDefinition; file: DecodedFormFile }> {
  const entry = getSampleForm(id);
  if (!entry) throw new Error(`no sample ${id}`);
  const bytes = await entry.loadFile();
  const recorded = (RECORDED_FORM_ANALYSIS_SOURCES[id] as { form?: unknown } | undefined)?.form;
  const map = (await entry.loadForm?.()) ?? (await entry.loadPrewrittenAnalysis?.()) ?? (recorded ? FormDefinitionSchema.parse(recorded) : undefined);
  if (!map) throw new Error(`no map for ${id}`);
  return { form: map, file: decoded(bytes, entry.mimeType === PDF_MIME ? PDF_MIME : DOCX_MIME) };
}

async function corpus(id: string): Promise<{ form: FormDefinition; file: DecodedFormFile }> {
  const b = await buildForm(id, "demo");
  return { form: b.form, file: decoded(b.bytes, DOCX_MIME) };
}

const SOURCES: Record<string, () => Promise<{ form: FormDefinition; file: DecodedFormFile }>> = {
  "harrow-pike": () => sample("harrow-pike-treating-physio"),
  kingsway: () => sample("kingsway-rtw-assessment"),
  meridian: () => sample("meridian-discharge-report"),
  northfield: () => sample("northfield-rehab-progress"),
  ashcroft: () => sample("ashcroft-update-report"),
  "cf-discharge": () => corpus("cf-discharge"),
  "cf-initial": () => corpus("cf-initial"),
  "cf-merge": () => corpus("cf-merge"),
};

const SCENARIOS: Scenario[] = [
  ...["harrow-pike", "kingsway", "meridian", "cf-discharge", "cf-initial"].flatMap((s) => (["answered", "blank", "mixed"] as const).map((variant) => ({ id: `${s}:${variant}`, load: SOURCES[s], variant }))),
  ...["northfield", "ashcroft", "cf-merge"].flatMap((s) => (["answered", "blank"] as const).map((variant) => ({ id: `${s}:${variant}`, load: SOURCES[s], variant }))),
  // RG-1's own example: "Is any further treatment recommended?" No, and the approver's line in "If yes, please give
  // details" (a Word content control) – production prints the line.
  { id: "meridian:rg1", load: SOURCES.meridian, variant: "rg1" },
];

/** A fictional answer for one field, by its answer type (deterministic: the same input on every build). */
function sectionFor(field: FormField, index: number): ReportSection | null {
  const base = { key: field.id, title: field.label, paragraphs: [] as ReportSection["paragraphs"], status: "reviewed" } as unknown as ReportSection;
  const para = (text: string) => [{ id: `${field.id}-p1`, text, sourceIds: [], origin: "clinician" }] as unknown as ReportSection["paragraphs"];
  if (field.fillSource.kind === "signoff") return null;
  if (field.fillSource.kind === "registration" && field.fillSource.part && field.fillSource.part.index >= 3) return { ...base, blankFromRecords: true } as ReportSection;
  const options = field.options ?? [];
  switch (field.answerType) {
    case "yes_no":
      return { ...base, answer: { kind: "yes_no", value: index % 2 === 0 } } as ReportSection;
    case "checkbox":
      return { ...base, answer: { kind: "checkbox", value: true } } as ReportSection;
    case "single_choice":
      return options.length ? ({ ...base, answer: { kind: "choice", value: options[index % options.length] } } as ReportSection) : null;
    case "date":
      return { ...base, answer: { kind: "date", value: "2026-09-14" } } as ReportSection;
    case "number":
      return { ...base, answer: { kind: "number", value: "6" } } as ReportSection;
    case "table":
      return null;
    default:
      return { ...base, paragraphs: para(`Fictional answer for ${field.id}: seen weekly, improving.`) };
  }
}

function reportFor(form: FormDefinition, variant: Variant): Pick<Report, "sections"> {
  if (variant === "blank") return { sections: [] };
  const sections: ReportSection[] = [];
  form.fields.forEach((field, i) => {
    if (variant === "mixed" && i % 2 === 0) return;
    const s = sectionFor(field, i);
    if (s) sections.push(s);
  });
  if (variant === "rg1") {
    const at = (key: string) => sections.findIndex((s) => s.key === key);
    sections[at("F-12")] = { ...sections[at("F-12")], answer: { kind: "yes_no", value: false } };
    sections[at("F-13")] = { ...sections[at("F-13")], paragraphs: [{ id: "F-13-p1", text: "None needed now; she will contact her GP if the headaches return.", sourceIds: [], origin: "clinician" }] } as ReportSection;
  }
  return { sections };
}

function digest(form: FormDefinition, bytes: Uint8Array): string {
  return form.kind === "docx" ? `docx:${issuedContentSha256(bytes).slice(0, 32)}` : `pdf:${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}`;
}

async function outcome(form: FormDefinition, fn: () => Promise<{ bytes: Uint8Array }>): Promise<string> {
  try {
    return digest(form, (await fn()).bytes);
  } catch (err) {
    const e = err as { status?: number; init?: { code?: string } };
    if (typeof e.status !== "number") throw err;
    return `refused:${e.status} ${e.init?.code ?? ""}`.trim();
  }
}

/** What production c883ce5 issues for each scenario (derived with CLINFORMS_PRE_RELEASE_TREE, see the file comment). */
const GOLDEN: Record<string, string> = {
  "harrow-pike:answered": "docx:b8934bb229afe6360424cdac81a71340",
  "harrow-pike:blank": "docx:0ae196c80defb8d23e551bf759ff5182",
  "harrow-pike:mixed": "docx:dfd3cb5b6d62e6310b21303ee6400f12",
  "kingsway:answered": "docx:11b7aab447e1968f59b9895cb1b958b1",
  "kingsway:blank": "docx:7fea78b95abd656b51090f33cf2a8d99",
  "kingsway:mixed": "docx:60c85b2ebeae09a39feba914e400cc9f",
  "meridian:answered": "docx:ce1cda0630cc9e9b3a20a91a503cdaec",
  "meridian:blank": "docx:8fdd665a3f256feddcfef3f9a65b855d",
  "meridian:mixed": "docx:1506367b692fe6258a03d9920f3a3253",
  "cf-discharge:answered": "docx:e1426e2d293312f0f706082f61575b1c",
  "cf-discharge:blank": "docx:ba262cf003e51b50d77c3ac9ccb4ef8f",
  "cf-discharge:mixed": "docx:6075ef42491febfd0d79dae87b96b4dd",
  "cf-initial:answered": "docx:bd9106ed93f4519fafe3928c47d584f8",
  "cf-initial:blank": "docx:f056e413aed3f5a3d62c86317144b721",
  "cf-initial:mixed": "docx:47e99075db22103915258fd3ed71d8b2",
  "northfield:answered": "pdf:7e02949f747aac616aacbcbd09b73a78",
  "northfield:blank": "pdf:a7957a4881a1e162051fb98eadd1b636",
  "ashcroft:answered": "pdf:64b613aa626a9169331b2398248b34fc",
  "ashcroft:blank": "pdf:f3a2b7c1d1c09fc8234d7e764eaa3704",
  "cf-merge:answered": "docx:b05809fce4408741c9fe99babaf68a0a",
  "cf-merge:blank": "refused:422 FORM_INVALID",
  "meridian:rg1": "docx:9f0b9e6bfe209840bfcf2de87f18bf80",
};

/** Production's own buildFormAnswers + renderFormFile, from a checkout of c883ce5 (dev only). */
async function productionEngine(): Promise<null | {
  buildFormAnswers: (r: Pick<Report, "sections">, f: FormDefinition, o: { receipt: typeof RECEIPT }) => unknown;
  renderFormFile: (i: Record<string, unknown>) => Promise<{ bytes: Uint8Array }>;
}> {
  const tree = process.env.CLINFORMS_PRE_RELEASE_TREE;
  if (!tree) return null;
  const forms = (await import(path.join(tree, "src/modules/medreport/core/forms.ts"))) as { buildFormAnswers: never };
  const render = (await import(path.join(tree, "src/modules/medreport/forms/render-form.ts"))) as { renderFormFile: never };
  return { buildFormAnswers: forms.buildFormAnswers, renderFormFile: render.renderFormFile };
}

test(`a receipt from before the release is issued by production's frozen engine (${PRE_RELEASE_ENGINE}); a release receipt is not`, () => {
  assert.equal(issuedByPreReleaseEngine({}), true);
  assert.equal(issuedByPreReleaseEngine({ acknowledgementsSha256: "a".repeat(64) }), false, "the portal set / PDF form receipt binds the acknowledgements only");
  assert.equal(issuedByPreReleaseEngine({ issuedContentSha256: "b".repeat(64), acknowledgementsSha256: "a".repeat(64) }), false);
  assert.equal(issuedByPreReleaseEngine(null), false);
  assert.equal(issuedByPreReleaseEngine(undefined), false);
});

test("R1T-WA2-02: the FINAL copy of a pre-release receipt is the document production issues (22 fictional scenarios)", async () => {
  const production = await productionEngine();
  const derived: Record<string, string> = {};
  const problems: string[] = [];
  for (const s of SCENARIOS) {
    const { form, file } = await s.load();
    const report = reportFor(form, s.variant);
    const frozen = await outcome(form, () => renderPreReleaseFinal({ report, form, file, receipt: RECEIPT, format: "original" }));
    if (production) {
      const prod = await outcome(form, () => production.renderFormFile({ form, file, answers: production.buildFormAnswers(report, form, { receipt: RECEIPT }), draft: false, format: "original" }));
      derived[s.id] = prod;
      if (prod !== frozen) problems.push(`${s.id}: production ${prod}, frozen engine ${frozen}`);
      if (GOLDEN[s.id] !== prod) problems.push(`${s.id}: GOLDEN ${GOLDEN[s.id] ?? "(none)"} but production gives ${prod}`);
    } else if (GOLDEN[s.id] !== frozen) problems.push(`${s.id}: production issued ${GOLDEN[s.id] ?? "(not pinned)"}, the frozen engine gives ${frozen}`);
  }
  if (production) console.log(`GOLDEN (production ${PRE_RELEASE_ENGINE}):\n${JSON.stringify(derived, null, 2)}`);
  assert.deepEqual(problems, []);
});

test("R1T-WA2-02: the scenarios are not vacuous – this release's own fill issues a different document for some of them", async () => {
  // merge:r1 (WA1 x WA2): with R1T-WA1-01 merged, this release's answers for a report without reportModel no longer read
  // conditions at run time, so its fill now gives production's document on most scenarios (meridian:rg1 included – the
  // RG-1 fix). The guard therefore looks at every scenario: at least one must still differ (cf-discharge answered and
  // mixed do), so the frozen engine's pins are not vacuous.
  const differs: string[] = [];
  for (const s of SCENARIOS) {
    const { id } = s;
    const { form, file } = await s.load();
    const report = reportFor(form, s.variant);
    const release = await outcome(form, () => renderFormFile({ form, file, answers: buildFormAnswers(report, form, { receipt: RECEIPT }), draft: false, format: "original", strict: false }));
    if (release !== GOLDEN[id]) differs.push(id);
  }
  assert.ok(differs.length > 0, "the release fill issues production's document on every scenario – the pre-release path would not be tested");
});

/** A minimal Word file with this body (fictional). */
function rawDocx(body: string): Uint8Array {
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`);
  return zip.generate({ type: "uint8array" });
}

function hostileForm(bytes: Uint8Array, fields: FormField[]): FormDefinition {
  return {
    id: "frm_hostile",
    tenantId: "demo",
    referrer: { name: "Ashby Claims Review (fictional)", type: "mlc" },
    title: "Hostile (fictional)",
    file: { fileName: "hostile.docx", mimeType: DOCX_MIME, sha256: sha256Hex(bytes), sizeBytes: bytes.byteLength },
    kind: "docx",
    fields,
    status: "confirmed",
    analysis: { mode: "rules", promptVersion: "test", at: "2026-10-27T09:00:00.000Z", warnings: [] },
    createdAt: "2026-10-27T09:00:00.000Z",
    updatedAt: "2026-10-27T09:00:00.000Z",
  };
}

test("bounded work: production's unbounded fill never runs on a form this release refuses as too complex (R-security-2/3 shapes)", async () => {
  const text = (id: string, n: number): FormField => ({
    id,
    label: `Question ${n}`,
    guidance: "",
    answerType: "short_text",
    anchor: { kind: "docx", target: "replace_placeholder", blockId: "t0.r0.c0", placeholderText: `[answer ${n}]`, clearPlaceholder: true },
    fillSource: { kind: "notes_narrative" },
    required: false,
    confidence: "high",
  });
  const sections = (fields: FormField[]) => ({ sections: fields.map((f) => ({ key: f.id, title: f.label, status: "reviewed", paragraphs: [{ id: `${f.id}-p1`, text: "x", sourceIds: [], origin: "clinician" }] })) as unknown as ReportSection[] });
  // 150 questions in one cell of 200,000 lines (the release's request caps allow 20 per place; the release refuses the cell).
  const own = Array.from({ length: 150 }, (_, i) => `<w:p><w:r><w:t xml:space="preserve">Q${i}: [answer ${i}]</w:t></w:r></w:p>`).join("");
  const crowded = rawDocx(`<w:tbl><w:tr><w:tc>${own}${"<w:p/>".repeat(200_000)}</w:tc></w:tr></w:tbl>`);
  const many = Array.from({ length: 150 }, (_, i) => text(`F-${i + 1}`, i));
  const refusedCaps = await outcome(hostileForm(crowded, many), () => renderPreReleaseFinal({ report: sections(many), form: hostileForm(crowded, many), file: decoded(crowded, DOCX_MIME), receipt: RECEIPT, format: "original" }));
  assert.equal(refusedCaps, "refused:422 FORM_TOO_COMPLEX");
  // 20 questions (within the caps) in that cell: the release's bounded fill refuses the cell, so production's never runs.
  const few = many.slice(0, 20);
  const refusedCell = await outcome(hostileForm(crowded, few), () => renderPreReleaseFinal({ report: sections(few), form: hostileForm(crowded, few), file: decoded(crowded, DOCX_MIME), receipt: RECEIPT, format: "original" }));
  assert.equal(refusedCell, "refused:422 FORM_TOO_COMPLEX");
});
