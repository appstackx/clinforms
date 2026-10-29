/**
 * Letters as Word / PDF files and the discharge letter from a discharge note (K2-LTR-005/006), and the insurer
 * claims screen's server functions (K2-BILL-011), on node:sqlite with the tenant-scope guard. Run by test:pms.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import PizZip from "pizzip";
import { testCipher } from "../../db/testing/databases";
import { loadPdfjs, pdfjsDocumentParams } from "../../../modules/medreport/forms/pdfjs";
import { listAudit } from "../../repos/audit";
import type { RepoContext } from "../../repos/context";
import { createPractitioner } from "../../repos/pms/directory";
import { createPatient } from "../../repos/pms/patients";
import { createReferrer } from "../../repos/pms/referrers";
import { createGuardedSqliteDb, unscopedStatements, type GuardedDb } from "../../repos/pms/testing/guarded-db";
import { testActor, type RecordsActor, type Result } from "../records/access";
import { openCaseFor } from "../records/cases-service";
import { saveNoteFor, startNoteFor } from "../records/notes-service";
import { recordOutcomeFor } from "../records/outcomes-service";
import { claimsFileFor, claimsFor } from "../billing/claims";
import { fillDischargeGaps, letterFileFor, startDischargeLetterFor } from "./letter-files";
import { letterBlocks } from "./letter-output";
import { letterFor } from "./views";
import { saveLetterFor, startLetterFor } from "./writes";
import { createLetterTemplate } from "../../repos/pms/comms/letters";
import { createDraftInvoice, issueInvoice } from "../../repos/pms/billing/invoices";

const A = "riverside-a";
const B = "harbour-b";

function value<T>(r: Result<T>): T {
  if (!r.ok) assert.fail(`expected ok, got ${r.code}: ${r.error}`);
  return r.value;
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument(pdfjsDocumentParams(bytes));
  try {
    const doc = await task.promise;
    const parts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      parts.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
    }
    return parts.join(" ");
  } finally {
    await task.destroy();
  }
}

describe("letter text → blocks; discharge gaps", () => {
  it("paragraphs and bullet lists as the letter page shows them", () => {
    assert.deepEqual(letterBlocks("Dear Dr Ward,\n\n- one\n- two\n\nYours sincerely,"), [
      { kind: "p", text: "Dear Dr Ward," },
      { kind: "ul", items: ["one", "two"] },
      { kind: "p", text: "Yours sincerely," },
    ]);
  });
  it("the note's sections fill the outcome and advice gaps; empty sections keep their gap", () => {
    const body = "Outcome\n[[Summarise progress and the outcome measures]]\n\nAdvice given\n[[Home exercise programme and self-management advice]]";
    const out = fillDischargeGaps(body, { reason: "Goals met", outcome: "Full range, no pain at work" }, "NPRS 7/10 → 2/10");
    assert.match(out, /Reason for discharge: Goals met\n\nFull range, no pain at work\n\nOutcome measures: NPRS 7\/10 → 2\/10/);
    assert.match(out, /\[\[Home exercise programme/);
  });
});

describe("letter files, discharge letter and claims on SQLite", () => {
  let g: GuardedDb;
  let ctx: RepoContext;
  const clock = Date.parse("2026-10-24T09:00:00.000Z");
  let owner: RecordsActor;
  let sarah: RecordsActor;
  let staff: RecordsActor;
  let other: RecordsActor;
  const ids: Record<string, string> = {};

  before(async () => {
    g = createGuardedSqliteDb();
    ctx = { db: g.db, cipher: testCipher(), now: () => new Date(clock) };
    owner = testActor(ctx, A, "owner", { userId: "user_owner_dell", name: "Dell Baines (fictional)" });
    sarah = testActor(ctx, A, "clinician", { userId: "user_sarah_01", name: "Sarah Reid" });
    staff = testActor(ctx, A, "staff", { userId: "user_reception_03", name: "Priya Shah" });
    other = testActor(ctx, B, "owner", { userId: "user_other_b", name: "Other Clinic" });
    ids.prac = (await createPractitioner(ctx, A, { displayName: "Sarah Reid", registrationNumber: "PH-DEMO-01", userId: sarah.userId }, owner.actor)).id;
    ids.insurer = (await createReferrer(ctx, A, { kind: "insurer", name: "Northwell Health (fictional)" }, owner.actor)).id;
    ids.megan = (await createPatient(ctx, A, { firstName: "Megan", lastName: "Hart", dateOfBirth: "1991-11-22", gpName: "Dr Ellen Ward (fictional)", gpPractice: "Bletchley Medical Centre (fictional)" }, owner.actor)).id;
    ids.case = value(await openCaseFor(staff, ids.megan, { title: "Neck pain after a road traffic accident", openedOn: "2026-09-01", payerType: "insurer", payerReferrerId: ids.insurer, practitionerId: ids.prac })).id;
    value(await recordOutcomeFor(sarah, ids.megan, { measure: "nprs", takenOn: "2026-09-01", answers: { items: { pain: 7 } }, caseId: ids.case }));
    value(await recordOutcomeFor(sarah, ids.megan, { measure: "nprs", takenOn: "2026-10-20", answers: { items: { pain: 2 } }, caseId: ids.case }));
    const draft = value(await startNoteFor(sarah, ids.megan, { templateId: "builtin-discharge", seenOn: "2026-10-20", caseId: ids.case }));
    ids.note = draft.id;
    value(await saveNoteFor(sarah, ids.megan, draft.id, { expectedRev: 1, sections: { reason: "Goals met", summary: "Six sessions of mobilisation and exercise.", outcome: "Pain-free turning to reverse the car", advice: "Continue the home programme twice a week" }, sign: true }));
    const unsigned = value(await startNoteFor(sarah, ids.megan, { templateId: "builtin-discharge", seenOn: "2026-10-21", caseId: ids.case }));
    ids.unsigned = unsigned.id;
  });
  after(async () => {
    await g?.close();
  });

  it("discharge letter: reception and another clinic are refused; an unsigned note is refused; the clinician's letter is filled from the note", async () => {
    const refused = await startDischargeLetterFor(staff, { patientId: ids.megan, noteId: ids.note });
    assert.equal(!refused.ok && refused.code, "forbidden");
    const elsewhere = await startDischargeLetterFor(other, { patientId: ids.megan, noteId: ids.note });
    assert.equal(!elsewhere.ok && elsewhere.code, "not_found");
    const draftNote = await startDischargeLetterFor(sarah, { patientId: ids.megan, noteId: ids.unsigned });
    assert.equal(!draftNote.ok && draftNote.code, "invalid");
    const { id } = value(await startDischargeLetterFor(sarah, { patientId: ids.megan, noteId: ids.note }));
    ids.letter = id;
    const view = value(await letterFor(sarah, id));
    assert.equal(view.letter.recipientKind, "gp");
    assert.equal(view.letter.caseId, ids.case);
    assert.match(view.letter.body, /Reason for discharge: Goals met/);
    assert.match(view.letter.body, /Outcome measures: NPRS 7\/10 → 2\/10/);
    assert.match(view.letter.body, /Continue the home programme twice a week/);
    assert.doesNotMatch(view.letter.body, /\[\[/);
    assert.match(view.letter.subject, /^Discharge: Megan Hart/);
  });

  it("Word and PDF: the letter's layout and text; reception and another clinic refused; each download audited", async () => {
    const docx = value(await letterFileFor(sarah, ids.letter, "docx"));
    assert.equal(docx.fileName, `letter-${ids.letter}.docx`);
    assert.deepEqual(Array.from(docx.bytes.subarray(0, 4)), [0x50, 0x4b, 0x03, 0x04]);
    const xml = new PizZip(docx.bytes).file("word/document.xml")?.asText() ?? "";
    assert.match(xml, /Discharge: Megan Hart/);
    assert.match(xml, /DRAFT – NOT SIGNED/);
    assert.match(xml, /NPRS 7\/10 → 2\/10/);
    const pdf = value(await letterFileFor(sarah, ids.letter, "pdf"));
    assert.equal(Buffer.from(pdf.bytes.subarray(0, 5)).toString("latin1"), "%PDF-");
    const text = (await pdfText(pdf.bytes)).replace(/\s+/g, " ");
    assert.match(text, /Discharge: Megan Hart/);
    assert.equal(!(await letterFileFor(staff, ids.letter, "pdf")).ok, true);
    const elsewhere = await letterFileFor(other, ids.letter, "docx");
    assert.equal(!elsewhere.ok && elsewhere.code, "not_found");
    const audits = (await listAudit(ctx, A, { limit: 200 })).filter((a) => a.action === "pms.letter.download");
    assert.equal(audits.length, 2);
    assert.doesNotMatch(JSON.stringify(audits), /Megan|Hart|NPRS/);
  });

  it("claims: billing.view sees the payers; the file needs reports.export; nothing to claim says so", async () => {
    const view = value(await claimsFor(owner, {}));
    assert.deepEqual(view.payers.map((p) => p.name), ["Northwell Health (fictional)"]);
    assert.deepEqual(view.channels.map((c) => [c.id, c.connected]), [["csv", true], ["healthcode", false]]);
    const picked = value(await claimsFor(owner, { payerReferrerId: ids.insurer, from: "2026-10-01", until: "2026-10-31" }));
    assert.deepEqual([picked.payerName, picked.rows.length, picked.canDownload], ["Northwell Health (fictional)", 0, true]);
    assert.equal(value(await claimsFor(sarah, { payerReferrerId: ids.insurer })).canDownload, false);
    const noExport = await claimsFileFor(sarah, { payerReferrerId: ids.insurer, from: "2026-10-01", until: "2026-10-31" });
    assert.equal(!noExport.ok && noExport.code, "forbidden");
    const empty = await claimsFileFor(owner, { payerReferrerId: ids.insurer, from: "2026-10-01", until: "2026-10-31" });
    assert.equal(!empty.ok && empty.code, "invalid");
    const backwards = await claimsFileFor(owner, { payerReferrerId: ids.insurer, from: "2026-10-31", until: "2026-10-01" });
    assert.equal(!backwards.ok && backwards.code, "invalid");
    const elsewhere = await claimsFor(other, { payerReferrerId: ids.insurer });
    assert.equal(!elsewhere.ok && elsewhere.code, "not_found");
  });

  it("M10 M3: {{latest_outcomes}} is filled in only for a member with clinical.view", async () => {
    const t = await createLetterTemplate(ctx, A, { name: "Progress to the insurer", recipientKind: "referrer", subject: "Progress: {{patient.full_name}}", body: "Dear {{recipient.name}},\n\nScores: {{latest_outcomes}}\n\n{{author.name}}" }, owner.actor);
    const officeAdmin = testActor(ctx, A, "admin", { userId: "user_admin_07", name: "Office Admin" }, { exceptions: { "clinical.view": false, "messages.letters": true } });
    assert.ok(officeAdmin.can("messages.letters") && !officeAdmin.can("clinical.view"));
    const hidden = value(await startLetterFor(officeAdmin, { patientId: ids.megan, templateId: t.id, caseId: ids.case }));
    const hiddenView = value(await letterFor(officeAdmin, hidden.id));
    assert.doesNotMatch(hiddenView.letter.body, /NPRS|7\/10|2\/10/, "no outcome scores without clinical.view");
    // Typed into the draft afterwards: still not filled in.
    value(await saveLetterFor(officeAdmin, { id: hidden.id, rev: hiddenView.letter.rev, body: `${hiddenView.letter.body}\n{{latest_outcomes}}` }));
    assert.doesNotMatch(value(await letterFor(officeAdmin, hidden.id)).letter.body, /NPRS/);
    const shown = value(await startLetterFor(owner, { patientId: ids.megan, templateId: t.id, caseId: ids.case }));
    assert.match(value(await letterFor(owner, shown.id)).letter.body, /NPRS 7\/10 → 2\/10/);
  });

  it("M10 L5: the claims file's Diagnosis code column is blank without clinical.view", async () => {
    const draft = await createDraftInvoice(ctx, A, { patientId: ids.megan, caseId: ids.case, billTo: "payer", diagnosisCode: "S13.4", lines: [{ kind: "item", description: "Follow-up (fictional)", unitPricePence: 4800 }] }, owner.actor);
    const issued = await issueInvoice(ctx, A, draft.invoice.id, 1, {}, owner.actor);
    assert.ok(issued.ok);
    const q = { payerReferrerId: ids.insurer, from: "2026-10-01", until: "2026-10-31", includeSent: true };
    const exporter = testActor(ctx, A, "admin", { userId: "user_admin_08", name: "Billing Admin" }, { exceptions: { "clinical.view": false, "reports.export": true, "billing.view": true } });
    const blank = value(await claimsFileFor(exporter, q));
    assert.doesNotMatch(blank.body, /S13\.4/);
    assert.match(blank.body.split("\n")[0], /Diagnosis code/, "the column stays (blank)");
    const full = value(await claimsFileFor(owner, q));
    assert.match(full.body, /S13\.4/);
  });

  it("every statement named its clinic", () => {
    assert.deepEqual(unscopedStatements(g.log.statements), []);
  });
});
