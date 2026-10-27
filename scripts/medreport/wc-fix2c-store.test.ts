/**
 * bh2 fix r2c – WC: the two HIGH residuals the final check (round 2) re-ran on bh2-rc4 (3e1e75f), each reproduced
 * through the real store PUT (and /sign) handlers on the corpus's fictional clinic (Sarah Reid approves, Pat Morgan is
 * staff). Fictional data only.
 *
 * - R2-SEC-2 (residual V2): one forged claimed fix with a very long identity `edits` list, on a drafted paragraph at the
 *   record cap, was replayed by draftedRewritePlan before any bound – 1.3 s CPU (2.6 s two-byte) before its 403. Now the
 *   paragraph's characters and the fix's edits are bounded before any replay. The cost test sweeps edit-list length,
 *   paragraph size and byte width up to the record cap and holds every refusal under a second.
 * - R2-TPN-01 (residual): a structured answer set to `value: []` with no stamp read as a clear in the store (answerSet)
 *   and as an answer at approval (isSectionAnswered) – a records date and a drafted yes/no went blank, signed. Now no
 *   empty-ish shape ([] / [{}] / blank words on a yes/no, tick, choice, date or number box) is stored, stamped or not;
 *   the clears (null, "") still are and count as unanswered; and a report that already holds one is blocked at /sign
 *   naming the box.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { SharedStateStore } from "../../src/modules/medreport/api/deps";
import type { FormAnswer, FormDefinition, Paragraph, Report, ReportSection } from "../../src/modules/medreport/core/types";
import { validateReport } from "../../src/modules/medreport/core/validation";
import { formMapSha256 } from "../../src/modules/medreport/auth/attestations";
import { STORE_MAX_RECORD_BYTES } from "../../src/modules/medreport/api/store-contract";
import { answerSet } from "../../src/modules/medreport/core/provenance";
import { isSectionAnswered } from "../../src/modules/medreport/core/forms/answers";
import { buildCase, ownerOf, type Built } from "../../src/modules/medreport/core/validation/__corpus__/harness/build";
import { CORPUS_TENANT, actorOf } from "../../src/modules/medreport/core/validation/__corpus__/harness/fixtures";
import { createHttpHarness, postSign, putStoredReport, type HttpHarness } from "../../src/modules/medreport/core/validation/__corpus__/harness/http";
import { CaseInputSchema } from "../../src/modules/medreport/core/validation/__corpus__/harness/types";
import { applyFixProposal, offeredFixes, undoProposal } from "../../src/modules/medreport/ui/components/review/fixes";
import { setStructuredAnswer } from "../../src/modules/medreport/ui/components/review/reducer";

const SARAH = actorOf("sarah");
const PAT = actorOf("pat");

const box = (r: Report, key: string) => r.sections.find((s) => s.key === key) as ReportSection;
const mapBox = (r: Report, key: string, fn: (s: ReportSection) => ReportSection): Report => ({ ...r, sections: r.sections.map((s) => (s.key === key ? fn(s) : s)) });
const shown = (res: { status: number; code: string | null }) => `${res.status} ${res.code ?? ""}`.trim();
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
/** No write allowance in the way: this file makes many large saves on purpose (the checks are what it tests). */
const unlimited: SharedStateStore = {
  hit: async (_key, windowMs) => ({ count: 1, resetAt: new Date(Date.now() + windowMs).toISOString() }),
  peek: async (_key, windowMs) => ({ count: 0, resetAt: new Date(Date.now() + windowMs).toISOString() }),
  reset: async () => {},
  claimOnce: async () => true,
};
async function clinic(b: Built): Promise<HttpHarness> {
  const h = createHttpHarness();
  (h.deps as { sharedState?: SharedStateStore }).sharedState = unlimited;
  if (b.form) await storeForm(h, b.form);
  return h;
}
async function seed(h: HttpHarness, r: Report, as: "sarah" | "pat" = "sarah"): Promise<number> {
  const res = await putStoredReport(h, r, as, null);
  assert.equal(res.status, 201, JSON.stringify(res.body).slice(0, 400));
  return (res.body as { rev: number }).rev;
}
/** One PUT, timed by this process's CPU (the handler runs in it), as wc-fix2b-store.test.ts. */
async function timedPut(h: HttpHarness, r: Report, as: "sarah" | "pat", rev: number): Promise<{ status: number; code: string | null; ms: number; body: unknown }> {
  const c0 = process.cpuUsage();
  const res = await putStoredReport(h, r, as, rev);
  const cpu = process.cpuUsage(c0);
  return { status: res.status, code: res.code, ms: (cpu.user + cpu.system) / 1000, body: res.body };
}
async function storedCopy(h: HttpHarness, id: string): Promise<Report> {
  const got = await h.store.getReport(CORPUS_TENANT, id);
  assert.ok(got, "the clinic holds the report");
  return JSON.parse(JSON.stringify(got.payload)) as Report;
}

/* ------------------------------------------------------------------------------------------------
 * R2-SEC-2 (residual V2): the identity-edit replay, bounded before any replay
 * ----------------------------------------------------------------------------------------------*/

const REG = ["cervical", "thoracic", "lumbar", "shoulder", "hip", "knee", "ankle", "wrist"];
const sentence = (k: number) => `The ${REG[k % 8]} range was ${(k % 70) + 15} degrees on visit ${k}.`;
function filled(chars: number): string {
  const out: string[] = [];
  let len = 0;
  for (let i = 0; len < chars; i++) {
    const s = sentence(i);
    out.push(s);
    len += s.length + 1;
  }
  return out.join(" ").slice(0, chars);
}

/** The final check's V2 shape (recheck-sec2-rc4/v2-edits-replay.mts): cf-discharge, one drafted F-32 paragraph. */
async function longDrafted(chars: number, wide: boolean, storedEdits: number, as: "sarah" | "pat"): Promise<{ b: Built; r: Report; text: string }> {
  const b = await buildCase(CaseInputSchema.parse({ report: "form:cf-discharge" }));
  const text = (wide ? "—" : "") + filled(wide ? chars - 1 : chars);
  const by = actorOf(as);
  const fixes = storedEdits > 0 ? [{ kind: "value-only", by: by as never, at: b.report.updatedAt, edits: identityEdits(text, storedEdits) }] : [];
  const p: Paragraph = { id: "a0", text, originalText: text, sourceIds: ["N-001"], origin: "ai", ...(fixes.length ? { fixes } : {}) };
  let r: Report = { ...b.report, sections: b.report.sections.map((s) => (s.key === "F-32" ? { ...s, status: "drafted", paragraphs: [p] } : s)) };
  r = { ...r, form: { ...r.form!, mapSha256: formMapSha256(b.form!) }, flags: [] };
  return { b, r, text };
}
const MID = 5;
const identityEdits = (text: string, n: number) => Array.from({ length: n }, () => ({ start: MID, end: MID + 1, text: text[MID] }));
const bytesOf = (r: Report) => new TextEncoder().encode(JSON.stringify(r)).byteLength;

/** The forged update: one claimed "value-only" fix of `edits` identity edits plus one real append, on F-32's paragraph. */
function forgedFix(stored: Report, text: string, edits: number | "fill", tail: "ok" | "bad", by: typeof SARAH): Report {
  const append = " Noted.";
  const sent = tail === "ok" ? text + append : `${text} Noted!`;
  const make = (n: number): Report =>
    mapBox(stored, "F-32", (s) => ({
      ...s,
      paragraphs: s.paragraphs.map((p) => ({ ...p, text: sent, fixes: [...(p.fixes ?? []), { kind: "value-only", by: by as never, at: stored.updatedAt, edits: [...identityEdits(text, n), { start: text.length, end: text.length, text: append }] }] })),
    }));
  if (edits !== "fill") return make(edits);
  // As many identity edits as the record cap leaves room for (the request is stored-size, so only the checks refuse it).
  const one = JSON.stringify(identityEdits(text, 1)[0]).length + 1;
  const n = Math.max(0, Math.floor((STORE_MAX_RECORD_BYTES - bytesOf(make(0)) - 4_096) / one));
  return make(n);
}

test("R2-SEC-2 residual: the cost sweep – edit-list length, paragraph size and byte width up to the record cap – every forged claimed fix is refused in under a second", async () => {
  const rows: string[] = [];
  let worst = 0;
  const sizes = [680, 4_000, 4_001, 100_000, 650_000];
  for (const chars of sizes) {
    for (const wide of [false, true]) {
      for (const edits of [1, 16, 17, 1_000, "fill"] as const) {
        for (const tail of edits === "fill" ? (["ok", "bad"] as const) : (["ok"] as const)) {
          const { b, r, text } = await longDrafted(chars, wide, 0, "sarah");
          const h = await clinic(b);
          const rev = await seed(h, r);
          const stored = await storedCopy(h, r.id);
          const forged = forgedFix(stored, text, edits, tail, PAT);
          const size = bytesOf(forged);
          assert.ok(size <= STORE_MAX_RECORD_BYTES, `${chars}/${edits}: the request fits the record cap (${size})`);
          const res = await timedPut(h, forged, "pat", rev);
          const label = `${chars} chars ${wide ? "two-byte" : "one-byte"}, ${edits} identity edits, tail ${tail}, ${Math.round(size / 1024)} KB`;
          rows.push(`${label} -> ${shown(res)} ${Math.round(res.ms)} ms CPU`);
          worst = Math.max(worst, res.ms);
          assert.ok(res.status === 403 || res.status === 413, `${label}: ${shown(res)}`);
          // Over the paragraph bound: 413 before any replay; within it, more edits than the engine records: 403.
          if (chars + (tail === "ok" ? " Noted.".length : " Noted!".length) > 4_000) assert.equal(res.status, 413, `${label}: ${shown(res)}`);
          else if (edits === "fill" || edits > 16) assert.equal(res.status, 403, `${label}: ${shown(res)}`);
          assert.ok(res.ms < 1_000, `${label}: ${Math.round(res.ms)} ms CPU`);
          assert.deepEqual(box(await storedCopy(h, r.id), "F-32").paragraphs[0].text, text, `${label}: nothing stored`);
        }
      }
    }
  }
  // The stored-fix variant: the create stores a fix with as many identity edits as fit; the update adds one small fix.
  for (const chars of [680, 4_000, 650_000]) {
    for (const wide of [false, true]) {
      const probe = await longDrafted(chars, wide, 0, "sarah");
      const one = JSON.stringify(identityEdits(probe.text, 1)[0]).length + 1;
      const n = Math.max(1, Math.floor((STORE_MAX_RECORD_BYTES - bytesOf(probe.r) - 8_192) / one));
      const { b, r, text } = await longDrafted(chars, wide, n, "sarah");
      const h = await clinic(b);
      const rev = await seed(h, r);
      const stored = await storedCopy(h, r.id);
      const forged = forgedFix(stored, text, 0, "ok", SARAH);
      const res = await timedPut(h, forged, "sarah", rev);
      const label = `stored fix of ${n} identity edits on ${chars} chars ${wide ? "two-byte" : "one-byte"}, ${Math.round(bytesOf(forged) / 1024)} KB`;
      rows.push(`${label} -> ${shown(res)} ${Math.round(res.ms)} ms CPU`);
      worst = Math.max(worst, res.ms);
      assert.ok(res.status === 403 || res.status === 413, `${label}: ${shown(res)}`);
      assert.ok(res.ms < 1_000, `${label}: ${Math.round(res.ms)} ms CPU`);
    }
  }
  console.log(`# worst ${Math.round(worst)} ms CPU\n# ${rows.join("\n# ")}`);
});

const MOV = ["rotation", "extension", "flexion", "abduction", "adduction"];
const noteSentence = (k: number) => `${REG[k % 8]} ${MOV[(k >> 3) % 5]} measured ${(k % 70) + 15} degrees with pain ${k % 10} out of 10 after walking ${(k % 40) + 5} minutes.`;
const draftSentence = (k: number) => `The ${REG[k % 8]} ${MOV[(k >> 3) % 5]} was ${(k % 70) + 15} degrees with pain ${k % 10} out of 10 after walking ${(k % 40) + 5} minutes.`;
function fill(chars: number, f: (k: number) => string, from: number): string {
  let s = "";
  for (let i = from; (s ? `${s} ${f(i)}` : f(i)).length <= chars; i++) s = s ? `${s} ${f(i)}` : f(i);
  return s;
}

/** A drafted F-32 paragraph citing Tom Ellis's note N-002, so the attribution fixes apply (wc-fix2b-store.test.ts). */
async function colleagueDrafted(chars: number, noteChars: number): Promise<{ b: Built; r: Report }> {
  const b = await buildCase(CaseInputSchema.parse({ report: "form:cf-discharge" }));
  const notes = b.report.bundleSnapshot.notes.map((n) => (n.id === "N-002" ? { ...n, objective: fill(noteChars, noteSentence, 0) } : n));
  const t = fill(chars, draftSentence, 0);
  const p: Paragraph = { id: "a0", text: t, originalText: t, sourceIds: ["N-002"], origin: "ai" };
  let r: Report = { ...b.report, bundleSnapshot: { ...b.report.bundleSnapshot, notes }, sections: b.report.sections.map((s) => (s.key === "F-32" ? { ...s, status: "drafted", paragraphs: [p] } : s)) };
  r = { ...r, form: { ...r.form!, mapSha256: formMapSha256(b.form!) } };
  return { b, r: revalidate(b, r) };
}

test("R2-SEC-2 residual: the engine's own fix and its undo are still stored (one edit each, within the bounds)", async () => {
  const { b, r } = await colleagueDrafted(600, 3_000);
  const h = await clinic(b);
  let rev = await seed(h, r);
  const fix = offeredFixes(r, { actor: SARAH, template: b.template, form: b.form }).find((f) => f.sectionKey === "F-32" && f.generator === "attribution-prefix");
  assert.ok(fix, "the engine offers 'Name Tom Ellis'");
  const fixed = applyFixProposal(r, fix, SARAH);
  const put1 = await timedPut(h, fixed, "sarah", rev);
  assert.equal(put1.status, 200, JSON.stringify(put1.body).slice(0, 400));
  rev = (put1.body as { rev: number }).rev;
  const stored = (put1.body as { report: Report }).report;
  const undone = applyFixProposal(stored, undoProposal(fix, r), SARAH);
  assert.notEqual(box(undone, "F-32").paragraphs[0].text, box(stored, "F-32").paragraphs[0].text, "the undo changes the text back");
  const put2 = await timedPut(h, undone, "sarah", rev);
  assert.equal(put2.status, 200, JSON.stringify(put2.body).slice(0, 400));
  const back = box((put2.body as { report: Report }).report, "F-32").paragraphs[0];
  assert.equal(back.text, box(r, "F-32").paragraphs[0].text);
  assert.equal(back.origin, "ai");
  assert.equal(back.fixes?.length, 2);
});

/* ------------------------------------------------------------------------------------------------
 * R2-TPN-01 (residual): empty-ish answer values
 * ----------------------------------------------------------------------------------------------*/

type Value = FormAnswer["value"];
const KINDS = ["yes_no", "checkbox", "choice", "date", "number", "rows"] as const;
const SHAPES: Value[] = [null, "", " ", "\t\n", "x", "N/A", "2026-05-06", true, false, [], [{}], [{ c: "" }], [{ c: " " }], [{ c: "x" }]];

test("R2-TPN-01 residual: answerSet and isSectionAnswered agree – every value that counts as answered needs a stamp; a list on a scalar box and blank words are no answer", () => {
  for (const kind of KINDS) {
    for (const value of SHAPES) {
      const answer = { kind, value } as FormAnswer;
      const answered = isSectionAnswered({ paragraphs: [], answer });
      const set = answerSet(answer);
      const label = `${kind} ${JSON.stringify(value)}`;
      // Never a clear (no stamp) that is then counted as answered (no MISSING_PLACEHOLDER).
      if (answered) assert.ok(set, `${label}: counted answered, so it needs a stamp`);
      // The review's clears (null, "") and an empty table are no answer and need no stamp.
      if (value === null || value === "" || (kind === "rows" && Array.isArray(value) && value.length === 0)) {
        assert.equal(set, false, `${label}: a clear`);
        assert.equal(answered, false, `${label}: a clear is unanswered`);
      }
      if (kind !== "rows" && (Array.isArray(value) || (typeof value === "string" && value.trim() === ""))) assert.equal(answered, false, `${label}: no answer`);
    }
  }
});

/** cf-discharge with drafted F-07 (yes/no) answered Yes, as the triage and the final check's probes have it. */
async function dischargeWithDraftedYesNo(): Promise<{ b: Built; r: Report }> {
  const b = await buildCase(CaseInputSchema.parse({ report: "form:cf-discharge", box: "F-07", boxes: { "F-07": [{ text: "Sarah Reid recorded that he had returned to work on full duties.", cites: ["N-001"], origin: "ai" }] } }));
  const r = revalidate(b, mapBox(b.report, "F-07", (s) => ({ ...unstamped(s), answer: { kind: "yes_no", value: true } })));
  return { b, r };
}

const BOXES = ["F-02", "F-04", "F-07", "F-21"] as const; // records date, records choice, drafted yes/no, records date
const EMPTYISH: unknown[] = [[], [""], [{}], [{ c: "" }], [{ c: "x" }], " ", "\t", {}];

test("R2-TPN-01 residual: an empty-ish value on a records or drafted answer is never stored – unstamped, stamped as Pat, or as Sarah (the approver)", async () => {
  const { b, r } = await dischargeWithDraftedYesNo();
  const rows: string[] = [];
  for (const key of BOXES) {
    for (const value of EMPTYISH) {
      for (const who of ["pat-unstamped", "pat-stamped", "sarah-stamped"] as const) {
        const h = await clinic(b);
        const rev = await seed(h, r);
        const as = who.startsWith("pat") ? "pat" : "sarah";
        const forged = mapBox(r, key, (s) => {
          const n = { ...unstamped(s), answer: { kind: s.answer!.kind, value } as unknown as FormAnswer };
          if (who !== "pat-unstamped") n.answerBy = (as === "pat" ? PAT : SARAH) as never;
          return n;
        });
        const res = await putStoredReport(h, revalidate(b, forged), as, rev);
        const label = `${key} ${JSON.stringify(value)} ${who}`;
        rows.push(`${label}: ${shown(res)}`);
        assert.ok(res.status === 403 || res.status === 422, `${label}: ${shown(res)}`);
        assert.deepEqual(box(await storedCopy(h, r.id), key).answer, box(r, key).answer, `${label}: the stored answer is kept`);
      }
    }
  }
  console.log(`# ${rows.join("\n# ")}`);
});

test("R2-TPN-01 residual: the final check's shapes – F-02 date of birth and drafted F-07 set to [] with no stamp – are refused (403), and on a create too", async () => {
  const { b, r } = await dischargeWithDraftedYesNo();
  for (const key of ["F-02", "F-07"]) {
    const h = await clinic(b);
    const rev = await seed(h, r);
    const res = await putStoredReport(h, revalidate(b, mapBox(r, key, (s) => ({ ...unstamped(s), answer: { kind: s.answer!.kind, value: [] } as FormAnswer }))), "pat", rev);
    assert.equal(res.status, 403, `${key}: ${shown(res)}`);
    assert.equal(res.code, "DECISION_NOT_ALLOWED");
  }
  const h = await clinic(b);
  const created = await putStoredReport(h, revalidate(b, mapBox(r, "F-02", (s) => ({ ...unstamped(s), answer: { kind: "date", value: [] } as FormAnswer }))), "sarah", null);
  assert.equal(created.status, 403, `create: ${shown(created)}`);
});

test("R2-TPN-01 residual: the clears are still the member's to make – null or \"\" with no stamp is stored, counts as unanswered (MISSING_PLACEHOLDER), and a stamped value can be set again", async () => {
  const { b, r } = await dischargeWithDraftedYesNo();
  for (const key of ["F-02", "F-07"]) {
    for (const clear of [null, ""]) {
      const h = await clinic(b);
      let rev = await seed(h, r);
      const cleared = revalidate(b, mapBox(r, key, (s) => ({ ...unstamped(s), answer: { kind: s.answer!.kind, value: clear } as FormAnswer })));
      const res = await putStoredReport(h, cleared, "pat", rev);
      assert.equal(res.status, 200, `${key} ${JSON.stringify(clear)}: ${shown(res)}`);
      rev = (res.body as { rev: number }).rev;
      const stored = (res.body as { report: Report }).report;
      const blocking = validateReport(stored, b.template, { computedFacts: b.computedFacts, form: b.form, voice: { owner: ownerOf(b) as never } }).blocking.filter((f) => f.sectionKey === key).map((f) => f.code);
      assert.ok(blocking.includes("MISSING_PLACEHOLDER"), `${key} ${JSON.stringify(clear)}: ${blocking.join(",")}`);
      // The review sets it again (setStructuredAnswer stamps it).
      const value = key === "F-02" ? "1985-05-14" : true;
      const set = setStructuredAnswer(stored, key, value, PAT);
      const res2 = await putStoredReport(h, revalidate(b, set), "pat", rev);
      assert.equal(res2.status, 200, `${key} set again: ${shown(res2)}`);
      assert.equal(box((res2.body as { report: Report }).report, key).answerBy?.name, "Pat Morgan");
    }
  }
});

test("R2-TPN-01 residual: a report that already holds an empty-ish value is read as the clear it prints – /sign never approves it as an answer: a required box is refused naming the box, an optional one is flagged as left blank, exactly as its null twin", async () => {
  const { b, r } = await dischargeWithDraftedYesNo();
  type SignBody = { flags?: Array<{ sectionKey?: string; code: string; severity: string }>; issues?: Array<{ path: string; message: string }> };
  const sign = async (value: unknown, key: string) => {
    const h = await clinic(b);
    // Held from before this fix: put straight into the clinic's store (postSign seeds it without the store's checks).
    const held = revalidate(b, mapBox(r, key, (s) => ({ ...unstamped(s), answer: { kind: s.answer!.kind, value } as unknown as FormAnswer })));
    return postSign(h, { report: held, template: b.template, form: b.form, signer: "sarah", mode: "tenant", fileBytes: b.fileBytes });
  };
  const rows: string[] = [];
  for (const [key, value, required] of [
    ["F-02", [], true],
    ["F-07", [], true],
    ["F-02", " ", true],
    ["F-07", [{ c: "x" }], true],
    ["F-04", [], false],
    ["F-21", [], false],
    ["F-04", [{ c: "x" }], false],
    ["F-21", "\t", false],
  ] as const) {
    const label = `${key} ${JSON.stringify(value)}`;
    const res = await sign(value, key);
    const twin = await sign(null, key);
    rows.push(`${label}: /sign ${shown(res)} (null twin ${shown(twin)})`);
    assert.equal(res.status, twin.status, `${label}: ${shown(res)}, its null twin ${shown(twin)}`);
    const body = res.body as SignBody;
    const missing = (body.flags ?? []).filter((f) => f.sectionKey === key && f.code === "MISSING_PLACEHOLDER");
    assert.ok(missing.length > 0, `${label}: the box is named as unanswered – ${JSON.stringify(body).slice(0, 300)}`);
    if (required) {
      assert.notEqual(res.status, 200, `${label}: approved`);
      assert.ok(missing.some((f) => f.severity === "blocking"), `${label}: blocking`);
    }
    // Never a refusal that names no box.
    if (res.code === "ISSUE_REFUSED") assert.ok((body.issues ?? []).length > 0, `${label}: ISSUE_REFUSED naming no box`);
  }
  console.log(`# ${rows.join("\n# ")}`);
});
