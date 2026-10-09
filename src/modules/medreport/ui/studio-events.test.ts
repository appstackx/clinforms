/** Product-event properties carry nothing that identifies a patient, a clinician, a clinic or a file. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FormDefinition, Report } from "../core/types";
import { downloadFormat, durationSeconds, formEventProps, reportEventProps } from "./studio-events";

const ALLOWED_KEYS = new Set(["source", "form_kind", "format", "mode", "referrer_type", "question_count", "answer_count", "gap_count", "duration_s", "batch"]);
const TOKENS: Record<string, readonly string[]> = {
  source: ["clinic_system", "simulated_clinic_system", "export_upload", "notes_pdf"],
  form_kind: ["docx", "pdf_fillable", "pdf_flat", "questions"],
  format: ["docx", "pdf"],
  mode: ["demo", "live"],
  referrer_type: ["insurer", "medico_legal", "solicitor", "case_manager", "employer", "other"],
};

/** Every value is an allow-listed token, a small whole number or a boolean. */
function assertNonIdentifying(props: object): void {
  for (const [key, value] of Object.entries(props)) {
    assert.ok(ALLOWED_KEYS.has(key), `unexpected key ${key}`);
    if (typeof value === "string") assert.ok(TOKENS[key]?.includes(value), `${key}=${value}`);
    else if (typeof value === "number") assert.ok(Number.isInteger(value) && value >= 0 && value <= 100_000, `${key}=${value}`);
    else assert.equal(typeof value, "boolean", key);
  }
}

const SECRETS = ["Megan Hart", "Harrow & Pike", "harrow-pike.docx", "sim-pat-001", "rpt_secret", "form_secret", "PH-DEMO-01", "Sarah Reid"];

function form(overrides: Partial<FormDefinition> = {}): FormDefinition {
  return {
    id: "form_secret",
    title: "Harrow & Pike report",
    referrer: { name: "Harrow & Pike", type: "mlc" },
    kind: "docx",
    file: { sha256: "a".repeat(64), fileName: "harrow-pike.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    fields: [{ id: "F-01" }, { id: "F-02" }, { id: "F-03" }],
    analysis: { mode: "live" },
    ...overrides,
  } as unknown as FormDefinition;
}

function report(overrides: Partial<Report> = {}): Report {
  return {
    id: "rpt_secret",
    patientLabel: "Megan Hart",
    episodeRef: { connectorId: "file-import", patientId: "sim-pat-001", episodeId: "ep" },
    instructingParty: { type: "solicitor", name: "Harrow & Pike", reference: "R1", contactName: "x" },
    form: { formId: "form_secret", title: "Harrow & Pike report", referrer: { name: "Harrow & Pike", type: "insurer" }, fileSha256: "a".repeat(64), kind: "pdf_acroform" },
    sections: [
      { key: "F-01", status: "complete" },
      { key: "F-02", status: "drafted" },
      { key: "F-03", status: "needs_input" },
      { key: "F-04", status: "pending" },
    ],
    gaps: [{ id: "g1" }, { id: "g2", resolution: { by: "Sarah Reid" } }],
    generation: [{ mode: "demo_recorded" }, { mode: "live" }],
    author: { name: "Sarah Reid", hcpc: "PH-DEMO-01" },
    ...overrides,
  } as unknown as Report;
}

describe("formEventProps", () => {
  it("kind, referrer type, question count and how it was read – nothing else", () => {
    const props = formEventProps(form());
    assert.deepEqual(props, { form_kind: "docx", referrer_type: "medico_legal", question_count: 3, mode: "live" });
    assertNonIdentifying({ ...props });
    const text = JSON.stringify(props);
    for (const s of SECRETS) assert.ok(!text.includes(s), s);
  });
  it("maps every form kind and reading mode", () => {
    assert.equal(formEventProps(form({ kind: "pdf_acroform" })).form_kind, "pdf_fillable");
    assert.equal(formEventProps(form({ kind: "pdf_flat" })).form_kind, "pdf_flat");
    assert.equal(formEventProps(form({ kind: "questions" })).form_kind, "questions");
    assert.equal(formEventProps(form({ analysis: { mode: "rules" } } as Partial<FormDefinition>)).mode, "demo");
    assert.equal(formEventProps(form({ analysis: undefined } as Partial<FormDefinition>)).mode, undefined);
  });
});

describe("reportEventProps", () => {
  it("source, form kind, referrer type and counts – never names or ids", () => {
    const props = reportEventProps(report());
    assert.deepEqual(props, {
      source: "export_upload",
      form_kind: "pdf_fillable",
      referrer_type: "insurer",
      question_count: 4,
      answer_count: 2,
      gap_count: 1,
      mode: "live",
    });
    assertNonIdentifying({ ...props });
    const text = JSON.stringify(props);
    for (const s of SECRETS) assert.ok(!text.includes(s), s);
  });
  it("a built-in report uses the instructing party's type; no drafting means no mode", () => {
    const props = reportEventProps(report({ form: undefined, generation: [], episodeRef: { connectorId: "tm3", patientId: "p", episodeId: "e" } } as Partial<Report>));
    assert.equal(props.form_kind, undefined);
    assert.equal(props.referrer_type, "solicitor");
    assert.equal(props.source, "clinic_system");
    assert.equal(props.mode, undefined);
    assertNonIdentifying({ ...props });
  });
});

describe("helpers", () => {
  it("durationSeconds rounds and drops nonsense", () => {
    assert.equal(durationSeconds(1_000, 13_400), 12);
    assert.equal(durationSeconds(5_000, 1_000), undefined);
  });
  it("downloadFormat", () => {
    assert.equal(downloadFormat("application/pdf"), "pdf");
    assert.equal(downloadFormat("application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "docx");
  });
});
