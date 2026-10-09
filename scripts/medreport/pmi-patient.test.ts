/**
 * Case C (Rebecca Lane, sim-pat-006) on insurer forms, end to end without the real insurer PDFs: a
 * synthetic fillable "further treatment request" built with pdf-lib, mapped to the new record paths
 * (title, phone, insurer membership / authorisation numbers, clinic contact details), the "fixed" fill
 * source and computed facts → createFormReport → validateReport → buildFormAnswers → fillPdf, read back.
 * The same file mapped as ANOTHER insurer's form shows the insurer numbers withheld for staff, and drafted
 * wording on it says "the insurer" instead of the insurer on record's name.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { DEMO_CLINIC } from "../../src/modules/medreport/config.public";
import { computeFacts } from "../../src/modules/medreport/core/computed-facts";
import { buildFormAnswers, checkFormDefinition, formToTemplate, resolveRegistrationValue, splitUkAddress } from "../../src/modules/medreport/core/forms";
import { referralValueForPath, showsReferrerReferenceNotice } from "../../src/modules/medreport/core/form-record-rules";
import { createFormReport, planDraftGroups } from "../../src/modules/medreport/core/report-factory";
import { FormDefinitionSchema, ReportSchema } from "../../src/modules/medreport/core/schemas";
import type { FillSource, FormDefinition, FormField, InstructingParty, Report } from "../../src/modules/medreport/core/types";
import { validateReport } from "../../src/modules/medreport/core/validation";
import { fillPdf, joinExtraLines } from "../../src/modules/medreport/forms/pdf-fill";
import { getDemoBundle } from "./dev-bundles";

const NOW = new Date("2026-10-06T09:00:00.000Z");
const TITLES = ["Miss", "Mrs", "Ms", "Mr", "Dr", "Other"];

/** A synthetic insurer form (fictional layout): text fields, a title radio group and a tick box. */
async function syntheticInsurerForm(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  const form = doc.getForm();
  let y = 790;
  const text = (name: string, label: string, opts: { multiline?: boolean } = {}) => {
    page.drawText(label, { x: 40, y, size: 9, font });
    const tf = form.createTextField(name);
    if (opts.multiline) tf.enableMultiline();
    tf.addToPage(page, { x: 220, y: y - 5, width: 320, height: opts.multiline ? 40 : 16, font });
    y -= opts.multiline ? 54 : 26;
  };
  page.drawText("Title", { x: 40, y, size: 9, font });
  const rg = form.createRadioGroup("title");
  TITLES.forEach((t, i) => {
    rg.addOptionToPage(t, page, { x: 220 + i * 50, y: y - 2, width: 10, height: 10 });
    page.drawText(t, { x: 233 + i * 50, y, size: 8, font });
  });
  y -= 26;
  text("patientName", "Patient's name");
  text("dob", "Date of birth");
  text("membership", "Membership number");
  text("authorisation", "Pre-authorisation number");
  text("insurer", "Insurer");
  text("patientPhone", "Phone number");
  text("patientEmail", "Email address");
  text("therapistPhone", "Therapist's phone number");
  text("therapistEmail", "Therapist's email address");
  text("startDate", "Treatment start date");
  text("sessions", "Number of sessions to date");
  text("outcome", "Outcome measure (PSFS)", { multiline: true });
  text("country", "Country of treatment");
  page.drawText("Physiotherapist", { x: 56, y: y + 2, size: 9, font });
  form.createCheckBox("physio").addToPage(page, { x: 40, y, width: 11, height: 11 });
  y -= 26;
  text("additional", "Number of additional sessions requested");
  return doc.save();
}

let n = 0;
function field(label: string, fieldName: string, fillSource: FillSource, rest: Partial<FormField> = {}): FormField {
  n += 1;
  return {
    id: `F-${String(n).padStart(2, "0")}`,
    label,
    guidance: "",
    answerType: "short_text",
    anchor: { kind: "pdf_field", fieldName, fieldType: "text" },
    fillSource,
    required: true,
    confidence: "high",
    ...rest,
  };
}
const reg = (path: Extract<FillSource, { kind: "registration" }>["path"]): FillSource => ({ kind: "registration", path });

function insurerForm(referrer: FormDefinition["referrer"]): FormDefinition {
  n = 0;
  const fields: FormField[] = [
    field("Title", "title", reg("patient.title"), { answerType: "single_choice", options: TITLES, anchor: { kind: "pdf_field", fieldName: "title", fieldType: "radio", options: TITLES } }),
    field("Patient's name", "patientName", reg("patient.fullName")),
    field("Date of birth", "dob", reg("patient.dob"), { answerType: "date" }),
    field("Membership number", "membership", reg("referral.membershipNumber")),
    field("Pre-authorisation number", "authorisation", reg("referral.authorisationNumber"), { required: false }),
    field("Insurer", "insurer", reg("referral.insurerName")),
    field("Phone number", "patientPhone", reg("patient.phone")),
    field("Email address", "patientEmail", reg("patient.email"), { required: false }),
    field("Therapist's phone number", "therapistPhone", reg("clinic.phone")),
    field("Therapist's email address", "therapistEmail", reg("clinic.email")),
    field("Treatment start date", "startDate", reg("episode.firstSeen"), { answerType: "date" }),
    field("Number of sessions to date", "sessions", { kind: "computed_fact", factId: "FACT-attendance", format: "sessions_attended" }, { answerType: "number" }),
    field("Outcome measure (PSFS)", "outcome", { kind: "computed_fact", factId: "FACT-outcomes-PSFS", format: "summary" }, { answerType: "long_text" }),
    field("Country of treatment", "country", { kind: "fixed", value: "United Kingdom" }),
    field("Physiotherapist", "physio", { kind: "fixed", value: "Yes" }, { answerType: "checkbox", anchor: { kind: "pdf_field", fieldName: "physio", fieldType: "checkbox" } }),
    field("Number of additional sessions requested", "additional", { kind: "notes_narrative" }, { answerType: "number" }),
  ];
  return FormDefinitionSchema.parse({
    id: "frm_synthetic_insurer",
    tenantId: "demo",
    referrer,
    title: "Further treatment request (synthetic test form)",
    file: { fileName: "synthetic.pdf", mimeType: "application/pdf", sha256: "0".repeat(64), sizeBytes: 1 },
    kind: "pdf_acroform",
    fields,
    status: "confirmed",
    analysis: { mode: "rules", promptVersion: "test", at: "2026-10-01T09:00:00.000Z", warnings: [] },
    createdAt: "2026-10-01T09:00:00.000Z",
    updatedAt: "2026-10-01T09:00:00.000Z",
  });
}

function startReport(form: FormDefinition): Report {
  const bundle = getDemoBundle("rebecca-lane");
  const { type, name, reference, contactName, address } = bundle.referral;
  const party: InstructingParty = { type, name, reference, contactName, address };
  return createFormReport({ form, bundle, instructingParty: party, computedFacts: computeFacts(bundle, { asOf: "2026-10-06" }), now: NOW });
}

const answerOf = (r: Report, label: string) => r.sections.find((s) => s.title === label);

test("Case C on the insurer on record's form: every record value filled by code, cited, valid", () => {
  const form = insurerForm({ name: "Bupa", type: "insurer" });
  assert.deepEqual(checkFormDefinition(form), []);
  const r = startReport(form);
  assert.equal(ReportSchema.safeParse(r).success, true);
  const text = (label: string) => answerOf(r, label)?.paragraphs[0]?.text ?? null;
  assert.deepEqual(answerOf(r, "Title")?.answer, { kind: "choice", value: "Mrs" });
  assert.equal(text("Patient's name"), "Rebecca Lane");
  assert.equal(text("Date of birth"), "23/07/1981");
  assert.equal(text("Membership number"), "DEMO-POL-0001");
  assert.equal(text("Pre-authorisation number"), "DEMO-AUTH-0001");
  assert.equal(text("Insurer"), "Bupa");
  assert.equal(text("Phone number"), "07700 900614");
  assert.equal(text("Email address"), "rebecca.lane@example.com");
  assert.equal(text("Therapist's phone number"), DEMO_CLINIC.phone);
  assert.equal(text("Therapist's email address"), DEMO_CLINIC.email);
  assert.equal(text("Treatment start date"), "01/09/2026");
  assert.deepEqual(answerOf(r, "Number of sessions to date")?.answer, { kind: "number", value: "5" });
  // Plain words on the form: no "→", no internal note IDs (the fact's own detail cites N-001…).
  assert.match(text("Outcome measure (PSFS)") ?? "", /^PSFS 2\.7\/10, then 4\.3\/10, then 5\.3\/10 \(higher is better\)\. 01\/09\/2026: 2\.7\/10; 15\/09\/2026: 4\.3\/10/);
  assert.doesNotMatch(text("Outcome measure (PSFS)") ?? "", /\b[NA]-\d{3}\b|→/);
  assert.equal(text("Country of treatment"), "United Kingdom");
  assert.deepEqual(answerOf(r, "Physiotherapist")?.answer, { kind: "checkbox", value: true });
  // Identifiers are cited to the registration record; fixed answers cite nothing (they come from the map).
  assert.deepEqual(answerOf(r, "Membership number")?.paragraphs[0]?.sourceIds, ["REG"]);
  assert.deepEqual(answerOf(r, "Country of treatment")?.paragraphs[0]?.sourceIds, []);
  assert.ok(r.sections.filter((s) => s.kind === "from_records").every((s) => s.status === "complete"));
  assert.deepEqual(r.gaps, []);
  // Only the notes question is left for drafting.
  assert.deepEqual(planDraftGroups(r, formToTemplate(form)), [[answerOf(r, "Number of additional sessions requested")?.key]]);
  // No validator flag on any code-filled answer.
  const { flags } = validateReport(r, formToTemplate(form));
  const codeKeys = new Set(r.sections.filter((s) => s.kind === "from_records").map((s) => s.key));
  assert.deepEqual(flags.filter((f) => f.sectionKey && codeKeys.has(f.sectionKey)), []);
});

test("Case C on another insurer's form: membership and authorisation numbers withheld for staff", () => {
  const form = insurerForm({ name: "Northgate Assurance (fictional)", type: "insurer" });
  const r = startReport(form);
  const membership = answerOf(r, "Membership number");
  assert.deepEqual(membership?.paragraphs, []);
  assert.equal(membership?.status, "needs_input");
  assert.deepEqual(answerOf(r, "Pre-authorisation number")?.paragraphs, [], "optional: blank, no gap");
  assert.deepEqual(r.gaps.map((g) => [g.sectionKey, g.id.endsWith("-referrer")]), [[membership?.key, true]]);
  assert.match(r.gaps[0].issue, /the membership number on the clinic record \(“DEMO-POL-0001”\) is Bupa's/);
  // The review offers the record's number ("Use the referral's reference") and the referrer notice.
  assert.equal(referralValueForPath("referral.membershipNumber", r), "DEMO-POL-0001");
  assert.equal(showsReferrerReferenceNotice("referral.membershipNumber", form.referrer.name, r.bundleSnapshot), true);
  // Everything that is not the insurer's own identifier is still filled.
  assert.equal(answerOf(r, "Phone number")?.paragraphs[0]?.text, "07700 900614");
  assert.equal(answerOf(r, "Insurer")?.paragraphs[0]?.text, "Bupa");
});

test("Case C: the answers land in the synthetic PDF's fields (radio, text, tick box)", async () => {
  const form = insurerForm({ name: "Bupa", type: "insurer" });
  const r = startReport(form);
  const warnings: string[] = [];
  const out = await fillPdf(await syntheticInsurerForm(), form, buildFormAnswers(r, form), { draft: true, flatten: false, onWarning: (m) => warnings.push(m) });
  const pdf = (await PDFDocument.load(out)).getForm();
  assert.equal(pdf.getRadioGroup("title").getSelected(), "Mrs");
  const values = Object.fromEntries(
    ["patientName", "dob", "membership", "authorisation", "insurer", "patientPhone", "patientEmail", "therapistPhone", "therapistEmail", "startDate", "sessions", "country", "additional"].map((name) => [
      name,
      pdf.getTextField(name).getText() ?? "",
    ]),
  );
  assert.deepEqual(values, {
    patientName: "Rebecca Lane",
    dob: "23/07/1981",
    membership: "DEMO-POL-0001",
    authorisation: "DEMO-AUTH-0001",
    insurer: "Bupa",
    patientPhone: "07700 900614",
    patientEmail: "rebecca.lane@example.com",
    therapistPhone: DEMO_CLINIC.phone,
    therapistEmail: DEMO_CLINIC.email,
    startDate: "01/09/2026",
    sessions: "5",
    country: "United Kingdom",
    additional: "",
  });
  assert.equal(pdf.getCheckBox("physio").isChecked(), true);
  assert.match(pdf.getTextField("outcome").getText() ?? "", /PSFS 2\.7\/10, then 4\.3\/10, then 5\.3\/10/);
  assert.deepEqual(warnings.filter((w) => !/not answered|left blank/i.test(w)), []);

  // On another insurer's form the withheld numbers stay blank in the file.
  const other = insurerForm({ name: "Northgate Assurance (fictional)", type: "insurer" });
  const out2 = await fillPdf(await syntheticInsurerForm(), other, buildFormAnswers(startReport(other), other), { draft: true, flatten: false });
  const pdf2 = (await PDFDocument.load(out2)).getForm();
  assert.equal(pdf2.getTextField("membership").getText() ?? "", "");
  assert.equal(pdf2.getTextField("authorisation").getText() ?? "", "");
  assert.equal(pdf2.getTextField("patientPhone").getText(), "07700 900614");
});

test("Case C: insurer identifiers and contact details never reach the drafting service's view of the record", async () => {
  const { buildSourceTexts } = await import("../../src/modules/medreport/core/validation/sources");
  const bundle = getDemoBundle("rebecca-lane");
  const texts = Array.from(buildSourceTexts(bundle, computeFacts(bundle, { asOf: "2026-10-06" })).values()).join("\n");
  for (const secret of ["DEMO-POL-0001", "DEMO-AUTH-0001", "07700 900614", "rebecca.lane@example.com", "Rebecca", "Larkspur"]) {
    assert.equal(texts.includes(secret), false, secret);
  }
  // The insurer and the GP referral are context the record states (no identifiers).
  assert.match(texts, /Instructing party: Bupa \(insurer\)/);
  assert.match(texts, /Kents Hill Medical Practice \(fictional\)/);
});

test("Case C drafted wording: the insurer on record is not named on another insurer's form; '(fictional)' kept; no repeated bracket", async () => {
  // What live drafting wrote on AXA's and Allianz Care's forms (wave 2 recordings, fixed by hand there).
  const { assembleDraft } = await import("../../src/modules/medreport/ai/assemble");
  const bundle = getDemoBundle("rebecca-lane");
  const computedFacts = computeFacts(bundle, { asOf: "2026-10-06" });
  const planField: FormField = {
    id: "F-01",
    label: "Planned treatment",
    guidance: "",
    answerType: "long_text",
    anchor: { kind: "pdf_field", fieldName: "plan", fieldType: "text" },
    fillSource: { kind: "notes_narrative" },
    required: true,
    confidence: "high",
  };
  const formFrom = (referrer: FormDefinition["referrer"]): FormDefinition => ({ ...insurerForm(referrer), fields: [planField] });
  const raw = {
    sections: [
      {
        sectionKey: "F-01",
        paragraphs: [
          { text: "On 01/10/2026 I made a further treatment request to Bupa for 4 further sessions, fortnightly over 8 wks (8 weeks).", sourceIds: ["N-005"], basis: "record" as const },
          { text: "On 01/10/2026 I recorded that the request was discussed with [CLAIMANT] and agreed.", sourceIds: ["N-005"], basis: "record" as const },
          { text: "Dr A Forsyth, GP, Kents Hill Medical Practice, referred [CLAIMANT] by letter dated 26/08/2026.", sourceIds: ["N-001"], basis: "record" as const },
        ],
      },
    ],
    gaps: [],
  };
  const draft = (form: FormDefinition) =>
    assembleDraft({
      template: formToTemplate(form),
      bundle,
      instructingParty: bundle.referral,
      sectionKeys: ["F-01"],
      computedFacts,
      output: raw,
      meta: { mode: "live", sectionKeys: ["F-01"], at: NOW.toISOString(), promptVersion: "forms-7" },
      form,
      idSeed: "c",
    }).sections[0].paragraphs.map((p) => p.text);

  assert.deepEqual(draft(formFrom({ name: "AXA Global Healthcare (fictional test)", type: "insurer" })), [
    "On 01/10/2026 I made a further treatment request to the insurer for 4 further sessions, fortnightly over 8 weeks.",
    // A first-person draft reads as the signer writes a form, not as record-keeping (core/voice.ts plainClinicalWording).
    "On 01/10/2026, the request was discussed with Mrs Lane and agreed.",
    "Dr A Forsyth, GP, Kents Hill Medical Practice (fictional), referred Mrs Lane by letter dated 26/08/2026.",
  ]);
  // The insurer on record's own form, and a form that is not an insurer's, keep the name.
  assert.match(draft(formFrom({ name: "Bupa", type: "insurer" }))[0], /request to Bupa for 4 further sessions, fortnightly over 8 weeks\.$/);
  assert.match(draft(formFrom({ name: "Northgate Medico-Legal (fictional)", type: "mlc" }))[0], /request to Bupa for/);
});

test("a form with printed address lines and a postcode box: the address part by part, the postcode on its own", async () => {
  const lane = getDemoBundle("rebecca-lane");
  const ctx = { bundle: lane, instructingParty: lane.referral, computedFacts: computeFacts(lane), reportDate: "2026-10-09" };
  assert.equal(resolveRegistrationValue("patient.postcode", ctx)?.text, "MK5 8ZZ");
  assert.equal(resolveRegistrationValue("patient.addressLines", ctx)?.text, "22 Larkspur Mews (fictional)\nLoughton\nMilton Keynes");
  assert.deepEqual(resolveRegistrationValue("patient.postcode", ctx)?.sourceIds, ["REG"]);
  assert.deepEqual(splitUkAddress("Flat 2, Mill House (North, fictional), Leeds LS11AA"), { lines: ["Flat 2", "Mill House (North, fictional)", "Leeds"], postcode: "LS1 1AA" });
  assert.deepEqual(splitUkAddress("1 High Street, Dublin"), { lines: ["1 High Street", "Dublin"], postcode: "" }, "no UK postcode: every part is a line");
  // Three lines on two printed rows: the last two share the last row – nothing goes to a continuation sheet.
  assert.equal(joinExtraLines("22 Larkspur Mews (fictional)\nLoughton\nMilton Keynes", 2), "22 Larkspur Mews (fictional)\nLoughton, Milton Keynes");
  assert.equal(joinExtraLines("One\nTwo", 3), "One\nTwo");
});
