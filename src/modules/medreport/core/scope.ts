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
 * Pure; browser and server.
 *
 * Owner: ai agent. Signatures are final.
 */
import type { EpisodeBundle, Note, ReportTemplate, ScopeField } from "./types";

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

/** Remove every sentence that contains one of `terms`; lines left empty are dropped. */
export function removeSentencesWithTerms(text: string, terms: readonly string[]): string {
  if (!text || terms.length === 0) return text;
  const res = terms.map((t) => scopeTermRegex(t));
  if (!res.some((re) => re.test(text))) return text;
  return text
    .split("\n")
    .map((line) => {
      const sentences = line.match(/[^.!?]+(?:[.!?]+|$)\s*/g) ?? [line];
      return sentences
        .filter((s) => !res.some((re) => re.test(s)))
        .join("")
        .trim();
    })
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
