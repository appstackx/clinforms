/**
 * Referrer forms – guidance: what the drafting step and the reviewer are told a question wants.
 *
 * Pure: no React, no Node built-ins, no env. Split out of core/forms.ts by W0.4 (bh2 module split, pure move; core/forms.ts re-exports it).
 * bh2 WE design 4 (B1-16, B2-22, B2-34, D-8, D-9): currentGuidance – how a stored map's guidance reads NOW. The stored
 * map is the single source of truth: a map written in this release's wording (analysis.guidanceVersion ≥
 * GUIDANCE_VERSION – ClinForms' v2 maps, every new upload) is shown exactly as stored. Only a map from before
 * (no marker) gets the legacy rewrite on screen – "unanswered … stays" said as a box left blank prints now, the source
 * said by where the value really comes from, a tick box's option as printed – and the stored text is never changed by
 * it (the field editor saves what is stored, B1-16). The withheld-reference rewrite is about the report, not the map,
 * so it applies to every map.
 * Owner: WE (data, maps and mapping page) – docs/bh2-ownership.json.
 */
import { ANSWER_TYPE_LABELS } from "../labels";
import { GUIDANCE_VERSION } from "../schemas";
import type { FormAnalysis, FormField, ReportSection } from "../types";

/** Guidance for the AI and the reviewer: the referrer's brief plus the expected answer shape. */
export function fieldGuidance(field: FormField): string {
  const parts = [field.guidance.trim()];
  if (field.section) parts.push(`Form section: ${field.section}.`);
  parts.push(`Answer type: ${ANSWER_TYPE_LABELS[field.answerType]}.`);
  if (field.options?.length) parts.push(`Options as printed: ${field.options.map((o) => `"${o}"`).join(", ")}.`);
  return parts.filter(Boolean).join(" ");
}

/** Whether a map's guidance is written in this release's wording (the v2 marker): then it is shown as stored. */
export function guidanceIsCurrent(analysis: Pick<FormAnalysis, "guidanceVersion"> | null | undefined): boolean {
  return (analysis?.guidanceVersion ?? 1) >= GUIDANCE_VERSION;
}

/**
 * A referral value the record holds but that was not copied onto this form (another organisation's reference): staff
 * type it in from the referrer's letter (fix round 3, B2-22 – a fact about the report, so for every map).
 */
export function withheldReference(field: Pick<FormField, "fillSource">, section: Pick<ReportSection, "kind" | "paragraphs" | "blankFromRecords"> | null): boolean {
  if (field.fillSource.kind !== "registration" || !field.fillSource.path.startsWith("referral.") || !section || section.kind !== "from_records") return false;
  return !section.paragraphs.some((p) => p.origin === "from_records") && !section.blankFromRecords;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Where a registration value really comes from, in the source words of WE design 3 (null: the patient's record). */
function sourceWords(field: Pick<FormField, "fillSource">): string | null {
  if (field.fillSource.kind !== "registration") return null;
  if (field.fillSource.path === "staff.entry") return "Entered by staff on each report";
  return field.fillSource.path.startsWith("clinic.") ? "From your Clinic details" : null;
}

/**
 * How the guidance reads now (see the file comment). `guidanceVersion` is the map's analysis.guidanceVersion; absent:
 * a map from before this release.
 */
export function currentGuidance(
  text: string,
  field?: Pick<FormField, "fillSource"> & Partial<Pick<FormField, "answerType" | "options">>,
  opts: { guidanceVersion?: number; withheldReference?: boolean } = {},
): string {
  let out = text;
  const legacy = (opts.guidanceVersion ?? 1) < GUIDANCE_VERSION;
  const replaceSource = (from: string) =>
    out.replace(/\bFilled from the record\b/g, from).replace(/\bfilled from the record\b/g, from.charAt(0).toLowerCase() + from.slice(1));
  if (opts.withheldReference) return replaceSource("Typed in by staff from the referrer's letter");
  if (!legacy) return out;
  // B1-16: written before a box left blank printed nothing.
  if (/\bunanswered\b/i.test(out)) {
    out = out
      .replace(/\bunanswered[:,]\s*the printed default stays\b/gi, "left blank, the printed default is removed")
      .replace(/\bunanswered[:,]\s*(“[^”]+”)\s*stays\b/gi, "left blank, the printed $1 is removed")
      .replace(/\bunanswered:\s*kept as printed\b/gi, "left blank: it is deleted too");
  }
  if (!field) return out;
  // B2-22: "Filled from the record" said by where the value really comes from.
  const from = sourceWords(field);
  if (from) out = replaceSource(from);
  // B2-34: a tick box's option as printed ("Ticked when TENS was provided", "joint mobilisations were provided").
  const option = field.answerType === "checkbox" && field.options?.length === 1 ? field.options[0].trim() : "";
  if (option) {
    const plural = /[^s]s$/.test(option) && option !== option.toUpperCase();
    out = out.replace(
      new RegExp(`\\b(when (?:the (?:treatment )?plan includes )?|includes )${escapeRe(option)}\\b( was provided| were provided)?`, "i"),
      (_m, pre: string, was: string | undefined) => `${pre}${option}${was ? (plural ? " were provided" : " was provided") : ""}`,
    );
  }
  return out;
}
