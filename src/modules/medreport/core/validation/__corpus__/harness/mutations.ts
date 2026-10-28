/**
 * Safety corpus: mutations generated at test time from the hand-written cases (ids `<case>~<mutation>`).
 *
 * - anti-strip (every BLOCK case with a subject paragraph, unless mutate.strip is false): the unsafe text wrapped in
 *   carriers an exemption could strip – a prefix, a suffix, a joiner and a wrapper. Each must still BLOCK the same way.
 * - anti-deny-list (every PASS case with mutate.denyList): a need, requirement, plan or prediction inserted at the
 *   case's insertion point – "needs to", "is required to", "has to", "should", "will", "must", "aims to". Each must
 *   BLOCK (an allow hook for faithful narration must never let a recommendation through).
 * - origin (OPN and ATT BLOCK cases with a drafted paragraph, unless mutate.origin is false): the same text edited by
 *   the approver (BLOCK until the approver acknowledges); for opinion cases also written by staff through the review
 *   (BLOCK; only the approver clears it) and typed by the approver in their own words (PASS: the approver may state
 *   an opinion).
 * - actor (cases with mutate.actors): the same steps by staff, by a clinician who is not the approver, by the approver
 *   and by an administrator without may-sign, each with its own expected result.
 * - one-click (evaluate.ts evaluateOneClicks): every fix offered on a validate case, applied and re-checked.
 *
 * Pure.
 */
import { actorKeyFor } from "./judge";
import type { ActorKind, CorpusCase, RunCase, Step } from "./types";

export const STRIP_CARRIERS: ReadonlyArray<{ id: string; apply(text: string): string }> = [
  { id: "strip-prefix", apply: (t) => `No further treatment was given. ${t}` },
  { id: "strip-suffix", apply: (t) => `${withoutStop(t)}, as was noted.` },
  { id: "strip-joiner", apply: (t) => `No restrictions were recorded; ${lowerFirst(t)}` },
  { id: "strip-wrapper", apply: (t) => `There were no red flags and ${lowerFirst(withoutStop(t))}, as was documented.` },
];

export const DENY_MODALS: ReadonlyArray<{ id: string; m: string }> = [
  { id: "deny-needs-to", m: "needs to" },
  { id: "deny-is-required-to", m: "is required to" },
  { id: "deny-has-to", m: "has to" },
  { id: "deny-should", m: "should" },
  { id: "deny-will", m: "will" },
  { id: "deny-must", m: "must" },
  { id: "deny-aims-to", m: "aims to" },
];

const LOWERABLE = /^(?:He|She|They|His|Her|Their|The|There|No|Further|It|A|An|In|On|At|With|After|Before|This|These)\b/;

function lowerFirst(t: string): string {
  return LOWERABLE.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t;
}

function withoutStop(t: string): string {
  return t.replace(/[.!?]+\s*$/, "");
}

function variant(c: CorpusCase, mutation: string, patch: Partial<RunCase>): RunCase {
  return { ...c, ...patch, id: `${c.id}~${mutation}`, parent: c.id, mutation, title: `${c.title} [${mutation}]` };
}

export function stripMutations(c: CorpusCase): RunCase[] {
  if (c.expect !== "BLOCK" || !c.input.paragraph || c.mutate?.strip === false) return [];
  if (!c.paths.includes("validate")) return [];
  const text = c.input.paragraph.text;
  return STRIP_CARRIERS.map((carrier) =>
    variant(c, carrier.id, {
      carrierText: carrier.apply(""),
      parentText: text,
      paths: ["validate"],
      input: { ...c.input, paragraph: { ...c.input.paragraph!, text: carrier.apply(text), ...(c.input.paragraph!.origin === "edited" ? { originalText: carrier.apply(c.input.paragraph!.originalText ?? text) } : {}) } },
    }),
  );
}

export function denyListMutations(c: CorpusCase): RunCase[] {
  const spec = c.mutate?.denyList;
  if (!spec || c.expect !== "PASS" || !c.input.paragraph) return [];
  const text = c.input.paragraph.text;
  if (!text.includes(spec.find)) return [];
  return DENY_MODALS.map((d) =>
    variant(c, d.id, {
      expect: "BLOCK",
      ack: c.input.paragraph!.origin === "ai" ? "never" : undefined,
      paths: ["validate"],
      negativeTwin: undefined,
      check: undefined,
      input: { ...c.input, paragraph: { ...c.input.paragraph!, text: text.replace(spec.find, spec.replace.replace("{m}", d.m)) } },
    }),
  );
}

export function originMutations(c: CorpusCase): RunCase[] {
  if (c.expect !== "BLOCK" || !c.input.paragraph || c.input.paragraph.origin !== "ai" || c.mutate?.origin === false) return [];
  if (c.group !== "OPN" && c.group !== "ATT") return [];
  if (!c.paths.includes("validate")) return [];
  const p = c.input.paragraph;
  const box = c.input.box ?? "";
  const approver = c.input.approver === undefined ? "sarah" : c.input.approver;
  const out: RunCase[] = [
    variant(c, "origin-edited", {
      owner: "WC",
      paths: ["validate"],
      ack: "approver",
      input: { ...c.input, paragraph: { ...p, origin: "edited", originalText: p.text, by: approver ?? "sarah" } },
    }),
  ];
  if (c.group !== "OPN") return out;
  // Staff write the same words through the review: an empty box, then their text (the reducer stamps the origin).
  const staffSteps: Step[] = [{ do: "add", by: "pat", box, text: p.text }];
  out.push(
    variant(c, "origin-staff", {
      owner: "WC",
      paths: ["reducer"],
      ack: "approver",
      input: { ...c.input, paragraph: undefined, actor: "pat", steps: staffSteps, boxes: { ...(c.input.boxes ?? {}), [box]: [] } },
    }),
  );
  if (approver && c.input.author !== null) {
    const approverSteps: Step[] = [{ do: "add", by: approver, box, text: p.text }];
    out.push(
      variant(c, "origin-approver", {
        owner: "WC",
        paths: ["reducer"],
        expect: "PASS",
        ack: undefined,
        negativeTwin: c.id,
        check: undefined,
        input: { ...c.input, paragraph: undefined, actor: approver, steps: approverSteps, boxes: { ...(c.input.boxes ?? {}), [box]: [] } },
      }),
    );
  }
  return out;
}

export function actorMutations(c: CorpusCase): RunCase[] {
  const actors = c.mutate?.actors;
  if (!actors) return [];
  const approver = c.input.approver === undefined ? "sarah" : c.input.approver;
  return (Object.entries(actors) as Array<[ActorKind, CorpusCase["expect"]]>).map(([kind, expect]) => {
    const who = actorKeyFor(kind, approver);
    return variant(c, `actor-${kind}`, {
      expect,
      ack: expect === "BLOCK" ? c.ack : undefined,
      negativeTwin: expect === "PASS" ? (c.expect === "PASS" ? c.negativeTwin : c.id) : undefined,
      // Steps without their own `by` are taken by the case's actor.
      input: { ...c.input, actor: who },
    });
  });
}

/** Every generated mutation of the corpus (one-click variants are generated while running). */
export function generateMutations(cases: readonly CorpusCase[]): RunCase[] {
  return cases.flatMap((c) => [...stripMutations(c), ...denyListMutations(c), ...originMutations(c), ...actorMutations(c)]);
}
