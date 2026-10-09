/**
 * Multi-party forms in the analysis (insurer claim forms with the policyholder's, the patient's, the GP's
 * and the clinic's parts on one form): the label classifier's party and record rules, rules mode on a
 * PDF outline with sections, post-validation of a (fake) live proposal, the live output schema, and an
 * uploaded multi-party PDF end to end (rules mode) – the clinician's sign-off only in the clinic's
 * declaration, never in the policyholder's signature box.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts, type PDFPage } from "pdf-lib";
import { checkFormDefinition } from "../core/forms";
import { RegistrationPathSchema } from "../core/schemas";
import type { FillSource, FormField, OutlineBlock, PdfFormOutline, RegistrationPath } from "../core/types";
import { decodeFormFile } from "../forms/file";
import { analyseFormFile } from "./analyse-form";
import { AnalysisFieldOutputSchema, AnalysisOutputSchema, LenientAnalysisOutputSchema, type AnalysisFieldOutput } from "./form-analysis-schema";
import { classifyLabel } from "./form-classify";
import { renderPdfOutline, summariseParsedForm, type ParsedForm } from "./form-outline";
import { postValidateFields } from "./form-postvalidate";
import { proposeFieldsByRules } from "./form-rules";

/** A registration path that may not exist yet (record fields added with the insurer forms). */
function regOr(path: string, fallback: FillSource): FillSource {
  return (RegistrationPathSchema.options as readonly string[]).indexOf(path) >= 0 ? { kind: "registration", path: path as RegistrationPath } : fallback;
}

test("classifier: another party's part of the form is left blank, whatever it asks", () => {
  for (const party of ["patient", "policyholder", "doctor", "insurer"] as const) {
    const cls = classifyLabel("Date of birth", "Section 1", party);
    assert.deepEqual(cls.fillSource, { kind: "leave_blank" }, party);
    assert.equal(cls.completedBy, party);
  }
  // Read from the section heading when the caller has no outline party.
  assert.deepEqual(classifyLabel("Diagnosis", "Part B – to be completed by your GP").fillSource, { kind: "leave_blank" });
  assert.equal(classifyLabel("Diagnosis", "Part B – to be completed by your GP").completedBy, "doctor");
  assert.equal(classifyLabel("Diagnosis", "Section 4 – to be completed by your practitioner").fillSource.kind, "notes_narrative");
  assert.equal(classifyLabel("Diagnosis", "Section 4 – to be completed by your practitioner").completedBy, "clinic");
  // A question put to the patient in the second person.
  assert.equal(classifyLabel("When did you first notice your symptoms?").completedBy, "patient");
  assert.equal(classifyLabel("What medication has your doctor prescribed for your condition?").fillSource.kind, "leave_blank");
  assert.equal(classifyLabel("Was the patient referred to you?").completedBy, undefined, "addressed to the clinician");
  assert.equal(classifyLabel("Please describe the treatment you provided").completedBy, undefined);
});

test("classifier: sign-off only where the clinic signs", () => {
  const signoff = (part: string) => ({ kind: "signoff", part });
  assert.deepEqual(classifyLabel("Policyholder’s signature:").fillSource, { kind: "leave_blank" });
  assert.equal(classifyLabel("Policyholder’s signature:").completedBy, "policyholder");
  assert.deepEqual(classifyLabel("Signature of medical practitioner").fillSource, { kind: "leave_blank" });
  assert.deepEqual(classifyLabel("Patient's signature", "Declaration").fillSource, { kind: "leave_blank" });
  assert.deepEqual(classifyLabel("Date", "8. Signature", "policyholder").fillSource, { kind: "leave_blank" });
  assert.deepEqual(classifyLabel("Doctor’s name", "7. I declare that the information is true").fillSource, { kind: "leave_blank" });
  // The clinic's declaration (explicit or by default on a form sent to the clinic).
  assert.deepEqual(classifyLabel("Signature", "Therapist's declaration").fillSource, signoff("signature"));
  assert.deepEqual(classifyLabel("Date", "Therapist's declaration").fillSource, signoff("date"));
  assert.deepEqual(classifyLabel("Therapist’s name", "Therapist's declaration").fillSource, signoff("name"));
  assert.equal(classifyLabel("Therapist’s name", "Therapist's declaration").completedBy, "clinic");
  assert.deepEqual(classifyLabel("Please print name", "6 Your signature", "clinic").fillSource, signoff("name"));
  assert.deepEqual(classifyLabel("Signature").fillSource, signoff("signature"));
  // Declarations of a list of parties ("Patient or parent/guardian", "Policyholder/patient"): a bare
  // "Signature" or "Date" under them is theirs, never the clinician's sign-off.
  for (const [heading, party] of [
    ["Patient or parent/guardian declaration", "patient"],
    ["Policyholder/patient declaration", "policyholder"],
    ["Patient / Policyholder Declaration", "patient"],
    ["Claimant's / patient's declaration", "patient"],
  ] as const) {
    for (const label of ["Signature", "Date"]) {
      const cls = classifyLabel(label, heading);
      assert.deepEqual(cls.fillSource, { kind: "leave_blank" }, `${label} under “${heading}”`);
      assert.equal(cls.completedBy, party, `${label} under “${heading}”`);
    }
  }
  assert.deepEqual(classifyLabel("Signature", "Therapist / physiotherapist declaration").fillSource, signoff("signature"));
  // Not a signature box: a checklist question, and a bare "Date" outside any declaration.
  assert.notEqual(classifyLabel("signed and dated the form?").fillSource.kind, "signoff");
  assert.deepEqual(classifyLabel("Date").fillSource, { kind: "registration", path: "report.date" });
});

test("classifier: insurer-form record fields, bank details and the therapist's own details", () => {
  // Bare "Name" under the therapist's details is the clinician (it was the patient's name).
  assert.deepEqual(classifyLabel("Name", "2 Therapist details").fillSource, { kind: "registration", path: "clinician.name" });
  assert.deepEqual(classifyLabel("Name", "1 Patient’s details").fillSource, { kind: "registration", path: "patient.fullName" });
  // Membership / customer / scheme numbers are identifiers, filled by code.
  for (const label of ["Bupa membership number", "Membership number/customer number", "Scheme number", "Member Number", "Customer no."]) {
    const cls = classifyLabel(label);
    assert.equal(cls.identifier, true, label);
    assert.deepEqual(cls.fillSource, regOr("referral.membershipNumber", { kind: "registration", path: "referral.reference" }), label);
  }
  assert.deepEqual(classifyLabel("Pre-authorisation number").fillSource, regOr("referral.authorisationNumber", { kind: "registration", path: "referral.reference" }));
  const provider = classifyLabel("Bupa provider number");
  assert.deepEqual([provider.fillSource.kind, provider.identifier], ["leave_blank", true], "never drafted");
  // Bank and payment details are the referrer's / policyholder's business.
  for (const label of ["IBAN number", "BIC/Swift code", "Account holder’s name(s)", "Account number", "Sort code", "Bank name", "Bank address", "Cheques payable to", "Preferred payment method (please tick)"]) {
    assert.equal(classifyLabel(label).fillSource.kind, "leave_blank", label);
  }
  assert.deepEqual(classifyLabel("Treatment start date").fillSource, { kind: "registration", path: "episode.firstSeen" });
  assert.equal(classifyLabel("Claimant's reference", "Section E – to be completed by the instructing solicitor").fillSource.kind, "leave_blank");
  // Phone and e-mail: the patient's or the clinic's, by code (never drafted); anyone else's left blank.
  assert.deepEqual(classifyLabel("Phone number", "About the patient").fillSource, regOr("patient.phone", { kind: "leave_blank" }));
  assert.equal(classifyLabel("Phone number", "About the patient").identifier, true);
  assert.deepEqual(classifyLabel("Email address").fillSource, regOr("patient.email", { kind: "leave_blank" }));
  assert.deepEqual(classifyLabel("Telephone number", "2 Therapist details").fillSource, regOr("clinic.phone", { kind: "leave_blank" }));
  assert.deepEqual(classifyLabel("Email", "Therapist’s details").fillSource, regOr("clinic.email", { kind: "leave_blank" }));
  assert.deepEqual(classifyLabel("Telephone number of GP’s surgery").fillSource, { kind: "leave_blank" });
  assert.deepEqual(classifyLabel("Fax number", "2 Therapist details").fillSource, { kind: "leave_blank" });
  assert.deepEqual(classifyLabel("Daytime phone number (incl. country code and area code)").fillSource, regOr("patient.phone", { kind: "leave_blank" }));
  assert.deepEqual(classifyLabel("Mobile").fillSource, regOr("patient.phone", { kind: "leave_blank" }));
  // Not contact-details boxes.
  assert.notEqual(classifyLabel("Number of telephone consultations").fillSource.kind, "leave_blank");
  assert.equal(classifyLabel("Are the symptoms worse in the evening?").fillSource.kind, "notes_narrative");
  assert.equal(classifyLabel("Is the patient mobile and independent?").fillSource.kind, "notes_narrative");
});

/** A multi-party AcroForm outline as readPdfForm returns it (sections from forms/pdf-sections.ts). */
const S1 = "1. Policyholder’s details – to be completed by the policyholder";
const S3 = "3. Therapist's declaration";
const S4 = "4. Signature";
function f(name: string, y: number, nearbyText: string, section?: string, completedBy?: FormField["completedBy"], page = 1): PdfFormOutline["fields"][number] {
  return { name, type: "text", page, rect: { x: 160, y, width: 220, height: 16 }, nearbyText, ...(section && { section }), ...(completedBy && { completedBy }) };
}
const OUTLINE: PdfFormOutline = {
  pages: 2,
  fields: [
    f("surname", 730, "Surname:", S1, "policyholder"),
    f("dob", 705, "Date of birth:", S1, "policyholder"),
    f("tname", 600, "Name", "2 Therapist details", "clinic"),
    f("start", 560, "Treatment start date:", "2 Therapist details", "clinic"),
    f("thname", 690, "Therapist's name:", S3, "clinic", 2),
    f("thdate", 670, "Date:", S3, "clinic", 2),
    f("phsig", 575, "Policyholder's signature:", S4, "policyholder", 2),
    f("phdate", 555, "Date:", S4, "policyholder", 2),
  ],
  pageText: [
    { page: 1, items: [{ str: S1, x: 40, y: 760, section: S1, completedBy: "policyholder" }] },
    { page: 2, items: [{ str: S4, x: 40, y: 630, section: S4, completedBy: "policyholder" }] },
  ],
};
const PARSED: ParsedForm = { kind: "pdf_acroform", pdf: OUTLINE, warnings: [] };

const summary = (fields: FormField[]) =>
  Object.fromEntries(fields.map((x) => [x.anchor.kind === "pdf_field" ? x.anchor.fieldName : x.label, `${x.fillSource.kind === "signoff" ? `signoff:${x.fillSource.part}` : x.fillSource.kind === "registration" ? x.fillSource.path : x.fillSource.kind}|${x.completedBy ?? "-"}|${x.section ?? ""}`]));

test("rules mode uses the outline's sections: sign-off only in the clinic's declaration", () => {
  const res = postValidateFields(PARSED, proposeFieldsByRules(PARSED), { confidenceCap: "low" });
  assert.deepEqual(summary(res.fields), {
    surname: `leave_blank|policyholder|${S1}`,
    dob: `leave_blank|policyholder|${S1}`,
    tname: "clinician.name|clinic|2 Therapist details",
    start: "episode.firstSeen|clinic|2 Therapist details",
    thname: `signoff:name|clinic|${S3}`,
    thdate: `signoff:date|clinic|${S3}`,
    phsig: `leave_blank|policyholder|${S4}`,
    phdate: `leave_blank|policyholder|${S4}`,
  });
  assert.deepEqual(checkFormDefinitionOf(res.fields), []);
  // The live prompt sees the sections, and the outline summary lists them.
  assert.match(renderPdfOutline(OUTLINE, "pdf_acroform"), /field "phsig" text page 2 .* section="4\. Signature" completedBy=policyholder/);
  assert.deepEqual(summariseParsedForm(PARSED).headings, [S1, S4]);
});

function raw(over: Partial<AnalysisFieldOutput>): AnalysisFieldOutput {
  return {
    label: "Question",
    section: "",
    guidance: "What the referrer wants.",
    answerType: "short_text",
    options: [],
    anchorTarget: "pdf_field",
    anchorRef: "",
    placeholderText: "",
    optionAnchors: [],
    overlay: { page: 0, x: 0, y: 0, width: 0, height: 0 },
    fillSource: "notes_narrative",
    registrationPath: "none",
    computedFact: "none",
    computedFormat: "none",
    signoffPart: "none",
    required: true,
    confidence: "high",
    note: "",
    ...over,
  };
}

test("post-validation of a live proposal: the outline's party wins, sign-off is refused for others", () => {
  const res = postValidateFields(PARSED, [
    // The proposal puts the clinician's approval into the policyholder's boxes (and calls it the clinic's).
    raw({ label: "Policyholder's signature", anchorRef: "phsig", answerType: "signature", fillSource: "signoff", signoffPart: "signature", completedBy: "clinic" }),
    raw({ label: "Date", anchorRef: "phdate", answerType: "date_signed", fillSource: "signoff", signoffPart: "date" }),
    raw({ label: "Surname", anchorRef: "surname", fillSource: "registration", registrationPath: "patient.lastName", section: "" }),
    raw({ label: "Therapist's name", anchorRef: "thname", answerType: "clinician_name", fillSource: "signoff", signoffPart: "name" }),
  ]);
  const by = Object.fromEntries(res.fields.map((x) => [x.label, x]));
  assert.deepEqual(by["Policyholder's signature"].fillSource, { kind: "leave_blank" });
  assert.equal(by["Policyholder's signature"].completedBy, "policyholder");
  assert.match(by["Policyholder's signature"].note ?? "", /for the policyholder, so the clinician's approval is not written there/);
  assert.deepEqual(by.Date.fillSource, { kind: "leave_blank" });
  assert.deepEqual(by.Surname.fillSource, { kind: "leave_blank" });
  assert.equal(by.Surname.section, S1, "the outline's heading when the proposal gives none");
  assert.match(by.Surname.note ?? "", /for the policyholder to complete, so it is left blank/);
  assert.deepEqual(by["Therapist's name"].fillSource, { kind: "signoff", part: "name" });
  assert.equal(by["Therapist's name"].completedBy, "clinic");
  assert.deepEqual(checkFormDefinitionOf(res.fields), []);
});

const p = (id: string, text: string, extra: Partial<OutlineBlock> = {}): OutlineBlock => ({ id, kind: "paragraph", text, isEmpty: text.trim() === "", hasPlaceholder: false, ...extra });

test("post-validation of a live proposal on a Word form: the proposal's party and the heading's wording", () => {
  const docx: ParsedForm = {
    kind: "docx",
    warnings: [],
    blocks: [
      p("p0", "Part A – Treatment", { headingLevel: 1 }),
      p("p1", "Treatment provided:"),
      p("p2", ""),
      p("p3", "Part B – to be completed by the GP", { headingLevel: 1 }),
      p("p4", "GP's diagnosis:"),
      p("p5", ""),
      p("p6", "Patient's comments:"),
      p("p7", ""),
    ],
  };
  const res = postValidateFields(docx, [
    raw({ label: "Treatment provided", section: "Part A – Treatment", anchorTarget: "after_paragraph", anchorRef: "p1", completedBy: "clinic" }),
    raw({ label: "GP's diagnosis", section: "Part B – to be completed by the GP", anchorTarget: "after_paragraph", anchorRef: "p4", completedBy: "unknown" }),
    raw({ label: "Patient's comments", section: "", anchorTarget: "after_paragraph", anchorRef: "p6", completedBy: "patient" }),
  ]);
  assert.deepEqual(summary(res.fields), {
    "Treatment provided": "notes_narrative|clinic|Part A – Treatment",
    "GP's diagnosis": "leave_blank|doctor|Part B – to be completed by the GP",
    "Patient's comments": "leave_blank|patient|",
  });
});

test("rules mode on a Word form: a 'to be completed by' line switches who completes the questions under it", () => {
  const docx: ParsedForm = {
    kind: "docx",
    warnings: [],
    blocks: [
      p("p0", "Part A – Treatment", { headingLevel: 1 }),
      p("p1", "Treatment provided:"),
      p("p2", ""),
      p("p3", "Part B – Medical report", { headingLevel: 1 }),
      p("p4", "This part is to be completed by the patient's GP."),
      p("p5", "Diagnosis:"),
      p("p6", ""),
      p("p7", "Signature:"),
      p("p8", ""),
      p("p9", "Part C – Declaration", { headingLevel: 1 }),
      p("p10", "Signed: [signature]   Date: [date]", { hasPlaceholder: true, placeholderText: "[signature]" }),
    ],
  };
  const res = postValidateFields(docx, proposeFieldsByRules(docx), { confidenceCap: "low" });
  assert.deepEqual(summary(res.fields), {
    "Treatment provided": "notes_narrative|-|Part A – Treatment",
    Diagnosis: "leave_blank|doctor|Part B – Medical report",
    Signature: "leave_blank|doctor|Part B – Medical report",
    Signed: "signoff:signature|-|Part C – Declaration",
    Date: "signoff:date|-|Part C – Declaration",
  });
  assert.deepEqual(checkFormDefinitionOf(res.fields.map((x) => ({ ...x, anchor: { kind: "pdf_field", fieldName: x.id, fieldType: "text" } }))), []);
});

test("post-validation: a section whose questions are put to the patient is the patient's", () => {
  const section = "3.2 About the claim";
  const outline: PdfFormOutline = {
    pages: 1,
    fields: ["a", "b", "c", "d", "e"].map((n, i) => f(n, 700 - i * 60, "", section)),
    pageText: [],
  };
  const parsed: ParsedForm = { kind: "pdf_acroform", pdf: outline, warnings: [] };
  const res = postValidateFields(parsed, [
    raw({ label: "Why did you go to the doctor or hospital?", anchorRef: "a" }),
    raw({ label: "When did you first notice your symptoms?", anchorRef: "b" }),
    raw({ label: "What did the doctor say was wrong with you?", anchorRef: "c" }),
    raw({ label: "What treatment has the doctor recommended?", anchorRef: "d", fillSource: "clinician_opinion" }),
    raw({ label: "receive?", anchorRef: "e" }),
  ]);
  assert.ok(res.fields.every((x) => x.fillSource.kind === "leave_blank" && x.completedBy === "patient"), JSON.stringify(summary(res.fields)));
  assert.match(res.fields[3].note ?? "", /put to the patient/);

  // Not when one of them is marked for the clinic, or when only a few ask the patient.
  const mixed = postValidateFields(parsed, [
    raw({ label: "Why did you go to the doctor or hospital?", anchorRef: "a" }),
    raw({ label: "When did you first notice your symptoms?", anchorRef: "b" }),
    raw({ label: "Treatment provided", anchorRef: "c" }),
    raw({ label: "Progress", anchorRef: "d" }),
    raw({ label: "Plan", anchorRef: "e" }),
  ]);
  assert.deepEqual(mixed.fields.map((x) => x.fillSource.kind), ["leave_blank", "leave_blank", "notes_narrative", "notes_narrative", "notes_narrative"]);
});

test("post-validation of a flat-PDF box: the section of its label", () => {
  const outline: PdfFormOutline = {
    pages: 1,
    fields: [],
    pageText: [
      {
        page: 1,
        items: [
          { str: "2. Treatment", x: 50, y: 700, section: "2. Treatment" },
          { str: "Treatment given:", x: 50, y: 680, section: "2. Treatment" },
          { str: "I declare that the information above is correct.", x: 50, y: 520, section: "I declare that the information above is correct.", completedBy: "doctor" },
          { str: "Date:", x: 50, y: 480, section: "I declare that the information above is correct.", completedBy: "doctor" },
        ],
      },
    ],
  };
  const parsed: ParsedForm = { kind: "pdf_flat", pdf: outline, warnings: [] };
  const res = postValidateFields(parsed, [
    raw({ label: "Treatment given", anchorTarget: "pdf_overlay", overlay: { page: 1, x: 130, y: 677, width: 400, height: 14 } }),
    raw({ label: "Date", anchorTarget: "pdf_overlay", answerType: "date_signed", fillSource: "signoff", signoffPart: "date", overlay: { page: 1, x: 90, y: 477, width: 120, height: 14 } }),
  ]);
  assert.deepEqual(summary(res.fields), {
    "Treatment given": "notes_narrative|-|2. Treatment",
    Date: "leave_blank|doctor|I declare that the information above is correct.",
  });
});

test("live output schema: who completes each answer space (lenient: unknown)", () => {
  assert.deepEqual(AnalysisFieldOutputSchema.shape.completedBy.options, ["clinic", "patient", "policyholder", "doctor", "insurer", "unknown"]);
  const output = { title: "", referrerName: "", referrerType: "insurer", versionLabel: "", warnings: [], fields: [raw({ label: "Surname", anchorRef: "surname" })] };
  assert.equal(AnalysisOutputSchema.safeParse(output).success, false, "the strict schema asks for it");
  const lenient = LenientAnalysisOutputSchema.parse(output);
  assert.equal(lenient.fields[0].completedBy, "unknown");
  assert.equal(AnalysisOutputSchema.parse({ ...output, fields: [{ ...output.fields[0], completedBy: "policyholder" }] }).fields[0].completedBy, "policyholder");
});

function checkFormDefinitionOf(fields: FormField[]): string[] {
  return checkFormDefinition({
    id: "frm_t",
    tenantId: "demo",
    referrer: { name: "Example Health (fictional)", type: "insurer" },
    title: "Claim form",
    file: { fileName: "claim.pdf", mimeType: "application/pdf", sha256: "b".repeat(64), sizeBytes: 1 },
    kind: "pdf_acroform",
    fields,
    status: "proposed",
    analysis: { mode: "rules", promptVersion: "rules-1", at: "2026-10-09T09:00:00.000Z", warnings: [] },
    createdAt: "2026-10-09T09:00:00.000Z",
    updatedAt: "2026-10-09T09:00:00.000Z",
  });
}

/** A blank fictional insurer claim form: the policyholder's part, the therapist's declaration, the policyholder's signature. */
async function claimForm(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const form = doc.getForm();
  const page = doc.addPage([595, 842]);
  const text = (pg: PDFPage, s: string, y: number, size = 10, x = 40) => pg.drawText(s, { x, y, size, font: size > 10 ? bold : font });
  /** A label with its answer box just to the right of it. */
  const labelled = (label: string, name: string, y: number) => {
    text(page, label, y);
    form.createTextField(name).addToPage(page, { x: 46 + font.widthOfTextAtSize(label, 10), y: y - 5, width: 200, height: 16, font });
  };
  text(page, "Example Health (fictional) – outpatient claim form", 800, 16);
  text(page, "1. Policyholder's details – to be completed by the policyholder", 760, 12);
  labelled("Surname:", "surname", 735);
  labelled("Telephone numbers: Home", "phone", 710);
  text(page, "2. Therapist's declaration", 670, 12);
  text(page, "I confirm that the information I have given is correct.", 650);
  labelled("Therapist's name:", "thname", 625);
  labelled("Date:", "thdate", 600);
  text(page, "3. Signature", 560, 12);
  text(page, "The policyholder named in section 1 must sign and date below.", 540);
  labelled("Policyholder's signature:", "phsig", 515);
  labelled("Date:", "phdate", 490);
  for (let i = 0; i < 3; i += 1) text(page, "Send the completed form with your invoices to the claims team. Keep a copy for your own records.", 440 - i * 14);
  text(page, "Example Health (fictional). Registered address: 1 Example Street, Exampletown EX1 1AA. Company registration number: 01234567.", 30, 7);
  return doc.save();
}

test("an uploaded multi-party claim form (rules mode): sign-off only in the therapist's declaration, no false 'filled in' warning", async () => {
  const bytes = await claimForm();
  const file = decodeFormFile(Buffer.from(bytes).toString("base64"));
  const result = await analyseFormFile({ file, fileName: "claim.pdf", mode: "demo", rulesOnly: true });
  const by = Object.fromEntries(result.form.fields.map((x) => [x.anchor.kind === "pdf_field" ? x.anchor.fieldName : x.id, x]));
  assert.deepEqual(by.thname.fillSource, { kind: "signoff", part: "name" });
  assert.deepEqual(by.thdate.fillSource, { kind: "signoff", part: "date" });
  for (const name of ["surname", "phone", "phsig", "phdate"]) {
    assert.deepEqual(by[name].fillSource, { kind: "leave_blank" }, name);
    assert.equal(by[name].completedBy, "policyholder", name);
  }
  assert.equal(by.phsig.section, "3. Signature");
  assert.ok(result.form.fields.every((x) => x.fillSource.kind !== "signoff" || x.completedBy === "clinic"));
  assert.deepEqual(checkFormDefinition(result.form), []);
  assert.ok(!result.form.analysis.warnings.some((w) => /already contains details/.test(w)), result.form.analysis.warnings.join(" | "));
});
