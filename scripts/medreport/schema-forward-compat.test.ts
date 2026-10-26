/**
 * The rollback shim (fix/schema-forward-compat; review finding R-regression-9; plan W0 "THE SHIM").
 *
 * release/bh-trial-2 writes new optional keys and new enum members into stored reports, approval receipts and form
 * maps (plan W0.3). This build – production e132057 plus the shim – must still read them if production is rolled
 * back: every key kept, the new flag codes / origins / record paths accepted, so the report's fingerprint, the
 * receipt's MAC and the map's attestation verify as issued, and a FINAL renders exactly as it does without them.
 * Writes stay strict. Records this build writes read exactly as before.
 *
 * Every read path is exercised on its own (each request body and copy that carries a stored record), and what e132057
 * accepted keeps working: an API client's copy with keys of its own, and values no ClinForms build writes (JSON 1e400,
 * nesting deep enough to exhaust the stack) under a key this build does not know – checked as e132057 checked them,
 * never a 500.
 *
 * The schema guard (the three "guard:" tests) fails when the shim stops keeping a key or member the release writes
 * (forward-compat-fixture.ts RELEASE_KEYS / RELEASE_MEMBERS), when any stored object stops keeping unknown keys, and
 * when a change adds a member to an enum, literal or fill/anchor kind that production keeps closed
 * (fixtures/forward-compat/closed-vocabulary-e132057.json) – production could not read such a record.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import PizZip from "pizzip";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { z } from "zod";

process.env.MEDREPORT_AI_MODE = "demo";

import { route } from "../../src/app/api/_medreport-glue";
import { handleAiPayloadPreview } from "../../src/modules/medreport/api/handlers/ai-payload-preview";
import { handleDocuments } from "../../src/modules/medreport/api/handlers/documents";
import { handleDrafts } from "../../src/modules/medreport/api/handlers/drafts";
import { handleFormsFillPreview } from "../../src/modules/medreport/api/handlers/forms-fill-preview";
import { handleRender } from "../../src/modules/medreport/api/handlers/render";
import { handleSign } from "../../src/modules/medreport/api/handlers/sign";
import { handleValidate } from "../../src/modules/medreport/api/handlers/validate";
import { bindHandler, type MedreportHandler } from "../../src/modules/medreport/api/http";
import type { MedreportDeps } from "../../src/modules/medreport/api/deps";
import { StoreConflictSchema, StoreReportResponseSchema } from "../../src/modules/medreport/api/store-contract";
import { createMemoryTenantStore } from "../../src/modules/medreport/api/store-memory";
import { formMapMatches, formMapSha256, verifyFormConfirmation, withAttestedConfirmation } from "../../src/modules/medreport/auth/attestations";
import { createSessionToken } from "../../src/modules/medreport/auth/session-token";
import { createReceipt, readReportFingerprint, verifyReceipt, verifyReceiptMac } from "../../src/modules/medreport/auth/sign-receipt";
import { signingKey } from "../../src/modules/medreport/config.server";
import { listRecordedFormAnalyses } from "../../src/modules/medreport/ai/recorded-forms";
import { computeFacts } from "../../src/modules/medreport/core/computed-facts";
import { canonicalize, reportFingerprint } from "../../src/modules/medreport/core/fingerprint";
import { FORM_ATTESTATIONS, formTemplateId, formToTemplate, resolveRegistrationValue } from "../../src/modules/medreport/core/forms";
import { FLAG_CODE_LABELS, UNKNOWN_MEMBER_LABELS, flagCodeLabel, isKnownRegistrationPath, registrationPathLabel } from "../../src/modules/medreport/core/labels";
import { createFormReport, createReport } from "../../src/modules/medreport/core/report-factory";
import { FormDefinitionSchema, InstructingPartySchema, ParagraphOriginSchema, ReportSchema, SignReceiptSchema } from "../../src/modules/medreport/core/schemas";
import {
  FORWARD_OPEN_ENUMS,
  StoredFormDefinitionSchema,
  StoredReportSchema,
  StoredSignReceiptSchema,
} from "../../src/modules/medreport/core/stored-schemas";
import type { Clinician, FormDefinition, RegistrationPath, Report, SignReceipt } from "../../src/modules/medreport/core/types";
import { validateReport } from "../../src/modules/medreport/core/validation";
import { HARROW_PIKE_FORM as HARROW_PIKE_RAW } from "../../src/modules/medreport/forms/samples/maps/harrow-pike";
import { KINGSWAY_FORM } from "../../src/modules/medreport/forms/samples/maps/kingsway";
import { NORTHFIELD_FORM } from "../../src/modules/medreport/forms/samples/maps/northfield";
import { getSampleForm } from "../../src/modules/medreport/forms/samples/registry";
import { SOLICITOR_TEMPLATE_ID, getTemplate } from "../../src/modules/medreport/templates/registry";
import { originLabel } from "../../src/modules/medreport/ui/components/review/review-model";
import { useReviewActions, type ReviewActions } from "../../src/modules/medreport/ui/components/review/use-review-actions";
import { createServerApi } from "../../src/modules/medreport/ui/store/server-api";
import { getDemoBundle } from "./dev-bundles";
import { completedSampleReport } from "./form-sample-answers";
import {
  RELEASE_KEYS,
  RELEASE_MEMBERS,
  closedVocabulary,
  objectNodes,
  receiptFor,
  releaseForm,
  releaseReceipt,
  releaseReport,
  valuesAt,
} from "./forward-compat-fixture";
import { member, storeDeps, storeFetch } from "./store-harness";
import { demoSessionToken } from "./test-actors";

const SARAH: Clinician = { name: "Sarah Reid", hcpc: "PH-DEMO-01", role: "Senior Physiotherapist, MCSP" };
const SIGNED_AT = new Date("2026-10-28T11:00:00.000Z");
const CLINIC = "clinic-a";
const OPEN = new Set<z.ZodType>(FORWARD_OPEN_ENUMS);

/*
 * The same tests run on both lines: production (e132057 + this shim, main) and release/bh-trial-2, which knows the
 * W0.3 keys and members itself. "A member this build does not know" is therefore worked out from this build's own
 * write schemas and labels, and each strictness check also uses a LATER_* member that neither line knows (bh2-base).
 */
const LATER_PATH = "episode.laterReleasePath";
const LATER_CODE = "LATER_RELEASE_CHECK";
const LATER_ORIGIN = "later_release_origin";
const reportKnows = (key: string) => key in ReportSchema.shape;
const receiptKnows = (key: string) => key in SignReceiptSchema.shape;
const firstUnknown = (members: readonly string[], known: (m: string) => boolean, later: string) => members.find((m) => !known(m)) ?? later;

/** The same approved report and map twice: as this build writes them, and as the release writes them. */
async function approvedPair(tenantId: string) {
  const baseForm = withAttestedConfirmation({ ...HARROW_PIKE_RAW, tenantId }, "Practice manager", "2026-10-01T09:00:00.000Z");
  const baseDraft: Report = { ...completedSampleReport("megan-hart", baseForm, { id: "rpt_rollback" }), tenantId };
  const relForm = releaseForm(baseForm);
  const relDraft = releaseReport(baseDraft, formMapSha256(relForm));
  const input = (form: FormDefinition) => ({ signer: SARAH, attestations: FORM_ATTESTATIONS, formMapSha256: formMapSha256(form), now: SIGNED_AT });
  const signed = (report: Report, receipt: SignReceipt): Report => ({ ...report, status: "signed", receipt });
  return {
    base: { form: baseForm, report: signed(baseDraft, await receiptFor(baseDraft, input(baseForm))) },
    release: { form: relForm, report: signed(relDraft, await releaseReceipt(relDraft, input(relForm), { form: relForm, fileBase64: await harrowFileBase64() })) },
  };
}

async function harrowFileBase64(): Promise<string> {
  return Buffer.from(await getSampleForm(HARROW_PIKE_RAW.sampleId ?? "")!.loadFile()).toString("base64");
}

/** A public-demo call. A string `body` is sent as it is (JSON text JSON.stringify cannot write). */
async function postDemo(handler: MedreportHandler, url: string, body: unknown): Promise<Response> {
  const headers = { "content-type": "application/json", authorization: `Bearer ${demoSessionToken()}` };
  return bindHandler(handler, () => ({}) as MedreportDeps)(
    new Request(`http://localhost/api/reports/v1${url}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }),
    { params: {} },
  );
}

/** postDemo with the app's own dependencies (connectors, drafting); the simulated clinic system is called in-process. */
async function postGlue(handler: MedreportHandler, url: string, body: unknown, params: Record<string, string> = {}): Promise<Response> {
  const headers = { "content-type": "application/json", authorization: `Bearer ${demoSessionToken()}` };
  return route(handler)(
    new Request(`http://127.0.0.1:9/api/reports/v1${url}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }),
    { params },
  );
}

/** The write-back body for a FINAL /render response: its exact bytes, the approval's receipt and the server's file token. */
function writeBack(report: Report, receipt: SignReceipt, final: { bytes: Uint8Array; headers: Headers }) {
  const mimeType = (final.headers.get("content-type") ?? "").split(";")[0].trim();
  return {
    patientId: report.episodeRef.patientId,
    episodeId: report.episodeRef.episodeId,
    title: "Harrow & Pike form – Megan Hart",
    fileName: `Hart_M_Harrow-Pike_SIGNED.${mimeType === "application/pdf" ? "pdf" : "docx"}`,
    mimeType,
    contentBase64: Buffer.from(final.bytes).toString("base64"),
    sha256: createHash("sha256").update(final.bytes).digest("hex"),
    signReceipt: receipt,
    fileToken: final.headers.get("x-medreport-file-token"),
  };
}

function clinicStore() {
  const store = createMemoryTenantStore();
  const deps = storeDeps(store, { a: member(CLINIC) });
  return { store, f: storeFetch(deps, { member: "a" }) };
}

const reportRow = (r: Report) => ({ id: r.id, status: r.status, templateId: r.templateId, formId: r.form?.formId ?? null, payload: r });
const formRow = (form: FormDefinition) => ({
  id: form.id,
  status: form.status,
  title: form.title,
  referrer: form.referrer.name,
  kind: form.kind,
  fileSha256: form.file.sha256,
  sampleId: form.sampleId ?? null,
  payload: form,
});

/**
 * A response read once, whole: its bytes, and its text or JSON for messages and assertions. Never Response.clone() for
 * a message: a clone read early, with the original read after a long render, can lose the original's body to a garbage
 * collection in between ("Body is unusable").
 */
async function bodyOf(res: Response) {
  const bytes = new Uint8Array(await res.arrayBuffer());
  const text = () => Buffer.from(bytes).toString("utf8").slice(0, 2000);
  return { status: res.status, headers: res.headers, bytes, text, json: () => JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown };
}

/**
 * A Word file's parts (name → exact bytes). Two renders of the same content are identical part for part; their ZIP
 * containers differ only in the entry timestamps (a re-written part is stamped with the render time, to the 2 seconds
 * the ZIP format records), so raw container bytes differ when two renders straddle such a tick.
 */
function wordParts(bytes: Uint8Array): Record<string, string> {
  assert.equal(Buffer.from(bytes.subarray(0, 4)).toString("latin1"), "PK\x03\x04", "a Word file");
  const zip = new PizZip(bytes);
  return Object.fromEntries(
    Object.keys(zip.files)
      .sort()
      .map((name) => [name, zip.files[name].asBinary()]),
  );
}

const macOf = (receipt: Omit<SignReceipt, "mac">) => createHmac("sha256", signingKey("receipt")).update(canonicalize(receipt), "utf8").digest("base64url");

/* ------------------------------------------------------------------------------------------------
 * Reading what the release wrote
 * ----------------------------------------------------------------------------------------------*/

test("the stored read schemas keep every key and member the release writes: fingerprint, MAC and map attestation verify as issued", async () => {
  const { release } = await approvedPair("demo");
  const receipt = release.report.receipt!;

  const report = StoredReportSchema.parse(release.report);
  assert.deepEqual(report, release.report, "nothing dropped or changed");
  assert.equal(await reportFingerprint(report), receipt.contentSha256);
  assert.deepEqual(await verifyReceipt(report.receipt!, report), { ok: true, contentSha256: receipt.contentSha256 });
  assert.equal(verifyReceiptMac(report.receipt!), true);
  assert.deepEqual(StoredSignReceiptSchema.parse(receipt), receipt);

  const form = StoredFormDefinitionSchema.parse(release.form);
  assert.deepEqual(form, release.form);
  assert.equal(verifyFormConfirmation(form).ok, true, "the release's attestation of its map verifies");
  assert.equal(formMapSha256(form), receipt.formMapSha256, "the map the approval was given on");

  // Without the shim (R-regression-9): the strict schemas refuse the release's report and map outright, and even
  // with the new members taken out they drop the new keys – so neither the fingerprint nor the MAC would verify.
  // (On the release line, which knows the W0.3 record paths and receipt keys, the strict map parse and the receipt MAC
  // hold for those – the members and keys neither line knows still fail as on production.)
  assert.equal(ReportSchema.safeParse(release.report).success, false);
  assert.equal(FormDefinitionSchema.safeParse(release.form).success, RELEASE_MEMBERS.registrationPaths.every((p) => isKnownRegistrationPath(p)));
  const laterForm = structuredClone(release.form);
  (laterForm.fields.find((fl) => fl.fillSource.kind === "registration") as Record<string, unknown>).fillSource = { kind: "registration", path: LATER_PATH };
  assert.equal(FormDefinitionSchema.safeParse(laterForm).success, false, "a record path neither line knows");
  assert.equal(StoredFormDefinitionSchema.safeParse(laterForm).success, true, "…is read as stored");
  const knownMembers = structuredClone(release.report);
  for (const s of knownMembers.sections) for (const p of s.paragraphs) p.origin = "clinician";
  knownMembers.flags = [];
  assert.notEqual(await reportFingerprint(ReportSchema.parse(knownMembers)), await reportFingerprint(knownMembers));
  const { mac, ...strictReceipt } = SignReceiptSchema.parse(receipt);
  if (RELEASE_KEYS.receipt.every(receiptKnows)) assert.equal(macOf(strictReceipt), mac);
  else assert.notEqual(macOf(strictReceipt), mac);
});

test("clinic Studio after a rollback: the store serves the release's report and map whole, the Studio reads them whole, and FINAL is identical", async () => {
  const { store, f } = clinicStore();
  const { base, release } = await approvedPair(CLINIC);
  // As the release stored them.
  assert.equal((await store.createForm(CLINIC, formRow(release.form))).ok, true);
  assert.equal((await store.createReport(CLINIC, reportRow(release.report))).ok, true);

  // R-regression-9 scenario: GET /store/reports/{id} was 500 "The stored report could not be read".
  const raw = await bodyOf(await f(`/api/reports/v1/store/reports/${release.report.id}`));
  assert.equal(raw.status, 200, raw.text());
  assert.deepEqual(StoreReportResponseSchema.parse(raw.json()).report, release.report);
  const api = createServerApi(f);
  const read = await api.getReport(release.report.id);
  const readForm = await api.getForm(release.form.id);
  assert.ok(read && readForm);
  assert.deepEqual(read.report, release.report, "the Studio's copy keeps every key");
  assert.deepEqual(readForm.form, release.form);

  // FINAL from exactly what the Studio read.
  const fileBase64 = await harrowFileBase64();
  const render = (r: Report, form: FormDefinition) =>
    f("/api/reports/v1/render?format=original", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ report: r, receipt: r.receipt, form, fileBase64, requireFinal: true }),
    });
  const final = await bodyOf(await render(read.report, readForm.form));
  assert.equal(final.status, 200, final.text());
  assert.equal(final.headers.get("x-medreport-render"), "final");
  assert.equal(final.headers.get("x-medreport-content-sha256"), release.report.receipt!.contentSha256);

  // The release's keys change nothing this build prints: the same report without them, approved by this build.
  const baseFinal = await bodyOf(await render(base.report, base.form));
  assert.equal(baseFinal.headers.get("x-medreport-render"), "final", baseFinal.text());
  assert.equal(final.headers.get("content-type"), baseFinal.headers.get("content-type"));
  assert.deepEqual(wordParts(final.bytes), wordParts(baseFinal.bytes), "FINAL documents are identical, part for part, byte for byte");
});

test("public demo after a rollback: this browser's stored release report and map are listed and read whole", async () => {
  const { release } = await approvedPair("demo");
  const items = new Map<string, string>();
  const localStorage = {
    get length() {
      return items.size;
    },
    key: (i: number) => Array.from(items.keys())[i] ?? null,
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, String(v)),
    removeItem: (k: string) => void items.delete(k),
  };
  const g = globalThis as Record<string, unknown>;
  g.window = { localStorage, sessionStorage: localStorage, dispatchEvent: () => true };
  try {
    const browser = await import("../../src/modules/medreport/ui/store/browser-backend");
    localStorage.setItem(browser.REPORT_KEY_PREFIX + release.report.id, JSON.stringify(release.report));
    localStorage.setItem(browser.FORMS_KEY, JSON.stringify([release.form]));
    // Before the shim, listReports dropped it silently (R-regression-9).
    assert.deepEqual(browser.listReports(), [release.report]);
    assert.deepEqual(browser.getReport(release.report.id), release.report);
    assert.deepEqual(browser.getForm(release.form.id), release.form, "still confirmed: its attestation is intact");
  } finally {
    delete g.window;
  }
});

/* ------------------------------------------------------------------------------------------------
 * Writes stay strict; this build's own records are unchanged
 * ----------------------------------------------------------------------------------------------*/

test("writes stay strict: the store and /sign refuse members this build does not know, and keys it does not know are not signed or stored", async () => {
  const { f, store } = clinicStore();
  const { release } = await approvedPair(CLINIC);
  const draft: Report = { ...release.report, status: "draft" };
  delete draft.receipt;
  const put = (url: string, body: unknown) => f(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  assert.equal((await put(`/api/reports/v1/store/reports/${draft.id}`, { report: draft })).status, 422, "a new flag code / origin");
  const laterForm = structuredClone(release.form);
  (laterForm.fields.find((fl) => fl.fillSource.kind === "registration") as Record<string, unknown>).fillSource = { kind: "registration", path: LATER_PATH };
  assert.equal((await put(`/api/reports/v1/store/forms/${release.form.id}`, { form: laterForm })).status, 422, "a new record path");

  // Members this build knows, keys it does not: stored as this build writes reports – without them.
  const known = structuredClone(draft);
  for (const s of known.sections) for (const p of s.paragraphs) p.origin = "clinician";
  known.flags = [];
  // bh2 WC (check-WC problem 3, integrator grant): a create is checked like an update – every decision must be the
  // signed-in member's – and the release's draft holds several members' decisions, so it is stored as the release
  // stored it and PUT back unchanged (an update of that revision: what this build stores is what the PUT keeps).
  const seeded = await store.createReport(CLINIC, reportRow(known));
  assert.ok(seeded.ok);
  const created = await bodyOf(await f(`/api/reports/v1/store/reports/${known.id}`, { method: "PUT", headers: { "content-type": "application/json", "if-match": `"${seeded.ok ? seeded.rev : 0}"` }, body: JSON.stringify({ report: known }) }));
  assert.equal(created.status, 200, created.text());
  const stored = (await (await f(`/api/reports/v1/store/reports/${known.id}`)).json()).report as Record<string, unknown>;
  assert.equal("approver" in stored, reportKnows("approver"));
  // (bh2-base2: the release defines sections[].condition itself – markedNotApplicable is a key neither line knows.)
  assert.equal(stored.sections && (stored.sections as Array<Record<string, unknown>>).some((s) => "markedNotApplicable" in s), false, "a key neither line knows");
  assert.deepEqual(stored, ReportSchema.parse(known));

  // /sign: the report is strict (refused with a release member); the form map is read as stored.
  const demoDraft = { ...draft, tenantId: "demo" };
  const demoForm = withAttestedConfirmation({ ...release.form, tenantId: "demo" }, "Practice manager", "2026-10-28T10:00:00.000Z");
  const body = (report: Report) => ({ report, signer: SARAH, typedSignature: SARAH.name, statementAccepted: true, attestations: [...FORM_ATTESTATIONS], form: demoForm });
  const refused = await postDemo(handleSign, "/sign", body(demoDraft));
  assert.equal(refused.status, 422);
  const problem = (await refused.json()) as { code: string; issues: Array<{ path: string }> };
  assert.equal(problem.code, "VALIDATION_FAILED");
  assert.ok(problem.issues.length > 0 && problem.issues.every((i) => i.path.startsWith("report.")), JSON.stringify(problem.issues));
  const knownDemo = { ...known, tenantId: "demo" };
  const ok = await bodyOf(await postDemo(handleSign, "/sign", body(knownDemo)));
  assert.equal(ok.status, 200, ok.text());
  const { receipt } = ok.json() as { receipt: SignReceipt };
  assert.equal(receipt.contentSha256, await reportFingerprint(ReportSchema.parse(knownDemo)), "signed as this build knows the report");
  assert.equal(receipt.formMapSha256, formMapSha256(demoForm), "over the map as stored (its attested hash)");
});

test("records this build writes read exactly as before, and whatever verified before still verifies", async () => {
  const forms = [HARROW_PIKE_RAW, NORTHFIELD_FORM, KINGSWAY_FORM, ...listRecordedFormAnalyses().map((r) => r.form)].map((form) =>
    withAttestedConfirmation(form, "Practice manager", "2026-10-01T09:00:00.000Z"),
  );
  for (const form of forms) {
    assert.deepEqual(StoredFormDefinitionSchema.parse(form), FormDefinitionSchema.parse(form), form.id);
    assert.equal(formMapSha256(StoredFormDefinitionSchema.parse(form)), formMapSha256(FormDefinitionSchema.parse(form)), form.id);
  }
  const bundle = getDemoBundle("megan-hart");
  const party = InstructingPartySchema.parse(bundle.referral);
  const reports: Report[] = [
    completedSampleReport("megan-hart", forms[0]),
    completedSampleReport("megan-hart", forms[1]),
    completedSampleReport("daniel-brooks", forms[2]),
    createReport({ template: getTemplate(SOLICITOR_TEMPLATE_ID)!, bundle, instructingParty: party, computedFacts: computeFacts(bundle) }),
  ];
  for (const report of reports) {
    const receipt = await createReceipt({ report, signer: SARAH, statementAccepted: true, attestations: ["Checked."], now: SIGNED_AT });
    const signed: Report = { ...report, status: "signed", receipt };
    assert.deepEqual(StoredReportSchema.parse(signed), ReportSchema.parse(signed), report.id);
    assert.deepEqual(StoredSignReceiptSchema.parse(receipt), SignReceiptSchema.parse(receipt));
    assert.deepEqual(await verifyReceipt(receipt, StoredReportSchema.parse(signed)), { ok: true, contentSha256: receipt.contentSha256 });
  }

  // Before the shim, keys this build does not know were left out before hashing (callers have passed a referral
  // with its extra details as the instructing party): such an approval still verifies, as it did.
  const wide = createFormReport({ form: forms[0], bundle, instructingParty: bundle.referral, computedFacts: computeFacts(bundle), now: SIGNED_AT });
  assert.ok("referralDate" in wide.instructingParty);
  const receipt = await createReceipt({ report: ReportSchema.parse(wide), signer: SARAH, statementAccepted: true, attestations: ["Checked."], now: SIGNED_AT });
  assert.deepEqual(await verifyReceipt(receipt, StoredReportSchema.parse(wide)), { ok: true, contentSha256: receipt.contentSha256 });
  const edited = structuredClone(wide);
  edited.sections[0].paragraphs = [{ id: "x", text: "Changed.", sourceIds: [], origin: "clinician" }];
  assert.deepEqual(await verifyReceipt(receipt, edited), { ok: false, reason: "HASH_MISMATCH" }, "an edit is still caught");
});

test("members this build does not know get a generic label and are never acted on; what it cannot fill is still refused", async () => {
  const knownCode = (c: string) => Object.prototype.hasOwnProperty.call(FLAG_CODE_LABELS, c);
  assert.equal(flagCodeLabel(firstUnknown(RELEASE_MEMBERS.flagCodes, knownCode, LATER_CODE)), UNKNOWN_MEMBER_LABELS.flagCode);
  assert.equal(flagCodeLabel(LATER_CODE), UNKNOWN_MEMBER_LABELS.flagCode);
  assert.equal(flagCodeLabel("OPEN_GAP"), FLAG_CODE_LABELS.OPEN_GAP);
  assert.equal(flagCodeLabel("constructor"), UNKNOWN_MEMBER_LABELS.flagCode);
  const knownOrigin = (o: string) => (ParagraphOriginSchema.options as readonly string[]).includes(o);
  assert.equal(originLabel(firstUnknown(RELEASE_MEMBERS.paragraphOrigins, knownOrigin, LATER_ORIGIN) as never, "tm3-sim"), UNKNOWN_MEMBER_LABELS.paragraphOrigin);
  assert.equal(originLabel(LATER_ORIGIN as never, "tm3-sim"), UNKNOWN_MEMBER_LABELS.paragraphOrigin);
  assert.equal(originLabel("ai", "tm3-sim").length > 0, true);
  const unknownPath = firstUnknown(RELEASE_MEMBERS.registrationPaths, isKnownRegistrationPath, LATER_PATH);
  assert.equal(isKnownRegistrationPath(unknownPath), false);
  assert.equal(registrationPathLabel(unknownPath), UNKNOWN_MEMBER_LABELS.registrationPath);
  assert.equal(registrationPathLabel("patient.dob"), "Date of birth");

  // A record path this build does not know is not held here: left blank for staff with a gap, never guessed.
  const bundle = getDemoBundle("megan-hart");
  const ctx = { bundle, instructingParty: InstructingPartySchema.parse(bundle.referral), computedFacts: computeFacts(bundle), reportDate: "2026-10-28" };
  for (const p of [...RELEASE_MEMBERS.registrationPaths.filter((x) => !isKnownRegistrationPath(x)), LATER_PATH]) {
    assert.equal(resolveRegistrationValue(p as RegistrationPath, ctx), null, p);
  }
  const { release } = await approvedPair("demo");
  // The release's map, plus one record path neither line knows (read as stored).
  const readForm = StoredFormDefinitionSchema.parse(release.form) as FormDefinition;
  const releasePaths = RELEASE_MEMBERS.registrationPaths as readonly string[];
  const unknownReleaseFields = readForm.fields.filter((fl) => fl.fillSource.kind === "registration" && !isKnownRegistrationPath(fl.fillSource.path)).length;
  // Production does not know the release's 4 paths (5 fields); the release line does.
  assert.equal(unknownReleaseFields, releasePaths.every((p) => isKnownRegistrationPath(p)) ? 0 : 5);
  const later = readForm.fields.find((fl) => fl.fillSource.kind === "registration" && !releasePaths.includes(fl.fillSource.path))!;
  (later as Record<string, unknown>).fillSource = { kind: "registration", path: LATER_PATH };
  const fresh = createFormReport({ form: readForm, bundle, instructingParty: ctx.instructingParty, computedFacts: ctx.computedFacts, now: SIGNED_AT });
  const moved = readForm.fields.filter((fl) => fl.fillSource.kind === "registration" && !isKnownRegistrationPath(fl.fillSource.path));
  assert.equal(moved.length, unknownReleaseFields + 1);
  for (const fl of moved) {
    assert.equal(fresh.sections.find((s) => s.key === fl.id)?.status, "needs_input", fl.id);
    assert.ok(fresh.gaps.some((g) => g.sectionKey === fl.id && !g.resolution), fl.id);
  }

  // The validators recompute flags with this build's codes only; the release's report still validates.
  const result = validateReport({ ...release.report, status: "draft" }, formToTemplate(release.form), { form: release.form });
  assert.equal(result.canSign, true, JSON.stringify(result.blocking));
  assert.ok(result.flags.every((fl) => fl.code in FLAG_CODE_LABELS));

  // Still refused: a fill or anchor kind this build cannot write, bounds, and session lines beyond 30.
  const broken = (edit: (form: Record<string, unknown> & FormDefinition) => void) => {
    const form = structuredClone(release.form) as Record<string, unknown> & FormDefinition;
    edit(form);
    return StoredFormDefinitionSchema.safeParse(form).success;
  };
  assert.equal(broken(() => undefined), true);
  assert.equal(broken((fm) => void ((fm.fields[0] as Record<string, unknown>).fillSource = { kind: "physio_choice" })), false);
  assert.equal(broken((fm) => void ((fm.fields[0] as Record<string, unknown>).anchor = { kind: "pdf_signature", page: 1 })), false);
  assert.equal(broken((fm) => void ((fm.fields[1] as Record<string, unknown>).fillSource = { kind: "registration", path: "episode.attendedDate", part: { index: 1, of: 31 } })), false);
  assert.equal(broken((fm) => void (fm.fields[0].answerType = "drawing" as never)), false);
  assert.equal(broken((fm) => void (fm.fields[0].label = "")), false);
  assert.equal(StoredReportSchema.safeParse({ ...release.report, status: "superseded" }).success, false, "statuses stay closed");
  assert.equal(StoredReportSchema.safeParse({ ...release.report, flags: [{ ...release.report.flags[0], code: "X".repeat(81) }] }).success, false);
});

/* ------------------------------------------------------------------------------------------------
 * The schema guard
 * ----------------------------------------------------------------------------------------------*/

test("guard: every key and member the release writes (RELEASE_KEYS / RELEASE_MEMBERS) is in the fixture and kept by the shim's read", async () => {
  const { release } = await approvedPair("demo");
  const records = {
    report: [release.report, StoredReportSchema.parse(release.report)],
    receipt: [release.report.receipt, StoredSignReceiptSchema.parse(release.report.receipt)],
    form: [release.form, StoredFormDefinitionSchema.parse(release.form)],
  } as const;
  for (const [kind, keys] of Object.entries(RELEASE_KEYS) as Array<[keyof typeof records, readonly string[]]>) {
    const [written, read] = records[kind];
    for (const key of keys) {
      const values = valuesAt(written, key);
      assert.ok(values.length > 0, `${kind}.${key}: the fixture must hold it`);
      assert.deepEqual(valuesAt(read, key), values, `${kind}.${key}: the shim keeps it`);
    }
  }
  const [, report] = records.report;
  const [, form] = records.form;
  assert.deepEqual(Array.from(new Set(report.flags.map((fl) => fl.code as string))).sort(), [...RELEASE_MEMBERS.flagCodes].sort());
  const origins = new Set(report.sections.flatMap((s) => s.paragraphs.map((p) => p.origin as string)));
  for (const o of RELEASE_MEMBERS.paragraphOrigins) assert.ok(origins.has(o), o);
  const paths = new Set(form.fields.flatMap((fl) => (fl.fillSource.kind === "registration" ? [fl.fillSource.path as string] : [])));
  for (const p of RELEASE_MEMBERS.registrationPaths) assert.ok(paths.has(p), p);
  const gapKinds = new Set(report.gaps.map((g) => (g as Record<string, unknown>).kind));
  for (const k of RELEASE_MEMBERS.gapKinds) assert.ok(gapKinds.has(k), k);
  // bh2-base2: the members of the release's new keys (who may acknowledge a flag; what the approver confirmed at /sign).
  const policies = new Set(report.flags.map((fl) => (fl as Record<string, unknown>).ackPolicy));
  for (const a of RELEASE_MEMBERS.ackPolicies) assert.ok(policies.has(a), a);
  const confirmations = valuesAt(records.receipt[1], "signerConfirmations").flatMap((list) => (list as Array<Record<string, unknown>>).map((c) => c.kind));
  for (const k of RELEASE_MEMBERS.signerConfirmationKinds) assert.ok(confirmations.includes(k), k);
  // bh2-rc1: the one-click fix kinds (Paragraph.fixes – a new key) and the report activity codes (an open string).
  const fixKinds = new Set(valuesAt(report, "sections[].paragraphs[].fixes[].kind"));
  for (const k of RELEASE_MEMBERS.fixKinds) assert.ok(fixKinds.has(k), k);
  const actions = new Set(report.activity.map((a) => a.action as string));
  for (const a of RELEASE_MEMBERS.activityActions) assert.ok(actions.has(a), a);
  // The release's attendance lines: up to 30.
  assert.ok(form.fields.some((fl) => fl.fillSource.kind === "registration" && fl.fillSource.part?.of === 30));
});

test("guard: a key a later release adds anywhere is kept – one planted in every object of the stored report, receipt and map", async () => {
  const { release } = await approvedPair("demo");
  const PLANTED = "__later_release_key__";
  const cases: Array<[string, unknown, z.ZodType]> = [
    ["report", release.report, StoredReportSchema],
    ["receipt", release.report.receipt, StoredSignReceiptSchema],
    ["form", release.form, StoredFormDefinitionSchema],
  ];
  for (const [name, record, schema] of cases) {
    const planted = structuredClone(record);
    // A record keyed by form field ids (the release's analysis.printedLeads) holds data keys, not schema keys: a later
    // release adds nothing there but field ids, so it is not planted in (bh2-base).
    const nodes = objectNodes(planted).filter(({ path: p }) => !/\.printedLeads$/.test(p));
    // A string: valid even inside a record of strings (a table answer's row).
    for (const { node } of nodes) node[PLANTED] = "kept";
    const parsed = schema.safeParse(planted);
    assert.ok(parsed.success, `${name}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 3))}`);
    const lost = objectNodes(parsed.data)
      .filter(({ path: p }) => !/\.printedLeads$/.test(p))
      .filter(({ node }) => node[PLANTED] !== "kept")
      .map(({ path: p }) => p);
    assert.deepEqual(lost, [], `${name}: these objects dropped a key they do not know`);
    assert.equal(objectNodes(parsed.data).filter(({ path: p }) => !/\.printedLeads$/.test(p)).length, nodes.length);
  }
});

test("guard: production keeps these enums, literals and kinds closed – adding a member needs a new shim on main first", () => {
  const snapshot = JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures/forward-compat/closed-vocabulary-e132057.json"), "utf8"),
  ) as Record<string, Record<string, string[]>>;
  const current = {
    report: closedVocabulary(ReportSchema, OPEN),
    receipt: closedVocabulary(SignReceiptSchema, OPEN),
    form: closedVocabulary(FormDefinitionSchema, OPEN),
  };
  const unreadable: string[] = [];
  for (const [kind, vocabulary] of Object.entries(current)) {
    for (const [at, members] of Object.entries(vocabulary)) {
      const known = snapshot[kind][at];
      if (!known) continue; // a new key: production keeps it whole, whatever it holds
      for (const m of members) if (!known.includes(m)) unreadable.push(`${kind}${at} = ${m}`);
    }
  }
  assert.deepEqual(unreadable, [], "production (e132057 + the shim) cannot read these members");
});

/* ------------------------------------------------------------------------------------------------
 * Every read path, one by one: each request body and copy that carries a stored record
 * ----------------------------------------------------------------------------------------------*/

test("read paths: the store's 409 copy, /validate, /forms/fill-preview, the write-back receipt, /drafts and /ai/payload-preview take what the release stored", async () => {
  // 409 REV_CONFLICT: the stored copy the Studio reloads is the release's, whole (also through StoreConflictSchema).
  const { store, f } = clinicStore();
  const clinic = await approvedPair(CLINIC);
  assert.equal((await store.createReport(CLINIC, reportRow(clinic.release.report))).ok, true);
  assert.equal((await store.createForm(CLINIC, formRow(clinic.release.form))).ok, true);
  const put = async (url: string, body: unknown) =>
    bodyOf(await f(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  const ownDraft: Report = { ...clinic.base.report, status: "draft" };
  delete ownDraft.receipt;
  const reportConflict = await put(`/api/reports/v1/store/reports/${clinic.release.report.id}`, { report: ownDraft });
  assert.equal(reportConflict.status, 409, reportConflict.text());
  assert.deepEqual(StoreConflictSchema.parse(reportConflict.json()).current?.report, clinic.release.report, "the report's 409 copy keeps every key and member");
  const formConflict = await put(`/api/reports/v1/store/forms/${clinic.release.form.id}`, { form: clinic.base.form });
  assert.equal(formConflict.status, 409, formConflict.text());
  assert.deepEqual(StoreConflictSchema.parse(formConflict.json()).current?.form, clinic.release.form, "the map's 409 copy keeps every key and member");

  const { release } = await approvedPair("demo");
  const draft: Report = { ...release.report, status: "draft" };
  delete draft.receipt;
  const fileBase64 = await harrowFileBase64();

  const validated = await bodyOf(await postDemo(handleValidate, "/validate", { report: release.report, form: release.form }));
  assert.equal(validated.status, 200, validated.text());
  assert.equal((validated.json() as { canSign: boolean }).canSign, true);

  const preview = await bodyOf(await postDemo(handleFormsFillPreview, "/forms/fill-preview", { report: draft, form: release.form, fileBase64, mode: "draft" }));
  assert.equal(preview.status, 200, preview.text());
  assert.equal(preview.headers.get("x-medreport-render"), "draft");

  // The write-back: the release's receipt (MAC over its own keys) files the FINAL the server issued for it.
  const final = await bodyOf(
    await postDemo(handleRender, "/render?format=original", { report: release.report, receipt: release.report.receipt, form: release.form, fileBase64, requireFinal: true }),
  );
  assert.equal(final.headers.get("x-medreport-render"), "final", final.text());
  const filed = await bodyOf(await postGlue(handleDocuments, "/connectors/tm3-sim/documents", writeBack(release.report, release.report.receipt!, final), { id: "tm3-sim" }));
  assert.equal(filed.status, 201, filed.text());

  // The release's map behind drafting and the payload preview: its attestation verifies, so neither refuses it.
  const bundle = getDemoBundle("megan-hart");
  const drafting = { templateId: formTemplateId(release.form.id), bundle, instructingParty: InstructingPartySchema.parse(bundle.referral), form: release.form };
  const draftable = release.form.fields.find((fl) => fl.fillSource.kind === "notes_narrative");
  assert.ok(draftable);
  const drafted = await bodyOf(await postGlue(handleDrafts, "/drafts", { ...drafting, sectionKeys: [draftable.id], prefer: "demo" }));
  assert.equal(drafted.status, 200, drafted.text());
  const payload = await bodyOf(await postGlue(handleAiPayloadPreview, "/ai/payload-preview", drafting));
  assert.equal(payload.status, 200, payload.text());
});

test("whatever verified before still verifies: a receipt this build issued, with keys an API client added, passes on its known keys", async () => {
  const { base } = await approvedPair("demo");
  const receipt = base.report.receipt!;
  const widened = { ...structuredClone(receipt), partnerRef: "PX-12", signer: { ...receipt.signer, partnerSignerId: "s-9" } } as SignReceipt;
  // e132057 left these keys out before checking the MAC: as read the MAC cannot match, the pre-shim check does.
  assert.equal(verifyReceiptMac(widened), true);
  assert.equal(verifyReceiptMac(widened, { tenantId: "demo" }), true);
  assert.deepEqual(await verifyReceipt(widened, base.report), { ok: true, contentSha256: receipt.contentSha256 });
  // Never a forgery: a changed known key fails either way.
  assert.equal(verifyReceiptMac({ ...widened, signedAt: "2026-10-29T11:00:00.000Z" }), false);
  assert.deepEqual(await verifyReceipt({ ...widened, signer: { ...widened.signer, name: "Someone Else" } }, base.report), { ok: false, reason: "BAD_MAC" });
});

test("the Studio approves the report as /sign signs it: keys a later release wrote into the draft are neither sent nor kept", async () => {
  const { release } = await approvedPair("demo");
  const draft = structuredClone({ ...release.report, status: "draft" as const }) as Report;
  delete draft.receipt;
  for (const s of draft.sections) for (const p of s.paragraphs) p.origin = "clinician";
  draft.flags = [];
  assert.ok("approver" in draft, "the draft holds the release's keys");

  const signBodies: Array<{ report: Report }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), "http://localhost");
    if (url.pathname === "/api/reports/v1/sessions/demo") return Response.json({ session: createSessionToken({ tenantId: "demo", kind: "demo" }) }, { status: 201 });
    if (url.pathname === "/api/reports/v1/sign") {
      signBodies.push(JSON.parse(String(init?.body)) as { report: Report });
      const request = new Request(url.href, { method: "POST", headers: init?.headers, body: init?.body });
      return bindHandler(handleSign, () => ({}) as MedreportDeps)(request, { params: {} });
    }
    throw new Error(`unexpected request ${url.pathname}`);
  }) as typeof fetch;
  const committed: Report[] = [];
  try {
    let actions: ReviewActions | null = null;
    const Probe = () => {
      actions = useReviewActions({
        report: draft,
        form: release.form,
        template: formToTemplate(release.form),
        file: { status: "none" },
        actor: { memberId: "mem_sarah", name: SARAH.name, role: "clinician", canSign: true, hcpc: "PH-DEMO-01" },
        hooks: {},
        dispatch: () => undefined,
        commit: (next) => {
          committed.push(next);
          return true;
        },
        validateNow: () => draft,
        toast: () => undefined,
      });
      return null;
    };
    renderToStaticMarkup(createElement(Probe));
    assert.ok(actions);
    const result = await (actions as ReviewActions).approve({ signer: SARAH, typedSignature: SARAH.name, statementAccepted: true, attestations: [...FORM_ATTESTATIONS] });
    assert.deepEqual(result, { ok: true });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(signBodies.length, 1);
  assert.deepEqual(signBodies[0].report, ReportSchema.parse(draft), "sent as this build knows it");
  assert.equal(committed.length, 1);
  const approved = committed[0];
  assert.equal("approver" in approved, reportKnows("approver"), "the kept approval is the signed shape");
  // (bh2-base2: the release defines sections[].condition itself – markedNotApplicable is a key neither line knows.)
  assert.equal(approved.sections.some((s) => "markedNotApplicable" in s), false, "a key neither line knows is not kept");
  assert.equal(approved.status, "signed");
  assert.equal(await reportFingerprint(approved), approved.receipt!.contentSha256, "the kept copy is exactly what the receipt covers");
});

/* ------------------------------------------------------------------------------------------------
 * What e132057 accepted keeps working: an API client's map with a key of its own, a FINAL's content hash
 * ----------------------------------------------------------------------------------------------*/

test("an API client's map with a key of its own in a field: /validate, /sign, the FINAL and the fill preview behave as on e132057", async () => {
  const form = withAttestedConfirmation({ ...HARROW_PIKE_RAW, tenantId: "demo" }, "Practice manager", "2026-10-01T09:00:00.000Z");
  const report: Report = { ...completedSampleReport("megan-hart", form, { id: "rpt_partner_map" }), tenantId: "demo" };
  const annotated = structuredClone(form);
  (annotated.fields[0] as Record<string, unknown> & FormDefinition["fields"][number]).partnerNote = "kept by an API client";
  // As read the map hashes differently; as this build knows it (the key left out, as e132057 hashed it) it is the
  // attested map.
  const attested = form.confirmed!.mapSha256!;
  assert.notEqual(formMapSha256(annotated), attested);
  assert.equal(formMapMatches(annotated, attested), true);
  assert.deepEqual(verifyFormConfirmation(annotated), { ok: true, mapSha256: attested });
  const changed = structuredClone(annotated);
  changed.fields[0].label = `${changed.fields[0].label} (changed)`;
  assert.equal(formMapMatches(changed, attested), false, "a change to a key this build knows is still caught");
  assert.equal(verifyFormConfirmation(changed).ok, false);

  const validated = await bodyOf(await postDemo(handleValidate, "/validate", { report, form: annotated }));
  assert.equal(validated.status, 200, validated.text());
  const signed = await bodyOf(
    await postDemo(handleSign, "/sign", { report, signer: SARAH, typedSignature: SARAH.name, statementAccepted: true, attestations: [...FORM_ATTESTATIONS], form: annotated }),
  );
  assert.equal(signed.status, 200, signed.text());
  const { receipt } = signed.json() as { receipt: SignReceipt };
  assert.equal(receipt.formMapSha256, attested, "the receipt records the attested map, as e132057 did");

  const fileBase64 = await harrowFileBase64();
  for (const [label, map] of [["annotated", annotated], ["clean", form]] as const) {
    const final = await bodyOf(
      await postDemo(handleRender, "/render?format=original", { report: { ...report, status: "signed", receipt }, receipt, form: map, fileBase64, requireFinal: true }),
    );
    assert.equal(final.status, 200, `${label}: ${final.text()}`);
    assert.equal(final.headers.get("x-medreport-render"), "final", label);
  }
  const preview = await bodyOf(await postDemo(handleFormsFillPreview, "/forms/fill-preview", { report, form: annotated, fileBase64, mode: "draft" }));
  assert.equal(preview.status, 200, preview.text());
});

test("a FINAL's x-medreport-content-sha256 is the receipt's hash, also when the receipt verified as this build knows the report", async () => {
  const form = withAttestedConfirmation({ ...HARROW_PIKE_RAW, tenantId: "demo" }, "Practice manager", "2026-10-01T09:00:00.000Z");
  const plain: Report = { ...completedSampleReport("megan-hart", form, { id: "rpt_wide_party" }), tenantId: "demo" };
  // A partner-style instructing party carrying a referral's extra details (as rtf-forms / question-set-api send it).
  const wide = { ...plain, instructingParty: { ...plain.instructingParty, referralDate: "2026-03-10", reason: "Neck pain after a collision." } } as Report;
  const receipt = await createReceipt({
    report: ReportSchema.parse(wide),
    signer: SARAH,
    statementAccepted: true,
    attestations: [...FORM_ATTESTATIONS],
    formMapSha256: formMapSha256(form),
    now: SIGNED_AT,
  });
  assert.notEqual(await reportFingerprint(wide), receipt.contentSha256, "the receipt covers the report as this build knows it");
  const fileBase64 = await harrowFileBase64();
  const final = await bodyOf(await postDemo(handleRender, "/render?format=original", { report: { ...wide, status: "signed", receipt }, receipt, form, fileBase64, requireFinal: true }));
  assert.equal(final.headers.get("x-medreport-render"), "final", final.text());
  assert.equal(final.headers.get("x-medreport-content-sha256"), receipt.contentSha256);
  // A draft's header is the report's fingerprint as read.
  const draft = await bodyOf(await postDemo(handleRender, "/render?format=original", { report: wide, form, fileBase64 }));
  assert.equal(draft.headers.get("x-medreport-render"), "draft", draft.text());
  assert.equal(draft.headers.get("x-medreport-content-sha256"), await reportFingerprint(wide));
});

/* ------------------------------------------------------------------------------------------------
 * Values no ClinForms build writes, under a key this build does not know
 * ----------------------------------------------------------------------------------------------*/

/** JSON text with `"<key>":<value>` inserted right after the first `marker` (ending in "{"): values JSON.stringify cannot write. */
function withRaw(json: string, marker: string, key: string, value: string): string {
  const at = json.indexOf(marker);
  assert.ok(at >= 0, marker);
  const end = at + marker.length;
  return `${json.slice(0, end)}"${key}":${value},${json.slice(end)}`;
}

test("a value canonicalize cannot write (JSON 1e400, nesting deep enough to exhaust the stack) under a key this build does not know: checked as e132057 checked it, never a 500", async () => {
  const { base } = await approvedPair("demo");
  const receipt = base.report.receipt!;
  const draftReport: Report = { ...base.report, status: "draft" };
  delete draftReport.receipt;
  const fileBase64 = await harrowFileBase64();
  const bundle = getDemoBundle("megan-hart");
  const draftable = base.form.fields.find((fl) => fl.fillSource.kind === "notes_narrative")!.id;
  const DEEP = "[".repeat(200_000) + "]".repeat(200_000);
  for (const [label, value] of [["1e400", "1e400"], ["deep", DEEP]] as const) {
    // The verify functions answer: as read the MAC / hash cannot be computed; as this build knows the record, it verifies.
    const oddReceipt = StoredSignReceiptSchema.parse(JSON.parse(withRaw(JSON.stringify(receipt), "{", "zzz", value)));
    const oddReport = StoredReportSchema.parse(JSON.parse(withRaw(JSON.stringify(base.report), "{", "zzz", value)));
    const oddForm = StoredFormDefinitionSchema.parse(JSON.parse(withRaw(JSON.stringify(base.form), '"fields":[{', "zzz", value)));
    assert.equal(verifyReceiptMac(oddReceipt), true, label);
    assert.deepEqual(await verifyReceipt(oddReceipt, oddReport), { ok: true, contentSha256: receipt.contentSha256 }, label);
    assert.equal(await readReportFingerprint(oddReport), receipt.contentSha256, label);
    assert.deepEqual(verifyFormConfirmation(oddForm), { ok: true, mapSha256: base.form.confirmed!.mapSha256 }, label);

    // Over HTTP: what e132057 answered (it left the key out), never 500.
    const draft = await bodyOf(await postDemo(handleRender, "/render?format=original", withRaw(JSON.stringify({ report: draftReport, form: base.form, fileBase64 }), '{"report":{', "zzz", value)));
    assert.equal(draft.status, 200, `${label}: ${draft.text()}`);
    assert.equal(draft.headers.get("x-medreport-content-sha256"), receipt.contentSha256, label);
    const finalBody = JSON.stringify({ receipt, report: base.report, form: base.form, fileBase64, requireFinal: true });
    const final = await bodyOf(await postDemo(handleRender, "/render?format=original", withRaw(finalBody, '{"receipt":{', "zzz", value)));
    assert.equal(final.headers.get("x-medreport-render"), "final", `${label}: ${final.text()}`);
    assert.equal(final.headers.get("x-medreport-content-sha256"), receipt.contentSha256, label);
    const validated = await bodyOf(await postDemo(handleValidate, "/validate", withRaw(JSON.stringify({ report: draftReport, form: base.form }), '"fields":[{', "zzz", value)));
    assert.equal(validated.status, 200, `${label}: ${validated.text()}`);
    const signedText = withRaw(
      JSON.stringify({ form: base.form, report: draftReport, signer: SARAH, typedSignature: SARAH.name, statementAccepted: true, attestations: [...FORM_ATTESTATIONS] }),
      '"fields":[{',
      "zzz",
      value,
    );
    const signed = await bodyOf(await postDemo(handleSign, "/sign", signedText));
    assert.equal(signed.status, 200, `${label}: ${signed.text()}`);
    assert.equal((signed.json() as { receipt: SignReceipt }).receipt.formMapSha256, base.form.confirmed!.mapSha256, label);
    const filedText = withRaw(JSON.stringify(writeBack(base.report, receipt, final)), '"signReceipt":{', "zzz", value);
    const filed = await bodyOf(await postGlue(handleDocuments, "/connectors/tm3-sim/documents", filedText, { id: "tm3-sim" }));
    assert.equal(filed.status, 201, `${label}: ${filed.text()}`);
    const previewText = withRaw(JSON.stringify({ form: base.form, report: draftReport, fileBase64, mode: "draft" }), '"fields":[{', "zzz", value);
    const preview = await bodyOf(await postDemo(handleFormsFillPreview, "/forms/fill-preview", withRaw(previewText, '"report":{', "zzz", value)));
    assert.equal(preview.status, 200, `${label}: ${preview.text()}`);
    const drafting = { form: base.form, templateId: formTemplateId(base.form.id), bundle, instructingParty: InstructingPartySchema.parse(bundle.referral) };
    const drafted = await bodyOf(await postGlue(handleDrafts, "/drafts", withRaw(JSON.stringify({ ...drafting, sectionKeys: [draftable], prefer: "demo" }), '"fields":[{', "zzz", value)));
    assert.equal(drafted.status, 200, `${label}: ${drafted.text()}`);
    const payload = await bodyOf(await postGlue(handleAiPayloadPreview, "/ai/payload-preview", withRaw(JSON.stringify(drafting), '"fields":[{', "zzz", value)));
    assert.equal(payload.status, 200, `${label}: ${payload.text()}`);
  }

  // A report e132057 refused outright (a member it does not know) that also holds such a value: refused, never 500.
  const { release } = await approvedPair("demo");
  const releaseDraft: Report = { ...release.report, status: "draft" };
  delete releaseDraft.receipt;
  const refused = await bodyOf(
    await postDemo(handleRender, "/render?format=original", withRaw(JSON.stringify({ report: releaseDraft, form: release.form, fileBase64 }), '{"report":{', "zzz", "1e400")),
  );
  assert.equal(refused.status, 422, refused.text());
  assert.equal((refused.json() as { code: string }).code, "VALIDATION_FAILED");
});
