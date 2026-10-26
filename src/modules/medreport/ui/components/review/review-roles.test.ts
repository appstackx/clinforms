/**
 * bh2 WC – review roles and provenance on the review reducer (designs 1, 4–7): who may decide what, what each person's
 * text becomes, the stamps, adoption, own words, takeover, and the labels read from the stamps. Built on the safety
 * corpus's fictional clinic and discharge form (Sarah Reid approves; Tom Ellis is a colleague; Pat Morgan is staff).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Actor, Gap, Report, ReportFlag } from "../../../core/types";
import { acknowledgementStands, canAcknowledge, canSign, validateReport } from "../../../core/validation";
import { adoptionCurrent } from "../../../core/provenance";
import { buildCase, ownerOf, type Built } from "../../../core/validation/__corpus__/harness/build";
import { actorOf } from "../../../core/validation/__corpus__/harness/fixtures";
import { CaseInputSchema } from "../../../core/validation/__corpus__/harness/types";
import { answerSource, ownWordsBlockers, questionStatus } from "./review-model";
import { mayApplyFix, reviewReducer, type ReviewAction } from "./use-review-state";

const SARAH = actorOf("sarah") as Actor;
const TOM = actorOf("tom") as Actor;
const PAT = actorOf("pat") as Actor;

const OPINION = "He is expected to make a full recovery within 6 weeks of the accident.";

async function form(boxes: Record<string, Array<Record<string, unknown>>> = {}, extra: Record<string, unknown> = {}): Promise<Built> {
  return buildCase(CaseInputSchema.parse({ report: "form:cf-discharge", boxes, ...extra }));
}

function validated(b: Built, r: Report): Report {
  return { ...r, flags: validateReport(r, b.template, { computedFacts: b.computedFacts, form: b.form, voice: { owner: ownerOf(b) as never } }).flags };
}

/** Each step through the reducer, re-validated after it (as the review screen does). */
function run(b: Built, start: Report, ...actions: ReviewAction[]): Report {
  let r = validated(b, start);
  for (const a of actions) r = validated(b, reviewReducer(r, a));
  return r;
}

const box = (r: Report, key: string) => r.sections.find((s) => s.key === key)!;
const flagsOn = (r: Report, key: string, code?: string): ReportFlag[] => r.flags.filter((f) => f.sectionKey === key && (!code || f.code === code));

describe("proposals: what staff or a colleague enter in a clinician box waits for the approver", () => {
  it("staff text is checked like edited text, stamped as Pat's, and blocks (APPROVER_DECISION) until Sarah adopts it", async () => {
    const b = await form({ "F-10": [] });
    const typed = run(b, b.report, { type: "addParagraph", key: "F-10", text: "Settling well with exercise.", actor: PAT });
    const p = box(typed, "F-10").paragraphs[0];
    assert.equal(p.origin, "edited");
    assert.equal(p.by?.memberId, PAT.memberId);
    const decision = flagsOn(typed, "F-10", "APPROVER_DECISION")[0];
    assert.ok(decision);
    assert.match(decision.message, /^Entered by Pat Morgan \(staff\) – the approving physio must adopt it/);
    assert.equal(canAcknowledge(decision, typed, PAT), false);
    assert.equal(canAcknowledge(decision, typed, TOM), false);
    assert.equal(canAcknowledge(decision, typed, SARAH), true, "the approver clears it – by adopting");
    assert.equal(canAcknowledge(decision, typed), false, "never by an acknowledgement already on the report");
    // Pat cannot adopt it; Sarah adopts it with one click (Pat's acknowledgement attempt changes nothing).
    assert.equal(reviewReducer(typed, { type: "adopt", key: "F-10", actor: PAT }), typed);
    assert.equal(reviewReducer(typed, { type: "acknowledgeFlag", flagId: decision.id, reason: "Fine by me.", actor: PAT }), typed);
    const adopted = run(b, typed, { type: "adopt", key: "F-10", actor: SARAH });
    assert.equal(flagsOn(adopted, "F-10", "APPROVER_DECISION").length, 0);
    const s = box(adopted, "F-10");
    assert.equal(s.adoptedBy?.by.memberId, SARAH.memberId);
    assert.equal(s.paragraphs[0].origin, "clinician");
    assert.equal(s.paragraphs[0].by?.memberId, PAT.memberId, "who typed it is kept");
    assert.ok(adopted.activity.some((a) => a.action === "adopted" && /entered by Pat Morgan \(staff\)/.test(a.detail)));
    // A later change by Pat leaves the adoption stale (no longer covering the box); the approver's own change keeps it.
    const pid = s.paragraphs[0].id;
    const patAgain = run(b, adopted, { type: "editParagraph", key: "F-10", paragraphId: pid, text: "Settling well with exercise and walking.", actor: PAT });
    assert.equal(adoptionCurrent(box(patAgain, "F-10"), patAgain.approver ?? null), false);
    assert.equal(flagsOn(patAgain, "F-10", "APPROVER_DECISION").length, 1);
    const sarahEdit = run(b, adopted, { type: "editParagraph", key: "F-10", paragraphId: pid, text: "Settling well with daily exercise.", actor: SARAH });
    assert.equal(flagsOn(sarahEdit, "F-10", "APPROVER_DECISION").length, 0);
  });

  it("a colleague's (Tom's) prognosis is a proposal too; the rule follows the approver, not the role", async () => {
    const b = await form({ "F-10": [] });
    const typed = run(b, b.report, { type: "addParagraph", key: "F-10", text: "In my opinion he will make a full recovery within 6 weeks.", actor: TOM });
    assert.equal(box(typed, "F-10").paragraphs[0].origin, "edited");
    assert.ok(flagsOn(typed, "F-10", "APPROVER_DECISION").length === 1);
    const opinion = flagsOn(typed, "F-10", "OPINION_LANGUAGE")[0];
    if (opinion) {
      assert.equal(canAcknowledge(opinion, typed, TOM), false);
      assert.equal(canAcknowledge(opinion, typed, SARAH), true);
    }
    // Sarah's own words in the same box: no extra click.
    const own = run(b, b.report, { type: "addParagraph", key: "F-10", text: "In my opinion he will make a full recovery within 6 weeks.", actor: SARAH });
    assert.equal(box(own, "F-10").paragraphs[0].origin, "clinician");
    assert.equal(flagsOn(own, "F-10", "APPROVER_DECISION").length, 0);
  });

  it("a physio-only choice ticked by staff stays open and is a proposal; the approver's tick settles it", async () => {
    const b = await form({}, { box: "F-04" });
    const byPat = run(b, b.report, { type: "setAnswer", key: "F-04", value: "Lighter duties", actor: PAT });
    assert.equal(box(byPat, "F-04").answerBy?.memberId, PAT.memberId);
    assert.ok(byPat.gaps.some((g) => g.sectionKey === "F-04" && !g.resolution));
    assert.equal(flagsOn(byPat, "F-04", "APPROVER_DECISION").length, 1);
    const bySarah = run(b, b.report, { type: "setAnswer", key: "F-04", value: "Lighter duties", actor: SARAH });
    assert.ok(bySarah.gaps.filter((g) => g.sectionKey === "F-04").every((g) => g.resolution?.by?.memberId === SARAH.memberId));
    assert.equal(flagsOn(bySarah, "F-04", "APPROVER_DECISION").length, 0);
  });
});

describe("drafted text stays drafted text", () => {
  const drafted = { "F-10": [{ text: OPINION, cites: ["N-001"] }] };

  it("keystroke edits around a drafted opinion: still drafted (nobody acknowledges it); cut and paste back: drafted again", async () => {
    const b = await form(drafted);
    const pid = box(b.report, "F-10").paragraphs[0].id;
    const typed = run(
      b,
      b.report,
      { type: "editParagraph", key: "F-10", paragraphId: pid, text: `${OPINION} H`, actor: SARAH },
      { type: "editParagraph", key: "F-10", paragraphId: pid, text: `${OPINION} He is doing his exercises.`, actor: SARAH },
    );
    const opinion = flagsOn(typed, "F-10", "OPINION_LANGUAGE");
    assert.ok(opinion.length > 0);
    for (const f of opinion) for (const who of [SARAH, TOM, PAT]) assert.equal(canAcknowledge(f, typed, who), false, `${f.evidence} by ${who.name}`);
    const back = run(b, typed, { type: "editParagraph", key: "F-10", paragraphId: pid, text: "", actor: SARAH }, { type: "editParagraph", key: "F-10", paragraphId: pid, text: OPINION, actor: SARAH });
    assert.equal(box(back, "F-10").paragraphs[0].origin, "ai");
    assert.equal(box(back, "F-10").paragraphs[0].by, undefined);
  });

  it("delete, add and paste the draft back: the deleted draft is a tombstone and the new paragraph is still drafted text", async () => {
    const b = await form(drafted);
    const pid = box(b.report, "F-10").paragraphs[0].id;
    const r = run(b, b.report, { type: "removeParagraph", key: "F-10", paragraphId: pid, actor: SARAH }, { type: "addParagraph", key: "F-10", text: OPINION, actor: SARAH });
    const s = box(r, "F-10");
    assert.equal(s.tombstones?.length, 1);
    assert.equal(s.tombstones?.[0].by.memberId, SARAH.memberId);
    assert.equal(s.paragraphs[0].origin, "edited");
    assert.ok(flagsOn(r, "F-10", "OPINION_LANGUAGE").every((f) => !canAcknowledge(f, r, SARAH)));
  });

  it("'These are my own words': the approver's, refused while drafted wording remains, after 'Split it out' accepted; never staff's", async () => {
    const b = await form(drafted);
    const pid = box(b.report, "F-10").paragraphs[0].id;
    const mixed = run(b, b.report, { type: "editParagraph", key: "F-10", paragraphId: pid, text: `He does his exercises daily. ${OPINION}`, actor: SARAH });
    const p = box(mixed, "F-10").paragraphs[0];
    assert.deepEqual(ownWordsBlockers(box(mixed, "F-10"), p), [OPINION]);
    assert.equal(reviewReducer(mixed, { type: "markOwnWords", key: "F-10", paragraphId: pid, actor: SARAH }), mixed, "refused while drafted wording remains");
    const split = run(b, mixed, { type: "splitOutResidue", key: "F-10", paragraphId: pid, actor: SARAH });
    const parts = box(split, "F-10").paragraphs;
    assert.deepEqual(parts.map((x) => [x.text, x.origin]), [["He does his exercises daily.", "edited"], [OPINION, "ai"]]);
    const own = run(b, split, { type: "markOwnWords", key: "F-10", paragraphId: pid, actor: SARAH });
    const mine = box(own, "F-10").paragraphs[0];
    assert.equal(mine.origin, "clinician");
    assert.equal(mine.ownWords?.by.memberId, SARAH.memberId);
    assert.ok(own.activity.some((a) => a.action === "own_words"));
    // Staff: never (the action changes nothing, also for a complete rewrite).
    const patRewrite = run(b, b.report, { type: "editParagraph", key: "F-10", paragraphId: pid, text: "Fully recovered in my view.", actor: PAT });
    assert.equal(reviewReducer(patRewrite, { type: "markOwnWords", key: "F-10", paragraphId: pid, actor: PAT }), patRewrite);
  });

  it("B1-10: the approver's own rewrite (no drafted residue left) settles the box's gap; a small edit keeps it", async () => {
    const gaps = [{ box: "F-10", issue: "Confirm the prognosis." }];
    const b = await form(drafted, { gaps });
    const pid = box(b.report, "F-10").paragraphs[0].id;
    const small = run(b, b.report, { type: "editParagraph", key: "F-10", paragraphId: pid, text: OPINION.replace("full", "complete"), actor: SARAH });
    assert.ok(small.gaps.some((g) => g.sectionKey === "F-10" && !g.resolution));
    const rewrite = run(b, b.report, { type: "editParagraph", key: "F-10", paragraphId: pid, text: "In my opinion his back should settle with exercise.", actor: SARAH });
    const g = rewrite.gaps.find((x) => x.sectionKey === "F-10")!;
    assert.equal(g.resolution?.kind, "resolved");
    assert.equal(g.resolution?.by?.memberId, SARAH.memberId);
  });
});

describe("approver-only decisions are refused to anyone else", () => {
  it("a clinician gap: resolved or acknowledged by the approver only; an acknowledgement on edited text likewise", async () => {
    const b = await form({ "F-10": [{ text: "In my own view he will make a full recovery within 6 weeks.", cites: ["N-001"], origin: "edited", originalText: "He reported a lifting injury at work on 12/03/2026.", by: "sarah" }] }, { gaps: [{ box: "F-10", issue: "Confirm the prognosis." }] });
    const r = validated(b, b.report);
    const gap = r.gaps.find((g) => g.sectionKey === "F-10")!;
    for (const who of [PAT, TOM]) assert.equal(reviewReducer(r, { type: "resolveGap", gapId: gap.id, kind: "acknowledged", text: "Left blank on purpose.", actor: who }), r, who.name);
    const settled = reviewReducer(r, { type: "resolveGap", gapId: gap.id, kind: "resolved", text: "Answered on the form by Sarah Reid.", actor: SARAH });
    assert.equal(settled.gaps.find((g) => g.id === gap.id)?.resolution?.by?.memberId, SARAH.memberId);
    const flag = flagsOn(r, "F-10", "OPINION_LANGUAGE")[0];
    assert.ok(flag);
    assert.equal(reviewReducer(r, { type: "acknowledgeFlag", flagId: flag.id, reason: "Checked against the notes.", actor: PAT }), r);
    const acked = reviewReducer(r, { type: "acknowledgeFlag", flagId: flag.id, reason: "My own clinical opinion.", actor: SARAH });
    assert.equal(acked.flags.find((f) => f.id === flag.id)?.acknowledged?.by?.memberId, SARAH.memberId);
    // An acknowledgement stamped by staff never stands when the validators run again.
    const forged = { ...flag, acknowledged: { reason: "Forged.", at: r.updatedAt, by: PAT } };
    assert.equal(acknowledgementStands(flag, r, forged.acknowledged), false);
    assert.equal(acknowledgementStands(flag, r, { by: SARAH }), true);
  });

  it("not applicable on a clinician box, applies anyway, own voice and attribution fixes are the approver's", async () => {
    const b = await form({ "F-10": [] }, { gaps: [{ box: "F-10", issue: "No clinician recorded a prognosis." }] });
    const r = validated(b, b.report);
    assert.equal(reviewReducer(r, { type: "markNotApplicable", key: "F-10", on: true, actor: PAT }), r);
    assert.equal(reviewReducer(r, { type: "setDisposition", key: "F-31", kind: "applies_anyway", reason: "Applies.", actor: PAT }), r);
    const na = reviewReducer(r, { type: "markNotApplicable", key: "F-10", on: true, actor: SARAH });
    const d = box(na, "F-10").disposition;
    assert.equal(d?.kind, "not_applicable");
    assert.equal(d?.by.memberId, SARAH.memberId);
    assert.ok(na.gaps.filter((g) => g.sectionKey === "F-10").every((g) => g.resolution?.by?.memberId === SARAH.memberId));
    const cleared = reviewReducer(na, { type: "markNotApplicable", key: "F-10", on: false, actor: SARAH });
    assert.equal(box(cleared, "F-10").disposition, undefined);
    assert.ok(cleared.gaps.some((g) => g.sectionKey === "F-10" && !g.resolution), "its gaps open again");
    assert.equal(reviewReducer(r, { type: "writeInOwnVoice", authorName: "Pat Morgan", actor: PAT }), r);
  });

  it("'Leave optional boxes blank' never covers a clinician box for anyone but the approver", async () => {
    const b = await form({}, { answers: { "F-07": false }, gaps: [{ box: "F-08", issue: "No clinician recorded an expected date back at work." }] });
    const r = validated(b, b.report);
    const leave = (who: Actor) => reviewReducer(r, { type: "leaveOptionalBlank", keys: [], opinionKeys: ["F-08"], reason: "Optional on the form – left blank.", template: b.template, form: b.form, actor: who });
    for (const who of [PAT, TOM]) assert.ok(leave(who).gaps.some((g) => g.sectionKey === "F-08" && !g.resolution), who.name);
    assert.ok(leave(SARAH).gaps.filter((g) => g.sectionKey === "F-08").every((g) => g.resolution?.kind === "acknowledged"));
  });
});

describe("Take over as approver", () => {
  it("voids the previous approver's decisions; what she wrote waits for the new approver; staff cannot take over", async () => {
    const b = await form({ "F-10": [{ text: "In my own view he will make a full recovery within 6 weeks.", cites: ["N-001"], origin: "edited", originalText: "He reported a lifting injury at work on 12/03/2026.", by: "sarah" }] });
    let r = validated(b, b.report);
    const flag = flagsOn(r, "F-10", "OPINION_LANGUAGE")[0];
    r = validated(b, reviewReducer(r, { type: "acknowledgeFlag", flagId: flag.id, reason: "My own clinical opinion.", actor: SARAH }));
    assert.ok(r.flags.find((f) => f.id === flag.id)?.acknowledged);
    assert.equal(reviewReducer(r, { type: "takeOverApprover", actor: PAT }), r, "staff never approve");
    const taken = validated(b, reviewReducer(r, { type: "takeOverApprover", actor: TOM }));
    assert.equal(taken.approver?.memberId, TOM.memberId);
    assert.equal(taken.approverTakeovers?.at(-1)?.from.memberId, SARAH.memberId);
    assert.equal(taken.flags.find((f) => f.id === flag.id)?.acknowledged, undefined, "Sarah's acknowledgement is void");
    assert.ok(taken.sections.every((s) => s.paragraphs.every((p) => p.origin !== "clinician" || p.by?.memberId === TOM.memberId)), "Sarah's own words are no longer the approver's");
    assert.ok(flagsOn(taken, "F-10", "APPROVER_DECISION").length === 1);
    assert.ok(taken.activity.some((a) => a.action === "approver_taken_over"));
  });
});

describe("labels come from the stamps", () => {
  const cases: Array<[string, string, Record<string, unknown>, string]> = [
    ["a structured answer the approver chose, beside drafted supporting text", "F-04", { answers: { "F-04": "Lighter duties" }, answersBy: { "F-04": "sarah" }, boxes: { "F-04": [{ text: "Back on lighter duties.", cites: ["N-002"] }] } }, "clinician"],
    ["a staff entry (record box) typed by staff", "F-25", { boxes: { "F-25": [{ text: "H-482910", cites: [], origin: "staff", by: "pat" }] } }, "staff"],
    ["a staff entry typed by the approver", "F-25", { boxes: { "F-25": [{ text: "H-482910", cites: [], origin: "clinician", by: "sarah" }] } }, "clinician"],
    ["a drafted narrative answer", "F-31", { boxes: { "F-31": [{ text: "He reported a lifting injury at work.", cites: ["N-001"] }] } }, "drafted"],
    ["the approver's own words", "F-31", { boxes: { "F-31": [{ text: "Lifting injury at work.", cites: [], origin: "clinician", by: "sarah" }] } }, "clinician"],
  ];
  for (const [what, key, extra, want] of cases) {
    it(`${what}: ${want}`, async () => {
      const b = await buildCase(CaseInputSchema.parse({ report: "form:cf-discharge", ...extra }));
      assert.equal(answerSource(box(b.report, key)), want);
    });
  }
  it("staff text in an opinion box reads neither 'clinician' nor 'drafted': it is blocked as a proposal", async () => {
    const b = await buildCase(CaseInputSchema.parse({ report: "form:cf-discharge", box: "F-10", boxes: { "F-10": [{ text: "Settling well.", cites: [], origin: "staff", by: "pat" }] } }));
    const r = validated(b, b.report);
    const field = b.form!.fields.find((f) => f.id === "F-10")!;
    assert.equal(questionStatus({ section: box(r, "F-10"), field }, r.flags, r.gaps, true, false, r.sections), "blocked");
  });
  it("B2-21: an unanswered staff entry is for staff to enter, not 'Needs clinician input'", async () => {
    const b = await form();
    const field = b.form!.fields.find((f) => f.id === "F-26")!;
    const s = { ...box(b.report, "F-26"), paragraphs: [] };
    const gaps: Gap[] = [{ id: "gap-F-26-staff", sectionKey: "F-26", issue: "Entered by staff.", suggestedQuestion: "", relatedNoteIds: [] }];
    assert.equal(questionStatus({ section: s, field: { ...field, required: true } }, [], gaps, false, false, b.report.sections), "staff_input");
  });
});

describe("B1-15 / NEW-1: a 'staff entry' that asks for a clinical decision is the approver's", () => {
  it("staff ticking a work-restriction choice leaves it open and a proposal; the approver's tick settles it", async () => {
    const { computeFacts } = await import("../../../core/computed-facts");
    const { formToTemplate } = await import("../../../core/forms");
    const { createFormReport } = await import("../../../core/report-factory");
    const { testBundle } = await import("../../../core/validation/test-fixtures");
    const { canSign } = await import("../../../core/validation");
    const AT = "2026-10-25T09:00:00.000Z";
    const field = { id: "F-01", label: "Restriction required – lifting", guidance: "", anchor: { kind: "docx", target: "table_cell", blockId: "t0.r0.c1" }, required: true, confidence: "high", answerType: "checkbox", options: ["Lifting"], fillSource: { kind: "registration", path: "staff.entry" } };
    const f = { id: "frm_restriction", tenantId: "demo", referrer: { name: "Example Freight Ltd (fictional)", type: "employer" }, title: "Initial Assessment", file: { fileName: "f.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sha256: "e".repeat(64), sizeBytes: 1 }, kind: "docx", fields: [field], status: "confirmed", analysis: { mode: "rules", promptVersion: "t", at: AT, warnings: [] }, createdAt: AT, updatedAt: AT } as never;
    const bundle = testBundle();
    const approver = { memberId: SARAH.memberId, name: SARAH.name, hcpc: SARAH.hcpc! };
    const r0 = createFormReport({ form: f, bundle, instructingParty: bundle.referral, computedFacts: computeFacts(bundle, { asOf: "2026-10-06" }), id: "rpt_restriction", now: new Date(AT), approver });
    const check = (r: Report) => ({ ...r, flags: validateReport(r, formToTemplate(f), { form: f }).flags });
    const byPat = check(reviewReducer(check(r0), { type: "setAnswer", key: "F-01", value: true, actor: PAT }));
    assert.equal(canSign(byPat.flags, byPat.gaps).ok, false);
    assert.ok(byPat.flags.some((x) => x.code === "APPROVER_DECISION"));
    assert.ok(byPat.gaps.some((g) => g.sectionKey === "F-01" && !g.resolution));
    const bySarah = check(reviewReducer(check(r0), { type: "setAnswer", key: "F-01", value: true, actor: SARAH }));
    assert.equal(canSign(bySarah.flags, bySarah.gaps).ok, true, JSON.stringify(canSign(bySarah.flags, bySarah.gaps).blocking.map((x) => x.code)));
  });
});

/* ------------------------------------------------------------------------------------------------
 * check-WC (independent review of 549a06f): the problems it found, each as it was reached
 * ----------------------------------------------------------------------------------------------*/

describe("check-WC problem 1: one acknowledgement never clears drafted residue kept in the same paragraph", () => {
  it("A1: the approver acknowledges the check on her own sentence; the drafted opinion kept beside it still blocks", async () => {
    const b = await form({ "F-10": [{ text: OPINION, cites: ["N-001"] }] });
    const pid = box(b.report, "F-10").paragraphs[0].id;
    const mine = "In my opinion he is fit for full duties.";
    const edited = run(b, b.report, { type: "editParagraph", key: "F-10", paragraphId: pid, text: `${mine} ${OPINION}`, actor: SARAH });
    const ops = flagsOn(edited, "F-10", "OPINION_LANGUAGE");
    const ackable = ops.filter((f) => canAcknowledge(f, edited, SARAH));
    const never = ops.filter((f) => !canAcknowledge(f, edited, SARAH));
    assert.ok(ackable.length > 0 && never.length > 0, ops.map((f) => f.evidence).join(" | "));
    const acked = run(b, edited, { type: "acknowledgeFlag", flagId: ackable[0].id, reason: "My own clinical opinion.", actor: SARAH });
    const after = flagsOn(acked, "F-10", "OPINION_LANGUAGE");
    for (const n of never) assert.ok(after.some((f) => f.id === n.id && !f.acknowledged), `the drafted residue "${n.evidence}" is still open`);
    assert.ok(after.some((f) => f.id === ackable[0].id && f.acknowledged), "her own sentence's check is acknowledged");
    assert.equal(canSign(acked.flags, acked.gaps).ok, false);
  });

  it("a paragraph's acknowledgement reason does not survive someone else's change to its words", async () => {
    const b = await form({ "F-31": [{ text: "In my own view he is fit for normal duties.", cites: ["N-001"], origin: "edited", originalText: "He reported a lifting injury at work on 12/03/2026.", by: "sarah" }] });
    const r = validated(b, b.report);
    const flag = flagsOn(r, "F-31", "OPINION_LANGUAGE")[0];
    assert.ok(flag, "an opinion check on the narrative box");
    const acked = run(b, r, { type: "acknowledgeFlag", flagId: flag.id, reason: "My own clinical opinion.", actor: SARAH });
    const pid = box(acked, "F-31").paragraphs[0].id;
    assert.ok(box(acked, "F-31").paragraphs[0].ackReason);
    const patEdit = run(b, acked, { type: "editParagraph", key: "F-31", paragraphId: pid, text: "In my own view he is fit for normal duties and heavy lifting.", actor: PAT });
    assert.equal(box(patEdit, "F-31").paragraphs[0].ackReason, undefined);
    assert.ok(flagsOn(patEdit, "F-31", "OPINION_LANGUAGE").some((f) => !f.acknowledged));
  });

  it("minor 9: an acknowledgement with no stamp stands only where anyone may acknowledge", async () => {
    const b = await form({ "F-10": [{ text: "In my own view he will make a full recovery within 6 weeks.", cites: ["N-001"], origin: "edited", originalText: "He reported a lifting injury at work on 12/03/2026.", by: "sarah" }] });
    const r = validated(b, b.report);
    const flag = flagsOn(r, "F-10", "OPINION_LANGUAGE")[0];
    assert.equal(acknowledgementStands(flag, r, { reason: "Unstamped." } as never), false, "approver-only: needs the approver's stamp");
    assert.equal(acknowledgementStands(flag, { ...r, approver: undefined }, { reason: "Unstamped." } as never), true, "an earlier build's report keeps its rule");
  });
});

describe("check-WC problem 5: what the approver confirmed in a clinician box is never removed behind her back", () => {
  it("E1: the approver's own words confirm the box; staff removing one of them leaves it 'changed since … last confirmed it'", async () => {
    const b = await form({ "F-10": [] });
    const written = run(
      b,
      b.report,
      { type: "addParagraph", key: "F-10", text: "Settling with exercise.", actor: SARAH },
      { type: "addParagraph", key: "F-10", text: "He is not fit for heavy lifting.", actor: SARAH },
    );
    assert.equal(flagsOn(written, "F-10", "APPROVER_DECISION").length, 0, "her own words need no extra click");
    assert.ok(adoptionCurrent(box(written, "F-10"), written.approver ?? null), "recorded as hers as it stands");
    assert.equal(written.activity.filter((a) => a.action === "adopted").length, 0, "no adoption is logged for her own entry");
    const pid = box(written, "F-10").paragraphs[1].id;
    const removed = run(b, written, { type: "removeParagraph", key: "F-10", paragraphId: pid, actor: PAT });
    assert.equal(box(removed, "F-10").paragraphs.length, 1);
    const d = flagsOn(removed, "F-10", "APPROVER_DECISION");
    assert.equal(d.length, 1);
    assert.match(d[0].message, /^Changed since Sarah Reid last confirmed it – the approving physio must adopt it/);
    assert.equal(canSign(removed.flags, removed.gaps).ok, false);
    // Sarah adopts the box as it now is (one click) – or puts her words back herself.
    const adopted = run(b, removed, { type: "adopt", key: "F-10", actor: SARAH });
    assert.equal(flagsOn(adopted, "F-10", "APPROVER_DECISION").length, 0);
    // Tom (a colleague, not the approver) emptying her words is the same.
    const emptied = run(b, written, { type: "editParagraph", key: "F-10", paragraphId: pid, text: "", actor: TOM });
    assert.equal(flagsOn(emptied, "F-10", "APPROVER_DECISION").length, 1);
  });

  it("a box her words were in before adoptions were recorded: removing them is undone (the store refuses it too)", async () => {
    const b = await form({ "F-10": [{ text: "Settling with exercise.", cites: [], origin: "clinician", by: "sarah" }, { text: "He is not fit for heavy lifting.", cites: [], origin: "clinician", by: "sarah" }] });
    const r0 = validated(b, b.report);
    const pid = box(r0, "F-10").paragraphs[1].id;
    const r1 = run(b, r0, { type: "removeParagraph", key: "F-10", paragraphId: pid, actor: PAT });
    assert.equal(box(r1, "F-10").paragraphs.length, 2, "her restriction stays");
    // Her own removal is hers to make.
    const r2 = run(b, r0, { type: "removeParagraph", key: "F-10", paragraphId: pid, actor: SARAH });
    assert.equal(box(r2, "F-10").paragraphs.length, 1);
  });

  it("staff changing or clearing the approver's tick waits for her; staff removing their own proposal is fine", async () => {
    const b = await form({}, { box: "F-11" });
    const ticked = run(b, b.report, { type: "setAnswer", key: "F-11", value: "0-3 months", actor: SARAH });
    assert.equal(flagsOn(ticked, "F-11", "APPROVER_DECISION").length, 0);
    const cleared = run(b, ticked, { type: "setAnswer", key: "F-11", value: null, actor: PAT });
    assert.equal(flagsOn(cleared, "F-11", "APPROVER_DECISION").length, 1, "a cleared answer waits for the approver");
    const b2 = await form({ "F-10": [] });
    const typed = run(b2, b2.report, { type: "addParagraph", key: "F-10", text: "Settling well.", actor: PAT });
    const gone = run(b2, typed, { type: "removeParagraph", key: "F-10", paragraphId: box(typed, "F-10").paragraphs[0].id, actor: PAT });
    assert.equal(box(gone, "F-10").paragraphs.length, 0);
    assert.equal(flagsOn(gone, "F-10", "APPROVER_DECISION").length, 0);
  });

  it("a stale adoption is renewed only by the approver's own Adopt, not by her next edit elsewhere in the box", async () => {
    const b = await form({ "F-10": [] });
    const written = run(b, b.report, { type: "addParagraph", key: "F-10", text: "Settling with exercise.", actor: SARAH }, { type: "addParagraph", key: "F-10", text: "He is not fit for heavy lifting.", actor: SARAH });
    const removed = run(b, written, { type: "removeParagraph", key: "F-10", paragraphId: box(written, "F-10").paragraphs[1].id, actor: PAT });
    const pid = box(removed, "F-10").paragraphs[0].id;
    const sarahEdit = run(b, removed, { type: "editParagraph", key: "F-10", paragraphId: pid, text: "Settling well with exercise.", actor: SARAH });
    assert.equal(flagsOn(sarahEdit, "F-10", "APPROVER_DECISION").length, 1);
  });
});

describe("check-WC minors 10 and 11: one-click fixes and note words", () => {
  it("an attribution, voice or note-words fix – or one whose proposal says so – is the approver's", async () => {
    const b = await form({ "F-10": [{ text: OPINION, cites: ["N-001"] }] });
    const pid = box(b.report, "F-10").paragraphs[0].id;
    const proposal = (generator: string, ackPolicy?: "approver" | "member" | "never") => ({ generator, sectionKey: "F-10", paragraphId: pid, label: "Fix", before: OPINION, after: OPINION, removedSpans: [], ...(ackPolicy ? { ackPolicy } : {}) });
    for (const g of ["name-clinician", "note-words", "own-voice"]) {
      assert.equal(mayApplyFix(b.report, proposal(g), PAT), false, g);
      assert.equal(mayApplyFix(b.report, proposal(g), TOM), false, g);
      assert.equal(mayApplyFix(b.report, proposal(g), SARAH), true, g);
    }
    assert.equal(mayApplyFix(b.report, proposal("shorten", "approver"), PAT), false);
    assert.equal(mayApplyFix(b.report, proposal("shorten"), PAT), true);
    assert.equal(mayApplyFix(b.report, proposal("shorten", "never"), SARAH), false);
  });

  it("'Accept as the note's words' with no phrase named accepts nothing when more than one phrase is open", async () => {
    const b = await form({ "F-10": [{ text: "He is fit for normal duties and expected to make a full recovery.", cites: ["N-001"] }] });
    const r = validated(b, b.report);
    const open = flagsOn(r, "F-10", "OPINION_LANGUAGE");
    if (open.length > 1) {
      const pid = box(r, "F-10").paragraphs[0].id;
      assert.equal(reviewReducer(r, { type: "acceptNoteWords", key: "F-10", paragraphId: pid, actor: SARAH }), r);
    }
  });
});
