/**
 * Demo clinics (the host's clinic_plan.demo_clinic, set by ClinForms platform staff only – core/demo-clinic.ts):
 *
 * - POST /sign: a demo clinic's member whose signing details hold a made-up PH-DEMO number approves with it like any
 *   clinician (receipt signer = the member, made-up number); the audit row says demoClinic and names the made-up
 *   number (never a real one). Any OTHER clinic refuses a made-up number (403 DEMO_NUMBER_NOT_ALLOWED) – also a clinic
 *   switched back from demo, and when the clinic's plan cannot be read (fail closed). Real clinics' approvals and
 *   their audit rows are byte-for-byte as before; the public demo is unchanged.
 * - Every output of a demo clinic – a PDF form's final file and draft preview, a Word form's final file, a built-in
 *   report in Word and PDF – carries the demonstration notice; a real clinic's never does. The final document's audit
 *   row says demoClinic. Copied answers carry the notice.
 *
 * Signed-in members are stubbed (MedreportDeps.authenticate reads an x-test-member header); the clinic profiles and
 * plans are real rows (node:sqlite, every migration applied) read by the real loadClinicProfile. Fictional data only.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.MEDREPORT_AI_MODE = "demo";
for (const k of ["MEDREPORT_LAUNCH_SECRET", "MEDREPORT_SIGNING_SECRET", "ANTHROPIC_API_KEY", "MEDREPORT_LIVE_PASSCODE", "CLINFORMS_PUBLIC_DEMO", "CLINFORMS_DB", "VERCEL"]) {
  delete process.env[k];
}
process.env.APP_ORIGIN = "https://clinforms.test";

import { Kysely } from "kysely";
import PizZip from "pizzip";
import { dbAudit, getMedreportDeps } from "@/app/api/_medreport-glue";
import { CONTENT_TYPES, HEADERS, PROBLEM_CODES, ProblemSchema, SignResponseSchema } from "@/modules/medreport/api/contract";
import type { AuthContext, MedreportDeps } from "@/modules/medreport/api/deps";
import { handleFormsFillPreview } from "@/modules/medreport/api/handlers/forms-fill-preview";
import { handleRender } from "@/modules/medreport/api/handlers/render";
import { handleSign } from "@/modules/medreport/api/handlers/sign";
import { bindHandler, type MedreportHandler } from "@/modules/medreport/api/http";
import { withAttestedConfirmation } from "@/modules/medreport/auth/attestations";
import { verifyReceipt } from "@/modules/medreport/auth/sign-receipt";
import { buildAnswersCopy, copyFormOf, copyTextForAnswer } from "@/modules/medreport/core/answer-copy";
import { demoOutputNotice, isDemoHcpc, normaliseDemoHcpc } from "@/modules/medreport/core/demo-clinic";
import { FORM_ATTESTATIONS } from "@/modules/medreport/core/forms";
import { EXAMPLE_PORTAL_QUESTIONS, createQuestionSet, parsePortalQuestions } from "@/modules/medreport/core/question-set";
import { createFormReport, createReport } from "@/modules/medreport/core/report-factory";
import type { FormDefinition, Report, SignReceipt } from "@/modules/medreport/core/types";
import { WORDING } from "@/modules/medreport/core/wording";
import { loadPdfjs, pdfjsDocumentParams } from "@/modules/medreport/forms/pdfjs";
import { HARROW_PIKE_FORM } from "@/modules/medreport/forms/samples/maps/harrow-pike";
import { NORTHFIELD_FORM } from "@/modules/medreport/forms/samples/maps/northfield";
import { getSampleForm } from "@/modules/medreport/forms/samples/registry";
import { BUILTIN_TEMPLATES } from "@/modules/medreport/templates/registry";
import { computeFacts } from "@/modules/medreport/core/computed-facts";
import { createConnectorRegistry } from "@/modules/medreport/connectors/registry";
import { createFileImportConnector } from "@/modules/medreport/connectors/file-import/connector";
import { createTm3SimConnector } from "@/modules/medreport/connectors/tm3-sim/connector";
import { SARAH_REID } from "@/sandbox/tm3-sim/fixtures/clinic";
import { describeActivityDetail } from "@/lib/activity-copy";
import { loadClinicProfile } from "@/server/auth/medreport-actor";
import { NodeSqliteDialect, openSqliteDatabase } from "@/server/db/dialects/sqlite-local";
import { applySqliteMigrations } from "@/server/db/migrations";
import type { Database } from "@/server/db/schema";
import { listAudit } from "@/server/repos/audit";
import { setClinicDemoFlag } from "@/server/repos/clinic-plan";
import { upsertClinicProfile } from "@/server/repos/clinic-profile";
import { getDemoBundle } from "./dev-bundles";
import { completedSampleReport } from "./form-sample-answers";
import { demoSessionToken } from "./test-actors";

const D = "demo-clinic-test"; // a demo clinic (made-up data only)
const A = "abbey-physio-test"; // a real clinic

const SARAH = { name: "Sarah Reid", hcpc: "PH-DEMO-01" };
const MEMBERS: Record<string, AuthContext> = {
  // The demo clinic's clinician: Sarah Reid with the made-up PH-DEMO-01 in her signing details.
  "sarah-d": {
    userId: "u_sarah_d",
    authSessionId: "s_sarah_d",
    tenantId: D,
    role: "clinician",
    name: "Sarah Reid",
    clinician: { name: "Sarah Reid", hcpc: "PH-DEMO-01", jobTitle: "Senior Physiotherapist", canSign: true },
    twoFactorVerified: true,
  },
  // A demo clinic member with a registration-format number (allowed there too).
  "tom-d": {
    userId: "u_tom_d",
    authSessionId: "s_tom_d",
    tenantId: D,
    role: "owner",
    name: "Tom Ellis",
    clinician: { name: "Tom Ellis", hcpc: "PH654321", jobTitle: "Physiotherapist", canSign: true },
    twoFactorVerified: true,
  },
  // A REAL clinic's member holding a made-up number (e.g. the clinic was a demo clinic before): refused.
  "demo-number-a": {
    userId: "u_demo_a",
    authSessionId: "s_demo_a",
    tenantId: A,
    role: "clinician",
    name: "Sarah Reid",
    clinician: { name: "Sarah Reid", hcpc: "PH-DEMO-01", jobTitle: "Physiotherapist", canSign: true },
    twoFactorVerified: true,
  },
  // A real clinic's registered clinician: unchanged.
  "sam-a": {
    userId: "u_sam_a",
    authSessionId: "s_sam_a",
    tenantId: A,
    role: "clinician",
    name: "Sam Ward (fictional)",
    clinician: { name: "Sam Ward (fictional)", hcpc: "PH123456", jobTitle: "Physiotherapist", canSign: true },
    twoFactorVerified: true,
  },
};

async function stubAuthenticate(req: Request): Promise<AuthContext | null> {
  const id = req.headers.get("x-test-member");
  return id ? (MEMBERS[id] ?? null) : null;
}

let tmpDir: string;
let db: Kysely<Database>;
let deps: MedreportDeps;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clinforms-demo-clinic-"));
  const sqlite = openSqliteDatabase(path.join(tmpDir, "demo.db"));
  applySqliteMigrations(sqlite);
  db = new Kysely<Database>({ dialect: new NodeSqliteDialect({ database: sqlite }) });
  deps = {
    connectors: createConnectorRegistry([createTm3SimConnector(), createFileImportConnector()]),
    createConnectorContext: getMedreportDeps().createConnectorContext,
    authenticate: stubAuthenticate,
    clinicProfile: (tenantId) => loadClinicProfile(db, tenantId),
    audit: dbAudit(() => db),
  };
  await upsertClinicProfile({ db }, D, { organizationId: "org_d", displayName: "Demo Physio (fictional)" });
  assert.equal((await setClinicDemoFlag({ db }, D, true)).changed, true);
  await upsertClinicProfile({ db }, A, { organizationId: "org_a", displayName: "Abbey Physio (fictional)" });
});

after(async () => {
  await db?.destroy();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------------------------------------
 * Helpers
 * ----------------------------------------------------------------------------------------------*/

async function call(handler: MedreportHandler, url: string, body: unknown, init: { member?: string; bearer?: string; deps?: MedreportDeps } = {}): Promise<Response> {
  const headers: Record<string, string> = { "content-type": CONTENT_TYPES.json };
  if (init.member) headers["x-test-member"] = init.member;
  if (init.bearer) headers.authorization = `Bearer ${init.bearer}`;
  const req = new Request(`http://localhost/api/reports/v1${url}`, { method: "POST", headers, body: JSON.stringify(body) });
  return bindHandler(handler, () => init.deps ?? deps)(req, { params: {} });
}

async function expectProblem(res: Response, status: number, code: string, label = ""): Promise<void> {
  const text = await res.clone().text();
  assert.equal(res.status, status, `${label} ${text}`);
  assert.equal(ProblemSchema.parse(await res.json()).code, code, label);
}

const attested = (form: FormDefinition, tenantId?: string): FormDefinition =>
  withAttestedConfirmation({ ...form, ...(tenantId ? { tenantId } : {}) }, "Practice manager", "2026-10-01T09:00:00.000Z");
const northfieldOf = (tenantId: string) => attested(NORTHFIELD_FORM, tenantId);

/** Megan Hart's completed form (fictional) as clinic `tenantId`'s own report. */
function reportOf(tenantId: string, id: string, form: FormDefinition = northfieldOf(tenantId)): Report {
  const r = completedSampleReport("megan-hart", form, { id });
  return { ...r, tenantId, bundleSnapshot: { ...r.bundleSnapshot, tenantId } };
}

const signBody = (report: Report, form: FormDefinition, signer: { name: string; hcpc: string }) => ({
  report,
  signer,
  typedSignature: signer.name,
  statementAccepted: true,
  attestations: [...FORM_ATTESTATIONS],
  form,
});

async function sign(member: string, report: Report, form: FormDefinition, signer: { name: string; hcpc: string }): Promise<SignReceipt> {
  const res = await call(handleSign, "/sign", signBody(report, form, signer), { member });
  assert.equal(res.status, 200, await res.clone().text());
  return SignResponseSchema.parse(await res.json()).receipt;
}

async function sampleBase64(id: string): Promise<string> {
  return Buffer.from(await getSampleForm(id)!.loadFile()).toString("base64");
}

/** Every page's text (pdfjs). */
async function pagesText(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument(pdfjsDocumentParams(bytes));
  const pdf = await task.promise;
  const out: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const content = await (await pdf.getPage(i)).getTextContent();
    out.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" ").replace(/\s+/g, " "));
  }
  await task.destroy();
  return out;
}

const NOTICE = "DEMONSTRATION – made-up data from a demo clinic. Not for clinical use.";
/** pdf.js may read the WinAnsi en dash back differently: match the words around it. */
const hasNotice = (text: string) => text.includes("DEMONSTRATION") && text.includes("made-up data from a demo clinic. Not for clinical use.");
/** Word: every footer part's text. */
function docxFooters(bytes: Uint8Array): string {
  const zip = new PizZip(bytes);
  return Object.keys(zip.files)
    .filter((n) => /^word\/footer.*\.xml$/.test(n))
    .map((n) => zip.file(n)!.asText())
    .join(" ");
}

const signRows = async (tenantId: string, reportId: string) => (await listAudit({ db }, tenantId)).filter((r) => r.action === "report.sign" && r.targetId === reportId);

/* ------------------------------------------------------------------------------------------------
 * core/demo-clinic.ts
 * ----------------------------------------------------------------------------------------------*/

describe("core/demo-clinic.ts", () => {
  test("made-up numbers: PH-DEMO-NN in any spelling (the demo fixtures' Sarah Reid is one), never a registration number", () => {
    assert.equal(normaliseDemoHcpc("ph-demo-01"), "PH-DEMO-01");
    assert.equal(normaliseDemoHcpc("PH DEMO 03"), "PH-DEMO-03");
    assert.equal(normaliseDemoHcpc("PHDEMO04"), "PH-DEMO-04");
    assert.equal(isDemoHcpc(SARAH_REID.hcpc), true, "the simulated clinic's Sarah Reid");
    for (const v of ["PH123456", "PH-DEMO-1", "XX-DEMO-01", "PH-DEMO-001", "", null, undefined]) assert.equal(isDemoHcpc(v), false, String(v));
    assert.ok(PROBLEM_CODES.includes("DEMO_NUMBER_NOT_ALLOWED"));
  });

  test("the notice: in a demo clinic the form's own wins, else the demo clinic notice; elsewhere only the form's own", () => {
    assert.equal(demoOutputNotice({ demoNotice: "  Public form used for demonstration only.  " }, true), "Public form used for demonstration only.");
    assert.equal(demoOutputNotice({}, true), NOTICE);
    assert.equal(demoOutputNotice(null, true), NOTICE);
    assert.equal(demoOutputNotice({}, false), undefined);
    assert.equal(WORDING.demoClinic.outputNotice, NOTICE);
  });

  test("copied answers carry the notice in a demo clinic (first and last line, each single answer), unchanged elsewhere", () => {
    const report = reportOf(D, "rpt_copy");
    const plain = buildAnswersCopy({ report, form: copyFormOf(northfieldOf(D)) });
    const demo = buildAnswersCopy({ report, form: copyFormOf(northfieldOf(D)), demoNotice: NOTICE });
    assert.ok(!plain.text.includes(NOTICE));
    const lines = demo.text.split("\n");
    assert.ok(demo.header.includes(NOTICE));
    assert.equal(lines[lines.length - 1], NOTICE, "the last line");
    assert.equal(demo.text.replace(`\n${NOTICE}`, "").replace(`\n\n${NOTICE}`, ""), plain.text, "the notice is the only difference");
    assert.equal(copyTextForAnswer("Improving.", true), "Improving.");
    assert.equal(copyTextForAnswer("Improving.", true, NOTICE), `[${NOTICE}] Improving.`);
    assert.equal(copyTextForAnswer("Improving.", false, NOTICE), `[${NOTICE}] [${WORDING.answersCopy.draftMarker}] Improving.`);
  });
});

/* ------------------------------------------------------------------------------------------------
 * POST /sign
 * ----------------------------------------------------------------------------------------------*/

describe("POST /sign – made-up numbers approve in a demo clinic only", () => {
  test("a demo clinic: Sarah Reid approves with PH-DEMO-01; receipt as usual; the audit row says demo clinic + the made-up number", async () => {
    const report = reportOf(D, "rpt_demo_sarah");
    const receipt = await sign("sarah-d", report, northfieldOf(D), SARAH);
    assert.deepEqual(receipt.signer, { name: "Sarah Reid", hcpc: "PH-DEMO-01", role: "Senior Physiotherapist" });
    assert.deepEqual(receipt.approvedVia, { kind: "user", sid: "s_sarah_d", userId: "u_sarah_d" });
    assert.deepEqual(await verifyReceipt(receipt, report, { tenantId: D }), { ok: true, contentSha256: receipt.contentSha256 });
    const [row] = await signRows(D, report.id);
    assert.ok(row);
    assert.equal(row.userId, "u_sarah_d");
    assert.equal(row.detail?.demoClinic, true);
    assert.equal(row.detail?.demoNumber, "PH-DEMO-01");
    const detailText = JSON.stringify(row.detail);
    for (const phi of ["Megan", "Hart", report.bundleSnapshot.registration.dob]) assert.ok(!detailText.includes(phi), `no patient data (${phi})`);
    assert.equal(describeActivityDetail(row.action, row.detail), "Demo clinic – approved with the made-up number PH-DEMO-01");
  });

  test("a demo clinic member with a registration-format number approves too; the row says demo clinic, never the number", async () => {
    const report = reportOf(D, "rpt_demo_tom");
    const receipt = await sign("tom-d", report, northfieldOf(D), { name: "Tom Ellis", hcpc: "PH654321" });
    assert.equal(receipt.signer.hcpc, "PH654321");
    const [row] = await signRows(D, report.id);
    assert.equal(row?.detail?.demoClinic, true);
    assert.equal(row?.detail?.demoNumber, undefined);
    assert.ok(!JSON.stringify(row?.detail).includes("PH654321"), "a registration number is never written to the trail");
    assert.equal(describeActivityDetail("report.sign", row?.detail), "Demo clinic – approved");
  });

  test("a real clinic refuses a made-up number (403 DEMO_NUMBER_NOT_ALLOWED), nothing approved; its registered clinicians are unchanged", async () => {
    const refused = reportOf(A, "rpt_real_demo_number");
    const res = await call(handleSign, "/sign", signBody(refused, northfieldOf(A), SARAH), { member: "demo-number-a" });
    await expectProblem(res.clone(), 403, "DEMO_NUMBER_NOT_ALLOWED");
    assert.match(ProblemSchema.parse(await res.json()).detail ?? "", /PH-DEMO numbers are made up and work in a demo clinic only/);
    assert.deepEqual(await signRows(A, refused.id), [], "nothing approved, nothing recorded");
    // Checked last: every other refusal reads exactly as before (here: an incomplete declaration).
    await expectProblem(
      await call(handleSign, "/sign", { ...signBody(refused, northfieldOf(A), SARAH), attestations: [] }, { member: "demo-number-a" }),
      422,
      "VALIDATION_FAILED",
      "the declaration first",
    );

    const ok = reportOf(A, "rpt_real_ok");
    const receipt = await sign("sam-a", ok, northfieldOf(A), { name: "Sam Ward (fictional)", hcpc: "PH123456" });
    assert.equal(receipt.signer.hcpc, "PH123456");
    const [row] = await signRows(A, ok.id);
    assert.deepEqual(Object.keys(row?.detail ?? {}).sort(), ["contentSha256", "flags", "formId", "receiptMac"], "a real clinic's audit row: exactly as before");
    assert.equal(describeActivityDetail("report.sign", row?.detail), null);
  });

  test("the flag is the server's: switched off, the demo clinic's made-up number is refused at once; an unreadable plan fails closed", async () => {
    await setClinicDemoFlag({ db }, D, false);
    try {
      await expectProblem(await call(handleSign, "/sign", signBody(reportOf(D, "rpt_demo_off"), northfieldOf(D), SARAH), { member: "sarah-d" }), 403, "DEMO_NUMBER_NOT_ALLOWED", "switched off");
    } finally {
      await setClinicDemoFlag({ db }, D, true);
    }
    const failing: MedreportDeps = {
      ...deps,
      clinicProfile: async () => {
        throw new Error("database unavailable");
      },
    };
    await expectProblem(
      await call(handleSign, "/sign", signBody(reportOf(D, "rpt_demo_unreadable"), northfieldOf(D), SARAH), { member: "sarah-d", deps: failing }),
      403,
      "DEMO_NUMBER_NOT_ALLOWED",
      "fail closed",
    );
  });

  test("the public demo (/reports) is unchanged: its fictional Sarah Reid PH-DEMO-01 still approves", async () => {
    const form = attested(NORTHFIELD_FORM);
    const report = completedSampleReport("megan-hart", form, { id: "rpt_public_demo" });
    const res = await call(handleSign, "/sign", signBody(report, form, SARAH), { bearer: demoSessionToken() });
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal(SignResponseSchema.parse(await res.json()).receipt.signer.hcpc, "PH-DEMO-01");
  });
});

/* ------------------------------------------------------------------------------------------------
 * Every output carries the notice (demo clinic only)
 * ----------------------------------------------------------------------------------------------*/

describe("outputs – the demonstration notice", () => {
  test("PDF form: the final file and the draft preview carry the notice on every page; the final's audit row says so", async () => {
    const fileBase64 = await sampleBase64("northfield-rehab-progress");
    const report = reportOf(D, "rpt_demo_render");
    const receipt = await sign("sarah-d", report, northfieldOf(D), SARAH);
    const signed: Report = { ...report, status: "signed", receipt };
    const res = await call(handleRender, "/render?format=original", { report: signed, receipt, form: northfieldOf(D), fileBase64, requireFinal: true }, { member: "sarah-d" });
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal(res.headers.get(HEADERS.renderKind), "final");
    const pages = await pagesText(new Uint8Array(await res.arrayBuffer()));
    assert.ok(pages.length >= 1);
    pages.forEach((text, i) => assert.ok(hasNotice(text), `page ${i + 1} carries the notice: ${text.slice(-200)}`));
    const all = pages.join(" ");
    assert.ok(all.includes("Sarah Reid") && all.includes("PH-DEMO-01"), "the declaration names the approving member and the made-up number");
    const finalRow = (await listAudit({ db }, D)).find((r) => r.action === "report.render_final" && r.targetId === report.id);
    assert.equal(finalRow?.detail?.demoClinic, true);
    assert.equal(describeActivityDetail("report.render_final", finalRow?.detail), "In the referrer's own format · Demo clinic – marked as a demonstration");

    const preview = await call(handleFormsFillPreview, "/forms/fill-preview", { report, form: northfieldOf(D), fileBase64, mode: "draft" }, { member: "sarah-d" });
    assert.equal(preview.status, 200, await preview.clone().text());
    (await pagesText(new Uint8Array(await preview.arrayBuffer()))).forEach((text, i) => assert.ok(hasNotice(text), `preview page ${i + 1}`));
  });

  test("a real clinic's PDF form: no notice anywhere, and its final row has no demo flag", async () => {
    const fileBase64 = await sampleBase64("northfield-rehab-progress");
    const report = reportOf(A, "rpt_real_render");
    const receipt = await sign("sam-a", report, northfieldOf(A), { name: "Sam Ward (fictional)", hcpc: "PH123456" });
    const res = await call(handleRender, "/render?format=original", { report: { ...report, status: "signed", receipt }, receipt, form: northfieldOf(A), fileBase64, requireFinal: true }, { member: "sam-a" });
    assert.equal(res.status, 200, await res.clone().text());
    for (const text of await pagesText(new Uint8Array(await res.arrayBuffer()))) assert.ok(!text.includes("made-up data"), "real clinic: no notice");
    const preview = await call(handleFormsFillPreview, "/forms/fill-preview", { report, form: northfieldOf(A), fileBase64, mode: "draft" }, { member: "sam-a" });
    for (const text of await pagesText(new Uint8Array(await preview.arrayBuffer()))) assert.ok(!text.includes("made-up data"));
    const finalRow = (await listAudit({ db }, A)).find((r) => r.action === "report.render_final" && r.targetId === report.id);
    assert.ok(finalRow);
    assert.equal(finalRow.detail?.demoClinic, undefined);
  });

  test("Word form: the demo clinic's final file carries the notice in its footers; a real clinic's does not", async () => {
    const fileBase64 = await sampleBase64("harrow-pike-treating-physio");
    for (const [member, tenantId, signer, expected] of [
      ["sarah-d", D, SARAH, true],
      ["sam-a", A, { name: "Sam Ward (fictional)", hcpc: "PH123456" }, false],
    ] as const) {
      const form = attested(HARROW_PIKE_FORM, tenantId);
      const report = reportOf(tenantId, `rpt_word_${tenantId}`, form);
      const receipt = await sign(member, report, form, signer);
      const res = await call(handleRender, "/render?format=original", { report: { ...report, status: "signed", receipt }, receipt, form, fileBase64, requireFinal: true }, { member });
      assert.equal(res.status, 200, await res.clone().text());
      assert.equal(docxFooters(new Uint8Array(await res.arrayBuffer())).includes("made-up data from a demo clinic. Not for clinical use."), expected, `${tenantId} Word footer`);
    }
  });

  test("a portal question set's summary PDF carries the notice in a demo clinic only", async () => {
    const bundle = getDemoBundle("megan-hart");
    for (const [member, tenantId, expected] of [
      ["sarah-d", D, true],
      ["sam-a", A, false],
    ] as const) {
      const parsed = parsePortalQuestions(EXAMPLE_PORTAL_QUESTIONS);
      const set = await createQuestionSet({ referrer: { name: "Northbridge Health Insurance (fictional)", type: "insurer" }, questions: parsed.questions, now: new Date("2026-10-09T10:00:00.000Z"), id: `form-portal-${tenantId}` });
      const form = attested(set, tenantId);
      const created = createFormReport({ form, bundle: { ...bundle, tenantId }, instructingParty: bundle.referral, computedFacts: computeFacts(bundle), now: new Date("2026-10-09T10:00:00.000Z") });
      const report: Report = { ...created, tenantId };
      const res = await call(handleRender, "/render?format=pdf", { report, form }, { member });
      assert.equal(res.status, 200, await res.clone().text());
      (await pagesText(new Uint8Array(await res.arrayBuffer()))).forEach((text, i) => assert.equal(hasNotice(text), expected, `${tenantId} summary page ${i + 1}`));
    }
  });

  test("a built-in report (PDF and Word) carries the notice in a demo clinic only", async () => {
    const template = BUILTIN_TEMPLATES[0];
    assert.ok(template, "a built-in template");
    const bundle = { ...getDemoBundle("megan-hart") };
    const builtIn = (tenantId: string): Report =>
      createReport({
        template,
        bundle: { ...bundle, tenantId },
        instructingParty: bundle.referral,
        computedFacts: computeFacts(bundle, { asOf: "2026-10-07" }),
        now: new Date("2026-10-07T09:00:00.000Z"),
        id: `rpt_builtin_${tenantId}`,
      });
    for (const [member, tenantId, expected] of [
      ["sarah-d", D, true],
      ["sam-a", A, false],
    ] as const) {
      const report = builtIn(tenantId);
      const pdf = await call(handleRender, "/render?format=pdf", { report }, { member });
      assert.equal(pdf.status, 200, await pdf.clone().text());
      (await pagesText(new Uint8Array(await pdf.arrayBuffer()))).forEach((text, i) => assert.equal(hasNotice(text), expected, `${tenantId} PDF page ${i + 1}`));
      const docx = await call(handleRender, "/render?format=docx", { report }, { member });
      assert.equal(docx.status, 200, await docx.clone().text());
      assert.equal(docxFooters(new Uint8Array(await docx.arrayBuffer())).includes("made-up data from a demo clinic. Not for clinical use."), expected, `${tenantId} Word footer`);
    }
  });
});
