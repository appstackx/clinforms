/**
 * bh2 WC – core/provenance.ts: the synchronous SHA-256, drafted residue, clinician boxes and gaps, proposals and the
 * origin a person's text gets. Fictional data only (Sarah Reid approves, Tom Ellis is a colleague, Pat Morgan staff).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  OPINION_BOX_WORDING,
  actsAsApprover,
  approverWritten,
  boxContentSha,
  isClinicianBox,
  isClinicianGap,
  paragraphResidue,
  pendingProposal,
  personOrigin,
  residueSpans,
  sha256HexSync,
  supersededEntry,
} from "./provenance";
import type { Actor, Gap, Paragraph, Report, ReportSection } from "./types";
import { withHookDisabled } from "./validation/hooks";

const SARAH: Actor = { memberId: "mem_sarah", name: "Sarah Reid", role: "owner", canSign: true, hcpc: "PH-DEMO-01" };
const TOM: Actor = { memberId: "mem_tom", name: "Tom Ellis", role: "clinician", canSign: true, hcpc: "PH-DEMO-02" };
const PAT: Actor = { memberId: "mem_pat", name: "Pat Morgan", role: "staff", canSign: false };
const APPROVER = { memberId: SARAH.memberId, name: SARAH.name, hcpc: "PH-DEMO-01" };

const DRAFTED = "He reported a lifting injury at work on 12/03/2026 with central low back pain. He is expected to make a full recovery within 6 weeks of the accident.";
const OPINION = "He is expected to make a full recovery within 6 weeks of the accident.";

function section(paragraphs: Paragraph[], extra: Partial<ReportSection> = {}): ReportSection {
  return { key: "prognosis", title: "Prognosis", kind: "clinician_opinion", status: "drafted", paragraphs, ...extra };
}

const p = (text: string, origin: Paragraph["origin"], extra: Partial<Paragraph> = {}): Paragraph => ({ id: "p1", text, sourceIds: ["N-001"], origin, ...extra });

describe("sha256HexSync", () => {
  it("is SHA-256: equal to node's for empty, ASCII, UTF-8 and multi-block input", () => {
    for (const text of ["", "abc", "Sarah Reid – “full recovery” ✓", "x".repeat(1000), "a".repeat(55), "a".repeat(56), "a".repeat(64)]) {
      assert.equal(sha256HexSync(text), createHash("sha256").update(text, "utf8").digest("hex"), JSON.stringify(text.slice(0, 20)));
    }
  });
});

describe("drafted residue (0.8 of a drafted sentence's words keeps drafted strictness)", () => {
  const cases: Array<[string, string, boolean]> = [
    ["the drafted sentence kept word for word inside a rewrite", `Mr Testcase described lifting a heavy parcel at work. ${OPINION}`, true],
    ["one word changed", OPINION.replace("full", "complete"), true],
    ["punctuation changed and joined to another sentence", "He reported a lifting injury at work on 12/03/2026 with central low back pain; he is expected to make a full recovery within 6 weeks of the accident!", true],
    ["a word inserted", OPINION.replace("expected", "now expected"), true],
    ["a genuine rewrite", "In my opinion his back should settle with exercise.", false],
    ["most words gone (11 of 14)", "He will make a full recovery within 6 weeks of the accident.", false],
  ];
  for (const [what, text, residue] of cases) {
    it(`${what}: ${residue ? "residue" : "the person's own words"}`, () => {
      assert.equal(residueSpans(text, [OPINION]).length > 0, residue);
    });
  }
  it("a short drafted sentence counts only where a whole sentence repeats it", () => {
    assert.equal(residueSpans("Neck pain eased with exercise.", ["Neck."]).length, 0);
    assert.equal(residueSpans("Full recovery. Back to work now.", ["Full recovery."]).length, 1);
  });
  it("tombstones count: a deleted drafted paragraph pasted back is still drafted text", () => {
    const s = section([p(OPINION, "clinician", { by: SARAH })], { tombstones: [{ paragraphId: "gone", text: DRAFTED, sourceIds: ["N-001"], by: SARAH, at: "2026-10-21T09:00:00.000Z" }] });
    assert.ok(paragraphResidue(s, s.paragraphs[0]).length > 0);
  });
  it("an edited paragraph that still reads exactly as drafted: drafted throughout, except for the approver's acknowledgement", () => {
    const s = section([p(OPINION, "edited", { originalText: OPINION, by: SARAH })]);
    assert.deepEqual(paragraphResidue(s, s.paragraphs[0]), [{ start: 0, end: OPINION.length }]);
    assert.deepEqual(paragraphResidue(s, s.paragraphs[0], { forAcknowledgement: true }), []);
  });
  it("with the draft-residue hook disabled, any person-changed paragraph of a box with drafted text is drafted throughout", async () => {
    const s = section([p("In my opinion his back should settle with exercise.", "edited", { originalText: DRAFTED, by: SARAH })]);
    assert.equal(paragraphResidue(s, s.paragraphs[0]).length, 0);
    await withHookDisabled("draft-residue", async () => assert.equal(paragraphResidue(s, s.paragraphs[0]).length, 1));
  });
});

describe("clinician boxes and gaps", () => {
  const report = { gaps: [] as Gap[] };
  it("opinion boxes, physio choices, opinion wording and opinion gaps are clinician boxes; record values never", () => {
    assert.equal(isClinicianBox(report, { key: "F-10", kind: "clinician_opinion", title: "Prognosis" }), true);
    assert.equal(isClinicianBox(report, { key: "F-31", kind: "ai_narrative", title: "Mechanism of injury" }), false);
    assert.equal(isClinicianBox(report, { key: "F-15", kind: "ai_narrative", title: "Any restrictions on lifting?" }), true);
    assert.equal(isClinicianBox(report, { key: "F-25", kind: "from_records", title: "Restriction required – lifting" }), true, "a staff entry that asks for a decision (B1-15)");
    assert.equal(isClinicianBox(report, { key: "F-01", kind: "from_records", title: "Patient name" }), false);
    assert.equal(isClinicianBox({ gaps: [{ id: "gap-F-04-physio", sectionKey: "F-04", issue: "", suggestedQuestion: "", relatedNoteIds: [] }] }, { key: "F-04", kind: "from_records", title: "Work status" }), true);
    const opinionGap: Gap = { id: "g1", sectionKey: "F-32", issue: "", suggestedQuestion: "", relatedNoteIds: [], kind: "no_opinion_recorded" };
    assert.equal(isClinicianBox({ gaps: [opinionGap] }, { key: "F-32", kind: "ai_narrative", title: "Objective findings" }), true);
    assert.equal(isClinicianBox({ gaps: [{ ...opinionGap, sectionKey: "F-01" }] }, { key: "F-01", kind: "from_records", title: "Patient name" }), false, "a record value, whatever gap it has");
    assert.ok(OPINION_BOX_WORDING.test("Is the claimant fit for work?") && !OPINION_BOX_WORDING.test("Has the patient gone back to work?"));
  });
  it("gaps: a clinician box's, an opinion gap's and an older gap's outside a record box are the approver's; record values and conditions are anyone's", () => {
    const sections = [
      { key: "F-10", kind: "clinician_opinion" as const, title: "Prognosis", paragraphs: [], status: "needs_input" as const },
      { key: "F-03", kind: "ai_narrative" as const, title: "Mechanism", paragraphs: [], status: "drafted" as const },
      { key: "F-01", kind: "from_records" as const, title: "Reference", paragraphs: [], status: "needs_input" as const },
    ];
    const r = { sections, gaps: [] as Gap[], approver: APPROVER };
    const gap = (id: string, sectionKey: string, kind?: Gap["kind"]): Gap => ({ id, sectionKey, issue: "", suggestedQuestion: "", relatedNoteIds: [], ...(kind ? { kind } : {}) });
    assert.equal(isClinicianGap(r, gap("g", "F-10")), true);
    assert.equal(isClinicianGap(r, gap("gap-F-03-x-1", "F-03")), true, "an older gap outside a record box");
    assert.equal(isClinicianGap(r, gap("gap-F-03-x-2", "F-03", "record_value")), false);
    assert.equal(isClinicianGap(r, gap("gap-F-01-referrer", "F-01")), false);
    assert.equal(isClinicianGap(r, gap("gap-F-03-x-3", "F-03", "condition")), false);
    // A report from an earlier build (no approver): that build's rule.
    assert.equal(isClinicianGap({ sections, gaps: [] }, gap("gap-F-03-x-1", "F-03")), false);
    assert.equal(isClinicianGap({ sections, gaps: [] }, gap("g", "F-10")), true);
  });
});

describe("who acts as the approver", () => {
  it("the approver by member id; with no approver chosen (an earlier build's report), any member who is not staff", () => {
    assert.equal(actsAsApprover(SARAH, { approver: APPROVER }), true);
    assert.equal(actsAsApprover(TOM, { approver: APPROVER }), false);
    const sameName: Actor = { ...TOM, name: "Sarah Reid" };
    assert.equal(actsAsApprover(sameName, { approver: APPROVER }), false, "never by name");
    assert.equal(actsAsApprover(TOM, {}), true);
    assert.equal(actsAsApprover(PAT, {}), false);
  });
});

describe("proposals and adoption", () => {
  const report = (s: ReportSection): Pick<Report, "approver" | "gaps"> => ({ approver: APPROVER, gaps: [] });
  it("what staff or a colleague entered in a clinician box is a proposal; the approver's own entry is not", () => {
    assert.equal(pendingProposal(report(section([])), section([p("Settling well.", "edited", { by: PAT })]))?.names, "Pat Morgan (staff)");
    assert.equal(pendingProposal(report(section([])), section([p("Settling well.", "edited", { by: TOM })]))?.names, "Tom Ellis");
    assert.equal(pendingProposal(report(section([])), section([p("Settling well.", "clinician", { by: SARAH })])), null);
    assert.equal(pendingProposal(report(section([])), section([p(OPINION, "ai")])), null, "drafted text is drafted text, not a proposal");
    const answered = section([], { answer: { kind: "choice", value: "0-3 months" }, answerBy: PAT });
    assert.ok(pendingProposal(report(answered), answered));
  });
  it("an adoption covers exactly the box's content: any later change makes it a proposal again", () => {
    const s = section([p("Settling well.", "clinician", { by: PAT })]);
    const adopted = { ...s, adoptedBy: { by: SARAH, at: "2026-10-21T09:00:00.000Z", contentSha: boxContentSha(s) } };
    assert.equal(pendingProposal(report(adopted), adopted), null);
    const changed = { ...adopted, paragraphs: [{ ...adopted.paragraphs[0], text: "Settling well with exercise." }] };
    assert.ok(pendingProposal(report(changed), changed));
    assert.ok(pendingProposal({ approver: undefined, gaps: [] } as never, changed) === null, "no approver: no proposals");
  });
});

describe("the origin a person's text gets", () => {
  const base = { report: { approver: APPROVER } };
  it("only the approver's own new words with no drafted residue are 'clinician'; staff text in a record box is 'staff'", () => {
    const empty = section([]);
    assert.equal(personOrigin({ ...base, section: empty, paragraph: p("In my opinion it will settle.", "clinician"), actor: SARAH }), "clinician");
    assert.equal(personOrigin({ ...base, section: empty, paragraph: p("In my opinion it will settle.", "clinician"), actor: TOM }), "edited");
    assert.equal(personOrigin({ ...base, section: empty, paragraph: p("In my opinion it will settle.", "clinician"), actor: PAT }), "edited");
    const drafted = section([p(DRAFTED, "ai", { id: "d1" })]);
    assert.equal(personOrigin({ ...base, section: drafted, paragraph: p(OPINION, "clinician", { id: "n1" }), actor: SARAH }), "edited", "a drafted sentence pasted into new text");
    const records = { ...empty, kind: "from_records" as const };
    assert.equal(personOrigin({ ...base, section: records, paragraph: p("H-482910", "clinician"), actor: PAT }), "staff");
    assert.equal(personOrigin({ ...base, section: records, paragraph: p("H-482910", "clinician"), actor: SARAH }), "clinician");
    // Editing drafted text never makes it the clinician's own words – "These are my own words" does.
    assert.equal(personOrigin({ ...base, section: drafted, paragraph: p("Rewritten entirely.", "edited", { id: "d1", originalText: DRAFTED }), before: p(DRAFTED, "ai", { id: "d1" }), actor: SARAH }), "edited");
  });
  it("the approver's rewrite of a drafted paragraph is the approver's text (approverWritten) once no drafted residue is left", () => {
    const s = section([p("In my opinion his back should settle with exercise.", "edited", { originalText: DRAFTED, by: SARAH })]);
    assert.equal(approverWritten({ approver: APPROVER }, s, s.paragraphs[0]), true);
    const kept = section([p(`He is doing his exercises. ${OPINION}`, "edited", { originalText: DRAFTED, by: SARAH })]);
    assert.equal(approverWritten({ approver: APPROVER }, kept, kept.paragraphs[0]), false);
    assert.equal(approverWritten({ approver: APPROVER }, s, { ...s.paragraphs[0], by: TOM }), false);
  });
});

describe("amendments", () => {
  it("version 1's superseded entry names version 2 and its approval date, never a raw id in its words", () => {
    const e = supersededEntry({ id: "rpt_abc_v2", version: 2, receipt: { signedAt: "2026-10-27T10:00:00.000Z", signer: { name: "Sarah Reid", hcpc: "PH-DEMO-01" } } as never });
    assert.deepEqual(e, { at: "2026-10-27T10:00:00.000Z", actor: "Sarah Reid", action: "superseded", detail: "Superseded by version 2 (approved 27/10/2026).", reportId: "rpt_abc_v2" });
  });
});
