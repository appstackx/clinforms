/**
 * bh2 WC – the server records who did what (designs 1, 2 and 8), through the real handlers (PUT/GET /store/reports,
 * POST /sign) on the in-memory tenant store, with the safety corpus's fictional clinic: Sarah Reid (owner, approves),
 * Tom Ellis (clinician, may sign), Pat Morgan (staff).
 *
 * - a PUT is compared with the stored revision (a create: with the approved version it amends, else with nothing): a
 *   decision stamped as someone else – by member id, and by registration number where the stamp has one – or an
 *   approver-only decision by someone else is refused (403 DECISION_NOT_ALLOWED); the approver's own are stored;
 * - where text comes from (origin, its drafted wording) is checked, and what the approver confirmed in a clinician box
 *   is not taken away without the box reading as a proposal (check-WC problems 2–5);
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
import type { Report, ReportFlag } from "../../src/modules/medreport/core/types";
import { canSign, validateReport } from "../../src/modules/medreport/core/validation";
import { boxContentSha } from "../../src/modules/medreport/core/provenance";
import { buildCase, ownerOf, type Built } from "../../src/modules/medreport/core/validation/__corpus__/harness/build";
import { CORPUS_TENANT, actorOf } from "../../src/modules/medreport/core/validation/__corpus__/harness/fixtures";
import { createHttpHarness, getStoredReport, postSign, putStoredReport, type HttpHarness } from "../../src/modules/medreport/core/validation/__corpus__/harness/http";
import { CaseInputSchema } from "../../src/modules/medreport/core/validation/__corpus__/harness/types";
import { reviewReducer } from "../../src/modules/medreport/ui/components/review/use-review-state";
import { createAmendedVersion } from "../../src/modules/medreport/ui/components/review/review-model";
import { classifyStatus, createServerApi } from "../../src/modules/medreport/ui/store/server-api";

const SARAH = actorOf("sarah");
/** The corpus clinic signs each fictional member in with the account id the Studio stamps (harness/http.ts). */
const PAT = actorOf("pat");
const TOM = actorOf("tom");
const DRAFTED = "He is expected to make a full recovery within 6 weeks of the accident.";

/**
 * bh2 fix round 2 (WC, R2-SAF-2): the corpus clinic as the Studio keeps it – holding the discharge form's map, the map its
 * form reports are started from (the store refuses a create it cannot check against the clinic's map).
 */
let dischargeForm: NonNullable<Built["form"]> | null = null;
async function clinicHarness(): Promise<HttpHarness> {
  const h = createHttpHarness();
  dischargeForm ??= (await buildCase(CaseInputSchema.parse({ report: "form:cf-discharge" }))).form;
  if (dischargeForm) await h.store.createForm(CORPUS_TENANT, { id: dischargeForm.id, status: dischargeForm.status, title: dischargeForm.title, referrer: dischargeForm.referrer.name, kind: dischargeForm.kind, fileSha256: dischargeForm.file.sha256, sampleId: null, payload: dischargeForm });
  return h;
}

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
  const h = await clinicHarness();
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
  const h = await clinicHarness();
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
  const h = await clinicHarness();
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
  // A takeover that keeps Sarah's decisions (here her acknowledgement and her paragraph's acknowledgement reason): refused.
  const h2 = await clinicHarness();
  const flag = opinionFlag(validated);
  const acked = reviewReducer(validated, { type: "acknowledgeFlag", flagId: flag.id, reason: "My own clinical opinion.", actor: SARAH });
  const revA = await seed(h2, acked);
  const voidless: Report = { ...acked, approver: tomRef, approverTakeovers: taken.approverTakeovers };
  assert.equal((await putStoredReport(h2, voidless, "tom", revA)).status, 403, "a takeover voids the previous approver's decisions");
  assert.equal((await putStoredReport(h2, reviewReducer(acked, { type: "takeOverApprover", actor: TOM }), "tom", revA)).status, 200);
  // Tom cannot then hand it to someone else, nor rewrite the takeover history.
  const rev2 = (res.body as { rev: number }).rev;
  assert.equal((await putStoredReport(h, { ...taken, approverTakeovers: [] }, "tom", rev2)).status, 403);
});

test("/sign: a clinician who is not the approver is refused (409 APPROVER_MISMATCH) until they take over; the receipt records the takeover", async () => {
  const input = CaseInputSchema.parse({ report: "template:solicitor_rta", approver: "sarah" });
  const built = await buildCase(input);
  const h = await clinicHarness();
  const refused = await postSign(h, { report: built.report, template: built.template, form: built.form, signer: "tom", mode: "tenant" });
  assert.equal(refused.status, 409);
  assert.equal(refused.code, "APPROVER_MISMATCH");
  let taken = reviewReducer(built.report, { type: "takeOverApprover", actor: TOM });
  // Sarah's own words are no longer the approver's: each waits for Tom (here: he adopts them – bh2 fix round 1, R1T-WC-08:
  // "These are my own words" is for his own rewrites only, never a colleague's text).
  const waiting = taken.sections.flatMap((s) => s.paragraphs.filter((p) => p.origin === "edited" && p.by?.memberId === SARAH.memberId).map((p) => ({ key: s.key, id: p.id })));
  assert.ok(waiting.length > 0, "the previous approver's text waits for the new approver");
  assert.equal((await postSign(h, { report: taken, template: built.template, form: built.form, signer: "tom", mode: "tenant" })).status, 409, "not before Tom decides on it");
  for (const w of waiting) taken = reviewReducer(taken, { type: "adopt", key: w.key, actor: TOM });
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
  const h = await clinicHarness();
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
  const h = await clinicHarness();
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

/* ------------------------------------------------------------------------------------------------
 * check-WC (independent review of 549a06f): the crafted requests it sent, each now refused or shown as a proposal
 * ----------------------------------------------------------------------------------------------*/

type Section = Report["sections"][number];
const mapBox = (r: Report, key: string, fn: (s: Section) => Section): Report => ({ ...r, sections: r.sections.map((s) => (s.key === key ? fn(s) : s)) });

async function formCase(boxes: Record<string, unknown[]>, extra: Record<string, unknown> = {}): Promise<Built & { v: Report }> {
  const b = await buildCase(CaseInputSchema.parse({ report: "form:cf-discharge", boxes, ...extra }));
  return { ...b, v: revalidate(b, b.report) };
}
function revalidate(b: Built, r: Report): Report {
  return { ...r, flags: validateReport(r, b.template, { computedFacts: b.computedFacts, form: b.form, voice: { owner: ownerOf(b) as never } }).flags };
}
const proposalOn = (r: Report, key: string) => r.flags.some((f) => f.sectionKey === key && f.code === "APPROVER_DECISION" && !f.acknowledged);

test("check-WC 2 (S1, S1b, S1c): a stamp naming the approver's member id with the sender's own registration number is refused", async () => {
  const b = await formCase({ "F-10": [] }, { box: "F-11" });
  const h = await clinicHarness();
  const rev = await seed(h, b.v);
  const forgedBy = { memberId: b.v.approver!.memberId, name: "Sarah Reid", role: "owner" as const, canSign: true, hcpc: TOM.hcpc };
  const prognosis = mapBox(b.v, "F-10", (s) => ({ ...s, paragraphs: [{ id: "F-10-c1", text: "Settling well with his home exercise programme.", sourceIds: ["N-001"], origin: "edited" as const, by: forgedBy }] }));
  const s1 = await putStoredReport(h, prognosis, "tom", rev);
  assert.equal(s1.status, 403, JSON.stringify(s1.body));
  assert.equal(s1.code, "DECISION_NOT_ALLOWED");
  // The same answer stamped as Tom himself is stored – and is a proposal Sarah adopts.
  const own = mapBox(b.v, "F-10", (s) => ({ ...s, paragraphs: [{ id: "F-10-c1", text: "Settling well with his home exercise programme.", sourceIds: ["N-001"], origin: "edited" as const, by: TOM }] }));
  assert.equal((await putStoredReport(h, own, "tom", rev)).status, 200);
  assert.ok(proposalOn(revalidate(b, own), "F-10"));
  // S1c: Sarah's tick changed by Tom under the same forged stamp.
  const h2 = await clinicHarness();
  const ticked = revalidate(b, reviewReducer(b.v, { type: "setAnswer", key: "F-11", value: "0-3 months", actor: SARAH as never }));
  const rev2 = await seed(h2, ticked);
  const s1c = mapBox(ticked, "F-11", (s) => ({ ...s, answer: { ...s.answer!, value: "6-12 months" }, answerBy: forgedBy }));
  assert.equal((await putStoredReport(h2, s1c, "tom", rev2)).status, 403);
});

test("check-WC 3 (S2): staff replacing the approver's tick with no stamp is refused; stamped as theirs it is a proposal", async () => {
  const b = await formCase({}, { box: "F-11", gaps: [{ box: "F-11", issue: "No clinician recorded an expected recovery time." }] });
  const h = await clinicHarness();
  const sarahs = revalidate(b, reviewReducer(b.v, { type: "setAnswer", key: "F-11", value: "0-3 months", actor: SARAH as never }));
  assert.ok(sarahs.sections.find((s) => s.key === "F-11")?.adoptedBy, "her own answer confirms the box");
  const rev = await seed(h, sarahs);
  const changed = (by: typeof PAT | null) =>
    mapBox(sarahs, "F-11", (s) => {
      const n = { ...s, answer: { ...s.answer!, value: "6-12 months" } };
      if (by) n.answerBy = by as never;
      else delete (n as { answerBy?: unknown }).answerBy;
      return n;
    });
  assert.equal((await putStoredReport(h, changed(null), "pat", rev)).status, 403, "no stamp: refused");
  const res = await putStoredReport(h, changed(PAT), "pat", rev);
  assert.equal(res.status, 200, "Pat's own change is stored – as a proposal");
  const after = revalidate(b, (res.body as { report: Report }).report);
  assert.ok(proposalOn(after, "F-11"));
  assert.equal(canSign(after.flags, after.gaps).ok, false);
  // Her confirmation removed as well: refused.
  const rev2 = (res.body as { rev: number }).rev;
  const noAdoption = mapBox((res.body as { report: Report }).report, "F-11", (s) => {
    const n = { ...s };
    delete n.adoptedBy;
    return n;
  });
  assert.equal((await putStoredReport(h, noAdoption, "pat", rev2)).status, 403);
  // Clearing her tick through the review: stored, and it waits for her (her confirmation is void).
  const cleared = revalidate(b, reviewReducer(sarahs, { type: "setAnswer", key: "F-11", value: null, actor: PAT as never }));
  const h2 = await clinicHarness();
  const rev3 = await seed(h2, sarahs);
  assert.equal((await putStoredReport(h2, cleared, "pat", rev3)).status, 200);
  assert.ok(proposalOn(cleared, "F-11"));
});

test("check-WC 3 (S6): a create holding the approver's own-words record, adoption or acknowledgement made by someone else is refused", async () => {
  const b = await formCase({ "F-10": [] });
  const h = await clinicHarness();
  const sarahStamp = { memberId: b.v.approver!.memberId, name: "Sarah Reid", role: "owner" as const, canSign: true, hcpc: SARAH.hcpc };
  let forged = mapBox(b.v, "F-10", (s) => ({ ...s, paragraphs: [{ id: "F-10-c1", text: "He will make a full recovery within 6 weeks.", sourceIds: [], origin: "clinician" as const, by: PAT as never, ownWords: { by: sarahStamp, at: b.v.updatedAt } }] }));
  forged = mapBox(forged, "F-10", (s) => ({ ...s, adoptedBy: { by: sarahStamp, at: b.v.updatedAt, contentSha: boxContentSha(s) } }));
  const res = await putStoredReport(h, { ...forged, id: "rpt_forged" }, "pat", null);
  assert.equal(res.status, 403, JSON.stringify(res.body));
  // An acknowledgement stamped as Sarah on a create by staff: refused; by Sarah herself: stored.
  const { validated } = await opinionReport();
  const flag = opinionFlag(validated);
  assert.equal((await putStoredReport(h, withAck(validated, flag.id, SARAH), "pat", null)).status, 403);
  assert.equal((await putStoredReport(h, withAck(validated, flag.id, SARAH), "sarah", null)).status, 201);
  // A new report as the report factory makes it (nobody's stamps in it yet), naming Sarah approver: stored by staff;
  // the same report naming staff as approver (with Sarah's number): refused.
  const fresh: Report = { ...b.v, sections: b.v.sections.map((sec) => {
    const n = { ...sec, paragraphs: sec.paragraphs.filter((p) => p.origin === "ai" || p.origin === "from_records") };
    delete n.answerBy;
    // bh2 fix round 1 (R1T-WC-03): the factory (and drafting) never answers an opinion box or the physiotherapist's choice.
    const unfilledRecord = n.kind === "from_records" && !n.paragraphs.some((p) => p.origin === "from_records");
    if ((n.kind === "clinician_opinion" || unfilledRecord) && n.answer && n.answer.kind !== "text") n.answer = { ...n.answer, value: null };
    return n;
  }) };
  assert.equal((await putStoredReport(h, { ...fresh, id: "rpt_new" }, "pat", null)).status, 201);
  const claimed = { ...fresh, id: "rpt_claimed", approver: { memberId: PAT.memberId, name: "Sarah Reid", hcpc: SARAH.hcpc! } };
  assert.equal((await putStoredReport(h, claimed, "pat", null)).status, 403);
  // A report holding Sarah's own entries, created by Sarah: stored.
  assert.equal((await putStoredReport(h, { ...b.v, id: "rpt_hers" }, "sarah", null)).status, 201);
});

test("check-WC 3: an amended version is checked against the version it amends – its copied decisions stand, new ones are the member's", async () => {
  const built = await opinionReport();
  const { validated } = built;
  const h = await clinicHarness();
  const withSarahAck: Report = { ...validated, flags: validated.flags.map((f) => (f.code === "OPINION_LANGUAGE" ? { ...f, acknowledged: { reason: "My own clinical opinion.", at: validated.updatedAt, by: SARAH } } : f)) };
  // bh2-rc1 (WA1 x WC): a clinic's /sign fills the referrer's form file as a dry run and refuses without one (WA1
  // design 6, fail closed) – the approval sends it, as the corpus harness's other /sign calls do.
  const s = await postSign(h, { report: withSarahAck, template: built.template, form: built.form, signer: "sarah", mode: "tenant", fileBytes: built.fileBytes });
  assert.ok(s.receipt, JSON.stringify(s.body));
  const v1: Report = { ...withSarahAck, status: "signed", receipt: s.receipt, flags: (s.body as { flags: ReportFlag[] }).flags };
  await seed(h, v1);
  // Pat starts version 2: it holds Sarah's decisions, copied from version 1 – stored.
  const v2 = createAmendedVersion(v1, "Pat Morgan", `${v1.id}_v2`);
  assert.equal((await putStoredReport(h, v2, "pat", null)).status, 201);
  // A version 2 that adds a decision as Sarah: refused.
  const v2b = createAmendedVersion(v1, "Pat Morgan", `${v1.id}_v2b`);
  const forged = mapBox(v2b, "F-10", (sec) => ({ ...sec, paragraphs: sec.paragraphs.map((p) => ({ ...p, ownWords: { by: SARAH, at: v2b.updatedAt } })) }));
  assert.equal((await putStoredReport(h, forged, "pat", null)).status, 403);
});

test("check-WC 4 (S3, S4, S5): origin and drafted wording are the server's to check, not the client's to assert", async () => {
  const b = await formCase({ "F-10": [{ text: DRAFTED, cites: ["N-001"] }] });
  const h = await clinicHarness();
  const rev = await seed(h, b.v);
  // S3: drafted opinion relabelled "from the records".
  const s3 = mapBox(b.v, "F-10", (s) => ({ ...s, paragraphs: s.paragraphs.map((p) => ({ ...p, origin: "from_records" as const })) }));
  assert.equal((await putStoredReport(h, s3, "pat", rev)).status, 403);
  // S4: a new "from the records" paragraph in the opinion box.
  const s4 = mapBox(b.v, "F-10", (s) => ({ ...s, paragraphs: [...s.paragraphs, { id: "F-10-r1", text: "He will make a full recovery within 6 weeks.", sourceIds: [], origin: "from_records" as const }] }));
  assert.equal((await putStoredReport(h, s4, "pat", rev)).status, 403);
  // Minor 8: drafted text relabelled as a person's edit without a change to its words (so the approver could acknowledge it).
  const asEdited = mapBox(b.v, "F-10", (s) => ({ ...s, paragraphs: s.paragraphs.map((p) => ({ ...p, origin: "edited" as const, originalText: p.text, by: PAT as never })) }));
  assert.equal((await putStoredReport(h, asEdited, "pat", rev)).status, 403);
  // Staff text labelled "staff" outside a record box, and a person's text relabelled as drafted.
  const staffText = mapBox(b.v, "F-10", (s) => ({ ...s, paragraphs: [...s.paragraphs, { id: "F-10-c1", text: "Settling well.", sourceIds: [], origin: "staff" as const, by: PAT as never }] }));
  assert.equal((await putStoredReport(h, staffText, "pat", rev)).status, 403);
  // S5: the drafted wording behind Sarah's edited paragraph rewritten, so her kept drafted sentence would no longer count.
  const h2 = await clinicHarness();
  const b2 = await formCase({ "F-10": [{ text: `In my opinion his back should settle. ${DRAFTED}`, cites: ["N-001"], origin: "edited", originalText: DRAFTED, by: "sarah" }] });
  const rev2 = await seed(h2, b2.v);
  const s5 = mapBox(b2.v, "F-10", (s) => ({ ...s, paragraphs: s.paragraphs.map((p) => ({ ...p, originalText: "He reported a lifting injury." })) }));
  assert.equal((await putStoredReport(h2, s5, "pat", rev2)).status, 403);
  assert.equal((await putStoredReport(h2, s5, "sarah", rev2)).status, 403, "nobody rewrites the drafted wording");
  const relabel = mapBox(b2.v, "F-10", (s) => ({ ...s, paragraphs: s.paragraphs.map((p) => ({ ...p, origin: "ai" as const })) }));
  assert.equal((await putStoredReport(h2, relabel, "pat", rev2)).status, 403);
  // What the review itself writes is stored: Sarah reverts her paragraph to its drafted wording, and edits drafted text.
  const reverted = mapBox(b2.v, "F-10", (s) => ({ ...s, paragraphs: s.paragraphs.map((p) => ({ ...p, text: DRAFTED, origin: "ai" as const })) }));
  assert.equal((await putStoredReport(h2, reverted, "sarah", rev2)).status, 200);
  const pid = b.v.sections.find((s) => s.key === "F-10")!.paragraphs[0].id;
  const edited = reviewReducer(b.v, { type: "editParagraph", key: "F-10", paragraphId: pid, text: `${DRAFTED} He does his exercises.`, actor: PAT as never });
  assert.equal((await putStoredReport(h, edited, "pat", rev)).status, 200);
});

test("check-WC 5 (S8): staff removing the approver's words from a clinician box – shown as a proposal, or refused", async () => {
  const b = await formCase({ "F-10": [] });
  const h = await clinicHarness();
  const written = revalidate(
    b,
    reviewReducer(reviewReducer(b.v, { type: "addParagraph", key: "F-10", text: "Settling with exercise.", actor: SARAH as never }), { type: "addParagraph", key: "F-10", text: "He is not fit for heavy lifting.", actor: SARAH as never }),
  );
  const rev = await seed(h, written);
  const removed = mapBox(written, "F-10", (s) => ({ ...s, paragraphs: s.paragraphs.slice(0, 1) }));
  const res = await putStoredReport(h, removed, "pat", rev);
  assert.equal(res.status, 200, "stored: her confirmation is now stale");
  assert.ok(proposalOn(revalidate(b, (res.body as { report: Report }).report), "F-10"));
  // The same removal from a box with no recorded confirmation (her words stamped, no adoption): refused.
  const h2 = await clinicHarness();
  const legacy = mapBox(written, "F-10", (s) => {
    const n = { ...s };
    delete n.adoptedBy;
    return n;
  });
  const rev2 = await seed(h2, legacy);
  assert.equal((await putStoredReport(h2, mapBox(legacy, "F-10", (s) => ({ ...s, paragraphs: s.paragraphs.slice(0, 1) })), "pat", rev2)).status, 403);
  assert.equal((await putStoredReport(h2, mapBox(legacy, "F-10", (s) => ({ ...s, paragraphs: s.paragraphs.slice(0, 1) })), "sarah", rev2)).status, 200, "hers to remove");
});

test("check-WC minor 7 (S9): a client never writes a 'superseded' entry", async () => {
  const input = CaseInputSchema.parse({ report: "template:solicitor_rta", approver: "sarah" });
  const built = await buildCase(input);
  const h = await clinicHarness();
  const s = await postSign(h, { report: built.report, template: built.template, form: built.form, signer: "sarah", mode: "tenant" });
  const approved: Report = { ...built.report, status: "signed", receipt: s.receipt!, flags: (s.body as { flags: ReportFlag[] }).flags };
  const rev = await seed(h, approved);
  const fake = { at: approved.updatedAt, actor: "ClinForms", action: "superseded", detail: "Superseded by version 2 (approved 27/10/2026).", reportId: "rpt_does_not_exist" };
  assert.equal((await putStoredReport(h, { ...approved, activity: [...approved.activity, fake] }, "pat", rev)).status, 403);
  const draft: Report = { ...built.report, id: "rpt_fake_create", activity: [...built.report.activity, fake] };
  assert.equal((await putStoredReport(h, draft, "sarah", null)).status, 403);
});

test("a case imported from the public demo keeps none of the demo's decisions; its approver must be taken over", async () => {
  const { validated } = await opinionReport();
  const demoUser = { memberId: "demo", name: "Dr Demo", role: "clinician" as const, canSign: true, hcpc: "PH-DEMO-09" };
  const flag = opinionFlag(validated);
  const demo: Report = {
    ...withAck(validated, flag.id, demoUser as never),
    tenantId: "demo",
    approver: { memberId: "demo", name: "Dr Demo", hcpc: "PH-DEMO-09" },
    // Everything in a demo case is the demo's one fictional user's.
    sections: validated.sections.map((s) =>
      s.key === "F-10"
        ? { ...s, paragraphs: s.paragraphs.map((p) => ({ ...p, origin: "clinician" as const, by: demoUser as never, ownWords: { by: demoUser as never, at: validated.updatedAt } })) }
        : { ...s, paragraphs: s.paragraphs.map((p) => (p.by ? { ...p, by: demoUser as never } : p)), ...(s.answerBy ? { answerBy: demoUser as never } : {}) },
    ),
    gaps: validated.gaps.map((g) => (g.resolution?.by ? { ...g, resolution: { ...g.resolution, by: demoUser as never } } : g)),
  };
  const h = await clinicHarness();
  const res = await putStoredReport(h, demo, "pat", null);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const stored = (res.body as { report: Report }).report;
  assert.equal(stored.tenantId, validated.tenantId);
  assert.equal(stored.flags.find((f) => f.id === flag.id)?.acknowledged, undefined);
  const f10 = stored.sections.find((s) => s.key === "F-10")!;
  assert.ok(f10.paragraphs.every((p) => p.origin === "edited" && !p.ownWords && p.by?.memberId === "demo"), JSON.stringify(f10.paragraphs));
  // A clinic member who may approve takes over: what the demo's user wrote then waits for them (a proposal).
  const taken = revalidate(await opinionReport(), reviewReducer(stored, { type: "takeOverApprover", actor: SARAH as never }));
  assert.ok(proposalOn(taken, "F-10"));
  // Nobody in the clinic is the demo's approver: /sign refuses until a member who may approve takes over.
  const b = await opinionReport();
  assert.equal((await postSign(h, { report: stored, template: b.template, form: b.form, signer: "sarah", mode: "tenant" })).status, 409);
});

/* ------------------------------------------------------------------------------------------------
 * harden-WC (second independent review, check2-WC of 93620cf): what the report is, provenance by omission, the
 * acknowledged paragraph, stamps' names, creates' bases and takeovers, verbatim drafted text, injected drafted text,
 * and the Studio's handling of a refusal. Each crafted request is refused; what the review itself writes is stored.
 * ----------------------------------------------------------------------------------------------*/

const PAT_STAMP = { memberId: PAT.memberId, name: PAT.name, role: PAT.role, canSign: false };
const CITED = "Settling well with his home exercise programme.";

/** The form map the report was started from, in the clinic's store (as the Studio keeps it). */
async function storeForm(h: HttpHarness, form: NonNullable<Built["form"]>): Promise<void> {
  await h.store.createForm(CORPUS_TENANT, { id: form.id, status: form.status, title: form.title, referrer: form.referrer.name, kind: form.kind, fileSha256: form.file.sha256, sampleId: null, payload: form });
}

/** A report as the factory hands it to a member: nobody's stamps, no person's text. */
function factoryCopy(r: Report): Report {
  return {
    ...r,
    sections: r.sections.map((s) => {
      const n = { ...s, paragraphs: s.paragraphs.filter((p) => p.origin === "ai" || p.origin === "from_records") };
      delete n.answerBy;
      delete n.adoptedBy;
      // bh2 fix round 1 (R1T-WC-03): the factory (and drafting) never answers an opinion box or the physiotherapist's choice.
      // (A records box the factory did not fill – a staff entry, the physiotherapist's choice – is empty too.)
      const unfilledRecord = n.kind === "from_records" && !n.paragraphs.some((p) => p.origin === "from_records");
      if ((n.kind === "clinician_opinion" || unfilledRecord) && n.answer && n.answer.kind !== "text") n.answer = { ...n.answer, value: null };
      return n;
    }),
    flags: [],
  };
}

test("harden-WC major A: on an update every box keeps its kind, title, field, frozen condition and place; the report its model and form", async () => {
  const b = await formCase({ "F-10": [] });
  const h = await clinicHarness();
  const rev = await seed(h, b.v);
  const staffProg = { id: "F-10-c1", text: "He will make a full recovery within 6 weeks.", sourceIds: [], origin: "staff" as const, by: PAT_STAMP as never };
  // N1a: the Prognosis box relabelled as a records box, holding staff's prognosis.
  const n1a = mapBox(b.v, "F-10", (s) => ({ ...s, kind: "from_records" as const, title: "Notes", paragraphs: [staffProg] }));
  assert.equal((await putStoredReport(h, n1a, "pat", rev)).status, 403);
  // N1b: relabelled as a narrative box with a cited, edited prognosis.
  const n1b = mapBox(b.v, "F-10", (s) => ({ ...s, kind: "ai_narrative" as const, title: "Notes", paragraphs: [{ id: "F-10-c1", text: CITED, sourceIds: ["N-001"], origin: "edited" as const, by: PAT_STAMP as never }] }));
  assert.equal((await putStoredReport(h, n1b, "pat", rev)).status, 403);
  // Nobody relabels a box – not the approver either – nor moves it to another field, removes or adds one.
  assert.equal((await putStoredReport(h, mapBox(b.v, "F-10", (s) => ({ ...s, title: "Notes" })), "sarah", rev)).status, 403);
  assert.equal((await putStoredReport(h, mapBox(b.v, "F-10", (s) => ({ ...s, fieldId: "F-31" })), "sarah", rev)).status, 403);
  assert.equal((await putStoredReport(h, { ...b.v, sections: b.v.sections.filter((s) => s.key !== "F-10") }, "pat", rev)).status, 403);
  assert.equal((await putStoredReport(h, { ...b.v, sections: [...b.v.sections, { key: "F-99", title: "Notes", kind: "ai_narrative" as const, status: "drafted" as const, paragraphs: [] }] }, "pat", rev)).status, 403);
  // check2-WA1 N1 (b): a frozen condition, the report model and the form it completes never change after a create.
  const conditioned = mapBox(b.v, "F-10", (s) => ({ ...s, condition: { controllers: ["F-05"], wants: "yes", parser: "conditions-1" } }));
  assert.equal((await putStoredReport(h, conditioned, "pat", rev)).status, 403);
  const legacy = { ...b.v };
  delete legacy.reportModel;
  assert.equal((await putStoredReport(h, legacy, "sarah", rev)).status, 403);
  assert.equal((await putStoredReport(h, { ...b.v, form: { ...b.v.form!, mapSha256: "0".repeat(64) } }, "sarah", rev)).status, 403);
  // N1d': Sarah's lifting restriction relabelled and reversed under Pat's stamp, her adoption kept – refused.
  const h2 = await clinicHarness();
  const sarahs = revalidate(b, reviewReducer(b.v, { type: "setAnswer", key: "F-15", value: true, actor: SARAH as never }));
  const rev2 = await seed(h2, sarahs);
  const n1d = mapBox(sarahs, "F-15", (s) => ({ ...s, kind: "from_records" as const, title: "Lifting", answer: { ...s.answer!, value: false }, answerBy: PAT_STAMP as never }));
  assert.equal((await putStoredReport(h2, n1d, "pat", rev2)).status, 403);
  // The same change as the review writes it (no relabel): stored, and a proposal Sarah must adopt.
  const viaReview = revalidate(b, reviewReducer(sarahs, { type: "setAnswer", key: "F-15", value: false, actor: PAT as never }));
  assert.equal((await putStoredReport(h2, viaReview, "pat", rev2)).status, 200);
  assert.ok(proposalOn(viaReview, "F-15"));
});

test("harden-WC major A on a create: checked against the clinic's stored map; without it, /validate and /sign read the box from the attested map", async () => {
  const b = await formCase({ "F-10": [] });
  const prognosis = (r: Report) => mapBox(r, "F-10", (s) => ({ ...s, paragraphs: [{ id: "F-10-c1", text: CITED, sourceIds: ["N-001"], origin: "edited" as const, by: PAT_STAMP as never }] }));
  const relabel = (r: Report) => mapBox(prognosis(r), "F-10", (s) => ({ ...s, kind: "ai_narrative" as const, title: "Notes" }));
  const fresh = factoryCopy(b.v);
  const h = await clinicHarness();
  await storeForm(h, b.form!);
  assert.equal((await putStoredReport(h, { ...relabel(fresh), id: "rpt_relabel" }, "pat", null)).status, 403, "N1c': a relabelled box against the stored map");
  const plain = await putStoredReport(h, { ...prognosis(fresh), id: "rpt_plain" }, "pat", null);
  assert.equal(plain.status, 201, JSON.stringify(plain.body));
  assert.equal((await putStoredReport(h, { ...fresh, id: "rpt_missing", sections: fresh.sections.filter((s) => s.key !== "F-10") }, "pat", null)).status, 403, "a box of the map left out");
  // The map not in this clinic's store: R2-SAF-2 (WC fix round 2) – a create the store cannot check against the clinic's
  // map is refused (it used to be stored as sent); and the box is still the map's opinion box everywhere it is checked.
  const h2 = createHttpHarness();
  const res = await putStoredReport(h2, { ...relabel(fresh), id: "rpt_relabel" }, "pat", null);
  assert.equal(res.status, 403, "R2-SAF-2: form-map-unknown");
  const v = revalidate(b, { ...relabel(fresh), id: "rpt_relabel" });
  assert.ok(proposalOn(v, "F-10"), "APPROVER_DECISION on the relabelled box");
  assert.equal((await postSign(h2, { report: v, template: b.template, form: b.form, signer: "sarah", mode: "tenant" })).status, 409);
});

test("harden-WC major B: an answer set with no stamp, and a question removed or rewritten, are refused; a redraft of a waiting box is stored", async () => {
  // N3: the empty clinician box "Expected date of a full return" (F-09) filled with no stamp.
  const b = await formCase({});
  const h = await clinicHarness();
  const rev = await seed(h, b.v);
  const date = (by?: unknown) => mapBox(b.v, "F-09", (s) => ({ ...s, answer: { kind: "date" as const, value: "2026-12-01" }, status: "complete" as const, ...(by ? { answerBy: by as never } : {}) }));
  assert.equal((await putStoredReport(h, date(), "pat", rev)).status, 403, "N3");
  const stamped = await putStoredReport(h, date(PAT_STAMP), "pat", rev);
  assert.equal(stamped.status, 200);
  assert.ok(proposalOn(revalidate(b, date(PAT_STAMP)), "F-09"), "staff's own date is a proposal");
  // …and wherever such an answer is stored anyway (e.g. a create), it is a proposal, not nobody's.
  const bare = revalidate(b, date());
  assert.ok(proposalOn(bare, "F-09"));
  assert.equal(canSign(bare.flags, bare.gaps).ok, false);
  // N2 / N3b: the open clinician question on F-11 deleted (with an unstamped answer, or without one).
  const g = await formCase({}, { box: "F-11", gaps: [{ box: "F-11", issue: "No clinician recorded an expected recovery time." }] });
  const h2 = await clinicHarness();
  const rev2 = await seed(h2, g.v);
  const noGap = (r: Report) => ({ ...r, gaps: r.gaps.filter((x) => x.sectionKey !== "F-11"), flags: r.flags.filter((f) => f.sectionKey !== "F-11") });
  assert.equal((await putStoredReport(h2, noGap(g.v), "pat", rev2)).status, 403, "N2");
  assert.equal((await putStoredReport(h2, noGap(g.v), "sarah", rev2)).status, 403, "the approver settles it – she does not delete it");
  assert.equal((await putStoredReport(h2, noGap(mapBox(g.v, "F-11", (s) => ({ ...s, answer: { ...s.answer!, value: "6-12 months" } }))), "pat", rev2)).status, 403, "N3b");
  const rekinded = { ...g.v, gaps: g.v.gaps.map((x) => (x.sectionKey === "F-11" ? { ...x, kind: "staff_entry" as const } : x)) };
  assert.equal((await putStoredReport(h2, rekinded, "pat", rev2)).status, 403, "a question relabelled as staff's");
  // N2b: the open question of the optional opinion box F-08 deleted – it would print blank with nobody's decision.
  const o = await formCase({}, { box: "F-08", answers: { "F-07": false }, gaps: [{ box: "F-08", issue: "No clinician recorded an expected date back at work." }] });
  const h3 = await clinicHarness();
  const rev3 = await seed(h3, o.v);
  assert.equal((await putStoredReport(h3, { ...o.v, gaps: o.v.gaps.filter((x) => x.sectionKey !== "F-08") }, "pat", rev3)).status, 403, "N2b");
  // Drafting a box that waits for it (as "Draft the remaining questions" does) replaces its answer, text and questions: stored.
  const p = await clinicHarness();
  const fresh = await formCase({});
  const pendingKey = fresh.v.sections.find((s) => s.status === "pending" && s.answer && s.answer.kind === "date")?.key ?? fresh.v.sections.find((s) => s.status === "pending")!.key;
  const revP = await seed(p, fresh.v);
  const target = fresh.v.sections.find((s) => s.key === pendingKey)!;
  const drafted = reviewReducer(fresh.v, {
    type: "applyDraft",
    result: {
      // bh2 fix round 1 (R1T-WC-03): drafting never answers an opinion box – a redraft of one carries no answer.
      sections: [{ key: pendingKey, title: target.title, kind: target.kind, status: "drafted", fieldId: pendingKey, paragraphs: [{ id: `${pendingKey}-p1`, text: CITED, sourceIds: ["N-001"], origin: "ai", originalText: CITED }], ...(target.answer ? { answer: { kind: target.answer.kind, value: target.answer.kind === "date" && target.kind !== "clinician_opinion" ? "2026-03-12" : null } } : {}) }],
      gaps: [{ id: `gap-${pendingKey}-d1`, sectionKey: pendingKey, issue: "No clinician recorded an opinion.", suggestedQuestion: "?", relatedNoteIds: [], raisedBy: "ai" }],
      flags: [],
      generation: { mode: "demo_prewritten", model: "demo", promptVersion: "test", at: fresh.v.updatedAt, sectionKeys: [pendingKey] },
    } as never,
  });
  // The same drafted content with no drafting run recorded: refused (drafted text added by hand).
  assert.equal((await putStoredReport(p, { ...drafted, generation: fresh.v.generation }, "pat", revP)).status, 403);
  const put = await putStoredReport(p, drafted, "pat", revP);
  assert.equal(put.status, 200, JSON.stringify(put.body));
});

test("harden-WC major C: a kept acknowledgement stays on the paragraph the stored check names", async () => {
  const b = await formCase({ "F-31": [{ text: "He hurt his back lifting a box at work on 12/03/2026.", cites: ["N-001"] }] });
  const pid = b.v.sections.find((s) => s.key === "F-31")!.paragraphs[0].id;
  let r = revalidate(b, reviewReducer(b.v, { type: "editParagraph", key: "F-31", paragraphId: pid, text: "He hurt his back lifting a box at work. In my opinion he is fit for full duties.", actor: SARAH as never }));
  const op = r.flags.find((f) => f.sectionKey === "F-31" && f.code === "OPINION_LANGUAGE")!;
  assert.ok(op);
  r = revalidate(b, reviewReducer(r, { type: "acknowledgeFlag", flagId: op.id, reason: "My own clinical opinion.", actor: SARAH as never }));
  const h = await clinicHarness();
  const rev = await seed(h, r);
  const patText = "He hurt his back lifting a box at work. In my opinion he is fit for full duties and needs no further treatment.";
  const rewritten = mapBox(r, "F-31", (s) => ({ ...s, paragraphs: s.paragraphs.map((p) => {
    if (p.id !== pid) return p;
    const q = { ...p, text: patText, by: PAT_STAMP as never };
    delete q.ackReason;
    return q;
  }) }));
  // N4b: the flag's paragraph blanked in the body.
  const blanked = { ...rewritten, flags: rewritten.flags.map((f) => { if (f.id !== op.id) return f; const g = { ...f }; delete g.paragraphId; return g; }) };
  assert.equal((await putStoredReport(h, blanked, "pat", rev)).status, 403);
  // …or pointed at another paragraph.
  assert.equal((await putStoredReport(h, { ...rewritten, flags: rewritten.flags.map((f) => (f.id === op.id ? { ...f, paragraphId: "elsewhere" } : f)) }, "pat", rev)).status, 403);
  // As the review writes Pat's rewrite (the acknowledgement dropped): stored, and the check is open again.
  const viaReview = revalidate(b, reviewReducer(r, { type: "editParagraph", key: "F-31", paragraphId: pid, text: patText, actor: PAT as never }));
  assert.equal((await putStoredReport(h, viaReview, "pat", rev)).status, 200);
  assert.ok(viaReview.flags.some((f) => f.sectionKey === "F-31" && f.code === "OPINION_LANGUAGE" && !f.acknowledged));
});

test("harden-WC minor 1: a new stamp carries the member's own name and role, and 'may sign' only for a member who may", async () => {
  const b = await formCase({ "F-10": [] });
  const h = await clinicHarness();
  const rev = await seed(h, b.v);
  const withBy = (by: unknown) => mapBox(b.v, "F-10", (s) => ({ ...s, paragraphs: [{ id: "F-10-c1", text: CITED, sourceIds: ["N-001"], origin: "edited" as const, by: by as never }] }));
  assert.equal((await putStoredReport(h, withBy({ ...PAT_STAMP, name: "Sarah Reid", role: "owner", canSign: true }), "pat", rev)).status, 403, "N5");
  assert.equal((await putStoredReport(h, withBy({ ...PAT_STAMP, name: "Sarah Reid" }), "pat", rev)).status, 403);
  assert.equal((await putStoredReport(h, withBy({ ...PAT_STAMP, role: "clinician" }), "pat", rev)).status, 403);
  assert.equal((await putStoredReport(h, withBy({ ...PAT_STAMP, canSign: true }), "pat", rev)).status, 403);
  const own = await putStoredReport(h, withBy(PAT_STAMP), "pat", rev);
  assert.equal(own.status, 200);
  const label = revalidate(b, (own.body as { report: Report }).report).flags.find((f) => f.sectionKey === "F-10" && f.code === "APPROVER_DECISION");
  assert.match(label?.message ?? "", /^Entered by Pat Morgan \(staff\)/);
});

test("harden-WC minors 2 and 3: a create's base is an approved version; a new report has had no takeover", async () => {
  const { validated } = await opinionReport();
  const flag = opinionFlag(validated);
  const h = await clinicHarness();
  const draft = withAck(validated, flag.id, SARAH);
  await seed(h, draft);
  // N7: "version 2" of Sarah's draft, carrying her acknowledgement – checked as all-new, so refused.
  const v2 = { ...draft, id: "rpt_n7", version: 2, amends: { reportId: draft.id, version: 1, approvedAt: draft.updatedAt } };
  assert.equal((await putStoredReport(h, v2, "pat", null)).status, 403);
  // N7b': a made-up takeover on a new report – its approval receipt would repeat it.
  const b = await formCase({});
  const tom = { memberId: TOM.memberId, name: TOM.name, hcpc: TOM.hcpc! };
  const invented = { ...factoryCopy(b.v), id: "rpt_n7c", approverTakeovers: [{ from: tom, to: b.v.approver!, at: b.v.updatedAt }] } as Report;
  assert.equal((await putStoredReport(h, invented, "pat", null)).status, 403);
  // A case imported from the public demo keeps none of the demo's takeovers.
  const demoApprover = { memberId: "demo", name: "Dr Demo", hcpc: "PH-DEMO-09" };
  const demo = { ...factoryCopy(b.v), id: "rpt_demo_t", tenantId: "demo", approver: demoApprover, approverTakeovers: [{ from: demoApprover, to: demoApprover, at: b.v.updatedAt }] } as Report;
  const imported = await putStoredReport(h, demo, "pat", null);
  assert.equal(imported.status, 201, JSON.stringify(imported.body));
  assert.equal((imported.body as { report: Report }).report.approverTakeovers, undefined);
});

test("harden-WC minors 4 and 5: verbatim drafted text is never a person's; drafted text appears only by drafting or 'Split it out'", async () => {
  const D8 = "In my opinion he is fit for full duties.";
  const b = await formCase({ "F-31": [{ text: D8, cites: ["N-001"] }] });
  const h = await clinicHarness();
  // M8c: a create holding drafted wording labelled as a person's edit (text = its drafted wording).
  const m8c = { ...mapBox(factoryCopy(b.v), "F-31", (s) => ({ ...s, paragraphs: s.paragraphs.map((p) => ({ ...p, origin: "edited" as const, originalText: p.text, by: PAT_STAMP as never })) })), id: "rpt_m8c" };
  assert.equal((await putStoredReport(h, m8c, "pat", null)).status, 403);
  // The same as a new paragraph on an update.
  const rev = await seed(h, b.v);
  const added = mapBox(b.v, "F-31", (s) => ({ ...s, paragraphs: [...s.paragraphs, { id: "F-31-c9", text: D8, sourceIds: ["N-001"], origin: "edited" as const, originalText: D8, by: PAT_STAMP as never }] }));
  assert.equal((await putStoredReport(h, added, "pat", rev)).status, 403);
  // AI1: a new paragraph labelled as drafted text in Sarah's prognosis box.
  const ai1 = mapBox(b.v, "F-10", (s) => ({ ...s, paragraphs: [...s.paragraphs, { id: "F-10-p9", text: CITED, sourceIds: ["N-001"], origin: "ai" as const, originalText: CITED }] }));
  assert.equal((await putStoredReport(h, ai1, "pat", rev)).status, 403);
  // "Split it out" by the approver: the drafted sentence kept in her paragraph moves into a drafted paragraph – stored.
  const DRAFT = "He is expected to make a full recovery within 6 weeks of the accident.";
  const s = await formCase({ "F-10": [{ text: `In my opinion his back should settle with exercise. ${DRAFT}`, cites: ["N-001"], origin: "edited", originalText: DRAFT, by: "sarah" }] });
  const h2 = await clinicHarness();
  const rev2 = await seed(h2, s.v);
  const pid = s.v.sections.find((x) => x.key === "F-10")!.paragraphs[0].id;
  const split = reviewReducer(s.v, { type: "splitOutResidue", key: "F-10", paragraphId: pid, actor: SARAH as never });
  assert.notEqual(split, s.v);
  // A "split" paragraph whose words were never in the paragraph it names: refused.
  const fake = mapBox(s.v, "F-10", (x) => ({ ...x, paragraphs: [...x.paragraphs, { id: `${pid}-d1`, text: "He has fully recovered.", sourceIds: ["N-001"], origin: "ai" as const, originalText: "He has fully recovered." }] }));
  assert.equal((await putStoredReport(h2, fake, "sarah", rev2)).status, 403);
  const res = await putStoredReport(h2, split, "sarah", rev2);
  assert.equal(res.status, 200, JSON.stringify(res.body));
});

test("harden-WC minor 6: the Studio never reads the store's refusal as a lost sign-in – an update reloads the stored copy", async () => {
  const problemBody = JSON.stringify({ type: "about:blank", title: "This change cannot be saved as yours", status: 403, code: "DECISION_NOT_ALLOWED", detail: "It records a decision as someone else." });
  const fake = (async () => new Response(problemBody, { status: 403, headers: { "content-type": "application/problem+json" } })) as typeof fetch;
  const api = createServerApi(fake);
  const { validated } = await opinionReport();
  const update = await api.putReport(validated, 3);
  assert.equal(update.ok, false);
  assert.equal(!update.ok && update.kind, "conflict", "reloaded like a conflict, never queued for sign-in");
  const create = await api.putReport(validated, null);
  assert.equal(!create.ok && create.kind, "rejected");
  assert.equal(classifyStatus(403, "DECISION_NOT_ALLOWED"), "rejected");
  assert.equal(classifyStatus(403, "REPORT_LOCKED"), "rejected");
  assert.equal(classifyStatus(403, "SOMETHING_ELSE"), "blocked");
});
