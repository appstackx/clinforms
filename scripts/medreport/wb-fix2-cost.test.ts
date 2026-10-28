/**
 * bh2 fix round 2 – WB (R2-SEC-1): the colleague-named check's cost. On the release candidate (ee34d1a) an
 * unauthenticated /validate body inside VALIDATION_BUDGET cost 15–40 s of CPU, because
 * - bestNoteSentence scored every drafted sentence against every sentence of every cited note (drafted × note
 *   sentences), and
 * - unnamedColleagues' share() re-read the cited record sources' content stems once per wanted stem (a paragraph citing
 *   a colleague's note and REG with a long referral reason: 15 s at 59 KB).
 * Now each note's sentences are indexed once by stem (attribution-stem-index.ts) and the record stems are read once.
 *
 * 1. The same answers: the earlier scans, kept here verbatim as the oracle, against the index on generated notes and
 *    queries (word endings, figures, final "e", history, ties, long index lists, several and repeated notes).
 * 2. The cost at the budget limits: anonymous demo session → POST /validate (and /sign) through the real handlers, with
 *    the reviewers' shapes and shapes aimed at the index (a word in every note sentence, long prefix families, many
 *    combinations of common words, 1,000 small paragraphs). Ceilings are generous (the suite runs in parallel on a
 *    loaded machine): the reviewers' shapes took under a second in all on the fix branch, the check itself under 0.5 s
 *    on every shape; ee34d1a took 15–40 s on the first and over 2 minutes on the others. The opinion check is timed
 *    too: it normalised each cited note once per drafted paragraph (2 s on 1,000 paragraphs; now once per note).
 * Fictional data only.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSessionToken } from "../../src/modules/medreport/auth/session-token";
import type { Note, Report } from "../../src/modules/medreport/core/types";
import { VALIDATION_BUDGET, validationBudgetExcess } from "../../src/modules/medreport/core/validation";
import { CaseInputSchema, type CaseInput } from "../../src/modules/medreport/core/validation/__corpus__/harness/types";
import { buildCase, type Built } from "../../src/modules/medreport/core/validation/__corpus__/harness/build";
import { bestNoteSentence } from "../../src/modules/medreport/core/validation/attribution-colleague-named";
import { StemSet, shareIn } from "../../src/modules/medreport/core/validation/attribution-stem-index";
import { contentStems, noteSentences, plainStemsOf, stemsMatch, type NoteSentence } from "../../src/modules/medreport/core/validation/attribution-text";
import { bindHandler, type MedreportHandler } from "../../src/modules/medreport/api/http";
import type { MedreportDeps } from "../../src/modules/medreport/api/deps";
import { handleSign } from "../../src/modules/medreport/api/handlers/sign";
import { handleValidate } from "../../src/modules/medreport/api/handlers/validate";
import { VALIDATORS } from "../../src/modules/medreport/core/validation/registry";

process.env.MEDREPORT_AI_MODE = "demo";

/** The time each of WB's checks named here took in the last request (the registry's entries, wrapped – this process only). */
const TIMED = ["attribution-colleague-named", "opinion-language"] as const;
const checkMs: Record<string, number> = {};
for (const name of TIMED) {
  const entry = VALIDATORS.find((v) => v.name === name) as { run: (typeof VALIDATORS)[number]["run"] } | undefined;
  assert.ok(entry, `${name} is registered`);
  const run = entry.run;
  entry.run = (input) => {
    const t = performance.now();
    try {
      return run(input);
    } finally {
      checkMs[name] = (checkMs[name] ?? 0) + performance.now() - t;
    }
  };
}
const resetChecks = () => TIMED.forEach((n) => (checkMs[n] = 0));
const assertChecksCheap = (label: string) => {
  for (const n of TIMED) assert.ok(checkMs[n] < 2_500, `${label}: ${n} took ${Math.round(checkMs[n])} ms`);
};

/* ------------------------------------------------------------------------------------------------
 * The oracle: ee34d1a's scans, verbatim
 * ----------------------------------------------------------------------------------------------*/

function oracleBest(stems: readonly string[], notes: readonly Note[]): { sentence: NoteSentence; share: number } | null {
  if (stems.length === 0) return null;
  let best: { sentence: NoteSentence; share: number } | null = null;
  const rank = (f: NoteSentence["field"]) => (f === "plan" ? 0 : f === "subjective" ? 1 : f === "other" ? 2 : 3);
  for (const note of notes) {
    for (const s of noteSentences(note)) {
      if (s.field === "history") continue;
      const have = plainStemsOf(s);
      const share = stems.filter((w) => have.some((h) => stemsMatch(w, h))).length / stems.length;
      if (!best || share > best.share || (share === best.share && rank(s.field) < rank(best.sentence.field))) best = { sentence: s, share };
    }
  }
  return best;
}

const oracleShare = (want: readonly string[], text: string) => (want.length ? want.filter((w) => contentStems(text, { people: [] }, { canonical: false }).some((h) => stemsMatch(w, h))).length / want.length : 0);

/** A small deterministic generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Words with shared endings and prefixes (stemsMatch's rules), final "e" pairs, figures and short words. */
const VOCAB = [
  "knee", "knees", "kneel", "mobilise", "mobilised", "mobilisation", "mobilisations", "mobility", "stiff", "stiffness", "stiffer",
  "lumbar", "lumbosacral", "flexion", "flexed", "extension", "extend", "rotation", "rotate", "tender", "tenderness", "swelling", "swollen",
  "pain", "painful", "free", "full", "range", "ranges", "give", "gives", "wake", "wakes", "home", "programme", "exercise", "exercises",
  "core", "stability", "stable", "hip", "arm", "leg", "10", "20", "30", "100", "2026", "45°", "7/10", "grade", "graded", "walk", "walking",
  "return", "returned", "duties", "duty", "work", "worked", "advice", "advised", "plan", "treatment", "treated",
];

function phrase(r: () => number, n: number): string {
  return Array.from({ length: n }, () => VOCAB[Math.floor(r() * VOCAB.length)]).join(" ");
}

function note(id: string, r: () => number, sentences: number): Note {
  const field = () => Array.from({ length: Math.max(1, Math.floor(sentences / 5)) }, () => `${phrase(r, 2 + Math.floor(r() * 6))}.`).join(" ");
  return {
    id,
    date: "2026-05-06",
    type: "follow_up",
    author: { name: "Tom Ellis", hcpc: "PH-DEMO-02", role: "Physiotherapist" },
    subjective: field(),
    objective: field(),
    assessment: field(),
    plan: field(),
    freeText: r() < 0.5 ? field() : undefined,
    pastMedicalHistory: r() < 0.5 ? field() : undefined,
  } as unknown as Note;
}

describe("R2-SEC-1: the indexed colleague-named lookups give the earlier answers", () => {
  it("bestNoteSentence: the same sentence and share as the scan (ties, history, figures, word endings, long lists, repeated notes)", () => {
    const r = rng(20261027);
    let compared = 0;
    for (let round = 0; round < 60; round++) {
      const notes = Array.from({ length: 1 + Math.floor(r() * 3) }, (_, i) => note(`N-${String(round * 10 + i).padStart(3, "0")}`, r, round % 6 === 0 ? 400 : 10 + Math.floor(r() * 60)));
      // A note cited twice, now and then (the scan reads it twice; a second reading never wins a tie).
      const cited = r() < 0.2 ? [...notes, notes[0]] : notes;
      for (let q = 0; q < 60; q++) {
        const stems = contentStems(phrase(r, 1 + Math.floor(r() * 8)).toLowerCase(), { people: [] }, { canonical: false });
        const want = oracleBest(stems, cited);
        const got = bestNoteSentence(stems, cited);
        compared += 1;
        if (want === null || got === null) {
          assert.equal(got, want);
          continue;
        }
        assert.equal(got.share, want.share, `share for ${stems.join(" ")}`);
        assert.equal(got.sentence, want.sentence, `sentence for ${stems.join(" ")}`);
      }
    }
    assert.ok(compared >= 3_000);
  });

  it("record share: the same as re-reading the record text per stem", () => {
    const r = rng(7);
    for (let i = 0; i < 300; i++) {
      const text = `${phrase(r, 5 + Math.floor(r() * 40))}. Referral reason: ${phrase(r, Math.floor(r() * 20))}.`.toLowerCase();
      const set = new StemSet(contentStems(text, { people: [] }, { canonical: false }));
      const want = contentStems(phrase(r, 1 + Math.floor(r() * 10)).toLowerCase(), { people: [] }, { canonical: false });
      assert.equal(shareIn(want, set), oracleShare(want, text), `${want.join(" ")} in ${text}`);
    }
  });

  it("an empty query, a note with only history and no notes give what the scan gave", () => {
    const histOnly = { id: "N-900", date: "2026-05-06", type: "follow_up", author: { name: "Tom Ellis" }, pastMedicalHistory: "Knee pain in 2019." } as unknown as Note;
    assert.equal(bestNoteSentence([], [histOnly]), null);
    assert.equal(bestNoteSentence(["knee"], [histOnly]), oracleBest(["knee"], [histOnly]));
    assert.equal(bestNoteSentence(["knee"], []), null);
    const r = rng(3);
    const n = note("N-901", r, 30);
    const none = bestNoteSentence(["zzzzqqq"], [n]);
    const was = oracleBest(["zzzzqqq"], [n]);
    assert.equal(none?.share, 0);
    assert.equal(none?.sentence, was?.sentence);
  });
});

/* ------------------------------------------------------------------------------------------------
 * The cost at the budget limits
 * ----------------------------------------------------------------------------------------------*/

async function demoCase(): Promise<Built> {
  return buildCase(
    CaseInputSchema.parse({ report: "form:cf-discharge", signMode: "demo", box: "F-32", paragraph: { text: "Lumbar movement full and pain-free at discharge.", cites: ["N-002"] } }) as CaseInput,
  );
}

async function post(handler: MedreportHandler, url: string, body: unknown): Promise<{ status: number; ms: number; flags: number }> {
  const req = new Request(`http://localhost/api/reports/v1${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${createSessionToken({ tenantId: "demo", kind: "demo" }).token}` },
    body: JSON.stringify(body),
  });
  const started = performance.now();
  const res = await bindHandler(handler, () => ({}) as MedreportDeps)(req, { params: {} });
  const json = (await res.json()) as { flags?: unknown[] };
  return { status: res.status, ms: Math.round(performance.now() - started), flags: json.flags?.length ?? 0 };
}

type Para = Report["sections"][number]["paragraphs"][number];
const para = (id: string, text: string, sourceIds: string[]): Para => ({ id, text, sourceIds, origin: "ai" }) as Para;

/** Joins generated sentences up to `chars` characters. */
function fill(chars: number, sentence: (i: number) => string, from = 0): string {
  const parts: string[] = [];
  let len = 0;
  for (let i = from; len < chars; i++) {
    const s = sentence(i);
    parts.push(s);
    len += s.length + 1;
  }
  return parts.join(" ").slice(0, chars);
}

/** A body: N-002 (Tom Ellis) with `noteFields`, `paragraphs` spread over the narrative boxes, optional referral reason. */
function shape(b: Built, opts: { noteFields: Partial<Record<"subjective" | "objective" | "assessment" | "plan", string>>; paragraphs: Para[]; reason?: string; oneBox?: boolean }) {
  const bundle = b.report.bundleSnapshot;
  const notes = bundle.notes.map((n) => (n.id === "N-002" ? { ...n, ...opts.noteFields } : n));
  const boxes = opts.oneBox ? ["F-32"] : b.report.sections.filter((s) => s.kind === "ai_narrative").map((s) => s.key);
  const byBox = new Map<string, Para[]>();
  opts.paragraphs.forEach((p, i) => {
    const key = boxes[i % boxes.length];
    byBox.set(key, [...(byBox.get(key) ?? []), p]);
  });
  const report = {
    ...b.report,
    bundleSnapshot: { ...bundle, notes, referral: opts.reason ? { ...bundle.referral, reason: opts.reason } : bundle.referral },
    sections: b.report.sections.map((s) => (byBox.has(s.key) ? { ...s, paragraphs: byBox.get(s.key)! } : s)),
  } as Report;
  return { report, form: b.form };
}

const NOTE = VALIDATION_BUDGET.noteChars - 2_000;
const PER = VALIDATION_BUDGET.paragraphChars - 100;
const TEXT = VALIDATION_BUDGET.textChars - 1_000;
const many = (total: number, per: number, make: (j: number) => Para): Para[] => Array.from({ length: Math.ceil(total / per) }, (_, j) => make(j));

const W = ["knee", "hip", "ankle", "wrist", "elbow", "spine", "neck", "calf", "thigh", "groin", "heel", "shin", "back", "arm", "foot", "hand"];
const A = ["sore", "stiff", "tender", "swollen", "weak", "tight", "warm", "numb"];
const short = (i: number) => `${W[i % W.length]} ${A[(i >> 4) % A.length]} ${i}.`;
const REGION = ["lumbar", "cervical", "thoracic", "shoulder", "knee", "hip", "ankle", "wrist", "elbow", "calf", "hamstring", "quadriceps"];
const FIND = ["flexion limited", "extension painful", "rotation restricted", "tenderness on palpation", "muscle spasm noted", "strength reduced", "swelling present", "range improving"];
const clinical = (i: number) => `${REGION[i % 12]} ${FIND[Math.floor(i / 12) % 8]} on the ${["left", "right", "bilateral"][Math.floor(i / 96) % 3]} at ${(i % 90) + 10} degrees, visit ${i}.`;
const L = "bcdfghjklmnpqrstvwxz";
const word = (i: number, pre: string) => {
  let s = pre;
  let n = i;
  do {
    s += L[n % 20];
    n = Math.floor(n / 20);
  } while (n > 0);
  return `${s}o`;
};
const COMMON = ["lumbar", "flexion", "tender", "spasm", "stiffness", "rotation", "swelling", "strength", "posture", "gait", "balance", "reflexes"];

const SHAPES: Record<string, (b: Built) => ReturnType<typeof shape>> = {
  // The reviewer's b90-298: one box, short finding lines on both sides (17k note sentences).
  "short findings, one box": (b) => shape(b, { oneBox: true, noteFields: { objective: fill(NOTE, short) }, paragraphs: many(TEXT, PER, (j) => para(`a${j}`, fill(PER, short, 100_000 + j * 5_000), ["N-002"])) }),
  // Vote 2's clinical shape: colleague findings spread over the narrative boxes.
  "clinical findings, every box": (b) =>
    shape(b, { noteFields: { objective: fill(NOTE / 2, clinical), assessment: fill(NOTE / 2, clinical, 7) }, paragraphs: many(TEXT, PER, (j) => para(`v${j}`, fill(PER, clinical, 3 + j * 211), ["N-002"])) }),
  // Vote 2's adversarial shape: comma segments the note never holds (every segment looked up).
  "segments the note never holds": (b) =>
    shape(b, {
      noteFields: { objective: fill(NOTE / 2, (i) => `${word(3 * i, "ku")} ${word(3 * i + 1, "ku")} ${word(3 * i + 2, "ku")}.`), assessment: fill(NOTE / 2, (i) => `${word(900_000 + i, "ku")} ${word(900_001 + i, "ku")}.`) },
      paragraphs: many(TEXT, PER, (j) => para(`x${j}`, fill(PER, (i) => [0, 1, 2, 3].map((k) => `${word(12 * i + 3 * k, "va")} ${word(12 * i + 3 * k + 1, "va")} ${word(12 * i + 3 * k + 2, "va")}`).join(", ") + ".", j * 50_000), ["N-002"])),
    }),
  // Vote 1's REG shape, the referral reason far longer (15 s at 20k on ee34d1a): every paragraph cites N-002 and REG.
  "colleague note and a long referral reason": (b) =>
    shape(b, {
      oneBox: true,
      noteFields: { objective: fill(2_000, short) },
      reason: fill(400_000, (i) => `word${i}`),
      paragraphs: many(TEXT, PER, (j) => para(`r${j}`, fill(PER, short, 100_000 + j * 5_000), ["N-002", "REG"])),
    }),
  // Aimed at the index: one word in every note sentence, each with its own figure; drafted sentences use that word,
  // figures the note holds and endings of it ("lumbarq7"), in 1,000 small paragraphs.
  "a word in every note sentence, 1,000 paragraphs": (b) =>
    shape(b, {
      noteFields: { objective: fill(NOTE / 2, (i) => `Lumbar ${i}.`), assessment: fill(NOTE / 2, (i) => `Lumbar lumbarx ${i + 40_000}.`) },
      paragraphs: Array.from({ length: VALIDATION_BUDGET.paragraphs - 10 }, (_, j) => para(`w${j}`, fill(Math.floor(TEXT / VALIDATION_BUDGET.paragraphs), (i) => `Lumbar ${j * 7 + i} lumbar${word(j * 9 + i, "q")}.`), ["N-002"])),
    }),
  // The same referral cited by 1,000 small paragraphs: normalised and stemmed once per validation, not per paragraph.
  "a long referral reason cited by 1,000 paragraphs": (b) =>
    shape(b, {
      noteFields: { objective: fill(2_000, short) },
      reason: fill(400_000, (i) => `word${i}`),
      paragraphs: Array.from({ length: VALIDATION_BUDGET.paragraphs - 10 }, (_, j) => para(`g${j}`, fill(Math.floor(TEXT / VALIDATION_BUDGET.paragraphs), short, j * 13), ["N-002", "REG"])),
    }),
  // Aimed at the index: twelve common words in every note sentence; drafted sentences pick different combinations.
  "combinations of common words": (b) =>
    shape(b, {
      noteFields: { objective: fill(NOTE, (i) => `${COMMON.join(" ")} ${i}.`) },
      paragraphs: many(TEXT, PER, (j) =>
        para(`c${j}`, fill(PER, (i) => `${COMMON.filter((_, k) => ((i * 2_654_435_761 + j) >>> k) & 1).join(" ") || "gait"} ${i * 3}.`), ["N-002"]),
      ),
    }),
};

/**
 * Shapes whose other validators dominate the total – citations on a 400,000-character referral reason (about 3 s on
 * production too), draft-fit and citations on 1,000 paragraphs – so only WB's checks are timed.
 */
const CHECK_ONLY = new Set(["colleague note and a long referral reason", "a word in every note sentence, 1,000 paragraphs", "a long referral reason cited by 1,000 paragraphs"]);

describe("R2-SEC-1: /validate inside VALIDATION_BUDGET stays cheap for a signed-out visitor", () => {
  for (const [name, make] of Object.entries(SHAPES)) {
    it(`${name}: inside the budget, answered 200, the colleague-named and opinion checks well under their old cost`, async () => {
      const body = make(await demoCase());
      assert.equal(validationBudgetExcess(body.report, body.form), null, "the body is inside the budget");
      resetChecks();
      const res = await post(handleValidate, "/validate", body);
      assert.equal(res.status, 200);
      // ee34d1a: 15–40 s on the reviewers' shapes, over 2 minutes on the others; the fix branch: well under 0.5 s alone.
      assertChecksCheap(name);
      if (!CHECK_ONLY.has(name)) assert.ok(res.ms < 6_000, `${name}: ${res.ms} ms`);
    });
  }

  it("/sign runs the same validators inside the same budget: cheap too", async () => {
    const b = await demoCase();
    const body = SHAPES["clinical findings, every box"](b);
    const sign = { signer: { name: "Sarah Reid", hcpc: "PH-DEMO-01" }, typedSignature: "Sarah Reid", statementAccepted: true, attestations: [...b.template.attestations], form: b.form, report: body.report };
    resetChecks();
    const res = await post(handleSign, "/sign", sign);
    assert.notEqual(res.status, 413);
    assert.ok(checkMs["attribution-colleague-named"] > 0, "/sign ran the check");
    assertChecksCheap("/sign");
    assert.ok(res.ms < 6_000, `/sign: ${res.ms} ms`);
  });
});
