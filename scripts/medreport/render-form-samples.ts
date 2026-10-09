/**
 * Renders example completed referrer forms for both demo cases through the REAL handlers
 * (POST /forms/fill-preview, /sign, /render) – DRAFT preview, review copy, DRAFT PDF, then approval and
 * the FINAL original file and FINAL PDF – into an output folder, and prints any fill warnings and
 * blocking flags. Uses the reviewed answers in form-sample-answers.ts.
 *
 *   node --import ./scripts/medreport/test-setup.mjs --import tsx scripts/medreport/render-form-samples.ts <outDir>
 *
 * Word → PDF needs LibreOffice (skipped with a note when absent). Fictional data only.
 * Owner: forms-engine agent.
 */
import fs from "node:fs";
import path from "node:path";
import { handleFormsFillPreview } from "../../src/modules/medreport/api/handlers/forms-fill-preview";
import { handleRender } from "../../src/modules/medreport/api/handlers/render";
import { handleSign } from "../../src/modules/medreport/api/handlers/sign";
import type { MedreportDeps } from "../../src/modules/medreport/api/deps";
import { bindHandler, type MedreportHandler } from "../../src/modules/medreport/api/http";
import { FORM_ATTESTATIONS, formToTemplate } from "../../src/modules/medreport/core/forms";
import type { Clinician, FormDefinition, SignReceipt } from "../../src/modules/medreport/core/types";
import { validateReport } from "../../src/modules/medreport/core/validation";
import { HARROW_PIKE_FORM } from "../../src/modules/medreport/forms/samples/maps/harrow-pike";
import { KINGSWAY_FORM } from "../../src/modules/medreport/forms/samples/maps/kingsway";
import { NORTHFIELD_FORM } from "../../src/modules/medreport/forms/samples/maps/northfield";
import { getSampleForm } from "../../src/modules/medreport/forms/samples/registry";
import type { DemoCaseSlug } from "./dev-bundles";
import { completedSampleReport } from "./form-sample-answers";

const SARAH: Clinician = { name: "Sarah Reid", hcpc: "PH-DEMO-01", role: "Senior Physiotherapist, MCSP" };
const TOM: Clinician = { name: "Tom Ellis", hcpc: "PH-DEMO-02", role: "Physiotherapist, MCSP" };

const CASES: { slug: DemoCaseSlug; form: FormDefinition; signer: Clinician }[] = [
  { slug: "megan-hart", form: HARROW_PIKE_FORM, signer: SARAH },
  { slug: "megan-hart", form: NORTHFIELD_FORM, signer: SARAH },
  { slug: "daniel-brooks", form: KINGSWAY_FORM, signer: TOM },
  { slug: "daniel-brooks", form: NORTHFIELD_FORM, signer: TOM },
];

const deps = {} as MedreportDeps;

async function call(handler: MedreportHandler, url: string, body: unknown): Promise<Response> {
  const req = new Request(`http://localhost/api/reports/v1${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return bindHandler(handler, () => deps)(req, { params: {} });
}

function warningsOf(res: Response): string[] {
  const h = res.headers.get("x-medreport-fill-warnings");
  return h ? (JSON.parse(decodeURIComponent(h)) as string[]) : [];
}

async function save(res: Response, outDir: string, name: string): Promise<void> {
  if (!res.ok) {
    console.log(`  ✗ ${name}: ${res.status} ${await res.text()}`);
    return;
  }
  const ext = (res.headers.get("content-type") ?? "").includes("pdf") ? "pdf" : "docx";
  const file = path.join(outDir, `${name}.${ext}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  const warnings = warningsOf(res);
  console.log(`  ✓ ${path.basename(file)} (${res.headers.get("x-medreport-render")})${warnings.length ? `\n      warnings: ${warnings.join("\n                ")}` : ""}`);
}

async function main(): Promise<void> {
  const outDir = process.argv[2] ?? path.resolve("samples-out");
  fs.mkdirSync(outDir, { recursive: true });
  for (const { slug, form, signer } of CASES) {
    const sample = getSampleForm(form.sampleId ?? "");
    if (!sample) throw new Error(`no sample ${form.sampleId}`);
    const fileBase64 = Buffer.from(await sample.loadFile()).toString("base64");
    const report = completedSampleReport(slug, form);
    const name = `${slug}_${form.sampleId}`;
    console.log(`\n${name}`);

    const v = validateReport(report, formToTemplate(form));
    const warnings = v.flags.filter((f) => f.severity === "warning").map((f) => `${f.code} ${f.sectionKey ?? ""}`);
    if (warnings.length) console.log(`  validator warnings: ${warnings.join(", ")}`);
    if (!v.canSign) console.log(`  BLOCKING: ${v.blocking.map((f) => `${f.code} ${f.sectionKey ?? ""} ${f.message}`).join("\n            ")}`);

    await save(await call(handleFormsFillPreview, "/forms/fill-preview", { report, form, fileBase64, mode: "draft" }), outDir, `${name}_DRAFT`);
    await save(
      await call(handleFormsFillPreview, "/forms/fill-preview", { report, form, fileBase64, mode: "draft", reviewMarkers: true }),
      outDir,
      `${name}_REVIEW-COPY`,
    );
    if (form.kind === "docx") await save(await call(handleRender, "/render?format=pdf", { report, form, fileBase64 }), outDir, `${name}_DRAFT_pdf`);

    const signRes = await call(handleSign, "/sign", {
      report,
      signer,
      typedSignature: signer.name,
      statementAccepted: true,
      attestations: [...FORM_ATTESTATIONS],
      form,
    });
    if (!signRes.ok) {
      console.log(`  ✗ sign: ${signRes.status} ${await signRes.text()}`);
      continue;
    }
    const { receipt } = (await signRes.json()) as { receipt: SignReceipt };
    const signed = { ...report, status: "signed" as const, receipt };
    await save(await call(handleRender, "/render?format=original", { report: signed, receipt, form, fileBase64, requireFinal: true }), outDir, `${name}_FINAL`);
    if (form.kind === "docx") {
      await save(await call(handleRender, "/render?format=pdf", { report: signed, receipt, form, fileBase64, requireFinal: true }), outDir, `${name}_FINAL_pdf`);
    }
  }
}

void main();
