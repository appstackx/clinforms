/**
 * The rollback shim (fix/schema-forward-compat; review finding R-regression-9; plan W0 "THE SHIM").
 *
 * release/bh-trial-2 writes new optional keys and new enum members into stored reports, approval receipts and form
 * maps (plan W0.3). This build – production e132057 plus the shim – must still read them if production is rolled
 * back: every key kept, the new flag codes / origins / record paths accepted, so the report's fingerprint, the
 * receipt's MAC and the map's attestation verify as issued, and a FINAL renders exactly as it does without them.
 * Writes stay strict. Records this build writes read exactly as before.
 *
 * The schema guard (last three tests) fails when the shim stops keeping a key or member the release writes
 * (forward-compat-fixture.ts RELEASE_KEYS / RELEASE_MEMBERS), when any stored object stops keeping unknown keys, and
 * when a change adds a member to an enum, literal or fill/anchor kind that production keeps closed
 * (fixtures/forward-compat/closed-vocabulary-e132057.json) – production could not read such a record.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { z } from "zod";

process.env.MEDREPORT_AI_MODE = "demo";

import { handleRender } from "../../src/modules/medreport/api/handlers/render";
import { handleSign } from "../../src/modules/medreport/api/handlers/sign";
import { bindHandler, type MedreportHandler } from "../../src/modules/medreport/api/http";
import type { MedreportDeps } from "../../src/modules/medreport/api/deps";
import { StoreReportResponseSchema } from "../../src/modules/medreport/api/store-contract";
import { createMemoryTenantStore } from "../../src/modules/medreport/api/store-memory";
import { formMapSha256, verifyFormConfirmation, withAttestedConfirmation } from "../../src/modules/medreport/auth/attestations";
import { createReceipt, verifyReceipt, verifyReceiptMac } from "../../src/modules/medreport/auth/sign-receipt";
import { signingKey } from "../../src/modules/medreport/config.server";
import { listRecordedFormAnalyses } from "../../src/modules/medreport/ai/recorded-forms";
import { computeFacts } from "../../src/modules/medreport/core/computed-facts";
import { canonicalize, reportFingerprint } from "../../src/modules/medreport/core/fingerprint";
import { FORM_ATTESTATIONS, formToTemplate, resolveRegistrationValue } from "../../src/modules/medreport/core/forms";
import { FLAG_CODE_LABELS, UNKNOWN_MEMBER_LABELS, flagCodeLabel, isKnownRegistrationPath, registrationPathLabel } from "../../src/modules/medreport/core/labels";
import { createFormReport, createReport } from "../../src/modules/medreport/core/report-factory";
import { FormDefinitionSchema, InstructingPartySchema, ReportSchema, SignReceiptSchema } from "../../src/modules/medreport/core/schemas";
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
    release: { form: relForm, report: signed(relDraft, await releaseReceipt(relDraft, input(relForm))) },
  };
}

async function harrowFileBase64(): Promise<string> {
  return Buffer.from(await getSampleForm(HARROW_PIKE_RAW.sampleId ?? "")!.loadFile()).toString("base64");
}

async function postDemo(handler: MedreportHandler, url: string, body: unknown): Promise<Response> {
  const headers = { "content-type": "application/json", authorization: `Bearer ${demoSessionToken()}` };
  return bindHandler(handler, () => ({}) as MedreportDeps)(
    new Request(`http://localhost/api/reports/v1${url}`, { method: "POST", headers, body: JSON.stringify(body) }),
    { params: {} },
  );
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
  assert.equal(ReportSchema.safeParse(release.report).success, false);
  assert.equal(FormDefinitionSchema.safeParse(release.form).success, false);
  const knownMembers = structuredClone(release.report);
  for (const s of knownMembers.sections) for (const p of s.paragraphs) p.origin = "clinician";
  knownMembers.flags = [];
  assert.notEqual(await reportFingerprint(ReportSchema.parse(knownMembers)), await reportFingerprint(knownMembers));
  const { mac, ...strictReceipt } = SignReceiptSchema.parse(receipt);
  assert.notEqual(macOf(strictReceipt), mac);
});

test("clinic Studio after a rollback: the store serves the release's report and map whole, the Studio reads them whole, and FINAL is byte-identical", async () => {
  const { store, f } = clinicStore();
  const { base, release } = await approvedPair(CLINIC);
  // As the release stored them.
  assert.equal((await store.createForm(CLINIC, formRow(release.form))).ok, true);
  assert.equal((await store.createReport(CLINIC, reportRow(release.report))).ok, true);

  // R-regression-9 scenario: GET /store/reports/{id} was 500 "The stored report could not be read".
  const raw = await f(`/api/reports/v1/store/reports/${release.report.id}`);
  assert.equal(raw.status, 200, await raw.clone().text());
  assert.deepEqual(StoreReportResponseSchema.parse(await raw.json()).report, release.report);
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
  const final = await render(read.report, readForm.form);
  assert.equal(final.status, 200, await final.clone().text());
  assert.equal(final.headers.get("x-medreport-render"), "final");
  assert.equal(final.headers.get("x-medreport-content-sha256"), release.report.receipt!.contentSha256);

  // The release's keys change nothing this build prints: the same report without them, approved by this build.
  const baseFinal = await render(base.report, base.form);
  assert.equal(baseFinal.headers.get("x-medreport-render"), "final", await baseFinal.clone().text());
  assert.deepEqual(new Uint8Array(await final.arrayBuffer()), new Uint8Array(await baseFinal.arrayBuffer()), "FINAL documents are byte-identical");
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
  const { f } = clinicStore();
  const { release } = await approvedPair(CLINIC);
  const draft: Report = { ...release.report, status: "draft" };
  delete draft.receipt;
  const put = (url: string, body: unknown) => f(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  assert.equal((await put(`/api/reports/v1/store/reports/${draft.id}`, { report: draft })).status, 422, "a new flag code / origin");
  assert.equal((await put(`/api/reports/v1/store/forms/${release.form.id}`, { form: release.form })).status, 422, "a new record path");

  // Members this build knows, keys it does not: stored as this build writes reports – without them.
  const known = structuredClone(draft);
  for (const s of known.sections) for (const p of s.paragraphs) p.origin = "clinician";
  known.flags = [];
  const created = await put(`/api/reports/v1/store/reports/${known.id}`, { report: known });
  assert.equal(created.status, 201, await created.clone().text());
  const stored = (await (await f(`/api/reports/v1/store/reports/${known.id}`)).json()).report as Record<string, unknown>;
  assert.equal("approver" in stored, false);
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
  const ok = await postDemo(handleSign, "/sign", body(knownDemo));
  assert.equal(ok.status, 200, await ok.clone().text());
  const { receipt } = (await ok.json()) as { receipt: SignReceipt };
  assert.equal(receipt.contentSha256, await reportFingerprint(ReportSchema.parse(knownDemo)), "signed as this build knows the report");
  assert.equal(receipt.formMapSha256, formMapSha256(demoForm), "over the map as stored");
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
  assert.equal(flagCodeLabel("DRAFT_FIT"), UNKNOWN_MEMBER_LABELS.flagCode);
  assert.equal(flagCodeLabel("OPEN_GAP"), FLAG_CODE_LABELS.OPEN_GAP);
  assert.equal(flagCodeLabel("constructor"), UNKNOWN_MEMBER_LABELS.flagCode);
  assert.equal(originLabel("staff" as never, "tm3-sim"), UNKNOWN_MEMBER_LABELS.paragraphOrigin);
  assert.equal(originLabel("ai", "tm3-sim").length > 0, true);
  assert.equal(isKnownRegistrationPath("episode.attendedDate"), false);
  assert.equal(registrationPathLabel("episode.attendedDate"), UNKNOWN_MEMBER_LABELS.registrationPath);
  assert.equal(registrationPathLabel("patient.dob"), "Date of birth");

  // A record path this build does not know is not held here: left blank for staff with a gap, never guessed.
  const bundle = getDemoBundle("megan-hart");
  const ctx = { bundle, instructingParty: InstructingPartySchema.parse(bundle.referral), computedFacts: computeFacts(bundle), reportDate: "2026-10-28" };
  for (const p of RELEASE_MEMBERS.registrationPaths) assert.equal(resolveRegistrationValue(p as RegistrationPath, ctx), null, p);
  const { release } = await approvedPair("demo");
  const fresh = createFormReport({ form: release.form, bundle, instructingParty: ctx.instructingParty, computedFacts: ctx.computedFacts, now: SIGNED_AT });
  const moved = release.form.fields.filter((fl) => fl.fillSource.kind === "registration" && !isKnownRegistrationPath(fl.fillSource.path));
  assert.equal(moved.length, 5);
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
    const nodes = objectNodes(planted);
    // A string: valid even inside a record of strings (a table answer's row).
    for (const { node } of nodes) node[PLANTED] = "kept";
    const parsed = schema.safeParse(planted);
    assert.ok(parsed.success, `${name}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 3))}`);
    const lost = objectNodes(parsed.data)
      .filter(({ node }) => node[PLANTED] !== "kept")
      .map(({ path: p }) => p);
    assert.deepEqual(lost, [], `${name}: these objects dropped a key they do not know`);
    assert.equal(objectNodes(parsed.data).length, nodes.length);
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
