/**
 * bh2 W0 follow-up (bh2-base2): the remaining shared definitions the workstream designs need, defined once in
 * core/schemas.ts – optional, tolerant, no writers:
 *
 *   ReportFlag.ackPolicy, the flag codes NOT_APPLICABLE_ANSWERED and APPROVER_DECISION, ReportSection.condition (a
 *   frozen, loose condition) and .tombstones, ActivityEntry.reportId, Report.approverTakeovers,
 *   SignReceipt.signerConfirmations, FormField.lintAccepted and FormAnalysis.guidanceVersion.
 *
 * - Old records read and hash as before (nothing invented); the report factory writes none of them.
 * - A record holding every one round-trips (schema, JSON, case export, tenant store) with nothing stripped; what is report
 *   content is inside the fingerprint, what is not (flags, activity) stays outside; lintAccepted is inside the map hash,
 *   guidanceVersion is not.
 * - The receipt takes the release's four keys through createReceipt's `additions` (the /sign checks' receiptAdditions),
 *   MAC-covered, and nothing else.
 * - Bounds and members are exactly these; the new flag codes have labels; the release's activity codes are known.
 * Fictional data only (scripts/medreport/schema-expansion-fixtures.ts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.MEDREPORT_AI_MODE = "demo";

import { mintReceipt } from "../../src/modules/medreport/api/handlers/sign/receipt";
import { storeApiPaths } from "../../src/modules/medreport/api/store-contract";
import { createMemoryTenantStore } from "../../src/modules/medreport/api/store-memory";
import { formMapSha256 } from "../../src/modules/medreport/auth/attestations";
import { createReceipt, verifyReceipt, verifyReceiptMac } from "../../src/modules/medreport/auth/sign-receipt";
import { RELEASE_ACTIVITY_ACTIONS } from "../../src/modules/medreport/core/activity-actions";
import { decodeCaseReport, encodeCaseReport } from "../../src/modules/medreport/core/case-export";
import { canonicalize, reportFingerprint } from "../../src/modules/medreport/core/fingerprint";
import { FLAG_CODE_LABELS, UNKNOWN_MEMBER_LABELS, flagCodeLabel } from "../../src/modules/medreport/core/labels";
import { KNOWN_ACTIVITY_ACTIONS, createFormReport } from "../../src/modules/medreport/core/report-factory";
import {
  AckPolicySchema,
  DraftTombstoneSchema,
  FormDefinitionSchema,
  FrozenConditionSchema,
  GUIDANCE_VERSION,
  LintAcceptanceSchema,
  MAX_CONDITION_CONTROLLERS,
  ReportFlagCodeSchema,
  ReportFlagSchema,
  ReportSchema,
  SignReceiptSchema,
  SignerConfirmationKindSchema,
  SignerConfirmationSchema,
} from "../../src/modules/medreport/core/schemas";
import { StoredReportSchema, StoredSignReceiptSchema } from "../../src/modules/medreport/core/stored-schemas";
import type { FormDefinition, Report, SignReceipt, SignerConfirmation } from "../../src/modules/medreport/core/types";
import { hasBannedTerm } from "../../src/modules/medreport/core/wording";
import { APPROVER_ACTOR, NEW_AT, STAFF_ACTOR, TEST_SECRET, fullFormDefinition, fullFormReport, oldFormDefinition, oldFormReport } from "./schema-expansion-fixtures";
import { member, storeDeps, storeFetch } from "./store-harness";

const viaJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const SIGNER = { name: "Sarah Reid", hcpc: "PH-DEMO-01" };
const TOM = { memberId: "mem_tom_demo", name: "Tom Ellis", hcpc: "PH-DEMO-02" };
const SARAH = { memberId: APPROVER_ACTOR.memberId, name: APPROVER_ACTOR.name, hcpc: "PH-DEMO-01" };
const CONFIRMATIONS: SignerConfirmation[] = [
  { kind: "assessed_patient", fieldId: "F-05" },
  { kind: "own_registration_number", fieldId: "F-09", value: "PH-DEMO-01" },
];

const REPORT_KEYS = ["approverTakeovers"] as const;
const SECTION_KEYS = ["condition", "tombstones"] as const;

/** fullFormReport() (W0.3) plus every report-side key of the follow-up. */
function followupReport(): Report {
  const report = fullFormReport();
  report.approverTakeovers = [{ from: TOM, to: SARAH, at: NEW_AT }];
  const [, f02, f03] = report.sections;
  f03.condition = { controllers: [f02.key], wants: "yes", text: "If yes, give details of the duties.", parser: "conditions-2", readFrom: "label" };
  f03.tombstones = [{ paragraphId: "F-03-p9", text: "A drafted line that was deleted.", sourceIds: ["N-001"], by: STAFF_ACTOR, at: NEW_AT }];
  report.flags[0] = { ...report.flags[0], ackPolicy: "approver" };
  report.activity = [...report.activity, { at: NEW_AT, actor: "System", action: "superseded", detail: "Superseded by version 2.", reportId: "rpt_v2" }];
  return report;
}

/** fullFormDefinition() (W0.3) plus the form-side keys of the follow-up. */
function followupForm(): FormDefinition {
  const form = fullFormDefinition();
  form.analysis.guidanceVersion = GUIDANCE_VERSION;
  form.fields[0].lintAccepted = [
    { rule: "L5", reason: "Patient-reported, recorded in the notes.", at: NEW_AT, by: APPROVER_ACTOR },
    { rule: "L11", reason: "Accepted while loading the clinic's forms.", at: NEW_AT },
  ];
  return form;
}

/* ------------------------------------------------------------------------------------------------
 * Old records: unchanged, nothing invented
 * ----------------------------------------------------------------------------------------------*/

test("old records read as before: none of the follow-up's keys is invented, and the report factory writes none of them", async () => {
  const old = ReportSchema.parse(viaJson(oldFormReport()));
  assert.equal(canonicalize(old), canonicalize(viaJson(oldFormReport())), "lossless");
  for (const key of REPORT_KEYS) assert.equal(key in old, false, key);
  for (const s of old.sections) for (const key of SECTION_KEYS) assert.equal(key in s, false, `${s.key}.${key}`);
  for (const f of old.flags) assert.equal("ackPolicy" in f, false);
  for (const a of old.activity) assert.equal("reportId" in a, false);
  const form = FormDefinitionSchema.parse(viaJson(oldFormDefinition()));
  assert.equal("guidanceVersion" in form.analysis, false);
  for (const f of form.fields) assert.equal("lintAccepted" in f, false);

  // No writers yet: a new report from the factory holds none of them either.
  const created = createFormReport({ form, bundle: old.bundleSnapshot, instructingParty: old.instructingParty, computedFacts: [], now: new Date(NEW_AT) });
  for (const key of REPORT_KEYS) assert.equal(key in created, false, `factory: ${key}`);
  for (const s of created.sections) for (const key of SECTION_KEYS) assert.equal(key in s, false, `factory: ${s.key}.${key}`);

  // A receipt minted without additions – or with empty ones – is exactly the receipt minted before the follow-up.
  const now = new Date(NEW_AT);
  const base = await createReceipt({ report: old, signer: SIGNER, statementAccepted: true, attestations: ["Checked."], now, secret: TEST_SECRET });
  const empty = await createReceipt({ report: old, signer: SIGNER, statementAccepted: true, attestations: ["Checked."], now, secret: TEST_SECRET, additions: {} });
  const undefinedKeys = await createReceipt({
    report: old,
    signer: SIGNER,
    statementAccepted: true,
    attestations: ["Checked."],
    now,
    secret: TEST_SECRET,
    additions: { signerConfirmations: undefined, approverTakeover: undefined },
  });
  assert.deepEqual(empty, base);
  assert.deepEqual(undefinedKeys, base);
  for (const key of ["issuedContentSha256", "acknowledgementsSha256", "approverTakeover", "signerConfirmations"]) assert.equal(key in base, false, key);
});

/* ------------------------------------------------------------------------------------------------
 * Every new key: round trip and hashing
 * ----------------------------------------------------------------------------------------------*/

test("a report holding every follow-up key round-trips with nothing stripped; condition, tombstones and takeovers are hashed, ackPolicy and activity are not", async () => {
  const full = viaJson(followupReport());
  const parsed = ReportSchema.parse(full);
  assert.equal(canonicalize(parsed), canonicalize(full), "every new key is defined (zod strips unknown keys)");
  assert.equal(canonicalize(StoredReportSchema.parse(full)), canonicalize(full), "the read schema keeps it too");
  assert.equal((parsed.sections[2].condition as Record<string, unknown>).readFrom, "label", "the frozen condition is loose: the parser's own keys are kept");

  const base = await reportFingerprint(parsed);
  const hashed: Array<[string, (r: Report) => void]> = [
    ["condition.controllers", (r) => (r.sections[2].condition = { ...r.sections[2].condition!, controllers: [] })],
    ["condition.wants", (r) => (r.sections[2].condition = { ...r.sections[2].condition!, wants: "no" })],
    ["condition (a parser key)", (r) => (r.sections[2].condition = { ...r.sections[2].condition!, readFrom: "guidance" })],
    ["condition removed", (r) => (r.sections[2].condition = undefined)],
    ["tombstones", (r) => r.sections[2].tombstones!.pop()],
    ["approverTakeovers", (r) => (r.approverTakeovers = [])],
  ];
  for (const [name, mutate] of hashed) {
    const copy = structuredClone(parsed);
    mutate(copy);
    assert.notEqual(await reportFingerprint(copy), base, `${name} is part of the fingerprint`);
  }
  const outside: Array<[string, (r: Report) => void]> = [
    ["flag ackPolicy", (r) => (r.flags[0].ackPolicy = "member")],
    ["activity reportId", (r) => (r.activity[r.activity.length - 1].reportId = "rpt_v3")],
  ];
  for (const [name, mutate] of outside) {
    const copy = structuredClone(parsed);
    mutate(copy);
    assert.equal(await reportFingerprint(copy), base, `${name} stays outside the fingerprint (flags and activity, as before)`);
  }
});

test("the case export of the follow-up keys names no technology and restores the report exactly", async () => {
  const report = ReportSchema.parse(viaJson(followupReport()));
  const file = JSON.stringify({ report: encodeCaseReport(report) });
  assert.ok(!hasBannedTerm(file), "no banned term");
  assert.ok(!/"(?:ai|model|prompt\w*|stopReason)"/i.test(file), file.match(/"(?:ai|model|prompt\w*|stopReason)"/i)?.[0]);
  const restored = ReportSchema.parse(decodeCaseReport(JSON.parse(file).report));
  assert.equal(canonicalize(restored), canonicalize(report));
});

test("a form map with lintAccepted and guidanceVersion round-trips; lintAccepted is inside the map hash, guidanceVersion outside", () => {
  const full = viaJson(followupForm());
  const parsed = FormDefinitionSchema.parse(full);
  assert.equal(canonicalize(parsed), canonicalize(full), "nothing stripped");
  const without = viaJson(fullFormDefinition());
  const marked = { ...without, analysis: { ...without.analysis, guidanceVersion: GUIDANCE_VERSION } };
  assert.equal(formMapSha256(FormDefinitionSchema.parse(marked)), formMapSha256(FormDefinitionSchema.parse(without)), "the guidance marker does not change the map hash");
  assert.notEqual(formMapSha256(parsed), formMapSha256(FormDefinitionSchema.parse(marked)), "an accepted lint finding is part of the map");
  assert.equal(GUIDANCE_VERSION, 2);
});

test("the tenant store keeps every follow-up key (PUT then GET), for reports and form maps", async () => {
  const tenantId = "clinic-followup";
  const store = createMemoryTenantStore();
  const f = storeFetch(storeDeps(store, { a: member(tenantId) }), { member: "a" });
  const put = (path: string, body: unknown) => f(path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const base = viaJson(followupReport());
  const report = { ...base, tenantId, bundleSnapshot: { ...base.bundleSnapshot, tenantId } };
  // bh2 WC (check-WC problem 3, integrator grant): a create is checked like an update – every decision must be the
  // signed-in member's – and this fixture holds several members' decisions, so it is stored as the release stores it
  // and PUT back unchanged (an update of that revision: every key goes through the handler again).
  const seeded = await store.createReport(tenantId, { id: report.id, status: report.status, templateId: report.templateId, formId: report.form?.formId ?? null, payload: report });
  assert.ok(seeded.ok);
  const created = await f(storeApiPaths.report(report.id), { method: "PUT", headers: { "content-type": "application/json", "if-match": `"${seeded.ok ? seeded.rev : 0}"` }, body: JSON.stringify({ report }) });
  assert.equal(created.status, 200, await created.clone().text());
  const got = await (await f(storeApiPaths.report(report.id))).json();
  assert.equal(canonicalize(ReportSchema.parse(got.report)), canonicalize(report));

  const form = { ...viaJson(followupForm()), tenantId, status: "proposed" as const, confirmed: undefined };
  const createdForm = await put(storeApiPaths.form(form.id), { form });
  assert.equal(createdForm.status, 201, await createdForm.clone().text());
  const gotForm = await (await f(storeApiPaths.form(form.id))).json();
  assert.equal(canonicalize(FormDefinitionSchema.parse(gotForm.form)), canonicalize(viaJson(form)));
});

/* ------------------------------------------------------------------------------------------------
 * The receipt: the /sign checks' additions, MAC-covered
 * ----------------------------------------------------------------------------------------------*/

test("createReceipt takes the release's four receipt keys as additions – MAC-covered, verified, tamper-evident – and nothing else", async () => {
  const report = ReportSchema.parse(viaJson(followupReport()));
  const additions = {
    issuedContentSha256: "1".repeat(64),
    acknowledgementsSha256: "2".repeat(64),
    approverTakeover: { from: TOM, to: SARAH, at: NEW_AT },
    signerConfirmations: CONFIRMATIONS,
    // A key that is not one of the four is never signed, whatever a check puts there.
    ...({ contentSha256: "9".repeat(64), later: "kept?" } as Record<string, unknown>),
  };
  const receipt = viaJson(await createReceipt({ report, signer: SIGNER, statementAccepted: true, attestations: ["Checked."], now: new Date(NEW_AT), secret: TEST_SECRET, additions }));
  assert.deepEqual(receipt.signerConfirmations, CONFIRMATIONS);
  assert.deepEqual(receipt.approverTakeover, additions.approverTakeover);
  assert.equal(receipt.issuedContentSha256, additions.issuedContentSha256);
  assert.equal(receipt.contentSha256, await reportFingerprint(report), "the content hash is the server's, never an addition");
  assert.equal("later" in receipt, false);
  assert.equal(canonicalize(SignReceiptSchema.parse(receipt)), canonicalize(receipt), "every key is defined");
  assert.equal(canonicalize(StoredSignReceiptSchema.parse(receipt)), canonicalize(receipt));
  assert.deepEqual(await verifyReceipt(receipt, report, { secret: TEST_SECRET }), { ok: true, contentSha256: receipt.contentSha256 });
  const tampered: Array<[string, SignReceipt]> = [
    ["a confirmation removed", { ...receipt, signerConfirmations: receipt.signerConfirmations!.slice(1) }],
    ["a confirmed number changed", { ...receipt, signerConfirmations: [CONFIRMATIONS[0], { ...CONFIRMATIONS[1], value: "PH-DEMO-02" }] }],
    ["confirmations removed", { ...receipt, signerConfirmations: undefined }],
  ];
  for (const [name, bad] of tampered) {
    assert.deepEqual(await verifyReceipt(viaJson(bad), report, { secret: TEST_SECRET }), { ok: false, reason: "BAD_MAC" }, name);
    assert.equal(verifyReceiptMac(viaJson(bad), { secret: TEST_SECRET }), false, name);
  }
});

test("/sign's mintReceipt passes the checks' receiptAdditions through to the receipt", async () => {
  const report = ReportSchema.parse(viaJson(followupReport()));
  const template = { attestations: ["Checked."] } as Parameters<typeof mintReceipt>[0]["template"];
  const actor = { via: "demo", sid: "sid-followup", tenantId: "demo" } as unknown as Parameters<typeof mintReceipt>[0]["actor"];
  const plain = await mintReceipt({ report, signer: SIGNER, template, actor });
  const added = await mintReceipt({ report, signer: SIGNER, template, actor, additions: { signerConfirmations: CONFIRMATIONS } });
  assert.equal("signerConfirmations" in plain, false);
  assert.deepEqual(added.signerConfirmations, CONFIRMATIONS);
  assert.equal(verifyReceiptMac(added), true);
});

/* ------------------------------------------------------------------------------------------------
 * Bounds, members, labels
 * ----------------------------------------------------------------------------------------------*/

test("the follow-up's bounds and members are exactly these", () => {
  assert.deepEqual(AckPolicySchema.options, ["never", "approver", "member"]);
  assert.deepEqual(SignerConfirmationKindSchema.options, ["assessed_patient", "treated_patient", "own_registration_number"]);
  for (const code of ["NOT_APPLICABLE_ANSWERED", "APPROVER_DECISION"] as const) assert.ok(ReportFlagCodeSchema.options.includes(code), code);
  const flag = { id: "f1", code: "OPEN_GAP", severity: "blocking", message: "Open." };
  assert.equal(ReportFlagSchema.safeParse({ ...flag, ackPolicy: "anyone" }).success, false, "ackPolicy is closed");
  assert.equal(ReportFlagSchema.safeParse({ ...flag, ackPolicy: "approver" }).success, true);

  assert.equal(FrozenConditionSchema.safeParse({ controllers: [] }).success, true, "unresolved: no controller");
  assert.equal(FrozenConditionSchema.safeParse({ controllers: ["F-01"], match: "some" }).success, false);
  assert.equal(FrozenConditionSchema.safeParse({ controllers: Array.from({ length: MAX_CONDITION_CONTROLLERS + 1 }, (_, i) => `F-${String(i + 1).padStart(2, "0")}`) }).success, false);
  assert.equal(FrozenConditionSchema.safeParse({ wants: "yes" }).success, false, "controllers is required");

  assert.equal(DraftTombstoneSchema.safeParse({ paragraphId: "p1", text: "x", sourceIds: [], at: NEW_AT }).success, false, "who deleted it is required");
  assert.equal(LintAcceptanceSchema.safeParse({ rule: "L12", reason: "Checked.", at: NEW_AT }).success, true);
  assert.equal(LintAcceptanceSchema.safeParse({ rule: "X1", reason: "Checked.", at: NEW_AT }).success, false);
  assert.equal(LintAcceptanceSchema.safeParse({ rule: "L5", reason: "", at: NEW_AT }).success, false, "a reason is required");
  assert.equal(SignerConfirmationSchema.safeParse({ kind: "other" }).success, false);
  assert.equal(SignerConfirmationSchema.safeParse({ kind: "own_registration_number", value: "9".repeat(41) }).success, false);
});

test("the new flag codes have labels with no banned term; the release's activity codes are known actions", () => {
  for (const code of ["NOT_APPLICABLE_ANSWERED", "APPROVER_DECISION"] as const) {
    assert.ok(FLAG_CODE_LABELS[code], code);
    assert.notEqual(flagCodeLabel(code), UNKNOWN_MEMBER_LABELS.flagCode, code);
    assert.ok(!hasBannedTerm(FLAG_CODE_LABELS[code]), code);
  }
  for (const action of RELEASE_ACTIVITY_ACTIONS) assert.ok((KNOWN_ACTIVITY_ACTIONS as readonly string[]).includes(action), action);
});
