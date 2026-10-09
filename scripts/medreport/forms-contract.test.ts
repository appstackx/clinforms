/**
 * Contract tests for referrer forms (Revision 2): schemas, formToTemplate, createFormReport (code-filled
 * registration and computed answers, gaps for missing values), answers for the forms engine, block IDs
 * and the request schemas. Uses the simulated TM3 demo bundle for Megan Hart (case A).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DraftsRequestSchema, RenderQuerySchema } from "../../src/modules/medreport/api/contract";
import { computeFacts } from "../../src/modules/medreport/core/computed-facts";
import {
  FORM_ATTESTATIONS,
  answerToText,
  buildFormAnswers,
  checkFormDefinition,
  formIdFromTemplateId,
  formTemplateId,
  formToTemplate,
  formatCellBlockId,
  isFormReport,
  parseBlockId,
  referrerNamesMatch,
  asksForReferralPartyReference,
} from "../../src/modules/medreport/core/forms";
import { createFormReport, planDraftGroups } from "../../src/modules/medreport/core/report-factory";
import {
  FormDefinitionSchema,
  ReportSchema,
  ReportTemplateSchema,
  SectionKeySchema,
} from "../../src/modules/medreport/core/schemas";
import type { FormDefinition, FormField, InstructingParty } from "../../src/modules/medreport/core/types";
import { validateReport } from "../../src/modules/medreport/core/validation";
import { getDemoBundle } from "./dev-bundles";

const SHA = "a".repeat(64);
const NOW = new Date("2026-10-06T09:30:00.000Z");

function cell(id: string, label: string, rest: Partial<FormField> & Pick<FormField, "answerType" | "fillSource">): FormField {
  return {
    id,
    label,
    guidance: `Answer “${label}”.`,
    anchor: { kind: "docx", target: "table_cell", blockId: formatCellBlockId([{ t: 0, r: Number(id.slice(2)), c: 1 }]) },
    required: true,
    confidence: "high",
    ...rest,
  };
}

function demoForm(): FormDefinition {
  return {
    id: "frm_demo_northgate",
    tenantId: "demo",
    referrer: { name: "Northgate Medical Reporting (fictional)", type: "mlc" },
    title: "Treating Physiotherapist Report Form",
    versionLabel: "v3 (2026)",
    file: {
      fileName: "Northgate-physio-report-form.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sha256: SHA,
      sizeBytes: 48211,
    },
    kind: "docx",
    fields: [
      cell("F-01", "Claimant name", { answerType: "short_text", fillSource: { kind: "registration", path: "patient.fullName" } }),
      cell("F-02", "Date of birth", { answerType: "date", fillSource: { kind: "registration", path: "patient.dob" } }),
      cell("F-03", "Your reference", { answerType: "short_text", fillSource: { kind: "registration", path: "referral.reference" } }),
      cell("F-04", "Date of accident", { answerType: "date", fillSource: { kind: "registration", path: "incident.date" } }),
      cell("F-05", "Number of sessions attended", {
        answerType: "number",
        fillSource: { kind: "computed_fact", factId: "FACT-attendance", format: "sessions_attended" },
      }),
      cell("F-06", "Missed appointments", {
        answerType: "number",
        fillSource: { kind: "computed_fact", factId: "FACT-attendance", format: "dna_count" },
      }),
      cell("F-07", "History of the accident", { answerType: "long_text", section: "Section B – History", fillSource: { kind: "notes_narrative" } }),
      cell("F-08", "Prognosis", { answerType: "long_text", section: "Section C – Opinion", fillSource: { kind: "clinician_opinion" } }),
      {
        ...cell("F-09", "Is further treatment recommended?", { answerType: "yes_no", fillSource: { kind: "clinician_opinion" } }),
        options: ["Yes", "No"],
        anchor: {
          kind: "docx",
          target: "checkbox_glyph",
          blockId: "t0.r9.c1",
          optionGlyphs: [
            { option: "Yes", blockId: "t0.r9.c1", glyphIndex: 0 },
            { option: "No", blockId: "t0.r9.c1", glyphIndex: 1 },
          ],
        },
      },
      cell("F-10", "Occupation", { answerType: "short_text", fillSource: { kind: "registration", path: "patient.occupation" } }),
      cell("F-11", "Name of physiotherapist", { answerType: "clinician_name", fillSource: { kind: "signoff", part: "name" } }),
      cell("F-12", "Date", { answerType: "date_signed", fillSource: { kind: "signoff", part: "date" } }),
      cell("F-13", "Signature", { answerType: "signature", fillSource: { kind: "signoff", part: "signature" } }),
      cell("F-14", "For office use only", { answerType: "short_text", required: false, fillSource: { kind: "leave_blank" } }),
    ],
    status: "confirmed",
    analysis: { mode: "demo_prewritten", promptVersion: "forms-test", at: NOW.toISOString(), warnings: [] },
    confirmed: { by: "Practice manager (demo)", at: NOW.toISOString() },
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
}

function party(): InstructingParty {
  const r = getDemoBundle("megan-hart").referral;
  return { type: r.type, name: r.name, reference: r.reference, contactName: r.contactName, address: r.address };
}

/** The referral, as if Northgate (the form's referrer) had instructed the clinic. */
function northgateParty(): InstructingParty {
  return { ...party(), name: "Northgate Medical Reporting (fictional)" };
}

function build(bundle = getDemoBundle("megan-hart"), instructingParty: InstructingParty = northgateParty()) {
  const form = FormDefinitionSchema.parse(demoForm());
  const report = createFormReport({
    form,
    bundle,
    instructingParty,
    computedFacts: computeFacts(bundle, { asOf: "2026-10-06" }),
    now: NOW,
    id: "rpt_test",
  });
  return { form, report };
}

test("section keys accept form field IDs as well as snake_case keys", () => {
  assert.ok(SectionKeySchema.safeParse("F-07").success);
  assert.ok(SectionKeySchema.safeParse("presenting_complaints").success);
  assert.ok(!SectionKeySchema.safeParse("f-07").success);
  assert.ok(!SectionKeySchema.safeParse("F-7").success);
});

test("formToTemplate: one section per answerable field, kinds mapped, valid template", () => {
  const form = demoForm();
  const template = ReportTemplateSchema.parse(formToTemplate(form));
  assert.equal(template.id, "form:frm_demo_northgate");
  assert.equal(formIdFromTemplateId(template.id), form.id);
  assert.equal(formTemplateId(form.id), template.id);
  assert.equal(template.audience, "mlc");
  assert.deepEqual(template.attestations, [...FORM_ATTESTATIONS]);
  assert.deepEqual(
    template.sections.map((s) => [s.key, s.kind]),
    [
      ["F-01", "from_records"],
      ["F-02", "from_records"],
      ["F-03", "from_records"],
      ["F-04", "from_records"],
      ["F-05", "from_records"],
      ["F-06", "from_records"],
      ["F-07", "ai_narrative"],
      ["F-08", "clinician_opinion"],
      ["F-09", "clinician_opinion"],
      ["F-10", "from_records"],
      ["F-11", "declaration"],
      ["F-12", "declaration"],
      ["F-13", "declaration"],
    ],
  );
  assert.match(template.sections.find((s) => s.key === "F-09")?.guidance ?? "", /Options as printed: "Yes", "No"/);
  assert.deepEqual(formToTemplate({ ...form, referrer: { name: "Ashby Freight Ltd (fictional)", type: "employer" } }).scope.excludeFields, [
    "note.pastMedicalHistory",
    "note.socialHistory",
  ]);
});

test("createFormReport fills registration and computed answers by code, with sources", () => {
  const { report } = build();
  ReportSchema.parse(report);
  assert.ok(isFormReport(report));
  assert.deepEqual(report.form, {
    formId: "frm_demo_northgate",
    title: "Treating Physiotherapist Report Form",
    referrer: { name: "Northgate Medical Reporting (fictional)", type: "mlc" },
    fileSha256: SHA,
    kind: "docx",
  });
  assert.equal(report.templateId, "form:frm_demo_northgate");
  assert.equal(report.sections.length, 13, "leave_blank fields have no section");
  const s = (key: string) => {
    const found = report.sections.find((x) => x.key === key);
    assert.ok(found, key);
    return found;
  };

  assert.equal(s("F-01").paragraphs[0].text, "Megan Hart");
  assert.deepEqual(s("F-01").paragraphs[0].sourceIds, ["REG"]);
  assert.equal(s("F-01").paragraphs[0].origin, "from_records");
  assert.equal(s("F-01").fieldId, "F-01");
  assert.equal(s("F-01").answer, undefined);

  assert.deepEqual(s("F-02").answer, { kind: "date", value: "1991-11-22" });
  assert.equal(s("F-02").paragraphs[0].text, "22/11/1991");
  assert.equal(answerToText(s("F-02")), "22/11/1991");
  assert.equal(s("F-03").paragraphs[0].text, "HP/RTA/2291");
  assert.deepEqual(s("F-04").answer, { kind: "date", value: "2026-03-12" });

  assert.deepEqual(s("F-05").answer, { kind: "number", value: "10" });
  assert.deepEqual(s("F-05").paragraphs[0].sourceIds, ["FACT-attendance"]);
  assert.deepEqual(s("F-06").answer, { kind: "number", value: "1" });

  assert.equal(s("F-07").status, "pending");
  assert.equal(s("F-07").kind, "ai_narrative");
  assert.equal(s("F-08").kind, "clinician_opinion");
  assert.deepEqual(s("F-09").answer, { kind: "yes_no", value: null });
  assert.equal(s("F-10").paragraphs[0].text, "Office administrator");

  for (const key of ["F-11", "F-12", "F-13"]) {
    assert.equal(s(key).kind, "declaration");
    assert.equal(s(key).status, "complete");
    assert.equal(s(key).paragraphs.length, 0);
  }
  assert.deepEqual(report.gaps, []);
});

test("a value missing from the record is left blank with a system gap (never guessed)", () => {
  const bundle = getDemoBundle("megan-hart");
  delete bundle.registration.occupation;
  const { report } = build(bundle);
  const section = report.sections.find((x) => x.key === "F-10");
  assert.equal(section?.status, "needs_input");
  assert.deepEqual(section?.paragraphs, []);
  assert.equal(report.gaps.length, 1);
  assert.equal(report.gaps[0].sectionKey, "F-10");
  assert.equal(report.gaps[0].raisedBy, "system");
});

test("referrer names: same organisation or two distinctive words in common", () => {
  assert.ok(referrerNamesMatch("Harrow & Pike Solicitors (fictional)", "Harrow & Pike Medico-Legal (fictional)"));
  assert.ok(referrerNamesMatch("Kingsway Case Management (fictional)", "kingsway case management"));
  assert.ok(!referrerNamesMatch("Northfield Freight Ltd (fictional)", "Northfield Assurance (fictional)"), "one shared word is not enough");
  assert.ok(!referrerNamesMatch("Harrow & Pike Solicitors (fictional)", "Northgate Medical Reporting (fictional)"));
});

test("another organisation's form: its own reference is left blank for staff, never the referral's", () => {
  // "Your reference" on Northgate's form is Northgate's number, not the solicitor's.
  const { report } = build(getDemoBundle("megan-hart"), party());
  const section = report.sections.find((x) => x.key === "F-03");
  assert.deepEqual(section?.paragraphs, []);
  assert.equal(report.gaps.length, 1);
  assert.equal(report.gaps[0].id, "gap-F-03-referrer");
  assert.equal(report.gaps[0].sectionKey, "F-03");
  assert.equal(report.gaps[0].raisedBy, "system");
  assert.match(report.gaps[0].issue, /Harrow & Pike Solicitors \(fictional\)/);
  assert.match(report.gaps[0].issue, /Northgate Medical Reporting \(fictional\)/);
  assert.match(report.gaps[0].suggestedQuestion, /HP\/RTA\/2291/, "offers the referral's value if that is what they asked for");
});

test("another organisation's form that asks for the referral party's reference gets it by code", () => {
  const field = { label: "Instructing party reference", guidance: "" };
  assert.equal(asksForReferralPartyReference(field, { name: "Harrow & Pike Solicitors (fictional)", type: "solicitor" }, "Northgate Medical Reporting (fictional)"), true);
  assert.equal(asksForReferralPartyReference({ label: "Employer / client reference", guidance: "" }, { name: "Ashby Freight Ltd (fictional)", type: "employer" }, "Kingsway Case Management (fictional)"), true);
  assert.equal(asksForReferralPartyReference({ label: "Kingsway case no.", guidance: "" }, { name: "Ashby Freight Ltd (fictional)", type: "employer" }, "Kingsway Case Management (fictional)"), false);
  assert.equal(asksForReferralPartyReference({ label: "Policy / claim no.", guidance: "The insurer's policy or claim number." }, { name: "Harrow & Pike Solicitors (fictional)", type: "solicitor" }, "Northfield Assurance (fictional)"), false);
  assert.equal(asksForReferralPartyReference({ label: "Your reference", guidance: "" }, { name: "Harrow & Pike Solicitors (fictional)", type: "solicitor" }, "Northgate Medical Reporting (fictional)"), false);
});

test("a proposed map that sends the referral's reference to both reference blanks still fills only the right one", async () => {
  // The recorded Kingsway analysis maps "Employer / client reference" AND "Kingsway case no." to
  // referral.reference (with a "check each is right" note). Code still copies the employer's reference
  // only into the employer's blank; Kingsway's own number is left blank with a gap for staff.
  const { getRecordedFormMap } = await import("../../src/modules/medreport/ai/recorded-forms");
  const { getDemoBundle } = await import("./dev-bundles");
  const form = getRecordedFormMap("kingsway-rtw-assessment");
  assert.ok(form);
  const [client, own] = ["Employer / client reference", "Kingsway case no."].map((label) => form.fields.find((f) => f.label === label));
  assert.ok(client && own);
  assert.deepEqual([client.fillSource, own.fillSource], [{ kind: "registration", path: "referral.reference" }, { kind: "registration", path: "referral.reference" }]);
  const bundle = getDemoBundle("daniel-brooks");
  const report = createFormReport({ form, bundle, instructingParty: bundle.referral, computedFacts: computeFacts(bundle, { asOf: "2026-10-06" }) });
  assert.deepEqual(report.sections.find((x) => x.key === client.id)?.paragraphs.map((p) => p.text), ["AF-OH-0457"]);
  assert.deepEqual(report.sections.find((x) => x.key === own.id)?.paragraphs, []);
  const gap = report.gaps.find((g) => g.sectionKey === own.id);
  assert.match(gap?.issue ?? "", /Kingsway Case Management \(fictional\) uses its own reference/);
  assert.match(gap?.suggestedQuestion ?? "", /What is Kingsway Case Management \(fictional\)'s own reference/);
});

test("draft groups for a form report hold up to MAX_FORM_FIELDS_PER_DRAFT fields", () => {
  const { form, report } = build();
  assert.deepEqual(planDraftGroups(report, formToTemplate(form)), [["F-07", "F-08", "F-09"]]);
});

test("validators: structured and sign-off answers are not 'empty'; undrafted fields are", () => {
  const { form, report } = build();
  const result = validateReport(report, formToTemplate(form));
  const empty = result.flags.filter((f) => f.code === "MISSING_PLACEHOLDER" && f.evidence === "empty section").map((f) => f.sectionKey);
  assert.deepEqual(empty.sort(), ["F-07", "F-08", "F-09"]);
  assert.equal(result.canSign, false);
});

test("buildFormAnswers: text, structured values, blank sign-off on a draft, filled on approval", () => {
  const { form, report } = build();
  const answered = {
    ...report,
    sections: report.sections.map((s) => (s.key === "F-09" ? { ...s, answer: { kind: "yes_no" as const, value: false } } : s)),
  };
  const draft = buildFormAnswers(answered, form);
  assert.deepEqual(draft["F-01"], { text: "Megan Hart" });
  assert.deepEqual(draft["F-02"], { text: "22/11/1991", value: "1991-11-22" });
  assert.deepEqual(draft["F-07"], {});
  assert.deepEqual(draft["F-09"], { text: "No", value: false });
  assert.deepEqual(draft["F-11"], {});
  assert.equal("F-14" in draft, false);

  const final = buildFormAnswers(answered, form, {
    receipt: { signer: { name: "Sarah Reid", hcpc: "PH-DEMO-01" }, signedAt: "2026-10-06T23:30:00.000Z" },
  });
  assert.deepEqual(final["F-11"], { text: "Sarah Reid", value: "Sarah Reid" });
  // 23:30 UTC on 06/10 is 00:30 on 07/10 in London (BST).
  assert.deepEqual(final["F-12"], { text: "07/10/2026", value: "2026-10-07" });
  assert.match(final["F-13"].text ?? "", /^Sarah Reid – approved electronically on 07\/10\/2026$/);
});

test("block IDs round-trip and reject malformed IDs", () => {
  assert.deepEqual(parseBlockId("p12"), { kind: "paragraph", p: 12 });
  assert.deepEqual(parseBlockId("t2.r3.c1"), { kind: "cell", cells: [{ t: 2, r: 3, c: 1 }] });
  assert.deepEqual(parseBlockId("t2.r3.c1.t0.r1.c2.p3"), {
    kind: "cell",
    cells: [
      { t: 2, r: 3, c: 1 },
      { t: 0, r: 1, c: 2 },
    ],
    p: 3,
  });
  assert.equal(formatCellBlockId([{ t: 2, r: 3, c: 1 }, { t: 0, r: 1, c: 2 }], 3), "t2.r3.c1.t0.r1.c2.p3");
  for (const bad of ["", "x1", "t1.r2", "p", "t1.r2.c3.p", "t1.r2.c3.x4", "p1.t0.r0.c0"]) assert.equal(parseBlockId(bad), null, bad);
});

test("checkFormDefinition catches mapping problems in plain English", () => {
  assert.deepEqual(checkFormDefinition(demoForm()), []);
  const broken = demoForm();
  broken.fields[0] = { ...broken.fields[0], anchor: { kind: "pdf_field", fieldName: "name", fieldType: "text" } };
  broken.fields[1] = { ...broken.fields[1], id: "F-01" };
  const problems = checkFormDefinition(broken);
  assert.ok(problems.some((p) => /Word form needs a Word anchor/.test(p)));
  assert.ok(problems.some((p) => /F-01 is used by more than one question/.test(p)));
});

test("request schemas: form drafts may carry more fields per call; render accepts 'original'", () => {
  const bundle = getDemoBundle("megan-hart");
  const base = { templateId: "form:frm_demo_northgate", bundle, instructingParty: party(), sectionKeys: ["F-07", "F-08", "F-09"] };
  assert.equal(DraftsRequestSchema.safeParse(base).success, false, "3 keys need a form");
  assert.equal(DraftsRequestSchema.safeParse({ ...base, form: demoForm() }).success, true);
  assert.equal(RenderQuerySchema.safeParse({ format: "original" }).success, true);
});
