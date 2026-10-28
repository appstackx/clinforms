/**
 * bh2 fix r2b – WC: the two round-2 HIGH findings the re-check found not fixed at the root on bh2-rc3 (48414d9), each
 * reproduced through the real store PUT (and /sign, /render) handlers on the corpus's fictional clinic (Sarah Reid
 * approves, Tom Ellis may sign, Pat Morgan is staff). Fictional data only.
 *
 * - R2-SEC-2 (re-check): one claimed one-click fix, on a paragraph the stored copy's client-written flags point at many
 *   times, made the engine generate candidates once per stored flag (9–31 s CPU on one refused PUT). Now the generators
 *   read the server's flags only, of the claimed kind's check, each distinct flag once, within a work budget, and a
 *   claimed paragraph is bounded – refused in well under a second; real fixes are still stored.
 * - R2-TPN-01 (re-check): a structured answer replaced by a "text" answer (or taken away) with no stamp, and a records
 *   box's code-filled paragraph replaced by an unstamped staff paragraph, were stored, signed and issued. Now refused;
 *   the stamped twins and the review's own flows are stored.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FormDefinition, Paragraph, Report, ReportFlag, ReportSection } from "../../src/modules/medreport/core/types";
import { validateReport } from "../../src/modules/medreport/core/validation";
import { formMapSha256 } from "../../src/modules/medreport/auth/attestations";
import { ENGINE_FIX_FLAG_CODE } from "../../src/modules/medreport/api/handlers/store-reports";
import { buildCase, ownerOf, type Built } from "../../src/modules/medreport/core/validation/__corpus__/harness/build";
import { CORPUS_TENANT, actorOf } from "../../src/modules/medreport/core/validation/__corpus__/harness/fixtures";
import { createHttpHarness, putStoredReport, type HttpHarness } from "../../src/modules/medreport/core/validation/__corpus__/harness/http";
import { CaseInputSchema } from "../../src/modules/medreport/core/validation/__corpus__/harness/types";
import { ENGINE_FIX_KINDS, applyFixProposal, offeredFixes } from "../../src/modules/medreport/ui/components/review/fixes";
import { reviewReducer } from "../../src/modules/medreport/ui/components/review/use-review-state";

const SARAH = actorOf("sarah");
const PAT = actorOf("pat");

const box = (r: Report, key: string) => r.sections.find((s) => s.key === key) as ReportSection;
const mapBox = (r: Report, key: string, fn: (s: ReportSection) => ReportSection): Report => ({ ...r, sections: r.sections.map((s) => (s.key === key ? fn(s) : s)) });
const refusedAs = (res: { status: number; code: string | null }) => `${res.status} ${res.code ?? ""}`.trim();
const unstamped = (s: ReportSection): ReportSection => {
  const n = { ...s };
  delete n.answerBy;
  return n;
};
function revalidate(b: Built, r: Report): Report {
  return { ...r, flags: validateReport(r, b.template, { computedFacts: b.computedFacts, form: b.form, voice: { owner: ownerOf(b) as never } }).flags };
}
async function storeForm(h: HttpHarness, form: FormDefinition): Promise<void> {
  await h.store.createForm(CORPUS_TENANT, { id: form.id, status: form.status, title: form.title, referrer: form.referrer.name, kind: form.kind, fileSha256: form.file.sha256, sampleId: null, payload: form });
}
async function clinic(b: Built): Promise<HttpHarness> {
  const h = createHttpHarness();
  if (b.form) await storeForm(h, b.form);
  return h;
}
async function seed(h: HttpHarness, r: Report, as: "sarah" | "pat" = "sarah"): Promise<number> {
  const res = await putStoredReport(h, r, as, null);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return (res.body as { rev: number }).rev;
}
/**
 * One PUT, timed by this process's CPU (the handler runs in it): load from other test files never counts, as wall time
 * would under the parallel runner.
 */
async function timedPut(h: HttpHarness, r: Report, as: "sarah" | "pat", rev: number): Promise<{ status: number; code: string | null; ms: number; body: unknown }> {
  const c0 = process.cpuUsage();
  const res = await putStoredReport(h, r, as, rev);
  const cpu = process.cpuUsage(c0);
  return { status: res.status, code: res.code, ms: (cpu.user + cpu.system) / 1000, body: res.body };
}

/* ------------------------------------------------------------------------------------------------
 * R2-SEC-2 (re-check): the engine phase's candidate generation
 * ----------------------------------------------------------------------------------------------*/

const REG = ["cervical", "thoracic", "lumbar", "shoulder", "hip", "knee", "ankle", "wrist"];
const MOV = ["rotation", "extension", "flexion", "abduction", "adduction"];
const noteSentence = (k: number) => `${REG[k % 8]} ${MOV[(k >> 3) % 5]} measured ${(k % 70) + 15} degrees with pain ${k % 10} out of 10 after walking ${(k % 40) + 5} minutes.`;
const draftSentence = (k: number) => `The ${REG[k % 8]} ${MOV[(k >> 3) % 5]} was ${(k % 70) + 15} degrees with pain ${k % 10} out of 10 after walking ${(k % 40) + 5} minutes.`;
function fill(chars: number, f: (k: number) => string, from: number): string {
  let s = "";
  for (let i = from; (s ? `${s} ${f(i)}` : f(i)).length <= chars; i++) s = s ? `${s} ${f(i)}` : f(i);
  return s;
}

/**
 * The re-check's shape (recheck-sec2/v1-flag-amplified.mts): cf-discharge, F-32 drafted paragraphs of `chars` characters
 * citing Tom Ellis's note N-002 (so the attribution fixes apply), his note holding `noteChars` characters, created by
 * Sarah (the approver) with `forgedFlags` client-written flags on the first paragraph.
 */
async function colleagueDrafted(paragraphs: number, chars: number, noteChars: number, forgedFlags = 0): Promise<{ b: Built; r: Report }> {
  const b = await buildCase(CaseInputSchema.parse({ report: "form:cf-discharge" }));
  const notes = b.report.bundleSnapshot.notes.map((n) => (n.id === "N-002" ? { ...n, objective: fill(noteChars, noteSentence, 0) } : n));
  const ps: Paragraph[] = Array.from({ length: paragraphs }, (_, j) => {
    const t = fill(chars, draftSentence, j * 37);
    return { id: `a${j}`, text: t, originalText: t, sourceIds: ["N-002"], origin: "ai" };
  });
  let r: Report = { ...b.report, bundleSnapshot: { ...b.report.bundleSnapshot, notes }, sections: b.report.sections.map((s) => (s.key === "F-32" ? { ...s, status: "drafted", paragraphs: ps } : s)) };
  r = { ...r, form: { ...r.form!, mapSha256: formMapSha256(b.form!) } };
  r = revalidate(b, r);
  const forged: ReportFlag[] = Array.from({ length: forgedFlags }, (_, i) => ({ id: `forged-${i}`, code: "OTHER_CLINICIAN_VOICE", severity: "warning", sectionKey: "F-32", paragraphId: "a0", message: `x ${i}`, evidence: `unattributed Tom Ellis ${i}` }) as ReportFlag);
  return { b, r: { ...r, flags: [...r.flags, ...forged] } };
}

/** The first paragraph of F-32 changed in place by a claimed "attribution-prefix" fix (own stamp) the engine never makes. */
function claimedPrefix(r: Report, by: typeof SARAH): Report {
  return mapBox(r, "F-32", (s) => ({
    ...s,
    paragraphs: s.paragraphs.map((p, i) => (i !== 0 ? p : { ...p, text: `Noted. ${p.text}`, fixes: [{ kind: "attribution-prefix", by: by as never, at: r.updatedAt, edits: [{ start: 0, end: 0, text: "Noted. " }] }] })),
  }));
}

test("R2-SEC-2 re-check: the approver's one claimed fix on a paragraph 200 client-written flags point at is refused in well under a second (the generators read the server's flags only)", async () => {
  for (const noteChars of [20_000, 100_000]) {
    const { b, r } = await colleagueDrafted(1, 3_800, noteChars, 200);
    const h = await clinic(b);
    const rev = await seed(h, r);
    const res = await timedPut(h, claimedPrefix(r, SARAH), "sarah", rev);
    assert.equal(res.status, 403, `notes ${noteChars}: ${refusedAs(res)}`);
    assert.ok(res.ms < 1_000, `notes ${noteChars}: ${Math.round(res.ms)} ms`);
  }
});

test("R2-SEC-2 re-check: a claimed fix on a paragraph over the store's bound (the re-check's 9,000 characters) is answered 413 before any validator", async () => {
  const { b, r } = await colleagueDrafted(1, 9_000, 20_000, 10);
  const h = await clinic(b);
  const rev = await seed(h, r);
  const res = await timedPut(h, claimedPrefix(r, SARAH), "sarah", rev);
  assert.equal(res.status, 413, refusedAs(res));
  assert.equal(res.code, "PAYLOAD_TOO_LARGE");
  assert.ok(res.ms < 300, `${Math.round(res.ms)} ms`);
});

test("R2-SEC-2 re-check: twenty genuine engine fixes in one save – stored at real sizes, refused (413) where the generators' work would exceed the budget", async () => {
  // Real sizes (the largest bh2 paragraph is 684 characters, notes 5,647): the engine's own offers, applied as the review
  // applies them, all twenty in one save – stored, each still drafted with its fix recorded.
  {
    const { b, r } = await colleagueDrafted(20, 680, 5_000);
    const h = await clinic(b);
    const rev = await seed(h, r);
    const fixes = offeredFixes(r, { actor: SARAH, template: b.template, form: b.form }).filter((f) => f.sectionKey === "F-32");
    let fixed = r;
    const done = new Set<string>();
    for (const f of fixes) if (!done.has(f.paragraphId)) (done.add(f.paragraphId), (fixed = applyFixProposal(fixed, f, SARAH)));
    assert.equal(done.size, 20, "the engine offers the approver a fix on each paragraph");
    const res = await timedPut(h, fixed, "sarah", rev);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    // Genuine work (about 0.45 s CPU unloaded); the bound leaves room for the parallel runner.
    assert.ok(res.ms < 1_500, `${Math.round(res.ms)} ms CPU`);
    assert.ok(box((res.body as { report: Report }).report, "F-32").paragraphs.every((p) => p.origin === "ai" && p.fixes?.length === 1), "still drafted, each fix recorded");
  }
  // The same twenty genuine fixes beside 100,000 characters of notes: beyond the work budget – 413, in under a second.
  {
    const { b, r } = await colleagueDrafted(20, 680, 100_000);
    const h = await clinic(b);
    const rev = await seed(h, r);
    const fixes = offeredFixes(r, { actor: SARAH, template: b.template, form: b.form }).filter((f) => f.sectionKey === "F-32");
    let fixed = r;
    const done = new Set<string>();
    for (const f of fixes) if (!done.has(f.paragraphId)) (done.add(f.paragraphId), (fixed = applyFixProposal(fixed, f, SARAH)));
    const res = await timedPut(h, fixed, "sarah", rev);
    assert.equal(res.status, 413, refusedAs(res));
    // About 0.5 s CPU unloaded: the generators stop at the budget.
    assert.ok(res.ms < 1_500, `${Math.round(res.ms)} ms CPU (the generators stop at the budget)`);
  }
});

test("R2-SEC-2 re-check: one genuine attribution fix (the approver's) is still stored", async () => {
  const { b, r } = await colleagueDrafted(1, 600, 3_000);
  const h = await clinic(b);
  const rev = await seed(h, r);
  const fix = offeredFixes(r, { actor: SARAH, template: b.template, form: b.form }).find((f) => f.sectionKey === "F-32" && f.generator === "attribution-prefix");
  assert.ok(fix, "the engine offers 'Name Tom Ellis'");
  const res = await timedPut(h, applyFixProposal(r, fix, SARAH), "sarah", rev);
  assert.equal(res.status, 200, JSON.stringify(res.body));
});

test("R2-SEC-2 re-check: ENGINE_FIX_FLAG_CODE names the check of every engine fix kind", () => {
  assert.deepEqual(new Set(Object.keys(ENGINE_FIX_FLAG_CODE)), new Set(ENGINE_FIX_KINDS));
});

/* ------------------------------------------------------------------------------------------------
 * R2-TPN-01 (re-check): a "text" answer, a removed answer, an unstamped records paragraph
 * ----------------------------------------------------------------------------------------------*/

const F07_DRAFT = { box: "F-07", answers: { "F-07": true }, boxes: { "F-07": [{ text: "Sarah Reid recorded that he had returned to work on full duties.", cites: ["N-001"], origin: "ai" }] } };

async function drafted(): Promise<{ b: Built; r: Report }> {
  const b = await buildCase(CaseInputSchema.parse({ report: "form:cf-discharge", ...F07_DRAFT }));
  return { b, r: revalidate(b, mapBox(b.report, "F-07", unstamped)) };
}

test("R2-TPN-01 re-check: a structured answer replaced by a 'text' answer with no stamp is refused – drafted yes/no F-07, code-filled date F-02; stamped as Pat the kind change is refused too", async () => {
  const { b, r } = await drafted();
  for (const [key, value] of [["F-07", "No"], ["F-02", "1970-01-01"]] as const) {
    const h = await clinic(b);
    const rev = await seed(h, r);
    const forged = mapBox(r, key, (s) => ({ ...unstamped(s), answer: { kind: "text", value } }));
    const res = await putStoredReport(h, forged, "pat", rev);
    assert.equal(res.status, 403, `${key} kind text unstamped: ${refusedAs(res)}`);
    const stamped = mapBox(forged, key, (s) => ({ ...s, answerBy: PAT as never }));
    assert.equal((await putStoredReport(h, stamped, "pat", rev)).status, 403, `${key} kind text stamped`);
  }
});

test("R2-TPN-01 re-check: a structured answer taken away (no answer at all) is refused – the box would print its supporting text", async () => {
  const { b, r } = await drafted();
  for (const key of ["F-07", "F-02"]) {
    const h = await clinic(b);
    const rev = await seed(h, r);
    const removed = mapBox(r, key, (s) => {
      const n = unstamped(s);
      delete n.answer;
      return n;
    });
    const res = await putStoredReport(h, removed, "pat", rev);
    assert.equal(res.status, 403, `${key}: ${refusedAs(res)}`);
  }
});

test("R2-TPN-01 re-check: a records box's code-filled paragraph replaced by an unstamped staff entry is refused (F-01 name; F-02 with its date cleared); stamped as Pat it is stored and labelled hers", async () => {
  const { b, r } = await drafted();
  const entry = (s: ReportSection, by: typeof PAT | null): ReportSection => {
    const n: ReportSection = { ...unstamped(s), paragraphs: [{ id: `${s.key}-staff-1`, text: s.key === "F-02" ? "01/01/1970" : "Owen Forged", sourceIds: [], origin: "staff", ...(by ? { by: by as never } : {}) }] };
    if (s.answer && s.answer.kind !== "text") n.answer = { kind: s.answer.kind, value: null } as never;
    return n;
  };
  for (const key of ["F-01", "F-02"]) {
    const h = await clinic(b);
    const rev = await seed(h, r);
    const res = await putStoredReport(h, mapBox(r, key, (s) => entry(s, null)), "pat", rev);
    assert.equal(res.status, 403, `${key} unstamped: ${refusedAs(res)}`);
    const own = await putStoredReport(h, mapBox(r, key, (s) => entry(s, PAT)), "pat", rev);
    assert.equal(own.status, 200, `${key} stamped: ${JSON.stringify(own.body)}`);
    const stored = (own.body as { report: Report; rev: number }).report;
    assert.equal(box(stored, key).paragraphs[0].by?.memberId, PAT.memberId, "labelled as Pat's");
    // Her stamp is never taken off the entry afterwards (it would read as nobody's).
    const dropped = mapBox(stored, key, (s) => ({ ...s, paragraphs: s.paragraphs.map((q) => (({ by: _by, ...rest }) => rest)(q) as Paragraph) }));
    const res2 = await putStoredReport(h, dropped, "pat", (own.body as { rev: number }).rev);
    assert.equal(res2.status, 403, `${key} stamp dropped: ${refusedAs(res2)}`);
  }
});

test("R2-TPN-01 re-check: the portal shape (F-07 drafted Yes → text 'No', unstamped) is not stored; the stored copy keeps Yes", async () => {
  const { b, r } = await drafted();
  const h = await clinic(b);
  const rev = await seed(h, r);
  const res = await putStoredReport(h, mapBox(r, "F-07", (s) => ({ ...s, answer: { kind: "text", value: "No" } })), "pat", rev);
  assert.equal(res.status, 403, refusedAs(res));
  const stored = await h.store.getReport(CORPUS_TENANT, r.id);
  assert.equal(stored?.rev, rev, "nothing was stored");
  assert.deepEqual(box(stored!.payload as Report, "F-07").answer, { kind: "yes_no", value: true }, "the stored copy keeps the drafted Yes");
});

test("R2-TPN-01 re-check: the review's own flows are stored – staff type over a records paragraph (editParagraph stamps it), clear and set an answer (setAnswer keeps its kind)", async () => {
  const { b, r } = await drafted();
  const ctx = { fields: b.form?.fields ?? null, form: b.form, boxes: b.template.sections } as never;
  const h = await clinic(b);
  let rev = await seed(h, r);
  // "Change for this report" (overrideRecord) turns the records value into the member's entry, then they type over it.
  const overridden = reviewReducer(r, { type: "overrideRecord", key: "F-01", actor: PAT as never } as never, ctx);
  const op = box(overridden, "F-01").paragraphs[0];
  assert.notEqual(op.origin, "from_records");
  assert.equal(op.by?.memberId, PAT.memberId, "the review stamps the entry");
  const typed = reviewReducer(overridden, { type: "editParagraph", key: "F-01", paragraphId: op.id, text: "Owen Testcase-Jones", actor: PAT as never }, ctx);
  const tp = box(typed, "F-01").paragraphs.find((x) => x.text === "Owen Testcase-Jones");
  assert.ok(tp, "the edit is in the box");
  assert.equal(tp.by?.memberId, PAT.memberId, "the review stamps the person's paragraph");
  let res = await putStoredReport(h, typed, "pat", rev);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  rev = (res.body as { rev: number }).rev;
  const cleared = reviewReducer(typed, { type: "setAnswer", key: "F-07", value: null, actor: PAT as never }, ctx);
  assert.equal(box(cleared, "F-07").answer?.kind, "yes_no", "clearing keeps the answer's kind");
  res = await putStoredReport(h, cleared, "pat", rev);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  rev = (res.body as { rev: number }).rev;
  const set = reviewReducer(cleared, { type: "setAnswer", key: "F-07", value: false, actor: PAT as never }, ctx);
  assert.equal((await putStoredReport(h, set, "pat", rev)).status, 200);
});
