/**
 * bh2 WF (B3-21, AC-CPY-3): the portal summary PDF (and every house-layout PDF) opens with who completed and approved it
 * and whose clinical notes it draws on – never "the treating physiotherapist" whoever signed – and labels a case
 * manager's reference on another organisation's form as the referral's, not "Your reference".
 *
 * Text snapshots of the rendered PDF on the three paths – author = approver, author ≠ approver, staff-prepared – plus the
 * drafts. Fictional data only: the corpus clinic's Gemma Whitlock, Sarah Reid, Tom Ellis, Priya Shah and Pat Morgan.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { actorOf, buildBundle, clinicianOf, CORPUS_TENANT } from "../core/validation/__corpus__/harness/fixtures";
import { EXAMPLE_PORTAL_QUESTIONS, createQuestionSet, parsePortalQuestions } from "../core/question-set";
import { createFormReport } from "../core/report-factory";
import { formToTemplate } from "../core/forms";
import { ReportSchema } from "../core/schemas";
import type { FormDefinition, InstructingParty, Paragraph, Report, SignReceipt } from "../core/types";
import { readPrintedNotes } from "../connectors/file-import/pdf-notes";
import { buildQuestionSummaryViewModel, renderQuestionSummaryPdf } from "./question-summary";
import { completionSentence, detailRows, listOfNames, reportIntroText, unsignedNotice } from "./pdf/ReportPdf";

const NOW = new Date("2026-10-22T09:00:00.000Z");
const SIGNED_AT = "2026-10-22T10:30:00.000Z";
const PORTAL = "Sample Insurer Portal (fictional)";

async function portalForm(referrer = PORTAL): Promise<FormDefinition> {
  const form = await createQuestionSet({
    referrer: { name: referrer, type: "insurer" },
    questions: parsePortalQuestions(EXAMPLE_PORTAL_QUESTIONS).questions,
    tenantId: CORPUS_TENANT,
    now: NOW,
    id: "form_wf_portal",
  });
  return { ...form, status: "confirmed" };
}

type Para = { key: string; text: string; cites: string[]; by?: "sarah" | "tom" | "pat"; origin?: Paragraph["origin"] };

/** The corpus bundle for Gemma (notes: N-101 Priya Shah, N-102 Sarah Reid, N-103 Tom Ellis) and a report on the portal form. */
function makeReport(
  form: FormDefinition,
  opts: { author: "sarah" | "tom" | null; approver: "sarah" | null; paras: Para[]; party?: InstructingParty; createdBy?: string; allNotesBySarah?: boolean },
): Report {
  // Record values cite the notes they come from: the assessment date (F-04) cites the assessment note (N-101).
  const bundle = buildBundle("gemma", CORPUS_TENANT, opts.allNotesBySarah ? [{ id: "N-101", author: "sarah", date: "2026-09-01", type: "initial_assessment" }, { id: "N-103", author: "sarah", date: "2026-10-20", type: "discharge" }] : []);
  const ref = bundle.referral!;
  const party: InstructingParty = opts.party ?? { type: ref.type, name: ref.name, reference: ref.reference, contactName: ref.contactName, address: ref.address };
  const sarah = actorOf("sarah");
  const report = createFormReport({
    form,
    bundle,
    instructingParty: party,
    computedFacts: [],
    author: opts.author ? clinicianOf(opts.author) : null,
    approver: opts.approver ? { memberId: sarah.memberId, name: sarah.name, hcpc: sarah.hcpc! } : null,
    id: "rpt_wf_intro",
    now: NOW,
    actor: opts.createdBy,
  });
  for (const p of opts.paras) {
    const section = report.sections.find((s) => s.key === p.key)!;
    section.paragraphs = [{ id: `${p.key}-p1`, text: p.text, sourceIds: p.cites, origin: p.origin ?? "ai", ...(p.by ? { by: actorOf(p.by) } : {}) }];
    section.status = "complete";
  }
  return ReportSchema.parse(report);
}

function receiptFor(report: Report): SignReceipt {
  const sarah = clinicianOf("sarah");
  return {
    reportId: report.id,
    tenantId: report.tenantId,
    contentSha256: "a".repeat(64),
    signer: { name: sarah.name, hcpc: sarah.hcpc, role: "Physiotherapist" },
    signedAt: SIGNED_AT,
    statementAccepted: true,
    attestations: ["I have reviewed every answer."],
    // Not a real MAC: the view model takes a receipt the caller has already verified (render.ts).
    mac: "b".repeat(64),
  };
}

/** The first page of the rendered PDF as one line of text (wrapping and the watermark aside). */
async function pageOne(report: Report, form: FormDefinition, receipt?: SignReceipt): Promise<string> {
  const out = await renderQuestionSummaryPdf(report, form, formToTemplate(form), { receipt, now: NOW });
  const read = await readPrintedNotes(Buffer.from(out.bytes).toString("base64"));
  return read.pageLines[0].join(" ").replace(/\s+/g, " ");
}

const SAFE_STATEMENTS = "Statements are attributed to the patient (as reported) or to the clinician who recorded them.";

test("author = approver: Sarah approves a report on her own notes – her name, her notes, no other claim", async () => {
  const form = await portalForm();
  const report = makeReport(form, {
    author: "sarah",
    approver: "sarah",
    allNotesBySarah: true,
    paras: [{ key: "F-07", text: "On 15/09/2026 the knee was less painful on stairs.", cites: ["N-102"] }],
  });
  const text = await pageOne(report, form, receiptFor(report));
  const intro =
    "This factual report was completed and approved by Sarah Reid, Physiotherapist (HCPC PH-DEMO-01), from the clinic's records of the episode of care, including the clinical notes of Sarah Reid. " +
    SAFE_STATEMENTS;
  assert.ok(text.includes(intro), text);
  assert.doesNotMatch(text, /treating physiotherapist/i);
  assert.ok(text.includes("Referral from Northgate Case Services (fictional)"), "the referral is a case manager's, the form an insurer's");
  assert.ok(text.includes("Referral reference NCS-2026-118"));
  assert.doesNotMatch(text, /Your reference|Instructing party/);
});

test("author ≠ approver: Tom's and Priya's notes, approved by Sarah – Sarah approves, they are named as the notes' authors", async () => {
  const form = await portalForm();
  const report = makeReport(form, {
    author: "tom",
    approver: "sarah",
    paras: [
      { key: "F-06", text: "On 01/09/2026 Priya Shah, physiotherapist, recorded a right knee injury playing netball.", cites: ["N-101"] },
      { key: "F-08", text: "On 20/10/2026 Tom Ellis, physiotherapist, recorded full knee range.", cites: ["N-103"] },
    ],
  });
  const text = await pageOne(report, form, receiptFor(report));
  assert.ok(
    text.includes(
      "This factual report was completed and approved by Sarah Reid, Physiotherapist (HCPC PH-DEMO-01), from the clinic's records of the episode of care, including the clinical notes of Priya Shah and Tom Ellis. " +
        SAFE_STATEMENTS,
    ),
    text,
  );
  assert.doesNotMatch(text, /treating physiotherapist/i);
  // The details still list every clinician who wrote a note.
  assert.ok(text.includes("Treating clinicians Priya Shah (HCPC PH-DEMO-03), Sarah Reid (HCPC PH-DEMO-01),"), text);
});

test("staff-prepared: Pat prepares, Sarah approves – the PDF names the approver and the notes' authors, never Pat", async () => {
  const form = await portalForm();
  const report = makeReport(form, {
    author: null,
    approver: "sarah",
    createdBy: "Pat Morgan",
    paras: [
      { key: "F-03", text: "MEM-000123", cites: [], by: "pat", origin: "clinician" },
      { key: "F-07", text: "On 15/09/2026 Sarah Reid, physiotherapist, recorded less pain on stairs.", cites: ["N-102"], by: "pat", origin: "edited" },
      { key: "F-08", text: "On 20/10/2026 Tom Ellis, physiotherapist, recorded full knee range.", cites: ["N-103"] },
    ],
  });
  const text = await pageOne(report, form, receiptFor(report));
  assert.ok(
    text.includes(
      "This factual report was completed and approved by Sarah Reid, Physiotherapist (HCPC PH-DEMO-01), from the clinic's records of the episode of care, including the clinical notes of Priya Shah, Sarah Reid and Tom Ellis.",
    ),
    text,
  );
  assert.doesNotMatch(text, /Pat Morgan|treating physiotherapist/i);
});

test("drafts: for approval by the approver chosen for the report, or by the approving clinician when none is chosen yet", async () => {
  const form = await portalForm();
  const chosen = makeReport(form, { author: "tom", approver: "sarah", paras: [{ key: "F-08", text: "On 20/10/2026 Tom Ellis recorded full knee range.", cites: ["N-103"] }] });
  const vm = buildQuestionSummaryViewModel(chosen, form, formToTemplate(form), { now: NOW });
  assert.equal(
    reportIntroText(vm),
    "This factual report is a draft, prepared from the clinic's records of the episode of care, including the clinical notes of Priya Shah and Tom Ellis, for approval by Sarah Reid (HCPC PH-DEMO-01). " +
      SAFE_STATEMENTS,
  );
  assert.equal(unsignedNotice(vm), "This report has not been reviewed and signed by Sarah Reid. It must not be disclosed or relied on. The signature, HCPC number and document fingerprint appear here once it is signed.");
  const text = await pageOne(chosen, form);
  assert.ok(text.includes("for approval by Sarah Reid (HCPC PH-DEMO-01)."), text);
  assert.doesNotMatch(text, /treating physiotherapist/i);

  const none = makeReport(form, { author: null, approver: null, paras: [] });
  for (const section of none.sections) for (const p of section.paragraphs) p.sourceIds = p.sourceIds.filter((id) => !id.startsWith("N-"));
  const vmNone = buildQuestionSummaryViewModel(none, form, formToTemplate(form), { now: NOW });
  assert.equal(
    completionSentence(vmNone, "This factual report"),
    "This factual report is a draft, prepared from the clinic's records of the episode of care, including the clinical notes of Priya Shah, Sarah Reid and Tom Ellis.",
    "nothing cited yet: every note's author",
  );
  assert.match(unsignedNotice(vmNone), /^This report has not been reviewed and signed by the approving clinician\./);
});

test("the instructing party's own form keeps 'Instructing party' and 'Your reference'", async () => {
  const form = await portalForm("Northgate Case Services (fictional)");
  const report = makeReport(form, { author: "sarah", approver: "sarah", paras: [] });
  const vm = buildQuestionSummaryViewModel(report, form, formToTemplate(form), { receipt: receiptFor(report), now: NOW });
  assert.equal(vm.instructingParty.isFormReferrer, true);
  const rows = new Map(detailRows(vm));
  assert.equal(rows.get("Instructing party"), "Northgate Case Services (fictional)");
  assert.equal(rows.get("Your reference"), "NCS-2026-118");
  assert.equal(rows.has("Referral from"), false);
});

test("the opening line reads the receipt and hashed content only – activity, flags and status never change it", async () => {
  const form = await portalForm();
  const report = makeReport(form, { author: "tom", approver: "sarah", paras: [{ key: "F-08", text: "On 20/10/2026 Tom Ellis recorded full knee range.", cites: ["N-103"] }] });
  const receipt = receiptFor(report);
  const before = reportIntroText(buildQuestionSummaryViewModel(report, form, formToTemplate(form), { receipt, now: NOW }));
  const mutated: Report = {
    ...report,
    status: "signed",
    updatedAt: "2026-10-23T08:00:00.000Z",
    activity: [...report.activity, { at: SIGNED_AT, actor: "Pat Morgan", action: "approved", detail: "Approved by Pat Morgan, treating physiotherapist" }],
    flags: [],
  };
  assert.equal(reportIntroText(buildQuestionSummaryViewModel(mutated, form, formToTemplate(form), { receipt, now: NOW })), before);
});

test("employer reports keep their fitness-for-work scope and consent sentences around the same completion line", () => {
  const vm = {
    signed: true,
    completion: { approver: { name: "Sarah Reid", role: "Senior Physiotherapist, MCSP", hcpc: "PH-DEMO-01" }, noteAuthors: ["Sarah Reid", "Tom Ellis"] },
    instructingParty: { type: "employer" } as never,
  };
  assert.equal(
    reportIntroText(vm),
    "This report covers fitness for work only. It was completed and approved by Sarah Reid, Senior Physiotherapist, MCSP (HCPC PH-DEMO-01), from the clinic's records of the episode of care, including the clinical notes of Sarah Reid and Tom Ellis. In line with the employee's consent, it does not disclose unrelated health information. Statements are attributed to the employee (as reported) or to the clinician who recorded them.",
  );
  assert.equal(listOfNames([]), "");
  assert.equal(listOfNames(["A"]), "A");
  assert.equal(listOfNames(["A", "B", "C"]), "A, B and C");
  assert.equal(
    completionSentence({ signed: true, completion: { approver: { name: "Sarah Reid", role: "", hcpc: "PH-DEMO-01" }, noteAuthors: [] } }, "It"),
    "It was completed and approved by Sarah Reid (HCPC PH-DEMO-01), from the clinic's records of the episode of care.",
  );
});
