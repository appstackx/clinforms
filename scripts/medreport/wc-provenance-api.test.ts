/**
 * bh2 WC – the server records who did what (designs 1, 2 and 8), through the real handlers (PUT/GET /store/reports,
 * POST /sign) on the in-memory tenant store, with the safety corpus's fictional clinic: Sarah Reid (owner, approves),
 * Tom Ellis (clinician, may sign), Pat Morgan (staff).
 *
 * - a PUT is compared with the stored revision: a decision stamped as someone else, or an approver-only decision by
 *   someone else, is refused (403 DECISION_NOT_ALLOWED); the approver's own decisions are stored;
 * - the approver changes only by the member's own takeover;
 * - an approved report's flags are byte-equal and its activity only grows (the server's "superseded" entry is kept
 *   when a client's older copy lacks it);
 * - storing an approved version 2 marks version 1 superseded, once (loading version 2 retries it);
 * - /sign by a clinician who is not the approver: 409 APPROVER_MISMATCH; after a takeover the receipt records it.
 *
 * Fictional data only.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyReceipt } from "../../src/modules/medreport/auth/sign-receipt";
import { canonicalize } from "../../src/modules/medreport/core/fingerprint";
import type { Report, ReportFlag } from "../../src/modules/medreport/core/types";
import { validateReport } from "../../src/modules/medreport/core/validation";
import { buildCase, ownerOf, type Built } from "../../src/modules/medreport/core/validation/__corpus__/harness/build";
import { actorOf } from "../../src/modules/medreport/core/validation/__corpus__/harness/fixtures";
import { createHttpHarness, getStoredReport, postSign, putStoredReport, type HttpHarness } from "../../src/modules/medreport/core/validation/__corpus__/harness/http";
import { CaseInputSchema } from "../../src/modules/medreport/core/validation/__corpus__/harness/types";
import { reviewReducer } from "../../src/modules/medreport/ui/components/review/use-review-state";
import { createAmendedVersion } from "../../src/modules/medreport/ui/components/review/review-model";

const SARAH = actorOf("sarah");
/** Pat as a clinic's Studio stamps a member: the account id (the corpus clinic signs Pat in as "usr_pat"). */
const PAT = { ...actorOf("pat"), memberId: "usr_pat" };
const TOM = actorOf("tom");

/** The corpus's discharge form: F-10 (prognosis) holds Sarah's edited opinion; validated, so its flags are on it. */
async function opinionReport(): Promise<Built & { validated: Report }> {
  const input = CaseInputSchema.parse({
    report: "form:cf-discharge",
    box: "F-10",
    boxes: { "F-10": [{ text: "In my own view he will make a full recovery within 6 weeks.", cites: ["N-001"], origin: "edited", originalText: "He reported a lifting injury at work on 12/03/2026.", by: "sarah" }] },
  });
  const built = await buildCase(input);
  const { flags } = validateReport(built.report, built.template, { computedFacts: built.computedFacts, form: built.form, voice: { owner: ownerOf(built) as never } });
  return { ...built, validated: { ...built.report, flags } };
}

async function seed(h: HttpHarness, report: Report, as: "sarah" | "pat" | "tom" = "sarah"): Promise<number> {
  const res = await putStoredReport(h, report, as, null);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return (res.body as { rev: number }).rev;
}

const opinionFlag = (r: Report): ReportFlag => {
  const f = r.flags.find((x) => x.sectionKey === "F-10" && x.code === "OPINION_LANGUAGE");
  assert.ok(f, "an opinion check on F-10");
  return f;
};

function withAck(r: Report, flagId: string, by: ReturnType<typeof actorOf>): Report {
  return { ...r, flags: r.flags.map((f) => (f.id === flagId ? { ...f, acknowledged: { reason: "My own clinical opinion.", at: r.updatedAt, by } } : f)) };
}

test("store: an acknowledgement stamped as the approver by staff is refused; the approver's own is stored", async () => {
  const { validated } = await opinionReport();
  const h = createHttpHarness();
  const rev = await seed(h, validated);
  const flag = opinionFlag(validated);
  const forged = await putStoredReport(h, withAck(validated, flag.id, SARAH), "pat", rev);
  assert.equal(forged.status, 403);
  assert.equal(forged.code, "DECISION_NOT_ALLOWED");
  // Pat's own stamp on an approver-only acknowledgement is refused too.
  assert.equal((await putStoredReport(h, withAck(validated, flag.id, PAT), "pat", rev)).status, 403);
  // Sarah – the approver – acknowledging it as herself is stored.
  const own = await putStoredReport(h, withAck(validated, flag.id, SARAH), "sarah", rev);
  assert.equal(own.status, 200, JSON.stringify(own.body));
});

test("store: staff cannot rewrite the approver's text under her stamp, nor write 'clinician' text, nor settle a clinician gap", async () => {
  const { validated } = await opinionReport();
  const h = createHttpHarness();
  const rev = await seed(h, validated);
  const f10 = validated.sections.find((s) => s.key === "F-10")!;
  const edit = (patch: (p: Report["sections"][number]["paragraphs"][number]) => Report["sections"][number]["paragraphs"][number]): Report => ({
    ...validated,
    sections: validated.sections.map((s) => (s.key === "F-10" ? { ...s, paragraphs: s.paragraphs.map(patch) } : s)),
  });
  // The text changed while it still says Sarah wrote it.
  assert.equal((await putStoredReport(h, edit((p) => ({ ...p, text: "He has made a full recovery." })), "pat", rev)).status, 403);
  // Staff's own change, stamped as Pat, of an edited paragraph: stored (it is checked as edited text).
  const patEdit = await putStoredReport(h, edit((p) => ({ ...p, text: "He has made a full recovery.", by: PAT })), "pat", rev);
  assert.equal(patEdit.status, 200, JSON.stringify(patEdit.body));
  const rev2 = (patEdit.body as { rev: number }).rev;
  const stored = (patEdit.body as { report: Report }).report;
  // …but never as the clinician's own words.
  const asClinician = { ...stored, sections: stored.sections.map((s) => (s.key === "F-10" ? { ...s, paragraphs: s.paragraphs.map((p) => ({ ...p, origin: "clinician" as const })) } : s)) };
  assert.equal((await putStoredReport(h, asClinician, "pat", rev2)).status, 403);
  // A clinician gap settled by staff: refused; by the approver: stored.
  const gap = { id: "gap-F-10-api", sectionKey: "F-10", issue: "No clinician recorded a prognosis.", suggestedQuestion: "?", relatedNoteIds: [], raisedBy: "ai" as const };
  const withGap = { ...stored, gaps: [...stored.gaps, gap] };
  const revGap = ((await putStoredReport(h, withGap, "sarah", rev2)).body as { rev: number }).rev;
  const settled = (by: ReturnType<typeof actorOf>) => ({ ...withGap, gaps: withGap.gaps.map((g) => (g.id === gap.id ? { ...g, resolution: { kind: "acknowledged" as const, text: "Left blank: not assessed.", at: stored.updatedAt, by } } : g)) });
  assert.equal((await putStoredReport(h, settled(PAT), "pat", revGap)).status, 403);
  assert.equal((await putStoredReport(h, settled(SARAH), "sarah", revGap)).status, 200);
  void f10;
});

test("store: the approver changes only by the member's own takeover", async () => {
  const { validated } = await opinionReport();
  const h = createHttpHarness();
  const rev = await seed(h, validated);
  const tomRef = { memberId: TOM.memberId, name: TOM.name, hcpc: TOM.hcpc! };
  const reassigned = { ...validated, approver: tomRef };
  assert.equal((await putStoredReport(h, reassigned, "pat", rev)).status, 403, "staff cannot reassign the approver");
  assert.equal((await putStoredReport(h, reassigned, "tom", rev)).status, 403, "not without a takeover record");
  // Tom takes over on the review screen (the reducer records it) and saves as himself.
  const taken = reviewReducer(validated, { type: "takeOverApprover", actor: TOM });
  assert.deepEqual(taken.approver, tomRef);
  assert.equal(taken.approverTakeovers?.length, 1);
  const res = await putStoredReport(h, taken, "tom", rev);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  // Tom cannot then hand it to someone else, nor rewrite the takeover history.
  const rev2 = (res.body as { rev: number }).rev;
  assert.equal((await putStoredReport(h, { ...taken, approverTakeovers: [] }, "tom", rev2)).status, 403);
});

test("/sign: a clinician who is not the approver is refused (409 APPROVER_MISMATCH) until they take over; the receipt records the takeover", async () => {
  const input = CaseInputSchema.parse({ report: "template:solicitor_rta", approver: "sarah" });
  const built = await buildCase(input);
  const h = createHttpHarness();
  const refused = await postSign(h, { report: built.report, template: built.template, form: built.form, signer: "tom", mode: "tenant" });
  assert.equal(refused.status, 409);
  assert.equal(refused.code, "APPROVER_MISMATCH");
  let taken = reviewReducer(built.report, { type: "takeOverApprover", actor: TOM });
  // Sarah's own words are no longer the approver's: each waits for Tom (here: he records them as his own words).
  const waiting = taken.sections.flatMap((s) => s.paragraphs.filter((p) => p.origin === "edited" && p.by?.memberId === SARAH.memberId).map((p) => ({ key: s.key, id: p.id })));
  assert.ok(waiting.length > 0, "the previous approver's text waits for the new approver");
  assert.equal((await postSign(h, { report: taken, template: built.template, form: built.form, signer: "tom", mode: "tenant" })).status, 409, "not before Tom decides on it");
  for (const w of waiting) taken = reviewReducer(taken, { type: "markOwnWords", key: w.key, paragraphId: w.id, actor: TOM });
  const signed = await postSign(h, { report: taken, template: built.template, form: built.form, signer: "tom", mode: "tenant" });
  assert.equal(signed.status, 200, JSON.stringify(signed.body));
  assert.equal(signed.receipt?.approverTakeover?.from.memberId, SARAH.memberId);
  assert.equal(signed.receipt?.approverTakeover?.to.memberId, TOM.memberId);
  const verified = await verifyReceipt(signed.receipt!, taken, { tenantId: taken.tenantId });
  assert.equal(verified.ok, true, "the takeover is MAC-covered and the receipt verifies");
  // The approver herself signs as before; staff never.
  assert.equal((await postSign(h, { report: built.report, template: built.template, form: built.form, signer: "sarah", mode: "tenant" })).status, 200);
  assert.equal((await postSign(h, { report: built.report, template: built.template, form: built.form, signer: "pat", mode: "tenant" })).status, 403);
});

test("store: an approved report's flags never change and its activity only grows; the server's own entry is kept", async () => {
  const input = CaseInputSchema.parse({ report: "template:solicitor_rta", approver: "sarah" });
  const built = await buildCase(input);
  const h = createHttpHarness();
  const s = await postSign(h, { report: built.report, template: built.template, form: built.form, signer: "sarah", mode: "tenant" });
  assert.ok(s.receipt);
  const approved: Report = {
    ...built.report,
    status: "signed",
    receipt: s.receipt,
    flags: (s.body as { flags: ReportFlag[] }).flags,
    activity: [...built.report.activity, { at: s.receipt.signedAt, actor: "Sarah Reid", action: "approved", detail: "Approved by Sarah Reid." }],
  };
  const rev = await seed(h, approved);
  assert.equal((await putStoredReport(h, { ...approved, flags: [] }, "sarah", rev)).status, 403, "flags are byte-equal");
  assert.equal((await putStoredReport(h, { ...approved, activity: approved.activity.slice(0, 1) }, "sarah", rev)).status, 403, "the log is not rewritten");
  const download = { at: "2026-10-21T10:00:00.000Z", actor: "Sarah Reid", action: "rendered", detail: "Downloaded the FINAL Word file." };
  const grown = await putStoredReport(h, { ...approved, activity: [...approved.activity, download] }, "sarah", rev);
  assert.equal(grown.status, 200, JSON.stringify(grown.body));
});

test("amendment: storing the approved version 2 marks version 1 superseded on the server, once; any later copy of v1 keeps it", async () => {
  const input = CaseInputSchema.parse({ report: "template:solicitor_rta", approver: "sarah" });
  const built = await buildCase(input);
  const h = createHttpHarness();
  const s1 = await postSign(h, { report: built.report, template: built.template, form: built.form, signer: "sarah", mode: "tenant" });
  const v1: Report = { ...built.report, status: "signed", receipt: s1.receipt!, flags: (s1.body as { flags: ReportFlag[] }).flags };
  const rev1 = await seed(h, v1);
  const v2draft = createAmendedVersion(v1, "Sarah Reid", `${v1.id}_v2`);
  // A fresh tab: version 2 is stored and approved without version 1 loaded anywhere.
  await seed(h, v2draft);
  const s2 = await postSign(h, { report: v2draft, template: built.template, form: built.form, signer: "sarah", mode: "tenant" });
  const v2: Report = { ...v2draft, status: "signed", receipt: s2.receipt!, flags: (s2.body as { flags: ReportFlag[] }).flags };
  const stored2 = await getStoredReport(h, v2.id, "sarah");
  const put2 = await putStoredReport(h, v2, "sarah", (stored2.body as { rev: number }).rev);
  assert.equal(put2.status, 200, JSON.stringify(put2.body));
  const read1 = (await getStoredReport(h, v1.id, "pat")).body as { report: Report; rev: number };
  const entries = read1.report.activity.filter((a) => a.action === "superseded");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].reportId, v2.id);
  assert.match(entries[0].detail, /^Superseded by version 2 \(approved \d\d\/\d\d\/\d{4}\)\.$/);
  assert.doesNotMatch(entries[0].detail, /rpt_/, "no raw id in the log");
  assert.equal((await verifyReceipt(read1.report.receipt!, read1.report, { tenantId: read1.report.tenantId })).ok, true, "v1's receipt still verifies");
  // Loading version 2 again does not add a second entry.
  await getStoredReport(h, v2.id, "sarah");
  assert.equal(((await getStoredReport(h, v1.id, "sarah")).body as { report: Report }).report.activity.filter((a) => a.action === "superseded").length, 1);
  // A tab still holding the older v1 (no superseded entry) logs a download: stored, and the server's entry is kept.
  const download = { at: "2026-10-22T10:00:00.000Z", actor: "Sarah Reid", action: "rendered", detail: "Downloaded the FINAL Word file." };
  const stale = await putStoredReport(h, { ...v1, activity: [...v1.activity, download] }, "sarah", read1.rev);
  assert.equal(stale.status, 200, JSON.stringify(stale.body));
  const merged = (stale.body as { report: Report }).report.activity;
  assert.equal(merged.filter((a) => a.action === "superseded").length, 1);
  assert.ok(merged.some((a) => a.detail === download.detail));
  void rev1;
});

test("store: what a create holds is stored as sent (a new report, an imported case); the checks start with the first update", async () => {
  const { validated } = await opinionReport();
  const h = createHttpHarness();
  const flag = opinionFlag(validated);
  const res = await putStoredReport(h, withAck(validated, flag.id, SARAH), "pat", null);
  assert.equal(res.status, 201);
  const got = (await getStoredReport(h, validated.id, "pat")).body as { report: Report };
  assert.equal(canonicalize(got.report.flags), canonicalize(withAck(validated, flag.id, SARAH).flags));
});
