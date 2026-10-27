/**
 * Referrer forms – the shape of one box's answer, worked out once from the stored map (bh2 WD design 4, 8, 9; the
 * phase-1 "AnswerSpec-lite": derived at run time, nothing stored):
 *
 * - compactPlace: where a short answer from the record goes when that is a compact place – a table cell (also a
 *   short answer written after a label inside a table cell, B1-12) or a blank inside the form's printed sentence;
 * - printedLeadOf: the words the form prints before the answer space ("To return to …") – analysis.printedLeads (WE,
 *   read from the template), else a lead quoted in the guidance ("Completes the printed words “To return to”.");
 * - timePointOf: what time point the answer reports. On an initial assessment form every box reports the assessment
 *   (the next appointment is the one exception, kept by core/scope.ts initialAssessmentView). On any other form (a
 *   discharge, progress, interim or summary form) a compact or structured answer reports the LATEST position unless its
 *   question says otherwise – initial, first, pre-injury, before, since, history, so far, baseline (B1-6, B3-7);
 * - yesNoInWords: a text box whose printed question is a yes/no and whose guidance asks for the details "– or “No”"
 *   (B2-5, kept by bh2 WD): it is answered "Yes – …" or "No", never with a list of facts nobody called by that name;
 * - isGradeScale: a printed scale of degree (Grade 1 / 2 / 3, Mild / Moderate / Severe, No impact / Some / A lot …) –
 *   a clinician's judgement code never ticks (B3-15).
 *
 * Pure: no React, no Node built-ins, no env. compactPlace was split out of core/validation/draft-fit.ts by W0.4 (bh2
 * module split; draft-fit.ts re-exports it).
 * Owner: WD (drafting and text edits) – docs/bh2-ownership.json.
 */
import { reportKindOf } from "../forms";
import type { FormDefinition, FormField } from "../types";

/** A docx block id inside a table cell ("t2.r3.c1", "t2.r3.c1.p0", nested "t2.r3.c1.t0.r0.c0"). */
const IN_TABLE_CELL = /^t\d+\.r\d+\.c\d+(?:\.|$)/;

/** Where a short answer goes when that is a compact place: a table cell, or a blank inside a printed sentence. */
export function compactPlace(field: FormField | undefined): "cell" | "blank" | null {
  if (!field || field.answerType !== "short_text" || field.fillSource.kind !== "notes_narrative" || field.anchor.kind !== "docx") return null;
  const a = field.anchor;
  if (a.target === "table_cell") return "cell";
  if (a.target === "replace_placeholder" && !a.writeAfter && (a.placeholderText ?? "").trim().length > 0 && (a.placeholderText ?? "").trim().length <= 4) return "blank";
  // Fix B1-12 (a): a short answer written after its label, but inside a table cell, is still a cell's value.
  if (a.target !== "replace_placeholder" && IN_TABLE_CELL.test(a.blockId ?? "")) return "cell";
  return null;
}

/** "Completes the printed words “To return to”." → "To return to" (a lead the guidance quotes). */
const GUIDANCE_LEAD = /\b(?:completes?|follows?|after|continues?)\s+(?:the\s+)?(?:printed\s+)?(?:words?|sentence|phrase|text)\s*[“"‘']([^”"’']{3,60})[”"’']/i;

/**
 * The words the form prints before this box's answer space, if any: the map's analysis.printedLeads (read from the
 * template by WE), else a lead the guidance quotes. Null when neither says.
 */
export function printedLeadOf(field: Pick<FormField, "id" | "guidance">, form?: Pick<FormDefinition, "analysis"> | null): string | null {
  const stored = form?.analysis?.printedLeads?.[field.id];
  if (stored && stored.trim()) return stored.replace(/[\s.\u2026:]+$/, "").trim();
  const m = GUIDANCE_LEAD.exec(field.guidance ?? "");
  return m ? m[1].replace(/[\s.\u2026:]+$/, "").trim() : null;
}

export type FormTimeKind = "initial" | "later";

/** An initial assessment form reports the assessment; every other form reports where the episode is now. */
export function formTimeKind(form: Pick<FormDefinition, "title"> | null | undefined): FormTimeKind | null {
  if (!form) return null;
  return reportKindOf(form.title) === "initial" ? "initial" : "later";
}

/** The time point a box's answer reports. */
export type TimePoint = "assessment" | "latest" | "episode";

/** A question about the start of the episode or the time before it (not the latest position). */
const EARLIER_LABEL = /\b(?:initial|first|pre[- ]?injury|before|prior|previous(?:ly)?|since|history|historic|so far|to date|baseline|at (?:the )?(?:start|outset|assessment|referral)|on referral|at onset|onset|originally)\b/i;
/** A question about the whole episode (what was done, how many) rather than one time point. */
const EPISODE_LABEL = /\b(?:sessions?|appointments?|attend(?:ed|ance)|treatment (?:given|provided)|treatments?|number of|dates?|discharged? on|DNA)\b/i;
/**
 * bh2 fix round 1 (R1T-WD-04): facts of the whole episode that a later note does not change – the body area treated,
 * when the question asks for the area itself ("Area treated 1", "Area affected 2", "Site of injury", "Body part"; not
 * "Area treated 1 – improvement the patient reports (%)", which asks for the position now), and the modalities used over
 * the episode ("Modalities given – Hydrotherapy", or a tick whose guidance says the modality was used). A question that
 * says "now", "current" or "at discharge" still asks for the latest position.
 */
const EPISODE_AREA =
  /\b(?:(?:affected|injured|injury|treated|problem|presenting|main) (?:area|region|site|body part|part of the body)|(?:area|region|site|part)s? (?:affected|injured|treated|of (?:the )?(?:injury|complaint|problem))|body (?:part|region|area)|site of (?:the )?(?:injury|pain|symptoms))s?(?:\s*\(?\d{1,2}\)?)?\s*[:?.]?\s*$/i;
const EPISODE_MODALITY =
  /\b(?:(?:treatment )?modalit(?:y|ies)\s+(?:were\s+|was\s+)?(?:used|given|delivered|applied|received)|(?:this|the|that)\s+(?:modality|technique|intervention|treatment)\s+was\s+(?:used|given|provided|delivered|applied))\b/i;
const NOW_WORDS = /\b(?:now|current(?:ly)?|at discharge|latest|present(?:ly)?|today)\b/i;

/**
 * The time point a box reports (bh2 WD design 8): "assessment" on an initial assessment form; on any other form
 * "latest" for a compact or structured answer unless its question names an earlier time point ("assessment") or the
 * whole episode ("episode": what was done, how many – and, since fix round 1, the body area and the modalities used,
 * EPISODE_AREA, EPISODE_MODALITY); text answers report the episode (they are checked by their wording, not held back).
 */
export function timePointOf(field: Pick<FormField, "label" | "guidance" | "answerType" | "fillSource" | "anchor">, kind: FormTimeKind | null): TimePoint {
  if (kind === "initial") return "assessment";
  const words = `${field.label} ${field.guidance ?? ""}`;
  if (EARLIER_LABEL.test(field.label)) return "assessment";
  const compact = compactPlace(field as FormField) !== null;
  const structured = field.answerType !== "short_text" && field.answerType !== "long_text";
  if (!compact && !structured) return "episode";
  if (EPISODE_LABEL.test(field.label) && !/\b(?:now|current(?:ly)?|at discharge|latest|present(?:ly)?)\b/i.test(words)) return "episode";
  // A printed label is short; a longer one is not read for these (each rule reads it once).
  if (words.length <= 600 && (EPISODE_AREA.test(field.label.trim()) || EPISODE_MODALITY.test(words)) && !NOW_WORDS.test(words)) return "episode";
  return "latest";
}

/**
 * Fix round 3 (B2-5, kept by bh2 WD): a text box whose printed question is a yes/no ("Are there obstacles to getting
 * better?") and whose guidance asks for the details "– or “No”".
 */
export function yesNoInWords(field: Pick<FormField, "label" | "guidance" | "answerType"> | undefined): boolean {
  if (!field || (field.answerType !== "long_text" && field.answerType !== "short_text")) return false;
  return /^(?:\(?[a-z0-9]{1,3}[.)]\s*)?(?:is|are|has|have|does|do|was|were|did|any)\b[^?]*\?/i.test(field.label.trim()) && /\bor [“"]no[”"]/i.test(field.guidance ?? "");
}

/** A printed severity or degree word ("mild", "moderate", "severe", "some", "a lot", "worse"…). */
const DEGREE_WORDS = /^(?:none|nil|no|not at all|minimal|slight(?:ly)?|mild(?:ly)?|moderate(?:ly)?|severe(?:ly)?|very severe|extreme(?:ly)?|significant(?:ly)?|some|a little|a lot|little|lots|much|very much|considerable|marked(?:ly)?|well|good|fair|poor|bad|worse|better|same|improving|improved|static|unchanged|worsening|deteriorat(?:ing|ed)|full|partial|complete(?:ly)?|limited|unlimited|low|medium|high|occasional(?:ly)?|frequent(?:ly)?|constant(?:ly)?|always|sometimes|never|rarely|often)$/i;
const ORDINAL = /\b(?:\d{1,2}|i{1,3}|iv|v|vi{0,3}|one|two|three|four|five)\b/i;
const SCALE_LABEL = /\b(?:grade|grading|severity|severe|degree|level|rating|scale|score|stage|intensity|extent)\b/i;

/**
 * A printed scale of degree, which only a clinician grades (B3-15): the options are the same words with a different
 * ordinal ("Grade 1", "Grade 2", "Grade 3"; "WAD I", "WAD II"), or each option is a degree – a degree word, or a degree
 * word with a shared noun ("No problems", "Some problems", "Severe problems"; "Sleeps well", "Some difficulty", "Poor
 * sleep") – or the question asks for a grade, severity or level.
 */
export function isGradeScale(field: Pick<FormField, "label" | "options" | "answerType">): boolean {
  if (field.answerType !== "single_choice") return false;
  const options = (field.options ?? []).map((o) => o.trim()).filter(Boolean);
  if (options.length < 2) return false;
  if (SCALE_LABEL.test(field.label)) return true;
  // Same words, different ordinal.
  const stems = options.map((o) => o.toLowerCase().replace(ORDINAL, "#").replace(/\s+/g, " ").trim());
  if (stems.every((s) => s === stems[0] && s.includes("#"))) return true;
  // Each option names a degree.
  const degree = (o: string) => {
    const words = o.toLowerCase().replace(/[^a-z' -]/g, " ").split(/\s+/).filter(Boolean);
    for (let n = Math.min(3, words.length); n >= 1; n--) {
      if (DEGREE_WORDS.test(words.slice(0, n).join(" ")) || DEGREE_WORDS.test(words.slice(-n).join(" "))) return true;
    }
    return false;
  };
  return options.filter(degree).length >= Math.max(2, options.length - 1) && options.length <= 7;
}
