/**
 * bh2 fix round 2 – WC: the store's own checks (api/handlers/store-reports.ts), the four round-2 HIGH findings, each
 * reproduced through the real store PUT (and /sign) handlers on the corpus's fictional clinic (Sarah Reid approves, Tom
 * Ellis may sign, Pat Morgan is staff). Fictional data only.
 *
 * - R2-SEC-2 (= R2-REG-1): claimed one-click fixes cost at most two validator runs within the validators' budget, after
 *   the cheap checks – 20 forged rewrites on a report at the record cap are refused in under a second;
 * - R2-SAF-1: a stored box is never put back to "pending"; only an empty box the factory left waiting is redrafted;
 * - R2-SAF-2: a create the store cannot check against the clinic's map (or the built-in template's version) is refused;
 * - R2-TPN-01: an answer set, replaced or un-stamped with no member's stamp is refused in every box (a redraft of an
 *   empty waiting box aside).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { FormDefinition, Paragraph, Report, ReportSection } from "../../src/modules/medreport/core/types";
import { validateReport } from "../../src/modules/medreport/core/validation";
import { STORE_MAX_RECORD_BYTES } from "../../src/modules/medreport/api/store-contract";
import { applyDraftResult } from "../../src/modules/medreport/core/report-factory";
import { buildCase, ownerOf, type Built } from "../../src/modules/medreport/core/validation/__corpus__/harness/build";
import { CORPUS_TENANT, actorOf } from "../../src/modules/medreport/core/validation/__corpus__/harness/fixtures";
import { createHttpHarness, postSign, putStoredReport, type HttpHarness } from "../../src/modules/medreport/core/validation/__corpus__/harness/http";
import { CaseInputSchema } from "../../src/modules/medreport/core/validation/__corpus__/harness/types";
import { ENGINE_FIX_KINDS, applyFixProposal, offeredFixes } from "../../src/modules/medreport/ui/components/review/fixes";
import { reviewReducer } from "../../src/modules/medreport/ui/components/review/use-review-state";
import { createAmendedVersion } from "../../src/modules/medreport/ui/components/review/review-model";

const SARAH = actorOf("sarah");
const PAT = actorOf("pat");

const DOSE_NOTE = [{ id: "N-001", author: "sarah", date: "2026-03-18", type: "initial_assessment", subjective: "Lifting injury at work on 12/03/2026. Taking ibuprofen.", objective: "No red flags." }];

async function formCase(input: Record<string, unknown> = {}, report = "form:cf-discharge"): Promise<Built & { v: Report }> {
  const b = await buildCase(CaseInputSchema.parse({ report, ...input }));
  return { ...b, v: revalidate(b, b.report) };
}
function revalidate(b: Built, r: Report): Report {
  return { ...r, flags: validateReport(r, b.template, { computedFacts: b.computedFacts, form: b.form, voice: { owner: ownerOf(b) as never } }).flags };
}
const box = (r: Report, key: string) => r.sections.find((s) => s.key === key) as ReportSection;
const mapBox = (r: Report, key: string, fn: (s: ReportSection) => ReportSection): Report => ({ ...r, sections: r.sections.map((s) => (s.key === key ? fn(s) : s)) });
async function storeForm(h: HttpHarness, form: FormDefinition): Promise<void> {
  await h.store.createForm(CORPUS_TENANT, { id: form.id, status: form.status, title: form.title, referrer: form.referrer.name, kind: form.kind, fileSha256: form.file.sha256, sampleId: null, payload: form });
}
/** A harness whose clinic holds the case's form map (as the Studio keeps it). */
async function clinic(b: Built): Promise<HttpHarness> {
  const h = createHttpHarness();
  if (b.form) await storeForm(h, b.form);
  return h;
}
async function seed(h: HttpHarness, r: Report, as: "sarah" | "pat" | "tom" = "sarah"): Promise<number> {
  const res = await putStoredReport(h, r, as, null);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return (res.body as { rev: number }).rev;
}
const refusedAs = (res: { status: number; code: string | null }) => `${res.status} ${res.code ?? ""}`.trim();
const unstamped = (s: ReportSection): ReportSection => {
  const n = { ...s };
  delete n.answerBy;
  return n;
};

/* ------------------------------------------------------------------------------------------------
 * R2-SEC-2 (= R2-REG-1): the cost of claimed one-click fixes
 * ----------------------------------------------------------------------------------------------*/

/** Clinical-looking sentences, distinct, citing nobody by name (the own-note shape: R2-SEC-1's root not in play). */
const REGIONS = ["cervical", "thoracic", "lumbar", "shoulder", "hip", "knee"];
const MOVES = ["rotation", "extension", "flexion", "abduction"];
const sentence = (n: number) => `${REGIONS[n % 6]} ${MOVES[(n >> 3) % 4]} was ${(n % 70) + 15} degrees with pain ${n % 10} out of 10 on day ${n}.`;
function prose(chars: number, from: number): string {
  const out: string[] = [];
  let n = 0;
  for (let i = from; n < chars; i++) {
    const s = sentence(i);
    out.push(s);
    n += s.length + 1;
  }
  return out.join(" ").slice(0, chars);
}

/**
 * The stored drafted report: F-32 holds `paragraphs` drafted paragraphs of `chars` characters citing Sarah's own note,
 * her note holds `noteChars` more characters and the referral reason `padChars` (so the record reaches the cap).
 */
async function bigDrafted(paragraphs: number, chars: number, noteChars: number, padChars: number): Promise<{ b: Built; r: Report }> {
  const b = await buildCase(CaseInputSchema.parse({ report: "form:cf-discharge" }));
  const bundle = b.report.bundleSnapshot;
  const notes = bundle.notes.map((n) => (n.id === "N-001" ? { ...n, objective: `${n.objective} ${prose(noteChars, 0)}` } : n));
  const ps: Paragraph[] = Array.from({ length: paragraphs }, (_, i) => {
    const t = prose(chars, 100_000 + i * 5_000);
    return { id: `F-32-q${i}`, text: t, originalText: t, sourceIds: ["N-001"], origin: "ai" };
  });
  const r: Report = {
    ...b.report,
    bundleSnapshot: { ...bundle, notes, referral: { ...bundle.referral, reason: `${bundle.referral.reason ?? ""} ${"Referred for physiotherapy. ".repeat(Math.ceil(padChars / 28))}`.slice(0, padChars) } },
    sections: b.report.sections.map((s) => (s.key === "F-32" ? { ...s, status: "drafted", paragraphs: ps } : s)),
    flags: [],
  };
  return { b, r };
}

/** Every drafted paragraph of F-32 changed in place with one self-stamped "fix" (a known kind) the engine never offers. */
function forgedFixes(r: Report, kind = "value-only"): Report {
  return mapBox(r, "F-32", (s) => ({ ...s, paragraphs: s.paragraphs.map((p) => ({ ...p, text: `${p.text} Noted.`, fixes: [{ kind, by: PAT as never, at: r.updatedAt, edits: [{ start: p.text.length, end: p.text.length, text: " Noted." }] }] })) }));
}

async function timedPut(h: HttpHarness, r: Report, rev: number): Promise<{ status: number; code: string | null; ms: number }> {
  const t0 = performance.now();
  const res = await putStoredReport(h, r, "pat", rev);
  return { status: res.status, code: res.code, ms: performance.now() - t0 };
}

test("R2-SEC-2: 20 forged drafted rewrites on a report at the record cap are refused in under a second (over the validators' budget: 413 before any validator)", async () => {
  // 20 × 30,000 characters of drafted text (and its drafted wording): under the store's 1.4 MB record cap, over the
  // validators' budget.
  const { b, r } = await bigDrafted(20, 30_000, 20_000, 0);
  const bytes = Buffer.byteLength(JSON.stringify(r));
  assert.ok(bytes > 1_000_000 && bytes < STORE_MAX_RECORD_BYTES, `${bytes} bytes`);
  const h = await clinic(b);
  const rev = await seed(h, r);
  const res = await timedPut(h, forgedFixes(r), rev);
  assert.ok(res.status === 413 || res.status === 403, refusedAs(res));
  assert.equal(res.code, "PAYLOAD_TOO_LARGE", "the claimed fixes would be checked over the validators' budget");
  assert.ok(res.ms < 1_000, `${Math.round(res.ms)} ms`);
});

test("R2-SEC-2: 20 forged drafted rewrites on a report at the record cap inside the validators' budget: refused in under a second (the store's own bound on the notes, 413)", async () => {
  // Inside every limit of the validators' budget (paragraphs, text, notes, all characters) – the record itself at the cap.
  const { b, r } = await bigDrafted(20, 2_400, 280_000, 880_000);
  const bytes = Buffer.byteLength(JSON.stringify(r));
  assert.ok(bytes > 1_200_000 && bytes < STORE_MAX_RECORD_BYTES, `${bytes} bytes`);
  const { validationBudgetExcess } = await import("../../src/modules/medreport/core/validation");
  assert.equal(validationBudgetExcess(r, b.form), null, "inside the validators' budget");
  const h = await clinic(b);
  const rev = await seed(h, r);
  const res = await timedPut(h, forgedFixes(r), rev);
  assert.equal(res.status, 413, refusedAs(res));
  assert.ok(res.ms < 1_000, `${Math.round(res.ms)} ms`);
  // A kind no generator makes is refused before that (403, no validator).
  const unknown = await timedPut(h, forgedFixes(r, "remove-sentence"), rev);
  assert.equal(unknown.status, 403, refusedAs(unknown));
  assert.ok(unknown.ms < 1_000, `${Math.round(unknown.ms)} ms`);
});

test("R2-SEC-2: 20 forged drafted rewrites inside the store's bound (the most text, 95,000 characters of notes, a padded record) are refused in under a second", async () => {
  const { b, r } = await bigDrafted(20, 2_400, 95_000, 900_000);
  const bytes = Buffer.byteLength(JSON.stringify(r));
  assert.ok(bytes > 1_000_000 && bytes < STORE_MAX_RECORD_BYTES, `${bytes} bytes`);
  const h = await clinic(b);
  const rev = await seed(h, r);
  const res = await timedPut(h, forgedFixes(r), rev);
  assert.equal(res.status, 403, refusedAs(res));
  assert.ok(res.ms < 1_000, `${Math.round(res.ms)} ms`);
});

test("R2-SEC-2: a rewrite the cheap checks refuse never reaches the validators (no fixes entry, another member's stamp, an unknown kind, an edit that does not replay)", async () => {
  const { b, r } = await bigDrafted(20, 2_400, 280_000, 0);
  const h = await clinic(b);
  const rev = await seed(h, r);
  const noFix = mapBox(r, "F-32", (s) => ({ ...s, paragraphs: s.paragraphs.map((p) => ({ ...p, text: `${p.text} Noted.` })) }));
  const asSarah = mapBox(forgedFixes(r), "F-32", (s) => ({ ...s, paragraphs: s.paragraphs.map((p) => ({ ...p, fixes: p.fixes!.map((f) => ({ ...f, by: SARAH as never })) })) }));
  const notReplaying = mapBox(forgedFixes(r), "F-32", (s) => ({ ...s, paragraphs: s.paragraphs.map((p) => ({ ...p, fixes: p.fixes!.map((f) => ({ ...f, edits: [{ start: 0, end: 0, text: "X" }] })) })) }));
  for (const [label, body] of [["no fixes entry", noFix], ["stamped as someone else", asSarah], ["an unknown kind", forgedFixes(r, "remove-sentence")], ["edits that do not replay", notReplaying]] as const) {
    const res = await timedPut(h, body, rev);
    assert.equal(res.status, 403, `${label}: ${refusedAs(res)}`);
    assert.ok(res.ms < 500, `${label}: ${Math.round(res.ms)} ms`);
  }
});

test("R2-SEC-2: the one-click fixes the engine offers are still stored – one, two in one save on different paragraphs, and their undo", async () => {
  const drafted = { text: "He was taking ibuprofen.", cites: ["N-001"], originalText: "He was taking ibuprofen." };
  const b = await formCase({ notes: DOSE_NOTE, boxes: { "F-32": [drafted, { ...drafted, text: "He said he was taking ibuprofen.", originalText: "He said he was taking ibuprofen." }] } });
  const h = await clinic(b);
  const rev = await seed(h, b.v);
  const fixes = offeredFixes(b.v, { actor: PAT, template: b.template, form: b.form }).filter((f) => f.sectionKey === "F-32" && f.after.trim() && f.after !== f.before);
  const ids = new Set(fixes.map((f) => f.paragraphId));
  assert.equal(ids.size, 2, "the engine offers staff '(dose not stated)' on both paragraphs");
  let both = b.v;
  for (const id of Array.from(ids)) both = applyFixProposal(both, fixes.find((f) => f.paragraphId === id)!, PAT);
  const res = await putStoredReport(h, both, "pat", rev);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const stored = (res.body as { report: Report }).report;
  assert.ok(box(stored, "F-32").paragraphs.every((p) => p.origin === "ai" && p.fixes?.length === 1), "still drafted, each fix recorded");
});

test("R2-SEC-2: ENGINE_FIX_KINDS names exactly the generators the engine and WB's fixes use", () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
  const own = Array.from(read("src/modules/medreport/ui/components/review/fixes.ts").matchAll(/generator: "([a-z-]+)"/g), (m) => m[1]);
  const wb = Array.from(read("src/modules/medreport/core/validation/attribution-fixes.ts").matchAll(/proposal\("([a-z-]+)"/g), (m) => m[1]);
  assert.deepEqual(new Set([...own, ...wb]), new Set(ENGINE_FIX_KINDS));
});

/* ------------------------------------------------------------------------------------------------
 * R2-SAF-1: a box put back to "pending", then "redrafted"
 * ----------------------------------------------------------------------------------------------*/

const FINDING = "Sarah Reid recorded that there were no red flags and neurological examination was normal.";
const FLIPPED = "Sarah Reid recorded red flags and neurological examination was abnormal.";

function forgedRedraft(r: Report, key: string, fn: (s: ReportSection) => ReportSection, extra: Partial<Report> = {}): Report {
  return { ...r, generation: [...(r.generation ?? []), { mode: "live" as const, sectionKeys: [key], at: r.updatedAt, promptVersion: "forms-9" }], sections: r.sections.map((s) => (s.key === key ? fn(s) : s)), ...extra };
}

test("R2-SAF-1: a stored box is never put back to 'pending' – staff or a colleague, a findings box or an opinion box (in-place control 403 too)", async () => {
  for (const key of ["F-32", "F-03"]) {
    const b = await formCase({ box: key, boxes: { [key]: [{ text: FINDING, cites: ["N-001"], origin: "ai" }] } });
    const h = await clinic(b);
    const rev = await seed(h, b.v);
    const inPlace = mapBox(b.v, key, (s) => ({ ...s, paragraphs: s.paragraphs.map((p) => ({ ...p, text: FLIPPED })) }));
    assert.equal((await putStoredReport(h, inPlace, "pat", rev)).status, 403, `${key}: the in-place rewrite`);
    for (const who of ["pat", "tom"] as const) {
      const reset = await putStoredReport(h, mapBox(b.v, key, (s) => ({ ...s, status: "pending" })), who, rev);
      assert.equal(reset.status, 403, `${key} by ${who}: ${refusedAs(reset)}`);
    }
  }
});

test("R2-SAF-1: a 'pending' box that holds anything is never redrafted – its drafted finding keeps every check", async () => {
  // A create can still write "pending" (a new report's boxes are the request's, checked against the map): one holding a
  // drafted finding is not what the factory makes, so a later 'drafting run' naming it does not exempt a rewrite.
  const b = await formCase({ box: "F-32", boxes: { "F-32": [{ text: FINDING, cites: ["N-001"], origin: "ai" }] } });
  const h = await clinic(b);
  const pending = mapBox(b.v, "F-32", (s) => ({ ...s, status: "pending" }));
  const rev = await seed(h, pending);
  const res = await putStoredReport(h, forgedRedraft(pending, "F-32", (s) => ({ ...s, status: "drafted", paragraphs: s.paragraphs.map((p) => ({ ...p, text: FLIPPED, originalText: FLIPPED })) })), "pat", rev);
  assert.equal(res.status, 403, refusedAs(res));
});

test("R2-SAF-1: an open opinion question is never dropped by a reset and a forged redraft (F-09); /sign then blocks on it", async () => {
  const b = await formCase({ box: "F-11", gaps: [{ box: "F-09", issue: "No clinician recorded an expected date of a full return." }] });
  const h = await clinic(b);
  const rev = await seed(h, b.v);
  const reset = mapBox(b.v, "F-09", (s) => ({ ...s, status: "pending" }));
  assert.equal((await putStoredReport(h, reset, "pat", rev)).status, 403);
  // Even sent in one go (the stored box was never pending): the question cannot go.
  const dropped = forgedRedraft(reset, "F-09", (s) => ({ ...s, status: "needs_input", paragraphs: [] }), { gaps: b.v.gaps.filter((g) => g.sectionKey !== "F-09") });
  assert.equal((await putStoredReport(h, dropped, "pat", rev)).status, 403);
  assert.equal((await postSign(h, { report: b.v, template: b.template, form: b.form, signer: "sarah", mode: "tenant", fileBytes: b.fileBytes })).status, 409, "the open question blocks approval");
});

test("R2-SAF-1: the honest flow still works – staff create a factory report and draft its waiting boxes (drafted answers too); a second run of an already drafted box is refused", async () => {
  const b = await formCase({ actor: "pat" });
  const h = await clinic(b);
  // The factory's copy: F-32 and F-07 waiting (empty, pending), as createFormReport leaves narrative boxes.
  const factory = (r: Report): Report =>
    mapBox(
      mapBox(r, "F-32", (s) => unstamped({ ...s, status: "pending", paragraphs: [] })),
      "F-07",
      (s) => unstamped({ ...s, status: "pending", paragraphs: [], answer: { kind: "yes_no", value: null } }),
    );
  const fresh = { ...factory(asStaffCreates(b.v)), id: "rpt_factory", gaps: b.v.gaps.filter((g) => g.sectionKey !== "F-32" && g.sectionKey !== "F-07") };
  let rev = await seed(h, fresh, "pat");
  const draft = {
    sections: [
      { key: "F-32", title: "", kind: "ai_narrative" as const, status: "drafted" as const, paragraphs: [{ id: "F-32-p1", text: "Sarah Reid recorded no red flags.", sourceIds: ["N-001"], origin: "ai" as const }] },
      { key: "F-07", title: "", kind: "ai_narrative" as const, status: "drafted" as const, paragraphs: [{ id: "F-07-p1", text: "Sarah Reid recorded that he had returned to work.", sourceIds: ["N-001"], origin: "ai" as const }], answer: { kind: "yes_no" as const, value: true } },
    ],
    gaps: [],
    flags: [],
    generation: { mode: "demo_recorded" as const, sectionKeys: ["F-32", "F-07"], at: fresh.updatedAt, promptVersion: "test" },
  };
  const drafted = applyDraftResult(fresh, draft as never);
  const res = await putStoredReport(h, drafted, "pat", rev);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  rev = (res.body as { rev: number }).rev;
  const stored = (res.body as { report: Report }).report;
  assert.equal(box(stored, "F-07").answer?.value, true);
  // A further "drafting run" over the now drafted box: not a redraft – its rewrite is refused.
  const again = applyDraftResult(stored, { ...draft, sections: [{ ...draft.sections[0], paragraphs: [{ ...draft.sections[0].paragraphs[0], text: "Sarah Reid recorded red flags." }] }], generation: { ...draft.generation, sectionKeys: ["F-32"] } } as never);
  assert.equal((await putStoredReport(h, again, "pat", rev)).status, 403);
});

/* ------------------------------------------------------------------------------------------------
 * R2-SAF-2: a create with no attested map or template context
 * ----------------------------------------------------------------------------------------------*/

const OPINION = "He will make a full recovery within six weeks and is fit for normal duties now.";
function relabelled(r: Report, key: string): Report {
  return {
    ...mapBox(r, key, (s) => {
      const n: ReportSection = { ...s, kind: "from_records", status: "complete", paragraphs: [{ id: `${key}-r1`, text: OPINION, sourceIds: ["REG"], origin: "from_records" }] };
      delete n.answer;
      return n;
    }),
    gaps: r.gaps.filter((g) => g.sectionKey !== key),
  };
}
function withoutMap(r: Report): Report {
  const form = { ...r.form! };
  delete form.mapSha256;
  return { ...r, form };
}
/** The report as staff create it (the factory's boxes and drafted text, nobody's decisions). */
function asStaffCreates(r: Report): Report {
  return {
    ...r,
    sections: r.sections.map((s) => {
      const n = { ...s, paragraphs: s.paragraphs.filter((p) => p.origin === "ai" || p.origin === "from_records") };
      if (n.answerBy) {
        delete n.answerBy;
        if (n.answer && n.answer.kind !== "text") n.answer = { ...n.answer, value: null };
      }
      delete n.adoptedBy;
      delete n.accepted;
      delete n.disposition;
      return n;
    }),
    gaps: r.gaps.map((g) => {
      const o = { ...g };
      delete o.resolution;
      return o;
    }),
    flags: [],
  };
}

test("R2-SAF-2: a form-report create without the attested map hash, with another map's hash, or of a map the clinic does not hold is refused; the honest create is stored", async () => {
  const b = await formCase({ actor: "pat" });
  const fresh = asStaffCreates(b.v);
  const h = await clinic(b);
  for (const [label, body] of [
    ["no map hash, prognosis relabelled", withoutMap(relabelled(fresh, "F-10"))],
    ["no map hash, nothing else", withoutMap(fresh)],
    ["another map's hash", { ...fresh, form: { ...fresh.form!, mapSha256: "0".repeat(64) } }],
  ] as const) {
    const res = await putStoredReport(h, { ...body, id: `rpt_${label.length}` }, "pat", null);
    assert.equal(res.status, 403, `${label}: ${refusedAs(res)}`);
  }
  const bare = createHttpHarness();
  assert.equal((await putStoredReport(bare, { ...fresh, id: "rpt_unheld" }, "pat", null)).status, 403, "a map the clinic does not hold");
  assert.equal((await putStoredReport(h, { ...relabelled(fresh, "F-10"), id: "rpt_relabel" }, "pat", null)).status, 403, "control: relabelled against the map");
  assert.equal((await putStoredReport(h, { ...fresh, id: "rpt_honest" }, "pat", null)).status, 201, "the Studio's own create");
});

test("R2-SAF-2: a staff N/A on an applying opinion question under an inverted frozen condition is refused on a create without the map hash (B2)", async () => {
  const b = await formCase({ actor: "pat", answers: { "F-07": false }, answersBy: { "F-07": "pat" }, gaps: [{ box: "F-08", issue: "No clinician recorded an expected date back at work." }] });
  // Pat's own "No" to F-07 (has he gone back to work?) stays: F-08 (if not, the expected date) applies.
  const fresh = mapBox(asStaffCreates(b.v), "F-07", (s) => ({ ...s, answer: { kind: "yes_no", value: false }, answerBy: PAT as never }));
  const forged = withoutMap({
    ...mapBox(fresh, "F-08", (s) => ({ ...s, ...(s.condition ? { condition: { ...s.condition, wants: s.condition.wants === "no" ? "yes" : "no" } } : {}) })),
    gaps: fresh.gaps.map((g) => (g.sectionKey === "F-08" ? { ...g, resolution: { kind: "resolved" as const, text: "Not applicable.", at: fresh.updatedAt, notApplicable: true } } : g)),
  });
  const h = await clinic(b);
  assert.equal((await putStoredReport(h, forged, "pat", null)).status, 403);
  assert.equal((await putStoredReport(h, { ...forged, form: fresh.form, id: "rpt_b2_map" }, "pat", null)).status, 403, "control: with the map hash");
  assert.equal((await putStoredReport(h, { ...fresh, id: "rpt_b2_honest" }, "pat", null)).status, 201, "the honest create");
});

test("R2-SAF-2: a built-in create naming another template version is refused; the registry's version is stored", async () => {
  const b = await formCase({ actor: "pat" }, "template:solicitor_rta");
  const fresh = asStaffCreates(b.v);
  const h = createHttpHarness();
  const other = await putStoredReport(h, { ...relabelled(fresh, "prognosis"), templateVersion: `${fresh.templateVersion}-x`, id: "rpt_other" }, "pat", null);
  assert.equal(other.status, 403, refusedAs(other));
  assert.equal((await putStoredReport(h, { ...fresh, templateVersion: `${fresh.templateVersion}-x`, id: "rpt_other_plain" }, "pat", null)).status, 403, "any unknown version");
  assert.equal((await putStoredReport(h, { ...fresh, templateId: "no_such_template", id: "rpt_unknown" }, "pat", null)).status, 403, "an unknown template");
  assert.equal((await putStoredReport(h, { ...fresh, id: "rpt_registry" }, "pat", null)).status, 201);
});

test("R2-SAF-2: an amendment is checked against its approved version 1 – stored even after the clinic's map changed or for an older template version", async () => {
  // A form report: v1 approved and stored; the clinic's map then moves on (re-confirmed); v2 is still stored.
  const b = await formCase({});
  const h = await clinic(b);
  const signed = await postSign(h, { report: b.v, template: b.template, form: b.form, signer: "sarah", mode: "tenant", fileBytes: b.fileBytes });
  assert.ok(signed.receipt, `approve v1: ${refusedAs(signed)}`);
  const v1: Report = { ...b.v, status: "signed", receipt: signed.receipt! };
  assert.equal((await putStoredReport(h, v1, "sarah", null)).status, 201);
  const row = await h.store.getForm(CORPUS_TENANT, b.form!.id);
  const moved = { ...b.form!, fields: b.form!.fields.map((f, i) => (i === 0 ? { ...f, label: `${f.label} (changed)` } : f)) };
  assert.equal((await h.store.updateForm(CORPUS_TENANT, { id: moved.id, status: moved.status, title: moved.title, referrer: moved.referrer.name, kind: moved.kind, fileSha256: moved.file.sha256, sampleId: null, payload: moved }, row!.rev)).ok, true);
  const v2 = createAmendedVersion(v1, SARAH.name, `${v1.id}_v2`);
  assert.equal((await putStoredReport(h, v2, "sarah", null)).status, 201, "checked against v1");
  // …but a "version 2" of nothing approved is checked as new – and the clinic's map no longer matches it.
  assert.equal((await putStoredReport(h, { ...v2, id: `${v1.id}_v2b`, amends: { ...v2.amends!, reportId: "rpt_nothing" } }, "sarah", null)).status, 403);
  // A built-in report approved under an older template version: its amendment is stored too.
  const bi = await formCase({}, "template:solicitor_rta");
  const old: Report = { ...bi.v, templateVersion: "0.9.0" };
  const hb = createHttpHarness();
  const s1 = await postSign(hb, { report: old, template: bi.template, form: null, signer: "sarah", mode: "tenant", fileBytes: null });
  assert.ok(s1.receipt, `approve the older version: ${refusedAs(s1)}`);
  const oldV1: Report = { ...old, status: "signed", receipt: s1.receipt! };
  // (stored as it was approved before this release – the store holds it; the create path for it is the amendment's)
  await hb.store.createReport(CORPUS_TENANT, { id: oldV1.id, status: oldV1.status, templateId: oldV1.templateId, formId: null, payload: oldV1 });
  assert.equal((await putStoredReport(hb, createAmendedVersion(oldV1, SARAH.name, `${oldV1.id}_v2`), "sarah", null)).status, 201);
});

test("R2-SAF-2: a portal question set (kind 'questions') the clinic holds, attested: its report's create is stored", async () => {
  const b = await formCase({ actor: "pat" });
  const qs: FormDefinition = { ...b.form!, id: "frm_cf_questions", kind: "questions" };
  const { withAttestedConfirmation, formMapSha256 } = await import("../../src/modules/medreport/auth/attestations");
  const attested = withAttestedConfirmation(qs, "Pat Morgan", "2026-10-01T09:00:00.000Z");
  const h = createHttpHarness();
  await storeForm(h, attested);
  const fresh = asStaffCreates(b.v);
  const report: Report = { ...fresh, id: "rpt_qs", templateId: `form:${qs.id}`, form: { ...fresh.form!, formId: qs.id, kind: "questions", mapSha256: formMapSha256(attested) } };
  const res = await putStoredReport(h, report, "pat", null);
  assert.equal(res.status, 201, JSON.stringify(res.body));
});

test("R2-SAF-2: a case imported from the public demo is stored only when the clinic holds its map", async () => {
  const b = await formCase({ boxes: { "F-31": [{ text: "Lifting injury at work on 12/03/2026.", cites: ["N-001"] }] } });
  const demo: Report = { ...asStaffCreates(b.v), tenantId: "demo" };
  assert.equal((await putStoredReport(createHttpHarness(), demo, "pat", null)).status, 403);
  assert.equal((await putStoredReport(await clinic(b), demo, "pat", null)).status, 201);
});

/* ------------------------------------------------------------------------------------------------
 * R2-TPN-01: an answer changed with no one's stamp
 * ----------------------------------------------------------------------------------------------*/

test("R2-TPN-01: staff's unstamped change of a code-filled answer (F-02 date of birth) or a drafted yes/no (F-07) is refused; stamped as theirs it is stored", async () => {
  const b = await formCase({ box: "F-07", answers: { "F-07": true }, boxes: { "F-07": [{ text: "Sarah Reid recorded that he had returned to work on full duties.", cites: ["N-001"], origin: "ai" }] } });
  const drafted = revalidate(b, mapBox(b.v, "F-07", unstamped));
  for (const [key, value] of [["F-02", "1970-01-01"], ["F-07", false]] as const) {
    const h = await clinic(b);
    const rev = await seed(h, drafted);
    const change = (by: typeof PAT | null) => mapBox(drafted, key, (s) => ({ ...unstamped(s), answer: { ...s.answer!, value } as never, ...(by ? { answerBy: by as never } : {}) }));
    const forged = await putStoredReport(h, change(null), "pat", rev);
    assert.equal(forged.status, 403, `${key} unstamped: ${refusedAs(forged)}`);
    const own = await putStoredReport(h, change(PAT), "pat", rev);
    assert.equal(own.status, 200, `${key} stamped as Pat: ${JSON.stringify(own.body)}`);
    assert.equal(box((own.body as { report: Report }).report, key).answerBy?.memberId, PAT.memberId, "labelled as Pat's");
  }
});

test("R2-TPN-01: after the approver's 'Mark resolved', staff's unstamped change of the answer is refused; the approver's unstamped change of a clinician box too", async () => {
  const b = await formCase({ box: "F-07", answers: { "F-07": true }, gaps: [{ box: "F-07", issue: "The notes do not say whether he went back to work." }] });
  const resolved = revalidate(b, {
    ...mapBox(b.v, "F-07", unstamped),
    gaps: b.v.gaps.map((g) => (g.sectionKey === "F-07" ? { ...g, resolution: { kind: "resolved" as const, text: "Checked with the patient.", at: b.v.updatedAt, by: SARAH as never } } : g)),
  });
  const h = await clinic(b);
  const rev = await seed(h, resolved);
  assert.equal((await putStoredReport(h, mapBox(resolved, "F-07", (s) => ({ ...s, answer: { kind: "yes_no", value: false } })), "pat", rev)).status, 403);
  // F-11 (opinion): even the approver's change carries her stamp (the review stamps every answer a person sets).
  const sarahs = mapBox(resolved, "F-11", (s) => ({ ...unstamped(s), answer: { kind: "choice", value: "6-12 months" } }));
  assert.equal((await putStoredReport(h, sarahs, "sarah", rev)).status, 403);
  assert.equal((await putStoredReport(h, mapBox(sarahs, "F-11", (s) => ({ ...s, answerBy: SARAH as never })), "sarah", rev)).status, 200);
});

test("R2-TPN-01: taking the stamp off an answer that stays is refused; clearing an answer (no value, no stamp) is stored; the review's own setAnswer is stored", async () => {
  const b = await formCase({ box: "F-07", answers: { "F-07": true }, answersBy: { "F-07": "sarah" } });
  const h = await clinic(b);
  let rev = await seed(h, b.v);
  assert.equal((await putStoredReport(h, mapBox(b.v, "F-07", unstamped), "pat", rev)).status, 403, "the stamp dropped, the value kept");
  const cleared = reviewReducer(b.v, { type: "setAnswer", key: "F-07", value: null, actor: PAT as never }, { fields: b.form?.fields ?? null, form: b.form, boxes: b.template.sections } as never);
  assert.equal(box(cleared, "F-07").answer?.value ?? null, null);
  assert.equal(box(cleared, "F-07").answerBy, undefined);
  const res = await putStoredReport(h, cleared, "pat", rev);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  rev = (res.body as { rev: number }).rev;
  const set = reviewReducer(cleared, { type: "setAnswer", key: "F-07", value: false, actor: PAT as never }, { fields: b.form?.fields ?? null, form: b.form, boxes: b.template.sections } as never);
  assert.equal(box(set, "F-07").answerBy?.memberId, PAT.memberId, "the review stamps the person's set");
  assert.equal((await putStoredReport(h, set, "pat", rev)).status, 200);
});
