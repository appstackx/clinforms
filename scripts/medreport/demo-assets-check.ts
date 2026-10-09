/**
 * Checks of the local demonstration assets (ai/demo-assets.ts) – the logic behind `npm run demo:check`
 * (scripts/medreport/check-demo-assets.ts). Nothing here is in git or CI-dependent: tests point it at a
 * temporary folder of synthetic files.
 *
 * Maps (<dir>/maps/*.json): valid RecordedFormAnalysis; bound to a form file that sits in <dir> with
 * that exact SHA-256 (the upload is matched by it); a unique sample ID that is not a bundled sample's;
 * the map passes the same check POST /forms/confirm runs (core/forms.ts checkFormDefinition) and its
 * server attestation verifies; every PDF field / Word block it points at exists in the file; and an
 * upload of the file in demo mode really returns this map, with its mode and its demonstration footer.
 *
 * Drafts (<dir>/drafts/*.json): valid DemoDraftFile named <patientId>__form-<sampleId>; for a simulated
 * TM3 demo patient, with the current bundleFingerprint (stamp-demo-drafts.ts --dir=… after a fixture
 * change); bound to a mapped file; advertised in the bundle response; and passing exactly the checks of
 * demo-draft-quality.test.ts (./demo-draft-checks.ts).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { analyseFormFile } from "@/modules/medreport/ai/analyse-form";
import { bundleNotesFingerprint } from "@/modules/medreport/ai/bundle-fingerprint";
import { DEMO_ASSETS_DIR_ENV, demoAssetsState } from "@/modules/medreport/ai/demo-assets";
import { DEMO_DRAFT_SOURCES } from "@/modules/medreport/ai/demo-drafts";
import { DemoDraftFileSchema, demoFormDraftKey } from "@/modules/medreport/ai/demo-format";
import { demoDraftAvailability } from "@/modules/medreport/ai/draft-demo";
import { RecordedFormAnalysisSchema, type RecordedFormAnalysis } from "@/modules/medreport/ai/recorded-forms";
import { verifyFormConfirmation, withAttestedConfirmation } from "@/modules/medreport/auth/attestations";
import { checkFormDefinition, formToTemplate } from "@/modules/medreport/core/forms";
import { isQuestionSet, questionSetSha256 } from "@/modules/medreport/core/question-set";
import type { EpisodeBundle, FormDefinition } from "@/modules/medreport/core/types";
import { demoFormNotice } from "@/modules/medreport/core/wording";
import { buildDocxOutline } from "@/modules/medreport/forms/docx-outline";
import { DOCX_MIME, PDF_MIME, decodeFormFile, sha256Hex, type DecodedFormFile } from "@/modules/medreport/forms/file";
import { readPdfForm } from "@/modules/medreport/forms/pdf-outline";
import { SAMPLE_FORMS } from "@/modules/medreport/forms/samples/registry";
import { demoDraftProblems } from "./demo-draft-checks";
import { getDemoBundle } from "./dev-bundles";

export interface DemoAssetsReport {
  /** The folder checked (absolute). */
  dir: string;
  /** False when the folder does not exist (nothing to check – not an error). */
  present: boolean;
  maps: number;
  drafts: number;
  files: number;
  /** Blocking problems: the demo would not work as prepared. */
  problems: string[];
  /** Worth knowing, not blocking. */
  notes: string[];
}

function readJson(file: string): { ok: true; data: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, data: JSON.parse(readFileSync(file, "utf8")) as unknown };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function zodIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  return error.issues
    .slice(0, 3)
    .map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

/** Every `fieldName` / `fieldNames` an anchor names (pdf_field, and any richer PDF anchor that names fields the same way). */
function anchorFieldNames(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => anchorFieldNames(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k === "fieldName" && typeof v === "string") out.push(v);
      else if (k === "fieldNames" && Array.isArray(v)) out.push(...v.filter((x): x is string => typeof x === "string"));
      else anchorFieldNames(v, out);
    }
  }
  return out;
}

/** Problems with the answer spaces a map points at, checked against the real file. */
async function anchorProblems(form: FormDefinition, file: DecodedFormFile): Promise<string[]> {
  const problems: string[] = [];
  if (file.mimeType === PDF_MIME) {
    const pdf = await readPdfForm(file.bytes);
    const names = new Set(pdf.fields.map((f) => f.name));
    for (const field of form.fields) {
      if (field.anchor.kind === "docx") continue;
      for (const name of anchorFieldNames(field.anchor)) {
        if (!names.has(name)) problems.push(`${field.id} (“${field.label}”): the PDF has no field “${name}”`);
      }
      const page = (field.anchor as { page?: unknown }).page;
      if (typeof page === "number" && (page < 1 || page > pdf.pages)) problems.push(`${field.id}: page ${page} is not in the PDF (${pdf.pages} pages)`);
    }
  } else if (file.mimeType === DOCX_MIME) {
    const ids = new Set(buildDocxOutline(file.bytes).blocks.map((b) => b.id));
    for (const field of form.fields) {
      if (field.anchor.kind === "docx" && !ids.has(field.anchor.blockId)) problems.push(`${field.id} (“${field.label}”): the Word file has no block ${field.anchor.blockId}`);
    }
  }
  return problems;
}

/** SHA-256 → file name of the form files directly in the folder. */
function formFiles(dir: string): Map<string, { name: string; bytes: Uint8Array }> {
  const out = new Map<string, { name: string; bytes: Uint8Array }>();
  for (const name of readdirSync(dir).sort()) {
    if (!/\.(pdf|docx)$/i.test(name)) continue;
    const file = path.join(dir, name);
    if (!statSync(file).isFile()) continue;
    const bytes = new Uint8Array(readFileSync(file));
    out.set(sha256Hex(bytes), { name, bytes });
  }
  return out;
}

/** The folder as the user would type it: relative to the working directory when inside it, else absolute. */
function displayDir(dir: string): string {
  const rel = path.relative(process.cwd(), dir);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : dir;
}

function jsonFiles(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".json")).sort() : [];
}

/**
 * Check a demo-assets folder. Serves the files to the app's own code paths through
 * MEDREPORT_DEMO_ASSETS_DIR, which it sets to `dir` while checking and restores afterwards.
 */
export async function checkDemoAssets(dirArg: string): Promise<DemoAssetsReport> {
  const dir = path.resolve(process.cwd(), dirArg);
  const report: DemoAssetsReport = { dir, present: false, maps: 0, drafts: 0, files: 0, problems: [], notes: [] };
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return report;
  report.present = true;

  const previous = process.env[DEMO_ASSETS_DIR_ENV];
  process.env[DEMO_ASSETS_DIR_ENV] = dir;
  try {
    const state = demoAssetsState();
    if (!state.on) {
      report.problems.push(
        state.reason === "production"
          ? "The demo assets are switched off on a production build (NODE_ENV or VERCEL_ENV is \"production\"). Run the check without them, or set MEDREPORT_DEMO_ASSETS_ALLOW_PROD=1 for a local production run."
          : `The demo assets folder could not be used (${state.reason}).`,
      );
      return report;
    }
    await checkFolder(dir, report);
  } finally {
    if (previous === undefined) delete process.env[DEMO_ASSETS_DIR_ENV];
    else process.env[DEMO_ASSETS_DIR_ENV] = previous;
  }
  return report;
}

async function checkFolder(dir: string, report: DemoAssetsReport): Promise<void> {
  const files = formFiles(dir);
  report.files = files.size;
  const bundledIds = new Set(SAMPLE_FORMS.map((s) => s.id));

  /* Maps -------------------------------------------------------------------------------------- */
  const maps = new Map<string, RecordedFormAnalysis>(); // by file SHA-256
  const sampleIds = new Map<string, string>();
  const mapNames = jsonFiles(path.join(dir, "maps"));
  report.maps = mapNames.length;
  for (const name of mapNames) {
    const where = `maps/${name}`;
    const raw = readJson(path.join(dir, "maps", name));
    if (!raw.ok) {
      report.problems.push(`${where}: not valid JSON (${raw.error})`);
      continue;
    }
    const parsed = RecordedFormAnalysisSchema.safeParse(raw.data);
    if (!parsed.success) {
      report.problems.push(`${where}: not a form-analysis file (${zodIssues(parsed.error)})`);
      continue;
    }
    const rec = parsed.data;
    const form = rec.form;
    if (form.file.sha256 !== rec.fileSha256) {
      report.problems.push(`${where}: form.file.sha256 differs from fileSha256 – the map would never be used`);
      continue;
    }
    if (maps.has(rec.fileSha256)) {
      report.problems.push(`${where}: a second map of the same file (${rec.fileSha256.slice(0, 12)}…) – only the first is used`);
      continue;
    }
    maps.set(rec.fileSha256, rec);
    if (bundledIds.has(rec.sampleId)) report.problems.push(`${where}: sampleId “${rec.sampleId}” is a bundled sample's ID – use a different one`);
    const other = sampleIds.get(rec.sampleId);
    if (other) report.problems.push(`${where}: sampleId “${rec.sampleId}” is also used by ${other}`);
    sampleIds.set(rec.sampleId, where);
    if (name !== `${rec.sampleId}.json`) report.notes.push(`${where}: by convention the file is named ${rec.sampleId}.json`);
    if (rec.mode !== "demo_prewritten") report.notes.push(`${where}: mode “${rec.mode}” – it is shown as a prepared reading, not a pre-written map`);
    if (!form.demoNotice?.trim()) report.notes.push(`${where}: no demoNotice – the standard one is used: “${demoFormNotice(form.referrer.name)}”`);

    // A portal question set (FormKind "questions") has no file: its placeholder SHA-256 is that of its
    // questions, and the Studio seeds it into the forms library (GET /forms/samples) – nothing to upload.
    if (isQuestionSet(form)) {
      const sha = await questionSetSha256(form.fields);
      if (sha !== rec.fileSha256) report.problems.push(`${where}: a question set's fileSha256 must be the SHA-256 of its questions (${sha.slice(0, 12)}…)`);
      for (const p of checkFormDefinition(form)) report.problems.push(`${where}: ${p}`);
      const attestedQs = withAttestedConfirmation(form, "Demo assets check", new Date().toISOString());
      const verifiedQs = verifyFormConfirmation(attestedQs);
      if (!verifiedQs.ok) report.problems.push(`${where}: the confirmation attestation does not verify (${verifiedQs.reason})`);
      continue;
    }

    const fileEntry = files.get(rec.fileSha256);
    if (!fileEntry) {
      report.problems.push(`${where}: no .pdf/.docx in ${dir} has SHA-256 ${rec.fileSha256.slice(0, 12)}… (${form.file.fileName}) – put the exact file next to the maps; an upload is matched by its bytes`);
      continue;
    }
    if (fileEntry.name !== form.file.fileName) report.notes.push(`${where}: the map names “${form.file.fileName}”, the file is “${fileEntry.name}”`);

    for (const p of checkFormDefinition(form)) report.problems.push(`${where}: ${p}`);
    const attested = withAttestedConfirmation(form, "Demo assets check", new Date().toISOString());
    const verified = verifyFormConfirmation(attested);
    if (!verified.ok) report.problems.push(`${where}: the confirmation attestation does not verify (${verified.reason})`);

    let decoded: DecodedFormFile;
    try {
      decoded = decodeFormFile(Buffer.from(fileEntry.bytes).toString("base64"));
    } catch (err) {
      report.problems.push(`${where}: ${fileEntry.name} cannot be used as a form (${err instanceof Error ? err.message : String(err)})`);
      continue;
    }
    const wantKind = form.kind === "docx" ? DOCX_MIME : PDF_MIME;
    if (decoded.mimeType !== wantKind) report.problems.push(`${where}: the map is for a ${form.kind} form, ${fileEntry.name} is ${decoded.mimeType}`);
    for (const p of await anchorProblems(form, decoded)) report.problems.push(`${where}: ${p}`);

    // An upload of the file in demo mode returns exactly this map, with its mode and its footer.
    const analysed = await analyseFormFile({ file: decoded, fileName: fileEntry.name, mode: "demo" });
    if (analysed.form.analysis.mode !== rec.mode) {
      report.problems.push(`${where}: an upload of ${fileEntry.name} was mapped as “${analysed.form.analysis.mode}”, not by this map`);
    } else if (analysed.form.fields.length !== form.fields.length) {
      report.problems.push(`${where}: an upload of ${fileEntry.name} returned ${analysed.form.fields.length} questions, the map has ${form.fields.length}`);
    }
    if (!analysed.form.demoNotice) report.problems.push(`${where}: an upload of ${fileEntry.name} carries no demonstration footer`);
  }
  for (const [sha, entry] of Array.from(files)) {
    if (!maps.has(sha)) report.notes.push(`${entry.name}: no map – an upload is mapped by layout rules (still labelled as a demonstration form)`);
  }
  // Form files and not one prepared map: every upload falls back to the layout rules, whose maps of
  // real insurer forms need correcting by hand – not a demo that works as prepared.
  if (files.size > 0 && maps.size === 0) {
    report.problems.push(
      `No prepared maps: maps/ holds no map for any of the ${files.size} form file${files.size === 1 ? "" : "s"}, so every upload is mapped by layout rules only. Add maps/<sampleId>.json (see src/modules/medreport/ai/demo-assets.ts).`,
    );
  }

  /* Drafts ------------------------------------------------------------------------------------ */
  const draftNames = jsonFiles(path.join(dir, "drafts"));
  report.drafts = draftNames.length;
  for (const name of draftNames) {
    const where = `drafts/${name}`;
    const key = name.slice(0, -".json".length);
    const raw = readJson(path.join(dir, "drafts", name));
    if (!raw.ok) {
      report.problems.push(`${where}: not valid JSON (${raw.error})`);
      continue;
    }
    const parsed = DemoDraftFileSchema.safeParse(raw.data);
    if (!parsed.success) {
      report.problems.push(`${where}: not a demo-draft file (${zodIssues(parsed.error)})`);
      continue;
    }
    const draft = parsed.data;
    if (Object.prototype.hasOwnProperty.call(DEMO_DRAFT_SOURCES, key)) {
      report.problems.push(`${where}: a bundled demo draft has the same name, so this file is ignored – rename it`);
      continue;
    }
    if (!draft.formSha256) {
      report.problems.push(`${where}: no formSha256 – demonstration drafts answer a referrer form`);
      continue;
    }
    const rec = maps.get(draft.formSha256);
    if (!rec) {
      report.problems.push(`${where}: no map in maps/ for the file it answers (${draft.formSha256.slice(0, 12)}…)`);
      continue;
    }
    const expectedKey = demoFormDraftKey(draft.patientId, { id: rec.form.id, sampleId: rec.sampleId });
    if (key !== expectedKey) report.notes.push(`${where}: by convention the file is named ${expectedKey}.json`);
    if (draft.sampleId && draft.sampleId !== rec.sampleId) report.notes.push(`${where}: sampleId “${draft.sampleId}” differs from the map's “${rec.sampleId}”`);

    let bundle: EpisodeBundle;
    try {
      bundle = getDemoBundle(draft.patientId);
    } catch {
      report.problems.push(`${where}: “${draft.patientId}” is not a simulated TM3 demo patient`);
      continue;
    }
    const fingerprint = bundleNotesFingerprint(bundle);
    if (draft.bundleFingerprint !== fingerprint) {
      report.problems.push(
        `${where}: ${draft.bundleFingerprint ? "stale" : "no"} bundleFingerprint – the answers would never be used. Run: node --import ./scripts/medreport/test-setup.mjs --import tsx scripts/medreport/stamp-demo-drafts.ts --dir=${displayDir(dir)}`,
      );
      continue;
    }
    if (!demoDraftAvailability(bundle).formSha256s.includes(draft.formSha256)) {
      report.problems.push(`${where}: the bundle response would not advertise these answers, so the Studio would not ask for them`);
      continue;
    }
    for (const p of await demoDraftProblems({ bundle, template: formToTemplate(rec.form), form: rec.form })) report.problems.push(`${where}: ${p}`);
  }
}
