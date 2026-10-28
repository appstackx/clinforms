/**
 * Scope rules run in code BEFORE any AI call. A template's `scope` lists:
 * - `excludeFields`: bundle fields that are removed (e.g. past medical and social history for employer
 *   reports);
 * - `excludeTerms`: terms that must not reach the AI or appear in the report. Any sentence of note
 *   text, the referral reason or the incident mechanism that contains one is removed as well, so
 *   out-of-scope history typed into an ordinary note field is not sent either.
 *
 * The SCOPE_TERM validator then checks the drafted text for `scopeExcludeTerms(template)`.
 *
 * Sentences are found with the shared tokenizer under its "notes" policy (core/text/sentences.ts, bh2 WD design 5 – N-1):
 * a decimal never ends a sentence ("PSFS 6.5" is never cut to "PSFS 6."), and terse lower-case clinic notes still split
 * at each ". " ("pain 3/10 at rest. prev back injury 2019, settled. gym 2x/wk." is three sentences), so an out-of-scope
 * sentence goes on its own and an in-scope figure next to it stays. A figure is either kept with its whole sentence or
 * the whole sentence goes – never cut.
 *
 * Ledger hook "scope-strip" (prestrip, ledger.json): removeSentencesWithTerms applies only while hookEnabled.
 *
 * Pure; browser and server.
 *
 * Owner: WD (drafting and text edits) – docs/bh2-ownership.json. Signatures are final.
 */
import { removeSentences } from "./text/sentences";
import type { EpisodeBundle, Note, ReportTemplate, ScopeField } from "./types";
import { defineHook, hookEnabled } from "./validation/hooks";

/** Ledger hook "scope-strip": the scope minimisation of note text before drafting and validation. */
export const SCOPE_STRIP_HOOK = defineHook("scope-strip");

/** Terms implied by each excludable field, added to the template's own `excludeTerms`. */
export const FIELD_IMPLIED_TERMS: Record<ScopeField, readonly string[]> = {
  "note.pastMedicalHistory": ["past medical history", "PMH"],
  "note.socialHistory": ["social history"],
};

/**
 * Every term the SCOPE_TERM validator blocks for this template: `scope.excludeTerms` plus the terms
 * implied by `scope.excludeFields`, de-duplicated case-insensitively, in a stable order.
 */
export function scopeExcludeTerms(template: ReportTemplate): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (term: string) => {
    const t = term.trim();
    const key = t.toLowerCase();
    if (!t || seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };
  template.scope.excludeTerms.forEach(add);
  for (const field of template.scope.excludeFields) FIELD_IMPLIED_TERMS[field].forEach(add);
  return out;
}

/** Case-insensitive, whole-word matcher for a scope term (flexible whitespace, hyphen or space). */
export function scopeTermRegex(term: string, flags = "i"): RegExp {
  const body = term
    .trim()
    .split(/[\s-]+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[\\s-]+");
  return new RegExp(`(?:^|[^A-Za-z0-9])(${body})(?![A-Za-z0-9])`, flags);
}

/**
 * Remove every sentence that contains one of `terms` (whole sentences, by the shared tokenizer's "notes" policy);
 * lines left empty are dropped.
 */
export function removeSentencesWithTerms(text: string, terms: readonly string[]): string {
  if (!text || terms.length === 0 || !hookEnabled(SCOPE_STRIP_HOOK)) return text;
  const res = terms.map((t) => scopeTermRegex(t));
  if (!res.some((re) => re.test(text))) return text;
  return text
    .split("\n")
    .map((line) => removeSentences(line, (span) => res.some((re) => re.test(span.text)), "notes").after.trim())
    .filter((line) => line !== "")
    .join("\n");
}

/**
 * Returns a copy of `bundle` with every field listed in `template.scope.excludeFields` removed and
 * every sentence containing an excluded term removed from note text, the referral reason and the
 * incident mechanism. Never mutates its input; returns the same object when the template has no scope.
 */
export function applyScope(bundle: EpisodeBundle, template: ReportTemplate): EpisodeBundle {
  const exclude = new Set<ScopeField>(template.scope.excludeFields);
  const terms = scopeExcludeTerms(template);
  if (exclude.size === 0 && terms.length === 0) return bundle;
  const clean = (s: string) => removeSentencesWithTerms(s, terms);

  const notes = bundle.notes.map((note) => {
    const copy: Note = {
      ...note,
      subjective: clean(note.subjective),
      objective: clean(note.objective),
      assessment: clean(note.assessment),
      plan: clean(note.plan),
    };
    if (note.freeText !== undefined) copy.freeText = clean(note.freeText);
    if (exclude.has("note.pastMedicalHistory")) delete copy.pastMedicalHistory;
    else if (note.pastMedicalHistory !== undefined) copy.pastMedicalHistory = clean(note.pastMedicalHistory);
    if (exclude.has("note.socialHistory")) delete copy.socialHistory;
    else if (note.socialHistory !== undefined) copy.socialHistory = clean(note.socialHistory);
    return copy;
  });

  const referral =
    bundle.referral.reason !== undefined ? { ...bundle.referral, reason: clean(bundle.referral.reason) } : bundle.referral;
  const incident = bundle.incident ? { ...bundle.incident, mechanism: clean(bundle.incident.mechanism) } : undefined;

  const scoped: EpisodeBundle = { ...bundle, notes, referral };
  if (incident) scoped.incident = incident;
  return scoped;
}

/** When the first assessment took place: the first initial-assessment note's date, else the first note's (ISO), or null. */
export function initialAssessmentDate(bundle: Pick<EpisodeBundle, "notes">): string | null {
  const notes = bundle.notes.slice().sort((a, b) => (a.date + (a.time ?? "") < b.date + (b.time ?? "") ? -1 : a.date + (a.time ?? "") > b.date + (b.time ?? "") ? 1 : 0));
  const ia = notes.find((n) => n.type === "initial_assessment") ?? notes[0];
  return ia ? ia.date : null;
}

/**
 * Fix round 2 (B1-21, kept by bh2 WD): the first appointment after that assessment – attended, missed or booked, not one
 * cancelled with notice – or null. An initial assessment form asks for it.
 */
export function nextAppointmentAfterAssessment(bundle: Pick<EpisodeBundle, "notes" | "appointments">): EpisodeBundle["appointments"][number] | null {
  const date = initialAssessmentDate(bundle);
  if (!date) return null;
  const later = bundle.appointments.filter((a) => a.date > date && a.status !== "CNC").sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1));
  return later[0] ?? null;
}

/**
 * Fix round 1 (B0-6): the record as at the initial assessment, for a form that reports it – the notes up to and
 * including the first attended assessment (its date: the first initial-assessment note, else the first note), the
 * appointments up to then and the outcome scores taken by then. Registration, referral, incident and consent are kept;
 * the episode is open at that point. Fix round 2 (B1-21, kept by bh2 WD): the next appointment after the assessment
 * stays – an initial assessment form asks for it – as it stood then (booked) and without its note. Null when there are
 * no notes. Never mutates its input.
 */
export function initialAssessmentView(bundle: EpisodeBundle): { bundle: EpisodeBundle; date: string } | null {
  const date = initialAssessmentDate(bundle);
  if (!date) return null;
  const next = nextAppointmentAfterAssessment(bundle);
  const kept = next ? [{ id: next.id, date: next.date, time: next.time, status: "BOOKED" as const }] : [];
  return {
    date,
    bundle: {
      ...bundle,
      notes: bundle.notes.filter((n) => n.date <= date),
      appointments: [...bundle.appointments.filter((a) => a.date <= date), ...kept],
      outcomeMeasures: bundle.outcomeMeasures.map((m) => ({ ...m, points: m.points.filter((p) => p.date <= date) })).filter((m) => m.points.length > 0),
      episodeStatus: "open",
    },
  };
}
