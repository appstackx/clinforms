/**
 * Blue Heart trial, finding 5 – one entry per clinician on "Check the notes before they are used".
 *
 * The trial's sample notes name "Sarah Reid (PH-DEMO-01)"; her clinic profile holds an HCPC number in the real
 * format ("ZZ0001" here – PH-DEMO numbers are refused there). The clinician list showed her twice, and choosing either
 * split her notes between two "clinicians" in the record. Now the notes' clinicians are matched to the clinic's members
 * – by HCPC number when both have a valid one, otherwise by full name – and every downstream use (note authors, the
 * record's clinicians, the treating clinician on the form, the drafting block) sees one person. FICTIONAL data only.
 */
import * as React from "react";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { isValidHcpc } from "@/lib/hcpc";
import { buildEpisodeBlock } from "@/modules/medreport/ai/prompts";
import { readNotesUpload } from "@/modules/medreport/connectors/file-import/connector";
import { bundleFromReview } from "@/modules/medreport/connectors/file-import/review-bundle";
import { NotesReviewSchema, type NotesReview, type NotesReviewEntry } from "@/modules/medreport/connectors/file-import/review-contract";
import type { ConnectorContext } from "@/modules/medreport/connectors/types";
import { computeFacts } from "@/modules/medreport/core/computed-facts";
import { primaryTreatingClinician } from "@/modules/medreport/core/forms";
import { otherClinicianVoice } from "@/modules/medreport/core/voice";
import { HostHooksProvider } from "@/modules/medreport/ui/host-hooks";
import { NotesReviewStep } from "@/modules/medreport/ui/components/new/notes-review";
import { instructingPartyOf } from "@/modules/medreport/ui/components/new/generate";
import {
  clinicianLabel,
  clinicianMatchNotices,
  reviewClinicians,
  reviewCounts,
  validHcpcNumber,
  withMemberNumbers,
} from "@/modules/medreport/ui/components/new/notes-review-model";

(globalThis as unknown as { React: typeof React }).React = React;

const NOW = new Date("2026-10-25T09:00:00.000Z");
const ctx = (): ConnectorContext => ({ tenantId: "clinic-a", credentials: { kind: "none" }, baseUrl: "", fetch: (u, i) => fetch(u, i), trace: [] });

/** Printed in the welcome pack's layout (written for this test, not copied from it). */
const PRINTED_NOTES = `Clinical notes report
FICTIONAL PATIENT – made-up details for trial use

Name: Mr Alder Quinn (fictional)   Patient no.: SAMPLE-0099
Date of birth: 11/03/1990   Sex: Male
Medico-legal company: Fennick Medical Reporting (fictional)
Reference: FMR-26-00001
Consent to disclose: Yes – signed 15/07/2026

15/07/2026 09:00   Initial assessment
Practitioner: Sarah Reid (PH-DEMO-01)   Status: Attended
S: Neck pain after a rear-end collision on 04/07/2026.
A: Whiplash associated disorder grade II.
P: Six sessions over eight weeks.

05/08/2026 09:00   Follow-up
Practitioner: Tom Ellis (PH-DEMO-02)   Status: Attended
S: Covering Sarah Reid's annual leave. Neck aching after a long drive.

16/09/2026 09:00   Discharge
Practitioner: Sarah Reid (PH-DEMO-01)   Status: Attended
A: In my opinion the remaining stiffness should settle within 4–6 weeks.
`;

async function printedReview(): Promise<NotesReview> {
  const out = await readNotesUpload(ctx(), { format: "text", content: PRINTED_NOTES }, { now: NOW });
  if (out.kind !== "review") assert.fail("expected the notes to be read as ordinary clinic notes");
  return NotesReviewSchema.parse(out.review);
}

/** The trial clinic: the owner (no HCPC number) and the made-up physio who approves. */
const MEMBERS = [
  { name: "Dell Baines", hcpc: "" },
  { name: "Sarah Reid", hcpc: "ZZ0001" },
];

/** A NotesReview with just these entries (the review fields the matching does not read are empty). */
function reviewOf(clinicians: Array<[string, string]>): NotesReview {
  const entry = (i: number, [name, hcpc]: [string, string]): NotesReviewEntry => ({
    key: `E-${i + 1}`,
    where: `line ${i + 1}`,
    include: true,
    date: "2026-07-15",
    time: "",
    type: "follow_up",
    clinicianName: name,
    clinicianHcpc: hcpc,
    status: "",
    reason: "",
    heading: "Follow-up",
    body: "S: Better.",
  });
  return { entries: clinicians.map((c, i) => entry(i, c)) } as unknown as NotesReview;
}
const labels = (review: NotesReview, members: Array<{ name: string; hcpc: string }> = []) => reviewClinicians(review, members).map(clinicianLabel);
const entryLabels = (review: NotesReview) => review.entries.map((e) => clinicianLabel({ name: e.clinicianName, hcpc: e.clinicianHcpc }));

describe("finding 5: the notes' clinicians and the clinic's members, one entry per person", () => {
  test("Sarah Reid (PH-DEMO-01) in the notes and Sarah Reid (ZZ0001) in her profile are one clinician", async () => {
    const read = await printedReview();
    assert.deepEqual(entryLabels(read), ["Sarah Reid (PH-DEMO-01)", "Tom Ellis (PH-DEMO-02)", "Sarah Reid (PH-DEMO-01)"]);

    // Before the fix: ["Sarah Reid (PH-DEMO-01)", "Tom Ellis (PH-DEMO-02)", "Dell Baines", "Sarah Reid (ZZ0001)"].
    assert.deepEqual(labels(read, MEMBERS), ["Sarah Reid (ZZ0001)", "Tom Ellis (PH-DEMO-02)", "Dell Baines"]);
    const matched = withMemberNumbers(read, MEMBERS);
    assert.deepEqual(entryLabels(matched), ["Sarah Reid (ZZ0001)", "Tom Ellis (PH-DEMO-02)", "Sarah Reid (ZZ0001)"], "each note keeps its own clinician");
    assert.equal(reviewCounts(matched).clinicians, 2);
    assert.deepEqual(clinicianMatchNotices(read, MEMBERS), [
      "Sarah Reid (PH-DEMO-01) in the notes is shown as Sarah Reid (ZZ0001), from your clinic's members. If that is someone else, change the clinician on those entries.",
    ]);

    // The screen: one option per person in every clinician list, the entries already on Sarah's profile, the line under "Also check".
    const html = renderToStaticMarkup(
      createElement(HostHooksProvider, {
        hooks: { mode: "tenant", clinic: { tenantId: "clinic-a", name: "Blue Heart Clinics (fictional)", clinicians: MEMBERS.map((m) => (m.hcpc ? m : { name: m.name })) } },
        children: createElement(NotesReviewStep, { review: read, tenant: true, busy: false, error: null, onConfirm: () => undefined, onBack: () => undefined }),
      }),
    );
    assert.doesNotMatch(html, /<option[^>]*>Sarah Reid \(PH-DEMO-01\)<\/option>/);
    const sarahOptions = html.match(/<option[^>]*>Sarah Reid[^<]*<\/option>/g) ?? [];
    assert.equal(sarahOptions.length, 3, "one Sarah Reid in each of the three entries' lists");
    assert.ok(sarahOptions.every((o) => o.endsWith(">Sarah Reid (ZZ0001)</option>")));
    assert.equal((html.match(/<option[^>]*selected=""[^>]*>Sarah Reid \(ZZ0001\)<\/option>/g) ?? []).length, 2, "Sarah's two notes show her profile");
    assert.match(html, /Also check/);
    assert.match(html, /Sarah Reid \(PH-DEMO-01\) in the notes is shown as Sarah Reid \(ZZ0001\), from your clinic&#x27;s members\./);
  });

  test("downstream: the record, the treating clinician, the drafting block and approval all see one Sarah Reid", async () => {
    const matched = withMemberNumbers(await printedReview(), MEMBERS);
    const built = bundleFromReview(matched, { tenantId: "clinic-a", now: NOW });
    assert.ok(built.ok, JSON.stringify(!built.ok && built.issues));
    if (!built.ok) return;
    const { bundle } = built;
    assert.deepEqual(bundle.clinicians.map(clinicianLabel), ["Sarah Reid (ZZ0001)", "Tom Ellis (PH-DEMO-02)"]);
    assert.deepEqual(
      bundle.notes.map((n) => [n.date, clinicianLabel(n.author)]),
      [
        ["2026-07-15", "Sarah Reid (ZZ0001)"],
        ["2026-08-05", "Tom Ellis (PH-DEMO-02)"],
        ["2026-09-16", "Sarah Reid (ZZ0001)"],
      ],
      "Tom Ellis's note stays his; Sarah's notes are hers, with her profile's number",
    );
    // The form's treating clinician (clinician.name / clinician.hcpc) is the profile's, never PH-DEMO-01.
    assert.equal(clinicianLabel(primaryTreatingClinician(bundle)!), "Sarah Reid (ZZ0001)");
    const facts = computeFacts(bundle, { asOf: "2026-10-25" });
    assert.match(facts.find((f) => f.id === "FACT-episode")?.detail ?? "", /by 2 clinicians: Sarah Reid \(ZZ0001\) 2 notes; Tom Ellis \(PH-DEMO-02\) 1 note\./);
    // The drafting service is told the signing author is "Sarah Reid (ZZ0001)": the notes now name her the same way.
    assert.match(buildEpisodeBlock(bundle, facts, instructingPartyOf(bundle)), /<clinicians>Notes were written by: Sarah Reid \(ZZ0001\); Tom Ellis \(PH-DEMO-02\)\.<\/clinicians>/);
    // Approval: the author is the signed-in member; Sarah approving her own first-person draft is not someone else's voice.
    const report = { author: { name: "Sarah Reid", hcpc: "ZZ0001" }, sections: [{ key: "F-37", paragraphs: [{ origin: "ai", text: "Mr Quinn told me he took 3 days off work." }] }] };
    assert.equal(otherClinicianVoice(report as never, { name: "Sarah Reid", hcpc: "ZZ0001" }), null);
    assert.notEqual(otherClinicianVoice(report as never, { name: "Tom Ellis", hcpc: "PH-DEMO-02" }), null, "unchanged: another clinician cannot approve Sarah's first person");
  });
});

describe("the matching rules", () => {
  test("valid HCPC numbers decide: the same number written differently is one person, two different numbers are two", () => {
    assert.deepEqual(labels(reviewOf([["Sarah Reid", "PH 123-456"]]), [{ name: "Sarah Reid", hcpc: "PH123456" }]), ["Sarah Reid (PH123456)"]);
    assert.deepEqual(clinicianMatchNotices(reviewOf([["Sarah Reid", "ph 123456"]]), [{ name: "Sarah Reid", hcpc: "PH123456" }]), [], "only the spacing differs: nothing to say");
    const two = reviewOf([["Sarah Reid", "PH111111"], ["Sarah Reid", "PH222222"]]);
    assert.deepEqual(labels(two), ["Sarah Reid (PH111111)", "Sarah Reid (PH222222)"]);
    assert.deepEqual(entryLabels(withMemberNumbers(two, [{ name: "Sarah Reid", hcpc: "PH222222" }])), ["Sarah Reid (PH111111)", "Sarah Reid (PH222222)"], "never merged");
  });

  test("without a valid number on one side, the full name decides – never a different name", () => {
    // No number, PH-DEMO-01 and "Not recorded" all count as no number.
    const r = reviewOf([["Sarah Reid", ""], ["sarah  reid", "PH-DEMO-01"], ["SARAH REID", "Not recorded"], ["Tom Ellis", "PH-DEMO-01"]]);
    assert.deepEqual(entryLabels(withMemberNumbers(r, [{ name: "Sarah Reid", hcpc: "PH123456" }])), ["Sarah Reid (PH123456)", "Sarah Reid (PH123456)", "Sarah Reid (PH123456)", "Tom Ellis (PH-DEMO-01)"]);
    assert.deepEqual(labels(r, [{ name: "Sarah Reid", hcpc: "PH123456" }]), ["Sarah Reid (PH123456)", "Tom Ellis (PH-DEMO-01)"]);
    // Different names stay apart, whatever their numbers; accents, full stops and hyphens are not differences.
    assert.deepEqual(labels(reviewOf([["Dr Sarah Reid", ""], ["S. Reid", ""], ["Zoë Ann-Marie O'Neil", ""]]), [{ name: "Zoe Ann Marie ONeil", hcpc: "PH654321" }, { name: "Sarah Reid", hcpc: "PH123456" }]), [
      "Dr Sarah Reid",
      "S. Reid",
      "Zoe Ann Marie ONeil (PH654321)",
      "Sarah Reid (PH123456)",
    ]);
    assert.deepEqual(labels(reviewOf([["S Reid", "PH123456"]]), [{ name: "Sarah Reid", hcpc: "PH123456" }]), ["S Reid (PH123456)", "Sarah Reid (PH123456)"], "the same number with a different name is not merged");
  });

  test("a clinician without a valid number is never guessed between two people of that name", () => {
    const members = [
      { name: "Sarah Reid", hcpc: "PH111111" },
      { name: "Sarah Reid", hcpc: "PH222222" },
    ];
    const r = reviewOf([["Sarah Reid", "PH-DEMO-01"], ["Sarah Reid", ""]]);
    assert.deepEqual(labels(r, members), ["Sarah Reid (PH-DEMO-01)", "Sarah Reid (PH111111)", "Sarah Reid (PH222222)"]);
    assert.deepEqual(entryLabels(withMemberNumbers(r, members)), ["Sarah Reid (PH-DEMO-01)", "Sarah Reid (PH-DEMO-01)"]);
    assert.deepEqual(clinicianMatchNotices(r, members), []);
  });

  test("notes only (the public demo): the same person once, with the number their other notes give", () => {
    const r = reviewOf([["Sarah Reid", ""], ["Sarah Reid", "PH-DEMO-01"], ["Tom Ellis", "PH-DEMO-02"]]);
    assert.deepEqual(labels(r), ["Sarah Reid (PH-DEMO-01)", "Tom Ellis (PH-DEMO-02)"]);
    assert.deepEqual(entryLabels(withMemberNumbers(r, [])), ["Sarah Reid (PH-DEMO-01)", "Sarah Reid (PH-DEMO-01)", "Tom Ellis (PH-DEMO-02)"]);
    const valid = reviewOf([["Sarah Reid", "PH-DEMO-01"], ["Sarah Reid", "PH123456"]]);
    assert.deepEqual(clinicianMatchNotices(valid, []), [
      "Sarah Reid (PH-DEMO-01) in the notes is shown as Sarah Reid (PH123456), as on the other notes. If that is someone else, change the clinician on those entries.",
    ]);
    const unchanged = reviewOf([["Sarah Reid", "PH-DEMO-01"], ["Tom Ellis", "PH-DEMO-02"]]);
    assert.equal(withMemberNumbers(unchanged, []), unchanged, "nothing to match: the same review");
  });

  test("entries without a clinician, or 'Not recorded', stay as they are", () => {
    const r = reviewOf([["", ""], ["Not recorded", ""]]);
    assert.equal(withMemberNumbers(r, MEMBERS), r);
    assert.deepEqual(labels(r, MEMBERS), ["Dell Baines", "Sarah Reid (ZZ0001)"]);
  });

  test("the HCPC format matches the one member profiles are checked against (src/lib/hcpc.ts)", () => {
    for (const n of ["PH123456", "ph 123-456", "OT12345", "ZZ0001", "PH-DEMO-01", "PHDEMO01", "123456", "PH1234567", "Not recorded", "", "ABCD1234"]) {
      assert.equal(validHcpcNumber(n) !== "", isValidHcpc(n), n);
    }
  });
});
