/**
 * bh2 fix round 1 – WC: the cost of the provenance checks (R1T-WC-01 SAF-1, R1T-WC-02 SEC-2). Each was quadratic on the
 * release candidate (e89f93f) and linear on production; each is bounded here, on fictional data only.
 *
 * - R1T-WC-01: the drafted-residue window (core/provenance.ts residueWindow) is one linear pass per drafted sentence the
 *   text could reproduce at all; a long drafted "sentence" counts as runs; the work per paragraph is capped (the strict
 *   reading beyond it); a paragraph's residue is worked out once however many flags ask for it; the store ties every new
 *   tombstone to a drafted paragraph the change deletes, and the schema caps its text.
 * - R1T-WC-02: the store's PUT checks index the stored boxes and paragraphs once per save; the "Split it out" check is
 *   bounded before any sentence is split.
 * Timings are generous ceilings (the suite runs in parallel on a loaded machine): the quadratic versions took 15–30 s at
 * these sizes.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { HARROW_PIKE_FORM as RAW } from "../../src/modules/medreport/forms/samples/maps/harrow-pike";
import { createMemoryTenantStore } from "../../src/modules/medreport/api/store-memory";
import { storeApiPaths } from "../../src/modules/medreport/api/store-contract";
import { DRAFT_TOMBSTONE_MAX_CHARS, ReportSchema } from "../../src/modules/medreport/core/schemas";
import {
  RESIDUE_THRESHOLD,
  RESIDUE_WINDOW_GROWTH,
  SHORT_SENTENCE_TOKENS,
  paragraphResidue,
  residueSpans,
} from "../../src/modules/medreport/core/provenance";
import { splitSentences } from "../../src/modules/medreport/core/text/sentences";
import { ackPolicyOf } from "../../src/modules/medreport/core/validation/acknowledge";
import { tombstonePieces } from "../../src/modules/medreport/ui/components/review/reducer";
import type { Paragraph, Report, ReportFlag, ReportSection } from "../../src/modules/medreport/core/types";
import { completedSampleReport } from "./form-sample-answers";
import { member, storeDeps, storeFetch } from "./store-harness";
import { asApproversReport, signingMember, stampOf, storeClinicForm, withMapHash } from "./release-store-fixture";

const A = "clinic-wc-cost";

/* ------------------------------------------------------------------------------------------------
 * The earlier residue search (e89f93f), kept here as the oracle: every window length from m to 1.5 m, best position.
 * ----------------------------------------------------------------------------------------------*/

interface Tok {
  t: string;
  start: number;
  end: number;
}
function toks(text: string): Tok[] {
  const out: Tok[] = [];
  const re = /[A-Za-z0-9À-ɏ]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ t: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });
  return out;
}
function oldWindow(all: readonly Tok[], dt: readonly string[]): { start: number; end: number } | null {
  const m = dt.length;
  const want = new Map<string, number>();
  for (const t of dt) want.set(t, (want.get(t) ?? 0) + 1);
  const minLen = Math.min(m, all.length);
  const maxLen = Math.min(all.length, Math.max(minLen, Math.ceil(m * RESIDUE_WINDOW_GROWTH)));
  for (let len = minLen; len <= maxLen; len++) {
    const have = new Map<string, number>();
    let overlap = 0;
    let best = -1;
    let bestAt = -1;
    for (let i = 0; i < all.length; i++) {
      const t = all[i].t;
      const c = have.get(t) ?? 0;
      if (c < (want.get(t) ?? 0)) overlap += 1;
      have.set(t, c + 1);
      if (i >= len) {
        const o = all[i - len].t;
        const left = (have.get(o) ?? 0) - 1;
        have.set(o, left);
        if (left < (want.get(o) ?? 0)) overlap -= 1;
      }
      if (i >= len - 1 && overlap > best) {
        best = overlap;
        bestAt = i - len + 1;
      }
    }
    if (bestAt < 0 || best / m < RESIDUE_THRESHOLD) continue;
    let start = bestAt;
    let end = bestAt + len - 1;
    while (start < end && !want.has(all[start].t)) start += 1;
    while (end > start && !want.has(all[end].t)) end -= 1;
    return { start, end };
  }
  return null;
}
function oldResidueSpans(text: string, drafted: readonly string[]): Array<{ start: number; end: number }> {
  const all = toks(text);
  if (all.length === 0 || drafted.length === 0) return [];
  const spans: Array<{ start: number; end: number }> = [];
  const sentences = splitSentences(text, "prose");
  for (const d of drafted) {
    const dt = toks(d).map((x) => x.t);
    if (dt.length === 0) continue;
    if (dt.length < SHORT_SENTENCE_TOKENS) {
      const key = dt.join(" ");
      for (const s of sentences) if (toks(s.text).map((x) => x.t).join(" ") === key) spans.push({ start: s.start, end: s.end });
      continue;
    }
    const w = oldWindow(all, dt);
    if (w) spans.push({ start: all[w.start].start, end: all[w.end].end });
  }
  spans.sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }
  return merged;
}

/** A small deterministic generator (no Math.random: the same cases every run). */
function rng(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 0x100000000;
  };
}

test("R1T-WC-01: the linear residue window finds exactly what the earlier search found (2,000 seeded texts, sentences up to 60 words)", () => {
  const words = ["he", "is", "expected", "to", "make", "a", "full", "recovery", "within", "six", "weeks", "of", "the", "accident", "pain", "eased", "with", "exercise", "lifting", "work", "not", "fit", "for"];
  const r = rng(26);
  const pick = () => words[Math.floor(r() * words.length)];
  const sentence = (n: number) => `${Array.from({ length: n }, pick).join(" ")}.`;
  let differ = 0;
  for (let i = 0; i < 2000; i++) {
    const drafted = Array.from({ length: 1 + Math.floor(r() * 3) }, () => sentence(2 + Math.floor(r() * 30)));
    // The person's text: drafted sentences kept, changed by a word, with clauses inserted, and their own sentences.
    const parts: string[] = [];
    for (let k = 0; k < 1 + Math.floor(r() * 4); k++) {
      const roll = r();
      if (roll < 0.35) parts.push(drafted[Math.floor(r() * drafted.length)]);
      else if (roll < 0.6) parts.push(drafted[Math.floor(r() * drafted.length)].replace(/\b\w+\b/, pick()));
      else parts.push(sentence(1 + Math.floor(r() * 25)));
    }
    const text = parts.join(" ");
    if (JSON.stringify(residueSpans(text, drafted)) !== JSON.stringify(oldResidueSpans(text, drafted))) differ += 1;
  }
  assert.equal(differ, 0, `${differ} of 2,000 texts read differently`);
});

test("R1T-WC-01 (SAF-1): a deleted paragraph thousands of words long, or thousands of drafted sentences, is read in bounded time", () => {
  for (const n of [1500, 6000, 12000]) {
    const tomb = Array.from({ length: n }, (_, i) => `lift${i % 997}`).join(" ");
    const person = `He will make a full recovery. ${Array.from({ length: 2 * n }, (_, i) => `gym${i % 991}`).join(" ")}.`;
    let t0 = Date.now();
    residueSpans(person, [tomb]);
    assert.ok(Date.now() - t0 < 1500, `unrelated ${n}-word tombstone: ${Date.now() - t0} ms`);
    // The adversarial shape: the text holds every word of every drafted sentence (each passes the first check).
    const all = person.split(/\s+/);
    const many: string[] = [];
    for (let i = 0; i + 15 <= all.length && many.length < 3000; i += 7) many.push(`${all.slice(i, i + 15).join(" ")}.`);
    t0 = Date.now();
    const spans = residueSpans(person, many);
    assert.ok(Date.now() - t0 < 2500, `${many.length} matching drafted sentences: ${Date.now() - t0} ms`);
    assert.ok(spans.length > 0, "a text that reproduces drafted sentences keeps drafted strictness (or is drafted throughout)");
    t0 = Date.now();
    residueSpans(person, [all.join(" ")]);
    assert.ok(Date.now() - t0 < 1500, `the whole text as one drafted "sentence": ${Date.now() - t0} ms`);
  }
});

test("R1T-WC-01: a long drafted sentence still keeps its drafted strictness (read as runs), and the work cap reads strictly", () => {
  const long = Array.from({ length: 150 }, (_, i) => ["he", "will", "make", "a", "full", "recovery", "soon"][i % 7] + (i % 13)).join(" ");
  const spans = residueSpans(`Seen today. ${long}. Plan agreed.`, [long]);
  assert.ok(spans.length > 0 && spans.some((s) => s.end - s.start > long.length / 2), "the kept drafted wording is residue");
});

test("R1T-WC-01: a paragraph's residue is worked out once for every opinion flag that asks (the acknowledgement policy)", () => {
  const n = 6000;
  const tomb = Array.from({ length: n }, (_, i) => `he${i % 97} will${i % 89} recover${i % 83}`).join(" ");
  const person = `He will make a full recovery. ${Array.from({ length: 2 * n }, (_, i) => `he${i % 97} will${i % 89}`).join(" ")}.`;
  const p: Paragraph = { id: "F-10-c1", text: person, sourceIds: ["N-001"], origin: "edited", originalText: "x" };
  const section = { key: "F-10", title: "Prognosis", kind: "ai_narrative", status: "drafted", paragraphs: [p], tombstones: [{ paragraphId: "t1", text: tomb.slice(0, DRAFT_TOMBSTONE_MAX_CHARS), sourceIds: ["N-001"], by: { memberId: "m", name: "M", role: "staff", canSign: false }, at: "2026-10-27T09:00:00.000Z" }] } as unknown as ReportSection;
  const report = { sections: [section] } as Pick<Report, "sections">;
  const flag = (i: number): ReportFlag => ({ id: `f${i}`, code: "OPINION_LANGUAGE", severity: "blocking", sectionKey: "F-10", paragraphId: "F-10-c1", message: "m", evidence: "full recovery" });
  let t0 = Date.now();
  ackPolicyOf(flag(0), report);
  const first = Date.now() - t0;
  t0 = Date.now();
  for (let i = 1; i <= 40; i++) ackPolicyOf(flag(i), report);
  const forty = Date.now() - t0;
  assert.ok(forty < Math.max(200, first * 2), `40 more flags on the same paragraph took ${forty} ms (the first ${first} ms)`);
  assert.deepEqual(paragraphResidue(section, p, { forAcknowledgement: true }), paragraphResidue(section, p, { forAcknowledgement: true }));
});

test("R1T-WC-01: the schema caps a tombstone's text; the review keeps a long drafted paragraph as consecutive pieces", () => {
  assert.ok(DRAFT_TOMBSTONE_MAX_CHARS >= 4000, "no drafted paragraph reaches the cap");
  const long = Array.from({ length: 3000 }, (_, i) => `Word${i}`).join(" ");
  const pieces = tombstonePieces(long);
  assert.ok(pieces.length > 1 && pieces.every((x) => x.length <= DRAFT_TOMBSTONE_MAX_CHARS));
  assert.equal(pieces.join(""), long, "together they are all of it, in order");
  assert.deepEqual(tombstonePieces("Short."), ["Short."]);
  const base = completedSampleReport("megan-hart", { ...RAW, tenantId: A }, { id: "rpt_cap" });
  const over = { ...base, sections: base.sections.map((s, i) => (i === 0 ? { ...s, tombstones: [{ paragraphId: "x", text: "a".repeat(DRAFT_TOMBSTONE_MAX_CHARS + 1), sourceIds: [], by: { memberId: "m", name: "M", role: "staff" as const, canSign: false }, at: base.updatedAt }] } : s)) };
  assert.equal(ReportSchema.safeParse(over).success, false, "an over-long tombstone is not a report this build accepts");
});

/* ------------------------------------------------------------------------------------------------
 * The store (R1T-WC-01 tombstones, R1T-WC-02 cost)
 * ----------------------------------------------------------------------------------------------*/

function clinic() {
  const store = createMemoryTenantStore();
  void storeClinicForm(store, A, { ...RAW, tenantId: A }); // R2-SAF-2: the clinic holds the map its reports are started from
  const sam = signingMember(A);
  const pat = member(A, { userId: "user-pat-cost", authSessionId: "sess-pat-cost", role: "staff", name: "Pat Morgan (fictional)" });
  const deps = storeDeps(store, { sam, pat });
  const put = (who: "sam" | "pat", report: Report, rev: string | null) =>
    storeFetch(deps, { member: who })(storeApiPaths.report(report.id), { method: "PUT", headers: { "content-type": "application/json", ...(rev ? { "if-match": rev } : {}) }, body: JSON.stringify({ report }) });
  return { store, sam, pat, put };
}

function sample(id: string): Report {
  return withMapHash(asApproversReport({ ...completedSampleReport("megan-hart", { ...RAW, tenantId: A }, { id }), tenantId: A }, signingMember(A)), { ...RAW, tenantId: A });
}

test("R1T-WC-02 (SEC-2): an update of 20,000 paragraphs in one box is checked in linear time", async () => {
  // Ten times the paragraphs costs about ten times as much (linear) – the quadratic check cost about a hundred times as
  // much (2–5 s at 20,000). The best of two runs at each size, so a busy machine does not decide it.
  const updateMs = async (n: number): Promise<number> => {
    let best = Infinity;
    for (let run = 0; run < 2; run++) {
      const c = clinic();
      const base = sample(`rpt_cost_paragraphs_${n}_${run}`);
      const s0 = base.sections.findIndex((s) => s.kind === "ai_narrative");
      const paragraphs = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, text: "x", sourceIds: ["N-001"], origin: "ai" as const }));
      const report = { ...base, sections: base.sections.map((s, i) => (i === s0 ? { ...s, paragraphs } : s)) };
      const created = await c.put("sam", report, null);
      assert.equal(created.status, 201, await created.clone().text());
      const t0 = Date.now();
      const updated = await c.put("sam", { ...report, patientLabel: "Megan Hart (edited)" }, created.headers.get("etag"));
      best = Math.min(best, Date.now() - t0);
      assert.equal(updated.status, 200);
    }
    return best;
  };
  const small = await updateMs(2000);
  const large = await updateMs(20000);
  assert.ok(large < 6000, `20,000 paragraphs: ${large} ms`);
  assert.ok(large < Math.max(25 * small, 400), `10× the paragraphs cost ${(large / Math.max(small, 1)).toFixed(1)}× (${small} → ${large} ms): not linear`);
});

test("R1T-WC-02 (SEC-2): a 'split it out' paragraph of hundreds of kilobytes is refused before any sentence of it is read", async () => {
  const c = clinic();
  const base = sample("rpt_cost_split");
  const idx = base.sections.findIndex((s) => s.kind === "ai_narrative");
  const by = stampOf(c.pat);
  const parent: Paragraph = { id: "pp", text: "She was hurt.", sourceIds: ["N-001"], origin: "edited", by };
  const r1 = { ...base, sections: base.sections.map((s, i) => (i === idx ? { ...s, paragraphs: [parent] } : s)) };
  const created = await c.put("sam", { ...r1, sections: r1.sections.map((s, i) => (i === idx ? { ...s, paragraphs: [] } : s)) }, null);
  assert.equal(created.status, 201, await created.clone().text());
  const withParent = await c.put("pat", r1, created.headers.get("etag"));
  assert.equal(withParent.status, 200, await withParent.clone().text());
  const T = Array.from({ length: 32000 }, (_, i) => `Pain ${i % 10} noted.`).join(" ");
  const r2 = { ...r1, sections: r1.sections.map((s, i) => (i === idx ? { ...s, paragraphs: [parent, { id: "pp-d1", text: T, originalText: T, sourceIds: ["N-001"], origin: "ai" as const }] } : s)) };
  const t0 = Date.now();
  const res = await c.put("pat", r2, withParent.headers.get("etag"));
  const ms = Date.now() - t0;
  assert.equal(res.status, 403);
  assert.ok(ms < 1500, `${Math.round(T.length / 1024)} KB split-out refused in ${ms} ms (quadratic: 10–26 s)`);
});

test("R1T-WC-01: the store accepts a tombstone only for a drafted paragraph the change deletes, stamped by the member", async () => {
  const c = clinic();
  const base = sample("rpt_cost_tomb");
  const idx = base.sections.findIndex((s) => s.kind === "ai_narrative" && s.paragraphs.some((p) => p.origin === "ai"));
  const created = await c.put("sam", base, null);
  assert.equal(created.status, 201, await created.clone().text());
  const rev = created.headers.get("etag");
  const box = base.sections[idx];
  const gone = box.paragraphs.find((p) => p.origin === "ai")!;
  const patBy = stampOf(c.pat);
  const at = base.updatedAt;
  const withTomb = (paragraphs: Paragraph[], tombstones: NonNullable<ReportSection["tombstones"]>) => ({ ...base, sections: base.sections.map((s, i) => (i === idx ? { ...s, paragraphs, tombstones } : s)) });
  const rest = box.paragraphs.filter((p) => p.id !== gone.id);
  // Untied: kept text no deleted paragraph had, a paragraph still there, someone else's stamp, a forged id.
  assert.equal((await c.put("pat", withTomb(rest, [{ paragraphId: gone.id, text: "Words no draft wrote here at all.", sourceIds: gone.sourceIds, by: patBy, at }]), rev)).status, 403);
  assert.equal((await c.put("pat", withTomb(box.paragraphs, [{ paragraphId: gone.id, text: gone.text, sourceIds: gone.sourceIds, by: patBy, at }]), rev)).status, 403, "the paragraph was not deleted");
  assert.equal((await c.put("pat", withTomb(rest, [{ paragraphId: gone.id, text: gone.text, sourceIds: gone.sourceIds, by: stampOf(c.sam), at }]), rev)).status, 403, "stamped as someone else");
  assert.equal((await c.put("pat", withTomb(rest, [{ paragraphId: "never-there", text: gone.text, sourceIds: gone.sourceIds, by: patBy, at }]), rev)).status, 403);
  // Tied: the review's own delete.
  const ok = await c.put("pat", withTomb(rest, tombstonePieces(gone.originalText ?? gone.text).map((text) => ({ paragraphId: gone.id, text, sourceIds: gone.sourceIds, by: patBy, at }))), rev);
  assert.equal(ok.status, 200, await ok.clone().text());
});
