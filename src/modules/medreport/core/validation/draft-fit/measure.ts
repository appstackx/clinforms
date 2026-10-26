/**
 * DRAFT_FIT parts about what a drafted answer measures: its time point, the day it is dated to, and a medicine's dose
 * (bh2 WD design 6 and 8). Warnings only – each answers a question the clinician settles.
 *
 * - "later note" (B0-6): on an initial assessment form, a paragraph citing a note dated after that assessment.
 * - "earlier note" (B1-6, B3-7): on any other form, a drafted text answer to a question about the present position
 *   ("… now", "current …", "at discharge") that cites only notes older than the latest note. Compact and structured
 *   answers in that situation are held back at drafting (ai/assemble.ts) and never reach here as drafted text.
 * - "date" (B3-7): a sentence dated to a day ("On 16/09/2026 …", "At the discharge assessment on 16/09/2026 …") that
 *   none of the paragraph's cited sources has: not a cited note's own date, and not a date a cited note, the
 *   registration or a computed fact records (the incident, attendance, outcome scores).
 * - "dose" (B3-12): a medicine the patient was taking, named without a dose that no cited note gives either – a
 *   deterministic one-click adds "(dose not stated)" (ui/components/review/fixes.ts).
 *
 * The time-point helpers are shared with drafting assembly (ai/assemble.ts) so both read the same rule.
 *
 * Split out of core/validation/draft-fit.ts by W0.4 (bh2 module split); the "earlier note", "date" and "dose" parts and
 * the shared helpers are bh2 WD. draft-fit.ts runs the parts.
 * Owner: WD (drafting and text edits) – docs/bh2-ownership.json.
 */
import { formatUkDate } from "../../dates";
import { formTimeKind } from "../../forms/answer-shape";
import { reportKindOf } from "../../forms";
import { initialAssessmentView } from "../../scope";
import { splitSentences } from "../../text/sentences";
import type { EpisodeBundle, FormField, Note, ReportFlag } from "../../types";
import { getValidationContext, makeFlag } from "../context";
import type { DraftFitPart } from "../draft-fit";
import type { ValidatorInput } from "../registry";

/* ------------------------------------------------------------------------------------------------
 * Shared time-point helpers (also used by ai/assemble.ts)
 * ----------------------------------------------------------------------------------------------*/

/** The latest note's date (the latest attended session that has a note), or null. */
export function latestNoteDate(bundle: Pick<EpisodeBundle, "notes">): string | null {
  let latest: string | null = null;
  for (const n of bundle.notes) if (!latest || n.date > latest) latest = n.date;
  return latest;
}

/**
 * When a drafted answer cites notes and every cited note is older than the latest note, the newest of them (ISO date);
 * else null (it cites the latest note, or cites no note at all).
 */
export function onlyOlderNotes(sourceIds: readonly string[], bundle: Pick<EpisodeBundle, "notes">): string | null {
  const latest = latestNoteDate(bundle);
  if (!latest) return null;
  const dates = sourceIds.map((id) => bundle.notes.find((n) => n.id === id)?.date).filter((d): d is string => Boolean(d));
  if (dates.length === 0) return null;
  const newest = dates.slice().sort()[dates.length - 1];
  return newest < latest ? newest : null;
}

/** On an initial assessment form: the latest cited note dated after that assessment (ISO date), else null. */
export function laterThanAssessment(sourceIds: readonly string[], bundle: EpisodeBundle): { later: string; assessment: string } | null {
  const ia = initialAssessmentView(bundle);
  if (!ia) return null;
  const later = sourceIds
    .map((id) => bundle.notes.find((n) => n.id === id)?.date)
    .filter((d): d is string => Boolean(d) && (d as string) > ia.date)
    .sort();
  return later.length ? { later: later[later.length - 1], assessment: ia.date } : null;
}

/** A question about the present position: "Pain now", "Current medication", "Work status at discharge". */
export const PRESENT_LABEL = /\b(?:now|current(?:ly)?|at (?:the )?discharge|on discharge|latest|present(?:ly)?|still|today)\b/i;

/* ------------------------------------------------------------------------------------------------
 * "later note" and "earlier note"
 * ----------------------------------------------------------------------------------------------*/

export function laterNotePart(input: ValidatorInput): DraftFitPart {
  const ia = input.report.form && reportKindOf(input.report.form.title) === "initial" ? initialAssessmentView(input.bundle) : null;
  const later = input.report.form ? formTimeKind(input.report.form) === "later" : false;
  const fields = new Map((input.form?.fields ?? []).map((f) => [f.id, f] as const));
  const noteDate = new Map(input.bundle.notes.map((n) => [n.id, n.date]));
  const latest = latestNoteDate(input.bundle);
  return {
    paragraph(p, section) {
      const flags: ReportFlag[] = [];
      if (ia) {
        const laterDates = p.sourceIds.map((id) => noteDate.get(id)).filter((d): d is string => Boolean(d) && (d as string) > ia.date).sort();
        if (laterDates.length > 0) {
          flags.push(
            makeFlag({
              code: "DRAFT_FIT",
              severity: "warning",
              sectionKey: section.key,
              paragraphId: p.id,
              evidence: `later note ${laterDates[laterDates.length - 1]}`,
              message: `From a later note of ${formatUkDate(laterDates[laterDates.length - 1])} – check it belongs on an initial assessment (${formatUkDate(ia.date)}).`,
            }),
          );
        }
      } else if (later && latest) {
        // bh2 WD design 8 (B1-6, B3-7): a printed text answer about the present position from an older note.
        const field = fields.get(section.key) as FormField | undefined;
        const printed = !section.answer || section.answer.kind === "text";
        const older = printed && field && PRESENT_LABEL.test(field.label) ? onlyOlderNotes(p.sourceIds, input.bundle) : null;
        if (older && section.paragraphs[0] === p) {
          flags.push(
            makeFlag({
              code: "DRAFT_FIT",
              severity: "warning",
              sectionKey: section.key,
              paragraphId: p.id,
              evidence: `earlier note ${older}`,
              message: `From the note of ${formatUkDate(older)} – the latest note is ${formatUkDate(latest)}: check this is still right as the form asks it now.`,
            }),
          );
        }
      }
      return flags;
    },
  };
}

/* ------------------------------------------------------------------------------------------------
 * "date": a sentence dated to a day none of its sources has
 * ----------------------------------------------------------------------------------------------*/

const UK_DATE = /\b(\d{2})\/(\d{2})\/(\d{4})\b/g;
/** "On 16/09/2026 …", "At the discharge assessment on 16/09/2026, …", "16/09/2026: …" at the start of a sentence. */
const DATE_LEAD = /^(?:On (\d{2}\/\d{2}\/\d{4})\b|At (?:my |the |his |her |a |an )?[A-Za-z][A-Za-z -]{0,40}? on (\d{2}\/\d{2}\/\d{4})\b|(\d{2}\/\d{2}\/\d{4}):)/;

function ukToIso(d: string): string {
  const [dd, mm, yyyy] = d.split("/");
  return `${yyyy}-${mm}-${dd}`;
}

function datesIn(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(UK_DATE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(`${m[3]}-${m[2]}-${m[1]}`);
  // ISO dates as the record writes some (registration, facts).
  for (const iso of text.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? []) out.push(iso);
  return out;
}

export function datedLeadPart(input: ValidatorInput): DraftFitPart {
  const ctx = getValidationContext(input);
  const notes = new Map(input.bundle.notes.map((n) => [n.id, n] as const));
  return {
    paragraph(p, section) {
      const flags: ReportFlag[] = [];
      const cited = ctx.cited(p).validIds;
      if (cited.length === 0) return flags;
      const days = new Set<string>();
      for (const id of cited) {
        const note: Note | undefined = notes.get(id);
        if (note) days.add(note.date);
        // A day the cited source itself records (the incident date in a note, a date in the registration or a fact).
        for (const d of datesIn(ctx.sourceTexts.get(id) ?? "")) days.add(d);
      }
      for (const s of splitSentences(p.text)) {
        const m = DATE_LEAD.exec(s.text.slice(s.bodyStart - s.start));
        const lead = m ? (m[1] ?? m[2] ?? m[3]) : null;
        if (!lead || days.has(ukToIso(lead))) continue;
        flags.push(
          makeFlag({
            code: "DRAFT_FIT",
            severity: "warning",
            sectionKey: section.key,
            paragraphId: p.id,
            evidence: `date ${lead}`,
            message: `Check the date: this answer is dated ${lead}, but none of the sources it cites is from that day.`,
          }),
        );
        break;
      }
      return flags;
    },
  };
}

/* ------------------------------------------------------------------------------------------------
 * "dose": a medicine named without a dose (B3-12)
 * ----------------------------------------------------------------------------------------------*/

/** Medicines physiotherapy notes commonly record (generic and common UK brand names). */
const MEDICINES = [
  "ibuprofen", "paracetamol", "naproxen", "diclofenac", "co-codamol", "cocodamol", "codeine", "dihydrocodeine", "tramadol",
  "morphine", "oramorph", "aspirin", "celecoxib", "etoricoxib", "meloxicam", "amitriptyline", "nortriptyline", "gabapentin",
  "pregabalin", "duloxetine", "prednisolone", "diazepam", "baclofen", "methocarbamol", "nurofen", "voltarol", "solpadeine",
];
const MEDICINE = new RegExp(`\\b(${MEDICINES.map((m) => m.replace(/-/g, "\\-")).join("|")})\\b`, "i");
/** Taking it (not "stopped", "no", "declined"). */
const TAKING = /\b(?:tak(?:es|ing|en)|took|prescribed|using|uses|used|on regular|started|continu(?:es|ing|ed)\s+(?:with|to take))\b/i;
const NOT_TAKING = /\b(?:no|not|never|stopped|declined|without|nil|refused|avoid(?:s|ed|ing)?)\b/i;
/** A dose or a frequency next to it: "400 mg", "1 g", "30/500", "two tablets", "as needed", "PRN", "when required". */
const DOSE = /\b\d+(?:\.\d+)?\s?(?:mg|g|mcg|µg|micrograms?|milligrams?|ml|mls)\b|\b\d+\/\d+\b|\b(?:one|two|three|four|\d+)\s+(?:tablets?|capsules?|puffs?|doses?)\b|\b(?:dose|doses|dosage)\b/i;

/** The first medicine of the text that is taken, named without a dose, that the cited notes give no dose for either. */
export function undosedMedicine(text: string, citedText: string): string | null {
  for (const s of splitSentences(text)) {
    const m = MEDICINE.exec(s.text);
    if (!m) continue;
    const before = s.text.slice(0, m.index);
    if (!TAKING.test(before) || NOT_TAKING.test(before)) continue;
    if (DOSE.test(s.text)) continue;
    const name = m[1].toLowerCase();
    // The note gives a dose for it: the clinician adds it (no one-click "not stated").
    const noted = citedText.toLowerCase();
    const at = noted.indexOf(name);
    if (at >= 0 && DOSE.test(citedText.slice(at, at + name.length + 40))) continue;
    return m[1];
  }
  return null;
}

export function dosePart(input: ValidatorInput): DraftFitPart {
  const ctx = getValidationContext(input);
  return {
    paragraph(p, section) {
      if (section.answer && section.answer.kind !== "text") return [];
      const cited = ctx.cited(p).validIds.map((id) => ctx.sourceTexts.get(id) ?? "").join("\n");
      const medicine = undosedMedicine(p.text, cited);
      if (!medicine) return [];
      return [
        makeFlag({
          code: "DRAFT_FIT",
          severity: "warning",
          sectionKey: section.key,
          paragraphId: p.id,
          evidence: `dose ${medicine.toLowerCase()}`,
          message: `No dose is given for ${medicine.toLowerCase()}, and the notes it cites record none: say “(dose not stated)”, or add the dose.`,
        }),
      ];
    },
  };
}
