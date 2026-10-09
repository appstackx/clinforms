import "server-only";

/**
 * Turns raw structured output (live or demo) into a DraftsResponse:
 * - only the requested sections, in the requested order, with template titles and kinds;
 * - "[CLAIMANT]" replaced with the patient's name (e.g. "Ms Hart");
 * - note shorthand expanded into plain words, job titles cased as in the record and any record ID in the
 *   text replaced by the note's date (core/voice.ts) – in answers and in gap wording alike;
 * - on another insurer's form, the insurer on record named as "the insurer" (core/form-record-rules.ts
 *   withoutOtherInsurerName); names the demonstration record labels "(fictional)" keep the label;
 * - paragraphs with server-assigned IDs, origin "ai" and originalText (for "revert");
 * - cited IDs that are not sources of this record dropped, each with an UNKNOWN_SOURCE_ID flag;
 * - gaps with IDs (raisedBy "ai"), plus a system gap for any requested section left empty without one;
 * - referrer forms (`form`): each field's structured answer parsed into `section.answer`
 *   (core/forms.ts parseFormAnswerValue – a value that does not fit is left blank with a gap; an
 *   uncited value gets a gap asking the clinician to confirm it; a value the draft raised a gap about
 *   is left blank, with its paragraphs, for the clinician to pick; a choice whose words the cited notes
 *   do not use is left blank with a gap), `fieldId` set;
 * - the validators run on the drafted sections (flags for those sections only).
 *
 * Owner: ai agent.
 */
import { DraftsResponseSchema, type DraftsResponse } from "../api/contract";
import { otherInsurerOnForm, withoutOtherInsurerName } from "../core/form-record-rules";
import { answerKindFor, parseFormAnswerValue } from "../core/forms";
import { isNoteId } from "../core/ids";
import { createFormReport, createReport } from "../core/report-factory";
import { applyScope } from "../core/scope";
import type {
  ComputedFact,
  EpisodeBundle,
  FormAnswer,
  FormDefinition,
  FormField,
  Gap,
  GenerationMeta,
  InstructingParty,
  Paragraph,
  Report,
  ReportFlag,
  ReportSection,
  ReportTemplate,
  TemplateSection,
} from "../core/types";
import { runValidators } from "../core/validation";
import { makeFlag } from "../core/validation/context";
import { buildSourceTexts } from "../core/validation/sources";
import { describeSourceIds, expandNoteShorthand, fictionalNames, keepFictionalLabels, normaliseJobTitles } from "../core/voice";
import type { DraftOutput } from "./types";

export interface AssembleDraftInput {
  template: ReportTemplate;
  /** Unscoped bundle (as sent to /drafts). */
  bundle: EpisodeBundle;
  instructingParty: InstructingParty;
  sectionKeys: string[];
  computedFacts: ComputedFact[];
  output: DraftOutput;
  meta: GenerationMeta;
  /** Referrer forms: the form map being completed (`template` = formToTemplate(form)). */
  form?: FormDefinition;
  /** Fixed ID seed (tests); random otherwise. */
  idSeed?: string;
}

/** "Ms Hart" (title + surname), or the full name when no title is recorded. */
export function claimantDisplayName(reg: EpisodeBundle["registration"]): string {
  const title = reg.title?.trim();
  return title ? `${title} ${reg.lastName.trim()}` : reg.fullName.trim();
}

/** Replace "[CLAIMANT]" (any case) with the patient's name. */
export function reidentify(text: string, name: string): string {
  return text.replace(/\[\s*claimant\s*\]/gi, name);
}

function randomSeed(): string {
  const bytes = new Uint8Array(3);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Every string value in a record (for the names it labels "(fictional)"). */
function stringsOf(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringsOf(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) stringsOf(v, out);
  return out;
}

/** Short label for gap wording: the template title without a trailing "(…)". */
function shortTitle(spec: TemplateSection): string {
  return spec.title.replace(/\s*\(.*\)\s*$/, "").trim() || spec.title;
}

function emptySectionGap(key: string, seed: string, spec: TemplateSection, field: FormField | undefined): Gap {
  const opinion = spec.kind === "clinician_opinion";
  if (field) {
    const label = shortTitle(spec);
    return {
      id: `gap-${key}-${seed}-sys`,
      sectionKey: key,
      issue: opinion
        ? `No clinician recorded an opinion that answers “${label}”, so nothing could be attributed.`
        : `The record does not answer “${label}”.`,
      suggestedQuestion: opinion
        ? `What is your professional opinion on “${label}”? Write it in your own words, or say that no opinion was formed.`
        : `Please answer “${label}” from your knowledge of the case, or confirm it should be left blank.`,
      relatedNoteIds: [],
      raisedBy: "system",
    };
  }
  return {
    id: `gap-${key}-${seed}-sys`,
    sectionKey: key,
    issue: opinion
      ? `No ${shortTitle(spec).toLowerCase()} is recorded in the notes, so nothing could be attributed.`
      : `The record did not support any text for “${spec.title}”.`,
    suggestedQuestion: opinion
      ? "Please write this section from your own professional opinion, or state that no opinion was recorded."
      : "Please write this section, or confirm what the record shows.",
    relatedNoteIds: [],
    raisedBy: "system",
  };
}

const OPTION_STOPWORDS = new Set(["with", "from", "that", "this", "have", "been", "than", "other", "only", "more", "less", "some", "none", "does", "were", "they", "their", "please", "state", "specify"]);

/**
 * Content words of a printed option ("Goals achieved" → goals, achieved) that the text does not use,
 * matched on their stem ("achieve…", "goal…") so "goals were achieved" or "discharged" count.
 */
export function optionWordsNotIn(option: string, text: string): string[] {
  const haystack = text.toLowerCase();
  const words = (option.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length >= 4 && !OPTION_STOPWORDS.has(w));
  return words.filter((w) => haystack.indexOf(w.slice(0, Math.max(4, w.length - 2))) < 0);
}

export function assembleDraft(input: AssembleDraftInput): DraftsResponse {
  const { template, bundle, sectionKeys, output, form } = input;
  const seed = input.idSeed ?? randomSeed();
  const name = claimantDisplayName(bundle.registration);
  const sourceTexts = buildSourceTexts(applyScope(bundle, template), input.computedFacts, input.instructingParty);
  const sourceIds = new Set(Array.from(sourceTexts.keys()));
  const droppedFlags: ReportFlag[] = [];
  // Drafted wording a person reads (answers and gaps): the patient's name back in, record IDs as the
  // note's date, note shorthand in plain words ("2x/wk" → "2 times a week", ">15 kg" → "more than
  // 15 kg"), numbers kept, and job titles as the record writes them – for live and recorded output alike.
  // On another insurer's form the insurer on record is "the insurer"; "(fictional)" labels stay.
  const otherInsurer = form ? otherInsurerOnForm(form, bundle) : null;
  const fictional = fictionalNames(stringsOf([bundle, input.instructingParty]));
  const readable = (raw: string) => {
    let text = describeSourceIds(reidentify(raw.trim(), name), { notes: bundle.notes, facts: input.computedFacts });
    if (otherInsurer) text = withoutOtherInsurerName(text, otherInsurer);
    return keepFictionalLabels(normaliseJobTitles(expandNoteShorthand(text), bundle), fictional);
  };

  const sections: ReportSection[] = [];
  const gaps: Gap[] = [];

  for (const key of sectionKeys) {
    const spec = template.sections.find((s) => s.key === key);
    if (!spec) continue;
    const field = form?.fields.find((f) => f.id === key);
    const outSections = (output.sections ?? []).filter((s) => s.sectionKey === key);
    const paragraphs: Paragraph[] = [];
    for (const out of outSections) {
      for (const p of out.paragraphs ?? []) {
        const text = readable(String(p.text ?? ""));
        if (!text) continue;
        const id = `${key}-${seed}-p${paragraphs.length + 1}`;
        const ids = Array.from(new Set((p.sourceIds ?? []).map((x) => String(x).trim()).filter(Boolean)));
        const valid = ids.filter((x) => sourceIds.has(x));
        for (const bad of ids.filter((x) => !sourceIds.has(x))) {
          droppedFlags.push(
            makeFlag({
              code: "UNKNOWN_SOURCE_ID",
              severity: "warning",
              sectionKey: key,
              paragraphId: id,
              evidence: bad,
              message: `The draft cited "${bad}", which is not a source in this record, so the citation was removed. Check the paragraph against its remaining sources.`,
            }),
          );
        }
        paragraphs.push({ id, text, sourceIds: valid, origin: "ai", basis: p.basis, originalText: text });
      }
    }

    const sectionGaps: Gap[] = (output.gaps ?? [])
      .filter((g) => g.sectionKey === key && String(g.issue ?? "").trim() !== "")
      .map((g, i) => ({
        id: `gap-${key}-${seed}-${i + 1}`,
        sectionKey: key,
        issue: readable(g.issue),
        suggestedQuestion: readable(String(g.suggestedQuestion ?? "")) || "Can you add this from your own knowledge of the case?",
        relatedNoteIds: Array.from(new Set((g.relatedNoteIds ?? []).filter((x) => isNoteId(x) && sourceIds.has(x)))),
        raisedBy: "ai" as const,
      }));

    // Referrer forms: the structured answer (yes/no, tick box, choice, date, number).
    let answer: FormAnswer | undefined;
    if (field && answerKindFor(field.answerType) !== "text") {
      const raw = outSections.map((s) => String(s.answer ?? "").trim()).find((a) => a !== "") ?? "";
      const label = shortTitle(spec);
      // A tick or choice the draft itself raised a gap about is one the record does not state: the
      // clinician picks it, never code ("Goals achieved" ticked, then "the clinician should confirm").
      const unconfirmed = raw !== "" && sectionGaps.length > 0;
      answer = parseFormAnswerValue(field, unconfirmed ? "" : raw);
      if (unconfirmed) {
        paragraphs.length = 0;
        sectionGaps[0] = {
          ...sectionGaps[0],
          issue: `${sectionGaps[0].issue} A suggested answer (“${readable(raw).slice(0, 80)}”) was not entered, because the record does not state it.`,
        };
      } else if (raw && answer.value === null) {
        sectionGaps.push({
          id: `gap-${key}-${seed}-fit`,
          sectionKey: key,
          issue: `The drafted answer “${reidentify(raw, name).slice(0, 80)}” does not fit the form's ${field.options?.length ? "options" : "answer format"} for “${label}”, so it has been left blank.`,
          suggestedQuestion: `Which answer should be given to “${label}”?`,
          relatedNoteIds: [],
          raisedBy: "system",
        });
      } else if (answer.value !== null && !paragraphs.some((p) => p.sourceIds.length > 0)) {
        sectionGaps.push({
          id: `gap-${key}-${seed}-cite`,
          sectionKey: key,
          issue: `The drafted answer to “${label}” cites no source in the record.`,
          suggestedQuestion: `Is “${raw}” the right answer to “${label}”? Confirm it, or change it.`,
          relatedNoteIds: [],
          raisedBy: "system",
        });
      } else if (answer.value !== null && field.answerType === "single_choice") {
        // A choice is ticked only when the cited notes say it in the option's own words: "Goals
        // achieved" for a note that says "episode of care complete" is an inference, so the clinician
        // picks. The cited paragraph stays as context.
        const cited = Array.from(new Set(paragraphs.flatMap((p) => p.sourceIds))).map((id) => sourceTexts.get(id) ?? "").join("\n");
        const unstated = optionWordsNotIn(String(answer.value), cited);
        if (unstated.length > 0) {
          const option = String(answer.value);
          answer = { ...answer, value: null };
          sectionGaps.push({
            id: `gap-${key}-${seed}-choice`,
            sectionKey: key,
            issue: `The suggested answer “${option}” is not stated in the cited notes (they do not use the word${unstated.length === 1 ? "" : "s"} ${unstated.map((w) => `“${w}”`).join(unstated.length === 2 ? " and " : ", ")}), so it has not been ticked.`,
            suggestedQuestion: `Which answer should be given to “${label}”${field.options?.length ? ` (${field.options.join(" / ")})` : ""}?`,
            relatedNoteIds: Array.from(new Set(paragraphs.flatMap((p) => p.sourceIds).filter((x) => isNoteId(x)))),
            raisedBy: "system",
          });
        }
      }
    }

    const answered = answer ? answer.value !== null : paragraphs.length > 0;
    if (!answered && sectionGaps.length === 0) sectionGaps.push(emptySectionGap(key, seed, spec, field));

    gaps.push(...sectionGaps);
    const section: ReportSection = {
      key,
      title: spec.title,
      kind: spec.kind,
      paragraphs,
      status: !answered || sectionGaps.length > 0 ? "needs_input" : "drafted",
    };
    if (field) section.fieldId = field.id;
    if (answer) section.answer = answer;
    sections.push(section);
  }

  // Validate the drafted sections in the context of a full report.
  const base: Report = form
    ? createFormReport({
        form,
        bundle,
        instructingParty: input.instructingParty,
        computedFacts: input.computedFacts,
        id: "rpt_assemble",
      })
    : createReport({
        template,
        bundle,
        instructingParty: input.instructingParty,
        computedFacts: input.computedFacts,
        id: "rpt_assemble",
      });
  const report: Report = {
    ...base,
    sections: base.sections.map((s) => sections.find((d) => d.key === s.key) ?? s),
    gaps,
    flags: droppedFlags,
  };
  const drafted = new Set(sectionKeys);
  const flags = runValidators({ report, bundle, template, computedFacts: input.computedFacts }).filter(
    (f) => f.sectionKey !== undefined && drafted.has(f.sectionKey),
  );

  return DraftsResponseSchema.parse({ sections, gaps, flags, generation: input.meta });
}
