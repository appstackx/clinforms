import "server-only";

/**
 * Turns raw structured output (live or demo) into a DraftsResponse:
 * - only the requested sections, in the requested order, with template titles and kinds;
 * - "[CLAIMANT]" replaced with the patient's name (e.g. "Ms Hart");
 * - note shorthand expanded into plain words, job titles cased as in the record and any record ID in the
 *   text replaced by the note's date (core/voice.ts) – in answers and in gap wording alike; no grammar rewriting
 *   (bh2 WD design 1: core/voice.ts plainClinicalWording is NOT run here – only the pinned token-level substitutions of
 *   ai/form-drafting-wording.ts);
 * - drafting meta-wording held back as an audited gap "Drafted text held back – check it", never dropped (WD design 3);
 *   a sentence the drafting retracted ("… Actually, that was at the first assessment …") is held back with the
 *   retraction, as its own audited gap, never printed;
 * - the time point (WD design 8): on an initial assessment form a paragraph citing a later note is held back; on any
 *   other form a compact or structured answer about the latest position that cites only older notes is held back;
 * - on another insurer's form, the insurer on record named as "the insurer" (core/form-record-rules.ts
 *   withoutOtherInsurerName); names the demonstration record labels "(fictional)" keep the label;
 * - paragraphs with server-assigned IDs, origin "ai" and originalText (for "revert");
 * - cited IDs that are not sources of this record dropped, each with an UNKNOWN_SOURCE_ID flag;
 * - gaps with IDs (raisedBy "ai"), plus a system gap for any requested section left empty without one;
 * - referrer forms (`form`): each field's structured answer parsed into `section.answer`
 *   (core/forms.ts parseFormAnswerValue – a value that does not fit is left blank with a gap; an
 *   uncited value gets a gap asking the clinician to confirm it; a value the draft raised a gap about
 *   is left blank, with its paragraphs, for the clinician to pick; a structured answer is entered only when the
 *   record says it – ai/form-drafting-answers.ts: never on an opinion box (held back with the cited note's words for
 *   the approver), never a grade scale, never a printed time band, a choice only when one cited sentence states its
 *   whole option phrase as a fact (WD design 4)), `fieldId` set; every gap gets a Gap.kind;
 * - the voice owner (whose "I" the report speaks in) is the report's approver; with none, nobody's (third person) –
 *   never the author the request names (the client defaults it to the clinician who wrote most notes) and never
 *   guessed (WD design 2);
 * - the validators run on the drafted sections (flags for those sections only).
 *
 * Owner: WD (drafting and text edits) – docs/bh2-ownership.json.
 */
import { DraftsResponseSchema, type DraftsResponse } from "../api/contract";
import { otherInsurerOnForm, withoutOtherInsurerName } from "../core/form-record-rules";
import { answerKindFor, parseFormAnswerValue } from "../core/forms";
import { compactPlace, formTimeKind, timePointOf, yesNoInWords } from "../core/forms/answer-shape";
import { isNoteId } from "../core/ids";
import { createFormReport, createReport } from "../core/report-factory";
import { applyScope } from "../core/scope";
import type {
  Clinician,
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
import { formatUkDate } from "../core/dates";
import { laterThanAssessment, latestNoteDate, onlyOlderNotes } from "../core/validation/draft-fit/measure";
import { describeSourceIds, expandNoteShorthand, fictionalNames, keepFictionalLabels, normaliseJobTitles, notesNamedByAuthor } from "../core/voice";
import { TICK_SUGGESTED_HOOK, decideStructuredAnswer, draftedGapKind, isClinicianBox } from "./form-drafting-answers";
import { hookEnabled } from "../core/validation/hooks";
import { holdBackMeta, opensWithRetraction, pinnedWording } from "./form-drafting-wording";
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
  /** The clinician named as the report's author in the request (never the voice owner – WD design 2). */
  author?: Clinician;
  /**
   * bh2 WD design 2: the report's approving physio – the voice owner. First person only for their own notes; everyone
   * else stays named. null or absent: nobody (third person).
   */
  approver?: { name: string; hcpc?: string | null; memberId?: string } | null;
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
      kind: opinion ? "no_opinion_recorded" : draftedGapKind(field, "", []),
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
    kind: opinion ? "no_opinion_recorded" : "record_value",
  };
}

/** A quoted excerpt for gap wording (at most `n` characters). */
function quoted(text: string, n = 160): string {
  const t = text.replace(/\s+/g, " ").trim();
  return `“${t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t}”`;
}

/**
 * Content words of a printed option ("Goals achieved" → goals, achieved) that the text does not use.
 * @deprecated bh2 WD design 4: a choice is entered only when one cited sentence holds its whole option phrase
 * (ai/form-drafting-answers.ts optionStatedIn); kept for callers outside assembly.
 */
const OPTION_STOPWORDS = new Set(["with", "from", "that", "this", "have", "been", "than", "other", "only", "more", "less", "some", "none", "does", "were", "they", "their", "please", "state", "specify"]);
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
  // bh2 WD design 1: no grammar rewriting – "On 18/03/2026 I recorded that X" stays as drafted (plainClinicalWording
  // dated past events to the note, B3-4, and left fragments, B1-3/B2-6); only pinned token-level substitutions run.
  const otherInsurer = form ? otherInsurerOnForm(form, bundle) : null;
  const fictional = fictionalNames(stringsOf([bundle, input.instructingParty]));
  // bh2 WD design 2: the voice owner is the approver – never the request's author (the client's default for it is the
  // clinician who wrote most notes, the guess design 2 removes), never a guess.
  const approver = input.approver?.name?.trim() ? input.approver : null;
  const voiceOwner: Clinician | null = approver ? { name: approver.name, hcpc: approver.hcpc ?? "" } : null;
  const readable = (raw: string) => {
    let text = describeSourceIds(reidentify(raw.trim(), name), { notes: bundle.notes, facts: input.computedFacts });
    if (otherInsurer) text = withoutOtherInsurerName(text, otherInsurer);
    return keepFictionalLabels(normaliseJobTitles(expandNoteShorthand(text), bundle), fictional);
  };
  const timeKind = formTimeKind(form);
  const latest = latestNoteDate(bundle);
  const noteById = new Map(bundle.notes.map((n) => [n.id, n] as const));

  const sections: ReportSection[] = [];
  const gaps: Gap[] = [];

  for (const key of sectionKeys) {
    const spec = template.sections.find((s) => s.key === key);
    if (!spec) continue;
    const field = form?.fields.find((f) => f.id === key);
    const label = shortTitle(spec);
    const outSections = (output.sections ?? []).filter((s) => s.sectionKey === key);
    const paragraphs: Paragraph[] = [];
    /** A paragraph held back for its time point (its answer is held back with it). */
    let heldForTimePoint = false;
    // Gaps assembly raises itself (held-back text, time points): never mistaken for the drafting's own gaps below.
    const heldGaps: Gap[] = [];
    const holdBack = (suffix: string, gap: Pick<Gap, "issue" | "suggestedQuestion" | "kind"> & Partial<Pick<Gap, "suggestedAnswer">>, related: readonly string[]) => {
      heldGaps.push({
        id: `gap-${key}-${seed}-${suffix}`,
        sectionKey: key,
        issue: gap.issue,
        suggestedQuestion: gap.suggestedQuestion,
        relatedNoteIds: Array.from(new Set(related.filter((x) => isNoteId(x) && sourceIds.has(x)))),
        raisedBy: "system",
        ...(gap.kind ? { kind: gap.kind } : {}),
        ...(gap.suggestedAnswer ? { suggestedAnswer: gap.suggestedAnswer } : {}),
      });
    };
    for (const out of outSections) {
      for (const p of out.paragraphs ?? []) {
        const ids = Array.from(new Set((p.sourceIds ?? []).map((x) => String(x).trim()).filter(Boolean)));
        const drafted = pinnedWording(readable(String(p.text ?? "")));
        if (!drafted) continue;
        const id = `${key}-${seed}-p${paragraphs.length + 1}`;
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
        // bh2 WD design 3: drafting meta-wording is held back as an audited item – the rest of the paragraph stays.
        let meta = holdBackMeta(drafted);
        let retractedFrom = valid;
        // A paragraph that opens by retracting the one before it ("Actually, that was at the first assessment.") puts
        // that paragraph in doubt too: both are held back together (the same rule as inside one paragraph).
        const previous = paragraphs[paragraphs.length - 1];
        if (previous && opensWithRetraction(drafted)) {
          const joint = holdBackMeta(`${previous.text} ${drafted}`);
          if (joint.retracted.length > 0) {
            paragraphs.pop();
            meta = joint;
            retractedFrom = Array.from(new Set([...previous.sourceIds, ...valid]));
          }
        }
        if (meta.retracted.length > 0) {
          holdBack(
            `retract${paragraphs.length + heldGaps.length + 1}`,
            {
              kind: "meta_held_back",
              issue: `Drafted text held back – check it: ${meta.retracted.map((t) => quoted(t, 240)).join(" ")} The draft corrected itself here, so none of this is printed: check it against the notes.`,
              suggestedQuestion: `What should “${label}” say? Add what the notes record in your own words, or mark this checked.`,
            },
            retractedFrom,
          );
        }
        if (meta.heldBack.length > 0) {
          holdBack(
            `meta${paragraphs.length + heldGaps.length + 1}`,
            {
              kind: "meta_held_back",
              issue: `Drafted text held back – check it: ${meta.heldBack.map((t) => quoted(t)).join(" ")} It reads as notes about the drafting, not an answer, so it is not printed.`,
              suggestedQuestion: `Is anything missing from “${label}”? Add it in your own words, or mark this checked.`,
            },
            valid,
          );
        }
        const text = meta.text;
        if (!text) continue;
        // bh2 WD design 8: on an initial assessment form, a paragraph from a later note is held back (B0-6, B1-6).
        if (timeKind === "initial") {
          const later = laterThanAssessment(valid, bundle);
          if (later) {
            holdBack(
              `asat${paragraphs.length + heldGaps.length + 1}`,
              {
                kind: "record_value",
                issue: `From a later note of ${formatUkDate(later.later)}, not the record as it stood on the assessment day (${formatUkDate(later.assessment)}), so it is not printed: ${quoted(text)}`,
                suggestedQuestion: `What should “${label}” say as it stood on ${formatUkDate(later.assessment)}, the assessment day?`,
              },
              valid,
            );
            heldForTimePoint = true;
            continue;
          }
        }
        paragraphs.push({ id, text, sourceIds: valid, origin: "ai", basis: p.basis, originalText: text });
      }
    }

    const sectionGaps: Gap[] = (output.gaps ?? [])
      .filter((g) => g.sectionKey === key && String(g.issue ?? "").trim() !== "")
      .map((g, i) => {
        const related = Array.from(new Set((g.relatedNoteIds ?? []).filter((x) => isNoteId(x) && sourceIds.has(x))));
        // Fix round 1 (B0-23): "your discharge note of 16/09/2026" → "Sarah Reid's discharge note of 16/09/2026".
        const issue = notesNamedByAuthor(readable(g.issue), bundle.notes);
        const question = notesNamedByAuthor(readable(String(g.suggestedQuestion ?? "")), bundle.notes);
        // bh2 WD design 3: a gap whose whole issue is drafting meta-wording falls back to a neutral gap that makes no
        // claim about what was recorded, and keeps its notes; any other gap keeps its words.
        const metaOnly = holdBackMeta(issue).text === "";
        return {
          id: `gap-${key}-${seed}-${i + 1}`,
          sectionKey: key,
          issue: metaOnly ? `The draft could not settle “${label}” from the record.` : issue,
          suggestedQuestion: metaOnly ? `Please answer “${label}” from the notes and your knowledge of the case, or leave it blank.` : question || "Can you add this from your own knowledge of the case?",
          relatedNoteIds: related,
          raisedBy: "ai" as const,
          kind: metaOnly ? ("meta_held_back" as const) : draftedGapKind(field, issue, related),
        };
      });

    // Fix round 3 (B2-5, kept by bh2 WD): a yes-or-no question answered in words ("Are there obstacles to getting
    // better? – or “No”") drafted as a list of facts, with no "Yes" or "No": nobody recorded them as such, so the
    // clinician answers it. The drafted facts are shown in the gap, never dropped.
    if (field && yesNoInWords(field) && paragraphs.length > 0 && !/^(?:yes|no)\b/i.test(paragraphs[0].text)) {
      const drafted = paragraphs.map((p) => p.text).join(" ");
      holdBack(
        "yesno",
        {
          kind: field.fillSource.kind === "clinician_opinion" ? "no_opinion_recorded" : "record_value",
          issue: `“${label}” needs a Yes or a No first. Related details are in the notes (${quoted(drafted, 120)}), but no clinician recorded them as such, so nothing has been entered.`,
          suggestedQuestion: `Is “${label}” a Yes or a No? If Yes, write what you found.`,
        },
        paragraphs.flatMap((p) => p.sourceIds),
      );
      paragraphs.length = 0;
    }

    // bh2 WD design 8: on any other form, a compact or structured answer about the latest position that cites only
    // notes older than the latest note is held back (B1-6, B3-7).
    const latestOnly = Boolean(field && timeKind === "later" && latest && timePointOf(field, timeKind) === "latest");
    const olderThanLatest = (ps: readonly Paragraph[]) => (latestOnly ? onlyOlderNotes(Array.from(new Set(ps.flatMap((p) => p.sourceIds))), bundle) : null);

    // Referrer forms: the structured answer (yes/no, tick box, choice, date, number).
    let answer: FormAnswer | undefined;
    if (field && answerKindFor(field.answerType) !== "text") {
      const raw = outSections.map((s) => String(s.answer ?? "").trim()).find((a) => a !== "") ?? "";
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
          kind: isClinicianBox(field) && field.fillSource.kind === "clinician_opinion" ? "opinion_not_fitting_options" : "record_value",
        });
      } else if (answer.value !== null && !paragraphs.some((p) => p.sourceIds.length > 0) && (heldForTimePoint || isClinicianBox(field))) {
        // Its support was held back for its time point, or it is a clinician's answer with no cited note: never entered.
        answer = { ...answer, value: null };
        if (!heldForTimePoint) {
          sectionGaps.push({
            id: `gap-${key}-${seed}-cite`,
            sectionKey: key,
            issue: `The drafted answer to “${label}” cites no note, so it has not been entered: it is the clinician's to give.`,
            suggestedQuestion: `Which answer should be given to “${label}”${field.options?.length ? ` (${field.options.join(" / ")})` : ""}?`,
            relatedNoteIds: [],
            raisedBy: "system",
            kind: field.fillSource.kind === "clinician_opinion" ? "no_opinion_recorded" : "choice_held_back",
          });
        }
      } else if (answer.value !== null && !paragraphs.some((p) => p.sourceIds.length > 0)) {
        sectionGaps.push({
          id: `gap-${key}-${seed}-cite`,
          sectionKey: key,
          issue: `The drafted answer to “${label}” cites no source in the record.`,
          suggestedQuestion: `Is “${raw}” the right answer to “${label}”? Confirm it, or change it.`,
          relatedNoteIds: [],
          raisedBy: "system",
          kind: field.fillSource.kind === "clinician_opinion" ? "no_opinion_recorded" : "record_value",
        });
      } else if (answer.value !== null) {
        const value = typeof answer.value === "boolean" ? (answer.value ? "Yes" : "No") : String(answer.value);
        const citedIds = Array.from(new Set(paragraphs.flatMap((p) => p.sourceIds)));
        const decision = decideStructuredAnswer({
          field,
          label,
          value,
          paragraphs,
          citedNotes: citedIds.map((id) => noteById.get(id)).filter((n): n is NonNullable<typeof n> => n !== undefined),
          citedTexts: citedIds.map((id) => sourceTexts.get(id) ?? ""),
        });
        const older = decision.enter ? olderThanLatest(paragraphs) : null;
        if (!decision.enter && decision.gap) {
          answer = { ...answer, value: null };
          // The cited paragraph stays as context (it is not printed for a structured answer).
          sectionGaps.push({ id: `gap-${key}-${seed}-choice`, sectionKey: key, relatedNoteIds: citedIds.filter((x) => isNoteId(x)), raisedBy: "system", ...decision.gap });
        } else if (older) {
          answer = { ...answer, value: null };
          sectionGaps.push({
            id: `gap-${key}-${seed}-asat`,
            sectionKey: key,
            issue: `From the note of ${formatUkDate(older)} – check it at the latest note (${formatUkDate(latest as string)}): the drafted answer “${value}” was not entered, because this question asks for the position now.`,
            suggestedQuestion: `What is the answer to “${label}” as at the latest note of ${formatUkDate(latest as string)}?`,
            relatedNoteIds: citedIds.filter((x) => isNoteId(x)),
            raisedBy: "system",
            kind: "record_value",
            // The person may confirm it in one click when it is still right – never on a clinician's box (C-2).
            ...(!isClinicianBox(field) && hookEnabled(TICK_SUGGESTED_HOOK) ? { suggestedAnswer: value } : {}),
          });
        }
      }
    } else if (field && compactPlace(field) !== null && paragraphs.length > 0) {
      // A compact text answer about the latest position, from older notes only: held back, not printed.
      const older = olderThanLatest(paragraphs);
      if (older) {
        const drafted = paragraphs.map((p) => p.text).join(" ");
        holdBack(
          "asat",
          {
            kind: "record_value",
            issue: `From the note of ${formatUkDate(older)} – check it at the latest note (${formatUkDate(latest as string)}): ${quoted(drafted)} is not printed, because this question asks for the position now.`,
            suggestedQuestion: `What should “${label}” say as at the latest note of ${formatUkDate(latest as string)}?`,
          },
          paragraphs.flatMap((p) => p.sourceIds),
        );
        paragraphs.length = 0;
      }
    }

    sectionGaps.push(...heldGaps);
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
        author: voiceOwner,
        ...(approver?.memberId ? { approver: { memberId: approver.memberId, name: approver.name, hcpc: approver.hcpc ?? "" } } : {}),
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
  const flags = runValidators({ report, bundle, template, computedFacts: input.computedFacts, ...(form ? { form } : {}), voice: { owner: voiceOwner } }).filter(
    (f) => f.sectionKey !== undefined && drafted.has(f.sectionKey),
  );

  return DraftsResponseSchema.parse({ sections, gaps, flags, generation: input.meta });
}
