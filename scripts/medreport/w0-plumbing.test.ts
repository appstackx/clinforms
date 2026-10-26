/**
 * W0.6 plumbing (bh2): the stubs and seams the workstreams fill in are wired and inert – the attribution validators are
 * registered and give no flags, the DRAFT_FIT stub parts give none, the /sign stub checks refuse nothing, the explicit
 * voice owner reaches the voice check (and its default is the report's author, as before), ackPolicyOf follows today's
 * acknowledgement rule, and a review action's actor decides the NEW-1 stop-gap. Fictional data only.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SOLICITOR_RTA_TEMPLATE } from "../../src/modules/medreport/templates/registry";
import { namedActor } from "../../src/modules/medreport/core/actor";
import { computeFacts } from "../../src/modules/medreport/core/computed-facts";
import type { Report, ReportFlag } from "../../src/modules/medreport/core/types";
import { VALIDATORS, canAcknowledge, runValidators, validateReport } from "../../src/modules/medreport/core/validation";
import { ackPolicyOf } from "../../src/modules/medreport/core/validation/acknowledge";
import { voiceOwnerOf } from "../../src/modules/medreport/core/validation/context";
import { validateClinicianNamed } from "../../src/modules/medreport/core/validation/attribution-clinician-named";
import { validateColleagueNamed } from "../../src/modules/medreport/core/validation/attribution-colleague-named";
import { validateOpinionBoxQuotes } from "../../src/modules/medreport/core/validation/attribution-opinion-boxes";
import { fragmentsPart } from "../../src/modules/medreport/core/validation/draft-fit/fragments";
import { printedLeadPart } from "../../src/modules/medreport/core/validation/draft-fit/printed-lead";
import { TEST_FACTS_DATE, para, testBundle, testReport, withSection } from "../../src/modules/medreport/core/validation/test-fixtures";
import { issuedDocumentCheck, staleReportCheck } from "../../src/modules/medreport/api/handlers/sign/checks/issue";
import { approverCheck } from "../../src/modules/medreport/api/handlers/sign/checks/roles";
import { signerConfirmationsCheck } from "../../src/modules/medreport/api/handlers/sign/checks/voice";
import type { SignCheckContext } from "../../src/modules/medreport/api/handlers/sign/checks/context";
import { reviewReducer } from "../../src/modules/medreport/ui/components/review/use-review-state";

const SOL = SOLICITOR_RTA_TEMPLATE;
const sarah = { name: "Sarah Reid", hcpc: "PH-DEMO-01", role: "Senior Physiotherapist, MCSP" };
const tom = { name: "Tom Ellis", hcpc: "PH-DEMO-02", role: "Physiotherapist, MCSP" };

/** A drafted "told me" citing Tom Ellis's note N-002 (fictional record), in a report with `author`. */
function voiceReport(author: typeof sarah | undefined): Report {
  const told = para("Mr Testcase told me that his back pain had eased to 2/10.", ["N-002"], { basis: "patient_reported" });
  const report = withSection(testReport(SOL), "presenting_complaints", [told]);
  return author ? { ...report, author } : report;
}

const otherVoice = (flags: ReportFlag[]) => flags.filter((f) => f.code === "OTHER_CLINICIAN_VOICE");

describe("W0.6 plumbing", () => {
  it("WB's attribution validators are registered, in the voice group, and give no flags yet", () => {
    const names = VALIDATORS.map((v) => v.name);
    const voice = names.indexOf("voice");
    assert.deepEqual(names.slice(voice + 1, voice + 4), ["attribution-opinion-boxes", "attribution-colleague-named", "attribution-clinician-named"]);
    const report = voiceReport(sarah);
    const input = { report, bundle: report.bundleSnapshot, template: SOL, computedFacts: computeFacts(report.bundleSnapshot, { asOf: TEST_FACTS_DATE }) };
    for (const v of [validateOpinionBoxQuotes, validateColleagueNamed, validateClinicianNamed]) assert.deepEqual(v(input), []);
    assert.equal(new Set(names).size, names.length, "validator names are unique (they name the check that could not run)");
  });

  it("WD's DRAFT_FIT stub parts give no flags", () => {
    const report = voiceReport(sarah);
    const input = { report, bundle: report.bundleSnapshot, template: SOL, computedFacts: [] };
    assert.deepEqual(fragmentsPart(input), {});
    assert.deepEqual(printedLeadPart(input), {});
  });

  it("the /sign stub checks refuse nothing", async () => {
    const report = voiceReport(sarah);
    const ctx = { req: new Request("http://localhost/api/reports/v1/sign"), deps: {} as SignCheckContext["deps"], actor: {} as SignCheckContext["actor"], report, signer: sarah, template: SOL, form: null, started: Date.now() };
    for (const check of [approverCheck, staleReportCheck, signerConfirmationsCheck, issuedDocumentCheck]) assert.equal(await check(ctx), null);
  });

  it("validateReport takes an explicit voice owner; without one the owner is the report's author, as before", () => {
    const withAuthor = voiceReport(sarah);
    assert.equal(voiceOwnerOf({ report: withAuthor }), withAuthor.author);
    assert.equal(voiceOwnerOf({ report: withAuthor, voice: { owner: null } }), null);
    const before = validateReport(withAuthor, SOL).flags;
    assert.equal(otherVoice(before).length, 1, "Sarah Reid's report says 'told me' about Tom Ellis's note");
    assert.deepEqual(validateReport(withAuthor, SOL, { voice: { owner: sarah } }).flags, before, "naming the same owner changes nothing");
    assert.deepEqual(otherVoice(validateReport(withAuthor, SOL, { voice: { owner: tom } }).flags), [], "Tom Ellis's own note in his own voice");
    // No author: no voice check unless the caller names an owner.
    const noAuthor = voiceReport(undefined);
    assert.deepEqual(otherVoice(validateReport(noAuthor, SOL).flags), []);
    assert.equal(otherVoice(validateReport(noAuthor, SOL, { voice: { owner: sarah } }).flags).length, 1);
    // runValidators reads it from its input too.
    const input = { report: noAuthor, bundle: noAuthor.bundleSnapshot, template: SOL, computedFacts: computeFacts(noAuthor.bundleSnapshot, { asOf: TEST_FACTS_DATE }) };
    assert.equal(otherVoice(runValidators({ ...input, voice: { owner: sarah } })).length, 1);
  });

  it("ackPolicyOf: today's rule (member where an acknowledgement is allowed, never where it is not) unless the flag says", () => {
    const flags = validateReport(voiceReport(sarah), SOL).flags;
    const voice = otherVoice(flags)[0];
    assert.ok(voice);
    assert.equal(canAcknowledge(voice, voiceReport(sarah)), false);
    assert.equal(ackPolicyOf(voice, voiceReport(sarah)), "never", "drafted text in another clinician's first person");
    const warning = { ...voice, severity: "warning" as const };
    assert.equal(ackPolicyOf(warning), "member");
    assert.equal(ackPolicyOf({ ...warning, ackPolicy: "approver" }), "approver", "a validator's own policy wins");
  });

  it("a review action's actor drives the NEW-1 stop-gap: staff typing an opinion leaves its gap open, the clinician's answer settles it", () => {
    const base = testReport(SOL, testBundle());
    const key = base.sections.find((s) => s.kind === "clinician_opinion")?.key;
    assert.ok(key, "the template has an opinion section");
    const report: Report = {
      ...base,
      sections: base.sections.map((s) => (s.key === key ? { ...s, paragraphs: [], status: "needs_input" as const } : s)),
      gaps: [{ id: `gap-${key}-1`, sectionKey: key, issue: "No opinion recorded (fictional).", suggestedQuestion: "What is your opinion?", relatedNoteIds: [] }],
    };
    const typed = (role: "staff" | "clinician") =>
      reviewReducer(report, { type: "addParagraph", key, text: "In my opinion he will keep improving.", actor: namedActor(role === "staff" ? "Pat Morgan" : "Sarah Reid", role) });
    assert.equal(typed("staff").gaps[0].resolution, undefined, "staff: the clinician gap stays open");
    assert.equal(typed("clinician").gaps[0].resolution?.kind, "resolved", "the clinician's own answer settles it");
    assert.equal(typed("staff").sections.find((s) => s.key === key)?.paragraphs[0].origin, "edited", "staff text is checked as edited text (C-REV-2 stop-gap)");
  });

  it("the drafting step's activity line is 'System' (a system action carries no person)", () => {
    const report = testReport(SOL);
    const next = reviewReducer(report, { type: "systemActivity", action: "draft_failed", detail: "Drafting F-01 failed (fictional)." });
    assert.equal(next.activity[next.activity.length - 1].actor, "System");
  });
});
