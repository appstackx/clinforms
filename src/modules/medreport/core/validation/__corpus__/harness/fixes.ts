/**
 * Safety corpus: the one-click fixes the review offers on a report, applied to a copy and checked against the
 * engine rules (plan WD 6, invariant I8):
 * - whole sentences only: every figure and date left is one that was there (none changed or added);
 * - no sentence starts in lower case, with a comma, or with a digit (a date-led sentence excepted);
 * - no orphaned "He/She recorded …" where the clinician was named before;
 * - a box's only answering text is never removed;
 * - a clinical negative ("No swelling was noted.") is never removed;
 * - re-validation adds no blocking flag on the box.
 *
 * Known generators on the base tree: "Name X instead" (name-instead), "Tick “…”" (tick-suggested), "Remove it"
 * (remove-absence), "Write in my own voice" (own-voice). A release module may add more by exporting
 * `offeredFixes(report, {actor, form, template})` from core/fix-types.ts or ui/components/review/review/fixes.ts:
 * each proposal {kind, label?, apply(report) → report} is then checked the same way.
 */
import { nameClinicianFix, ownVoiceCandidates, supersededAbsenceSentences } from "../../../../ui/components/review/review-model";
import { reviewReducer } from "../../../../ui/components/review/use-review-state";
import type { FormDefinition, Report, ReportFlag, ReportTemplate } from "../../../types";
import { actorOf, person } from "./fixtures";
import type { PersonKey } from "./types";

export interface OfferedFix {
  kind: string;
  label: string;
  /** The box it changes (null: several). */
  box: string | null;
  apply(report: Report): Report;
}

type Loose = Record<string, unknown>;

function dispatch(report: Report, action: Loose, actorKey: PersonKey): Report {
  // W0.6: every person action carries the acting member as `actor: Actor` (ReviewAction.actor).
  const full = { ...action, actor: actorOf(actorKey) };
  return reviewReducer(report, full as unknown as Parameters<typeof reviewReducer>[1]);
}

/** Where the release's fix generators live: W0.6's core/fix-types.ts, and WD's review fixes (W0.4 split: ui/components/review/fixes.ts). */
const RELEASE_FIX_MODULES = ["../../../fix-types", "../../../../ui/components/review/fixes"];

async function releaseFixes(report: Report, ctx: { actor: PersonKey; form: FormDefinition | null; template: ReportTemplate }): Promise<OfferedFix[]> {
  const out: OfferedFix[] = [];
  for (const path of RELEASE_FIX_MODULES) {
    let mod: Loose;
    try {
      mod = (await import(/* @vite-ignore */ path)) as Loose;
    } catch {
      continue;
    }
    const fn = mod.offeredFixes;
    if (typeof fn !== "function") continue;
    const proposals = (fn as (r: Report, c: Loose) => unknown)(report, { actor: actorOf(ctx.actor), form: ctx.form, template: ctx.template });
    if (!Array.isArray(proposals)) continue;
    // bh2-rc1: the review's one-click actions that are not text fixes (fixes.ts offeredActions – WB's "Accept as my
    // note's words", "Remove the note link"), each {kind, label, key, apply} applied as the review applies it.
    const actions = typeof mod.offeredActions === "function" ? (mod.offeredActions as (r: Report, c: Loose) => unknown)(report, { actor: actorOf(ctx.actor) }) : [];
    if (Array.isArray(actions)) proposals.push(...(actions as unknown[]));
    for (const p of proposals as Loose[]) {
      if (typeof p.apply === "function" && typeof p.kind === "string") {
        out.push({ kind: p.kind, label: String(p.label ?? p.kind), box: typeof p.key === "string" ? p.key : null, apply: p.apply as (r: Report) => Report });
        continue;
      }
      // W0.6's FixProposal (core/fix-types.ts): applied the way the review screen applies it – the reducer action
      // `applyFix {proposal}` by the acting member (WD). A tree whose reducer does not know it leaves the report unchanged.
      if (typeof p.generator === "string" && typeof p.sectionKey === "string" && typeof p.after === "string") {
        const proposal = p;
        out.push({ kind: p.generator, label: String(p.label ?? p.generator), box: p.sectionKey, apply: (r) => dispatch(r, { type: "applyFix", proposal }, ctx.actor) });
      }
    }
  }
  return out;
}

/** Every one-click fix offered to `actor` on `report` (with its flags already validated). */
export async function offeredFixes(report: Report, ctx: { actor: PersonKey; voiceOwner: PersonKey | null; form: FormDefinition | null; template: ReportTemplate }): Promise<OfferedFix[]> {
  const out: OfferedFix[] = [];
  for (const f of report.flags.filter((x) => !x.acknowledged)) {
    const named = nameClinicianFix(report, f);
    if (named) {
      out.push({ kind: "name-instead", label: `Name ${named.name} instead`, box: f.sectionKey ?? null, apply: (r) => dispatch(r, { type: "nameClinicians", flags: [f] as ReportFlag[] }, ctx.actor) });
    }
  }
  for (const g of report.gaps.filter((x) => !x.resolution && x.suggestedAnswer)) {
    out.push({ kind: "tick-suggested", label: `Tick “${g.suggestedAnswer}”`, box: g.sectionKey, apply: (r) => dispatch(r, { type: "setAnswer", key: g.sectionKey, value: g.suggestedAnswer ?? null }, ctx.actor) });
  }
  for (const s of report.sections) {
    if (supersededAbsenceSentences(s).length > 0) out.push({ kind: "remove-absence", label: "Remove it", box: s.key, apply: (r) => dispatch(r, { type: "removeAbsence", key: s.key }, ctx.actor) });
  }
  const owner = ctx.voiceOwner ? person(ctx.voiceOwner).name : null;
  if (owner && ownVoiceCandidates(report, owner).length > 0) {
    out.push({ kind: "own-voice", label: "Write in my own voice", box: null, apply: (r) => dispatch(r, { type: "writeInOwnVoice", authorName: owner }, ctx.actor) });
  }
  out.push(...(await releaseFixes(report, ctx)));
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Engine rules
 * ----------------------------------------------------------------------------------------------*/

const FIGURE = /\d+(?:[.,:/]\d+)*/g;
const DATE_LEAD = /^\d{1,2}\/\d{1,2}\/\d{2,4}\b/;
const CLINICAL_NEGATIVE = /\bno [a-z][a-z -]{2,60} (?:was|were) (?:noted|reported|found|seen|present|elicited)\b/i;

function figures(text: string): string[] {
  return (text.match(FIGURE) ?? []).slice().sort();
}

/** Sentences by a conservative rule that never splits inside a number, a date or after Mr./Dr./e.g./approx. */
export function roughSentences(text: string): string[] {
  const protectedText = text.replace(/\b(Mr|Mrs|Ms|Dr|e\.g|i\.e|approx|no|vs)\./gi, (m) => m.replace(/\./g, "\u0001"));
  return protectedText
    .split(/(?<=[.!?])\s+(?=\S)/)
    .map((s) => s.replace(/\u0001/g, ".").trim())
    .filter(Boolean);
}

function boxText(report: Report, key: string): string {
  return (report.sections.find((s) => s.key === key)?.paragraphs ?? []).map((p) => p.text).join(" ").trim();
}

function multisetSubset(after: string[], before: string[]): string[] {
  const pool = [...before];
  const extra: string[] = [];
  for (const a of after) {
    const i = pool.indexOf(a);
    if (i >= 0) pool.splice(i, 1);
    else extra.push(a);
  }
  return extra;
}

export interface FixCheck {
  ok: boolean;
  problems: string[];
}

/** The engine rules over every box the fix changed. */
export function checkFixRules(before: Report, after: Report, blockingBefore: readonly ReportFlag[], blockingAfter: readonly ReportFlag[]): FixCheck {
  const problems: string[] = [];
  for (const s of after.sections) {
    const was = boxText(before, s.key);
    const now = boxText(after, s.key);
    if (was === now) continue;
    const extra = multisetSubset(figures(now), figures(was));
    if (extra.length) problems.push(`${s.key}: figures changed or added (${extra.join(", ")})`);
    // A box whose answer already started with a figure ("7/10 at worst, as recorded by …" → "7/10 at worst", WD
    // EDIT-compact-04) keeps that start; a figure start the fix created ("0, a mild ache…") is still refused.
    const leadFigure = (t: string) => (/^\d+(?:[.,:/]\d+)*/.exec(t) ?? [""])[0];
    const keptLead = leadFigure(now) !== "" && leadFigure(now) === leadFigure(was);
    roughSentences(now).forEach((sentence, i) => {
      if (/^[,;:]/.test(sentence)) problems.push(`${s.key}: a sentence starts with punctuation – “${sentence.slice(0, 40)}”`);
      else if (/^[a-z]/.test(sentence)) problems.push(`${s.key}: a sentence starts in lower case – “${sentence.slice(0, 40)}”`);
      else if (/^\d/.test(sentence) && !DATE_LEAD.test(sentence) && !(i === 0 && keptLead)) problems.push(`${s.key}: a sentence starts with a digit – “${sentence.slice(0, 40)}”`);
    });
    if (/^(?:He|She|They) (?:recorded|noted|found|assessed|measured)\b/.test(now) && !/^(?:He|She|They) /.test(was)) {
      problems.push(`${s.key}: “${now.slice(0, 30)}…” has lost who recorded it`);
    }
    if (was && !now) problems.push(`${s.key}: the box's only answer was removed`);
    for (const sentence of roughSentences(was)) {
      if (CLINICAL_NEGATIVE.test(sentence) && !now.includes(sentence.replace(/[.]$/, ""))) problems.push(`${s.key}: a clinical negative was removed – “${sentence}”`);
    }
  }
  const key = (f: ReportFlag) => `${f.code}|${f.sectionKey ?? ""}`;
  const had = new Set(blockingBefore.map(key));
  const added = blockingAfter.filter((f) => !had.has(key(f)) && f.code !== "OPEN_GAP");
  if (added.length) problems.push(`re-validation adds blocking flags: ${added.map((f) => `${f.code} on ${f.sectionKey ?? "report"}`).join(", ")}`);
  return { ok: problems.length === 0, problems };
}
