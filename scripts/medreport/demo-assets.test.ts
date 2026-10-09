/**
 * Local demonstration assets (ai/demo-assets.ts, MEDREPORT_DEMO_ASSETS_DIR) end to end, on a temporary
 * folder of synthetic files – CI never needs the real (gitignored) insurer forms:
 * - on only when the variable names an existing folder, and never on a production build or deployment
 *   unless MEDREPORT_DEMO_ASSETS_ALLOW_PROD=1;
 * - an upload of the form in demo mode gets its pre-written map with its own mode, the neutral
 *   "uploaded form" label and the demonstration footer, bound into the map's attestation;
 * - the bundle advertises the pre-written answers, POST /drafts replays them, edits show without a
 *   restart, and the filled preview carries the footer;
 * - GET /forms/samples lists the form as an upload-only entry (demo mode only, file never served);
 * - `npm run demo:check` and `stamp-demo-drafts.ts --dir=…` work on such a folder.
 */
import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { route } from "@/app/api/_medreport-glue";
import { analyseFormFile } from "@/modules/medreport/ai/analyse-form";
import { bundleNotesFingerprint } from "@/modules/medreport/ai/bundle-fingerprint";
import { demoAssetsState } from "@/modules/medreport/ai/demo-assets";
import { demoDraftAvailability, draftDemo } from "@/modules/medreport/ai/draft-demo";
import { getRecordedFormMap, listDemoAssetFormAnalyses, listRecordedFormAnalyses } from "@/modules/medreport/ai/recorded-forms";
import { handleDrafts } from "@/modules/medreport/api/handlers/drafts";
import { handleFormSampleFile } from "@/modules/medreport/api/handlers/forms-sample-file";
import { handleFormSamples } from "@/modules/medreport/api/handlers/forms-samples";
import { handleFormsAnalyse } from "@/modules/medreport/api/handlers/forms-analyse";
import { handleFormsFillPreview } from "@/modules/medreport/api/handlers/forms-fill-preview";
import { DraftsResponseSchema, FormSamplesResponseSchema, FormsAnalyseResponseSchema } from "@/modules/medreport/api/contract";
import { formMapSha256, verifyFormConfirmation, withAttestedConfirmation } from "@/modules/medreport/auth/attestations";
import { computeFacts } from "@/modules/medreport/core/computed-facts";
import { formAnchorKeys, formTemplateId, formToTemplate } from "@/modules/medreport/core/forms";
import { applyDraftResult, createFormReport } from "@/modules/medreport/core/report-factory";
import type { FormDefinition } from "@/modules/medreport/core/types";
import { WORDING, demoFormNotice, hasBannedTerm } from "@/modules/medreport/core/wording";
import { sha256Hex } from "@/modules/medreport/forms/file";
import { loadPdfjs, pdfjsDocumentParams } from "@/modules/medreport/forms/pdfjs";
import { checkDemoAssets } from "./demo-assets-check";
import { getDemoBundle } from "./dev-bundles";

const SAMPLE_ID = "ext-example-insurer-therapy";
const INSURER = "Example Health Insurance (fictional)";
const ENV_KEYS = [
  "MEDREPORT_DEMO_ASSETS_DIR",
  "MEDREPORT_DEMO_ASSETS_ALLOW_PROD",
  "VERCEL_ENV",
  "NODE_ENV",
  "MEDREPORT_AI_MODE",
  "ANTHROPIC_API_KEY",
  "MEDREPORT_LIVE_PASSCODE",
  "MEDREPORT_SIGNING_SECRET",
] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const env = process.env as Record<string, string | undefined>;

function restoreEnv(): void {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete env[k];
    else env[k] = savedEnv[k];
  }
}

const post = (p: string, body: unknown) => new Request(`http://127.0.0.1:9${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const get = (p: string) => new Request(`http://127.0.0.1:9${p}`);

/* A synthetic "insurer" form, its pre-written map and pre-written answers for Megan Hart ------- */

async function insurerPdf(title: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.drawText(title, { x: 40, y: 790, size: 14, font });
  page.drawText("Patient name", { x: 40, y: 740, size: 9, font });
  const pdfForm = doc.getForm();
  pdfForm.createTextField("txtPatient").addToPage(page, { x: 140, y: 734, width: 300, height: 18, font });
  page.drawText("Presenting symptoms at the initial assessment", { x: 40, y: 700, size: 9, font });
  const symptoms = pdfForm.createTextField("txtSymptoms");
  symptoms.enableMultiline();
  symptoms.addToPage(page, { x: 40, y: 560, width: 500, height: 130, font });
  return doc.save();
}

function mapOf(pdf: Uint8Array, fileName: string, demoNotice?: string): FormDefinition {
  return {
    id: "frm_ext_example_insurer",
    tenantId: "demo",
    referrer: { name: INSURER, type: "insurer" },
    title: "Therapy treatment update",
    file: { fileName, mimeType: "application/pdf", sha256: sha256Hex(pdf), sizeBytes: pdf.byteLength },
    kind: "pdf_acroform",
    fields: [
      {
        id: "F-01",
        label: "Patient name",
        guidance: "The patient's full name.",
        answerType: "short_text",
        anchor: { kind: "pdf_field", fieldName: "txtPatient", fieldType: "text" },
        fillSource: { kind: "registration", path: "patient.fullName" },
        required: true,
        confidence: "high",
      },
      {
        id: "F-02",
        label: "Presenting symptoms at the initial assessment",
        guidance: "What the patient reported at the first assessment.",
        answerType: "long_text",
        anchor: { kind: "pdf_field", fieldName: "txtSymptoms", fieldType: "text" },
        fillSource: { kind: "notes_narrative" },
        required: true,
        confidence: "high",
      },
    ],
    status: "proposed",
    analysis: { mode: "demo_prewritten", promptVersion: "prewritten-test", at: "2026-10-09T09:00:00.000Z", warnings: [] },
    createdAt: "2026-10-09T09:00:00.000Z",
    updatedAt: "2026-10-09T09:00:00.000Z",
    sampleId: SAMPLE_ID,
    ...(demoNotice !== undefined && { demoNotice }),
  };
}

const PARAGRAPH =
  "At the initial assessment on 18/03/2026, [CLAIMANT] reported that on 12/03/2026 she was the restrained driver of a stationary car queuing at traffic lights when it was struck from behind.";

function draftOf(form: FormDefinition, opts: { fingerprint?: string; text?: string } = {}) {
  const keys = formAnchorKeys(form);
  return {
    format: "appstackx-reports.demo-draft",
    formatVersion: 1,
    patientId: "sim-pat-001",
    ...(opts.fingerprint !== undefined && { bundleFingerprint: opts.fingerprint }),
    templateId: formTemplateId(form.id),
    templateVersion: "1",
    sampleId: SAMPLE_ID,
    formSha256: form.file.sha256,
    fields: { "F-02": { anchor: keys.get("F-02"), answerType: "long_text", label: "Presenting symptoms at the initial assessment" } },
    mode: "demo_prewritten",
    promptVersion: "prewritten-test",
    note: "Synthetic test answers.",
    groups: { "F-02": { sections: [{ sectionKey: "F-02", answer: "", paragraphs: [{ text: opts.text ?? PARAGRAPH, sourceIds: ["N-001", "REG"], basis: "patient_reported" }] }], gaps: [] } },
  };
}

interface Fixture {
  dir: string;
  pdf: Uint8Array;
  loosePdf: Uint8Array;
  form: FormDefinition;
  draftFile: string;
}

const roots: string[] = [];
after(() => {
  restoreEnv();
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});
beforeEach(() => restoreEnv());

async function fixture(opts: { demoNotice?: string; fingerprint?: "current" | "stale" | "none" } = {}): Promise<Fixture> {
  const dir = mkdtempSync(path.join(tmpdir(), "clinforms-demo-assets-"));
  roots.push(dir);
  mkdirSync(path.join(dir, "maps"));
  mkdirSync(path.join(dir, "drafts"));
  const pdf = await insurerPdf("Therapy treatment update");
  const loosePdf = await insurerPdf("Another insurer's claim form");
  writeFileSync(path.join(dir, "example-insurer-therapy.pdf"), pdf);
  writeFileSync(path.join(dir, "another-insurer-claim.pdf"), loosePdf);
  const form = mapOf(pdf, "example-insurer-therapy.pdf", opts.demoNotice);
  writeFileSync(
    path.join(dir, "maps", `${SAMPLE_ID}.json`),
    JSON.stringify({
      format: "appstackx-reports.form-analysis",
      formatVersion: 1,
      sampleId: SAMPLE_ID,
      fileSha256: form.file.sha256,
      fileName: form.file.fileName,
      mode: "demo_prewritten",
      recordedAt: "2026-10-09T09:00:00.000Z",
      promptVersion: "prewritten-test",
      form,
      outlineSummary: { kind: "pdf_acroform", pages: 1, fillableFields: 2, answerSpaces: 2, headings: [], warnings: [] },
    }),
  );
  const current = bundleNotesFingerprint(getDemoBundle("sim-pat-001"));
  const fp = opts.fingerprint ?? "current";
  const fingerprint = fp === "current" ? current : fp === "stale" ? "0".repeat(64) : undefined;
  const draftFile = path.join(dir, "drafts", `sim-pat-001__form-${SAMPLE_ID}.json`);
  writeFileSync(draftFile, JSON.stringify(draftOf(form, { fingerprint }), null, 2));
  return { dir, pdf, loosePdf, form, draftFile };
}

function useAssets(dir: string): void {
  env.MEDREPORT_DEMO_ASSETS_DIR = dir;
  env.MEDREPORT_AI_MODE = "demo";
}

async function upload(bytes: Uint8Array, fileName: string) {
  const res = await route(handleFormsAnalyse)(post("/api/reports/v1/forms/analyse", { fileBase64: Buffer.from(bytes).toString("base64"), fileName, prefer: "demo" }), { params: {} });
  assert.equal(res.status, 200);
  return FormsAnalyseResponseSchema.parse(await res.json());
}

/* Tests ------------------------------------------------------------------------------------------ */

test("the demo assets are on only for an existing folder, and never in production unless explicitly allowed", async () => {
  const fx = await fixture();
  delete env.MEDREPORT_DEMO_ASSETS_DIR;
  assert.deepEqual(demoAssetsState(), { on: false, reason: "unset" });
  assert.deepEqual(listDemoAssetFormAnalyses(), []);

  env.MEDREPORT_DEMO_ASSETS_DIR = path.join(fx.dir, "does-not-exist");
  assert.deepEqual(demoAssetsState(), { on: false, reason: "missing" });

  env.MEDREPORT_DEMO_ASSETS_DIR = path.relative(process.cwd(), fx.dir); // relative to the working directory
  assert.deepEqual(demoAssetsState(), { on: true, dir: fx.dir });
  assert.equal(listDemoAssetFormAnalyses().length, 1);

  for (const [name, value] of [["VERCEL_ENV", "production"], ["NODE_ENV", "production"]] as const) {
    env[name] = value;
    assert.deepEqual(demoAssetsState(), { on: false, reason: "production" }, name);
    assert.deepEqual(listDemoAssetFormAnalyses(), [], `${name}: no map is served`);
    assert.ok(!demoDraftAvailability(getDemoBundle("sim-pat-001")).formSha256s.includes(fx.form.file.sha256), `${name}: no answers are advertised`);
    env.MEDREPORT_DEMO_ASSETS_ALLOW_PROD = "true";
    assert.equal(demoAssetsState().on, false, "only exactly 1 lifts it");
    env.MEDREPORT_DEMO_ASSETS_ALLOW_PROD = "1";
    assert.equal(demoAssetsState().on, true, `${name} + MEDREPORT_DEMO_ASSETS_ALLOW_PROD=1 (a local production run)`);
    delete env.MEDREPORT_DEMO_ASSETS_ALLOW_PROD;
    delete env[name];
  }
});

test("demo upload: the pre-written map keeps its mode, is labelled as an uploaded form's map and carries the demonstration footer", async () => {
  const fx = await fixture();
  useAssets(fx.dir);
  const body = await upload(fx.pdf, "therapy-update.pdf");
  const form = body.form;
  assert.equal(form.analysis.mode, "demo_prewritten");
  assert.equal(form.status, "proposed");
  assert.equal(form.sampleId, SAMPLE_ID);
  assert.equal(form.fields.length, 2);
  assert.equal(form.file.fileName, "therapy-update.pdf");
  assert.equal(form.demoNotice, demoFormNotice(INSURER), "a map without its own notice gets the standard one");
  assert.equal(form.demoNotice, "Public form used for demonstration only – not affiliated with or endorsed by Example Health Insurance (fictional). Fictional patient data.");
  const step = (body.trace ?? []).find((t) => t.label === "Proposed the form map");
  assert.equal(step?.detail, WORDING.server.analysis.uploadedPrewrittenDetail);
  assert.notEqual(WORDING.server.analysis.uploadedPrewrittenDetail, WORDING.server.analysis.prewrittenDetail);
  const shown = [...form.analysis.warnings, ...(body.trace ?? []).flatMap((t) => [t.label, t.detail ?? ""]), form.demoNotice ?? ""];
  assert.deepEqual(shown.filter(hasBannedTerm), []);

  // A map's own notice is kept as written.
  const custom = await fixture({ demoNotice: "Custom demonstration notice." });
  useAssets(custom.dir);
  assert.equal((await upload(custom.pdf, "x.pdf")).form.demoNotice, "Custom demonstration notice.");

  // The footer is part of what the confirmation attests: dropping it after confirmation is refused.
  const confirmed = withAttestedConfirmation(form, "Practice manager", "2026-10-09T10:00:00.000Z");
  assert.equal(verifyFormConfirmation(confirmed).ok, true);
  const { demoNotice: _dropped, ...stripped } = confirmed;
  void _dropped;
  assert.deepEqual(verifyFormConfirmation(stripped), { ok: false, reason: "MAP_CHANGED" });
  // …while a map without a notice hashes exactly as before the field existed.
  assert.equal(formMapSha256({ ...stripped, demoNotice: undefined }), formMapSha256(stripped));

  // Off: the same upload is mapped by layout rules, unlabelled.
  delete env.MEDREPORT_DEMO_ASSETS_DIR;
  const plain = await upload(fx.pdf, "therapy-update.pdf");
  assert.equal(plain.form.analysis.mode, "rules");
  assert.equal(plain.form.demoNotice, undefined);
});

test("a demonstration form read by rules (or live) is labelled too, also without a map", async () => {
  const fx = await fixture();
  useAssets(fx.dir);
  const decoded = (bytes: Uint8Array) => ({ bytes, mimeType: "application/pdf" as const, sha256: sha256Hex(bytes), sizeBytes: bytes.byteLength });
  const rules = await analyseFormFile({ file: decoded(fx.pdf), fileName: "t.pdf", mode: "demo", rulesOnly: true });
  assert.equal(rules.form.analysis.mode, "rules");
  assert.equal(rules.form.demoNotice, demoFormNotice(INSURER), "the map's notice");
  const loose = await analyseFormFile({ file: decoded(fx.loosePdf), fileName: "claim.pdf", mode: "demo", referrer: { name: "Another Insurer", type: "insurer" } });
  assert.equal(loose.form.analysis.mode, "rules");
  assert.equal(loose.form.demoNotice, demoFormNotice("Another Insurer"));
  const unnamed = await analyseFormFile({ file: decoded(fx.loosePdf), fileName: "claim.pdf", mode: "demo" });
  assert.equal(unnamed.form.demoNotice, demoFormNotice());
  const other = await analyseFormFile({ file: decoded(await insurerPdf("Not a demo asset")), fileName: "o.pdf", mode: "demo" });
  assert.equal(other.form.demoNotice, undefined, "an ordinary upload is never labelled");
});

test("a local map never replaces a bundled one, and a bundled sample's map never comes from the assets", async () => {
  const fx = await fixture();
  useAssets(fx.dir);
  const bundled = listRecordedFormAnalyses().filter((r) => !r.form.demoNotice);
  assert.ok(bundled.length >= 4);
  // Same file as a bundled recording, and a bundled sample's ID: both ignored.
  const hijack = { ...bundled[0], sampleId: "harrow-pike-treating-physio", form: { ...bundled[0].form, title: "Hijacked" } };
  writeFileSync(path.join(fx.dir, "maps", "hijack.json"), JSON.stringify(hijack));
  assert.equal(listDemoAssetFormAnalyses().length, 1);
  assert.notEqual(getRecordedFormMap(bundled[0].sampleId)?.title, "Hijacked");
  assert.equal(getRecordedFormMap(SAMPLE_ID), undefined);
});

test("pre-written answers: advertised in the bundle, replayed by POST /drafts, edits seen without a restart, footer on the preview", async () => {
  const fx = await fixture();
  const bundle = getDemoBundle("sim-pat-001");
  assert.ok(!demoDraftAvailability(bundle).formSha256s.includes(fx.form.file.sha256), "off: not advertised");
  useAssets(fx.dir);
  assert.ok(demoDraftAvailability(bundle).formSha256s.includes(fx.form.file.sha256), "on: the Studio will ask for them");

  const proposal = (await upload(fx.pdf, "therapy-update.pdf")).form;
  const form = withAttestedConfirmation(proposal, "Practice manager", "2026-10-09T10:00:00.000Z");
  const computedFacts = computeFacts(bundle, { asOf: "2026-10-06" });
  let report = createFormReport({ form, bundle, instructingParty: bundle.referral, computedFacts, now: new Date("2026-10-09T10:00:00Z") });
  const res = await route(handleDrafts)(
    post("/api/reports/v1/drafts", { templateId: formTemplateId(form.id), bundle, instructingParty: bundle.referral, sectionKeys: ["F-02"], prefer: "demo", form }),
    { params: {} },
  );
  assert.equal(res.status, 200);
  const drafted = DraftsResponseSchema.parse(await res.json());
  assert.equal(drafted.generation.mode, "demo_prewritten");
  const text = drafted.sections.find((s) => s.key === "F-02")?.paragraphs.map((p) => p.text).join(" ") ?? "";
  assert.match(text, /^At the initial assessment on 18\/03\/2026, (Megan|Ms) Hart reported that on 12\/03\/2026/);
  assert.deepEqual(drafted.flags.filter((f) => f.severity === "blocking"), []);
  report = applyDraftResult(report, drafted, { now: new Date("2026-10-09T10:01:00Z") });

  // An edited answer file is used straight away (no cache for local files).
  writeFileSync(fx.draftFile, JSON.stringify(draftOf(fx.form, { fingerprint: bundleNotesFingerprint(bundle), text: "At the initial assessment on 18/03/2026, [CLAIMANT] reported neck stiffness." })));
  const again = await draftDemo({ template: formToTemplate(form), bundle, instructingParty: bundle.referral, computedFacts, mode: "demo", form, sectionKeys: ["F-02"] });
  assert.equal(again.output.sections[0].paragraphs[0].text, "At the initial assessment on 18/03/2026, [CLAIMANT] reported neck stiffness.");

  // The filled preview carries the footer.
  const preview = await route(handleFormsFillPreview)(
    post("/api/reports/v1/forms/fill-preview", { report, form, fileBase64: Buffer.from(fx.pdf).toString("base64"), mode: "draft" }),
    { params: {} },
  );
  assert.equal(preview.status, 200);
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument(pdfjsDocumentParams(new Uint8Array(await preview.arrayBuffer())));
  const doc = await task.promise;
  const pageText = (await (await doc.getPage(1)).getTextContent()).items.map((it) => ("str" in it ? it.str : "")).join(" ");
  await task.destroy();
  assert.ok(pageText.includes(form.demoNotice ?? "(none)"), pageText.slice(-300));
  assert.ok(pageText.includes("Megan Hart"));
});

test("GET /forms/samples lists the demonstration form as upload-only, whatever the AI mode; its file is never served", async () => {
  const fx = await fixture();
  const list = async () => FormSamplesResponseSchema.parse(await (await route(handleFormSamples)(get("/api/reports/v1/forms/samples"), { params: {} })).json()).samples;
  const bundledCount = (await list()).length;
  useAssets(fx.dir);
  const samples = await list();
  assert.equal(samples.length, bundledCount + 1);
  const entry = samples.find((s) => s.id === SAMPLE_ID);
  assert.ok(entry);
  assert.equal(entry.uploadRequired, true);
  assert.equal(entry.form, undefined, "no map is attached, so nothing is seeded into the library");
  assert.equal(entry.file.sha256, fx.form.file.sha256);
  assert.ok(entry.highlights.includes(demoFormNotice(INSURER)));
  assert.ok(samples.filter((s) => s.id !== SAMPLE_ID).every((s) => !s.uploadRequired));
  assert.deepEqual([entry.title, entry.description, ...entry.highlights].filter(hasBannedTerm), []);
  const file = await route(handleFormSampleFile)(get(`/api/reports/v1/forms/samples/${SAMPLE_ID}/file`), { params: { id: SAMPLE_ID } });
  assert.equal(file.status, 404, "the insurer's file is never served");

  // A live-ready .env.local ("auto" with a key and a passcode): still listed – a request without the
  // passcode is demo, so the upload gets the prepared map (an .env.local made for live work used to hide
  // every demonstration form from npm run demo:red).
  env.MEDREPORT_AI_MODE = "auto";
  env.ANTHROPIC_API_KEY = "test-key-not-used";
  env.MEDREPORT_LIVE_PASSCODE = "test-passcode-not-used-1234";
  env.MEDREPORT_SIGNING_SECRET = "test-signing-secret-not-used-1234"; // live mode needs real secrets to attest the bundled maps
  assert.equal((await list()).length, bundledCount + 1);
  const uploaded = await route(handleFormsAnalyse)(post("/api/reports/v1/forms/analyse", { fileBase64: Buffer.from(fx.pdf).toString("base64"), fileName: "insurer-form.pdf" }), { params: {} });
  assert.equal(uploaded.status, 200);
  assert.equal(FormsAnalyseResponseSchema.parse(await uploaded.json()).form.analysis.mode, "demo_prewritten", "no passcode: the prepared map, not a live reading");
});

test("npm run demo:check: passes a good folder, explains a broken one, and is quiet when there is none", async () => {
  const good = await fixture();
  const ok = await checkDemoAssets(good.dir);
  assert.equal(ok.present, true);
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.maps, 1);
  assert.equal(ok.drafts, 1);
  assert.equal(ok.files, 2);
  assert.ok(ok.notes.some((n) => n.startsWith("another-insurer-claim.pdf: no map")));
  assert.equal(env.MEDREPORT_DEMO_ASSETS_DIR, savedEnv.MEDREPORT_DEMO_ASSETS_DIR, "the variable is restored afterwards");

  const absent = await checkDemoAssets(path.join(good.dir, "nope"));
  assert.equal(absent.present, false);
  assert.deepEqual(absent.problems, []);

  // Form files without a single prepared map: every upload would fall back to the layout rules.
  const unmapped = await fixture();
  rmSync(path.join(unmapped.dir, "maps"), { recursive: true, force: true });
  rmSync(path.join(unmapped.dir, "drafts"), { recursive: true, force: true });
  const none = await checkDemoAssets(unmapped.dir);
  assert.equal(none.maps, 0);
  assert.ok(none.problems.some((p) => /^No prepared maps: maps\/ holds no map for any of the 2 form files/.test(p)), none.problems.join("\n"));

  const broken = await fixture({ fingerprint: "stale" });
  const map = JSON.parse(readFileSync(path.join(broken.dir, "maps", `${SAMPLE_ID}.json`), "utf8"));
  map.form.fields[0].anchor.fieldName = "txtMissing";
  writeFileSync(path.join(broken.dir, "maps", `${SAMPLE_ID}.json`), JSON.stringify(map));
  writeFileSync(path.join(broken.dir, "drafts", "sim-pat-999__form-x.json"), JSON.stringify({ ...draftOf(broken.form), patientId: "sim-pat-999" }));
  const bad = await checkDemoAssets(broken.dir);
  const joined = bad.problems.join("\n");
  assert.match(joined, /the PDF has no field “txtMissing”/);
  assert.match(joined, /stale bundleFingerprint/);
  assert.match(joined, /“sim-pat-999” is not a simulated TM3 demo patient/);

  // A draft whose answer cites a date the record does not hold fails the same checks as the bundled drafts.
  const wrong = await fixture();
  writeFileSync(wrong.draftFile, JSON.stringify(draftOf(wrong.form, { fingerprint: bundleNotesFingerprint(getDemoBundle("sim-pat-001")), text: "At the initial assessment on 19/03/2026, [CLAIMANT] reported NPRS 9/10." })));
  const flagged = (await checkDemoAssets(wrong.dir)).problems.join("\n");
  assert.match(flagged, /FIGURE_NOT_IN_SOURCE|abbreviation "NPRS"/);
});

test("scripts: stamp-demo-drafts --dir stamps the fingerprint; check-demo-assets fails loudly for a named folder that is missing", async () => {
  const fx = await fixture({ fingerprint: "none" });
  const run = (script: string, ...args: string[]) =>
    spawnSync(process.execPath, ["--import", "./scripts/medreport/test-setup.mjs", "--import", "tsx", script, ...args], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, MEDREPORT_DEMO_ASSETS_DIR: "" },
    });
  const stamp = run("scripts/medreport/stamp-demo-drafts.ts", `--dir=${fx.dir}`);
  assert.equal(stamp.status, 0, stamp.stderr);
  assert.equal(JSON.parse(readFileSync(fx.draftFile, "utf8")).bundleFingerprint, bundleNotesFingerprint(getDemoBundle("sim-pat-001")));

  // A folder named by --dir (or MEDREPORT_DEMO_ASSETS_DIR) that does not exist – e.g. a relative path in
  // a git worktree – is an error, not "nothing to check".
  const missing = run("scripts/medreport/check-demo-assets.ts", `--dir=${path.join(fx.dir, "absent")}`);
  assert.equal(missing.status, 1, missing.stdout);
  assert.match(missing.stderr, /^problem: the demo assets folder .*absent does not exist\. Set MEDREPORT_DEMO_ASSETS_DIR/m);
  const checked = run("scripts/medreport/check-demo-assets.ts", `--dir=${fx.dir}`);
  assert.equal(checked.status, 0, `${checked.stdout}\n${checked.stderr}`);
  assert.match(checked.stdout, /^Demo assets OK: 1 map, 1 answer file, 2 form files in /m);
});
