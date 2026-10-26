/**
 * bh2 schema expansion (release/bh-trial-2, plan W0.3): every field and enum member the workstreams need is defined
 * once in core/schemas.ts, optional and additive; readers ship before writers.
 *
 * - Old records (as stored before the expansion) parse losslessly and hash exactly as on bd929a3: the report
 *   fingerprint, the receipt MAC and the form-map hash are pinned below.
 * - A record holding every new field round-trips (schema, JSON, case export, tenant store) with nothing stripped, its
 *   receipt verifies with the new fields under the MAC, and the form-side fields stay outside the map hash.
 * - The new bounds: part.of up to 30 for attended appointments only; the episode.attendedDates list path.
 * - Readers tolerate the new members (labels, the live analysis's path list, the factory, the validators).
 * Fictional data only (scripts/medreport/schema-expansion-fixtures.ts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";

process.env.MEDREPORT_AI_MODE = "demo";

import { formMapSha256 } from "../../src/modules/medreport/auth/attestations";
import { createReceipt, verifyReceipt, verifyReceiptMac } from "../../src/modules/medreport/auth/sign-receipt";
import { ANALYSIS_REGISTRATION_PATHS } from "../../src/modules/medreport/ai/form-analysis-schema";
import { listRecordedFormAnalyses } from "../../src/modules/medreport/ai/recorded-forms";
import { decodeCaseReport, encodeCaseReport } from "../../src/modules/medreport/core/case-export";
import { computeFacts } from "../../src/modules/medreport/core/computed-facts";
import { canonicalize, reportFingerprint } from "../../src/modules/medreport/core/fingerprint";
import { formToTemplate, resolveRegistrationValue } from "../../src/modules/medreport/core/forms";
import { PARAGRAPH_ORIGIN_LABELS, REGISTRATION_PATH_LABELS } from "../../src/modules/medreport/core/labels";
import { createFormReport } from "../../src/modules/medreport/core/report-factory";
import {
  ActorSchema,
  FillSourceSchema,
  FormAnalysisSchema,
  FormDefinitionSchema,
  GapKindSchema,
  GapSchema,
  MAPPING_ONLY_PATHS,
  ParagraphOriginSchema,
  REPORT_MODEL,
  RegistrationPathSchema,
  ReportApproverSchema,
  ReportSchema,
  SectionDispositionKindSchema,
  SectionDispositionSchema,
  SignReceiptSchema,
} from "../../src/modules/medreport/core/schemas";
import type { FormDefinition, Report, SignReceipt } from "../../src/modules/medreport/core/types";
import { validateReport } from "../../src/modules/medreport/core/validation";
import { hasBannedTerm } from "../../src/modules/medreport/core/wording";
import { createMemoryTenantStore } from "../../src/modules/medreport/api/store-memory";
import { storeApiPaths } from "../../src/modules/medreport/api/store-contract";
import { ORIGIN_PILL_CLASSES, originLabel } from "../../src/modules/medreport/ui/components/review/review-model";
import { HAND_EMPLOYER_FORM, HAND_MLC_FORM } from "./form-fixtures";
import {
  APPROVER_ACTOR,
  NEW_AT,
  OLD_AT,
  STAFF_ACTOR,
  TEST_SECRET,
  fullFormDefinition,
  fullFormReport,
  oldBuiltInReport,
  oldFormDefinition,
  oldFormReport,
} from "./schema-expansion-fixtures";
import { member, storeDeps, storeFetch } from "./store-harness";

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const viaJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const SIGNER = { name: "Sarah Reid", hcpc: "PH-DEMO-01" };

/** Computed on bd929a3 (release/bh-trial-2 before the expansion: a `git archive` of its src) from the frozen old fixtures. */
const GOLDEN = {
  oldFormReport: {
    canonical: "69ca77cbe798c5d8503fcbe3bed3558730c3543032ab723f4c8ce2ea2f70778e",
    fingerprint: "6b1e7792dc63880e65544cf07c033eb56122ff4a9b6c2f3e5acc431aa0a371aa",
  },
  oldBuiltInReport: {
    canonical: "f38eb41f3b708b3ad6ef9e934b28138ba9e28a797fe82de41a31b78df871249a",
    fingerprint: "65f61c1c81675e38caddecf2cef090a39a2c53c2b6afcd88725b31437148e529",
  },
  oldReceipt: {
    mac: "aCFj_rX4J0dIN1zTJUHyI8mzdl7BiKEzlsXvCixN0VI",
    canonical: "0308e315e3f1fc894bc80aa544816f06a9bd994f894edbdc34e721ef7fc5dadd",
  },
  oldFormDefinition: {
    canonical: "bbffccb8575f99a763d2b0ba56c4c556f934f1eefbdeb02765db76d37263ffa9",
    mapSha256: "b3fcf2b2b02a4a7938ccaa24981d85385484a8a35fc954f433f901748164f1c3",
  },
} as const;

function oldReceipt(report: Report): Promise<SignReceipt> {
  return createReceipt({
    report,
    signer: SIGNER,
    statementAccepted: true,
    attestations: ["I approve this form."],
    formMapSha256: "9".repeat(64),
    approvedVia: { kind: "demo", sid: "sid-schema" },
    now: new Date(OLD_AT),
    secret: TEST_SECRET,
  });
}

/** A receipt as WA1's /sign will issue it: every new key, all under the MAC (auth/sign-receipt.ts computeMac). */
async function fullReceipt(report: Report): Promise<SignReceipt> {
  const { mac: _mac, ...base } = await oldReceipt(report);
  const unsigned = {
    ...base,
    issuedContentSha256: "1".repeat(64),
    acknowledgementsSha256: "2".repeat(64),
    approverTakeover: {
      from: { memberId: "mem_tom_demo", name: "Tom Ellis", hcpc: "PH-DEMO-02" },
      to: { memberId: APPROVER_ACTOR.memberId, name: APPROVER_ACTOR.name, hcpc: "PH-DEMO-01" },
      at: NEW_AT,
    },
  };
  return { ...unsigned, mac: createHmac("sha256", TEST_SECRET).update(canonicalize(unsigned), "utf8").digest("base64url") };
}

/* ------------------------------------------------------------------------------------------------
 * Old records: unchanged
 * ----------------------------------------------------------------------------------------------*/

test("old reports parse losslessly and hash exactly as before the expansion (pinned on bd929a3)", async () => {
  for (const [name, build] of [
    ["oldFormReport", oldFormReport],
    ["oldBuiltInReport", oldBuiltInReport],
  ] as const) {
    const stored = viaJson(build());
    const parsed = ReportSchema.parse(stored);
    assert.equal(canonicalize(parsed), canonicalize(stored), `${name}: nothing added or stripped`);
    assert.equal(sha256(canonicalize(parsed)), GOLDEN[name].canonical, `${name}: canonical JSON`);
    assert.equal(await reportFingerprint(parsed), GOLDEN[name].fingerprint, `${name}: content fingerprint`);
    for (const key of ["approver", "reportModel"]) assert.equal(key in parsed, false, `${name}: no ${key} invented`);
  }
});

test("an old receipt has the same MAC and still verifies; its shape is unchanged", async () => {
  const report = ReportSchema.parse(viaJson(oldFormReport()));
  const receipt = await oldReceipt(report);
  assert.equal(receipt.mac, GOLDEN.oldReceipt.mac);
  assert.equal(receipt.contentSha256, GOLDEN.oldFormReport.fingerprint);
  const stored = viaJson(receipt);
  assert.equal(sha256(canonicalize(SignReceiptSchema.parse(stored))), GOLDEN.oldReceipt.canonical);
  assert.deepEqual(await verifyReceipt(stored, report, { secret: TEST_SECRET }), { ok: true, contentSha256: GOLDEN.oldFormReport.fingerprint });
  assert.equal(verifyReceiptMac(stored, { secret: TEST_SECRET }), true);
  for (const key of ["issuedContentSha256", "acknowledgementsSha256", "approverTakeover"]) assert.equal(key in stored, false);
});

test("an old form map parses losslessly; its map hash is unchanged", () => {
  const stored = viaJson(oldFormDefinition());
  const parsed = FormDefinitionSchema.parse(stored);
  assert.equal(canonicalize(parsed), canonicalize(stored));
  assert.equal(sha256(canonicalize(parsed)), GOLDEN.oldFormDefinition.canonical);
  assert.equal(formMapSha256(parsed), GOLDEN.oldFormDefinition.mapSha256);
});

test("every bundled sample map and hand-made map parses losslessly, and parsing leaves its map hash as it was", () => {
  const maps: Array<[string, FormDefinition]> = [
    ...listRecordedFormAnalyses().map((r) => [r.sampleId ?? r.fileSha256, r.form] as [string, FormDefinition]),
    ["HAND_MLC_FORM", HAND_MLC_FORM],
    ["HAND_EMPLOYER_FORM", HAND_EMPLOYER_FORM],
  ];
  assert.ok(maps.length >= 6, `bundled maps found: ${maps.length}`);
  for (const [name, form] of maps) {
    const stored = viaJson(form);
    const parsed = FormDefinitionSchema.parse(stored);
    assert.equal(canonicalize(parsed), canonicalize(stored), `${name}: lossless`);
    assert.equal(formMapSha256(parsed), formMapSha256(stored), `${name}: map hash`);
  }
});

/* ------------------------------------------------------------------------------------------------
 * Records holding every new field
 * ----------------------------------------------------------------------------------------------*/

test("a report holding every new field round-trips with nothing stripped, and the new report content is hashed", async () => {
  const full = viaJson(fullFormReport());
  const parsed = ReportSchema.parse(full);
  assert.equal(canonicalize(parsed), canonicalize(full), "every new key is defined (zod strips unknown keys)");
  assert.equal(canonicalize(ReportSchema.parse(viaJson(parsed))), canonicalize(full), "a second round trip is identical");
  assert.equal(parsed.reportModel, REPORT_MODEL);
  assert.equal(REPORT_MODEL, 2);
  assert.deepEqual(new Set(parsed.gaps.map((g) => g.kind).filter(Boolean)), new Set(GapKindSchema.options), "every Gap.kind");
  assert.deepEqual(
    new Set(parsed.sections.map((s) => s.disposition?.kind).filter(Boolean)),
    new Set(SectionDispositionKindSchema.options),
    "every disposition kind",
  );
  assert.ok(parsed.sections.some((s) => s.paragraphs.some((p) => p.origin === "staff")), "the staff origin");

  // Hashed: the approver, the per-box decisions and the paragraph stamps are report content (core/fingerprint.ts).
  const base = await reportFingerprint(parsed);
  const mutations: Array<[string, (r: Report) => void]> = [
    ["approver", (r) => (r.approver = { ...r.approver!, memberId: "mem_other" })],
    ["reportModel", (r) => (r.reportModel = 3)],
    ["disposition", (r) => (r.sections[2].disposition = { ...r.sections[2].disposition!, kind: "not_applicable" })],
    ["controllerSnapshot", (r) => (r.sections[2].disposition!.controllerSnapshot = [{ sectionKey: "F-02", answer: { kind: "yes_no", value: false } }])],
    ["accepted", (r) => r.sections[3].accepted!.pop()],
    ["adoptedBy", (r) => (r.sections[2].adoptedBy = undefined)],
    ["answerBy", (r) => (r.sections[1].answerBy = STAFF_ACTOR)],
    ["paragraph.by", (r) => (r.sections[2].paragraphs[1].by = APPROVER_ACTOR)],
    ["ownWords", (r) => (r.sections[3].paragraphs[1].ownWords = undefined)],
    ["fixes", (r) => r.sections[3].paragraphs[0].fixes!.pop()],
    ["gap.kind", (r) => (r.gaps[2].kind = "band")],
    ["gap resolution by", (r) => (r.gaps[0].resolution = { ...r.gaps[0].resolution!, by: STAFF_ACTOR })],
  ];
  for (const [name, mutate] of mutations) {
    const copy = structuredClone(parsed);
    mutate(copy);
    assert.notEqual(await reportFingerprint(copy), base, `${name} is part of the fingerprint`);
  }
  // Flags stay outside the fingerprint (as before); the receipt's acknowledgementsSha256 covers acknowledgements (WA1).
  const ack = structuredClone(parsed);
  ack.flags[0].acknowledged = { ...ack.flags[0].acknowledged!, by: STAFF_ACTOR };
  assert.equal(await reportFingerprint(ack), base);
});

test("a receipt with the new fields verifies (the MAC covers them); tampering with any of them is BAD_MAC", async () => {
  const report = ReportSchema.parse(viaJson(fullFormReport()));
  const receipt = viaJson(await fullReceipt(report));
  const parsed = SignReceiptSchema.parse(receipt);
  assert.equal(canonicalize(parsed), canonicalize(receipt), "nothing stripped before the MAC is recomputed");
  assert.deepEqual(await verifyReceipt(receipt, report, { secret: TEST_SECRET }), { ok: true, contentSha256: await reportFingerprint(report) });
  assert.equal(verifyReceiptMac(receipt, { secret: TEST_SECRET }), true);
  const tampered: Array<[string, SignReceipt]> = [
    ["issuedContentSha256", { ...receipt, issuedContentSha256: "3".repeat(64) }],
    ["acknowledgementsSha256", { ...receipt, acknowledgementsSha256: "4".repeat(64) }],
    ["approverTakeover", { ...receipt, approverTakeover: { ...receipt.approverTakeover!, at: OLD_AT } }],
    ["approverTakeover removed", { ...receipt, approverTakeover: undefined }],
  ];
  for (const [name, bad] of tampered) {
    assert.deepEqual(await verifyReceipt(viaJson(bad), report, { secret: TEST_SECRET }), { ok: false, reason: "BAD_MAC" }, name);
    assert.equal(verifyReceiptMac(viaJson(bad), { secret: TEST_SECRET }), false, name);
  }
  // The report content still binds: a changed disposition is HASH_MISMATCH.
  const edited = structuredClone(report);
  edited.sections[2].disposition = undefined;
  assert.deepEqual(await verifyReceipt(receipt, edited, { secret: TEST_SECRET }), { ok: false, reason: "HASH_MISMATCH" });
});

test("a form map with the new fields round-trips; the converter stamp, printed leads and source hash stay outside the map hash", () => {
  const full = viaJson(fullFormDefinition());
  const parsed = FormDefinitionSchema.parse(full);
  assert.equal(canonicalize(parsed), canonicalize(full), "nothing stripped");
  const old = viaJson(oldFormDefinition());
  const stamped = {
    ...old,
    file: { ...old.file, sourceSha256: full.file.sourceSha256 },
    analysis: { ...old.analysis, convertedWith: full.analysis.convertedWith, printedLeads: full.analysis.printedLeads },
  };
  assert.equal(formMapSha256(FormDefinitionSchema.parse(stamped)), GOLDEN.oldFormDefinition.mapSha256, "map hash unchanged");
  assert.notEqual(formMapSha256(parsed), GOLDEN.oldFormDefinition.mapSha256, "new fields (session paths) are part of the map");
});

test("the case export of a report with every new field names no technology and restores the report exactly", async () => {
  const report = ReportSchema.parse(viaJson(fullFormReport()));
  const file = JSON.stringify({ report: encodeCaseReport(report) });
  assert.ok(!hasBannedTerm(file), "no banned term");
  assert.ok(!/"(?:ai|model|prompt\w*|stopReason)"/i.test(file), file.match(/"(?:ai|model|prompt\w*|stopReason)"/i)?.[0]);
  const restored = ReportSchema.parse(decodeCaseReport(JSON.parse(file).report));
  assert.equal(await reportFingerprint(restored), await reportFingerprint(report));
  assert.equal(canonicalize(restored), canonicalize(report));
});

test("the tenant store keeps every new field (PUT then GET), for reports and form maps", async () => {
  const tenantId = "clinic-schema";
  const store = createMemoryTenantStore();
  const f = storeFetch(storeDeps(store, { a: member(tenantId) }), { member: "a" });
  const put = (path: string, body: unknown) => f(path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  const report = { ...viaJson(fullFormReport()), tenantId, bundleSnapshot: { ...viaJson(fullFormReport()).bundleSnapshot, tenantId } };
  const created = await put(storeApiPaths.report(report.id), { report });
  assert.equal(created.status, 201, await created.clone().text());
  const got = await (await f(storeApiPaths.report(report.id))).json();
  assert.equal(canonicalize(ReportSchema.parse(got.report)), canonicalize(report));

  const form = { ...viaJson(fullFormDefinition()), tenantId, status: "proposed" as const, confirmed: undefined };
  const createdForm = await put(storeApiPaths.form(form.id), { form });
  assert.equal(createdForm.status, 201, await createdForm.clone().text());
  const gotForm = await (await f(storeApiPaths.form(form.id))).json();
  assert.equal(canonicalize(FormDefinitionSchema.parse(gotForm.form)), canonicalize(viaJson(form)));
});

/* ------------------------------------------------------------------------------------------------
 * Bounds and members
 * ----------------------------------------------------------------------------------------------*/

test("part.of goes up to 30 for attended appointments only; an address part stays at most 12", () => {
  const reg = (path: string, part: { index: number; of: number }) => FillSourceSchema.safeParse({ kind: "registration", path, part }).success;
  assert.equal(reg("episode.attendedDate", { index: 14, of: 14 }), true);
  assert.equal(reg("episode.attendedDate", { index: 30, of: 30 }), true);
  assert.equal(reg("episode.attendedTime", { index: 30, of: 30 }), true);
  assert.equal(reg("episode.attendedDate", { index: 31, of: 31 }), false, "index 31 is refused");
  assert.equal(reg("episode.attendedTime", { index: 3, of: 31 }), false);
  assert.equal(reg("patient.addressLines", { index: 12, of: 12 }), true);
  assert.equal(reg("patient.addressLines", { index: 13, of: 13 }), false, "address parts above 12 are still refused");
  assert.equal(reg("clinic.addressLines", { index: 2, of: 13 }), false);
  assert.equal(reg("episode.attendedDates", { index: 13, of: 13 }), false, "the list path takes `sessions`, not a 30-line part");
  const issue = FillSourceSchema.safeParse({ kind: "registration", path: "patient.addressLines", part: { index: 13, of: 13 } });
  assert.ok(!issue.success && issue.error.issues.some((i) => i.path.join(".") === "part.index"));
});

test("episode.attendedDates is a mapping-only list path with {fromSession, of?}", () => {
  assert.ok(RegistrationPathSchema.options.includes("episode.attendedDates"));
  assert.ok((MAPPING_ONLY_PATHS as readonly string[]).includes("episode.attendedDates"));
  assert.ok(!(ANALYSIS_REGISTRATION_PATHS as readonly string[]).includes("episode.attendedDates"), "the live analysis's choices are unchanged");
  const src = (sessions: unknown) => FillSourceSchema.safeParse({ kind: "registration", path: "episode.attendedDates", sessions }).success;
  assert.equal(src({ fromSession: 2 }), true);
  assert.equal(src({ fromSession: 1, of: 30 }), true);
  assert.equal(src({ fromSession: 0 }), false);
  assert.equal(src({ fromSession: 31 }), false);
  assert.equal(src({ fromSession: 2, of: 31 }), false);
  assert.equal(src({ of: 8 }), false, "fromSession is required");
  assert.equal(FillSourceSchema.safeParse({ kind: "registration", path: "episode.attendedDates" }).success, true, "sessions is optional");
});

test("the new enum members and shapes are exactly the plan's", async () => {
  assert.deepEqual(GapKindSchema.options, [
    "no_opinion_recorded",
    "opinion_not_fitting_options",
    "choice_held_back",
    "condition",
    "band",
    "record_value",
    "staff_entry",
    "meta_held_back",
  ]);
  assert.deepEqual(SectionDispositionKindSchema.options, ["not_applicable", "applies_anyway", "left_blank"]);
  assert.ok(ParagraphOriginSchema.options.includes("staff"));
  const gap = { id: "g", sectionKey: "F-01", issue: "x", suggestedQuestion: "y", relatedNoteIds: [] };
  assert.equal(GapSchema.safeParse({ ...gap, kind: "other" }).success, false);
  assert.equal(SectionDispositionSchema.safeParse({ kind: "skipped", by: APPROVER_ACTOR, at: NEW_AT }).success, false);
  assert.equal(SectionDispositionSchema.safeParse({ kind: "left_blank", at: NEW_AT }).success, false, "a decision names its actor");
  assert.equal(ActorSchema.safeParse({ ...STAFF_ACTOR, role: "manager" }).success, false);
  assert.equal(ActorSchema.safeParse({ memberId: "m", name: "N", role: "staff" }).success, false, "canSign is stated");
  assert.equal(ReportApproverSchema.safeParse({ memberId: "m", name: "N" }).success, false, "an approver has an HCPC number");
  assert.equal(FormAnalysisSchema.safeParse({ ...oldFormDefinition().analysis, printedLeads: { "not-a-field": "Lead" } }).success, false, "printed leads are keyed by field id");
  const receipt = await fullReceipt(ReportSchema.parse(viaJson(fullFormReport())));
  assert.equal(SignReceiptSchema.safeParse(receipt).success, true);
  for (const key of ["issuedContentSha256", "acknowledgementsSha256"] as const) assert.equal(SignReceiptSchema.safeParse({ ...receipt, [key]: "XYZ" }).success, false, `${key} is a SHA-256`);
  assert.equal(SignReceiptSchema.safeParse({ ...receipt, approverTakeover: { from: receipt.approverTakeover!.from, at: NEW_AT } }).success, false, "a takeover names both approvers");
});

/* ------------------------------------------------------------------------------------------------
 * Readers tolerate the new members (no writer uses them yet)
 * ----------------------------------------------------------------------------------------------*/

test("readers tolerate the new members: labels, the factory (nothing guessed for the list path) and the validators", () => {
  assert.equal(PARAGRAPH_ORIGIN_LABELS.staff, "Entered by staff");
  assert.equal(originLabel("staff", "tm3-sim"), "Entered by staff");
  assert.ok(ORIGIN_PILL_CLASSES.staff);
  assert.ok(REGISTRATION_PATH_LABELS["episode.attendedDates"]);
  for (const text of [PARAGRAPH_ORIGIN_LABELS.staff, REGISTRATION_PATH_LABELS["episode.attendedDates"]]) assert.ok(!hasBannedTerm(text), text);

  const form = FormDefinitionSchema.parse(viaJson(fullFormDefinition()));
  const bundle = oldFormReport().bundleSnapshot;
  const computedFacts = computeFacts(bundle, { asOf: "2026-10-28" });
  const ctx = { bundle, instructingParty: bundle.referral, computedFacts, reportDate: "2026-10-28" };
  assert.equal(resolveRegistrationValue("episode.attendedDates", ctx), null, "resolved by WE later; nothing is guessed now");
  assert.equal(resolveRegistrationValue("episode.attendedDate", ctx, "date", { index: 30, of: 30 })?.blank, true, "session 30 of 2 prints nothing");

  const report = createFormReport({ form, bundle, instructingParty: bundle.referral, computedFacts, now: new Date(NEW_AT) });
  ReportSchema.parse(viaJson(report));
  const list = report.sections.find((s) => s.key === "F-12");
  assert.ok(list, "the list box is a section");
  // bh2 WE design 5 (resolved): the attended dates from session 2 on (the fixture's map lists from the 2nd), from the records.
  assert.deepEqual(list.paragraphs.map((p) => p.text), ["24/08/2026"], "the attended dates from session 2, filled from the records");

  const full = ReportSchema.parse(viaJson(fullFormReport()));
  const result = validateReport(full, formToTemplate(form), { form });
  assert.ok(Array.isArray(result.flags));
});
